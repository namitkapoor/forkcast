// Journey screens: generate an A2UI v0.9 screen from the turn's Ingredients only, or (pinned mode)
// reuse a pinned screen's component tree and refill just its data model from fresh tool results.
import { A2UI_VERSION, BASIC_CATALOG_ID, DECISION_SOURCES, type A2uiMessage, type DecisionSource, type Screen, type ScreenDecision } from "../../src/a2ui/types.js";
import { catalogPromptSummary, validateMessages } from "../../src/a2ui/validate.js";
import type { Ingredients, Intent } from "../../src/journeys/types.js";
import { getAt, getComponents, getDataModel, lintBindings, pinSurfaceId } from "./dataModel.js";
import { HttpError, TimeoutError } from "./gemini.js";
import { directCall, type JsonCaller } from "./journey.js";
import { models } from "./models.js";

/** Current generator prompt: grounded and tailored to what the assistant knows about the traveler. */
export const GEN_PROMPT_VERSION = "gen-v2";
/** Grounded but context-only (pax, surface, currency): every persona gets the same layout with different numbers. */
export const GEN_V1_PROMPT_VERSION = "gen-v1";
export const PIN_PROMPT_VERSION = "pin-v1";
/** Naive baseline, like typical gen-UI apps: summarized tool results, no time/date carry, no grounding rule. */
export const BASELINE_PROMPT_VERSION = "gen-v0";
export type GenPromptVersion = typeof GEN_PROMPT_VERSION | typeof GEN_V1_PROMPT_VERSION | typeof BASELINE_PROMPT_VERSION;
export const PROMPT_VERSIONS: GenPromptVersion[] = [GEN_PROMPT_VERSION, GEN_V1_PROMPT_VERSION, BASELINE_PROMPT_VERSION];

export interface JourneyScreenInput {
  id: string;
  intent: Intent;
  userMessage: string;
  ingredients: Ingredients;
}

export interface JourneyScreenResult {
  screen: Screen;
  warnings: string[];
  repaired: boolean;
  attempts: { model: string; ms: number; ok: boolean; error?: string }[];
}

const INTENT_HINTS: Record<Intent, string> = {
  search: "Search results: the matching fares from the tool results, best match first, each pickable.",
  refine: "Updated results after the user changed a filter: say what changed, show the new fares, each pickable.",
  compare: "A side-by-side comparison of 2-3 fares from the tool results.",
  select: "The chosen fare's details (from CARRY). Primary action: continue to payment; seats/extras are optional secondary actions.",
  seats: "Seat options for every traveler on the chosen fare. Do not invent seat prices. Primary action: continue to payment.",
  extras: "Bags and extras for the chosen fare. Do not invent fees: offer choices without amounts unless a tool returned them. Primary action: continue to payment.",
  passengers: "Traveler details forms, one per passenger (pax). Primary action: continue to payment.",
  pay: "Price review and payment for the chosen fare, total in the user's currency, from CARRY. Primary action: pay and confirm the booking.",
  confirm: "Booking confirmed: the booking reference from CARRY, itinerary summary, next steps.",
  question: "Answer the user's question briefly using only the ingredients, then offer the next step.",
  other: "Respond to the user and offer the most sensible next step.",
};

