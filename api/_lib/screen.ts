import { A2UI_VERSION, BASIC_CATALOG_ID, type A2uiMessage, type Screen } from "../../src/a2ui/types.js";
import { catalogPromptSummary, validateMessages } from "../../src/a2ui/validate.js";
import type { Context, StateNode } from "../../src/graph/types.js";
import { callJson, HttpError, TimeoutError } from "./gemini.js";
import { getDataModel, lintBindings, pinSurfaceId } from "./dataModel.js";
import { getLlmConfig, type ResolvedLlmConfig } from "./models.js";

export interface ScreenInput {
  node: StateNode;
  context: Context;
  utterance?: string;
  carry?: Record<string, unknown>;
  /** Text outline of the screen the user came from, so the new one stays on the same trip. */
  previous?: string;
}

export interface GenerateOptions {
  /** Screen id (also the A2UI surfaceId). Random if omitted. */
  id?: string;
  /** Total time budget across primary, fallback and repair. */
  budgetMs?: number;
  /** Per-call timeout for the primary model before falling back. */
  primaryTimeoutMs?: number;
}

export interface GenerateResult {
  screen: Screen;
  /** Forkcast lint issues left after repair (carried values were patched into /booking). */
  warnings: string[];
  repaired: boolean;
  attempts: { model: string; ms: number; ok: boolean; error?: string }[];
}

const SYSTEM = () => `You design one screen of a flight-booking flow that appears inside a chat assistant. You output A2UI v0.9 JSON using ONLY the basic catalog below.

${catalogPromptSummary()}

Forkcast rules (all required):
1. Output one JSON object: {"variant": "<short-kebab-layout-name>", "rationale": "<one sentence: why this layout fits THIS user's context>", "messages": [ ...A2UI messages... ]}.
2. messages = exactly: createSurface (catalogId "${BASIC_CATALOG_ID}"), then ONE updateComponents, then ONE updateDataModel with path "/" holding the whole data model. Use the surfaceId you are given everywhere. The root component id is "root".
3. Every dynamic value (prices, totals, flight numbers, times, passenger counts, seat numbers, bag fees, confirmation codes) lives in the data model and is bound with {"path": "/..."}. Never hard-code a price or flight id in component props. Put display-ready strings in the model (e.g. "priceLabel": "€1,284") alongside the raw values.
4. The data model MUST contain "booking": an object with every CARRY value copied exactly (same keys, same types: numbers stay numbers). Add display labels next to them (e.g. booking.priceLabel, booking.paxLabel).
5. Lists of things (fares, travelers, seats, bags) go in the data model as arrays. If the screen collects traveler details, the model has "travelers": an array with exactly one entry per passenger (pax).
6. At most one Button with variant "primary". Button actions use {"event":{"name":"camelCase","context":{...}}} and pass bound values in context (e.g. {"flightId":{"path":"/booking/flightId"}}).
7. Let the context drive the layout, not just the copy:
   - surface "inline": a compact chat card. Root is a Card. 3-8 visible items, short lines, no big headers, one clear next action; horizontal Rows of chips/buttons are fine.
   - surface "fullscreen": a full sheet. Root is a Column with a header (h2 + caption), grouped sections (Cards, Dividers, maybe Tabs or a List), details the inline card would omit, primary action at the bottom.
   - party "family"/"couple": show per-traveler AND total amounts, traveler count prominent, seat-together / child options where relevant. party "solo": speed first, fewer options, times and duration prominent.
   - trip "multi-city"/"round-trip": show every leg. currency: format all amounts in it.
8. Realistic content: real airline codes, plausible times and prices. Keep it under ~45 components.`;

const STAGE_HINTS: Record<string, string> = {
  intent: "The assistant acknowledges the request and confirms the trip it understood, offering to search.",
  search: "Collect or confirm search parameters (origin, destination, dates, travelers).",
  results: "A list of matching fares the user can pick from or refine.",
  compare: "A side-by-side comparison of 2-3 fares (price, times, baggage, flexibility).",
  select: "The chosen fare's details with a clear action to continue booking.",
  seats: "Seat selection for every traveler.",
  extras: "Bags and extras (checked bags, priority, insurance) with fees.",
  passengers: "Traveler details forms, one per passenger.",
  payment: "Price summary and payment, with the total in the user's currency.",
  confirm: "Booking confirmed: confirmation code, itinerary summary, next steps.",
};

export function buildScreenPrompt(input: ScreenInput, surfaceId: string): string {
  const { node, context, utterance, carry, previous } = input;
  return [
    `surfaceId: "${surfaceId}"`,
    `Node: id "${node.id}", stage "${node.stage}", label "${node.label}", component hint "${node.component}"${node.acts ? " (the user commits to something here)" : ""}.`,
    STAGE_HINTS[node.stage] ? `Stage purpose: ${STAGE_HINTS[node.stage]}` : "",
    `User context: ${JSON.stringify(context)}`,
    previous ? `Previous screen (keep the same trip, route and dates):\n${previous.slice(0, 2500)}` : "",
    utterance ? `What the user just said or did: "${utterance}" — the screen must respond to it.` : "",
    `CARRY (copy exactly into the data model under "booking"): ${JSON.stringify(carry ?? {})}`,
    `Return the JSON object now.`,
  ]
    .filter(Boolean)
    .join("\n");
}

