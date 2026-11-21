// What the assistant already knows about each traveler (gen-v2): a short "memory" from past trips and the
// conversation, plus fare conditions and derived tool entries the tailoring needs. The profile travels in
// Ingredients.carry.profile so grounding treats its facts (kids' ages, bag counts) as known.
import { faresOn, searchFares, type Fare, type FareConstraints } from "../../src/domains/flights/fares.js";

export interface TravelerProfile {
  /** One-line summary of who this is, as the assistant remembers them. */
  summary: string;
  /** What this person cares about, most important first. */
  priorities: string[];
  travelers: string;
  bags: string;
  device: string;
  /** Extra deterministic tool calls the assistant makes for this person (derived from the fares tool). */
  extraTools?: ("cheapestByDay" | "nonstopOnly")[];
}

export const PROFILES: Record<string, TravelerProfile> = {
  family: {
    summary: "Parent booking a family trip: 2 adults and 2 kids (ages 6 and 9).",
    priorities: [
      "all 4 must sit together (kids next to a parent)",
      "the total for all 4 travelers, and what each child's ticket costs",
      "checked bags for 4",
      "avoid very early departures with the kids (before 07:00 is hard)",
    ],
    travelers: "2 adults, 2 children (6 and 9)",
    bags: "4 checked bags",
    device: "phone: keep it compact",
  },
  solo: {
    summary: "Business traveler flying alone; has airline status (frequent flyer, alliance elite).",
    priorities: [
      "strongly prefers nonstop: list every nonstop before any 1-stop fare (a summary or trade-off callout mentioning a cheaper 1-stop is fine, but only after the nonstops)",
      "arrival time matters: meetings on arrival",
      "refundable / flexible fares",
      "status perks when relevant: lounge access, priority boarding",
      "open with a prominent status card right under the title: a star Icon, bold \"Alliance elite status\", and the perks that apply (lounge access, priority boarding, cabin bag), so her status visibly makes itself known",
    ],
    travelers: "1 adult",
    bags: "carry-on only",
    device: "phone: compact cards, one fare per card, arrival time large",
    extraTools: ["nonstopOnly"],
  },
  "budget-couple": {
    summary: "Couple on a tight budget, flexible on dates.",
    priorities: [
      "lowest price; happy to move the date: show the cheapest days across the month",
      "carry-on only (no checked bags)",
      "wary of add-on fees: show what's NOT included and the true total",
    ],
    travelers: "2 adults",
    bags: "carry-on only (no checked bags)",
    device: "phone: keep it compact",
    extraTools: ["cheapestByDay"],
  },
};

export const profileFor = (personaId: string): TravelerProfile | undefined => PROFILES[personaId];

/** The profile as it sits in carry (plain JSON, no tool config). */
export function profileCarry(personaId: string): Record<string, unknown> | undefined {
  const p = PROFILES[personaId];
  if (!p) return undefined;
  const { extraTools: _t, ...rest } = p;
  return rest;
}

// ---------------------------------------------------------------- fare conditions

/** Conditions per airline (deterministic). No fee amounts: we don't have them, so screens must not show any. */
export interface FareConditions {
  cabinBag: string;
  checkedBag: string;
  refundable: boolean;
  changes: string;
  seatSelection: string;
  familySeating: string;
  statusPerks: string;
}

const LOW_COST: FareConditions = {
  cabinBag: "small under-seat bag only; larger cabin bag not included",
  checkedBag: "not included (extra fee)",
  refundable: false,
  changes: "change fee applies",
  seatSelection: "not included (extra fee); random seats free at check-in",
  familySeating: "children under 12 seated next to an adult at no charge",
  statusPerks: "none",
};
const FULL_SERVICE = (checked: boolean): FareConditions => ({
  cabinBag: "cabin bag included",
  checkedBag: checked ? "1 checked bag included" : "not included (extra fee)",
  refundable: false,
  changes: "change fee applies",
  seatSelection: "included at booking",
  familySeating: "seats together included at booking",
  statusPerks: "lounge access and priority boarding with alliance status",
});

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function conditionsFor(f: Fare): FareConditions {
  const code = f.flightId.slice(0, 2);
  if (code === "FR" || code === "U2") return LOW_COST;
  const longHaul = f.origin === "JFK" || f.origin === "BOS";
  const c = FULL_SERVICE(longHaul);
  // Some full-service fares are flexible brands (deterministic by flight + date).
  if (hash(`${f.flightId}${f.date}`) % 3 === 0) return { ...c, refundable: true, changes: "free changes" };
  return c;
}

export type RichFare = Fare & FareConditions;
export const withConditions = (f: Fare): RichFare => ({ ...f, ...conditionsFor(f) });

// ---------------------------------------------------------------- derived tool entries

type Ctx = { origin: string; pax: number; currency: string };
export interface DerivedTool {
  tool: string;
  args: Record<string, unknown>;
  fares: Fare[];
}

/** Searched dates in the month (the same ones searchFares covers, so the oracle and the strip agree). */
function searchedDates(c: FareConstraints): string[] {
  if (c.date) return [c.date];
  const m = c.month ?? "2027-03";
  return [`${m}-07`, `${m}-14`, `${m}-21`];
}

const inWindow = (f: Fare, c: FareConstraints) =>
  (!c.departAfter || f.depart >= c.departAfter) &&
  (!c.departBefore || f.depart < c.departBefore) &&
  (c.maxStops === undefined || f.stops <= c.maxStops) &&
  (c.maxPricePerPax === undefined || f.pricePerPax <= c.maxPricePerPax);

/** Cheapest fare per searched day matching the constraints (for a cheapest-days strip). */
export function cheapestByDay(c: FareConstraints, ctx: Ctx): DerivedTool {
  const fares: Fare[] = [];
  for (const d of searchedDates({ ...c, date: undefined })) {
    const day = faresOn(ctx.origin, c.destination, d, ctx.pax, ctx.currency).filter((f) => inWindow(f, c)).sort((a, b) => a.total - b.total)[0];
    if (day) fares.push(day);
  }
  const { date: _d, ...args } = c;
  return { tool: "cheapestByDay", args: { ...args, days: searchedDates({ ...c, date: undefined }) }, fares };
}

export function nonstopOnly(c: FareConstraints, ctx: Ctx): DerivedTool {
  const args = { ...c, maxStops: 0 };
  return { tool: "searchFares", args, fares: searchFares(args, ctx) };
}

export function derivedTools(personaId: string, c: FareConstraints, ctx: Ctx): DerivedTool[] {
  const p = PROFILES[personaId];
  const out: DerivedTool[] = [];
  for (const t of p?.extraTools ?? []) {
    if (t === "cheapestByDay" && !c.date) out.push(cheapestByDay(c, ctx));
    if (t === "nonstopOnly" && c.maxStops !== 0) out.push(nonstopOnly(c, ctx));
  }
  return out;
}