export const JOURNEY_SYSTEM = () => `You design one screen of a flight-booking assistant that appears in a chat. You output A2UI v0.9 JSON using ONLY the basic catalog below.

${catalogPromptSummary()}

You build the screen from the INGREDIENTS ONLY: context, history, the user message, TOOL RESULTS (fares returned by the fares tool, verbatim) and CARRY (the fare the user already chose).

Rules (all required):
1. Output one JSON object: {"variant": "<short-kebab-layout-name>", "rationale": "<one sentence: why this layout fits THIS user's context and message>", "messages": [ ...A2UI messages... ]}.
2. messages = exactly: createSurface (catalogId "${BASIC_CATALOG_ID}"), then ONE updateComponents, then ONE updateDataModel with path "/" holding the whole data model. Use the surfaceId you are given everywhere. The root component id is "root".
3. GROUNDING: every flight number, airline, date, time, stop count and price on screen must come from TOOL RESULTS or CARRY, copied exactly. Never invent or adjust a time, price, flight number, seat number, fee or baggage allowance. If the ingredients don't contain a number, don't show one.
4. Every dynamic value lives in the data model and is bound with {"path": "/..."}. Never hard-code a price, time or flight id in component props. Put display-ready strings in the model (e.g. "priceLabel": "€1,284") next to the raw values copied from the tool results.
5. The data model MUST contain "booking": an object with every CARRY value copied exactly (same keys, same types: numbers stay numbers), plus display labels next to them (e.g. booking.totalLabel).
6. Fares go in the data model as an array ("fares") rendered with a ChildList template; keep each fare's flightId, depart, arrive, date, stops, pricePerPax and total exactly as the tool returned them.
7. At most one Button with variant "primary". Button actions use {"event":{"name":"camelCase","context":{...}}} and pass bound values in context (e.g. {"flightId":{"path":"flightId"}} inside a fare template).
8. Let the context drive the layout:
   - surface "inline": a compact chat card. Root is a Card. 3-8 visible items, short lines, one clear next action.
   - surface "fullscreen": a full sheet. Root is a Column with a header (h2 + caption), grouped sections, details the inline card would omit, primary action at the bottom.
   - party "family"/"couple": per-traveler AND total amounts, traveler count prominent. party "solo": speed first, times prominent.
   - currency: format all amounts in it.
9. Keep it under ~40 components.`;

/** gen-v0 system: identical to gen-v1 minus the grounding rule and the verbatim-fares instruction. */
export const JOURNEY_SYSTEM_V0 = () =>
  JOURNEY_SYSTEM()
    .replace(
      "You build the screen from the INGREDIENTS ONLY: context, history, the user message, TOOL RESULTS (fares returned by the fares tool, verbatim) and CARRY (the fare the user already chose).",
      "You get the user's context, the conversation history, the user message, a summary of what the fares tool found, and CARRY (the fare the user already chose).",
    )
    .replace(/\n3\. GROUNDING:[^\n]*/, "")
    .replace(/\n6\. Fares go in the data model[^\n]*/, "\n6. Fares go in the data model as an array (\"fares\") rendered with a ChildList template.");

const V0_CARRY_KEYS = ["flightId", "total", "currency", "pax", "bookingRef"];
/** gen-v0 carries only the fare id and money, not times or dates. */
export const baselineCarry = (carry: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(carry).filter(([k]) => V0_CARRY_KEYS.includes(k)));

export function buildBaselinePrompt(input: JourneyScreenInput): string {
  const { id, intent, userMessage, ingredients: ing } = input;
  const fares = ing.toolResults.flatMap((t) => t.fares).slice(0, 3);
  return [
    `surfaceId: "${id}"`,
    `Intent: ${intent}. Screen purpose: ${INTENT_HINTS[intent]}`,
    `CONTEXT: ${JSON.stringify(ing.context)}`,
    `HISTORY:\n${ing.history.length ? ing.history.join("\n") : "(first turn)"}`,
    `USER MESSAGE: "${userMessage}" — the screen must respond to it.`,
    `FARES FOUND (summary): ${fares.length ? fares.map((f) => `${f.flightId} ${f.airline} ${f.total} ${f.currency}`).join("; ") : "(no search this turn)"}`,
    `CARRY (copy exactly into the data model under "booking"): ${JSON.stringify(baselineCarry(ing.carry))}`,
    `Return the JSON object now.`,
  ].join("\n\n");
}

