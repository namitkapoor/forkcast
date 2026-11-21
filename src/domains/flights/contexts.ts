import type { Context } from "../../graph/types";

// Hand-picked contexts for LLM runs: a pairwise-ish cover of trip × party × surface × currency
// (every party meets every surface; every currency appears with both surfaces).

export const PAX_BY_PARTY: Record<string, number> = { solo: 1, couple: 2, family: 4 };

export const LLM_CONTEXTS: Context[] = [
  { trip: "round-trip", party: "family", surface: "inline", currency: "EUR", route: "LHR → LIS" },
  { trip: "one-way", party: "solo", surface: "fullscreen", currency: "USD", route: "JFK → LIS" },
  { trip: "multi-city", party: "couple", surface: "inline", currency: "GBP", route: "MAN → LIS → MAD" },
  { trip: "one-way", party: "family", surface: "fullscreen", currency: "GBP", route: "LGW → LIS" },
  { trip: "round-trip", party: "solo", surface: "inline", currency: "EUR", route: "BER → LIS" },
  { trip: "multi-city", party: "couple", surface: "fullscreen", currency: "USD", route: "BOS → LIS → OPO" },
  { trip: "round-trip", party: "couple", surface: "inline", currency: "USD", route: "EWR → LIS" },
  { trip: "one-way", party: "solo", surface: "inline", currency: "GBP", route: "EDI → LIS" },
];

export const contextKey = (c: Context) => [c.trip, c.party, c.surface, c.currency].join("-");

export interface Persona {
  description: string;
  goal: string;
}

/** Personas by party size; a session picks one matching its context. */
export const PERSONAS: Record<string, Persona[]> = {
  solo: [
    { description: "Consultant booking a work trip between meetings; impatient, wants the fastest sensible option, company pays.", goal: "Book a flight to Lisbon that lands before noon." },
    { description: "Budget backpacker; price-sensitive, will refine for cheaper fares and skip all extras.", goal: "Get the cheapest flight to Lisbon, no add-ons." },
    { description: "Nervous first-time flyer; reads everything, asks small questions, wants an aisle seat.", goal: "Book a flight to Lisbon and pick a seat." },
  ],
  couple: [
    { description: "Couple planning an anniversary trip; want to sit together and compare a couple of options first.", goal: "Book two seats together to Lisbon for a long weekend." },
    { description: "Retired couple; careful with money, suspicious of extra fees, slow and deliberate.", goal: "Book two tickets to Lisbon without surprise charges." },
  ],
  family: [
    { description: "Parent of two young kids; needs the family seated together, checked bags, and a clear total.", goal: "Book four tickets to Lisbon for the school holidays." },
    { description: "Parent booking on a phone while kids are distracting them; easily abandons confusing screens.", goal: "Quickly book the family's flights to Lisbon." },
  ],
};

const AIRLINES = ["TP", "BA", "U2", "FR", "IB", "LH", "UA", "VY"];

/** The fare a context's sessions end up selecting, deterministic per context so cached screens agree. */
export function fareForContext(c: Context, index = 0): { flightId: string; price: number; fareSource: string } {
  const key = `${contextKey(c)}#${index}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  const pax = PAX_BY_PARTY[c.party] ?? 1;
  const perPerson = 90 + (h % 420) + (c.trip === "round-trip" ? 140 : c.trip === "multi-city" ? 210 : 0);
  return { flightId: `${AIRLINES[h % AIRLINES.length]}${1000 + ((h >>> 8) % 8999)}`, price: perPerson * pax, fareSource: "fares-api" };
}
