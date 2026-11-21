import type { CritiquePin, CritiqueScreenRequest, CritiqueScreenResponse, TokenUsage } from "../../src/lib/api.js";
import { isValidCriticModel, normalizeCriticConfig, type CriticEffort } from "../../src/lib/criticModels.js";
import { callJson, CARBON_TIMEOUT_MS, HttpError, isCarbonModel, type JsonCallResult } from "./gemini.js";
import { getComponents, screenToText } from "./dataModel.js";
import { taskConfigs, type ThinkingLevelSetting } from "./models.js";

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

function timeoutForModel(model: string): number {
  if (isCarbonModel(model)) return CARBON_TIMEOUT_MS; // 200_000ms
  if (/argon/i.test(model)) return 95_000;
  return 35_000;
}

export async function critiqueScreen(req: CritiqueScreenRequest): Promise<CritiqueScreenResponse> {
  const screen = req?.screen;
  if (!screen || !Array.isArray(screen.messages) || !screen.messages.length) {
    throw new HttpError(400, "screen with messages is required");
  }

  // Validate requested (model, thinkingLevel) combination strictly against CRITIC_MODELS
  const envDefault = taskConfigs.uxEval;
  const chosen = req.model
    ? normalizeCriticConfig(req.model, req.thinkingLevel)
    : isValidCriticModel(envDefault.model)
      ? normalizeCriticConfig(envDefault.model, req.thinkingLevel ?? envDefault.thinkingLevel)
      : { model: envDefault.model, effort: (envDefault.thinkingLevel ?? "MEDIUM") as CriticEffort };

  const comps = getComponents(screen.messages);
  const validIds = new Set(comps.map((c) => String(c.id)));
  const compList = comps.slice(0, 60).map((c) => `${String(c.id)} (${String(c.type)})`).join(", ");

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

  const candidates: { model: string; level: ThinkingLevelSetting; timeoutMs: number }[] = [
    { model: chosen.model, level: chosen.effort, timeoutMs: timeoutForModel(chosen.model) },
    { model: "gemini-4-neon", level: "LOW", timeoutMs: 25_000 },
    { model: "gemini-4-hydrogen", level: "LOW", timeoutMs: 20_000 },
  ];

  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    const k = `${c.model}:${c.level}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let result: JsonCallResult<RawCritique> | undefined;
  let usedLevel: CriticEffort = chosen.effort;
  const errors: string[] = [];
  let accumulatedUsage: TokenUsage | undefined;

  for (const cand of uniqueCandidates) {
    try {
      const r = await callJson<RawCritique>({
        model: cand.model,
        thinkingLevel: cand.level,
        system: SYSTEM,
        prompt,
        temperature: 0.25,
        timeoutMs: cand.timeoutMs,
        retries: 1,
      });
      accumulatedUsage = r.usage;
      usedLevel = cand.level;
      result = r;
      break;
    } catch (e) {
      errors.push(`${cand.model} (${cand.level}): ${(e as Error).message}`);
    }
  }

  if (!result) {
    throw new HttpError(502, `UX critique failed across models: ${errors.join(" | ")}`);
  }

  const dims = (result.data?.dimensions && typeof result.data.dimensions === "object" ? result.data.dimensions : {}) as Record<string, unknown>;
  const usability = clampScore(dims.usability, 80);
  const hierarchy = clampScore(dims.hierarchy, 78);
  const accessibility = clampScore(dims.accessibility, 82);
  const continuity = clampScore(dims.continuity, 80);
  const overallScore = clampScore(
    result.data?.overallScore,
    Math.round((usability + hierarchy + accessibility + continuity) / 4),
  );

  const pins: CritiquePin[] = [];
  if (Array.isArray(result.data?.pins)) {
    for (const rawPin of result.data.pins.slice(0, 4)) {
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
        typeof result.data?.summary === "string" && result.data.summary.trim()
          ? result.data.summary.trim().slice(0, 300)
          : `Scored ${overallScore}/100 across usability, hierarchy, accessibility, and contract continuity.`,
      pins,
      model: result.model,
      thinkingLevel: usedLevel,
      evaluatedAt: new Date().toISOString(),
    },
    usage: accumulatedUsage,
  };
}
