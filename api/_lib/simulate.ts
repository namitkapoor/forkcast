import type { SimulateStepRequest, SimulateStepResponse } from "../../src/lib/api.js";
import { callJson, HttpError } from "./gemini.js";
import { screenToText } from "./dataModel.js";
import { models } from "./models.js";

const SYSTEM = `You role-play a real person using a flight-booking assistant inside a chat app. Stay in character.
You see the current screen as a text outline and a numbered list of things you can do next. Pick ONE option, or abandon if this persona realistically would (confusing screen, price too high, out of patience, goal already met elsewhere).
Return JSON: {"option": <number> | "abandon", "userAction": "<what you did, short, in your own words, max 12 words, describing the on-screen action (the fare, seat or button you tapped, what you typed), not the option text>", "reason": "<one short sentence, first person>"}`;

interface Pick {
  option?: unknown;
  userAction?: unknown;
  reason?: unknown;
}

export async function simulateStep(req: SimulateStepRequest, timeoutMs = 20_000): Promise<SimulateStepResponse & { model: string }> {
  if (!req || typeof req.persona !== "string" || !req.screen || !Array.isArray(req.screen.messages) || !Array.isArray(req.options)) {
    throw new HttpError(400, "persona, goal, context, screen {nodeId, messages} and options[] are required");
  }
  if (!req.options.length) throw new HttpError(400, "options must not be empty");

  const prompt = [
    `Persona: ${req.persona}`,
    `Goal: ${req.goal ?? ""}`,
    `Context: ${JSON.stringify(req.context ?? {})}`,
    req.history?.length ? `So far:\n${req.history.slice(-8).map((h, i) => `${i + 1}. ${h}`).join("\n")}` : `This is the first screen.`,
    `Current screen (${req.screen.nodeId}):\n${screenToText(req.screen.messages) || "(empty)"}`,
    `Options:\n${req.options.map((o, i) => `${i}. [${o.kind}] ${o.label}`).join("\n")}`,
  ].join("\n\n");

  const r = await callJson<Pick>({ model: models.simulator, system: SYSTEM, prompt, temperature: 0.9, timeoutMs, retries: 4 }).catch((e) => {
    throw new HttpError(502, `simulated user failed: ${(e as Error).message}`);
  });
  const d = r.data ?? {};
  const userAction = typeof d.userAction === "string" && d.userAction.trim() ? d.userAction.trim().slice(0, 140) : "";
  const reason = typeof d.reason === "string" ? d.reason.trim().slice(0, 240) : "";

  if (d.option === "abandon") return { choice: { abandon: true }, userAction: userAction || "Closed the chat", reason, model: r.model };
  const idx = typeof d.option === "number" ? d.option : Number.parseInt(String(d.option), 10);
  const chosen = Number.isInteger(idx) ? req.options[idx] : undefined;
  if (!chosen) {
    // Out-of-range pick: fall back to the first forward option rather than inventing an edge.
    const fallback = req.options.find((o) => o.kind === "next") ?? req.options[0];
    return { choice: { to: fallback.to, kind: fallback.kind }, userAction: userAction || fallback.label, reason: reason || "(model picked an invalid option)", model: r.model };
  }
  return { choice: { to: chosen.to, kind: chosen.kind }, userAction: userAction || chosen.label, reason, model: r.model };
}
