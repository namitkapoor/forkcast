// Persona contracts: "did this screen actually serve this person?"
// Rule contracts are checked here, offline and pure (no DOM, no network). Judge contracts are scored by
// scripts/judge-personas.ts and land in turn.checks with source "judge".
import type { Screen } from "../a2ui/types.js";
import type { Fare } from "../domains/flights/fares.js";
import { displayedText, factsInText, faresInCarry, toolFares, type Fact, type Shown } from "./checks.js";
import type { CheckResult, Intent, Persona, PersonaContract, Turn } from "./types.js";

type Obj = Record<string, unknown>;

/** Contracts of `persona` that apply to a turn with this intent. */
export function applicableContracts(persona: Persona | undefined, intent: Intent, kind?: PersonaContract["kind"]): PersonaContract[] {
  return (persona?.contracts ?? []).filter((c) => c.appliesTo.includes(intent) && (!kind || c.kind === kind));
}

// ---------------------------------------------------------------------------
// Fare units: the group of texts that render one fare (a card, a list item, the whole screen when only one fare).

export interface FareUnit {
  /** Instance key of the container ("card@/fares/2"), or the component id. */
  key: string;
  /** Component that carries the fare's identity (flight number or time range), for circling. */
  anchorId: string;
  entries: Shown[];
  text: string;
  facts: Fact[];
}

const RANGE_RE = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)\s*(?:[–—-]+|→|->|to)\s*([01]?\d|2[0-3]):([0-5]\d)/;

function tokensOf(s: Shown, mode: "flight" | "range" | "price", currency: string): string[] {
  if (mode === "range") {
    const m = RANGE_RE.exec(s.text.replace(/\*\*/g, ""));
    return m ? [`${m[1].padStart(2, "0")}:${m[2]}`] : [];
  }
  return factsInText(s.text, s.componentId)
    .filter((f) => f.kind === mode && (mode !== "price" || f.value.endsWith(` ${currency}`)))
    .map((f) => f.value);
}

/**
 * Group a screen's texts into fare units. Identity tokens are flight numbers when the screen shows any, else
 * depart–arrive time ranges, else prices. A unit is the highest rendered container whose subtree holds exactly one
 * token; flat layouts (a lone text per fare) extend to the following siblings up to the next token.
 */
export function fareUnits(screen: Screen, currency: string): FareUnit[] {
  const shown = displayedText(screen);
  const anyOf = (mode: "flight" | "range" | "price") => shown.some((s) => tokensOf(s, mode, currency).length);
  const mode = anyOf("flight") ? "flight" : anyOf("range") ? "range" : "price";

  const subtree = new Map<string, Set<string>>();
  const tokens = shown.map((s) => tokensOf(s, mode, currency));
  shown.forEach((s, i) => {
    for (const k of s.path) {
      const set = subtree.get(k) ?? new Set<string>();
      tokens[i].forEach((t) => set.add(t));
      subtree.set(k, set);
    }
  });

  const units: FareUnit[] = [];
  const byKey = new Map<string, FareUnit>();
  shown.forEach((s, i) => {
    if (!tokens[i].length) return;
    const key = s.path.find((k) => subtree.get(k)?.size === 1) ?? s.path[s.path.length - 1];
    if (byKey.has(key)) return;
    let entries = shown.filter((x) => x.path.includes(key));
    if (key === s.path[s.path.length - 1] && entries.length <= 1) {
      // Flat layout: take following siblings (same parent) until the next token.
      const parent = s.path[s.path.length - 2];
      entries = [s];
      for (let j = i + 1; j < shown.length; j++) {
        if (tokens[j].length || shown[j].path[shown[j].path.length - 2] !== parent) break;
        entries.push(shown[j]);
      }
    }
    const text = entries.map((e) => e.text).join(" · ");
    const facts = entries.flatMap((e) => factsInText(e.text, e.componentId));
    const unit = { key, anchorId: s.componentId, entries, text, facts };
    byKey.set(key, unit);
    units.push(unit);
  });
  return units;
}