export function buildJourneyPrompt(input: JourneyScreenInput): string {
  const { id, intent, userMessage, ingredients: ing } = input;
  return [
    `surfaceId: "${id}"`,
    `Intent: ${intent}. Screen purpose: ${INTENT_HINTS[intent]}`,
    `CONTEXT: ${JSON.stringify(ing.context)}`,
    `HISTORY:\n${ing.history.length ? ing.history.join("\n") : "(first turn)"}`,
    `USER MESSAGE: "${userMessage}" — the screen must respond to it.`,
    `TOOL RESULTS (verbatim):\n${ing.toolResults.length ? JSON.stringify(ing.toolResults) : "(no tool was called this turn)"}`,
    `CARRY (copy exactly into the data model under "booking"): ${JSON.stringify(ing.carry)}`,
    `Return the JSON object now.`,
  ].join("\n\n");
}

// ---------------------------------------------------------------- gen-v2: tailored to the traveler

/** gen-v2 system: gen-v1's rules, plus a profile the screen must be designed around. */
export const JOURNEY_SYSTEM_V2 = () =>
  JOURNEY_SYSTEM()
    .replace(
      /\n1\. Output one JSON object:[^\n]*/,
      `
1. Output one JSON object: {"variant": "<short-kebab-layout-name>", "rationale": "<ONE plain sentence tying the layout to this person, e.g. \\"Leads with seating and the total for 4 because the family is flying with two kids.\\">", "decisions": [{"componentId": "<id of a component in your updateComponents>", "because": "<max 10 words: the reason, e.g. \\"must sit together with two kids\\">", "source": "query"|"memory"|"context"|"tool"|"carry"|"history"}], "messages": [ ...A2UI messages... ]}. decisions cover the 3-6 most important components and name the ingredient that drove each one: memory (ASSISTANT MEMORY), query or history (what the user asked), context (surface, currency, pax), tool (TOOL RESULTS), carry (the chosen fare). Give such components meaningful ids (e.g. "seat_banner", "days_strip", "arrival_col").`,
    )
    .replace(
      "You build the screen from the INGREDIENTS ONLY: context, history, the user message, TOOL RESULTS (fares returned by the fares tool, verbatim) and CARRY (the fare the user already chose).",
      `You build the screen from the INGREDIENTS ONLY: context, history, the user message, TOOL RESULTS (fares returned by the fares tool, verbatim, each with its fare conditions: cabinBag, checkedBag, refundable, changes, seatSelection, familySeating, statusPerks; a "cheapestByDay" entry, when present, is the cheapest matching fare on each searched day (args.days), so call it "cheapest of the searched days", not of the whole month), CARRY (the fare the user already chose) and the ASSISTANT MEMORY (what you already know about this traveler from past trips and this conversation).

You are a personal assistant, not a search engine. Two people asking the same question must get DIFFERENT screens, because they care about different things. Design this screen around the ASSISTANT MEMORY:
- Decide WHAT to show from the traveler's priorities, not just how to format it: pick components, ordering, groupings and comparisons that answer each priority directly. Each top priority gets its own visible element (a dedicated row, badge, section, strip, column or callout) that a different traveler would not get.
- Lead with what matters most to this traveler; drop details they don't care about.
- Sort and compare by what they care about (e.g. nonstop and arrival time for someone with meetings; the true total for someone counting every pound; seating together for a family).
- Name the trade-off this traveler would weigh, using only facts from the ingredients.
- Mention the memory naturally where it helps ("4 seats together", "carry-on only"), never as a profile dump.`,
    )
    .replace(
      /\n3\. GROUNDING:[^\n]*/,
      `
3. GROUNDING: every flight number, airline, date, time, stop count and price on screen must come from TOOL RESULTS, CARRY or the ASSISTANT MEMORY, copied exactly. The ONLY numbers you may derive: a total (copy "total"), a per-person or per-child price (copy "pricePerPax", which equals total / travelers), and counts (number of travelers, bags, fares). Never compute a difference, a saving, a duration or a fee. Fare conditions are facts too: state them as given (e.g. "checked bag: not included (extra fee)") and never put an amount on a fee, bag or seat. If a fare has no data for something the traveler cares about, say so plainly instead of guessing.`,
    )
    .replace(
      /\n   - party "family"\/"couple":[^\n]*/,
      `
   - the ASSISTANT MEMORY decides the content and emphasis (rule above); party and pax only set the counts.`,
    );

