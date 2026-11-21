// Model ids in one place. Each can be overridden by env (FORKCAST_MODEL_*).
// Read lazily so env loaded after import (Vite dev plugin, scripts) still applies.

const env = (k: string, d: string) => process.env[k]?.trim() || d;

export const models = {
  /** Generates A2UI screens. */
  get generator() {
    return env("FORKCAST_MODEL_GENERATOR", "gemini-4-hydrogen");
  },
  /** Used when the generator errors or times out. */
  get generatorFallback() {
    return env("FORKCAST_MODEL_GENERATOR_FALLBACK", "gemini-4-argon");
  },
  /** Simulated users (persona steps), and the quick "what node is this?" planning call in /api/branch. */
  get simulator() {
    return env("FORKCAST_MODEL_SIMULATOR", "gemini-3.5-flash-lite");
  },
  /** Edits an existing screen from a chat instruction (falls back to generatorFallback). */
  get editor() {
    return env("FORKCAST_MODEL_EDITOR", "gemini-4-hydrogen");
  },
  /** Short answers about the run in the chat panel. */
  get assistant() {
    return env("FORKCAST_MODEL_ASSISTANT", "gemini-3.5-flash-lite");
  },
  /** Optional judge (not used yet). */
  get judge() {
    return env("FORKCAST_MODEL_JUDGE", "gemini-4-neon");
  },
};

export function modelSnapshot(): Record<string, string> {
  return {
    generator: models.generator,
    generatorFallback: models.generatorFallback,
    simulator: models.simulator,
    editor: models.editor,
    assistant: models.assistant,
  };
}
