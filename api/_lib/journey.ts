// Journey simulator steps (SPEC.md): the simulated person, and the assistant that labels an intent
// and calls the deterministic fares tool. Screen generation lives in journeyScreen.ts.
import type { Screen } from "../../src/a2ui/types.js";
import { searchFares, type Fare, type FareConstraints } from "../../src/domains/flights/fares.js";
import { INTENTS, type Ingredients, type Intent, type Persona, type Query } from "../../src/journeys/types.js";
import { screenToText } from "./dataModel.js";
import { derivedTools, withConditions } from "./journeyProfiles.js";
import { callJson } from "./gemini.js";
import { getLlmConfig } from "./models.js";

export type ToolResult = Ingredients["toolResults"][number];

/** Seam for caching LLM calls (the script keys it by a hash of the prompt). */
export type JsonCaller = <T>(kind: string, opts: Parameters<typeof callJson>[0]) => Promise<{ data: T; model: string; ms: number }>;
export const directCall: JsonCaller = (_kind, opts) => callJson(opts);

export const toolCtx = (p: Persona) => ({
  origin: p.context.origin ?? "LHR",
  pax: Number(p.context.pax ?? 1) || 1,
  currency: p.context.currency ?? "EUR",
});

const fareLine = (f: Fare) =>
  `${f.flightId} ${f.airline} ${f.origin}-${f.destination} ${f.date} ${f.depart}-${f.arrive} ${f.stops ? `${f.stops} stop` : "nonstop"} ${f.pricePerPax} ${f.currency}/pax, total ${f.total}`;

// ---------------------------------------------------------------- persona

const PERSONA_SYSTEM = `You role-play a real person using a travel assistant in a chat app. Stay in character.
You see the screen the assistant just showed you as a text outline. Decide what you do next, the way this person would:
- tap something on the screen (a fare, a button), or
- type a short follow-up message (a refinement or a question), or
- abandon (the screen is confusing, too expensive, or you're out of patience).
You want to get your request booked. Booking goes: pick a fare -> review the price and pay -> booking confirmed. Seats, extras and traveler details are optional detours. Once a fare that fits is shown, pick it; once the price summary looks right, pay/confirm.
Only refer to things that are actually on the screen.
Return JSON: {"action":"tap"|"type"|"abandon","userAction":"<what you did on screen, max 12 words, e.g. \\"Tapped TP4650 £96\\" or \\"Typed: anything earlier?\\">","userMessage":"<the message the assistant receives: for a tap, describe the tap (\\"Tapped TP4650 £96\\"); for typing, the exact text>","reason":"<one short first-person sentence>"}`;

export interface PersonaReply {
  abandon: boolean;
  userAction: string;
  userMessage: string;
  reason: string;
  model: string;
  ms: number;
}

