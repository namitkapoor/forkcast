import { memo, useEffect, useState } from "react";
import { prefersReducedMotion } from "../ui/storage";
import { useCanvas } from "./context";
import { EdgeLabelRenderer, useInternalNode, useViewportStore, type Edge, type EdgeProps } from "@xyflow/react";

export type EdgeStatus = "fail" | "pass" | "untested";

export type NoodleData = {
  count: number;
  max: number;
  status: EdgeStatus;
  hasContract: boolean;
  failCount: number;
  fromDepth: number;
  toDepth: number;
  kind: string;
  selected: boolean;
  dimmed: boolean;
};

export type NoodleFlowEdge = Edge<NoodleData, "noodle">;

type Pt = { x: number; y: number };
type Dir = "right" | "down" | "up";

interface Geo {
  path: string;
  mid: Pt;
  end: Pt;
  dir: Dir;
  start: Pt;
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): { path: string; mid: Pt } {
  return {
    path: `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
    mid: { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 },
  };
}

type Box = { x: number; y: number; w: number; h: number };

/** Forward wires run right→left like a node network; same-column wires drop vertically; back wires arc underneath. */
function geometry(s: Box, t: Box, fromDepth: number, toDepth: number): Geo {
  if (toDepth > fromDepth) {
    const p0 = { x: s.x + s.w, y: s.y + s.h / 2 };
    const p3 = { x: t.x, y: t.y + t.h / 2 };
    const k = Math.max(80, Math.abs(p3.x - p0.x) * 0.5);
    const c = cubic(p0, { x: p0.x + k, y: p0.y }, { x: p3.x - k, y: p3.y }, p3);
    return { ...c, start: p0, end: p3, dir: "right" };
  }
  if (toDepth === fromDepth) {
    const down = t.y > s.y;
    const off = down ? 34 : -34;
    const p0 = { x: s.x + s.w / 2 + off, y: down ? s.y + s.h : s.y };
    const p3 = { x: t.x + t.w / 2 + off, y: down ? t.y : t.y + t.h };
    const k = Math.max(50, Math.abs(p3.y - p0.y) * 0.45);
    const c = cubic(p0, { x: p0.x, y: p0.y + (down ? k : -k) }, { x: p3.x, y: p3.y - (down ? k : -k) }, p3);
    return { ...c, start: p0, end: p3, dir: down ? "down" : "up" };
  }
  const p0 = { x: s.x + s.w * 0.62, y: s.y + s.h };
  const p3 = { x: t.x + t.w * 0.38, y: t.y + t.h };
  const dip = 90 + Math.abs(p0.x - p3.x) * 0.18;
  const low = Math.max(p0.y, p3.y) + dip;
  const c = cubic(p0, { x: p0.x, y: low }, { x: p3.x, y: low }, p3);
  return { ...c, start: p0, end: p3, dir: "up" };
}

function arrow(end: Pt, dir: Dir, size: number): string {
  const s = size;
  if (dir === "right") return `M${end.x},${end.y} L${end.x - s * 1.6},${end.y - s} L${end.x - s * 1.6},${end.y + s} Z`;
  if (dir === "down") return `M${end.x},${end.y} L${end.x - s},${end.y - s * 1.6} L${end.x + s},${end.y - s * 1.6} Z`;
  return `M${end.x},${end.y} L${end.x - s},${end.y + s * 1.6} L${end.x + s},${end.y + s * 1.6} Z`;
}

function NoodleEdgeView({ id, source, target, data }: EdgeProps<NoodleFlowEdge>) {
  const zoom = useViewportStore((s) => s.transform[2]);
  const { selectEdge, tool } = useCanvas();
  const [drawing, setDrawing] = useState(() => !drawnEdges.has(id) && !prefersReducedMotion());
  // On first load wires follow their source column; later (branches) they follow the new frame.
  const [delay] = useState(() => (performance.now() - BOOT < 4000 ? (data?.fromDepth ?? 0) * 0.12 + 0.9 : 0.75));
  useEffect(() => {
    drawnEdges.add(id);
    if (!drawing) return;
    const t = window.setTimeout(() => setDrawing(false), (delay + 0.85) * 1000);
    return () => window.clearTimeout(t);
  }, [id, drawing, delay]);
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  if (!sn || !tn || !data) return null;
  const box = (n: NonNullable<typeof sn>): Box => ({
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: n.measured.width ?? 0,
    h: n.measured.height ?? 0,
  });
  const g = geometry(box(sn), box(tn), data.fromDepth, data.toDepth);

  const z = Math.max(zoom, 0.05);
  const traffic = data.count ? Math.sqrt(data.count / Math.max(1, data.max)) : 0;
  const screenW = data.status === "untested" ? 1.4 : 1.6 + 7 * traffic;
  const w = screenW / z;
  const cls = `noodle noodle--${data.status}${drawing ? " is-drawing" : ""}${data.selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}`;
  const dash = data.status === "untested" ? `${5 / z} ${5 / z}` : data.status === "fail" ? `${10 / z} ${7 / z}` : undefined;
  const hideLabel = !data.selected && ((data.status === "untested" && zoom < 0.55) || (data.status === "pass" && zoom < 0.16));
  const label =
    data.status === "untested" ? "untested" : data.failCount ? `${data.count} · ${data.failCount} fail` : String(data.count);

  return (
    <>
      <g className={cls}>
        <path className="noodle__glow" d={g.path} style={{ strokeWidth: w + 8 / z }} />
        {drawing ? (
          <path
            className="noodle__wire noodle__wire--draw"
            d={g.path}
            pathLength={1}
            style={{ strokeWidth: w, animationDelay: `${delay}s` }}
          />
        ) : (
          <path
            className="noodle__wire"
            d={g.path}
            style={{ strokeWidth: w, strokeDasharray: dash, ["--dash" as string]: `${-34 / z}px` }}
          />
        )}
        <path className="noodle__hit react-flow__edge-interaction" d={g.path} style={{ strokeWidth: 22 / z }} />
        <circle className="noodle__port" cx={g.start.x} cy={g.start.y} r={3.2 / z} />
        <path className="noodle__arrow" d={arrow(g.end, g.dir, (3 + screenW * 0.35) / z)} />
      </g>
      {!hideLabel && <EdgeLabelRenderer>
        <div
          className={`wire-label${drawing ? " is-drawing" : ""} wire-label--${data.status}${data.selected ? " is-selected" : ""}${data.dimmed ? " is-dimmed" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${g.mid.x}px, ${g.mid.y}px) scale(${1 / z})`,
            animationDelay: drawing ? `${delay + 0.6}s` : undefined,
          }}
          data-edge={id}
          onClick={(e) => {
            e.stopPropagation();
            if (tool !== "hand") selectEdge(id);
          }}
        >
          {label}
        </div>
      </EdgeLabelRenderer>}
    </>
  );
}

const drawnEdges = new Set<string>();
const BOOT = performance.now();

export const NoodleEdge = memo(NoodleEdgeView);
