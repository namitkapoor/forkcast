// Persona-contract judge: core logic shared by scripts/judge-personas.ts and the tests.
// The LLM call is injected, so tests run it against a mock and the cache without touching the network.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { summarize } from "../src/journeys/aggregate.js";
import { checkJourneyGoal, checkTurn, screenDigest } from "../src/journeys/checks.js";
import { PERSONAS } from "../src/journeys/fixtures.js";
import { applicableContracts } from "../src/journeys/personaContracts.js";
import type { CheckResult, Journey, JourneysFile, Persona, PersonaContract, Query, SuiteSummary, Turn } from "../src/journeys/types.js";

/** Bump when the prompt or digest changes so cached verdicts are not reused. */
export const JUDGE_VERSION = "judge-v1";

export interface Verdict {
  pass: boolean;
  reason: string;
  componentId?: string;
}

export interface CallInfo {
  model: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Calls the model with (system, prompt) and returns its parsed JSON plus call info. */
export type JudgeCall = (system: string, prompt: string) => Promise<{ data: unknown; info: CallInfo }>;

export interface JudgeStats {
  calls: number;
  cached: number;
  failed: number;
  ms: number[];
  inputTokens: number;
  outputTokens: number;
  models: Record<string, number>;
}

export const newStats = (): JudgeStats => ({ calls: 0, cached: 0, failed: 0, ms: [], inputTokens: 0, outputTokens: 0, models: {} });

export const JUDGE_SYSTEM = `You are a strict QA reviewer for a travel-booking assistant that generates its UI per traveler.
You get one traveler, one promise ("contract") the screen should keep for that traveler, and a text digest of the screen
(one line per rendered text: componentId (Type) [item N]: text; [on]/[off] are toggle states).
Decide only from what the digest shows. If the screen does not visibly keep the promise, it fails, even if it might elsewhere.
Return JSON only: {"pass": boolean, "reason": string, "componentId": string | null}
- reason: one plain sentence, at most 20 words, naming what is or isn't on screen.
- componentId: on failure, the id of the component most responsible (where the missing thing should be, or the offending element); else null.`;

export function judgePrompt(turn: Pick<Turn, "intent" | "userMessage" | "screen" | "ingredients">, persona: Persona, contract: PersonaContract): string {
  const carry = JSON.stringify(turn.ingredients?.carry ?? {});
  return [
    `Traveler: ${persona.name ?? persona.label} (${persona.label}).`,
    persona.memory ? `What the assistant knows: ${persona.memory}.` : "",
    `About them: ${persona.style}`,
    ``,
    `Contract: "${contract.label}"`,
    contract.rule ? `Meaning: ${contract.rule}` : "",
    ``,
    `This turn the traveler was trying to: ${turn.intent}. They said: "${turn.userMessage}"`,
    `Carried booking state: ${carry.length > 600 ? `${carry.slice(0, 600)}…` : carry}`,
    ``,
    `Screen digest:`,
    turn.screen ? screenDigest(turn.screen) : "(no screen)",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function cacheKey(persona: Persona, contract: PersonaContract, prompt: string): string {
  return createHash("sha256")
    .update(JSON.stringify([JUDGE_VERSION, persona.id, contract.id, contract.label, contract.rule ?? "", prompt]))
    .digest("hex")
    .slice(0, 24);
}

function componentIds(turn: Pick<Turn, "screen">): Set<string> {
  const ids = new Set<string>();
  for (const m of turn.screen?.messages ?? []) {
    const comps = (m as { updateComponents?: { components?: { id?: unknown }[] } }).updateComponents?.components ?? [];
    for (const c of comps) if (typeof c.id === "string") ids.add(c.id);
  }
  return ids;
}

function toVerdict(data: unknown, ids: Set<string>): Verdict {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.pass !== "boolean") throw new Error("judge returned no boolean pass");
  const reason = typeof d.reason === "string" && d.reason.trim() ? d.reason.trim().replace(/\s+/g, " ") : d.pass ? "kept" : "not kept";
  const componentId = typeof d.componentId === "string" && ids.has(d.componentId) ? d.componentId : undefined;
  return { pass: d.pass, reason, ...(componentId && !d.pass ? { componentId } : {}) };
}

export interface JudgeOpts {
  call: JudgeCall;
  cacheDir: string;
  stats?: JudgeStats;
  /** When false, only cached verdicts are used (missing ones are skipped). */
  network?: boolean;
}

/** Judge one (turn, contract). Cached by hash of the prompt in cacheDir. Returns null if not judged. */
export async function judgeOne(
  turn: Pick<Turn, "intent" | "userMessage" | "screen" | "ingredients">,
  persona: Persona,
  contract: PersonaContract,
  opts: JudgeOpts,
): Promise<CheckResult | null> {
  const stats = opts.stats ?? newStats();
  const prompt = judgePrompt(turn, persona, contract);
  const key = cacheKey(persona, contract, prompt);
  const file = path.join(opts.cacheDir, `${key}.json`);
  let verdict: Verdict | undefined;
  if (existsSync(file)) {
    try {
      verdict = (JSON.parse(readFileSync(file, "utf8")) as { verdict: Verdict }).verdict;
      stats.cached++;
    } catch {
      verdict = undefined;
    }
  }
  if (!verdict) {
    if (opts.network === false) return null;
    try {
      const { data, info } = await opts.call(JUDGE_SYSTEM, prompt);
      verdict = toVerdict(data, componentIds(turn));
      stats.calls++;
      stats.ms.push(info.ms);
      stats.inputTokens += info.inputTokens ?? 0;
      stats.outputTokens += info.outputTokens ?? 0;
      stats.models[info.model] = (stats.models[info.model] ?? 0) + 1;
      mkdirSync(opts.cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify({ key, persona: persona.id, contract: contract.id, verdict, info, at: new Date().toISOString() }, null, 1));
    } catch (e) {
      stats.failed++;
      console.warn(`judge failed for ${persona.id}/${contract.id}: ${(e as Error).message}`);
      return null;
    }
  }
  return {
    kind: "persona",
    ok: verdict.pass,
    message: `[judge] ${contract.label}: ${verdict.reason}`,
    ...(verdict.componentId ? { componentId: verdict.componentId } : {}),
    contractId: contract.id,
    source: "judge",
  };
}

/** The file's persona with the current fixture contracts (and name/photo/memory when the file lacks them). */
export function withContracts(p: Persona): Persona {
  const fx = PERSONAS.find((x) => x.id === p.id);
  if (!fx) return p;
  return { ...p, name: p.name ?? fx.name, photo: p.photo ?? fx.photo, memory: p.memory ?? fx.memory, contracts: fx.contracts ?? p.contracts };
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Re-run checkTurn (rule contracts land), the judge contracts and checkJourneyGoal for every journey.
 * Idempotent: old persona and goal checks are dropped before the new ones are added.
 */
export async function rejudgeJourneys(
  journeys: Journey[],
  queries: Query[],
  personas: Persona[],
  opts: JudgeOpts & { concurrency?: number },
): Promise<Journey[]> {
  const qById = new Map(queries.map((q) => [q.id, q]));
  const pById = new Map(personas.map((p) => [p.id, p]));
  const out = journeys.map((j) => {
    const q = qById.get(j.queryId);
    const p = pById.get(j.personaId);
    if (!q || !p) return { ...j, turns: j.turns.map((t) => ({ ...t, checks: (t.checks ?? []).filter((c) => c.kind !== "persona") })) };
    const turns: Turn[] = [];
    for (const t of j.turns) turns.push({ ...t, checks: checkTurn(t, { query: q, persona: p, prevTurns: [...turns] }) });
    return { ...j, turns };
  });

  const jobs: { turn: Turn; persona: Persona; contract: PersonaContract; at: number }[] = [];
  out.forEach((j) => {
    const p = pById.get(j.personaId);
    for (const t of j.turns) for (const c of applicableContracts(p, t.intent, "judge")) jobs.push({ turn: t, persona: p!, contract: c, at: jobs.length });
  });
  const results = new Map<Turn, { at: number; r: CheckResult }[]>();
  await pool(jobs, opts.concurrency ?? 4, async (job) => {
    const r = await judgeOne(job.turn, job.persona, job.contract, opts);
    if (r) results.set(job.turn, [...(results.get(job.turn) ?? []), { at: job.at, r }]);
  });
  for (const j of out) for (const t of j.turns) t.checks.push(...(results.get(t) ?? []).sort((a, b) => a.at - b.at).map((x) => x.r));

  return out.map((j) => {
    const q = qById.get(j.queryId);
    const p = pById.get(j.personaId);
    if (!q || !p || !j.turns.length) return j;
    const { goalMet, result } = checkJourneyGoal(j, q, p);
    const last = j.turns[j.turns.length - 1];
    last.checks = [...last.checks.filter((c) => c.kind !== "goal"), result];
    return { ...j, goalMet };
  });
}

/** Persona fields of a summary, merged into one that describes another run (other fields untouched). */
export function mergePersonaSummary(target: SuiteSummary, from: SuiteSummary): SuiteSummary {
  return {
    ...target,
    failingChecks: { ...target.failingChecks, persona: from.failingChecks.persona ?? 0 },
    ...(from.servesRate !== undefined ? { servesRate: from.servesRate, personaChecks: from.personaChecks } : {}),
  };
}

/** Rejudge a whole JourneysFile in place and refresh the persona fields of `baseline`/`previous` from their source runs. */
export async function rejudgeFile(
  file: JourneysFile,
  filePath: string,
  opts: JudgeOpts & { concurrency?: number },
): Promise<JourneysFile> {
  const personas = file.personas.map(withContracts);
  const journeys = await rejudgeJourneys(file.journeys, file.queries, personas, opts);
  const next: JourneysFile = { ...file, personas, journeys };
  const dir = path.dirname(filePath);

  // baseline.file is a URL like /data/journeys.baseline.json; it lives next to this file.
  if (file.baseline?.file) {
    const src = path.join(dir, path.basename(file.baseline.file));
    if (existsSync(src) && path.resolve(src) !== path.resolve(filePath)) {
      const b = JSON.parse(readFileSync(src, "utf8")) as JourneysFile;
      const bj = await rejudgeJourneys(b.journeys, b.queries, b.personas.map(withContracts), opts);
      next.baseline = { ...file.baseline, summary: mergePersonaSummary(file.baseline.summary, summarize(bj)) };
    }
  }
  // previous: the pre-convergence run, when journeys.before.json is that run (same journey count and pass rate).
  if (file.previous) {
    const src = path.join(dir, "journeys.before.json");
    if (existsSync(src)) {
      const b = JSON.parse(readFileSync(src, "utf8")) as JourneysFile;
      const orig = summarize(b.journeys);
      if (orig.journeys === file.previous.journeys && Math.abs(orig.passRate - file.previous.passRate) < 1e-9) {
        const bj = await rejudgeJourneys(b.journeys, b.queries, b.personas.map(withContracts), opts);
        next.previous = mergePersonaSummary(file.previous, summarize(bj));
      }
    }
  }
  return next;
}
