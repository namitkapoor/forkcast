import type { CritiquePin, CritiqueScreenRequest, CritiqueScreenResponse } from "../../src/lib/api.js";
import { callJson, HttpError } from "./gemini.js";
import { getComponents, screenToText } from "./dataModel.js";
import { taskConfigs } from "./models.js";

const SYSTEM = `You are a Principal UX & QA Evaluator for Forkcast, reviewing a generated flight-booking A2UI screen.
Evaluate the screen across 4 dimensions (0 to 100 each): usability, hierarchy, accessibility, continuity (how well it carries context and satisfies transition contracts).
Also identify 1 to 4 concrete, actionable critique pins anchored to exact component ids from the screen.
Return strict JSON:
{
  "overallScore": 0-100,
  "dimensions": { "usability": 0-100, "hierarchy": 0-100, "accessibility": 0-100, "continuity": 0-100 },
  "summary": "1-2 concise sentences summarizing strengths and top UX risk",
  "pins": [
    { "componentId": "<exact component id>", "kind": "bug" | "rule" | "note", "text": "Concise actionable critique (max 18 words)" }
  ]
}`;

interface RawCritique {
  overallScore?: unknown;
  dimensions?: Record<string, unknown>;
  summary?: unknown;
  pins?: unknown;
}

const clampScore = (v: unknown, fallback = 78): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v))) : fallback;

export async function critiqueScreen(req: CritiqueScreenRequest): Promise<CritiqueScreenResponse> {
  const screen = req?.screen;
  if (!screen || !Array.isArray(screen.messages) || !screen.messages.length) {
    throw new HttpError(400, "screen with messages is required");
  }

  const comps = getComponents(screen.messages);
  const validIds = new Set(comps.map((c) => String(c.id)));
  const compList = comps.slice(0, 60).map((c) => `${String(c.id)} (${String(c.type)})`).join(", ");

  const task = taskConfigs.uxEval;
  const prompt = [
    `Step: ${req.nodeLabel || screen.nodeId} (stage: ${req.stage || "unknown"})`,
    `User context: ${JSON.stringify(screen.context ?? {})}`,
    `Layout variant: "${screen.variant}" — rationale: "${screen.rationale ?? ""}"`,
    req.contracts?.length ? `Transition contracts touching this step: ${req.contracts.join("; ")}` : "",
    `Valid component ids on this screen: ${compList}`,
    `Screen outline:\n${screenToText(screen.messages, 80)}`,
    `Return the JSON critique now.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const r = await callJson<RawCritique>({
    model: task.model,
    thinkingLevel: task.thinkingLevel,
    system: SYSTEM,
    prompt,
    temperature: 0.25,
    timeoutMs: 28_000,
    retries: 2,
  }).catch((e) => {
    throw new HttpError(502, `UX critique failed: ${(e as Error).message}`);
  });

  const dims = (r.data?.dimensions && typeof r.data.dimensions === "object" ? r.data.dimensions : {}) as Record<string, unknown>;
  const usability = clampScore(dims.usability, 80);
  const hierarchy = clampScore(dims.hierarchy, 78);
  const accessibility = clampScore(dims.accessibility, 82);
  const continuity = clampScore(dims.continuity, 80);
  const overallScore = clampScore(
    r.data?.overallScore,
    Math.round((usability + hierarchy + accessibility + continuity) / 4),
  );

  const pins: CritiquePin[] = [];
  if (Array.isArray(r.data?.pins)) {
    for (const rawPin of r.data.pins.slice(0, 4)) {
      if (!rawPin || typeof rawPin !== "object") continue;
      const p = rawPin as Record<string, unknown>;
      const text = typeof p.text === "string" ? p.text.trim().slice(0, 180) : "";
      if (!text) continue;
      const cid = typeof p.componentId === "string" && validIds.has(p.componentId) ? p.componentId : undefined;
      const kind = p.kind === "bug" || p.kind === "rule" ? p.kind : "note";
      pins.push({ ...(cid ? { componentId: cid } : {}), kind, text });
    }
  }

  return {
    report: {
      overallScore,
      dimensions: { usability, hierarchy, accessibility, continuity },
      summary:
        typeof r.data?.summary === "string" && r.data.summary.trim()
          ? r.data.summary.trim().slice(0, 300)
          : `Scored ${overallScore}/100 across usability, hierarchy, accessibility, and contract continuity.`,
      pins,
      model: r.model,
      evaluatedAt: new Date().toISOString(),
    },
    usage: r.usage,
  };
}
