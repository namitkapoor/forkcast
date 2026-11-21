// LLM-driven run: generate a screen per (node, context) with the generator model, walk persona
// sessions through flightGraph with the simulator model, check everything, write public/data/run.json.
//
// Usage: npm run simulate:llm -- [--sessions 60] [--contexts 6] [--concurrency 6] [--bug] [--seed 7] [--no-cache]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadDotEnv } from "../api/_lib/env";
import { modelSnapshot, models } from "../api/_lib/models";
import { generateScreen, type GenerateResult, type ScreenInput } from "../api/_lib/screen";
import { simulateStep } from "../api/_lib/simulate";
import { getDataModel } from "../api/_lib/dataModel";
import { validateMessages } from "../src/a2ui/validate";
import type { Screen } from "../src/a2ui/types";
import type { RunFile } from "../src/data/run";
import type { Context, Outcome, Step, Trace, Transition } from "../src/graph/types";
import { foldTraces } from "../src/graph/fold";
import { runChecks } from "../src/checks/run";
import { coverage } from "../src/checks/coverage";
import { flightGraph, flightInvariants } from "../src/domains/flights/graph";
import { contextKey, fareForContext, LLM_CONTEXTS, PAX_BY_PARTY, PERSONAS } from "../src/domains/flights/contexts";
import { mulberry32, pick } from "../src/sim/random";

loadDotEnv(path.resolve(".env"));

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const num = (flag: string, d: number) => {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : d;
};
const SESSIONS = num("--sessions", 60);
const N_CONTEXTS = Math.min(num("--contexts", 6), LLM_CONTEXTS.length);
const CONCURRENCY = num("--concurrency", 6);
const SEED = num("--seed", 7);
const BUG = argv.includes("--bug");
const USE_CACHE = !argv.includes("--no-cache");
const MAX_STEPS = 20;
const DRIFT_RATE = 0.1;
const SOLD_OUT_RATE = 0.06;
const PRICE_CHANGE_RATE = 0.08;
const CACHE_DIR = path.resolve(".cache/screens");
const OUT = path.resolve("public/data/run.json");

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY missing (expected in .env)");
  process.exit(1);
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
const genLimit = limiter(CONCURRENCY);
const t0 = Date.now();
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const stats = { genCalls: 0, genMs: [] as number[], cacheHits: 0, repaired: 0, fallback: 0, genFailures: [] as string[], warnings: 0, simCalls: 0, simMs: [] as number[], simFailures: 0 };

const nodeById = new Map(flightGraph.nodes.map((n) => [n.id, n]));
const outgoing = new Map<string, Transition[]>();
for (const tr of flightGraph.transitions) outgoing.set(tr.from, [...(outgoing.get(tr.from) ?? []), tr]);

// ---------------------------------------------------------------- screens
type FareVariant = "base" | "drift" | "repriced";
const FARE_NODES = new Set(["select", "seats", "extras", "passengers", "payment", "confirm", "price-changed"]);

function screenInput(nodeId: string, ctx: Context, variant: FareVariant): ScreenInput {
  const node = nodeById.get(nodeId)!;
  const pax = PAX_BY_PARTY[ctx.party] ?? 1;
  const fare = fareForContext(ctx);
  const base = { pax, currency: ctx.currency, trip: ctx.trip };
  const goal = `${ctx.trip} flight ${ctx.route ?? "to Lisbon"} for ${pax} traveler${pax > 1 ? "s" : ""}`;
  if (nodeId === "intent") return { node, context: ctx, utterance: `Book me a ${goal}`, carry: base };
  if (nodeId === "results" || nodeId === "compare") {
    return { node, context: ctx, utterance: `Show me options for a ${goal}. One of the fares must be ${fare.flightId} at a total of ${fare.price} ${ctx.currency}.`, carry: base };
  }
  if (nodeId === "sold-out") return { node, context: ctx, utterance: `I tapped ${fare.flightId} but it just sold out`, carry: base };
  if (!FARE_NODES.has(nodeId)) return { node, context: ctx, carry: base };

  const repricedPrice = fare.price + Math.round(20 * pax);
  if (nodeId === "price-changed") {
    return { node, context: ctx, utterance: `The airline repriced the fare to ${repricedPrice} ${ctx.currency} while I was paying.`, carry: { ...base, ...fare, newPrice: repricedPrice } };
  }
  const price = variant === "drift" ? fare.price + 37 : variant === "repriced" ? repricedPrice : fare.price;
  return { node, context: ctx, carry: { ...base, ...fare, price } };
}

const screenId = (nodeId: string, ctx: Context, variant: FareVariant) => `${nodeId}--${contextKey(ctx)}${variant === "base" ? "" : `--${variant}`}`;
const screens = new Map<string, Promise<Screen | null>>();
const results = new Map<string, GenerateResult>();

