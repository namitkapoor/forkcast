import type {
  BanditStats,
  DesignVariant,
  FlowEdge,
  FlowProject,
  ScreenNode,
  TraversalTrace,
} from '../types/studio';

export function betaMean(stats: BanditStats): number {
  const total = stats.alpha + stats.beta;
  return total > 0 ? stats.alpha / total : 0.5;
}

export function betaVariance(stats: BanditStats): number {
  const a = Math.max(0.5, stats.alpha);
  const b = Math.max(0.5, stats.beta);
  return (a * b) / ((a + b) ** 2 * (a + b + 1));
}

export function betaLowerConfidenceBound(stats: BanditStats): number {
  const mean = betaMean(stats);
  const std = Math.sqrt(betaVariance(stats));
  return Math.max(0, mean - 1.28 * std);
}

/**
 * Exploration need in [0.2, 2.0]: higher when variance is high, impressions are low,
 * or recent traversals showed hesitation/backtracking.
 */
export function computeExplorationNeed(screen: ScreenNode): number {
  if (screen.policyMode === 'exploit-locked') return 0.2;
  const active =
    screen.variants.find((v) => v.id === screen.finalizedVariantId) ??
    screen.variants.find((v) => v.id === screen.activeVariantId) ??
    screen.variants[0];
  if (!active) return 1.5;

  const variance = betaVariance(active.banditStats);
  const frictionRate =
    active.banditStats.impressions > 0
      ? (active.banditStats.hesitations + active.banditStats.backtracks * 1.4) /
        active.banditStats.impressions
      : 0.45;
  const evalPenalty = screen.evaluation ? Math.max(0, (82 - screen.evaluation.overallScore) / 60) : 0.35;
  return Math.min(2.0, Math.max(0.35, 0.55 + variance * 8 + frictionRate * 0.9 + evalPenalty));
}

export interface CompiledScreenInsight {
  screenId: string;
  recommendedVariantId: string | null;
  posteriorMean: number;
  uncertainty: number;
  recommendedPolicy: 'exploit-locked' | 'explore';
  isBottleneck: boolean;
  reason: string;
}

export interface CompiledGraphSummary {
  insights: Record<string, CompiledScreenInsight>;
  bottleneckScreenIds: string[];
  exploitLockedIds: string[];
  exploreIds: string[];
}

/**
 * Compiles branching variant explorations and traversal/eval evidence into a
 * consolidated Workflow Graph view (Exploit winners vs. Explore bottlenecks).
 */
