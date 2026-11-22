import type { AskRequest, AskResponse } from "../../src/lib/api.js";
import { callJson, HttpError } from "./gemini.js";
import { screenToText } from "./dataModel.js";
import { getLlmConfig } from "./models.js";

// Short answers about a Forkcast run, for the chat panel when nothing editable is selected.

const SYSTEM = `You are Forkcast, a QA tool that maps every path through a generated flight-booking UI (inside a chat assistant called Getaway) as a graph of states and transitions, with invariants per state and contracts per transition.
Answer the QA engineer's question using ONLY the run data, screen outline, and @Pin/@Mask notes given. Be specific: name states, transitions, component ids, counts and percentages. If the data can't answer it, say what would.
Keep it short: at most 4 sentences or 4 terse bullets, plain text, no markdown headers.
Return JSON: {"answer": "<text>"}`;

export async function ask(req: AskRequest): Promise<AskResponse> {
  const question = typeof req?.question === "string" ? req.question.trim() : "";
  if (!question) throw new HttpError(400, "question is required");
  const s = req.stats;
  const prompt = [
    `Selection: ${req.selection || "Whole run"}`,
    s
      ? `Run: ${s.sessions} sessions, ${s.completedPct}% completed, ${s.failedChecks} failed checks. Coverage: ${s.edgesExercised}/${s.edgesTotal} transitions exercised; 95% of traffic runs over ${s.edgesFor95} transitions.`
      : "",
    req.failingEdges?.length
      ? `Failing checks (where · count · example):\n${req.failingEdges.slice(0, 12).map((f) => `- ${f.edge} · ${f.count} · ${f.example}`).join("\n")}`
      : "No failing checks.",
    req.screen?.messages?.length ? `Selected screen "${req.screen.variant}":\n${screenToText(req.screen.messages, 50)}` : "",
    req.referencedContext ? `Attached @Pin / @Mask / @Screen context:\n${req.referencedContext.slice(0, 2000)}` : "",
    req.history?.length ? `Earlier in this chat:\n${req.history.slice(-6).map((h) => `${h.role}: ${h.text.slice(0, 400)}`).join("\n")}` : "",
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const cfg = getLlmConfig("assistant");
  const r = await callJson<{ answer?: unknown }>({
    model: cfg.model,
    system: SYSTEM,
    prompt,
    temperature: cfg.temperature,
    thinkingConfig: cfg.thinkingConfig,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
  }).catch((e) => {
    throw new HttpError(502, `ask failed: ${(e as Error).message}`);
  });
  const answer = typeof r.data?.answer === "string" ? r.data.answer.trim() : "";
  if (!answer) throw new HttpError(502, "model returned no answer");
  return { answer, model: r.model, usage: r.usage };
}