function getScreen(nodeId: string, ctx: Context, variant: FareVariant = "base"): Promise<Screen | null> {
  const id = screenId(nodeId, ctx, variant);
  const existing = screens.get(id);
  if (existing) return existing;
  const p = genLimit(async () => {
    const input = screenInput(nodeId, ctx, variant);
    const hash = createHash("sha1").update(JSON.stringify({ id, input, model: models.generator, v: 3 })).digest("hex").slice(0, 12);
    const file = path.join(CACHE_DIR, `${id}--${hash}.json`);
    if (USE_CACHE && existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as GenerateResult;
      if (validateMessages(cached.screen.messages).ok) {
        stats.cacheHits++;
        results.set(id, cached);
        return cached.screen;
      }
    }
    stats.genCalls++;
    try {
      const r = await generateScreen(input, { id, budgetMs: 180_000, primaryTimeoutMs: 75_000 });
      stats.genMs.push(r.attempts.reduce((s, a) => s + a.ms, 0));
      results.set(id, r);
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(r));
      process.stdout.write(`  gen ${id} ${r.screen.model} ${secs(r.attempts.reduce((s, a) => s + a.ms, 0))}${r.repaired ? " (repaired)" : ""}${r.warnings.length ? ` [${r.warnings.length} warn]` : ""}\n`);
      return r.screen;
    } catch (e) {
      const details = (e as { details?: unknown }).details;
      stats.genFailures.push(`${id}: ${(e as Error).message}${details ? ` ${JSON.stringify(details).slice(0, 300)}` : ""}`);
      process.stdout.write(`  gen ${id} FAILED: ${(e as Error).message}\n`);
      return null;
    }
  });
  screens.set(id, p);
  return p;
}

/** Step props come from the screen's own data model, so contract checks test what was actually shown. */
function propsFor(nodeId: string, ctx: Context, variant: FareVariant, screen: Screen | null): Record<string, unknown> {
  const fallback = screenInput(nodeId, ctx, variant).carry ?? {};
  const model = screen ? getDataModel(screen.messages) : {};
  const booking = (model.booking && typeof model.booking === "object" ? model.booking : fallback) as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  for (const k of ["pax", "currency", "flightId", "price", "fareSource"]) if (booking[k] !== undefined) props[k] = booking[k];
  if (nodeId === "passengers") props.forms = Array.isArray(model.travelers) ? model.travelers.length : screen ? 0 : props.pax;
  return props;
}

// ---------------------------------------------------------------- sessions
async function runSession(i: number, ctx: Context): Promise<Trace> {
  const rng = mulberry32(SEED * 7919 + i);
  const persona = pick(rng, PERSONAS[ctx.party] ?? PERSONAS.solo);
  const bugSession = BUG && rng() < DRIFT_RATE;
  const steps: Step[] = [];
  const history: string[] = [];
  let node = "intent";
  let fareVariant: FareVariant = "base";
  let outcome: Outcome = "abandoned";

  while (steps.length < MAX_STEPS) {
    const variant: FareVariant = node === "payment" || node === "confirm" ? fareVariant : "base";
    const screen = await getScreen(node, ctx, variant);
    const step: Step = { node, props: propsFor(node, ctx, variant, screen), ...(screen ? { screenId: screen.id } : {}) };
    steps.push(step);
    if (node === "confirm") {
      outcome = "completed";
      break;
    }
    const options = outgoing.get(node) ?? [];

    // System interruptions are not the user's choice.
    const err = options.find((o) => o.kind === "error");
    if (err && rng() < (node === "results" ? SOLD_OUT_RATE : PRICE_CHANGE_RATE)) {
      step.userAction = node === "results" ? "Tapped a fare (system: sold out)" : "Tapped Pay (system: price changed)";
      history.push(`${node}: ${step.userAction}`);
      node = err.to;
      continue;
    }

    const userOptions = options.filter((o) => o.kind !== "error");
    const t = Date.now();
    stats.simCalls++;
    let r;
    try {
      r = await simulateStep({
        persona: persona.description,
        goal: persona.goal,
        context: ctx,
        screen: { nodeId: node, messages: screen?.messages ?? [] },
        options: userOptions.map((o) => ({ to: o.to, kind: o.kind, label: `${o.kind === "next" ? "Continue to" : o.kind === "back" ? "Go back to" : "Change search:"} ${nodeById.get(o.to)?.label ?? o.to}` })),
        history,
      });
      stats.simMs.push(Date.now() - t);
    } catch (e) {
      stats.simFailures++;
      step.userAction = `(simulator error: ${(e as Error).message.slice(0, 80)})`;
      outcome = "error";
      break;
    }
    step.userAction = r.userAction;
    history.push(`${node}: ${r.userAction}`);
    if ("abandon" in r.choice) break;

    const to = r.choice.to;
    if (node === "passengers" && to === "payment" && bugSession) fareVariant = "drift";
    if (node === "price-changed" && to === "payment") fareVariant = "repriced";
    if (to === "results") fareVariant = "base";
    node = to;
  }
  return { id: `llm-${i}`, context: ctx, steps, outcome };
}