interface ModelScreen {
  variant?: unknown;
  rationale?: unknown;
  messages?: unknown;
}

function check(out: ModelScreen, id: string, carry: Record<string, unknown>) {
  if (!out || !Array.isArray(out.messages)) {
    return { messages: [] as unknown[], a2ui: ["response has no messages array"], lint: [] as string[] };
  }
  const messages = pinSurfaceId(out.messages, id);
  const v = validateMessages(messages);
  return { messages, a2ui: v.errors, lint: v.ok ? lintBindings(messages, carry) : [] };
}

const slug = () => Math.random().toString(36).slice(2, 8);

export async function generateScreen(input: ScreenInput, opts: GenerateOptions = {}): Promise<GenerateResult> {
  if (!input?.node?.id || !input.node.stage) throw new HttpError(400, "node with id and stage is required");
  const id = opts.id ?? `${input.node.id}-${slug()}`;
  const carry = input.carry ?? {};
  const deadline = Date.now() + (opts.budgetMs ?? 55_000);
  const remaining = () => deadline - Date.now();
  const attempts: GenerateResult["attempts"] = [];
  const system = SYSTEM();
  const prompt = buildScreenPrompt(input, id);

  // 1. Primary model, falling back once on error or timeout.
  const primaryCfg = getLlmConfig("generator");
  const fallbackCfg = getLlmConfig("generatorFallback");
  let first: { data: ModelScreen; model: string; raw: string; cfg: ResolvedLlmConfig } | undefined;
  for (const cfg of [primaryCfg, fallbackCfg]) {
    const timeoutMs = Math.min(cfg === primaryCfg ? (opts.primaryTimeoutMs ?? cfg.timeoutMs) : remaining(), remaining());
    if (timeoutMs < 3000) break;
    try {
      const r = await callJson<ModelScreen>({
        model: cfg.model,
        system,
        prompt,
        temperature: cfg.temperature ?? 0.8,
        thinkingConfig: cfg.thinkingConfig,
        timeoutMs,
        retries: cfg.retries,
      });
      attempts.push({ model: cfg.model, ms: r.ms, ok: true });
      first = { ...r, cfg };
      break;
    } catch (e) {
      attempts.push({ model: cfg.model, ms: 0, ok: false, error: e instanceof TimeoutError ? "timeout" : String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  if (!first) throw new HttpError(502, "screen generation failed", attempts);

  let out = first.data;
  let usedModel = first.model;
  let res = check(out, id, carry);
  let repaired = false;

  // 2. One repair round, feeding the errors back.
  const problems = [...res.a2ui, ...res.lint];
  if (problems.length && remaining() > 8000) {
    const repairPrompt = [
      prompt,
      ``,
      `Your previous answer:`,
      first.raw.length > 24_000 ? first.raw.slice(0, 24_000) : first.raw,
      ``,
      `It has these problems:`,
      ...problems.slice(0, 25).map((p) => `- ${p}`),
      `Return the corrected full JSON object (same shape). Fix every problem; keep the layout otherwise.`,
    ].join("\n");
    try {
      const r = await callJson<ModelScreen>({
        model: usedModel,
        system,
        prompt: repairPrompt,
        temperature: first.cfg.repairTemperature ?? 0.3,
        thinkingConfig: first.cfg.thinkingConfig,
        timeoutMs: remaining(),
        retries: Math.min(2, first.cfg.retries),
      });
      attempts.push({ model: usedModel, ms: r.ms, ok: true });
      const res2 = check(r.data, id, carry);
      if (res2.a2ui.length <= res.a2ui.length) {
        out = r.data;
        res = res2;
        repaired = true;
      }
    } catch (e) {
      attempts.push({ model: usedModel, ms: 0, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }

  if (res.a2ui.length) throw new HttpError(502, "generated screen failed A2UI validation", { errors: res.a2ui, attempts });

  // 3. Carried values are a contract, not a suggestion: patch /booking if the model still drifted.
  const warnings = res.lint;
  let messages = res.messages as A2uiMessage[];
  if (warnings.some((w) => w.startsWith("data model /booking/"))) {
    const booking = { ...((getDataModel(messages).booking as Record<string, unknown>) ?? {}) };
    for (const [k, v] of Object.entries(carry)) if (v !== null && typeof v !== "object") booking[k] = v;
    messages = [...messages, { version: A2UI_VERSION, updateDataModel: { surfaceId: id, path: "/booking", value: booking } }];
    if (!validateMessages(messages).ok) messages = res.messages as A2uiMessage[];
  }

  const screen: Screen = {
    id,
    nodeId: input.node.id,
    context: input.context ?? {},
    variant: typeof out.variant === "string" && out.variant ? out.variant : "generated",
    rationale: typeof out.rationale === "string" ? out.rationale : "",
    messages,
    model: usedModel,
    createdAt: new Date().toISOString(),
    annotations: [],
  };
  return { screen, warnings, repaired, attempts };
}
