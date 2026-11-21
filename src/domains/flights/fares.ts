// Deterministic fares tool: the ground truth every generated screen is checked against.
// Same inputs → same fares, so "the right answer" is always computable.

export interface Fare {
  flightId: string; // "TP1353"
  airline: string;
  origin: string; // IATA
  destination: string;
  date: string; // ISO date, "2027-03-14"
  depart: string; // "07:10"
  arrive: string; // "09:45"
  stops: number;
  /** Price per traveler in `currency`, whole units. */
  pricePerPax: number;
  currency: string;
  /** Total for the party, whole units. */
  total: number;
  pax: number;
}

export interface FareConstraints {
  destination: string; // "LIS"
  month?: string; // "2027-03"
  date?: string; // exact ISO date
  departAfter?: string; // "05:00"
  departBefore?: string; // "12:00"  (morning)
  maxStops?: number;
  sort?: "price" | "depart" | "duration";
  maxPricePerPax?: number;
}

const AIRLINES: [string, string][] = [
  ["TP", "TAP Air Portugal"],
  ["FR", "Ryanair"],
  ["IB", "Iberia"],
  ["BA", "British Airways"],
  ["U2", "easyJet"],
  ["UA", "United"],
];

// Base one-way price per traveler in EUR by origin.
const BASE: Record<string, number> = { LHR: 92, MAN: 78, JFK: 410, BER: 88, BOS: 395 };
const FX: Record<string, number> = { EUR: 1, USD: 1.08, GBP: 0.85 };
const DEPARTS = ["06:05", "06:40", "07:10", "08:25", "09:50", "11:15", "13:30", "16:45", "19:20", "21:30"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function addMinutes(hhmm: string, mins: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = (h * 60 + m + mins) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** All fares for one origin → destination on one date (deterministic). */
export function faresOn(origin: string, destination: string, date: string, pax: number, currency: string): Fare[] {
  const base = BASE[origin] ?? 150;
  const longHaul = base > 200;
  return DEPARTS.map((depart, i) => {
    const h = hash(`${origin}${destination}${date}${depart}`);
    const pool = longHaul ? AIRLINES.filter(([c]) => ["TP", "BA", "UA", "IB"].includes(c)) : AIRLINES.slice(0, 5);
    const [code, airline] = pool[(h + i) % pool.length];
    const stops = longHaul ? (h % 3 === 0 ? 0 : 1) : h % 5 === 0 ? 1 : 0;
    const duration = (longHaul ? 420 : 150) + stops * 95 + (h % 25);
    const early = depart < "08:00" ? 0.82 : depart < "12:00" ? 1 : 1.12;
    const perPaxEur = Math.round(base * early * (0.85 + (h % 40) / 100) + stops * -18);
    const pricePerPax = Math.max(29, Math.round(perPaxEur * (FX[currency] ?? 1)));
    return {
      flightId: `${code}${1000 + (h % 9000)}`,
      airline,
      origin,
      destination,
      date,
      depart,
      arrive: addMinutes(depart, duration),
      stops,
      pricePerPax,
      currency,
      total: pricePerPax * pax,
      pax,
    };
  });
}

const inWindow = (f: Fare, c: FareConstraints) =>
  (!c.departAfter || f.depart >= c.departAfter) &&
  (!c.departBefore || f.depart < c.departBefore) &&
  (c.maxStops === undefined || f.stops <= c.maxStops) &&
  (c.maxPricePerPax === undefined || f.pricePerPax <= c.maxPricePerPax);

/** The tool the assistant calls. Searches the given month on three fixed dates (or one exact date). */
export function searchFares(c: FareConstraints, ctx: { origin: string; pax: number; currency: string }): Fare[] {
  const dates = c.date ? [c.date] : [`${c.month ?? "2027-03"}-07`, `${c.month ?? "2027-03"}-14`, `${c.month ?? "2027-03"}-21`];
  const all = dates.flatMap((d) => faresOn(ctx.origin, c.destination, d, ctx.pax, ctx.currency)).filter((f) => inWindow(f, c));
  const by = c.sort ?? "price";
  return all.sort((a, b) => (by === "price" ? a.total - b.total : by === "depart" ? a.depart.localeCompare(b.depart) : a.stops - b.stops)).slice(0, 8);
}

/** Oracle: the correct best answer for a query, independent of any UI. */
export function bestFare(c: FareConstraints, ctx: { origin: string; pax: number; currency: string }): Fare | undefined {
  return searchFares({ ...c, sort: "price" }, ctx)[0];
}
