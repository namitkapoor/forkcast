// Central LLM configuration loader.
// Model IDs, reasoning capabilities (thinkingConfig), temperatures, timeouts, and retries are
// sourced from `config.yaml` (git-tracked). Secrets (GEMINI_API_KEY) live in `.env` (gitignored).
// Optional FORKCAST_MODEL_* env vars can still override individual model IDs if needed.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThinkingConfig, ThinkingLevel } from "@google/genai";
import { parse as parseYaml } from "yaml";

export type LlmRole =
  | "generator"
  | "generatorFallback"
  | "editor"
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

export type ReasoningLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

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

const ENV_OVERRIDE: Partial<Record<LlmRole, string>> = {
  generator: "FORKCAST_MODEL_GENERATOR",
  generatorFallback: "FORKCAST_MODEL_GENERATOR_FALLBACK",
  editor: "FORKCAST_MODEL_EDITOR",
  assistant: "FORKCAST_MODEL_ASSISTANT",
  branchPlanner: "FORKCAST_MODEL_BRANCH_PLANNER",
  simulator: "FORKCAST_MODEL_SIMULATOR",
  journeyAssistant: "FORKCAST_MODEL_JOURNEY_ASSISTANT",
  pinFill: "FORKCAST_MODEL_PIN_FILL",
  judge: "FORKCAST_MODEL_JUDGE",
  judgeFallback: "FORKCAST_MODEL_JUDGE_FALLBACK",
  personaImage: "FORKCAST_MODEL_PERSONA_IMAGE",
  personaImageFallback: "FORKCAST_MODEL_PERSONA_IMAGE_FALLBACK",
  transcribe: "FORKCAST_MODEL_TRANSCRIBE",
  transcribeFallback: "FORKCAST_MODEL_TRANSCRIBE_FALLBACK",
};

const VALID_LEVELS = new Set<string>(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);

function findConfigPath(): string {
  const explicit = process.env.FORKCAST_CONFIG_PATH?.trim();
  if (explicit && existsSync(explicit)) return path.resolve(explicit);

  const candidates = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../config.yaml"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`config.yaml not found (checked: ${candidates.join(", ")})`);
}

let cachedPath = "";
let cachedMtime = -1;
let cachedConfig: RawConfigFile | null = null;

function loadRawConfig(): RawConfigFile {
  const file = findConfigPath();
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

export function toThinkingConfig(reasoning?: ReasoningSpec): ThinkingConfig | undefined {
  if (!reasoning || reasoning.enabled === false) return undefined;
  const out: ThinkingConfig = {};
  if (reasoning.thinkingLevel && VALID_LEVELS.has(reasoning.thinkingLevel)) {
    out.thinkingLevel = reasoning.thinkingLevel as ThinkingLevel;
  }
  if (typeof reasoning.thinkingBudget === "number" && Number.isFinite(reasoning.thinkingBudget)) {
    out.thinkingBudget = reasoning.thinkingBudget;
  }
  if (typeof reasoning.includeThoughts === "boolean") {
    out.includeThoughts = reasoning.includeThoughts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getLlmConfig(role: LlmRole): ResolvedLlmConfig {
  const raw = loadRawConfig();
  const entry = raw.llm?.[role];
  if (!entry || typeof entry.model !== "string" || !entry.model.trim()) {
    throw new Error(`Missing llm.${role}.model in config.yaml`);
  }
  const envKey = ENV_OVERRIDE[role];
  const envModel = envKey ? process.env[envKey]?.trim() : "";
  const model = envModel || entry.model.trim();
  const reasoning = entry.reasoning ?? { enabled: false };
  return {
    role,
    description: entry.description ?? "",
    model,
    reasoning,
    thinkingConfig: toThinkingConfig(reasoning),
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

export function modelSnapshot(): Record<string, string> {
  return {
    generator: models.generator,
    generatorFallback: models.generatorFallback,
    simulator: models.simulator,
    branchPlanner: models.branchPlanner,
    editor: models.editor,
    assistant: models.assistant,
  };
}
