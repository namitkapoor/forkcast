import { memo, useMemo } from "react";
import { EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useInternalNode, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Journey, Persona } from "../../journeys/types";
import type { IntentGraph } from "./agg";
import { IconPerson } from "../icons";
import { IconLock } from "./icons";
import { cap, laneName, pct, tone } from "./data";

type IntentData = { kind: "intent"; title: string; count: number; lanes: { label: string; count: number; passRate: number; pinned: boolean }[] } | { kind: "terminal"; title: string };
type IntentNode = Node<IntentData, "intent">;
type FlowData = { count: number; failing: number; fromIdx: number; toIdx: number; fromRow: number; toRow: number; bottom: number };
type FlowEdge = Edge<FlowData, "flow">;

const COL = 250;
const ANCHOR_Y = 20; // edges attach at the node header, so nodes of different heights still line up

function IntentNodeView({ data }: NodeProps<IntentNode>) {
  return (
    <div className={data.kind === "terminal" ? "it-term" : "it-node"}>
      <Handle type="target" position={Position.Left} className="sec__handle" />
      <Handle type="source" position={Position.Right} className="sec__handle" />
      {data.kind === "terminal" ? (
        data.title
      ) : (
        <>
          <div className="it-node__head">
            <b>{data.title}</b>
            <span className="it-node__count">
              <IconPerson width={11} height={11} />
              {data.count}
            </span>
          </div>
          <div className="it-lanes">
            {data.lanes.map((l) => (
              <div className="it-lane" key={l.label}>
                <span className="it-lane__who">{l.label}</span>
                <span className="it-lane__n">{l.count}</span>
                <span className={`it-lane__pass tone-${tone(l.passRate)}`}>{pct(l.passRate)}</span>
                <span className="it-lane__pin" title={l.pinned ? "Pinned layout" : undefined}>
                  {l.pinned && <IconLock width={11} height={11} />}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FlowEdgeView({ id, source, target, data }: EdgeProps<FlowEdge>) {
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  if (!sn || !tn || !data) return null;
  const sx = sn.internals.positionAbsolute.x;
  const sy = sn.internals.positionAbsolute.y;
  const sw = sn.measured.width ?? 0;
  const sh = sn.measured.height ?? 0;
  const tx = tn.internals.positionAbsolute.x;
  const ty = tn.internals.positionAbsolute.y;
  const tw = tn.measured.width ?? 0;
  const th = tn.measured.height ?? 0;
  let path: string;
  let mid: { x: number; y: number };
  let arrow: string;
  if (data.toIdx > data.fromIdx) {
    const p0 = { x: sx + sw, y: sy + ANCHOR_Y };
    const p3 = { x: tx, y: ty + ANCHOR_Y };
    const k = Math.max(50, (p3.x - p0.x) * 0.5);
    const span = data.toIdx - data.fromIdx;
    if (span > 1 && data.fromRow === 0 && data.toRow === 0) {
      // Skips along the top row arc over the nodes in between.
      const top = Math.min(sy, ty) - 46 - span * 12;
      const a = { x: sx + sw * 0.6, y: sy };
      const b = { x: tx + tw * 0.4, y: ty };
      path = `M${a.x},${a.y} C${a.x + 30},${top} ${b.x - 30},${top} ${b.x},${b.y}`;
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 8 + (top * 3) / 4 };
      arrow = `M${b.x},${b.y} l-4,-7 l8,0 Z`;
    } else if (span > 1) {
      // Skips from a lower row run underneath the whole tree, so they never cross a node.
      const a = { x: sx + sw * 0.5, y: sy + sh };
      const b = { x: tx + tw * 0.5, y: ty + th };
      const low = data.bottom + 34 + data.fromRow * 18;
      path = `M${a.x},${a.y} C${a.x},${low} ${b.x},${low} ${b.x},${b.y}`;
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 8 + (low * 3) / 4 };
      arrow = `M${b.x},${b.y} l-4,7 l8,0 Z`;
    } else {
      path = `M${p0.x},${p0.y} C${p0.x + k},${p0.y} ${p3.x - k},${p3.y} ${p3.x},${p3.y}`;
      mid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
      arrow = `M${p3.x},${p3.y} l-7,-4 l0,8 Z`;
    }
  } else {
    // Back (or self) edges dip underneath.
    const a = { x: sx + sw * 0.62, y: sy + sh };
    const b = { x: tx + tw * 0.38, y: ty + th };
    const low = Math.max(a.y, b.y) + 40 + Math.abs(a.x - b.x) * 0.08;
    path = `M${a.x},${a.y} C${a.x},${low} ${b.x},${low} ${b.x},${b.y}`;
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 8 + (low * 3) / 4 };
    arrow = `M${b.x},${b.y} l-4,7 l8,0 Z`;
  }
  const status = data.failing > 0 ? "fail" : "pass";
  return (
    <>
      <g className={`noodle noodle--${status}`}>
        <path className="noodle__wire" d={path} style={{ strokeWidth: 1.5, strokeDasharray: status === "fail" ? "8 6" : undefined }} />
        <path className="noodle__arrow" d={arrow} />
      </g>
      <EdgeLabelRenderer>
        <div
          className={`wire-label wire-label--${status} it-label`}
          style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          data-edge={id}
          title={`${data.count} session${data.count === 1 ? "" : "s"}${data.failing ? ` · ${data.failing} failing` : ""}`}
        >
          <IconPerson width={11} height={11} />
          {data.count}
          {data.failing > 0 && <span className="wire-label__fail">· {data.failing} fail</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { intent: memo(IntentNodeView) };
const edgeTypes = { flow: memo(FlowEdgeView) };

const nodeH = (lanes: number) => 40 + 9 + lanes * 22;
const ROW_GAP = 22;

/**
 * Layout: columns by the earliest turn an intent was seen at (so branches stack vertically),
 * nodes inside a column in first-seen order. Query on the left, End on the right.
 */
export function IntentTree({ graph, personas, journeys }: { graph: IntentGraph; personas: Persona[]; journeys: Journey[] }) {
  const { nodes, edges, height } = useMemo(() => {
    const byId = new Map(personas.map((p) => [p.id, p]));
    const colOf = new Map<string, number>();
    for (const j of journeys) j.turns.forEach((t, i) => colOf.set(t.intent, Math.min(colOf.get(t.intent) ?? Infinity, i + 1)));
    const lastCol = Math.max(1, ...graph.nodes.map((n) => colOf.get(n.intent) ?? 1)) + 1;
    const colY = new Map<number, number>();
    const pos = new Map<string, { x: number; y: number }>();
    const rowOf = new Map<string, number>([["start", 0], ["end", 0]]);
    const colRows = new Map<number, number>();
    let maxY = 0;
    for (const n of graph.nodes) {
      const c = colOf.get(n.intent) ?? 1;
      const y = colY.get(c) ?? 0;
      pos.set(n.intent, { x: c * COL, y });
      rowOf.set(n.intent, colRows.get(c) ?? 0);
      colRows.set(c, (colRows.get(c) ?? 0) + 1);
      colY.set(c, y + nodeH(n.lanes.length) + ROW_GAP);
      maxY = Math.max(maxY, y + nodeH(n.lanes.length));
    }
    const idx = new Map<string, number>([["start", 0], ["end", lastCol]]);
    graph.nodes.forEach((n) => idx.set(n.intent, colOf.get(n.intent) ?? 1));
    const nodes: IntentNode[] = [
      { id: "start", type: "intent", position: { x: 60, y: ANCHOR_Y - 13 }, data: { kind: "terminal", title: "Query" }, draggable: false, selectable: false },
      ...graph.nodes.map((n): IntentNode => ({
        id: n.intent,
        type: "intent",
        position: pos.get(n.intent)!,
        draggable: false,
        selectable: false,
        data: { kind: "intent", title: cap(n.intent), count: n.count, lanes: n.lanes.map((l) => ({ label: laneName(byId.get(l.personaId)), count: l.count, passRate: l.passRate, pinned: l.pinned })) },
      })),
      { id: "end", type: "intent", position: { x: lastCol * COL, y: ANCHOR_Y - 13 }, data: { kind: "terminal", title: "End" }, draggable: false, selectable: false },
    ];
    const edges: FlowEdge[] = graph.edges.map((e) => ({
      id: `${e.from}>${e.to}`,
      source: e.from,
      target: e.to,
      type: "flow",
      selectable: false,
      data: { count: e.count, failing: e.failing, fromIdx: idx.get(e.from) ?? 0, toIdx: idx.get(e.to) ?? 0, fromRow: rowOf.get(e.from) ?? 0, toRow: rowOf.get(e.to) ?? 0, bottom: maxY },
    }));
    return { nodes, edges, height: Math.min(600, Math.max(220, maxY + 140)) };
  }, [graph, personas, journeys]);

  return (
    <div className="it-wrap" style={{ height }}>
      <ReactFlowProvider>
        <ReactFlow
          className="it-flow"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        />
      </ReactFlowProvider>
    </div>
  );
}
