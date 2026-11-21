// Journey simulator (SPEC.md): for each (query, persona, run) the persona writes a message, the assistant
// labels an intent and calls the fares tool, the generator builds the screen from the ingredients, and the
// persona reacts. Writes public/data/journeys.json.
//
// Usage: npm run simulate:journeys -- [--runs 2] [--queries a,b] [--personas x,y] [--concurrency 6]
//          [--pins <file>] [--pins-source <journeys file>] [--out public/data/journeys.json] [--tag t]
//          [--converge] [--no-cache] [--prompt gen-v1|gen-v0] [--baseline <journeys file from a gen-v0 run>]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "../api/_lib/env";
import { callJson } from "../api/_lib/gemini";
import { modelSnapshot, models } from "../api/_lib/models";
import { screenToText } from "../api/_lib/dataModel";
import { personaStep, planTurn, type JsonCaller } from "../api/_lib/journey";
import { BASELINE_PROMPT_VERSION, fillPinnedScreen, generateJourneyScreen, GEN_PROMPT_VERSION, PIN_PROMPT_VERSION, type GenPromptVersion, type JourneyScreenResult } from "../api/_lib/journeyScreen";
import { validateMessages } from "../src/a2ui/validate";
import type { Screen } from "../src/a2ui/types";
import type { Fare } from "../src/domains/flights/fares";
import { PERSONAS, QUERIES } from "../src/journeys/fixtures";
import { pinKey, type CheckResult, type Ingredients, type Journey, type JourneyOutcome, type JourneysFile, type Persona, type Pin, type Query, type SuiteSummary, type Turn } from "../src/journeys/types";

loadDotEnv(path.resolve(".env"));

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flag = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
const num = (f: string, d: number) => {
  const v = Number(flag(f));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : d;
};
const list = (f: string) => flag(f)?.split(",").map((s) => s.trim()).filter(Boolean);
const RUNS = num("--runs", 2);
const CONCURRENCY = num("--concurrency", 6);
const MAX_TURNS = 5;
const OUT = path.resolve(flag("--out") ?? "public/data/journeys.json");
const BEFORE_OUT = OUT.replace(/\.json$/, ".before.json");
const TAG = flag("--tag") ?? "";
const CONVERGE = argv.includes("--converge");
const USE_CACHE = !argv.includes("--no-cache");
const PINS_FILE = flag("--pins");
const PINS_SOURCE = flag("--pins-source");
const CACHE_DIR = path.resolve(".cache/journeys");
const PROMPT = (flag("--prompt") ?? GEN_PROMPT_VERSION) as GenPromptVersion;
if (PROMPT !== GEN_PROMPT_VERSION && PROMPT !== BASELINE_PROMPT_VERSION) {
  console.error(`--prompt must be ${GEN_PROMPT_VERSION} or ${BASELINE_PROMPT_VERSION}`);
  process.exit(1);
}
const BASELINE_FILE = flag("--baseline");

const queryIds = list("--queries");
const personaIds = list("--personas");
const queries = QUERIES.filter((q) => !queryIds || queryIds.includes(q.id));
const personas = PERSONAS.filter((p) => !personaIds || personaIds.includes(p.id));
if (!queries.length || !personas.length) {
  console.error(`no queries/personas selected (queries: ${QUERIES.map((q) => q.id).join(", ")}; personas: ${PERSONAS.map((p) => p.id).join(", ")})`);
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY missing (expected in .env)");
  process.exit(1);
}

// ---------------------------------------------------------------- optional modules owned by other code
type CheckTurn = (turn: Omit<Turn, "checks">, ctx: { query: Query; persona: Persona; prevTurns: Turn[] }) => CheckResult[];
type CheckGoal = (journey: Journey, query: Query, persona: Persona) => { goalMet: boolean; result: CheckResult };
type ChoosePins = (journeys: Journey[], opts?: { minEvidence?: number }) => Pin[];
type Summarize = (journeys: Journey[]) => SuiteSummary;

async function optional<T>(rel: string, name: string): Promise<T | undefined> {
  const file = path.resolve(rel);
  if (!existsSync(file)) return undefined;
  try {
    const mod = await import(pathToFileURL(file).href);
    return typeof mod[name] === "function" ? (mod[name] as T) : undefined;
  } catch (e) {
    console.warn(`  (could not load ${rel}: ${(e as Error).message})`);
    return undefined;
  }
}

// ---------------------------------------------------------------- utils
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const sha = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stats = {
  calls: {} as Record<string, number>,
  cacheHits: 0,
  genMs: [] as number[],
  repaired: 0,
  pinned: 0,
  pinFallbacks: 0,
  validationFailures: [] as string[],
  errors: [] as string[],
};

