import type {
  BudgetConfig,
  FlowProject,
  PriorityTier,
  RuntimeSettings,
  ScreenNode,
  TierPolicy,
} from '../types/studio';
import { computeExplorationNeed } from '../graph/compiler';

export const PRIORITY_WEIGHTS: Record<PriorityTier, number> = {
  core: 3.0,
  standard: 1.5,
  supporting: 0.5,
};

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  apiKey: '',
  useMockFallback: true,
  models: {
    core: 'gemini-2.5-pro',
    standard: 'gemini-2.5-flash',
    supporting: 'gemini-2.5-flash-lite',
  },
};

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  totalTokenBudget: 250_000,
  tierShares: {
    core: 0.62,
    standard: 0.25,
    supporting: 0.13,
  },
  tierPolicies: {
    core: {
      model: DEFAULT_RUNTIME_SETTINGS.models.core,
      thinkingBudget: 2048,
      defaultVariantCount: 3,
      initialFidelity: 'interactive',
      evaluationDepth: 'deep',
    },
    standard: {
      model: DEFAULT_RUNTIME_SETTINGS.models.standard,
      thinkingBudget: 512,
      defaultVariantCount: 2,
      initialFidelity: 'interactive',
      evaluationDepth: 'standard',
    },
    supporting: {
      model: DEFAULT_RUNTIME_SETTINGS.models.supporting,
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

export interface EffectiveExecutionPolicy {
  tier: PriorityTier;
  model: string;
  thinkingBudget: number;
  variantCount: number;
  evaluationDepth: TierPolicy['evaluationDepth'];
  estimatedTokens: number;
  allocationReason: string;
}

export function resolveExecutionPolicy(
  project: FlowProject,
  settings: RuntimeSettings,
  targetScreen?: ScreenNode | null,
  action: 'disambiguate' | 'generate-flow' | 'generate-variant' | 'point-paint-refine' | 'ux-eval' = 'point-paint-refine'
): EffectiveExecutionPolicy {
  if (action === 'disambiguate') {
    return {
      tier: 'supporting',
      model: settings.models.supporting,
      thinkingBudget: 0,
      variantCount: 0,
      evaluationDepth: 'quick',
      estimatedTokens: 650,
      allocationReason: 'Fast ambiguity check (Flash-Lite) saves ~14k blind generation tokens',
    };
  }

  const tier: PriorityTier = targetScreen?.priority ?? 'core';
  const basePolicy = project.budgetConfig.tierPolicies[tier];
  const configuredModel = settings.models[tier] || basePolicy.model;
  const explorationNeed = targetScreen ? computeExplorationNeed(targetScreen) : 1.2;

  // Exploit-locked screens automatically downgrade to conserve token budget
  if (targetScreen?.policyMode === 'exploit-locked' && action !== 'ux-eval') {
    return {
      tier: 'supporting',
      model: settings.models.supporting,
      thinkingBudget: 0,
      variantCount: 1,
      evaluationDepth: 'quick',
      estimatedTokens: 2100,
      allocationReason: 'Exploit-locked winner — using minimal tokens to preserve Core Explore budget',
    };
  }

  const variantCount =
    action === 'generate-variant'
      ? Math.max(1, Math.min(4, Math.round(basePolicy.defaultVariantCount * Math.min(1.25, explorationNeed))))
      : 1;

  const baseTokenEstimate: Record<typeof action, number> = {
    'generate-flow': 4800,
    'generate-variant': tier === 'core' ? 9200 : tier === 'standard' ? 5400 : 2400,
    'point-paint-refine': tier === 'core' ? 6800 : tier === 'standard' ? 4200 : 2100,
    'ux-eval': tier === 'core' ? 5200 : tier === 'standard' ? 3100 : 1500,
  };

  return {
    tier,
    model: configuredModel,
    thinkingBudget: basePolicy.thinkingBudget,
    variantCount,
    evaluationDepth: basePolicy.evaluationDepth,
    estimatedTokens: baseTokenEstimate[action],
    allocationReason:
      tier === 'core'
        ? `Core UX Focus × Explore (${explorationNeed.toFixed(1)}x) → Pro reasoning tier`
        : tier === 'standard'
        ? 'Standard Flow → Balanced Flash tier'
        : 'Supporting Flow → Lightweight Flash-Lite tier',
  };
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}
