// Persona contracts, judged: for each turn × applicable judge contract, ask Gemini whether the screen kept the
// promise for that traveler. Verdicts are cached in .cache/judge/ and written into turn.checks as kind "persona".
// Rule contracts and the goal check are re-run too, so the file ends up consistent. Idempotent.
//
// Usage:
//   npm run judge:personas -- --file public/data/journeys.json
//   npm run judge:personas -- --all              # journeys.json, journeys.unpinned.json, journeys.baseline.json
//   flags: --concurrency 4, --cached-only (no network), --dry (don't write)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { loadDotEnv } from "../api/_lib/env";
import { parseJsonLoose } from "../api/_lib/gemini";
import { getLlmConfig } from "../api/_lib/models";
import { summarize } from "../src/journeys/aggregate.js";
import type { JourneysFile } from "../src/journeys/types.js";
import { newStats, rejudgeFile, type JudgeCall } from "./judge-core.js";

loadDotEnv(path.resolve(".env"));

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DATA = "public/data";
const files = flag("all")
  ? ["journeys.baseline.json", "journeys.json", "journeys.unpinned.json"].map((f) => path.join(DATA, f)).filter(existsSync)
  : argv.flatMap((a, i) => (argv[i - 1] === "--file" ? [a] : []));
if (!files.length) {
  console.error("Nothing to do. Pass --file <journeys.json> or --all.");
  process.exit(1);
}

const JUDGE_CONFIGS = [getLlmConfig("judge"), getLlmConfig("judgeFallback")];
const cachedOnly = flag("cached-only");
let client: GoogleGenAI | undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (e: unknown) => (e as { status?: number })?.status;

const call: JudgeCall = async (system, prompt) => {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY missing (expected in .env)");
  client ??= new GoogleGenAI({ apiKey: key });
  let last: unknown;
  for (const cfg of JUDGE_CONFIGS) {
    for (let attempt = 0; attempt < cfg.retries; attempt++) {
      const t0 = Date.now();
      try {
        const res = await client.models.generateContent({
          model: cfg.model,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            temperature: cfg.temperature ?? 0,
            ...(cfg.thinkingConfig ? { thinkingConfig: cfg.thinkingConfig } : {}),
            abortSignal: AbortSignal.timeout(cfg.timeoutMs),
          },
        });
        const text = res.text;
        if (!text) throw new Error(`${cfg.model} returned an empty response`);
        const u = res.usageMetadata;
        return {
          data: parseJsonLoose(text),
          info: { model: cfg.model, ms: Date.now() - t0, inputTokens: u?.promptTokenCount, outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) },
        };
      } catch (e) {
        last = e;
        const s = status(e);
        if (s === 404 || s === 400) break; // model unavailable: go to the fallback
        if (s === 429 || (s !== undefined && s >= 500) || s === undefined) await sleep(1000 * 2 ** attempt);
        else break;
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
};

const stats = newStats();
const t0 = Date.now();
for (const f of files) {
  const file = JSON.parse(readFileSync(f, "utf8")) as JourneysFile;
  const before = summarize(file.journeys);
  const next = await rejudgeFile(file, f, {
    call,
    cacheDir: ".cache/judge",
    stats,
    network: !cachedOnly,
    concurrency: Number(opt("concurrency") ?? 4),
  });
  const after = summarize(next.journeys);
  const perPersona = next.personas
    .map((p) => {
      const cs = next.journeys.filter((j) => j.personaId === p.id).flatMap((j) => j.turns.flatMap((t) => t.checks.filter((c) => c.kind === "persona")));
      return `${p.id} ${cs.filter((c) => c.ok).length}/${cs.length}`;
    })
    .join(", ");
  console.log(
    `${f}: serves ${after.servesRate !== undefined ? `${Math.round(after.servesRate * 100)}%` : "n/a"} (${perPersona}); ` +
      `pass ${Math.round(before.passRate * 100)}% → ${Math.round(after.passRate * 100)}%, goal ${Math.round(after.goalRate * 100)}%` +
      (next.baseline?.summary.servesRate !== undefined ? `; baseline serves ${Math.round(next.baseline.summary.servesRate * 100)}%` : "") +
      (next.previous?.servesRate !== undefined ? `; previous serves ${Math.round(next.previous.servesRate * 100)}%` : ""),
  );
  if (!flag("dry")) writeFileSync(f, JSON.stringify(next));
}

const ms = [...stats.ms].sort((a, b) => a - b);
const q = (p: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0);
console.log(
  `judge: ${stats.calls} calls, ${stats.cached} cached, ${stats.failed} failed; latency p50 ${q(0.5)}ms p90 ${q(0.9)}ms; ` +
    `tokens in ${stats.inputTokens} out ${stats.outputTokens}; models ${JSON.stringify(stats.models)}; wall ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
