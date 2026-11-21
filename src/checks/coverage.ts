import { edgeKey, type FlowGraph } from "../graph/types";
import type { FoldedGraph } from "../graph/fold";

export interface Coverage {
  edgesTotal: number;
  edgesExercised: number;
  /** Declared edges no trace has walked: the untested tail. */
  untested: string[];
  /** Fewest edges (by traffic) whose traversals add up to 95% of all traversals. */
  edgesFor95: number;
}

export function coverage(graph: FlowGraph, folded: FoldedGraph): Coverage {
  const keys = graph.transitions.map((t) => edgeKey(t.from, t.to));
  const counts = keys.map((k) => folded.edgeCounts.get(k) ?? 0).sort((a, b) => b - a);
  const total = counts.reduce((a, b) => a + b, 0);

  let running = 0;
  let edgesFor95 = 0;
  for (const c of counts) {
    if (total === 0 || running >= total * 0.95) break;
    running += c;
    edgesFor95++;
  }

  return {
    edgesTotal: keys.length,
    edgesExercised: counts.filter((c) => c > 0).length,
    untested: keys.filter((k) => !folded.edgeCounts.get(k)),
    edgesFor95,
  };
}
