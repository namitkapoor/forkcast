export type CriticModelId =
  | "gemini-4-carbon"
  | "gemini-4-argon"
  | "gemini-4-neon"
  | "gemini-4-hydrogen";

export type CriticEffort = "LOW" | "MEDIUM" | "HIGH" | "XHIGH";

export interface CriticModelSpec {
  id: CriticModelId;
  label: string;
  shortLabel: string;
  validEfforts: readonly CriticEffort[];
  defaultEffort: CriticEffort;
}

/**
 * Verified valid Gemini 4 series model & thinkingLevel combinations:
 * - Carbon & Argon support: LOW | MEDIUM | HIGH
 * - Neon & Hydrogen support: LOW | MEDIUM | HIGH | XHIGH
 */
export const CRITIC_MODELS: readonly CriticModelSpec[] = [
  {
    id: "gemini-4-carbon",
    label: "Gemini 4 Carbon",
    shortLabel: "Carbon",
    validEfforts: ["LOW", "MEDIUM", "HIGH"],
    defaultEffort: "MEDIUM",
  },
  {
    id: "gemini-4-argon",
    label: "Gemini 4 Argon",
    shortLabel: "Argon",
    validEfforts: ["LOW", "MEDIUM", "HIGH"],
    defaultEffort: "MEDIUM",
  },
  {
    id: "gemini-4-neon",
    label: "Gemini 4 Neon",
    shortLabel: "Neon",
    validEfforts: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
    defaultEffort: "MEDIUM",
  },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    shortLabel: "Hydrogen",
    validEfforts: ["LOW", "MEDIUM", "HIGH", "XHIGH"],
    defaultEffort: "LOW",
  },
] as const;

export const EFFORT_LABELS: Record<CriticEffort, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  XHIGH: "X-High",
};

export interface CriticConfig {
  model: CriticModelId;
  effort: CriticEffort;
}

export const DEFAULT_CRITIC_CONFIG: CriticConfig = {
  model: "gemini-4-carbon",
  effort: "MEDIUM",
};

export function getCriticModelSpec(model?: string | null): CriticModelSpec {
  const lower = model?.trim().toLowerCase();
  return CRITIC_MODELS.find((m) => m.id === lower) ?? CRITIC_MODELS[0];
}

export function isValidCriticModel(model: unknown): model is CriticModelId {
  return typeof model === "string" && CRITIC_MODELS.some((m) => m.id === model);
}

/**
 * Guarantees a 100% valid `(model, effort)` combination:
 * - Unknown models fall back to `gemini-4-carbon`.
 * - If `effort === "XHIGH"` on a model that caps at `"HIGH"` (Carbon / Argon), coerces to `"HIGH"`.
 * - Unknown efforts fall back to the model's `defaultEffort`.
 */
export function normalizeCriticConfig(
  rawModel?: unknown,
  rawEffort?: unknown,
): CriticConfig {
  const spec = isValidCriticModel(rawModel) ? getCriticModelSpec(rawModel) : CRITIC_MODELS[0];
  const upperEffort = typeof rawEffort === "string" ? rawEffort.trim().toUpperCase() : "";

  if ((spec.validEfforts as readonly string[]).includes(upperEffort)) {
    return { model: spec.id, effort: upperEffort as CriticEffort };
  }
  if (upperEffort === "XHIGH" && (spec.validEfforts as readonly string[]).includes("HIGH")) {
    return { model: spec.id, effort: "HIGH" };
  }
  return { model: spec.id, effort: spec.defaultEffort };
}
