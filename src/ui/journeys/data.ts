import type { CheckResult, Journey, JourneysFile, Persona, PersonaContract, Query, Turn } from "../../journeys/types";
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
      return { ...p, name: p.name ?? fx?.name, photo: p.photo ?? fx?.photo, memory: fx?.memory ?? p.memory, contracts: p.contracts ?? fx?.contracts };
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

let naivePending: Promise<JourneysFile | null> | null = null;

/** The naive-prompt baseline run (gen-v0), for the hero's "Naive prompt" view. */
export function loadNaiveJourneys(): Promise<JourneysFile | null> {
  naivePending ??= tryLoad("/data/journeys.baseline.json").then((f) => (f && f.journeys.length ? withPeople(f) : null));
  return naivePending;
}

export type HeroMode = "naive" | "checked";

/** Persona contracts in the UI (hero "Serves <name>", amber circles, strip metric). Off for the demo; checks still run. */
export const SHOW_PERSONA_CONTRACTS = false;

/** Share of journeys with at least one made-up (ungrounded) fact. */
export const inventedShare = (f: JourneysFile) =>
  f.journeys.length ? f.journeys.filter((j) => j.turns.some((t) => t.checks.some((c) => c.kind === "grounding" && !c.ok))).length / f.journeys.length : 0;

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
/** Correctness only (grounding, carry, goal, schema). Persona contracts are shown separately, in amber. */
export const turnOk = (t: Turn) => t.checks.every((c) => c.ok || c.kind === "persona");
export const personaChecks = (t: Turn | undefined) => (t?.checks ?? []).filter((c) => c.kind === "persona");

/** One color per persona, used for the avatar ring, hero paths in the intent tree and the moving dot. */
export const PERSONA_COLORS: Record<string, string> = { family: "#e8833a", solo: "#3b82f6", "budget-couple": "#22a06b" };
const FALLBACK_COLORS = ["#e8833a", "#3b82f6", "#22a06b", "#a855f7", "#e5484d"];
export const personaColor = (id: string, i = 0) => PERSONA_COLORS[id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];

/** The journey the hero shows for (query, persona): the lowest run. */
export function pickJourney(all: Journey[], queryId: string, personaId: string): Journey | undefined {
  return all.filter((j) => j.queryId === queryId && j.personaId === personaId).sort((a, b) => a.run - b.run)[0];
}

/** The persona's contracts for this turn's intent, each with its check (if one ran on this screen). */
export function contractStatus(p: Persona | undefined, t: Turn | undefined): { contract: PersonaContract; check?: CheckResult }[] {
  if (!p || !t) return [];
  const checks = personaChecks(t);
  return (p.contracts ?? [])
    .filter((c) => c.appliesTo.includes(t.intent))
    .map((contract) => ({ contract, check: checks.find((c) => c.contractId === contract.id || c.message.replace(/^\[judge\]\s*/, "").startsWith(`${contract.label}: `)) }));
}

/** "Seat-together status is shown: No seat…" → the reason after the label. */
export const checkReason = (c: CheckResult) => {
  const m = c.message.replace(/^\[judge\]\s*/, "");
  const i = m.indexOf(": "); // labels can hold "07:00", so split on colon + space
  return i >= 0 ? m.slice(i + 2) : m;
};
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