// ---------------------------------------------------------------------------
// Unit readers

const NONSTOP_RE = /\bnon[- ]?stop\b|\bdirect\b|\b0\s*stops?\b|\bzero stops\b/i;
const STOPS_RE = /\b([1-9])\s*[- ]?stops?\b|\b(one|two|three)[- ]stops?\b/i;
const WORD: Record<string, number> = { one: 1, two: 2, three: 3 };

/** Stops as labeled in the unit's own text, or undefined when it doesn't say. */
export function labeledStops(text: string): number | undefined {
  const t = text.replace(/\*\*/g, "");
  if (NONSTOP_RE.test(t)) return 0;
  const m = STOPS_RE.exec(t);
  if (!m) return undefined;
  return m[1] ? Number(m[1]) : WORD[m[2].toLowerCase()];
}

const timesOf = (u: FareUnit) => [...new Set(u.facts.filter((f) => f.kind === "time").map((f) => f.value))];
const pricesOf = (u: FareUnit, currency: string) => u.facts.filter((f) => f.kind === "price" && f.value.endsWith(` ${currency}`));
const amount = (f: Fact) => Number(f.value.split(" ")[0]);
/** A unit that renders an actual fare: it has a flight number or a time (price-only units are budgets, headlines…). */
const isFareDisplay = (u: FareUnit) => u.facts.some((f) => f.kind === "flight" || f.kind === "time");
const identity = (u: FareUnit) => u.facts.find((f) => f.kind === "flight")?.value ?? u.key;

/** Fares that fail `ok` in every place they're shown (a summary line re-mentioning a full card doesn't count against it). */
function missingEverywhere(units: FareUnit[], ok: (u: FareUnit) => boolean): { fares: FareUnit[]; missing: FareUnit[] } {
  const fares = units.filter(isFareDisplay);
  const good = new Set(fares.filter(ok).map(identity));
  const seen = new Set<string>();
  const distinct = fares.filter((u) => !seen.has(identity(u)) && seen.add(identity(u)));
  return { fares: distinct, missing: distinct.filter((u) => !good.has(identity(u))).map((u) => fares.find((x) => identity(x) === identity(u) && !ok(x)) ?? u) };
}

function fareFor(u: FareUnit, known: Fare[]): Fare | undefined {
  const flight = u.facts.find((f) => f.kind === "flight")?.value;
  if (flight) {
    const f = known.find((k) => k.flightId === flight);
    if (f) return f;
  }
  const [dep, arr] = timesOf(u);
  return dep ? known.find((k) => k.depart === dep && (!arr || k.arrive === arr)) : undefined;
}

