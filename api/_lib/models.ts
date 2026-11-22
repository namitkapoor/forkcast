// Central LLM configuration loader.
// Model IDs, reasoning capabilities (thinkingConfig), temperatures, timeouts, and retries are
// sourced from `config.yaml` (git-tracked). Secrets (GEMINI_API_KEY) live in `.env` (gitignored).
// Optional FORKCAST_MODEL_* and GEMINI_*_MODEL env vars can override individual model IDs or levels.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThinkingConfig, ThinkingLevel } from "@google/genai";
import { parse as parseYaml } from "yaml";

export type LlmRole =
  | "generator"
  | "generatorFallback"
  | "editor"
  | "editorCore"
  | "disambiguate"
  | "uxEval"
  | "assistant"
  | "branchPlanner"
  | "simulator"
  | "journeyAssistant"
  | "pinFill"
  | "judge"
  | "judgeFallback"
  | "personaImage"
  | "personaImageFallback"
  | "transcribe"
  | "transcribeFallback";

export type ThinkingLevelSetting = "LOW" | "MEDIUM" | "HIGH" | "XHIGH";
export type ReasoningLevel = "MINIMAL" | ThinkingLevelSetting;

export interface TaskModelConfig {
  model: string;
  thinkingLevel?: ThinkingLevelSetting;
}

export interface ReasoningSpec {
  enabled?: boolean;
  thinkingLevel?: ReasoningLevel | null;
  thinkingBudget?: number | null;
  includeThoughts?: boolean;
}

