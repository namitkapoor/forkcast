import { useMemo } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { edgeKey, type FlowGraph } from "../graph/types";
import type { FoldedGraph } from "../graph/fold";
import type { CheckReport } from "../checks/run";
import { StateNodeView, type StateFlowNode } from "./StateNodeView";

const nodeTypes = { state: StateNodeView };
const COL = 280;
const ROW = 220;

interface Props {
  graph: FlowGraph;
  stages: readonly string[];
  folded: FoldedGraph;
  report: CheckReport;
}

export function Canvas({ graph, stages, folded, report }: Props) {
  const nodes = useMemo<StateFlowNode[]>(() => {
    const perStage = new Map<string, number>();
    return graph.nodes.map((state) => {
      const row = perStage.get(state.stage) ?? 0;
      perStage.set(state.stage, row + 1);
      return {
        id: state.id,
        type: "state",
        position: { x: stages.indexOf(state.stage) * COL, y: row * ROW },
        data: {
          state,
          stats: folded.nodeStats.get(state.id)!,
          failing: report.failingNodes.has(state.id),
          traceCount: folded.traceCount,
        },
      };
    });
  }, [graph, stages, folded, report]);

  const edges = useMemo<Edge[]>(() => {
    const max = Math.max(1, ...folded.edgeCounts.values());
    return graph.transitions.map((tr) => {
      const key = edgeKey(tr.from, tr.to);
      const count = folded.edgeCounts.get(key) ?? 0;
      const failing = report.failingEdges.has(key);
      const color = failing ? "var(--bad)" : count === 0 ? "var(--untested)" : "var(--ok)";
      return {
        id: tr.id,
        source: tr.from,
        target: tr.to,
        label: count ? String(count) : "untested",
        animated: failing,
        style: { stroke: color, strokeWidth: 1 + 7 * Math.sqrt(count / max), strokeDasharray: count ? undefined : "4 4" },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        labelStyle: { fill: color, fontSize: 11 },
        labelBgStyle: { fill: "var(--bg)" },
      };
    });
  }, [graph, folded, report]);

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.1} maxZoom={4}>
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