const label = (u: FareUnit) => u.facts.find((f) => f.kind === "flight")?.raw ?? u.facts.find((f) => f.kind === "time")?.raw ?? truncateText(u.text, 28);
const truncateText = (s: string, n: number) => {
  const t = s.replace(/\*\*/g, "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---------------------------------------------------------------------------
// The rules

interface RuleInput {
  contract: PersonaContract;
  persona: Persona;
  screen: Screen;
  currency: string;
  pax: number;
  units: FareUnit[];
  known: Fare[];
  carry: Obj;
  /** What the person typed so far (this turn and earlier), for telling echoed budgets from fare prices. */
  said: string;
}

type RuleOutcome = { ok: boolean; detail: string; componentId?: string; value?: string } | null;

/** Party totals the screen may show: tool totals, pricePerPax × pax, and any carried total. */
function partyTotals(inp: RuleInput): Set<number> {
  const out = new Set<number>();
  const add = (n: unknown) => {
    if (typeof n === "number" && Number.isFinite(n)) for (const d of [-1, 0, 1]) out.add(Math.round(n) + d);
  };
  for (const f of inp.known) {
    if (f.currency && f.currency !== inp.currency) continue;
    if (f.pax === inp.pax) add(f.total);
    add(f.pricePerPax * inp.pax);
  }
  add(inp.carry.total);
  add(inp.carry.grandTotal);
  return out;
}

const PAX_NEAR = (n: number) => new RegExp(String.raw`\b${n}\s*(?:travel+ers?|passengers?|people|pax|adults?|guests?)\b|\bfor (?:all )?${n}\b|[×x]\s*${n}\b|\b${n}\s*[×x]`, "i");

/** Priced units plus priced texts outside any unit (headlines like "from €54"). */
function pricedGroups(inp: RuleInput): FareUnit[] {
  const inUnits = new Set(inp.units.flatMap((u) => u.entries));
  const loose: FareUnit[] = displayedText(inp.screen)
    .filter((s) => !inUnits.has(s) && !inp.units.some((u) => u.entries.some((e) => e.componentId === s.componentId && e.text === s.text)))
    .map((s) => ({ key: s.componentId, anchorId: s.componentId, entries: [s], text: s.text, facts: factsInText(s.text, s.componentId) }));
  return [...inp.units, ...loose].filter((u) => pricesOf(u, inp.currency).length);
}

function totalShown(inp: RuleInput, allowPaxMention: boolean): RuleOutcome {
  // Budgets the person typed ("under 100") aren't fare prices.
  const echoed = new Set([...inp.said.matchAll(/\b\d{2,5}\b/g)].map((m) => Number(m[0])));
  const groups = pricedGroups(inp).filter((u) => pricesOf(u, inp.currency).some((f) => !echoed.has(amount(f))));
  if (!groups.length) return null;
  const totals = partyTotals(inp);
  const near = PAX_NEAR(inp.pax);
  const bad = groups.filter((u) => {
    if (pricesOf(u, inp.currency).some((f) => totals.has(amount(f)))) return false;
    return !(allowPaxMention && near.test(u.text.replace(/\*\*/g, "")));
  });
  if (!bad.length) return { ok: true, detail: `all ${groups.length} prices on screen are totals for ${inp.pax}` };
  const p = pricesOf(bad[0], inp.currency)[0];
  return {
    ok: false,
    detail: `${p.raw} is a per-person price with no total for ${inp.pax} next to it${bad.length > 1 ? ` (${bad.length} of ${groups.length} prices)` : ""}`,
    componentId: p.componentId,
    value: p.raw,
  };
}

function departOf(u: FareUnit, known: Fare[]): string | undefined {
  return fareFor(u, known)?.depart ?? timesOf(u)[0];
}

const RULES: Record<string, (inp: RuleInput) => RuleOutcome> = {
  "family-total-for-4": (inp) => totalShown(inp, true),
  "budget-true-total": (inp) => totalShown(inp, false),

  "family-no-early-first": (inp) => {
    const timed = inp.units.map((u) => ({ u, dep: departOf(u, inp.known) })).filter((x) => x.dep);
    if (!timed.length) return null;
    const first = timed[0];
    if (first.dep! >= "07:00") return { ok: true, detail: `first fare departs ${first.dep}` };
    const later = timed.find((x) => x.dep! >= "07:00");
    if (!later) return { ok: true, detail: `first fare departs ${first.dep}, but nothing later is on screen` };
    return {
      ok: false,
      detail: `ranked first departs ${first.dep}; ${label(later.u)} at ${later.dep} is further down`,
      componentId: first.u.anchorId,
      value: first.dep,
    };
  },

  "solo-stops-labeled": (inp) => {
    const { fares, missing } = missingEverywhere(inp.units, (u) => labeledStops(u.text) !== undefined);
    if (!fares.length) return null;
    if (!missing.length) return { ok: true, detail: `all ${fares.length} fares say nonstop or how many stops` };
    return {
      ok: false,
      detail: `${label(missing[0])} has no nonstop / stops label${missing.length > 1 ? ` (${missing.length} of ${fares.length} fares)` : ""}`,
      componentId: missing[0].anchorId,
    };
  },

  "solo-arrival-shown": (inp) => {
    const { fares, missing } = missingEverywhere(inp.units, (u) => timesOf(u).length >= 2 || (timesOf(u).length > 0 && /\b(arriv|land)/i.test(u.text)));
    if (!fares.length) return null;
    if (!missing.length) return { ok: true, detail: `all ${fares.length} fares show an arrival time` };
    return {
      ok: false,
      detail: `${label(missing[0])} shows no arrival time${missing.length > 1 ? ` (${missing.length} of ${fares.length} fares)` : ""}`,
      componentId: missing[0].anchorId,
    };
  },

  "solo-nonstop-first": (inp) => {
    const rows = inp.units
      .map((u) => ({ u, price: pricesOf(u, inp.currency)[0], stops: fareFor(u, inp.known)?.stops ?? labeledStops(u.text) }))
      .filter((r) => r.price && r.stops !== undefined);
    if (rows.length < 2) return rows.length ? { ok: true, detail: "only one fare on screen" } : null;
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].stops) continue;
      const pi = amount(rows[i].price);
      const j = rows.findIndex((r, k) => k > i && r.stops === 0 && identity(r.u) !== identity(rows[i].u) && amount(r.price) <= pi * 1.15);
      if (j > 0) {
        const r = rows[j];
        return {
          ok: false,
          detail: `${label(rows[i].u)} (${rows[i].stops} stop, ${rows[i].price.raw}) ranks above nonstop ${label(r.u)} at ${r.price.raw}`,
          componentId: rows[i].u.anchorId,
          value: rows[i].price.raw,
        };
      }
    }
    return { ok: true, detail: "no fare with stops ranks above a similarly priced nonstop" };
  },
};

