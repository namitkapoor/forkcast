import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StateNode } from "../graph/types";
import type { NodeStats } from "../graph/fold";
import { useZoomLevel } from "./zoom";

export type StateNodeData = {
  state: StateNode;
  stats: NodeStats;
  failing: boolean;
  traceCount: number;
};

export type StateFlowNode = Node<StateNodeData, "state">;

export function StateNodeView({ data }: NodeProps<StateFlowNode>) {
  const level = useZoomLevel();
  const { state, stats, failing, traceCount } = data;
  const reach = traceCount ? Math.round((stats.traces / traceCount) * 100) : 0;
  const completion = stats.traces ? Math.round((stats.completions / stats.traces) * 100) : 0;

  return (
    <div className={`state state--${level}${failing ? " state--failing" : ""}${state.acts ? " state--acts" : ""}`}>
      <Handle type="target" position={Position.Left} />
      {level === "far" && <div className="state__label">{state.label}</div>}

      {level === "mid" && (
        <>
          <div className="state__label">{state.label}</div>
          <div className="state__component">{state.component}</div>
          <dl className="state__stats">
            <dt>reached by</dt>
            <dd>{reach}% of sessions</dd>
            <dt>visits</dt>
            <dd>{stats.visits}</dd>
            <dt>completed</dt>
            <dd>{completion}%</dd>
          </dl>
        </>
      )}

      {level === "near" && (
        <>
          <div className="state__label">{state.label} · {state.component}</div>
          <div className="state__screens">
            {stats.samples.slice(0, 4).map((props, i) => (
              <pre key={i} className="state__screen">{JSON.stringify(props, null, 1)}</pre>
            ))}
            {stats.samples.length === 0 && <div className="state__empty">No screens recorded</div>}
          </div>
        </>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
