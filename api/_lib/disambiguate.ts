import type {
  DisambiguationControl,
  DisambiguationRequestPayload,
  DisambiguationResponse,
} from "../../src/lib/api.js";
import { callJson, HttpError } from "./gemini.js";
import { taskConfigs } from "./models.js";

const SYSTEM = `You are the Intent & Ambiguity Engine for Forkcast, a GenUI design & QA tool for flight-booking screens.
Given a user's open-ended screen edit or flow branch request, decide if it has meaningful design ambiguity (score 0.0 to 1.0).
If uncertaintyScore >= 0.45, emit 2 or 3 compact interactive micro-UI controls so the user clarifies layout, density, or emphasis in 2 clicks instead of prose.
Return strict JSON:
{
  "uncertaintyScore": 0.0-1.0,
  "rationale": "short 1-line reason why clarifying helps",
  "controls": [
    { "id": "c1", "kind": "choice-cards", "label": "Layout Direction", "options": [{"id": "o1", "title": "Compact Summary", "subtitle": "Key totals upfront", "badge": "Recommended"}, {"id": "o2", "title": "Detailed Breakdown", "subtitle": "Itemized per-traveler rows"}], "selectedId": "o1" },
    { "id": "c2", "kind": "chips", "label": "Emphasize", "options": ["Total price", "Per-traveler fare", "Baggage rules", "Primary CTA"], "selected": ["Total price"] },
    { "id": "c3", "kind": "slider", "label": "Information Density", "min": 1, "max": 5, "step": 1, "unit": "/5", "value": 3 }
  ]
}`;

interface RawDisambig {
  uncertaintyScore?: unknown;
  rationale?: unknown;
  controls?: unknown;
}

function sanitizeControls(raw: unknown): DisambiguationControl[] {
  if (!Array.isArray(raw)) return [];
  const out: DisambiguationControl[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id ?? `c${out.length + 1}`);
    const label = String(rec.label ?? "Option").slice(0, 60);
    if (rec.kind === "choice-cards" && Array.isArray(rec.options) && rec.options.length >= 2) {
      const options = rec.options.slice(0, 3).map((o, idx) => {
        const opt = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
        return {
          id: String(opt.id ?? `o${idx + 1}`),
          title: String(opt.title ?? `Option ${idx + 1}`).slice(0, 48),
          subtitle: String(opt.subtitle ?? "").slice(0, 90),
          ...(typeof opt.badge === "string" ? { badge: opt.badge.slice(0, 20) } : {}),
        };
      });
      const selectedId = typeof rec.selectedId === "string" && options.some((o) => o.id === rec.selectedId) ? rec.selectedId : options[0].id;
      out.push({ id, kind: "choice-cards", label, options, selectedId });
    } else if (rec.kind === "chips" && Array.isArray(rec.options) && rec.options.length >= 2) {
      const options = rec.options.slice(0, 6).map((x) => String(x).slice(0, 32));
      const selected = Array.isArray(rec.selected) ? rec.selected.map(String).filter((x) => options.includes(x)) : [options[0]];
      out.push({ id, kind: "chips", label, options, selected });
    } else if (rec.kind === "slider") {
      const min = typeof rec.min === "number" ? rec.min : 1;
      const max = typeof rec.max === "number" && rec.max > min ? rec.max : 5;
      const step = typeof rec.step === "number" && rec.step > 0 ? rec.step : 1;
      const value = typeof rec.value === "number" ? Math.min(max, Math.max(min, rec.value)) : Math.round((min + max) / 2);
      out.push({ id, kind: "slider", label, min, max, step, unit: typeof rec.unit === "string" ? rec.unit.slice(0, 8) : "/5", value });
    }
  }
  return out;
}

export async function disambiguate(req: DisambiguationRequestPayload): Promise<DisambiguationResponse> {
  const promptText = typeof req?.prompt === "string" ? req.prompt.trim() : "";
  if (!promptText) throw new HttpError(400, "prompt is required");

  // Fast server short-circuit: explicit @Pin/@Mask mentions, questions, or concrete >18-word instructions need no disambiguation.
  if (/@[A-Za-z0-9_:-]+/.test(promptText) || promptText.endsWith("?") || promptText.split(/\s+/).length > 18) {
    return { ambiguous: false, uncertaintyScore: 0.1, rationale: "Specific instruction", controls: [] };
  }

  const broadEditPattern = /\b(redesign|rethink|overhaul|improve|clean up|better|modernize|simplify|layout|rework|explore|variant)\b/i;
  if (!broadEditPattern.test(promptText)) {
    return { ambiguous: false, uncertaintyScore: 0.2, rationale: "Direct edit", controls: [] };
  }

  const task = taskConfigs.disambiguate;
  const r = await callJson<RawDisambig>({
    model: task.model,
    thinkingLevel: task.thinkingLevel,
    system: SYSTEM,
    prompt: `Scope: ${req.scope}${req.nodeLabel ? ` · Step: ${req.nodeLabel}` : ""}${req.screenVariant ? ` · Variant: ${req.screenVariant}` : ""}\nPrompt: "${promptText}"`,
    temperature: 0.3,
    timeoutMs: 14_000,
    retries: 1,
  }).catch((e) => {
    throw new HttpError(502, `disambiguation check failed: ${(e as Error).message}`);
  });

  const score = typeof r.data?.uncertaintyScore === "number" ? Math.max(0, Math.min(1, r.data.uncertaintyScore)) : 0;
  const controls = sanitizeControls(r.data?.controls);
  const ambiguous = score >= 0.45 && controls.length > 0;
  return {
    ambiguous,
    uncertaintyScore: score,
    rationale: typeof r.data?.rationale === "string" ? r.data.rationale.slice(0, 140) : "Clarify direction before generating",
    controls: ambiguous ? controls : [],
    usage: r.usage,
  };
}