/** Rule contracts that have an implementation (judge contracts and unknown ids are skipped). */
export const RULE_IDS = Object.keys(RULES);

/**
 * Check `persona`'s rule contracts that apply to this turn's intent. One result per contract that has something to
 * check on this screen (a search screen with no fares yields nothing for fare rules). Failures point at a component.
 */
export function checkPersonaRules(turn: Omit<Turn, "checks">, persona: Persona, prevTurns: Pick<Turn, "ingredients">[] = []): CheckResult[] {
  const contracts = applicableContracts(persona, turn.intent, "rule").filter((c) => RULES[c.id]);
  if (!contracts.length || !turn.screen) return [];
  const carry = (turn.ingredients?.carry ?? {}) as Obj;
  const ctx = turn.ingredients?.context ?? persona.context;
  const currency = (typeof carry.currency === "string" ? carry.currency : undefined) ?? ctx.currency ?? persona.context.currency;
  const pax = Number(persona.context.pax) || 1;
  const known = [...prevTurns.flatMap(toolFares), ...toolFares(turn), ...(faresInCarry(carry) as Fare[])];
  const units = fareUnits(turn.screen, currency);
  const said = [turn.userMessage ?? "", ...(turn.ingredients?.history ?? []).filter((h) => h.startsWith("user:"))].join("\n");
  const out: CheckResult[] = [];
  for (const contract of contracts) {
    const r = RULES[contract.id]({ contract, persona, screen: turn.screen, currency, pax, units, known, carry, said });
    if (!r) continue;
    out.push({
      kind: "persona",
      ok: r.ok,
      message: `${contract.label}: ${r.detail}`,
      componentId: r.componentId,
      value: r.value,
      contractId: contract.id,
      source: "rule",
    });
  }
  return out;
}

/** Share of persona checks passing across turns (applicable, evaluated ones only); undefined when there are none. */
export function servesRate(turns: Pick<Turn, "checks">[]): number | undefined {
  const all = turns.flatMap((t) => (t.checks ?? []).filter((c) => c.kind === "persona"));
  return all.length ? all.filter((c) => c.ok).length / all.length : undefined;
}
