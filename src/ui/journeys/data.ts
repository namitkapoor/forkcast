import type { CheckResult, Journey, JourneysFile, Persona, Query, Turn } from "../../journeys/types";
import { bestFare } from "../../domains/flights/fares";
import { PERSONAS } from "../../journeys/fixtures";

export type LoadedJourneys = { file: JourneysFile; sample: boolean };

async function tryLoad(url: string): Promise<JourneysFile | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    // The dev server answers unknown paths with index.html; only accept JSON.
    const text = await res.text();
    if (!text.trimStart().startsWith("{")) return null;
    const f = JSON.parse(text) as JourneysFile;
    return Array.isArray(f.journeys) && Array.isArray(f.personas) && Array.isArray(f.queries) ? f : null;
  } catch {
    return null;
  }
}

/** Names and photos live in fixtures (older runs don't carry them); the file wins when it has them. */
function withPeople(f: JourneysFile): JourneysFile {
  const byId = new Map(PERSONAS.map((p) => [p.id, p]));
  return {
    ...f,
    personas: f.personas.map((p) => {
      const fx = byId.get(p.id);
      return { ...p, name: p.name ?? fx?.name, photo: p.photo ?? fx?.photo, memory: fx?.memory ?? p.memory };
    }),
  };
}

let pending: Promise<LoadedJourneys | null> | null = null;

/** /data/journeys.json (a real run), else the hand-built sample. Loaded once per page view. */
export function loadJourneys(): Promise<LoadedJourneys | null> {
  pending ??= (async () => {
    const real = await tryLoad("/data/journeys.json");
    if (real && real.journeys.length) return { file: withPeople(real), sample: false };
    const sample = await tryLoad("/data/journeys.sample.json");
    return sample ? { file: withPeople(sample), sample: true } : null;
  })();
  return pending;
}

let heroPending: Promise<JourneysFile | null> | null = null;

/** The hero shows unpinned turns (pinned layouts look alike on purpose): /data/journeys.unpinned.json when it exists, else null. */
export function loadHeroJourneys(): Promise<JourneysFile | null> {
  heroPending ??= tryLoad("/data/journeys.unpinned.json").then((f) => (f && f.journeys.length ? withPeople(f) : null));
  return heroPending;
}

/** "18 journeys · 3 questions × 3 travelers" for the top bar. */
export function suiteStats(f: JourneysFile): string {
  return `${f.journeys.length} journeys · ${f.queries.length} questions × ${f.personas.length} travelers`;
}

/** Context as plain chips: "4 travelers", "phone", "EUR from LHR". */
export function contextChips(p: Persona): string[] {
  const c = p.context;
  const pax = Number(c.pax) || 1;
  return [`${pax} traveler${pax === 1 ? "" : "s"}`, c.surface === "fullscreen" ? "desktop" : "phone", `${c.currency} from ${c.origin}`];
}

const SYM: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
export const money = (n: number, c: string) => `${SYM[c] ?? `${c} `}${Math.round(n).toLocaleString("en-GB")}`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const shortPersona = (p: Persona | undefined) => (p ? (p.name ?? p.label.split(" · ")[0]) : "?");
/** Compact name for tight spots (intent-tree lanes): "Okafor family". */
export const laneName = (p: Persona | undefined) => shortPersona(p).replace(/^The /, "");
export const isTap = (msg: string) => /^Tapped\s/i.test(msg);
export const turnOk = (t: Turn) => t.checks.every((c) => c.ok);
export const journeyOk = (j: Journey) => j.turns.every(turnOk);
export const tone = (rate: number) => (rate >= 0.8 ? "good" : rate >= 0.5 ? "warn" : "bad");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function sortQueries(qs: Query[]): Query[] {
  return [...qs].sort((a, b) => Number(!!b.hero) - Number(!!a.hero));
}

/** The journey's goal verdict: the goal check from the last turn if present, else derived from goalMet + the oracle. */
export function goalVerdict(j: Journey, q: Query | undefined, p: Persona | undefined): { ok: boolean; text: string } {
  const last = j.turns[j.turns.length - 1];
  const g: CheckResult | undefined = last?.checks.find((c) => c.kind === "goal");
  if (g) return { ok: g.ok, text: g.message };
  let best = "";
  if (q && p) {
    const f = bestFare(q.constraints, { origin: p.context.origin, pax: Number(p.context.pax) || 1, currency: p.context.currency });
    if (f) best = ` (best answer: ${f.flightId} ${money(f.total, f.currency)})`;
  }
  return { ok: j.goalMet, text: j.goalMet ? `Goal met${best}, outcome: ${j.outcome}` : `Goal not met${best}, outcome: ${j.outcome}` };
}
