import type { ThinkingConfig, ThinkingLevel } from "@google/genai";

// Model ids and reasoning levels in one place. Honors both FORKCAST_MODEL_* and
// GEMINI_*_MODEL / GEMINI_*_THINKING_LEVEL env variables (read lazily so Vite dev
// middleware and CLI scripts pick up .env loaded after import).

export type ThinkingLevelSetting = "LOW" | "MEDIUM" | "HIGH" | "XHIGH";

export interface TaskModelConfig {
  model: string;
  thinkingLevel?: ThinkingLevelSetting;
}

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

export const models = {
  /** Generates A2UI screens. */
  get generator() {
    return firstEnv("FORKCAST_MODEL_GENERATOR", "GEMINI_VARIANT_STANDARD_MODEL", "GEMINI_VARIANT_CORE_MODEL") ?? "gemini-4-hydrogen";
  },
  /** Used when the generator errors or times out. */
  get generatorFallback() {
    return firstEnv("FORKCAST_MODEL_GENERATOR_FALLBACK") ?? "gemini-4-neon";
  },
  /** Simulated users (persona steps), and the quick "what node is this?" planning call in /api/branch. */
  get simulator() {
    return firstEnv("FORKCAST_MODEL_SIMULATOR", "GEMINI_PERSONA_SIM_MODEL") ?? "gemini-3.5-flash-lite";
  },
  /** Edits an existing screen from a chat instruction (falls back to generatorFallback). */
  get editor() {
    return firstEnv("FORKCAST_MODEL_EDITOR", "GEMINI_REFINE_SMALL_MODEL") ?? "gemini-4-hydrogen";
  },
  /** Higher-reasoning multimodal screen editor used when @Mask PNGs or multiple @Pins are attached. */
  get editorCore() {
    return firstEnv("FORKCAST_MODEL_EDITOR_CORE", "GEMINI_REFINE_CORE_MODEL", "FORKCAST_MODEL_EDITOR") ?? "gemini-4-neon";
  },
  /** Short answers about the run in the chat panel. */
  get assistant() {
    return firstEnv("FORKCAST_MODEL_ASSISTANT") ?? "gemini-3.5-flash-lite";
  },
  /** Journey assistant step: labels the intent and decides tool args. */
  get journeyAssistant() {
    return firstEnv("FORKCAST_MODEL_JOURNEY_ASSISTANT") ?? "gemini-3.5-flash-lite";
  },
  /** Pinned mode: refills a pinned screen's data model from fresh tool results. */
  get pinFill() {
    return firstEnv("FORKCAST_MODEL_PIN_FILL") ?? "gemini-3.5-flash-lite";
  },
  /** Persona judge & interactive UX critique evaluator (Neon by default for snappy <8s interactive critiques). */
  get judge() {
    return firstEnv("FORKCAST_MODEL_JUDGE", "GEMINI_VARIANT_CORE_MODEL") ?? "gemini-4-neon";
  },
  /** Deep UX evaluator model when configured (used with fast Neon/Hydrogen fallback). */
  get uxEvalDeep() {
    return firstEnv("FORKCAST_MODEL_UX_EVAL", "GEMINI_UX_EVAL_CORE_MODEL") ?? "gemini-4-neon";
  },
  /** Fast pre-flight ambiguity & micro-UI disambiguation model. */
  get disambiguate() {
    return firstEnv("FORKCAST_MODEL_DISAMBIGUATE", "GEMINI_DISAMBIGUATE_MODEL") ?? "gemini-4-hydrogen";
  },
  /** Server-side microphone voice transcription model. */
  get transcribe() {
    return firstEnv("FORKCAST_MODEL_TRANSCRIBE", "GEMINI_VOICE_TRANSCRIBE_MODEL") ?? "gemini-3.5-transcribe";
  },
};

export const taskConfigs = {
  get editSmall(): TaskModelConfig {
    return {
      model: models.editor,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_EDITOR", "GEMINI_REFINE_SMALL_THINKING_LEVEL"), "LOW"),
    };
  },
  get editCore(): TaskModelConfig {
    return {
      model: models.editorCore,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_EDITOR_CORE"), "MEDIUM"),
    };
  },
  get disambiguate(): TaskModelConfig {
    return {
      model: models.disambiguate,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_DISAMBIGUATE", "GEMINI_DISAMBIGUATE_THINKING_LEVEL"), "LOW"),
    };
  },
  get uxEval(): TaskModelConfig {
    // Interactive UI critique uses Neon (LOW) by default so responses return in ~4-7s instead of timing out on Carbon HIGH.
    const model = firstEnv("FORKCAST_MODEL_JUDGE") ?? "gemini-4-neon";
    return {
      model,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_UX_EVAL"), "LOW"),
    };
  },
  get transcribe(): TaskModelConfig {
    return {
      model: models.transcribe,
      thinkingLevel: parseLevel(firstEnv("FORKCAST_THINKING_TRANSCRIBE", "GEMINI_VOICE_TRANSCRIBE_THINKING_LEVEL"), "LOW"),
    };
  },
};

export function modelSnapshot(): Record<string, string> {
  return {
    generator: models.generator,
    generatorFallback: models.generatorFallback,
    simulator: models.simulator,
    editor: models.editor,
    editorCore: models.editorCore,
    assistant: models.assistant,
    disambiguate: models.disambiguate,
    judge: models.judge,
    transcribe: models.transcribe,
  };
}
