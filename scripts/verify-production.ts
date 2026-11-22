import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import healthHandler from "../api/health.js";
import { CARBON_TIMEOUT_MS, HttpError } from "../api/_lib/gemini.js";
import { readHistoryFile, resolveHistoryCacheDir, writeHistorySnapshot } from "../api/_lib/historyStore.js";
import { jsonRoute, resetRateLimiterForTests } from "../api/_lib/http.js";
import { getLlmConfig, modelSnapshot, type LlmRole } from "../api/_lib/models.js";
import { createVersionedAnnotation } from "../src/ui/annotations.js";
import type { StorageLike } from "../src/ui/persist.js";
import { loadAnnotations, saveAnnotations } from "../src/ui/storage.js";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`PASS  ${name}`);
  passed++;
}

function createMockRes() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body: unknown = undefined;
  let ended = false;
  const res = {
    setHeader(k: string, v: string) {
      headers.set(k.toLowerCase(), String(v));
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(obj: unknown) {
      body = obj;
      ended = true;
      return res;
    },
    end() {
      ended = true;
      return res;
    },
  };
  return {
    res: res as unknown as VercelResponse,
    get status() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
    header(k: string) {
      return headers.get(k.toLowerCase());
    },
  };
}

class QuotaMockStorage implements StorageLike {
  private map = new Map<string, string>();
  constructor(private maxBytes: number) {}
  get length() {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    const currentTotal = [...this.map.entries()]
      .filter(([ek]) => ek !== k)
      .reduce((sum, [ek, ev]) => sum + ek.length + ev.length, 0);
    if (currentTotal + k.length + v.length > this.maxBytes) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(k, v);
  }
}