export function buildJourneyPromptV2(input: JourneyScreenInput): string {
  const { id, intent, userMessage, ingredients: ing } = input;
  const { profile, ...carry } = ing.carry;
  return [
    `surfaceId: "${id}"`,
    `Intent: ${intent}. Screen purpose: ${INTENT_HINTS[intent]}`,
    `CONTEXT: ${JSON.stringify(ing.context)}`,
    `ASSISTANT MEMORY (what you know about this traveler; design the screen around it):\n${profile ? JSON.stringify(profile, null, 1) : "(nothing known)"}`,
    `HISTORY:\n${ing.history.length ? ing.history.join("\n") : "(first turn)"}`,
    `USER MESSAGE: "${userMessage}" — the screen must respond to it.`,
    `TOOL RESULTS (verbatim):\n${ing.toolResults.length ? JSON.stringify(ing.toolResults) : "(no tool was called this turn)"}`,
    `CARRY (copy exactly into the data model under "booking"): ${JSON.stringify(carry)}`,
    `Return the JSON object now.`,
  ].join("\n\n");
}

/** CARRY minus the profile: the profile is memory, not a booking field. */
const bookingCarry = (carry: Record<string, unknown>) => {
  const { profile: _p, ...rest } = carry;
  return rest;
};

interface ModelScreen {
  variant?: unknown;
  rationale?: unknown;
  decisions?: unknown;
  messages?: unknown;
}

function check(out: ModelScreen, id: string, carry: Record<string, unknown>) {
  if (!out || !Array.isArray(out.messages)) return { messages: [] as unknown[], a2ui: ["response has no messages array"], lint: [] as string[] };
  const messages = pinSurfaceId(out.messages, id);
  const v = validateMessages(messages);
  return { messages, a2ui: v.errors, lint: v.ok ? lintBindings(messages, carry) : [] };
}

/** Decisions whose componentId exists on the screen, with a known source; at most 6. */
export function cleanDecisions(raw: unknown, messages: unknown[]): ScreenDecision[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(getComponents(messages).map((c) => String(c.id)));
  const out: ScreenDecision[] = [];
  const seen = new Set<string>();
  for (const d of raw) {
    if (!isObj(d)) continue;
    const componentId = typeof d.componentId === "string" ? d.componentId.trim() : "";
    const because = typeof d.because === "string" ? d.because.trim().slice(0, 120) : "";
    const source = String(d.source) as DecisionSource;
    if (!ids.has(componentId) || !because || !DECISION_SOURCES.includes(source) || seen.has(componentId)) continue;
    seen.add(componentId);
    out.push({ componentId, because, source });
  }
  return out.slice(0, 6);
}

/** One plain sentence: drop markdown and anything after the first sentence. */
const oneSentence = (s: string) => {
  const t = s.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  const m = t.match(/^.+?[.!?](?=\s|$)/);
  return (m ? m[0] : t).slice(0, 240);
};

/** Carried values are a contract: if /booking still drifted, patch it with an extra updateDataModel. */
function patchBooking(messages: A2uiMessage[], id: string, carry: Record<string, unknown>, warnings: string[]): A2uiMessage[] {
  if (!warnings.some((w) => w.startsWith("data model /booking/"))) return messages;
  const booking = { ...((getDataModel(messages).booking as Record<string, unknown>) ?? {}) };
  for (const [k, v] of Object.entries(carry)) if (v !== null && typeof v !== "object") booking[k] = v;
  const patched = [...messages, { version: A2UI_VERSION, updateDataModel: { surfaceId: id, path: "/booking", value: booking } }];
  return validateMessages(patched).ok ? patched : messages;
}

