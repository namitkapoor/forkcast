import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./intentTree.css";
import type { Intent, Journey, Persona } from "../../journeys/types";
import type { IntentGraph } from "./agg";
import { IconPerson } from "../icons";
import { IconLock } from "./icons";
import { cap, laneName, pct, tone } from "./data";

/** One hero journey drawn on the tree: start → intents… → end, in the persona's color. */
export interface HeroPath {
  personaId: string;
  name: string;
  color: string;
  intents: Intent[];
  /** Index into `intents` the persona is at, or -1 once their journey has ended. */
  current: number;
}

type Here = { personaId: string; color: string; name: string }[];
type IntentData =
  | {
      kind: "intent";
      intent: Intent;
      title: string;
      count: number;
      lanes: {
        label: string;
        count: number;
        passRate: number;
        pinned: boolean;
      }[];
      here: Here;
      open?: (i: Intent) => void;
    }
  | { kind: "terminal"; title: string; here: Here };
type IntentNode = Node<IntentData, "intent">;
type Geo = {
  fromIdx: number;
  toIdx: number;
  fromRow: number;
  toRow: number;
  bottom: number;
};
type FlowData = Geo & { count: number; failing: number };
type HeroData = Geo & {
  color: string;
  offset: number;
  done: boolean;
  anim: number;
};
type FlowEdge = Edge<FlowData, "flow">;
type HeroEdge = Edge<HeroData, "hero">;

const COL = 250;
const ANCHOR_Y = 20; // edges attach at the node header, so nodes of different heights still line up
const DOT_MS = 450;

const ringStyle = (here: Here) =>
  here.length
    ? {
        boxShadow:
          here.map((h, i) => `0 0 0 ${2 + i * 3}px ${h.color}`).join(", ") +
          ", 0 0 18px rgba(0,0,0,0.5)",
      }
    : undefined;
const hereTitle = (here: Here) =>
  here.length ? `Now here: ${here.map((h) => h.name).join(", ")}` : undefined;

