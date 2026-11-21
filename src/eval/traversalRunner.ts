import type { FlowProject, TraversalStep, TraversalTrace } from '../types/studio';
import { betaMean } from '../graph/compiler';

const PERSONAS = [
  { label: 'Impatient Mobile-First Buyer', patienceMs: 7500, exploreProb: 0.25 },
  { label: 'Price-Sensitive First-Timer', patienceMs: 11000, exploreProb: 0.45 },
  { label: 'Returning Specialty Brewer', patienceMs: 14000, exploreProb: 0.2 },
  { label: 'Skeptical Subscription Shopper', patienceMs: 8500, exploreProb: 0.5 },
  { label: 'Gift-Seeking Visitor', patienceMs: 10000, exploreProb: 0.6 },
];

/**
 * 1-click Persona Simulation Runner: walks 5 synthetic personas through the current graph,
 * sampling variants via Thompson-like weighting and emitting realistic dwell, dead-click,
 * hesitation, and backtracking telemetry so Tree -> Graph evolution can be inspected live.
 */
export function runSimulatedPersonas(project: FlowProject): TraversalTrace[] {
  const screenList = Object.values(project.screens);
  if (screenList.length === 0) return [];

  // Find root screen (in-degree 0 on non-back edges, or first final-flow screen)
  const incomingCount: Record<string, number> = {};
  for (const s of screenList) incomingCount[s.id] = 0;
  for (const e of Object.values(project.edges)) {
    if (e.edgeType !== 'back' && incomingCount[e.targetScreenId] !== undefined) {
      incomingCount[e.targetScreenId] += 1;
    }
  }
  const startScreen =
    screenList.find((s) => s.isInFinalFlow && incomingCount[s.id] === 0) ??
    screenList.find((s) => s.isInFinalFlow) ??
    screenList[0];

  const traces: TraversalTrace[] = [];

  PERSONAS.forEach((persona, pIdx) => {
    const steps: TraversalStep[] = [];
    let current = startScreen;
    const visited = new Set<string>();
    let completed = false;
    let cursorTime = Date.now() - (5 - pIdx) * 15000;

    for (let hop = 0; hop < 8 && current; hop++) {
      visited.add(current.id);
      const visibleVariants = current.variants.filter((v) => !v.isHidden);
      const candidates = visibleVariants.length > 0 ? visibleVariants : current.variants;

      // Exploit-locked screens always serve their finalized variant; explore screens sample alternatives
      let chosen =
        candidates.find((v) => v.id === current.finalizedVariantId) ??
        candidates.find((v) => v.id === current.activeVariantId) ??
        candidates[0];

      if (current.policyMode !== 'exploit-locked' && candidates.length > 1) {
        const useAlt = Math.random() < persona.exploreProb;
        if (useAlt) {
          chosen = candidates[Math.floor(Math.random() * candidates.length)];
        }
      }

      const openCritical = current.annotations.filter(
        (a) => a.status === 'open' && (a.severity === 'critical' || a.severity === 'warning')
      ).length;
      const qualityPrior = chosen ? betaMean(chosen.banditStats) : 0.6;
      const frictionFactor = Math.max(0.1, 1 - qualityPrior + openCritical * 0.14);

      const dwellMs = Math.round(3200 + frictionFactor * 11500 + Math.random() * 2400);
      const deadClicks = frictionFactor > 0.48 && Math.random() < 0.6 ? Math.ceil(Math.random() * 2) : 0;
      const hesitated = dwellMs > persona.patienceMs || deadClicks >= 2;

      const outgoing = Object.values(project.edges).filter(
        (e) => e.sourceScreenId === current.id
      );

      if (outgoing.length === 0) {
        steps.push({
          screenId: current.id,
          variantId: chosen?.id ?? '',
          enteredAt: cursorTime,
          dwellMs,
          deadClicks,
          hesitated: false,
          backtracked: false,
        });
        completed = true;
        break;
      }

      const backEdge = outgoing.find((e) => e.edgeType === 'back');
      const forwardEdges = outgoing.filter(
        (e) => e.edgeType !== 'back' && !visited.has(e.targetScreenId)
      );
      const finalEdge = forwardEdges.find((e) => e.isFinalFlowEdge);

      let chosenEdge = finalEdge ?? forwardEdges[0] ?? outgoing[0];
      let backtracked = false;

      if (hesitated && backEdge && Math.random() < 0.42) {
        chosenEdge = backEdge;
        backtracked = true;
      } else if (persona.label.includes('Gift') && forwardEdges.some((e) => e.targetScreenId === 'gift')) {
        chosenEdge = forwardEdges.find((e) => e.targetScreenId === 'gift')!;
      } else if (!finalEdge && forwardEdges.length > 1) {
        chosenEdge = forwardEdges[Math.floor(Math.random() * forwardEdges.length)];
      }

      steps.push({
        screenId: current.id,
        variantId: chosen?.id ?? '',
        edgeIdTaken: chosenEdge?.id,
        enteredAt: cursorTime,
        dwellMs,
        deadClicks,
        hesitated,
        backtracked,
      });

      cursorTime += dwellMs;

      if (backtracked) {
        completed = false;
        break;
      }

      const nextScreen = chosenEdge ? project.screens[chosenEdge.targetScreenId] : undefined;
      if (!nextScreen) {
        completed = true;
        break;
      }
      current = nextScreen;
      if (hop === 7) completed = true;
    }

    traces.push({
      id: `trace-sim-${Date.now().toString(36)}-${pIdx}`,
      actor: 'simulated-persona',
      personaLabel: persona.label,
      startedAt: Date.now() - (5 - pIdx) * 15000,
      completed,
      steps,
    });
  });

  return traces;
}