export async function generateJourneyScreen(
  input: JourneyScreenInput,
  opts: { budgetMs?: number; primaryTimeoutMs?: number; call?: JsonCaller; promptVersion?: GenPromptVersion } = {},
): Promise<JourneyScreenResult> {
  const call = opts.call ?? directCall;
  const { id } = input;
  const version = opts.promptVersion ?? GEN_PROMPT_VERSION;
  const v0 = version === BASELINE_PROMPT_VERSION;
  const v2 = version === GEN_PROMPT_VERSION;
  const carry = v0 ? baselineCarry(input.ingredients.carry) : bookingCarry(input.ingredients.carry);
  const deadline = Date.now() + (opts.budgetMs ?? 180_000);
  const remaining = () => deadline - Date.now();
  const attempts: JourneyScreenResult["attempts"] = [];
  const system = v0 ? JOURNEY_SYSTEM_V0() : v2 ? JOURNEY_SYSTEM_V2() : JOURNEY_SYSTEM();
  const prompt = v0 ? buildBaselinePrompt(input) : v2 ? buildJourneyPromptV2(input) : buildJourneyPrompt(input);

  let first: { data: ModelScreen; model: string } | undefined;
  for (const model of [models.generator, models.generatorFallback]) {
    const timeoutMs = Math.min(model === models.generator ? (opts.primaryTimeoutMs ?? 75_000) : remaining(), remaining());
    if (timeoutMs < 3000) break;
    try {
      const r = await call<ModelScreen>("generator", { model, system, prompt, temperature: 0.8, timeoutMs, retries: 5 });
      attempts.push({ model, ms: r.ms, ok: true });
      first = r;
      break;
    } catch (e) {
      attempts.push({ model, ms: 0, ok: false, error: e instanceof TimeoutError ? "timeout" : String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  if (!first) throw new HttpError(502, "screen generation failed", attempts);

  let out = first.data;
  const usedModel = first.model;
  let res = check(out, id, carry);
  let repaired = false;

  for (let round = 0; round < 2; round++) {
    const problems = [...res.a2ui, ...res.lint];
    if (!problems.length || remaining() < 8000) break;
    const raw = JSON.stringify(out);
    const repairPrompt = [
      prompt,
      ``,
      `Your previous answer:`,
      raw.length > 24_000 ? raw.slice(0, 24_000) : raw,
      ``,
      `It has these problems:`,
      ...problems.slice(0, 25).map((p) => `- ${p}`),
      `Return the corrected full JSON object (same shape). Fix every problem; keep the layout otherwise.`,
    ].join("\n");
    try {
      const r = await call<ModelScreen>("generator-repair", { model: usedModel, system, prompt: repairPrompt, temperature: 0.3, timeoutMs: remaining(), retries: 3 });
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
    if (!res.a2ui.length) break; // valid; leftover lint is patched or reported below
  }
  if (res.a2ui.length) throw new HttpError(502, "generated screen failed A2UI validation", { errors: res.a2ui, attempts });

  const messages = patchBooking(res.messages as A2uiMessage[], id, carry, res.lint);
  const screen: Screen = {
    id,
    nodeId: input.intent,
    context: input.ingredients.context,
    variant: typeof out.variant === "string" && out.variant ? out.variant : "generated",
    rationale: typeof out.rationale === "string" ? (v2 ? oneSentence(out.rationale) : out.rationale) : "",
    messages,
    model: usedModel,
    createdAt: new Date().toISOString(),
    annotations: [],
  };
  if (v2) {
    const decisions = cleanDecisions(out.decisions, messages);
    if (decisions.length) screen.decisions = decisions;
  }
  return { screen, warnings: res.lint, repaired, attempts };
}

// ---------------------------------------------------------------- pinned mode

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Binding paths used by a component tree: absolute ones, and list templates (path → item-relative paths). */
export function bindingPaths(components: Obj[]): { absolute: string[]; lists: { path: string; itemPaths: string[] }[] } {
  const byId = new Map(components.map((c) => [String(c.id), c]));
  const absolute = new Set<string>();
  const lists = new Map<string, Set<string>>();
  const collect = (v: unknown, into: (p: string) => void) => {
    if (Array.isArray(v)) v.forEach((x) => collect(x, into));
    else if (isObj(v)) {
      if (typeof v.path === "string" && !("componentId" in v)) into(v.path);
      else for (const x of Object.values(v)) collect(x, into);
    }
  };
  const walk = (id: string, scope: string | null, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    const c = byId.get(id);
    if (!c) return;
    for (const [k, v] of Object.entries(c)) {
      if (k === "id" || k === "component" || k === "children" || k === "child") continue;
      collect(v, (p) => {
        if (p.startsWith("/") || scope === null) absolute.add(p.startsWith("/") ? p : `/${p}`);
        else lists.get(scope)!.add(p);
      });
    }
    if (typeof c.child === "string") walk(c.child, scope, seen);
    const ch = c.children;
    if (Array.isArray(ch)) ch.forEach((k) => typeof k === "string" && walk(k, scope, seen));
    else if (isObj(ch) && typeof ch.componentId === "string" && typeof ch.path === "string") {
      const lp = ch.path.startsWith("/") ? ch.path : `/${ch.path}`;
      if (!lists.has(lp)) lists.set(lp, new Set());
      walk(ch.componentId, lp, new Set(seen));
    }
    if (Array.isArray(c.tabs)) for (const t of c.tabs) if (isObj(t) && typeof t.child === "string") walk(t.child, scope, seen);
  };
  walk("root", null, new Set());
  return { absolute: [...absolute], lists: [...lists].map(([path, s]) => ({ path, itemPaths: [...s] })) };
}

function unresolved(components: Obj[], model: Obj): string[] {
  const { absolute, lists } = bindingPaths(components);
  const out: string[] = [];
  for (const p of absolute) if (getAt(model, p) === undefined) out.push(`binding ${p} has no value in the data model`);
  for (const l of lists) {
    const arr = getAt(model, l.path);
    if (!Array.isArray(arr)) out.push(`list ${l.path} must be an array`);
    else if (arr.length && isObj(arr[0])) for (const ip of l.itemPaths) if (getAt(arr[0], ip) === undefined) out.push(`items of ${l.path} need "${ip}"`);
  }
  return out;
}

const PIN_SYSTEM = `You fill the data model of an existing, fixed A2UI v0.9 screen. You do NOT change the layout.
You get the screen's component tree, every binding path it reads, an example of its old data model (for shape only: its values are stale), and the fresh ingredients (TOOL RESULTS and CARRY).
Produce the new data model so every binding resolves:
- Every flight number, time, date, stop count and price must be copied exactly from TOOL RESULTS or CARRY. Never reuse a stale value from the old model and never invent one. Display labels (e.g. "€96") must format those exact values in the user's currency.
- "booking" holds every CARRY value copied exactly (same keys, same types), plus labels.
- List bindings are arrays; fill them from the tool results (keep the item shape the template reads).
- Text that isn't a fact (headings, short copy) may be adapted to the user message, briefly.
Return JSON: {"value": { ...the whole data model... }}`;

export async function fillPinnedScreen(
  input: JourneyScreenInput & { pinned: Screen },
  opts: { call?: JsonCaller } = {},
): Promise<JourneyScreenResult> {
  const call = opts.call ?? directCall;
  const { id, pinned, ingredients: ing } = input;
  const components = getComponents(pinned.messages).map((c) => structuredClone(c));
  const paths = bindingPaths(components);
  const oldModel = getDataModel(pinned.messages);
  const base: A2uiMessage[] = [
    { version: A2UI_VERSION, createSurface: { surfaceId: id, catalogId: BASIC_CATALOG_ID } },
    { version: A2UI_VERSION, updateComponents: { surfaceId: id, components } },
  ];
  const prompt = [
    `Intent: ${input.intent}. CONTEXT: ${JSON.stringify(ing.context)}`,
    `USER MESSAGE: "${input.userMessage}"`,
    `COMPONENTS (fixed):\n${JSON.stringify(components).slice(0, 14_000)}`,
    `BINDINGS: absolute ${JSON.stringify(paths.absolute)}; lists ${JSON.stringify(paths.lists)}`,
    `OLD DATA MODEL (shape only, stale values):\n${JSON.stringify(oldModel).slice(0, 6000)}`,
    `TOOL RESULTS (verbatim):\n${ing.toolResults.length ? JSON.stringify(ing.toolResults) : "(no tool was called this turn)"}`,
    `CARRY: ${JSON.stringify(ing.carry)}`,
  ].join("\n\n");

  const attempts: JourneyScreenResult["attempts"] = [];
  let problems: string[] = [];
  let best: { messages: A2uiMessage[]; lint: string[] } | undefined;
  let feedback = "";
  for (let round = 0; round < 3 && !best; round++) {
    const r = await call<{ value?: unknown }>("pin-fill", {
      model: models.pinFill,
      system: PIN_SYSTEM,
      prompt: feedback ? `${prompt}\n\nYour previous data model had these problems:\n${feedback}\nReturn the corrected JSON.` : prompt,
      temperature: round ? 0.2 : 0.4,
      timeoutMs: 45_000,
      retries: 5,
    });
    attempts.push({ model: r.model, ms: r.ms, ok: true });
    const value = isObj(r.data?.value) ? r.data.value : isObj(r.data) ? (r.data as Obj) : {};
    const messages: A2uiMessage[] = [...base, { version: A2UI_VERSION, updateDataModel: { surfaceId: id, path: "/", value } }];
    const v = validateMessages(messages);
    const lint = v.ok ? lintBindings(messages, bookingCarry(ing.carry)) : [];
    const missing = v.ok ? unresolved(components, value) : [];
    problems = [...v.errors, ...lint.filter((l) => l.startsWith("data model")), ...missing];
    if (v.ok && !missing.length) best = { messages, lint };
    else feedback = problems.slice(0, 20).map((p) => `- ${p}`).join("\n");
  }
  if (!best) throw new HttpError(502, "pinned fill failed", { errors: problems, attempts });

  const messages = patchBooking(best.messages, id, bookingCarry(ing.carry), best.lint);
  const screen: Screen = {
    id,
    nodeId: input.intent,
    context: ing.context,
    variant: pinned.variant,
    rationale: `Pinned layout from ${pinned.id}; data refilled from this turn's tool results.`,
    messages,
    model: models.pinFill,
    createdAt: new Date().toISOString(),
    annotations: [],
  };
  // Same component tree, so the pinned screen's reasons still point at real components.
  const decisions = cleanDecisions(pinned.decisions, messages);
  if (decisions.length) screen.decisions = decisions;
  return { screen, warnings: best.lint, repaired: attempts.length > 1, attempts };
}

/**
 * A pinned layout is only safe when this turn's tool results have the same shape as the ones it was built
 * from: same tools, and fares where it had fares (an empty search must not fill a results layout with "$0").
 * Returns why the pin should be skipped, or undefined when it fits.
 */
export function pinShapeMismatch(evidence: Ingredients | undefined, fresh: Ingredients): string | undefined {
  if (!evidence) return undefined;
  const shape = (ing: Ingredients) => {
    const m = new Map<string, number>();
    for (const t of ing.toolResults) m.set(t.tool, (m.get(t.tool) ?? 0) + t.fares.length);
    return m;
  };
  const a = shape(evidence);
  const b = shape(fresh);
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  if (total(a) > 0 && total(b) === 0) return "empty results";
  if (total(a) === 0 && total(b) > 0) return "results where the pinned screen had none";
  for (const [tool, n] of a) {
    if (!b.has(tool)) return `no ${tool} results`;
    if (n > 0 && b.get(tool) === 0) return `empty ${tool} results`;
  }
  for (const tool of b.keys()) if (!a.has(tool)) return `extra ${tool} results`;
  if (Boolean(evidence.carry.flightId) !== Boolean(fresh.carry.flightId)) return fresh.carry.flightId ? "a chosen fare the pinned screen lacks" : "no chosen fare";
  return undefined;
}