function IntentNodeView({ data }: NodeProps<IntentNode>) {
  if (data.kind === "terminal") {
    return (
      <div
        className={`it-term${data.here.length ? " is-here" : ""}`}
        style={ringStyle(data.here)}
        title={hereTitle(data.here)}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="sec__handle"
        />
        <Handle
          type="source"
          position={Position.Right}
          className="sec__handle"
        />
        {data.title}
      </div>
    );
  }
  const open = data.open;
  const onKey = (e: ReactKeyboardEvent) => {
    if (open && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(data.intent);
    }
  };
  return (
    <div
      className={`it-node${open ? " is-clickable" : ""}${data.here.length ? " is-here" : ""}`}
      style={ringStyle(data.here)}
      role={open ? "button" : undefined}
      tabIndex={open ? 0 : undefined}
      onKeyDown={onKey}
      aria-label={
        open ? `${data.title}: show every screen people saw here` : undefined
      }
      data-intent={data.intent}
    >
      <Handle type="target" position={Position.Left} className="sec__handle" />
      <Handle type="source" position={Position.Right} className="sec__handle" />
      <div className="it-node__head">
        <b>{data.title}</b>
        {data.here.length > 0 && (
          <span className="it-here" title={hereTitle(data.here)}>
            {data.here.map((h) => (
              <span
                key={h.personaId}
                className="it-here__dot"
                style={{ background: h.color }}
              />
            ))}
          </span>
        )}
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
            <span className={`it-lane__pass tone-${tone(l.passRate)}`}>
              {pct(l.passRate)}
            </span>
            <span
              className="it-lane__pin"
              title={l.pinned ? "Pinned layout" : undefined}
            >
              {l.pinned && <IconLock width={11} height={11} />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Edge geometry shared by the count edges and the hero paths. */
function geometry(sn: InternalNode, tn: InternalNode, data: Geo) {
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
  return { path, mid, arrow };
}

function FlowEdgeView({ id, source, target, data }: EdgeProps<FlowEdge>) {
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  if (!sn || !tn || !data) return null;
  const { path, mid, arrow } = geometry(sn, tn, data);
  const status = data.failing > 0 ? "fail" : "pass";
  return (
    <>
      <g className={`noodle noodle--${status}`}>
        <path
          className="noodle__wire"
          d={path}
          style={{
            strokeWidth: 1.5,
            strokeDasharray: status === "fail" ? "8 6" : undefined,
          }}
        />
        <path className="noodle__arrow" d={arrow} />
      </g>
      <EdgeLabelRenderer>
        <div
          className={`wire-label wire-label--${status} it-label`}
          style={{
            transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`,
          }}
          data-edge={id}
          title={`${data.count} session${data.count === 1 ? "" : "s"}${data.failing ? ` · ${data.failing} failing` : ""}`}
        >
          <IconPerson width={11} height={11} />
          {data.count}
          {data.failing > 0 && (
            <span className="wire-label__fail">· {data.failing} fail</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** One segment of a hero path; when `anim` changes to a new token, a person-dot runs along it. */
function HeroEdgeView({ source, target, data }: EdgeProps<HeroEdge>) {
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const anim = data?.anim ?? 0;

  useLayoutEffect(() => {
    const p = pathRef.current;
    const dot = dotRef.current;
    if (!anim || !p || !dot || reducedMotion()) return;
    const len = p.getTotalLength();
    const t0 = performance.now();
    let raf = 0;
    const place = (k: number) => {
      const pt = p.getPointAtLength(len * k);
      dot.setAttribute("transform", `translate(${pt.x},${pt.y})`);
    };
    dot.style.display = "";
    place(0);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / DOT_MS);
      place(1 - (1 - k) * (1 - k)); // ease-out
      if (k < 1) raf = requestAnimationFrame(step);
      else dot.style.display = "none";
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      dot.style.display = "none";
    };
  }, [anim]);

  if (!sn || !tn || !data) return null;
  const { path } = geometry(sn, tn, data);
  return (
    <g
      className={`it-hero${data.done ? " is-done" : ""}`}
      transform={`translate(0,${data.offset})`}
      style={{ color: data.color }}
    >
      <path ref={pathRef} className="it-hero__wire" d={path} />
      <g ref={dotRef} className="it-hero__dot" style={{ display: "none" }}>
        <circle r={7} />
        <circle r={3} className="it-hero__dot-core" />
      </g>
    </g>
  );
}

const nodeTypes = { intent: memo(IntentNodeView) };
const edgeTypes = { flow: memo(FlowEdgeView), hero: memo(HeroEdgeView) };

const nodeH = (lanes: number) => 40 + 9 + lanes * 22;
const ROW_GAP = 22;

interface Props {
  graph: IntentGraph;
  personas: Persona[];
  journeys: Journey[];
  /** Hero journeys to light up on the tree, one per persona. */
  heroPaths?: HeroPath[];
  /** The hero's turn index; a +1 step (same paths) animates a dot along the segment each persona just walked. */
  heroTurn?: number;
  /** Clicking an intent node. */
  onNodeOpen?: (intent: Intent) => void;
}

/**
 * Layout: columns by the earliest turn an intent was seen at (so branches stack vertically),
 * nodes inside a column in first-seen order. Query on the left, End on the right.
 */
export function IntentTree({
  graph,
  personas,
  journeys,
  heroPaths = [],
  heroTurn = 0,
  onNodeOpen,
}: Props) {
  const layout = useMemo(() => {
    const colOf = new Map<string, number>();
    for (const j of journeys)
      j.turns.forEach((t, i) =>
        colOf.set(t.intent, Math.min(colOf.get(t.intent) ?? Infinity, i + 1)),
      );
    const lastCol =
      Math.max(1, ...graph.nodes.map((n) => colOf.get(n.intent) ?? 1)) + 1;
    const colY = new Map<number, number>();
    const pos = new Map<string, { x: number; y: number }>();
    const rowOf = new Map<string, number>([
      ["start", 0],
      ["end", 0],
    ]);
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
    const idx = new Map<string, number>([
      ["start", 0],
      ["end", lastCol],
    ]);
    graph.nodes.forEach((n) => idx.set(n.intent, colOf.get(n.intent) ?? 1));
    const geo = (from: string, to: string): Geo => ({
      fromIdx: idx.get(from) ?? 0,
      toIdx: idx.get(to) ?? 0,
      fromRow: rowOf.get(from) ?? 0,
      toRow: rowOf.get(to) ?? 0,
      bottom: maxY,
    });
    return { pos, lastCol, maxY, geo, has: (id: string) => idx.has(id) };
  }, [graph, journeys]);

  // Moving dot: only when the turn steps by exactly +1 on the same set of hero paths.
  const sig = heroPaths
    .map((h) => `${h.personaId}:${h.intents.join(">")}`)
    .join("|");
  const prev = useRef<{ sig: string; turn: number } | null>(null);
  const [anim, setAnim] = useState<{ token: number; turn: number }>({
    token: 0,
    turn: -1,
  });
  useEffect(() => {
    const p = prev.current;
    prev.current = { sig, turn: heroTurn };
    if (p && p.sig === sig && heroTurn === p.turn + 1)
      setAnim((a) => ({ token: a.token + 1, turn: heroTurn }));
  }, [sig, heroTurn]);

  const nodes = useMemo(() => {
    const byId = new Map(personas.map((p) => [p.id, p]));
    const here = new Map<string, Here>();
    for (const h of heroPaths) {
      const at = h.current === -1 ? "end" : h.intents[h.current];
      if (!at) continue;
      here.set(at, [
        ...(here.get(at) ?? []),
        { personaId: h.personaId, color: h.color, name: h.name },
      ]);
    }
    const { pos, lastCol } = layout;
    return [
      {
        id: "start",
        type: "intent",
        position: { x: 60, y: ANCHOR_Y - 13 },
        data: { kind: "terminal", title: "Query", here: [] },
        draggable: false,
        selectable: false,
      },
      ...graph.nodes.map((n): IntentNode => ({
        id: n.intent,
        type: "intent",
        position: pos.get(n.intent)!,
        draggable: false,
        selectable: false,
        data: {
          kind: "intent",
          intent: n.intent,
          title: cap(n.intent),
          count: n.count,
          here: here.get(n.intent) ?? [],
          open: onNodeOpen,
          lanes: n.lanes.map((l) => ({
            label: laneName(byId.get(l.personaId)),
            count: l.count,
            passRate: l.passRate,
            pinned: l.pinned,
          })),
        },
      })),
      {
        id: "end",
        type: "intent",
        position: { x: lastCol * COL, y: ANCHOR_Y - 13 },
        data: { kind: "terminal", title: "End", here: here.get("end") ?? [] },
        draggable: false,
        selectable: false,
      },
    ] satisfies IntentNode[];
  }, [graph, personas, layout, heroPaths, onNodeOpen]);

  const edges = useMemo(() => {
    const flow: FlowEdge[] = graph.edges.map((e) => ({
      id: `${e.from}>${e.to}`,
      source: e.from,
      target: e.to,
      type: "flow",
      selectable: false,
      data: { count: e.count, failing: e.failing, ...layout.geo(e.from, e.to) },
    }));
    const hero: HeroEdge[] = [];
    const n = heroPaths.length;
    heroPaths.forEach((h, i) => {
      const stops = ["start", ...h.intents, "end"];
      const pos = h.current === -1 ? h.intents.length + 1 : h.current + 1; // index into stops
      for (let k = 0; k + 1 < stops.length; k++) {
        const from = stops[k];
        const to = stops[k + 1];
        if (!layout.has(from) || !layout.has(to)) continue;
        hero.push({
          id: `hero:${h.personaId}:${k}`,
          source: from,
          target: to,
          type: "hero",
          selectable: false,
          focusable: false,
          data: {
            ...layout.geo(from, to),
            color: h.color,
            offset: (i - (n - 1) / 2) * 4,
            done: k + 1 <= pos,
            // Segment k leads into stop k+1, i.e. it is walked on turn k (turn 0 = first intent).
            anim: anim.token && anim.turn === k ? anim.token : 0,
          },
        });
      }
    });
    return [...flow, ...hero];
  }, [graph, layout, heroPaths, anim]);

  const height = Math.min(600, Math.max(220, layout.maxY + 140));

  return (
    <div className="it-wrap">
      <div className="it-canvas" style={{ height }}>
        <ReactFlowProvider>
          <ReactFlow
            className="it-flow"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, node) => {
              const d = node.data as IntentData;
              if (d.kind === "intent") onNodeOpen?.(d.intent);
            }}
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
    </div>
  );
}
