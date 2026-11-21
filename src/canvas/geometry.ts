import type { FlowGraph, NodeId } from "../graph/types";
import type { Screen } from "../a2ui/types";

// Section geometry is fixed across zoom levels so the canvas never jumps when the
// semantic level changes: far/mid/near only change what is drawn inside the box.

export const THUMB_W = 140;
export const THUMB_H = Math.round((THUMB_W * 19.5) / 9);
export const CAP_H = 20; // frame name above each phone
export const PAD = 18;
export const GAP = 16;
export const LABEL_H = 36; // section label above the frame
export const FOOT_H = 34;
export const MAX_THUMBS = 4;
export const MIN_FRAME_W = 300;
export const COL_GAP = 240;
export const ROW_GAP = 110;

export interface SectionSize {
  w: number;
  h: number;
  slots: number;
}

export function sectionSize(screenCount: number): SectionSize {
  const slots = screenCount === 0 ? 1 : Math.min(screenCount, MAX_THUMBS);
  const rowW = slots * THUMB_W + (slots - 1) * GAP;
  const w = Math.max(MIN_FRAME_W, rowW + PAD * 2);
  const h = LABEL_H + PAD + CAP_H + THUMB_H + 14 + FOOT_H + PAD - 6;
  return { w, h, slots };
}

/** Screens drawn in a section, in order. The selected screen is always visible. */
export function visibleScreens(screens: Screen[], selectedId?: string): { shown: Screen[]; more: number } {
  if (screens.length <= MAX_THUMBS) return { shown: screens, more: 0 };
  let shown = screens.slice(0, MAX_THUMBS - 1);
  const sel = selectedId ? screens.find((s) => s.id === selectedId) : undefined;
  if (sel && !shown.includes(sel)) shown = [sel, ...shown.slice(0, MAX_THUMBS - 2)];
  return { shown, more: screens.length - shown.length };
}

/** Top-left of slot i (the phone itself, below its caption), relative to the section. */
export function slotOffset(size: SectionSize, i: number) {
  const rowW = size.slots * THUMB_W + (size.slots - 1) * GAP;
  return { x: (size.w - rowW) / 2 + i * (THUMB_W + GAP), y: LABEL_H + PAD + CAP_H };
}

export interface Placed {
  x: number;
  y: number;
  depth: number;
}

/**
 * Domain-agnostic layout: columns by BFS depth from the first node, same-depth nodes
 * stacked vertically. Within a column each node is pulled toward the mean height of its
 * parents, so branches sit to the right of whatever they grew from.
 */
export function layoutGraph(graph: FlowGraph, sizes: Map<NodeId, SectionSize>): Map<NodeId, Placed> {
  const depth = new Map<NodeId, number>();
  const out = new Map<NodeId, NodeId[]>();
  const inc = new Map<NodeId, NodeId[]>();
  for (const t of graph.transitions) {
    out.set(t.from, [...(out.get(t.from) ?? []), t.to]);
    inc.set(t.to, [...(inc.get(t.to) ?? []), t.from]);
  }

  const root = graph.nodes[0]?.id;
  if (root) {
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of out.get(id) ?? []) {
        if (!depth.has(next)) {
          depth.set(next, depth.get(id)! + 1);
          queue.push(next);
        }
      }
    }
  }
  // Nodes unreachable from the root: one column past their deepest known parent, else column 0.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of graph.nodes) {
      if (depth.has(n.id)) continue;
      const parents = (inc.get(n.id) ?? []).filter((p) => depth.has(p));
      if (parents.length) {
        depth.set(n.id, Math.max(...parents.map((p) => depth.get(p)!)) + 1);
        changed = true;
      }
    }
  }
  for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  const maxDepth = Math.max(0, ...depth.values());
  const columns: NodeId[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of graph.nodes) columns[depth.get(n.id)!].push(n.id);

  const placed = new Map<NodeId, Placed>();
  let x = 0;
  columns.forEach((col, d) => {
    const colW = Math.max(MIN_FRAME_W, ...col.map((id) => sizes.get(id)!.w));
    const wanted = col.map((id, order) => {
      const parents = (inc.get(id) ?? []).filter((p) => placed.has(p) && placed.get(p)!.depth < d);
      const h = sizes.get(id)!.h;
      const centre = parents.length
        ? parents.reduce((sum, p) => sum + placed.get(p)!.y + sizes.get(p)!.h / 2, 0) / parents.length
        : order * (h + ROW_GAP) + h / 2;
      return { id, top: centre - h / 2, order };
    });
    wanted.sort((a, b) => a.top - b.top || a.order - b.order);
    let floor = -Infinity;
    for (const w of wanted) {
      const top = Math.max(w.top, floor);
      placed.set(w.id, { x, y: top, depth: d });
      floor = top + sizes.get(w.id)!.h + ROW_GAP;
    }
    x += colW + COL_GAP;
  });
  return placed;
}
