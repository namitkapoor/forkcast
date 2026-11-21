import type { ThinkingConfig, ThinkingLevel } from '@google/genai';
import type {
  LlmTaskConfig,
  LlmTaskKey,
  RuntimeSettings,
  ThinkingLevelSetting,
} from '../types/studio';

function parseLevel(raw: string | undefined, fallback: ThinkingLevelSetting): ThinkingLevelSetting {
  const upper = raw?.trim().toUpperCase();
  if (upper === 'LOW' || upper === 'MEDIUM' || upper === 'HIGH' || upper === 'XHIGH') {
    return upper;
  }
  return fallback;
}

export function getEnvApiKey(): string {
  return (
    import.meta.env.GEMINI_API_KEY?.trim() ||
    import.meta.env.VITE_GEMINI_API_KEY?.trim() ||
    ''
  );
}

export const LLM_TASK_ORDER: LlmTaskKey[] = [
  'DISAMBIGUATE',
  'FLOW_ARCHITECT',
  'VARIANT_CORE',
  'VARIANT_STANDARD',
  'VARIANT_SUPPORTING',
  'REFINE_CORE',
  'REFINE_SMALL',
  'UX_EVAL_CORE',
  'UX_EVAL_LIGHT',
  'PERSONA_SIM',
  'VOICE_TRANSCRIBE',
];

/**
 * Single source of truth for all Gemini 4 series LLM calls in Forkcast Studio.
 * Every model name and explicit reasoning level (LOW | MEDIUM | HIGH | XHIGH)
 * is sourced directly from `.env`.
 */
