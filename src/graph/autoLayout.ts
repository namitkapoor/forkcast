import dagre from '@dagrejs/dagre';
import type { CanvasViewMode, DevicePreset, FlowEdge, ScreenNode } from '../types/studio';

export function getScreenCardDimensions(devicePreset: DevicePreset) {
  // Visual card dimensions on the React Flow canvas (iframe inside is smoothly scaled)
  if (devicePreset === 'desktop') {
    return { width: 420, height: 375 };
  }
  return { width: 280, height: 470 };
}

export function computeAutoLayout(
  screens: Record<string, ScreenNode>,
  edges: Record<string, FlowEdge>,
  viewMode: CanvasViewMode,
  devicePreset: DevicePreset
): Record<string, { x: number; y: number }> {
  if (viewMode === 'free') {
    const preserved: Record<string, { x: number; y: number }> = {};
    for (const screen of Object.values(screens)) {
      preserved[screen.id] = screen.position;
    }
    return preserved;
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  const { width, height } = getScreenCardDimensions(devicePreset);
  const rankdir = viewMode === 'tree' ? 'TB' : 'LR';

  g.setGraph({
    rankdir,
    nodesep: viewMode === 'tree' ? 95 : 85,
    ranksep: viewMode === 'tree' ? 120 : 140,
    edgesep: 35,
    marginx: 40,
    marginy: 40,
  });

  for (const screen of Object.values(screens)) {
    g.setNode(screen.id, { width, height });
  }

  for (const edge of Object.values(edges)) {
    if (screens[edge.sourceScreenId] && screens[edge.targetScreenId]) {
      // Avoid layout cycle inversion for explicit 'back' edges so flow stays clean left-to-right
      if (edge.edgeType === 'back') continue;
      g.setEdge(edge.sourceScreenId, edge.targetScreenId, {
        weight: edge.isFinalFlowEdge ? 4 : 1,
      });
    }
  }

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const screen of Object.values(screens)) {
    const node = g.node(screen.id);
    if (node) {
      positions[screen.id] = {
        x: Math.round(node.x - width / 2),
        y: Math.round(node.y - height / 2),
      };
    } else {
      positions[screen.id] = screen.position;
    }
  }

  return positions;
}