export async function personaStep(
  args: { persona: Persona; query: Query; history: string[]; screen: Screen; turnIndex: number; maxTurns: number },
  call: JsonCaller = directCall,
): Promise<PersonaReply> {
  const { persona, query, history, screen, turnIndex, maxTurns } = args;
  const prompt = [
    `Who you are: ${persona.style}`,
    `Your context: ${JSON.stringify(persona.context)}`,
    `What you asked for: "${query.text}"`,
    `Conversation so far:\n${history.slice(-10).join("\n") || "(none)"}`,
    `Screen the assistant just showed you:\n${screenToText(screen.messages, 50) || "(empty)"}`,
    `This is turn ${turnIndex + 1} of at most ${maxTurns}; you have little patience for detours.`,
  ].join("\n\n");
  const simCfg = getLlmConfig("simulator");
  const r = await call<{ action?: unknown; userAction?: unknown; userMessage?: unknown; reason?: unknown }>("persona", {
    model: simCfg.model,
    system: PERSONA_SYSTEM,
    prompt,
    temperature: simCfg.temperature ?? 0.9,
    thinkingConfig: simCfg.thinkingConfig,
    timeoutMs: Math.max(simCfg.timeoutMs, 30_000),
    retries: Math.max(simCfg.retries, 6),
  });
  const d = r.data ?? {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const abandon = d.action === "abandon";
  const userAction = str(d.userAction, 140) || (abandon ? "Closed the chat" : str(d.userMessage, 140));
  const userMessage = str(d.userMessage, 240) || userAction;
  return { abandon, userAction, userMessage, reason: str(d.reason, 240), model: r.model, ms: r.ms };
}

// ---------------------------------------------------------------- assistant

const ASSISTANT_SYSTEM = `You are the planning step of a flight-booking assistant. You do not write the reply; you decide what the user is trying to do and which tool arguments to use.
Intents (pick exactly one): ${INTENTS.join(", ")}.
- search: a new flight search. refine: change filters on the current search (time window, date, stops, budget, sort). compare: weigh fares against each other. select: the user picked a specific fare.
- seats / extras / passengers: those booking steps. pay: the user wants to proceed to payment / review the price (e.g. taps Continue / Checkout). confirm: the user commits to pay/book a fare that is already chosen (e.g. taps Pay, Book now, Confirm booking on a payment or summary screen).
- question: a question that doesn't change the search. other: none of these.
Tool: searchFares(constraints). Constraint keys: destination (IATA), month ("YYYY-MM"), date ("YYYY-MM-DD"), departAfter / departBefore ("HH:MM", 24h), maxStops (number), maxPricePerPax (number), sort ("price"|"depart"|"duration").
To drop a constraint (e.g. "without the cap", "any time"), set that key to null in refine; destination can't be dropped.
Return JSON: {"intent":"<one intent>","refine":{<only constraint keys that change (null = remove), or {} >},"selectFlightId":"<flight id from the fares shown, if the user picked one, else null>","reason":"<short>"}`;

export interface PlanInput {
  query: Query;
  persona: Persona;
  turnIndex: number;
  userMessage: string;
  history: string[];
  constraints: FareConstraints;
  /** Every fare the tool has returned in this journey so far (for resolving picks). */
  seenFares: Fare[];
  carry: Record<string, unknown>;
  /** gen-v2: enrich fares with conditions and add the profile's derived tool entries (cheapest by day, nonstop). */
  profileAware?: boolean;
}

export interface PlanResult {
  intent: Intent;
  constraints: FareConstraints;
  toolResults: ToolResult[];
  carry: Record<string, unknown>;
  ms: number;
  model: string;
}

const REFINE_KEYS = ["destination", "month", "date", "departAfter", "departBefore", "maxStops", "maxPricePerPax", "sort"] as const;
const HHMM = /^\d{2}:\d{2}$/;

/** Keys the planner asked to drop (null in refine). */
function removedKeys(raw: unknown): (typeof REFINE_KEYS)[number][] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  return REFINE_KEYS.filter((k) => k !== "destination" && k in r && r[k] === null);
}

function cleanRefine(raw: unknown): Partial<FareConstraints> {
  const out: Partial<FareConstraints> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of REFINE_KEYS) {
    const v = r[k];
    if (v === undefined || v === null || v === "") continue;
    if ((k === "departAfter" || k === "departBefore") && typeof v === "string" && HHMM.test(v)) out[k] = v;
    else if (k === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out.date = v;
    else if (k === "month" && typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) out.month = v;
    else if (k === "destination" && typeof v === "string" && /^[A-Z]{3}$/.test(v)) out.destination = v;
    else if ((k === "maxStops" || k === "maxPricePerPax") && Number.isFinite(Number(v))) out[k] = Number(v);
    else if (k === "sort" && (v === "price" || v === "depart" || v === "duration")) out.sort = v;
  }
  return out;
}

export function fareCarry(f: Fare): Record<string, unknown> {
  return {
    flightId: f.flightId,
    date: f.date,
    depart: f.depart,
    arrive: f.arrive,
    total: f.total,
    pricePerPax: f.pricePerPax,
    currency: f.currency,
    pax: f.pax,
  };
}

function bookingRef(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return `FK${(h >>> 0).toString(36).toUpperCase().slice(0, 5).padEnd(5, "0")}`;
}

const SEARCHING: Intent[] = ["search", "refine", "compare", "question", "other"];