async function main() {
  // 1. ESM .js relative import check across all files reachable from api/*.ts
  await check("all runtime relative imports reachable from api/*.ts end in .js", () => {
    const visited = new Set<string>();
    const violations: string[] = [];

    const resolveTs = (fromDir: string, spec: string): string | null => {
      const base = path.resolve(fromDir, spec.replace(/\.js$/, ""));
      for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (existsSync(c)) return c;
      }
      return null;
    };

    const scan = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      const src = readFileSync(file, "utf8");
      const re = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const stmt = m[0];
        const spec = m[1];
        const isTypeOnly = /^(?:import|export)\s+type\b/.test(stmt);
        if (!isTypeOnly && !/\.(js|json|mjs|cjs)$/.test(spec)) {
          violations.push(`${path.relative(process.cwd(), file)} -> "${spec}"`);
        }
        const next = resolveTs(path.dirname(file), spec);
        if (next) scan(next);
      }
    };

    for (const f of readdirSync("api").filter((x) => x.endsWith(".ts"))) {
      scan(path.resolve("api", f));
    }
    assert.ok(visited.size >= 20, "expected to scan api module graph");
    assert.deepEqual(violations, []);
  });

  // 2. vercel.json Hobby-plan compatibility & CARBON_TIMEOUT_MS = 200_000 alignment
  await check("vercel.json bundles config.yaml with Hobby-compatible single pattern and <=60s maxDuration", () => {
    assert.equal(CARBON_TIMEOUT_MS, 200_000);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      functions?: Record<string, { maxDuration?: number; includeFiles?: string }>;
    };
    const fns = vercel.functions ?? {};
    assert.deepEqual(Object.keys(fns), ["api/*.ts"], "avoid overlapping function globs in vercel.json");
    assert.equal(fns["api/*.ts"]?.includeFiles, "config.yaml");
    assert.ok(
      (fns["api/*.ts"]?.maxDuration ?? 0) >= 30 && (fns["api/*.ts"]?.maxDuration ?? 0) <= 60,
      "vercel.json maxDuration must stay <=60s so Vercel Hobby plan pre-build validation passes",
    );
  });

  // 3. All 17 LLM roles resolve from config.yaml
  await check("all 17 LLM roles resolve cleanly from config.yaml", () => {
    const roles: LlmRole[] = [
      "generator",
      "generatorFallback",
      "editor",
      "editorCore",
      "disambiguate",
      "uxEval",
      "assistant",
      "branchPlanner",
      "simulator",
      "journeyAssistant",
      "pinFill",
      "judge",
      "judgeFallback",
      "personaImage",
      "personaImageFallback",
      "transcribe",
      "transcribeFallback",
    ];
    for (const r of roles) {
      const cfg = getLlmConfig(r);
      assert.ok(cfg.model.length > 0, `missing model for ${r}`);
      assert.ok(cfg.timeoutMs >= 5000, `invalid timeoutMs for ${r}`);
    }
    assert.equal(getLlmConfig("uxEval").timeoutMs, 200_000);
    const snap = modelSnapshot();
    assert.ok(snap.editorCore && snap.uxEval && snap.disambiguate);
  });

  // 4. Read-only serverless filesystem fallback + atomic merge in historyStore.ts
  await check("historyStore falls back cleanly on read-only base dirs and merges snapshots atomically", () => {
    const roRoot = mkdtempSync(path.join(os.tmpdir(), "forkcast-ro-test-"));
    const prevVercel = process.env.VERCEL;
    try {
      chmodSync(roRoot, 0o555);
      const resolved = resolveHistoryCacheDir(roRoot);
      assert.ok(resolved.includes("forkcast-cache"), `expected os.tmpdir fallback, got ${resolved}`);

      const rwRoot = mkdtempSync(path.join(os.tmpdir(), "forkcast-rw-test-"));
      delete process.env.VERCEL;
      writeHistorySnapshot(
        {
          chats: { "s-1": [{ id: "m1", text: "first" }] },
          critiques: [{ id: "c1", score: 84 }],
          annotations: {
            "s-1": [{ id: "a1", text: "mask", maskDataUrl: "x".repeat(400_000) }],
          },
          tokenTotal: 1200,
        },
        rwRoot,
      );
      const merged = writeHistorySnapshot(
        {
          chats: { "s-1": [{ id: "m2", text: "second" }] },
          critiques: [{ id: "c2", score: 91 }],
          tokenTotal: 900,
        },
        rwRoot,
      );
      assert.equal(merged.chats["s-1"].length, 2);
      assert.equal(merged.critiques.length, 2);
      assert.equal(merged.tokenTotal, 1200);
      const savedAnn = (readHistoryFile(rwRoot).annotations["s-1"]?.[0] ?? {}) as Record<string, unknown>;
      assert.equal(savedAnn.maskDataUrl, undefined, "oversized >350KB maskDataUrl should be stripped on disk sync");
      rmSync(rwRoot, { recursive: true, force: true });
    } finally {
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      chmodSync(roRoot, 0o755);
      rmSync(roRoot, { recursive: true, force: true });
    }
  });

  // 5. jsonRoute hardening: OPTIONS, 405, 400, 413, 429 rate limiting, and API key redaction
  await check("jsonRoute enforces OPTIONS, 405, 400, 413, 429 rate limits, and secret redaction", async () => {
    resetRateLimiterForTests();
    const route = jsonRoute<{ ping?: string }>(
      async (body) => {
        if (body.ping === "leak") {
          throw new Error("Upstream failed with key AIzaSyD1234567890abcdefghijklmnop");
        }
        if (body.ping === "bad") {
          throw new HttpError(422, "bad input");
        }
        return { pong: body.ping ?? "ok" };
      },
      { maxBodyBytes: 128, rateLimitRpm: 3 },
    );

    // OPTIONS -> 204
    const rOpt = createMockRes();
    await route({ method: "OPTIONS", headers: {} } as unknown as VercelRequest, rOpt.res);
    assert.equal(rOpt.status, 204);

    // GET -> 405
    const rGet = createMockRes();
    await route({ method: "GET", headers: {} } as unknown as VercelRequest, rGet.res);
    assert.equal(rGet.status, 405);

    // Invalid JSON -> 400
    const rBadJson = createMockRes();
    await route({ method: "POST", headers: { "x-forwarded-for": "10.0.0.1" }, body: "{not-json" } as unknown as VercelRequest, rBadJson.res);
    assert.equal(rBadJson.status, 400);

    // Oversized body -> 413
    const rBig = createMockRes();
    await route(
      { method: "POST", headers: { "x-forwarded-for": "10.0.0.2" }, body: JSON.stringify({ ping: "a".repeat(300) }) } as unknown as VercelRequest,
      rBig.res,
    );
    assert.equal(rBig.status, 413);

    // Secret redaction on 500
    const rLeak = createMockRes();
    await route({ method: "POST", headers: { "x-forwarded-for": "10.0.0.3" }, body: { ping: "leak" } } as unknown as VercelRequest, rLeak.res);
    assert.equal(rLeak.status, 500);
    const errText = JSON.stringify(rLeak.body);
    assert.ok(!errText.includes("AIzaSy"), "API key pattern must be redacted from error response");
    assert.ok(errText.includes("[REDACTED]"));

    // Rate limit (rpm = 3 for IP 10.0.0.9)
    for (let i = 0; i < 3; i++) {
      const ok = createMockRes();
      await route({ method: "POST", headers: { "x-forwarded-for": "10.0.0.9" }, body: { ping: "hi" } } as unknown as VercelRequest, ok.res);
      assert.equal(ok.status, 200);
    }
    const limited = createMockRes();
    await route({ method: "POST", headers: { "x-forwarded-for": "10.0.0.9" }, body: { ping: "hi" } } as unknown as VercelRequest, limited.res);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.header("retry-after")) >= 1);
    resetRateLimiterForTests();
  });

  // 6. /api/health contract
  await check("/api/health reports status and model snapshot without exposing secrets", async () => {
    const r = createMockRes();
    await healthHandler({ method: "GET", headers: {} } as unknown as VercelRequest, r.res);
    assert.equal(r.status, 200);
    assert.equal(r.header("cache-control"), "no-store");
    const payload = r.body as { ok: boolean; hasApiKey: boolean; models: Record<string, string> };
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.hasApiKey, "boolean");
    assert.ok(payload.models.generator && payload.models.uxEval);
    assert.ok(!JSON.stringify(payload).includes("AIza"));
  });

  // 7. Quota-resilient browser annotation persistence
  await check("localStorage quota overflow automatically compacts mask PNGs without losing annotations", () => {
    const quotaStore = new QuotaMockStorage(3_000);
    const m1 = createVersionedAnnotation(
      {},
      {
        x: 0.3,
        y: 0.4,
        text: "Make fare card compact",
        kind: "mask",
        maskDataUrl: "data:image/png;base64," + "A".repeat(1800),
      },
    );
    saveAnnotations("s-1", [m1], quotaStore);
    assert.equal(loadAnnotations("s-1", quotaStore).length, 1);

    // Saving a second large mask exceeds the 3,000-byte mock quota unless maskDataUrl is compacted
    const m2 = createVersionedAnnotation(
      { "s-1": [m1] },
      {
        x: 0.5,
        y: 0.6,
        text: "Highlight baggage row",
        kind: "mask",
        maskDataUrl: "data:image/png;base64," + "B".repeat(2200),
      },
    );
    saveAnnotations("s-1", [m1, m2], quotaStore);
    const reloaded = loadAnnotations("s-1", quotaStore);
    assert.equal(reloaded.length, 2);
    assert.equal(reloaded[0].text, "Make fare card compact");
    assert.equal(reloaded[1].text, "Highlight baggage row");
  });

  // 8. Static assets, dead code absence, and production bundle hygiene
  await check("favicon, multi-page HTML entrypoints, and clean dist/ bundle invariants hold", () => {
    assert.ok(existsSync("public/favicon.svg"), "public/favicon.svg must exist");
    assert.ok(!existsSync("src/ui/useBrowserVoice.ts"), "dead useBrowserVoice.ts must stay removed");
    assert.ok(!existsSync("src/ui/VoiceButton.tsx"), "dead VoiceButton.tsx must stay removed");

    if (existsSync("dist/assets")) {
      for (const f of readdirSync("dist/assets")) {
        const full = path.join("dist/assets", f);
        if (f.endsWith(".js")) {
          const sizeBytes = statSync(full).size;
          assert.ok(sizeBytes < 512 * 1024, `bundle chunk ${f} (${Math.round(sizeBytes / 1024)}KB) exceeds 512KB budget`);
          const content = readFileSync(full, "utf8");
          assert.ok(!content.includes("GEMINI_API_KEY"), `${f} must not reference GEMINI_API_KEY`);
        }
      }
    }
  });

  console.log(`\nall ${passed} production checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