export interface LlmEntrySpec {
  description?: string;
  model: string;
  reasoning?: ReasoningSpec;
  temperature?: number;
  repairTemperature?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface ResolvedLlmConfig {
  role: LlmRole;
  description: string;
  model: string;
  reasoning: ReasoningSpec;
  thinkingConfig?: ThinkingConfig;
  temperature?: number;
  repairTemperature?: number;
  timeoutMs: number;
  retries: number;
}

interface RawConfigFile {
  llm?: Partial<Record<LlmRole, LlmEntrySpec>>;
}

const ENV_OVERRIDE: Partial<Record<LlmRole, string[]>> = {
  generator: ["FORKCAST_MODEL_GENERATOR", "GEMINI_VARIANT_STANDARD_MODEL"],
  generatorFallback: ["FORKCAST_MODEL_GENERATOR_FALLBACK"],
  editor: ["FORKCAST_MODEL_EDITOR", "GEMINI_REFINE_SMALL_MODEL"],
  editorCore: ["FORKCAST_MODEL_EDITOR_CORE", "GEMINI_REFINE_CORE_MODEL"],
  disambiguate: ["FORKCAST_MODEL_DISAMBIGUATE", "GEMINI_DISAMBIGUATE_MODEL"],
  uxEval: ["FORKCAST_MODEL_UX_EVAL", "GEMINI_UX_EVAL_CORE_MODEL"],
  assistant: ["FORKCAST_MODEL_ASSISTANT"],
  branchPlanner: ["FORKCAST_MODEL_BRANCH_PLANNER"],
  simulator: ["FORKCAST_MODEL_SIMULATOR", "GEMINI_PERSONA_SIM_MODEL"],
  journeyAssistant: ["FORKCAST_MODEL_JOURNEY_ASSISTANT"],
  pinFill: ["FORKCAST_MODEL_PIN_FILL"],
  judge: ["FORKCAST_MODEL_JUDGE"],
  judgeFallback: ["FORKCAST_MODEL_JUDGE_FALLBACK"],
  personaImage: ["FORKCAST_MODEL_PERSONA_IMAGE"],
  personaImageFallback: ["FORKCAST_MODEL_PERSONA_IMAGE_FALLBACK"],
  transcribe: ["FORKCAST_MODEL_TRANSCRIBE", "GEMINI_VOICE_TRANSCRIBE_MODEL"],
  transcribeFallback: ["FORKCAST_MODEL_TRANSCRIBE_FALLBACK"],
};

const VALID_LEVELS = new Set<string>(["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"]);

const firstEnv = (...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
};

function parseLevel(raw: string | undefined, fallback?: ThinkingLevelSetting): ThinkingLevelSetting | undefined {
  const upper = raw?.trim().toUpperCase();
  if (upper === "LOW" || upper === "MEDIUM" || upper === "HIGH" || upper === "XHIGH") return upper;
  return fallback;
}

export function includeThoughtsEnabled(): boolean {
  return process.env.GEMINI_INCLUDE_THOUGHTS?.trim().toLowerCase() === "true";
}

/**
 * Builds a Gemini 4 `thinkingConfig` when the target model is in the `gemini-4-*` series.
 * Safely clamps `XHIGH` to `high` on `gemini-4-carbon` / `gemini-4-argon`.
 */
export function buildThinkingConfig(
  model: string,
  level?: ThinkingLevelSetting,
  includeThoughts = includeThoughtsEnabled(),
): ThinkingConfig | undefined {
  if (!level || !/gemini-4/i.test(model)) return undefined;
  const supportsXHigh = /hydrogen|neon/i.test(model);
  const raw = level === "XHIGH" && !supportsXHigh ? "high" : level.toLowerCase();
  return {
    thinkingLevel: raw as unknown as ThinkingLevel,
    ...(includeThoughts ? { includeThoughts: true } : {}),
  };
}

const FALLBACK_RAW_CONFIG: RawConfigFile = {
  llm: {
    generator: { model: "gemini-4-hydrogen", reasoning: { enabled: true, thinkingLevel: "LOW" }, temperature: 0.8, repairTemperature: 0.3, timeoutMs: 30000, retries: 3 },
    generatorFallback: { model: "gemini-4-argon", reasoning: { enabled: true, thinkingLevel: "LOW" }, temperature: 0.8, repairTemperature: 0.3, timeoutMs: 45000, retries: 2 },
    editor: { model: "gemini-4-hydrogen", reasoning: { enabled: true, thinkingLevel: "LOW" }, temperature: 0.3, repairTemperature: 0.2, timeoutMs: 34000, retries: 2 },
    editorCore: { model: "gemini-4-neon", reasoning: { enabled: true, thinkingLevel: "MEDIUM" }, temperature: 0.3, repairTemperature: 0.2, timeoutMs: 42000, retries: 2 },
    disambiguate: { model: "gemini-4-hydrogen", reasoning: { enabled: true, thinkingLevel: "LOW" }, temperature: 0.2, timeoutMs: 12000, retries: 1 },
    uxEval: { model: "gemini-4-carbon", reasoning: { enabled: true, thinkingLevel: "MEDIUM" }, temperature: 0.2, timeoutMs: 200000, retries: 1 },
    assistant: { model: "gemini-3.5-flash-lite", reasoning: { enabled: true, thinkingLevel: "MINIMAL" }, temperature: 0.3, timeoutMs: 20000, retries: 2 },
    branchPlanner: { model: "gemini-3.5-flash-lite", reasoning: { enabled: true, thinkingLevel: "LOW" }, temperature: 0.4, timeoutMs: 15000, retries: 2 },
    simulator: { model: "gemini-3.5-flash-lite", reasoning: { enabled: true, thinkingLevel: "MINIMAL" }, temperature: 0.9, timeoutMs: 20000, retries: 4 },
    journeyAssistant: { model: "gemini-3.5-flash-lite", reasoning: { enabled: true, thinkingLevel: "LOW" }, temperature: 0.2, timeoutMs: 30000, retries: 6 },
    pinFill: { model: "gemini-3.5-flash-lite", reasoning: { enabled: true, thinkingLevel: "MINIMAL" }, temperature: 0.4, repairTemperature: 0.2, timeoutMs: 45000, retries: 5 },
    judge: { model: "gemini-4-neon", reasoning: { enabled: true, thinkingLevel: "HIGH" }, temperature: 0, timeoutMs: 60000, retries: 3 },
    judgeFallback: { model: "gemini-4-argon", reasoning: { enabled: true, thinkingLevel: "MEDIUM" }, temperature: 0, timeoutMs: 60000, retries: 3 },
    personaImage: { model: "gemini-3.1-flash-image", reasoning: { enabled: false }, timeoutMs: 60000, retries: 2 },
    personaImageFallback: { model: "gemini-2.5-flash-image", reasoning: { enabled: false }, timeoutMs: 60000, retries: 2 },
    transcribe: { model: "gemini-3.5-transcribe", reasoning: { enabled: false }, temperature: 0, timeoutMs: 30000, retries: 2 },
    transcribeFallback: { model: "gemini-3.5-flash-lite", reasoning: { enabled: true, thinkingLevel: "MINIMAL" }, temperature: 0, timeoutMs: 30000, retries: 2 },
  },
};

function findConfigPath(): string | null {
  const explicit = process.env.FORKCAST_CONFIG_PATH?.trim();
  if (explicit && existsSync(explicit)) return path.resolve(explicit);

  const candidates = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

let cachedPath = "";
let cachedMtime = -1;
let cachedConfig: RawConfigFile | null = null;

function loadRawConfig(): RawConfigFile {
  const file = findConfigPath();
  if (!file) return FALLBACK_RAW_CONFIG;
  const mtime = statSync(file).mtimeMs;
  if (cachedConfig && cachedPath === file && cachedMtime === mtime) {
    return cachedConfig;
  }
  const parsed = parseYaml(readFileSync(file, "utf8")) as RawConfigFile | null;
  if (!parsed || typeof parsed !== "object" || !parsed.llm || typeof parsed.llm !== "object") {
    throw new Error(`Invalid config.yaml at ${file}: expected top-level 'llm' mapping`);
  }
  cachedPath = file;
  cachedMtime = mtime;
  cachedConfig = parsed;
  return parsed;
}

export function toThinkingConfig(reasoning?: ReasoningSpec, model?: string): ThinkingConfig | undefined {
  if (!reasoning || reasoning.enabled === false) return undefined;
  const out: ThinkingConfig = {};
  if (reasoning.thinkingLevel && VALID_LEVELS.has(reasoning.thinkingLevel)) {
    if (model && /gemini-4/i.test(model)) {
      const supportsXHigh = /hydrogen|neon/i.test(model);
      const lvl = reasoning.thinkingLevel;
      const mapped =
        lvl === "XHIGH" && !supportsXHigh
          ? "high"
          : lvl === "MINIMAL"
            ? "low"
            : lvl.toLowerCase();
      out.thinkingLevel = mapped as unknown as ThinkingLevel;
    } else {
      out.thinkingLevel = (reasoning.thinkingLevel === "XHIGH" ? "HIGH" : reasoning.thinkingLevel) as ThinkingLevel;
    }
  }
  if (typeof reasoning.thinkingBudget === "number" && Number.isFinite(reasoning.thinkingBudget)) {
    out.thinkingBudget = reasoning.thinkingBudget;
  }
  if (typeof reasoning.includeThoughts === "boolean") {
    out.includeThoughts = reasoning.includeThoughts || includeThoughtsEnabled();
  } else if (includeThoughtsEnabled()) {
    out.includeThoughts = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getLlmConfig(role: LlmRole): ResolvedLlmConfig {
  const raw = loadRawConfig();
  const entry = raw.llm?.[role];
  if (!entry || typeof entry.model !== "string" || !entry.model.trim()) {
    throw new Error(`Missing llm.${role}.model in config.yaml`);
  }
  const envKeys = ENV_OVERRIDE[role] ?? [];
  const envModel = firstEnv(...envKeys);
  const model = envModel || entry.model.trim();
  const reasoning = entry.reasoning ?? { enabled: false };
  return {
    role,
    description: entry.description ?? "",
    model,
    reasoning,
    thinkingConfig: toThinkingConfig(reasoning, model),
    temperature: typeof entry.temperature === "number" ? entry.temperature : undefined,
    repairTemperature: typeof entry.repairTemperature === "number" ? entry.repairTemperature : undefined,
    timeoutMs: typeof entry.timeoutMs === "number" ? entry.timeoutMs : 45_000,
    retries: typeof entry.retries === "number" ? entry.retries : 3,
  };
}

export const models = {
  get generator() {
    return getLlmConfig("generator").model;
  },
  get generatorFallback() {
    return getLlmConfig("generatorFallback").model;
  },
  get simulator() {
    return getLlmConfig("simulator").model;
  },
  get branchPlanner() {
    return getLlmConfig("branchPlanner").model;
  },
  get editor() {
    return getLlmConfig("editor").model;
  },
  get editorCore() {
    return getLlmConfig("editorCore").model;
  },
  get disambiguate() {
    return getLlmConfig("disambiguate").model;
  },
  get uxEvalDeep() {
    return getLlmConfig("uxEval").model;
  },
  get assistant() {
    return getLlmConfig("assistant").model;
  },
  get journeyAssistant() {
    return getLlmConfig("journeyAssistant").model;
  },
  get pinFill() {
    return getLlmConfig("pinFill").model;
  },
  get judge() {
    return getLlmConfig("judge").model;
  },
  get judgeFallback() {
    return getLlmConfig("judgeFallback").model;
  },
  get personaImage() {
    return getLlmConfig("personaImage").model;
  },
  get personaImageFallback() {
    return getLlmConfig("personaImageFallback").model;
  },
  get transcribe() {
    return getLlmConfig("transcribe").model;
  },
  get transcribeFallback() {
    return getLlmConfig("transcribeFallback").model;
  },
};

export const taskConfigs = {
  get editSmall(): TaskModelConfig {
    const cfg = getLlmConfig("editor");
    const cfgLevel = parseLevel(cfg.reasoning.thinkingLevel ?? undefined, "LOW");
    return {
      model: cfg.model,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_EDITOR", "GEMINI_REFINE_SMALL_THINKING_LEVEL"), cfgLevel),
    };
  },
  get editCore(): TaskModelConfig {
    const cfg = getLlmConfig("editorCore");
    const cfgLevel = parseLevel(cfg.reasoning.thinkingLevel ?? undefined, "MEDIUM");
    return {
      model: cfg.model,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_EDITOR_CORE", "GEMINI_REFINE_CORE_THINKING_LEVEL"), cfgLevel),
    };
  },
  get disambiguate(): TaskModelConfig {
    const cfg = getLlmConfig("disambiguate");
    const cfgLevel = parseLevel(cfg.reasoning.thinkingLevel ?? undefined, "LOW");
    return {
      model: cfg.model,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_DISAMBIGUATE", "GEMINI_DISAMBIGUATE_THINKING_LEVEL"), cfgLevel),
    };
  },
  get uxEval(): TaskModelConfig {
    const cfg = getLlmConfig("uxEval");
    const cfgLevel = parseLevel(cfg.reasoning.thinkingLevel ?? undefined, "MEDIUM");
    return {
      model: cfg.model,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_UX_EVAL", "GEMINI_UX_EVAL_CORE_THINKING_LEVEL"), cfgLevel),
    };
  },
  get transcribe(): TaskModelConfig {
    const cfg = getLlmConfig("transcribe");
    return {
      model: cfg.model,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_TRANSCRIBE", "GEMINI_VOICE_TRANSCRIBE_THINKING_LEVEL"), "LOW"),
    };
  },
};

export function modelSnapshot(): Record<string, string> {
  return {
    generator: models.generator,
    generatorFallback: models.generatorFallback,
    simulator: models.simulator,
    branchPlanner: models.branchPlanner,
    editor: models.editor,
    editorCore: models.editorCore,
    assistant: models.assistant,
    disambiguate: models.disambiguate,
    uxEval: models.uxEvalDeep,
    judge: models.judge,
    transcribe: models.transcribe,
  };
}