export function compileWorkflowGraph(project: FlowProject): CompiledGraphSummary {
  const insights: Record<string, CompiledScreenInsight> = {};
  const bottleneckScreenIds: string[] = [];
  const exploitLockedIds: string[] = [];
  const exploreIds: string[] = [];

  for (const screen of Object.values(project.screens)) {
    const visibleOrAll = screen.variants.length > 0 ? screen.variants : [];
    let bestVariant: DesignVariant | null = null;
    let bestScore = -1;

    for (const v of visibleOrAll) {
      const score = betaMean(v.banditStats);
      if (score > bestScore) {
        bestScore = score;
        bestVariant = v;
      }
    }

    const stats = bestVariant?.banditStats ?? {
      alpha: 2,
      beta: 2,
      impressions: 0,
      completions: 0,
      hesitations: 0,
      backtracks: 0,
      avgDwellMs: 0,
    };

    const mean = betaMean(stats);
    const std = Math.sqrt(betaVariance(stats));
    const lcb = betaLowerConfidenceBound(stats);
    const outgoingEdges = Object.values(project.edges).filter(
      (e) => e.sourceScreenId === screen.id
    );
    const edgeBacktrackRate =
      outgoingEdges.reduce((acc, e) => acc + e.metrics.backtracks, 0) /
      Math.max(
        1,
        outgoingEdges.reduce((acc, e) => acc + e.metrics.traversals, 0)
      );

    const openCriticalPins = screen.annotations.filter(
      (a) => a.status === 'open' && a.severity === 'critical'
    ).length;

    const isBottleneck =
      openCriticalPins > 0 ||
      edgeBacktrackRate >= 0.25 ||
      (stats.impressions >= 3 && mean < 0.65) ||
      (screen.evaluation !== null && screen.evaluation.overallScore < 74);

    const canExploitLock =
      !isBottleneck && stats.impressions >= 4 && lcb >= 0.64 && mean >= 0.76;

    const recommendedPolicy: 'exploit-locked' | 'explore' =
      screen.policyMode === 'exploit-locked' || canExploitLock
        ? 'exploit-locked'
        : 'explore';

    let reason = 'Under-sampled — gather traversals or explore alternatives';
    if (isBottleneck) {
      reason =
        openCriticalPins > 0
          ? `${openCriticalPins} critical UX pin(s) + high friction`
          : edgeBacktrackRate >= 0.25
          ? `High backtrack rate (${Math.round(edgeBacktrackRate * 100)}%) on outgoing edge`
          : `Low empirical reward (${Math.round(mean * 100)}%) — allocate Explore budget`;
      bottleneckScreenIds.push(screen.id);
    } else if (recommendedPolicy === 'exploit-locked') {
      reason = `Proven winner (${Math.round(mean * 100)}% reward across ${stats.impressions} runs)`;
      exploitLockedIds.push(screen.id);
    } else {
      exploreIds.push(screen.id);
    }

    insights[screen.id] = {
      screenId: screen.id,
      recommendedVariantId: bestVariant?.id ?? null,
      posteriorMean: mean,
      uncertainty: std,
      recommendedPolicy,
      isBottleneck,
      reason,
    };
  }

  return {
    insights,
    bottleneckScreenIds,
    exploitLockedIds,
    exploreIds,
  };
}

/**
 * Applies a newly completed TraversalTrace to update Beta(alpha, beta) variant posteriors
 * and FlowEdge traversal/completion/backtrack counts.
 */
export function applyTraceToGraph(
  screens: Record<string, ScreenNode>,
  edges: Record<string, FlowEdge>,
  trace: TraversalTrace
): {
  screens: Record<string, ScreenNode>;
  edges: Record<string, FlowEdge>;
} {
  const nextScreens: Record<string, ScreenNode> = { ...screens };
  const nextEdges: Record<string, FlowEdge> = { ...edges };

  for (const step of trace.steps) {
    const screen = nextScreens[step.screenId];
    if (screen) {
      const nextVariants = screen.variants.map((variant) => {
        if (variant.id !== step.variantId) return variant;
        const s = variant.banditStats;
        const impressions = s.impressions + 1;
        const avgDwellMs = Math.round(
          (s.avgDwellMs * s.impressions + step.dwellMs) / impressions
        );
        const positiveDelta =
          (trace.completed ? 1.0 : 0.35) + (!step.hesitated && !step.backtracked ? 0.65 : 0);
        const negativeDelta =
          (step.hesitated ? 0.9 : 0) +
          (step.backtracked ? 1.2 : 0) +
          Math.min(1.0, step.deadClicks * 0.45);

        return {
          ...variant,
          banditStats: {
            alpha: Number((s.alpha + positiveDelta).toFixed(2)),
            beta: Number((s.beta + negativeDelta).toFixed(2)),
            impressions,
            completions: s.completions + (trace.completed ? 1 : 0),
            hesitations: s.hesitations + (step.hesitated ? 1 : 0),
            backtracks: s.backtracks + (step.backtracked ? 1 : 0),
            avgDwellMs,
          },
        };
      });

      nextScreens[step.screenId] = {
        ...screen,
        variants: nextVariants,
      };
    }

    if (step.edgeIdTaken && nextEdges[step.edgeIdTaken]) {
      const edge = nextEdges[step.edgeIdTaken];
      nextEdges[step.edgeIdTaken] = {
        ...edge,
        metrics: {
          ...edge.metrics,
          traversals: edge.metrics.traversals + 1,
          completions: edge.metrics.completions + (trace.completed ? 1 : 0),
          backtracks: edge.metrics.backtracks + (step.backtracked ? 1 : 0),
        },
      };
    }
  }

  return { screens: nextScreens, edges: nextEdges };
}