// ---------------------------------------------------------------- main
async function main() {
  const contexts = LLM_CONTEXTS.slice(0, N_CONTEXTS);
  console.log(`simulate:llm  sessions=${SESSIONS} contexts=${contexts.length} concurrency=${CONCURRENCY} bug=${BUG} cache=${USE_CACHE}`);
  console.log(`models: ${JSON.stringify(modelSnapshot())}`);

  // (a) one screen per (node, context), plus the fare variants sessions can hit.
  const ta = Date.now();
  const jobs: Promise<unknown>[] = [];
  for (const ctx of contexts) {
    for (const n of flightGraph.nodes) jobs.push(getScreen(n.id, ctx));
    for (const n of ["payment", "confirm"]) {
      jobs.push(getScreen(n, ctx, "repriced"));
      if (BUG) jobs.push(getScreen(n, ctx, "drift"));
    }
  }
  await Promise.all(jobs);
  console.log(`screens: ${screens.size} requested, ${stats.genCalls} generated, ${stats.cacheHits} cached, ${stats.genFailures.length} failed in ${secs(Date.now() - ta)}`);

  // (b) persona sessions.
  const tb = Date.now();
  const traces: Trace[] = new Array(SESSIONS);
  const sessionLimit = limiter(CONCURRENCY);
  let done = 0;
  await Promise.all(
    Array.from({ length: SESSIONS }, (_, i) =>
      sessionLimit(async () => {
        traces[i] = await runSession(i, contexts[i % contexts.length]);
        if (++done % 10 === 0 || done === SESSIONS) process.stdout.write(`  sessions ${done}/${SESSIONS} (${secs(Date.now() - tb)})\n`);
      }),
    ),
  );

  // (d) write the run file with only the screens sessions saw or that were generated.
  const allScreens: Record<string, Screen> = {};
  let valid = 0;
  const invalid: string[] = [];
  for (const p of screens.values()) {
    const s = await p;
    if (!s) continue;
    allScreens[s.id] = s;
    if (validateMessages(s.messages).ok) valid++;
    else invalid.push(s.id);
  }
  for (const r of results.values()) {
    if (r.repaired) stats.repaired++;
    if (r.screen.model !== models.generator) stats.fallback++;
    stats.warnings += r.warnings.length;
  }

  const run: RunFile = { version: 1, domain: "flights", createdAt: new Date().toISOString(), models: modelSnapshot(), graph: flightGraph, traces, screens: allScreens };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(run));
  const size = statSync(OUT).size;

  // Report.
  const folded = foldTraces(flightGraph, traces);
  const report = runChecks(flightGraph, flightInvariants, traces);
  const cov = coverage(flightGraph, folded);
  const by = (o: Outcome) => traces.filter((t) => t.outcome === o).length;
  const avg = (xs: number[]) => (xs.length ? secs(xs.reduce((a, b) => a + b, 0) / xs.length) : "-");
  const bugSessions = traces.filter((t) => t.steps.some((s) => s.screenId?.endsWith("--drift"))).length;

  console.log(`\n--- run ---`);
  console.log(`screens: ${Object.keys(allScreens).length} in run (${valid} pass validateMessages, ${invalid.length} invalid${invalid.length ? `: ${invalid.join(", ")}` : ""}); repaired ${stats.repaired}, fallback model ${stats.fallback}, lint warnings ${stats.warnings}`);
  if (stats.genFailures.length) for (const f of stats.genFailures) console.log(`  generation failed: ${f}`);
  console.log(`generator: ${stats.genCalls} calls, avg ${avg(stats.genMs)}; simulator: ${stats.simCalls} calls, avg ${avg(stats.simMs)}, ${stats.simFailures} failed`);
  console.log(`sessions: ${traces.length}: ${by("completed")} completed, ${by("abandoned")} abandoned, ${by("error")} error; avg ${(traces.reduce((s, t) => s + t.steps.length, 0) / traces.length).toFixed(1)} steps`);
  console.log(`edges exercised: ${cov.edgesExercised}/${cov.edgesTotal}; 95% of traffic on ${cov.edgesFor95} edges`);
  if (cov.untested.length) console.log(`untested: ${cov.untested.join(", ")}`);
  if (folded.unknownEdges.size) console.log(`undeclared edges walked: ${[...folded.unknownEdges.keys()].join(", ")}`);
  console.log(`failures: ${report.failures.length} on edges [${[...report.failingEdges].join(", ")}] nodes [${[...report.failingNodes].join(", ")}]`);
  for (const f of report.failures.slice(0, 6)) console.log(`  ${f.traceId}#${f.stepIndex} ${f.message}`);
  if (BUG) console.log(`seeded drift: ${bugSessions} session(s) reached a drifted payment; caught on passengers->payment: ${report.failingEdges.has("passengers->payment")}`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(size / 1024).toFixed(0)} KB) in ${secs(Date.now() - t0)}`);
  if (invalid.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