/** LLM caller with a disk cache keyed by the full request (so the generator is keyed by its ingredients). */
function makeCaller(salt: string): JsonCaller {
  return async <T>(kind: string, opts: Parameters<typeof callJson>[0]) => {
    const key = sha({ kind, model: opts.model, system: opts.system, prompt: opts.prompt, temperature: opts.temperature, salt, tag: TAG });
    const file = path.join(CACHE_DIR, `${kind}-${key}.json`);
    if (USE_CACHE && existsSync(file)) {
      stats.cacheHits++;
      const c = JSON.parse(readFileSync(file, "utf8")) as { data: T; model: string; ms: number };
      return { ...c, ms: 0 };
    }
    stats.calls[kind] = (stats.calls[kind] ?? 0) + 1;
    // callJson already backs off on 429; one more outer round covers sustained rate limiting.
    let r: { data: T; model: string; ms: number };
    try {
      r = await callJson<T>(opts);
    } catch (e) {
      if ((e as { status?: number }).status !== 429) throw e;
      await sleep(20_000 + Math.random() * 5000);
      r = await callJson<T>(opts);
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify({ data: r.data, model: r.model, ms: r.ms }));
    return r;
  };
}

const digest = (s: Screen) => screenToText(s.messages, 10).split("\n").map((l) => l.trim()).filter(Boolean).join(" / ").slice(0, 280);
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9-]/g, "-");

// ---------------------------------------------------------------- one journey
interface RunCtx {
  pins: Map<string, Pin>;
  pinScreens: Map<string, Screen>;
  checkTurn?: CheckTurn;
  checkGoal?: CheckGoal;
}

async function runJourney(query: Query, persona: Persona, run: number, rc: RunCtx): Promise<Journey> {
  const id = `${query.id}:${persona.id}:${run}`;
  const turns: Turn[] = [];
  const history: string[] = [];
  let constraints = { ...query.constraints };
  let carry: Record<string, unknown> = { pax: Number(persona.context.pax ?? 1) || 1, currency: persona.context.currency ?? "EUR" };
  const seenFares: Fare[] = [];
  let userMessage = query.text;
  let outcome: JourneyOutcome = "max-turns";

  try {
    for (let i = 0; i < MAX_TURNS; i++) {
      const t0 = Date.now();
      const call = makeCaller(`${id}:t${i}`);
      const plan = await planTurn({ query, persona, turnIndex: i, userMessage, history, constraints, seenFares, carry }, id, call);
      const ingredients: Ingredients = {
        context: persona.context,
        history: [...history],
        toolResults: plan.toolResults,
        carry: plan.carry,
        promptVersion: PROMPT,
      };
      const screenId = safeId(`${id}-t${i}${PROMPT === GEN_PROMPT_VERSION ? "" : `-${PROMPT}`}${TAG ? `-${TAG}` : ""}${rc.pins.size ? "-c" : ""}`);
      const input = { id: screenId, intent: plan.intent, userMessage, ingredients };

      let result: JourneyScreenResult | undefined;
      const pin = rc.pins.get(pinKey(plan.intent, persona.id));
      const pinned = pin ? rc.pinScreens.get(pin.screenId) : undefined;
      if (pin && pinned) {
        try {
          result = await fillPinnedScreen({ ...input, pinned }, { call });
          ingredients.promptVersion = PIN_PROMPT_VERSION;
          ingredients.pinned = { key: pin.key, fromScreenId: pin.screenId };
          stats.pinned++;
        } catch (e) {
          stats.pinFallbacks++;
          process.stdout.write(`  ${id} t${i}: pinned fill failed (${(e as Error).message}), generating instead\n`);
        }
      }
      if (!result) {
        result = await generateJourneyScreen(input, { call, promptVersion: PROMPT });
        const fresh = result.attempts.filter((a) => a.ok && a.ms > 0).reduce((s, a) => s + a.ms, 0);
        if (fresh) stats.genMs.push(fresh);
        if (result.repaired) stats.repaired++;
      }
      const v = validateMessages(result.screen.messages);
      if (!v.ok) {
        stats.validationFailures.push(`${screenId}: ${v.errors.slice(0, 3).join("; ")}`);
        throw new Error(`screen ${screenId} failed validation`);
      }

      for (const tr of plan.toolResults) seenFares.push(...tr.fares);
      constraints = plan.constraints;
      carry = plan.carry;
      const turn: Turn = { index: i, userMessage, intent: plan.intent, ingredients, screen: result.screen, userAction: "", checks: [], ms: 0 };
      turns.push(turn);
      history.push(`user: ${userMessage}`, `assistant showed (${plan.intent}): ${digest(result.screen)}`);

      if (plan.intent === "confirm" && carry.flightId) {
        turn.userAction = "Booking confirmed";
        turn.ms = Date.now() - t0;
        outcome = "booked";
        break;
      }
      if (i === MAX_TURNS - 1) {
        turn.userAction = "(turn limit reached)";
        turn.ms = Date.now() - t0;
        break;
      }
      const reply = await personaStep({ persona, query, history, screen: result.screen, turnIndex: i, maxTurns: MAX_TURNS }, call);
      turn.userAction = reply.userAction;
      turn.ms = Date.now() - t0;
      if (reply.abandon) {
        outcome = "abandoned";
        break;
      }
      userMessage = reply.userMessage;
    }
  } catch (e) {
    outcome = "error";
    const details = (e as { details?: unknown }).details;
    stats.errors.push(`${id}: ${(e as Error).message}${details ? ` ${JSON.stringify(details).slice(0, 300)}` : ""}`);
  }

  const journey: Journey = { id, queryId: query.id, personaId: persona.id, run, turns, outcome, goalMet: false };
  if (rc.checkTurn) {
    const done: Turn[] = [];
    for (const t of turns) {
      const { checks: _omit, ...rest } = t;
      try {
        t.checks = rc.checkTurn(rest, { query, persona, prevTurns: [...done] });
      } catch (e) {
        console.warn(`  checkTurn threw on ${id} t${t.index}: ${(e as Error).message}`);
      }
      done.push(t);
    }
  }
  if (rc.checkGoal) {
    try {
      const g = rc.checkGoal(journey, query, persona);
      journey.goalMet = g.goalMet;
      const last = turns[turns.length - 1];
      if (last) last.checks = [...last.checks, g.result];
    } catch (e) {
      console.warn(`  checkJourneyGoal threw on ${id}: ${(e as Error).message}`);
    }
  }
  const fails = turns.reduce((s, t) => s + t.checks.filter((c) => !c.ok).length, 0);
  const time = turns.reduce((s, t) => s + (t.ms ?? 0), 0);
  const pinnedTurns = turns.filter((t) => t.ingredients.pinned).length;
  console.log(
    `${id.padEnd(36)} ${outcome.padEnd(9)} turns=${turns.length} ${turns.map((t) => t.intent).join(">")} ${secs(time)}` +
      `${pinnedTurns ? ` pinned=${pinnedTurns}` : ""} fails=${fails} goal=${journey.goalMet ? "yes" : "no"}`,
  );
  return journey;
}

