import type {
  BudgetConfig,
  FlowProject,
  LlmTaskConfig,
  LlmTaskKey,
  PriorityTier,
  RuntimeSettings,
  ScreenNode,
  TierPolicy,
  ThinkingLevelSetting,
} from '../types/studio';
import { computeExplorationNeed } from '../graph/compiler';
import { loadEnvRuntimeSettings } from './llmConfig';

export const PRIORITY_WEIGHTS: Record<PriorityTier, number> = {
  core: 3.0,
  standard: 1.5,
  supporting: 0.5,
};

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = loadEnvRuntimeSettings();

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  totalTokenBudget: 250_000,
  tierShares: {
    core: 0.62,
    standard: 0.25,
    supporting: 0.13,
  },
  tierPolicies: {
    core: {
      model: DEFAULT_RUNTIME_SETTINGS.llmTasks.VARIANT_CORE.model,
      thinkingBudget: 0,
      defaultVariantCount: 3,
      initialFidelity: 'interactive',
      evaluationDepth: 'deep',
    },
    standard: {
      model: DEFAULT_RUNTIME_SETTINGS.llmTasks.VARIANT_STANDARD.model,
      thinkingBudget: 0,
      defaultVariantCount: 2,
      initialFidelity: 'interactive',
      evaluationDepth: 'standard',
    },
    supporting: {
      model: DEFAULT_RUNTIME_SETTINGS.llmTasks.VARIANT_SUPPORTING.model,
      thinkingBudget: 0,
      defaultVariantCount: 1,
      initialFidelity: 'skeleton',
      evaluationDepth: 'quick',
    },
  },
};

export interface BudgetSummary {
  totalBudget: number;
  totalSpent: number;
  remaining: number;
  percentUsed: number;
  spentByTier: Record<PriorityTier, number>;
  budgetByTier: Record<PriorityTier, number>;
  coreShareOfSpend: number;
}

export function computeBudgetSummary(project: FlowProject): BudgetSummary {
  const totalBudget = project.budgetConfig.totalTokenBudget;
  const spentByTier: Record<PriorityTier, number> = {
    core: 0,
    standard: 0,
    supporting: 0,
  };

  for (const entry of project.tokenLedger) {
    spentByTier[entry.priority] += entry.totalTokens;
  }

  const totalSpent = spentByTier.core + spentByTier.standard + spentByTier.supporting;
  const remaining = Math.max(0, totalBudget - totalSpent);
  const percentUsed = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
  const coreShareOfSpend = totalSpent > 0 ? Math.round((spentByTier.core / totalSpent) * 100) : 0;

  return {
    totalBudget,
    totalSpent,
    remaining,
    percentUsed,
    spentByTier,
    budgetByTier: {
      core: Math.round(totalBudget * project.budgetConfig.tierShares.core),
      standard: Math.round(totalBudget * project.budgetConfig.tierShares.standard),
      supporting: Math.round(totalBudget * project.budgetConfig.tierShares.supporting),
    },
    coreShareOfSpend,
  };
}

export type PolicyAction =
  | 'disambiguate'
  | 'generate-flow'
  | 'generate-variant'
  | 'point-paint-refine'
  | 'ux-eval'
  | 'simulate-personas';

export interface EffectiveExecutionPolicy {
  taskKey: LlmTaskKey;
  taskConfig: LlmTaskConfig;
  tier: PriorityTier;
  model: string;
  thinkingLevel: ThinkingLevelSetting;
  variantCount: number;
  evaluationDepth: TierPolicy['evaluationDepth'];
  estimatedTokens: number;
  allocationReason: string;
}

/**
 * Selects the exact `.env`-backed LLM Task Config (model + explicit reasoning level + budget)
 * for every LLM call in the Studio based on action stakes, screen priority, and Exploit/Explore state.
 */
export function selectLlmTaskKey(
  action: PolicyAction,
  targetScreen?: ScreenNode | null
): LlmTaskKey {
  if (action === 'disambiguate') return 'DISAMBIGUATE';
  if (action === 'generate-flow') return 'FLOW_ARCHITECT';
  if (action === 'simulate-personas') return 'PERSONA_SIM';

  const isExploitLocked = targetScreen?.policyMode === 'exploit-locked';
  const priority: PriorityTier = targetScreen?.priority ?? 'core';

  if (action === 'generate-variant') {
    if (isExploitLocked || priority === 'supporting') return 'VARIANT_SUPPORTING';
    if (priority === 'standard') return 'VARIANT_STANDARD';
    return 'VARIANT_CORE';
  }

  if (action === 'point-paint-refine') {
    if (!isExploitLocked && priority === 'core') return 'REFINE_CORE';
    return 'REFINE_SMALL';
  }

  // ux-eval
  return priority === 'core' ? 'UX_EVAL_CORE' : 'UX_EVAL_LIGHT';
}

export function resolveExecutionPolicy(
  project: FlowProject,
  settings: RuntimeSettings,
  targetScreen?: ScreenNode | null,
  action: PolicyAction = 'point-paint-refine'
): EffectiveExecutionPolicy {
  const taskKey = selectLlmTaskKey(action, targetScreen);
  const taskConfig = settings.llmTasks[taskKey];

  const tier: PriorityTier =
    action === 'disambiguate'
      ? 'supporting'
      : action === 'generate-flow'
      ? 'core'
      : action === 'simulate-personas'
      ? 'standard'
      : targetScreen?.policyMode === 'exploit-locked' && action !== 'ux-eval'
      ? 'supporting'
      : (targetScreen?.priority ?? 'core');

  const basePolicy = project.budgetConfig.tierPolicies[tier];
  const explorationNeed = targetScreen ? computeExplorationNeed(targetScreen) : 1.2;

  const variantCount =
    action === 'generate-variant'
      ? Math.max(
          1,
          Math.min(4, Math.round(basePolicy.defaultVariantCount * Math.min(1.25, explorationNeed)))
        )
      : action === 'disambiguate'
      ? 0
      : 1;

  const baseTokenEstimate: Record<PolicyAction, number> = {
    disambiguate: 650,
    'generate-flow': 5600,
    'generate-variant': tier === 'core' ? 9200 : tier === 'standard' ? 5400 : 2400,
    'point-paint-refine': tier === 'core' ? 6800 : tier === 'standard' ? 4200 : 2100,
    'ux-eval': tier === 'core' ? 5200 : tier === 'standard' ? 3100 : 1500,
    'simulate-personas': 2400,
  };

  return {
    taskKey,
    taskConfig,
    tier,
    model: taskConfig.model,
    thinkingLevel: taskConfig.thinkingLevel,
    variantCount,
    evaluationDepth: basePolicy.evaluationDepth,
    estimatedTokens: baseTokenEstimate[action],
    allocationReason: `${taskConfig.label} [${taskConfig.model} · thinkingLevel=${taskConfig.thinkingLevel}]`,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}