export function loadEnvLlmTasks(): Record<LlmTaskKey, LlmTaskConfig> {
  const env = import.meta.env;
  return {
    DISAMBIGUATE: {
      key: 'DISAMBIGUATE',
      label: 'Intent & Ambiguity Check',
      stakes: 'low',
      description: 'Fast pre-flight uncertainty scoring & multimodal disambiguation micro-UI controls',
      model: env.GEMINI_DISAMBIGUATE_MODEL?.trim() || 'gemini-4-hydrogen',
      thinkingLevel: parseLevel(env.GEMINI_DISAMBIGUATE_THINKING_LEVEL, 'LOW'),
      envPrefix: 'GEMINI_DISAMBIGUATE',
    },
    FLOW_ARCHITECT: {
      key: 'FLOW_ARCHITECT',
      label: 'User Flow Architect',
      stakes: 'high',
      description: 'Decomposes brief + disambiguation answers into connected screens, edges & Focus Zones',
      model: env.GEMINI_FLOW_ARCHITECT_MODEL?.trim() || 'gemini-4-carbon',
      thinkingLevel: parseLevel(env.GEMINI_FLOW_ARCHITECT_THINKING_LEVEL, 'HIGH'),
      envPrefix: 'GEMINI_FLOW_ARCHITECT',
    },
    VARIANT_CORE: {
      key: 'VARIANT_CORE',
      label: 'Core UX Variant Generator',
      stakes: 'high',
      description: 'High-stakes divergent UI options for screens inside Core UX Focus zones',
      model: env.GEMINI_VARIANT_CORE_MODEL?.trim() || 'gemini-4-neon',
      thinkingLevel: parseLevel(env.GEMINI_VARIANT_CORE_THINKING_LEVEL, 'HIGH'),
      envPrefix: 'GEMINI_VARIANT_CORE',
    },
    VARIANT_STANDARD: {
      key: 'VARIANT_STANDARD',
      label: 'Standard Variant Generator',
      stakes: 'medium',
      description: 'Balanced UI design alternatives for standard priority screens',
      model: env.GEMINI_VARIANT_STANDARD_MODEL?.trim() || 'gemini-4-neon',
      thinkingLevel: parseLevel(env.GEMINI_VARIANT_STANDARD_THINKING_LEVEL, 'MEDIUM'),
      envPrefix: 'GEMINI_VARIANT_STANDARD',
    },
    VARIANT_SUPPORTING: {
      key: 'VARIANT_SUPPORTING',
      label: 'Supporting / Exploit-Locked',
      stakes: 'low',
      description: 'Fast, low-cost expansion for supporting or locked winner screens',
      model: env.GEMINI_VARIANT_SUPPORTING_MODEL?.trim() || 'gemini-4-hydrogen',
      thinkingLevel: parseLevel(env.GEMINI_VARIANT_SUPPORTING_THINKING_LEVEL, 'LOW'),
      envPrefix: 'GEMINI_VARIANT_SUPPORTING',
    },
    REFINE_CORE: {
      key: 'REFINE_CORE',
      label: 'Core Point & Paint Refinement',
      stakes: 'high',
      description: 'Multimodal Point/Paint + @Screen feedback refinement on high-stakes Core UX flows',
      model: env.GEMINI_REFINE_CORE_MODEL?.trim() || 'gemini-4-neon',
      thinkingLevel: parseLevel(env.GEMINI_REFINE_CORE_THINKING_LEVEL, 'HIGH'),
      envPrefix: 'GEMINI_REFINE_CORE',
    },
    REFINE_SMALL: {
      key: 'REFINE_SMALL',
      label: 'Small / Localized Refinement',
      stakes: 'low',
      description: 'Fast localized copy/style edits on standard, supporting, or exploit-locked screens',
      model: env.GEMINI_REFINE_SMALL_MODEL?.trim() || 'gemini-4-hydrogen',
      thinkingLevel: parseLevel(env.GEMINI_REFINE_SMALL_THINKING_LEVEL, 'LOW'),
      envPrefix: 'GEMINI_REFINE_SMALL',
    },
    UX_EVAL_CORE: {
      key: 'UX_EVAL_CORE',
      label: 'Core Multimodal UX Evaluator',
      stakes: 'high',
      description: 'Deep usability, hierarchy, accessibility & cross-screen edge continuity critique',
      model: env.GEMINI_UX_EVAL_CORE_MODEL?.trim() || 'gemini-4-carbon',
      thinkingLevel: parseLevel(env.GEMINI_UX_EVAL_CORE_THINKING_LEVEL, 'HIGH'),
      envPrefix: 'GEMINI_UX_EVAL_CORE',
    },
    UX_EVAL_LIGHT: {
      key: 'UX_EVAL_LIGHT',
      label: 'Light UX Heuristic Check',
      stakes: 'low',
      description: 'Quick structural and heuristic sanity check on secondary screens',
      model: env.GEMINI_UX_EVAL_LIGHT_MODEL?.trim() || 'gemini-4-hydrogen',
      thinkingLevel: parseLevel(env.GEMINI_UX_EVAL_LIGHT_THINKING_LEVEL, 'LOW'),
      envPrefix: 'GEMINI_UX_EVAL_LIGHT',
    },
    PERSONA_SIM: {
      key: 'PERSONA_SIM',
      label: 'Simulated Persona Traversals',
      stakes: 'medium',
      description: 'Synthetic user walkthroughs generating dwell, hesitation & backtracking telemetry',
      model: env.GEMINI_PERSONA_SIM_MODEL?.trim() || 'gemini-4-hydrogen',
      thinkingLevel: parseLevel(env.GEMINI_PERSONA_SIM_THINKING_LEVEL, 'MEDIUM'),
      envPrefix: 'GEMINI_PERSONA_SIM',
    },
    VOICE_TRANSCRIBE: {
      key: 'VOICE_TRANSCRIBE',
      label: 'Streaming Voice Transcription',
      stakes: 'low',
      description: 'Async streaming speech-to-text from microphone audio (gemini-3.5-transcribe or gemini-4-hydrogen)',
      model: env.GEMINI_VOICE_TRANSCRIBE_MODEL?.trim() || 'gemini-3.5-transcribe',
      thinkingLevel: parseLevel(env.GEMINI_VOICE_TRANSCRIBE_THINKING_LEVEL, 'LOW'),
      envPrefix: 'GEMINI_VOICE_TRANSCRIBE',
    },
  };
}

export function loadEnvRuntimeSettings(): RuntimeSettings {
  const envKey = getEnvApiKey();
  const mockOverride = import.meta.env.GEMINI_USE_MOCK_FALLBACK?.trim().toLowerCase();
  const useMockFallback =
    mockOverride === 'true' ? true : mockOverride === 'false' ? false : !envKey;

  return {
    apiKey: envKey,
    useMockFallback,
    includeThoughts: import.meta.env.GEMINI_INCLUDE_THOUGHTS?.trim().toLowerCase() === 'true',
    llmTasks: loadEnvLlmTasks(),
  };
}

/**
 * Builds the Gemini 4 `thinkingConfig` using explicit `thinkingLevel`.
 * Note: `xhigh` is supported on `gemini-4-hydrogen` and `gemini-4-neon`;
 * if set on `gemini-4-carbon` or `gemini-4-argon`, safely clamps to `high`.
 */
export function buildThinkingConfig(
  task: LlmTaskConfig,
  includeThoughts = false
): ThinkingConfig {
  const supportsXHigh = /hydrogen|neon/i.test(task.model);
  const rawLevel =
    task.thinkingLevel === 'XHIGH' && !supportsXHigh
      ? 'high'
      : task.thinkingLevel.toLowerCase();

  return {
    thinkingLevel: rawLevel as unknown as ThinkingLevel,
    ...(includeThoughts ? { includeThoughts: true } : {}),
  };
}
