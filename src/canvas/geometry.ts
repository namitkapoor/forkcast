import type { FlowGraph, NodeId } from "../graph/types";
import type { Screen } from "../a2ui/types";

// Section geometry is fixed across zoom levels so the canvas never jumps when the
// semantic level changes: far/mid/near only change what is drawn inside the box.

export const THUMB_W = 168;
export const THUMB_H = Math.round((THUMB_W * 19.5) / 9);
export const CAP_H = 22; // frame label above each phone (device icon + name)
export const PAD = 12;
export const GAP = 18;
export const MORE_H = 44;
export const MAX_THUMBS = 3;
export const COL_GAP = 210;
export const ROW_GAP = 96;

export interface SectionSize {
  w: number;
  h: number;
  slots: number;
  more: number;
}

/** A step is a column of screens: up to MAX_THUMBS phones stacked, then a "+N more" row. */
export function sectionSize(screenCount: number): SectionSize {
  const slots = screenCount === 0 ? 1 : Math.min(screenCount, MAX_THUMBS);
  const more = Math.max(0, screenCount - slots);
  const w = THUMB_W + PAD * 2;
  const h = PAD + slots * (CAP_H + THUMB_H) + (slots - 1) * GAP + PAD + (more ? MORE_H : 0);
  return { w, h, slots, more };
}

/** Screens drawn in a step, in order. The selected screen is always visible. */
export function visibleScreens(screens: Screen[], selectedId?: string): { shown: Screen[]; more: number } {
  if (screens.length <= MAX_THUMBS) return { shown: screens, more: 0 };
  let shown = screens.slice(0, MAX_THUMBS);
  const sel = selectedId ? screens.find((s) => s.id === selectedId) : undefined;
  if (sel && !shown.includes(sel)) shown = [sel, ...shown.slice(0, MAX_THUMBS - 1)];
  return { shown, more: screens.length - shown.length };
}

/** Top-left of slot i (the phone itself, below its label), relative to the step. */
export function slotOffset(_size: SectionSize, i: number) {
  return { x: PAD, y: PAD + i * (CAP_H + THUMB_H + GAP) + CAP_H };
}

export interface Placed {
  x: number;
  y: number;
  depth: number;
}

/**
 * Domain-agnostic layout: columns by longest forward path, same-depth nodes stacked vertically. Within a column each node is pulled toward the mean height of its
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

  // Columns = longest path over forward edges, where "forward" follows the declared node order
  // (stage order: intent → search → results …). Back/refine edges don't pull nodes left, so the
  // happy path reads as one row of steps and detours (sold out, price changed) sit beside it.
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  for (const n of graph.nodes) {
    const parents = (inc.get(n.id) ?? []).filter((p) => (index.get(p) ?? Infinity) < index.get(n.id)!);
    depth.set(n.id, parents.length ? Math.max(...parents.map((p) => depth.get(p) ?? 0)) + 1 : 0);
  }
  const maxDepth = Math.max(0, ...depth.values());
  const columns: NodeId[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of graph.nodes) columns[depth.get(n.id)!].push(n.id);

  const placed = new Map<NodeId, Placed>();
  let x = 0;
  columns.forEach((col, d) => {
    const colW = Math.max(0, ...col.map((id) => sizes.get(id)!.w));
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
