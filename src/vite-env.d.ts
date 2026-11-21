/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_INCLUDE_THOUGHTS?: string;
  readonly GEMINI_USE_MOCK_FALLBACK?: string;

  // 1. Intent & Ambiguity Check
  readonly GEMINI_DISAMBIGUATE_MODEL?: string;
  readonly GEMINI_DISAMBIGUATE_THINKING_LEVEL?: string;

  // 2. User Flow Architect
  readonly GEMINI_FLOW_ARCHITECT_MODEL?: string;
  readonly GEMINI_FLOW_ARCHITECT_THINKING_LEVEL?: string;

  // 3. Variant Generation — Core UX Focus
  readonly GEMINI_VARIANT_CORE_MODEL?: string;
  readonly GEMINI_VARIANT_CORE_THINKING_LEVEL?: string;

  // 4. Variant Generation — Standard Flow
  readonly GEMINI_VARIANT_STANDARD_MODEL?: string;
  readonly GEMINI_VARIANT_STANDARD_THINKING_LEVEL?: string;

  // 5. Variant Generation — Supporting / Exploit-Locked
  readonly GEMINI_VARIANT_SUPPORTING_MODEL?: string;
  readonly GEMINI_VARIANT_SUPPORTING_THINKING_LEVEL?: string;

  // 6. Core Point & Paint / @Screen Refinement
  readonly GEMINI_REFINE_CORE_MODEL?: string;
  readonly GEMINI_REFINE_CORE_THINKING_LEVEL?: string;

  // 7. Small / Localized Refinement
  readonly GEMINI_REFINE_SMALL_MODEL?: string;
  readonly GEMINI_REFINE_SMALL_THINKING_LEVEL?: string;

  // 8. Core Multimodal UX Evaluator
  readonly GEMINI_UX_EVAL_CORE_MODEL?: string;
  readonly GEMINI_UX_EVAL_CORE_THINKING_LEVEL?: string;

  // 9. Light UX Heuristic Check
  readonly GEMINI_UX_EVAL_LIGHT_MODEL?: string;
  readonly GEMINI_UX_EVAL_LIGHT_THINKING_LEVEL?: string;

  // 10. Simulated Persona Traversals
  readonly GEMINI_PERSONA_SIM_MODEL?: string;
  readonly GEMINI_PERSONA_SIM_THINKING_LEVEL?: string;

  // 11. Streaming Voice Audio Transcription
  readonly GEMINI_VOICE_TRANSCRIBE_MODEL?: string;
  readonly GEMINI_VOICE_TRANSCRIBE_THINKING_LEVEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
