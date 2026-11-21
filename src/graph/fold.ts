import { edgeKey, type FlowGraph, type NodeId, type Trace } from "./types";

export interface NodeStats {
  visits: number;
  /** Distinct traces that reached this node at least once. */
  traces: number;
  /** Traces that passed through this node and ended in "completed". */
  completions: number;
  /** A few example props seen here, for the close-up screen view. */
  samples: Record<string, unknown>[];
}

export interface FoldedGraph {
  nodeStats: Map<NodeId, NodeStats>;
  edgeCounts: Map<string, number>;
  /** Steps that moved along an edge the graph does not declare. */
  unknownEdges: Map<string, number>;
  traceCount: number;
}

const MAX_SAMPLES = 6;

/** Collapse many traces into per-node and per-edge counts. */
export function foldTraces(graph: FlowGraph, traces: Trace[]): FoldedGraph {
  const declared = new Set(graph.transitions.map((t) => edgeKey(t.from, t.to)));
  const nodeStats = new Map<NodeId, NodeStats>();
  const edgeCounts = new Map<string, number>();
  const unknownEdges = new Map<string, number>();

  for (const n of graph.nodes) nodeStats.set(n.id, { visits: 0, traces: 0, completions: 0, samples: [] });

  for (const trace of traces) {
    const seen = new Set<NodeId>();
    trace.steps.forEach((step, i) => {
      const stats = nodeStats.get(step.node);
      if (stats) {
        stats.visits++;
        if (stats.samples.length < MAX_SAMPLES) stats.samples.push(step.props);
        seen.add(step.node);
      }
      if (i > 0) {
        const key = edgeKey(trace.steps[i - 1].node, step.node);
        const target = declared.has(key) ? edgeCounts : unknownEdges;
        target.set(key, (target.get(key) ?? 0) + 1);
      }
    });
    for (const id of seen) {
      const stats = nodeStats.get(id)!;
      stats.traces++;
      if (trace.outcome === "completed") stats.completions++;
    }
  }

  return { nodeStats, edgeCounts, unknownEdges, traceCount: traces.length };
}