export async function planTurn(input: PlanInput, journeyId: string, call: JsonCaller = directCall): Promise<PlanResult> {
  const { query, persona, turnIndex, userMessage, history, seenFares, carry } = input;
  const ctx = toolCtx(persona);
  const prompt = [
    `Original request: "${query.text}"`,
    `Traveler context: ${JSON.stringify(persona.context)}`,
    `Constraints in effect: ${JSON.stringify(input.constraints)}`,
    `Conversation so far:\n${history.slice(-10).join("\n") || "(none — this is the first message)"}`,
    seenFares.length ? `Fares already shown:\n${seenFares.slice(-16).map(fareLine).join("\n")}` : "",
    `Chosen fare so far: ${carry.flightId ? JSON.stringify(carry) : "none"}`,
    `User message now: "${userMessage}"`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const asstCfg = getLlmConfig("journeyAssistant");
  const r = await call<{ intent?: unknown; refine?: unknown; selectFlightId?: unknown }>("assistant", {
    model: asstCfg.model,
    system: ASSISTANT_SYSTEM,
    prompt,
    temperature: asstCfg.temperature ?? 0.2,
    thinkingConfig: asstCfg.thinkingConfig,
    timeoutMs: asstCfg.timeoutMs,
    retries: asstCfg.retries,
  });
  const d = r.data ?? {};
  let intent: Intent = (INTENTS as readonly string[]).includes(String(d.intent)) ? (d.intent as Intent) : "other";
  if (turnIndex === 0 && !["search", "refine", "question", "compare"].includes(intent)) intent = "search";

  // Resolve a picked fare against fares the tool really returned (never trust a model-made id).
  const byId = (id: string) => [...seenFares].reverse().find((f) => f.flightId.toUpperCase() === id.toUpperCase());
  let picked = typeof d.selectFlightId === "string" && d.selectFlightId ? byId(d.selectFlightId) : undefined;
  if (!picked) {
    const m = userMessage.toUpperCase().match(/\b[A-Z0-9]{2}\d{3,4}\b/g) ?? [];
    for (const id of m) picked = picked ?? byId(id);
  }

  // Turn 0 searches with the query's machine-readable constraints (the oracle's parse), not a re-parse.
  const refine = turnIndex === 0 ? {} : cleanRefine(d.refine);
  const removed = turnIndex === 0 ? [] : removedKeys(d.refine).filter((k) => input.constraints[k] !== undefined);
  let constraints = input.constraints;
  let nextCarry = { ...carry };
  const toolResults: ToolResult[] = [];

  if (picked && picked.flightId !== carry.flightId) {
    nextCarry = { ...nextCarry, ...fareCarry(picked) };
    delete nextCarry.bookingRef;
    if (!["select", "pay", "confirm", "seats", "extras", "passengers"].includes(intent)) intent = "select";
  }
  if (intent === "confirm" && !nextCarry.flightId) intent = "question";

  const search = () => {
    const fares = searchFares(constraints, ctx);
    toolResults.push({ tool: "searchFares", args: { ...constraints }, fares });
    if (input.profileAware) toolResults.push(...derivedTools(persona.id, constraints, ctx));
  };

  if (turnIndex === 0 || Object.keys(refine).length || removed.length) {
    constraints = { ...constraints, ...refine };
    for (const k of removed) delete constraints[k];
    search();
    if (intent === "select" && !picked) intent = Object.keys(refine).length || removed.length ? "refine" : "search";
  } else if (picked) {
    toolResults.push({ tool: "getFare", args: { flightId: picked.flightId, date: picked.date }, fares: [picked] });
  } else if (SEARCHING.includes(intent) || !nextCarry.flightId) {
    search();
  }

  // gen-v2 screens need the chosen fare's conditions (bags, flexibility, perks) on every booking step.
  if (input.profileAware && !toolResults.length && typeof nextCarry.flightId === "string") {
    const chosen = byId(nextCarry.flightId);
    if (chosen) toolResults.push({ tool: "getFare", args: { flightId: chosen.flightId, date: chosen.date }, fares: [chosen] });
  }
  if (intent === "confirm") nextCarry.bookingRef = bookingRef(`${journeyId}:${nextCarry.flightId}`);
  const results = input.profileAware ? toolResults.map((t) => ({ ...t, fares: t.fares.map(withConditions) })) : toolResults;
  return { intent, constraints, toolResults: results, carry: nextCarry, ms: r.ms, model: r.model };
}