async function runSuite(rc: RunCtx, label: string): Promise<Journey[]> {
  const t0 = Date.now();
  const limit = limiter(CONCURRENCY);
  console.log(`\n== ${label}: ${queries.length} queries × ${personas.length} personas × ${RUNS} runs, concurrency ${CONCURRENCY}, pins ${rc.pins.size}, cache ${USE_CACHE}`);
  const jobs = queries.flatMap((q) => personas.flatMap((p) => Array.from({ length: RUNS }, (_, r) => limit(() => runJourney(q, p, r, rc)))));
  const journeys = await Promise.all(jobs);
  const turns = journeys.reduce((s, j) => s + j.turns.length, 0);
  const by = (o: JourneyOutcome) => journeys.filter((j) => j.outcome === o).length;
  console.log(
    `-- ${label}: ${journeys.length} journeys, ${turns} turns, booked ${by("booked")}, abandoned ${by("abandoned")}, max-turns ${by("max-turns")}, error ${by("error")}, goal ${journeys.filter((j) => j.goalMet).length}, wall ${secs(Date.now() - t0)}`,
  );
  return journeys;
}

function writeFile(file: string, journeys: Journey[], extra: Partial<JourneysFile> = {}) {
  const data: JourneysFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    models: { ...modelSnapshot(), journeyAssistant: models.journeyAssistant, pinFill: models.pinFill, promptVersion: PROMPT, ...(TAG ? { tag: TAG } : {}) },
    personas,
    queries,
    journeys,
    ...extra,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${(statSync(file).size / 1024 / 1024).toFixed(2)} MB)`);
}

function screensOf(journeys: Journey[]): Map<string, Screen> {
  return new Map(journeys.flatMap((j) => j.turns.map((t) => [t.screen.id, t.screen] as const)));
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const checkTurn = await optional<CheckTurn>("src/journeys/checks.ts", "checkTurn");
  const checkGoal = await optional<CheckGoal>("src/journeys/checks.ts", "checkJourneyGoal");
  console.log(`simulate:journeys prompt=${PROMPT} runs=${RUNS} queries=${queries.map((q) => q.id).join(",")} personas=${personas.map((p) => p.id).join(",")} generator=${models.generator} checks=${checkTurn ? "yes" : "no"}${TAG ? ` tag=${TAG}` : ""}`);

  let pins = new Map<string, Pin>();
  let pinScreens = new Map<string, Screen>();
  let pinList: Pin[] | undefined;
  if (PINS_FILE) {
    const raw = JSON.parse(readFileSync(path.resolve(PINS_FILE), "utf8")) as Pin[] | JourneysFile;
    pinList = Array.isArray(raw) ? raw : (raw.pins ?? []);
    const sourceFile = PINS_SOURCE ?? (Array.isArray(raw) || !raw.journeys?.length ? BEFORE_OUT : PINS_FILE);
    const source = JSON.parse(readFileSync(path.resolve(sourceFile), "utf8")) as JourneysFile;
    pinScreens = screensOf(source.journeys);
    pins = new Map(pinList.filter((p) => pinScreens.has(p.screenId)).map((p) => [p.key, p]));
    console.log(`pins: ${pins.size}/${pinList.length} usable (screens from ${sourceFile})`);
  }

  const before = await runSuite({ pins, pinScreens, checkTurn, checkGoal }, PINS_FILE ? "pinned run" : "run");
  let final = before;
  let extra: Partial<JourneysFile> = pinList ? { pins: pinList } : {};

  if (CONVERGE) {
    writeFile(BEFORE_OUT, before);
    const choosePins = await optional<ChoosePins>("src/journeys/converge.ts", "choosePins");
    const summarize = await optional<Summarize>("src/journeys/aggregate.ts", "summarize");
    if (!choosePins || !summarize) {
      console.warn(`--converge: ${!choosePins ? "converge.ts choosePins" : ""} ${!summarize ? "aggregate.ts summarize" : ""} not available; writing the plain run`);
    } else {
      const chosen = choosePins(before);
      const previous = summarize(before);
      const screens = screensOf(before);
      const usable = chosen.filter((p) => screens.has(p.screenId));
      console.log(`converge: ${chosen.length} pins chosen (${usable.length} usable): ${usable.map((p) => `${p.key}←${p.screenId}`).join(", ") || "none"}`);
      console.log(`previous: pass ${(previous.passRate * 100).toFixed(0)}% goal ${(previous.goalRate * 100).toFixed(0)}% booked ${(previous.bookedRate * 100).toFixed(0)}%`);
      final = await runSuite({ pins: new Map(usable.map((p) => [p.key, p])), pinScreens: screens, checkTurn, checkGoal }, "converged re-run");
      const after = summarize(final);
      console.log(`after:    pass ${(after.passRate * 100).toFixed(0)}% goal ${(after.goalRate * 100).toFixed(0)}% booked ${(after.bookedRate * 100).toFixed(0)}% pinned ${(after.pinnedShare * 100).toFixed(0)}%`);
      extra = { pins: chosen, previous };
    }
  }
  if (BASELINE_FILE) {
    const summarize = await optional<Summarize>("src/journeys/aggregate.ts", "summarize");
    const base = JSON.parse(readFileSync(path.resolve(BASELINE_FILE), "utf8")) as JourneysFile;
    if (!summarize) console.warn("--baseline: aggregate.ts summarize not available; skipping");
    else {
      const summary = summarize(base.journeys);
      const rel = path.relative(path.resolve("public"), path.resolve(BASELINE_FILE));
      const promptVersion = base.journeys[0]?.turns[0]?.ingredients.promptVersion ?? base.models.promptVersion ?? "unknown";
      extra = { ...extra, previous: summary, baseline: { promptVersion, summary, file: rel.startsWith("..") ? BASELINE_FILE : `/${rel}` } };
      console.log(`baseline (${promptVersion}): pass ${(summary.passRate * 100).toFixed(0)}% goal ${(summary.goalRate * 100).toFixed(0)}% booked ${(summary.bookedRate * 100).toFixed(0)}%`);
    }
  }
  writeFile(OUT, final, extra);

  const genAvg = stats.genMs.length ? stats.genMs.reduce((a, b) => a + b, 0) / stats.genMs.length : 0;
  console.log(
    `\ntotals: wall ${secs(Date.now() - t0)} · LLM calls ${JSON.stringify(stats.calls)} · cache hits ${stats.cacheHits} · generator avg ${secs(genAvg)} over ${stats.genMs.length} fresh · repaired ${stats.repaired} · pinned turns ${stats.pinned} (fallbacks ${stats.pinFallbacks}) · validation failures ${stats.validationFailures.length} · errors ${stats.errors.length}`,
  );
  for (const f of stats.validationFailures) console.log(`  invalid: ${f}`);
  for (const e of stats.errors) console.log(`  error: ${e}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
