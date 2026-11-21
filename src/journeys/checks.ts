// Journey checks: grounding, carry-over, schema and the goal oracle.
// Pure TypeScript, no DOM: runs in the browser, in scripts and on the server.
import type { Screen } from "../a2ui/types.js";
import { bestFare, type Fare } from "../domains/flights/fares.js";
import { checkPersonaRules } from "./personaContracts.js";
import type { CheckKind, CheckResult, Journey, Persona, Query, Turn } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type FactKind = "price" | "time" | "flight" | "date";
export interface Fact {
  componentId: string;
  kind: FactKind;
  /** Normalized: price "1284 EUR", time "09:15", flight "TP1353", date "03-14" (MM-DD). */
  value: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// Reading an A2UI v0.9 message stream

function pointerParts(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getAt(root: unknown, parts: string[]): unknown {
  let cur: unknown = root;
  for (const p of parts) {
    if (Array.isArray(cur)) cur = cur[Number(p)];
    else if (isObj(cur)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function dataModel(messages: unknown[]): unknown {
  let model: unknown = {};
  for (const m of messages) {
    if (!isObj(m) || !isObj(m.updateDataModel)) continue;
    const u = m.updateDataModel;
    const parts = typeof u.path === "string" ? pointerParts(u.path) : [];
    if (!parts.length) {
      model = u.value;
      continue;
    }
    if (!isObj(model) && !Array.isArray(model)) model = {};
    let cur = model as Obj;
    for (const p of parts.slice(0, -1)) {
      if (!isObj(cur[p]) && !Array.isArray(cur[p])) cur[p] = {};
      cur = cur[p] as Obj;
    }
    cur[parts[parts.length - 1]] = u.value;
  }
  return model;
}

function componentList(messages: unknown[]): Obj[] {
  const byId = new Map<string, Obj>();
  for (const m of messages) {
    if (isObj(m) && isObj(m.updateComponents) && Array.isArray(m.updateComponents.components)) {
      for (const c of m.updateComponents.components) if (isObj(c) && typeof c.id === "string") byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

export function componentCount(screen: Screen): number {
  return componentList(screen.messages ?? []).length;
}

/** Props whose (resolved) value is shown to the person. Action contexts and icon names are not. */
const TEXT_PROPS = ["text", "label", "title", "value", "placeholder", "description", "hint", "caption"];

export interface Shown {
  componentId: string;
  text: string;
  /** Rendered instances from the root down to this component: "id" or "id@/fares/2" inside list templates. */
  path: string[];
  /** Catalog component type ("Text", "CheckBox"…). */
  component?: string;
  /** Set for on/off state (CheckBox, Switch): text is "[on]" or "[off]". */
  toggle?: boolean;
}

/**
 * A text digest of what a screen shows, for an LLM judge: one line per rendered text, in reading order,
 * "componentId (Type): text", with list-template instances marked "[item 2]" and toggles as [on]/[off].
 */
export function screenDigest(screen: Screen, maxLines = 160): string {
  const lines = displayedText(screen).map((s) => {
    const item = /@\/.*\/(\d+)$/.exec(s.path[s.path.length - 1] ?? "")?.[1] ?? /@\/.*\/(\d+)$/.exec(s.path.find((p) => p.includes("@/")) ?? "")?.[1];
    return `${s.componentId}${s.component ? ` (${s.component})` : ""}${item !== undefined ? ` [item ${Number(item) + 1}]` : ""}: ${s.text.replace(/\s+/g, " ").trim()}`;
  });
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`].join("\n") : lines.join("\n");
}

/** Every displayed string on a screen, attributed to the component that renders it. */
export function displayedText(screen: Screen): Shown[] {
  const messages = screen.messages ?? [];
  const comps = componentList(messages);
  const byId = new Map(comps.map((c) => [String(c.id), c]));
  const model = dataModel(messages);
  const out: Shown[] = [];

  const resolve = (v: unknown, scope: string[]): unknown => {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (isObj(v)) {
      if (typeof v.literalBoolean === "boolean") return v.literalBoolean;
      if (typeof v.path === "string") {
        const parts = v.path.startsWith("/") ? pointerParts(v.path) : [...scope, ...pointerParts(v.path)];
        return getAt(model, parts);
      }
      if (typeof v.literalString === "string") return v.literalString;
      if (typeof v.literalNumber === "number") return v.literalNumber;
    }
    return undefined;
  };
  const emit = (id: string, v: unknown, scope: string[], path: string[]) => {
    const r = resolve(v, scope);
    const component = typeof byId.get(id)?.component === "string" ? String(byId.get(id)!.component) : undefined;
    if (typeof r === "string" && r.trim()) out.push({ componentId: id, text: r, path, component });
    else if (typeof r === "number") out.push({ componentId: id, text: String(r), path, component });
  };

  const seen = new Set<string>();
  const visit = (id: string, scope: string[], depth: number, parent: string[]) => {
    const c = byId.get(id);
    const key = `${id}@${scope.join("/")}`;
    if (!c || seen.has(key) || depth > 60) return;
    seen.add(key);
    const path = [...parent, scope.length ? `${id}@/${scope.join("/")}` : id];
    for (const p of TEXT_PROPS) if (p in c) emit(id, c[p], scope, path);
    for (const p of ["value", "checked", "selected"]) {
      if (!(p in c)) continue;
      const r = resolve(c[p], scope);
      if (typeof r === "boolean") out.push({ componentId: id, text: r ? "[on]" : "[off]", path, component: String(c.component ?? ""), toggle: true });
    }
    if (Array.isArray(c.options)) for (const o of c.options) if (isObj(o)) emit(id, o.label, scope, path);
    if (Array.isArray(c.tabs))
      for (const t of c.tabs)
        if (isObj(t)) {
          emit(id, t.title, scope, path);
          if (typeof t.child === "string") visit(t.child, scope, depth + 1, path);
        }
    if (typeof c.child === "string") visit(c.child, scope, depth + 1, path);
    if (Array.isArray(c.children)) for (const ch of c.children) if (typeof ch === "string") visit(ch, scope, depth + 1, path);
    if (isObj(c.children) && typeof c.children.componentId === "string" && typeof c.children.path === "string") {
      const p = c.children.path;
      const base = p.startsWith("/") ? pointerParts(p) : [...scope, ...pointerParts(p)];
      const items = getAt(model, base);
      const tpl = c.children.componentId;
      const keys = Array.isArray(items) ? items.map((_, i) => String(i)) : isObj(items) ? Object.keys(items) : [];
      for (const k of keys) visit(tpl, [...base, k], depth + 1, path);
    }
  };

  if (byId.has("root")) visit("root", [], 0, []);
  else {
    // No root: start from components nobody references.
    const referenced = new Set<string>();
    for (const c of comps) {
      if (typeof c.child === "string") referenced.add(c.child);
      if (Array.isArray(c.children)) c.children.forEach((x) => typeof x === "string" && referenced.add(x));
      if (isObj(c.children) && typeof c.children.componentId === "string") referenced.add(c.children.componentId);
    }
    for (const c of comps) if (!referenced.has(String(c.id))) visit(String(c.id), [], 0, []);
  }
  return out;
}

export function screenText(screen: Screen): string {
  return displayedText(screen)
    .filter((s) => !s.toggle)
    .map((s) => s.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Fact extraction

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const PRICE_RE = new RegExp(
  String.raw`(?:(US\$|\$|€|£)\s?|\b(EUR|USD|GBP)\s?)${NUM}|(?<![\d,.])${NUM}\s?(?:(€|£)|(EUR|USD|GBP)\b)`,
  "g",
);
const SYMBOL: Record<string, string> = { "€": "EUR", "£": "GBP", $: "USD", US$: "USD" };
const TIME_RE = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?!\d)(\s?\+1)?/g;
const FLIGHT_RE = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{3,4})\b/g;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = String.raw`(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const DOW = String.raw`(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?`;
const DATE_RE = new RegExp(
  String.raw`\b(\d{4})-(\d{2})-(\d{2})\b|\b${DOW}(\d{1,2})(?:st|nd|rd|th)?\s+${MON}\b|\b${DOW}${MON}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!:|\d)`,
  "g",
);

const toInt = (n: string, dec?: string) => Math.round(Number(n.replace(/,/g, "") + (dec ? `.${dec}` : "")));
const pad = (n: number) => String(n).padStart(2, "0");
const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1;

export function factsInText(text: string, componentId = ""): Fact[] {
  const out: Fact[] = [];
  const t = text.replace(/ | /g, " ");
  for (const m of t.matchAll(PRICE_RE)) {
    const [raw, sym1, code1, n1, d1, n2, d2, sym2, code2] = m;
    const cur = code1 ?? code2 ?? SYMBOL[sym1 ?? sym2 ?? ""];
    const n = n1 ?? n2;
    if (!cur || !n) continue;
    out.push({ componentId, kind: "price", value: `${toInt(n, d1 ?? d2)} ${cur}`, raw: raw.trim() });
  }
  for (const m of t.matchAll(TIME_RE)) {
    out.push({ componentId, kind: "time", value: `${pad(Number(m[1]))}:${m[2]}`, raw: m[0].trim() });
  }
  for (const m of t.matchAll(FLIGHT_RE)) {
    out.push({ componentId, kind: "flight", value: `${m[1]}${m[2]}`, raw: m[0] });
  }
  for (const m of t.matchAll(DATE_RE)) {
    let mm: number, dd: number;
    if (m[1]) [mm, dd] = [Number(m[2]), Number(m[3])];
    else if (m[4]) [mm, dd] = [monthIndex(m[5]), Number(m[4])];
    else [mm, dd] = [monthIndex(m[6]), Number(m[7])];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    out.push({ componentId, kind: "date", value: `${pad(mm)}-${pad(dd)}`, raw: m[0].trim() });
  }
  return out;
}

/** Prices, times, flight numbers and dates shown on a screen, each attributed to its component. */
export function extractFacts(screen: Screen): Fact[] {
  const out: Fact[] = [];
  const seen = new Set<string>();
  for (const s of displayedText(screen)) {
    for (const f of factsInText(s.text, s.componentId)) {
      const k = `${f.componentId}|${f.kind}|${f.value}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ground truth

const looksLikeFare = (v: unknown): v is Partial<Fare> & { flightId: string } => isObj(v) && typeof v.flightId === "string";

/** Fare-like objects anywhere in carry (carry itself, carry.fare, carry.selected, arrays…). */
export function faresInCarry(carry: Obj): Partial<Fare>[] {
  const out: Partial<Fare>[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (looksLikeFare(v)) out.push(v);
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObj(v)) Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(carry, 0);
  return out;
}

export const toolFares = (t: Pick<Turn, "ingredients">): Fare[] => (t.ingredients?.toolResults ?? []).flatMap((r) => r.fares ?? []);

interface Truth {
  prices: Set<string>;
  times: Set<string>;
  flights: Set<string>;
  dates: Set<string>;
}

function addFare(truth: Truth, f: Partial<Fare>, fallback: { currency?: string; pax?: number }) {
  const cur = f.currency ?? fallback.currency;
  const pax = f.pax ?? fallback.pax;
  if (f.flightId) truth.flights.add(f.flightId.replace(/\s/g, "").toUpperCase());
  if (f.depart) truth.times.add(f.depart);
  if (f.arrive) truth.times.add(f.arrive);
  if (f.date) truth.dates.add(f.date.slice(5, 10));
  if (cur) {
    const add = (n: number) => {
      for (const d of [-1, 0, 1]) truth.prices.add(`${Math.round(n) + d} ${cur}`);
    };
    if (typeof f.total === "number") add(f.total);
    if (typeof f.pricePerPax === "number") add(f.pricePerPax);
    if (typeof f.total === "number" && pax) add(f.total / pax);
  }
}

/** Everything a screen may legitimately show this turn. */
function groundTruth(turn: Omit<Turn, "checks">, query: Query, persona: Persona, chosen?: Partial<Fare>): Truth {
  const truth: Truth = { prices: new Set(), times: new Set(), flights: new Set(), dates: new Set() };
  const carry = (turn.ingredients?.carry ?? {}) as Obj;
  const ctx = turn.ingredients?.context ?? persona.context;
  const currency = (typeof carry.currency === "string" ? carry.currency : undefined) ?? ctx.currency ?? persona.context.currency;
  const pax = Number(carry.pax ?? ctx.pax ?? persona.context.pax) || undefined;
  for (const f of toolFares(turn)) addFare(truth, f, { currency, pax });
  for (const f of faresInCarry(carry)) addFare(truth, f, { currency, pax });
  if (chosen) addFare(truth, chosen, { currency, pax });
  // Any other number or fact string in carry (extras, grand totals, seat fees) counts as carried.
  const walk = (v: unknown, depth: number) => {
    if (depth > 5) return;
    if (typeof v === "number" && currency) truth.prices.add(`${Math.round(v)} ${currency}`);
    else if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) truth.dates.add(v.slice(5, 10));
      for (const f of factsInText(v)) addFact(truth, f);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObj(v)) Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(carry, 0);
  // Echoing the query or the person's own words is not invention ("under £100", "before 12:00").
  const c = query.constraints;
  for (const t of [c.departAfter, c.departBefore]) if (t) truth.times.add(t);
  if (c.date) truth.dates.add(c.date.slice(5, 10));
  if (c.maxPricePerPax !== undefined && currency) truth.prices.add(`${c.maxPricePerPax} ${currency}`);
  for (const f of factsInText(`${query.text}\n${turn.userMessage ?? ""}`)) addFact(truth, f);
  // Bare numbers in the user's message ("under 100") ground prices in the persona's currency.
  if (currency) for (const m of (turn.userMessage ?? "").matchAll(/\b\d{2,5}\b/g)) truth.prices.add(`${m[0]} ${currency}`);
  return truth;
}

function addFact(truth: Truth, f: Fact) {
  const set = { price: truth.prices, time: truth.times, flight: truth.flights, date: truth.dates }[f.kind];
  set.add(f.value);
}

const has = (truth: Truth, f: Fact) => ({ price: truth.prices, time: truth.times, flight: truth.flights, date: truth.dates })[f.kind].has(f.value);

// ---------------------------------------------------------------------------
// Turn checks

const ERROR_RE = /\berror\b/i;

function isErrorScreen(screen: Screen | undefined): boolean {
  if (!screen) return true;
  return ERROR_RE.test(screen.variant ?? "") || screen.model === "error" || String(screen.nodeId ?? "") === "error";
}

/** The fare the person chose, as best we can reconstruct it: carry fields, then tool data by flightId. */
function carriedFare(carry: Obj, known: Fare[]): Partial<Fare> | undefined {
  const flightId = typeof carry.flightId === "string" ? carry.flightId.replace(/\s/g, "").toUpperCase() : undefined;
  if (!flightId) return undefined;
  const fromTools = known.find((f) => f.flightId === flightId);
  const fromCarry = faresInCarry(carry).find((f) => f.flightId?.replace(/\s/g, "").toUpperCase() === flightId) ?? {};
  return { ...fromTools, ...fromCarry, flightId };
}

export function checkTurn(
  turn: Omit<Turn, "checks">,
  ctx: { query: Query; persona: Persona; prevTurns: Turn[] },
): CheckResult[] {
  const results: CheckResult[] = [];
  const fail = (kind: CheckKind, message: string, componentId?: string, value?: string) =>
    results.push({ kind, ok: false, message, componentId, value });

  // schema
  const comps = componentList(turn.screen?.messages ?? []);
  if (isErrorScreen(turn.screen)) fail("schema", "Screen is an error state");
  else if (!comps.length) fail("schema", "Screen has no components");

  const facts = turn.screen ? extractFacts(turn.screen) : [];

  // The chosen fare, filled in from earlier tool results when carry only holds its flightId.
  const carry = (turn.ingredients?.carry ?? {}) as Obj;
  const known = [...ctx.prevTurns.flatMap(toolFares), ...toolFares(turn)];
  const chosen = carriedFare(carry, known);

  // grounding
  const truth = groundTruth(turn, ctx.query, ctx.persona, chosen);
  for (const f of facts) {
    if (!has(truth, f)) fail("grounding", `${f.raw} is not in the tool results or carried fare`, f.componentId, f.raw);
  }

  // carry
  if (chosen?.flightId) {
    const mine: Truth = { prices: new Set(), times: new Set(), flights: new Set(), dates: new Set() };
    const ctxCur = typeof carry.currency === "string" ? carry.currency : ctx.persona.context.currency;
    addFare(mine, chosen, { currency: ctxCur, pax: Number(carry.pax ?? ctx.persona.context.pax) || undefined });
    const others: Truth = { prices: new Set(), times: new Set(), flights: new Set(), dates: new Set() };
    for (const f of known) if (f.flightId !== chosen.flightId) addFare(others, f, {});
    const showsChosen = new Set(facts.filter((f) => f.kind === "flight" && f.value === chosen.flightId).map((f) => f.componentId));
    for (const f of facts) {
      if (f.kind === "flight" && f.value !== chosen.flightId) {
        fail("carry", `Shows ${f.raw}, but the chosen flight is ${chosen.flightId}`, f.componentId, f.raw);
      } else if (f.kind === "price" && !mine.prices.has(f.value) && (others.prices.has(f.value) || showsChosen.has(f.componentId))) {
        fail("carry", `${f.raw} is not the price of the chosen ${chosen.flightId}${chosen.total ? ` (${chosen.total} ${chosen.currency ?? ""})`.trimEnd() : ""}`, f.componentId, f.raw);
      } else if (f.kind === "time" && !mine.times.has(f.value) && (others.times.has(f.value) || showsChosen.has(f.componentId))) {
        fail("carry", `${f.raw} is not a time of the chosen ${chosen.flightId}${chosen.depart ? ` (departs ${chosen.depart})` : ""}`, f.componentId, f.raw);
      }
    }
  }

  const ok: Record<string, string> = {
    schema: `Screen renders (${comps.length} components)`,
    grounding: facts.length ? `All ${facts.length} prices, times, flights and dates are in the tool results or carry` : "No prices, times or flights to ground",
    carry: chosen?.flightId ? `Chosen ${chosen.flightId} carried over unchanged` : "Nothing chosen yet",
  };
  for (const kind of ["grounding", "carry", "schema"] as const) {
    if (!results.some((r) => r.kind === kind)) results.push({ kind, ok: true, message: ok[kind] });
  }
  // persona: rule contracts only (judge contracts come from scripts/judge-personas.ts, so this stays offline).
  if (ctx.persona.contracts?.length) results.push(...checkPersonaRules(turn, ctx.persona, ctx.prevTurns));
  return results;
}

// ---------------------------------------------------------------------------
// Goal oracle

const NONE_RE =
  /\b(no|zero)\s+(flights?|fares?|results?|options?|matches|seats)\b|\bnothing\s+(under|below|found|matches|available)|\bcouldn['’]?t find|\bcould not find|\bunable to find|\bnone\s+(under|below|found|available|match)|\bsold out\b/i;

export function checkJourneyGoal(journey: Journey, query: Query, persona: Persona): { goalMet: boolean; result: CheckResult } {
  const pax = Number(persona.context.pax) || 1;
  const oracle = bestFare(query.constraints, { origin: persona.context.origin, pax, currency: persona.context.currency });
  const turns = journey.turns ?? [];

  if (!oracle) {
    const fabricated = turns.flatMap((t) => (t.screen ? extractFacts(t.screen) : []).filter((f) => f.kind === "flight"));
    const saidNone = turns.some((t) => t.screen && NONE_RE.test(screenText(t.screen)));
    if (fabricated.length) {
      const f = fabricated[0];
      return {
        goalMet: false,
        result: { kind: "goal", ok: false, message: `No fare matches, but the journey showed ${f.raw}`, componentId: f.componentId, value: f.raw },
      };
    }
    return saidNone
      ? { goalMet: true, result: { kind: "goal", ok: true, message: "No fare matches, and the assistant said so" } }
      : { goalMet: false, result: { kind: "goal", ok: false, message: "No fare matches, but the assistant never said none were found" } };
  }

  // Where the person chose: the first select turn, or the first turn that carries a flightId.
  let selectIdx = turns.findIndex((t) => t.intent === "select");
  if (selectIdx < 0) selectIdx = turns.findIndex((t) => typeof (t.ingredients?.carry as Obj | undefined)?.flightId === "string");
  const before = selectIdx < 0 ? turns : turns.slice(0, selectIdx);
  const flightsOf = (t: Turn) => (t.screen ? extractFacts(t.screen).filter((f) => f.kind === "flight") : []);
  let shown = before.some((t) => flightsOf(t).some((f) => f.value === oracle.flightId));
  if (!shown && selectIdx >= 0) shown = flightsOf(turns[selectIdx])[0]?.value === oracle.flightId;
  if (!shown) {
    return {
      goalMet: false,
      result: { kind: "goal", ok: false, message: `Best fare ${oracle.flightId} (${oracle.total} ${oracle.currency}) was never shown before selection`, value: oracle.flightId },
    };
  }

  if (journey.outcome === "booked") {
    const carries = turns.map((t) => (t.ingredients?.carry ?? {}) as Obj).filter((c) => typeof c.flightId === "string");
    const selected = carries[0]?.flightId as string | undefined;
    const last = carries[carries.length - 1];
    if (!selected || !last) {
      return { goalMet: false, result: { kind: "goal", ok: false, message: "Booked, but no chosen fare was carried" } };
    }
    if (last.flightId !== selected) {
      return {
        goalMet: false,
        result: { kind: "goal", ok: false, message: `Booked ${String(last.flightId)}, but the person selected ${selected}`, value: String(last.flightId) },
      };
    }
    const known = turns.flatMap(toolFares);
    const tool = known.find((f) => f.flightId === selected);
    const fare = carriedFare(last, []);
    if (!tool) {
      return { goalMet: false, result: { kind: "goal", ok: false, message: `Booked ${selected}, which no tool returned`, value: selected } };
    }
    if (fare && typeof fare.total === "number" && fare.total !== tool.total) {
      return {
        goalMet: false,
        result: { kind: "goal", ok: false, message: `Booked ${selected} at ${fare.total}, tool says ${tool.total} ${tool.currency}`, value: String(fare.total) },
      };
    }
    const tot = typeof last.total === "number" ? last.total : undefined;
    if (tot !== undefined && tot !== tool.total) {
      return {
        goalMet: false,
        result: { kind: "goal", ok: false, message: `Booked ${selected} at ${tot}, tool says ${tool.total} ${tool.currency}`, value: String(tot) },
      };
    }
    return { goalMet: true, result: { kind: "goal", ok: true, message: `Best fare ${oracle.flightId} was shown; booked ${selected} matches tool data` } };
  }

  return { goalMet: true, result: { kind: "goal", ok: true, message: `Best fare ${oracle.flightId} (${oracle.total} ${oracle.currency}) was shown` } };
}
