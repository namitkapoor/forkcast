import { componentIdOf } from "./componentId";

// Maps the A2UI components rendered inside a ScreenFrame to rectangles relative to that frame.
//
// The v0.9 renderer hosts every component in a custom element that carries the resolved node
// as a property (see componentId.ts), not as an attribute, so we walk the DOM (and any shadow
// roots) and read it off each element. Many hosts are `display: contents` and have no box of
// their own; their box is the union of what they render.
//
// Rects are normalised to the frame's on-screen box (0..1). The frame sits inside two CSS
// scales (the 360px base screen scaled to the thumbnail, and the canvas zoom), and dividing by
// the frame's own getBoundingClientRect cancels both, so the numbers are zoom-independent.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentRect extends Rect {
  /** A2UI component id. Template children (list rows) repeat an id, one rect per instance. */
  id: string;
  /** Catalog component type, e.g. "Text", "Button". */
  type: string;
  /** Short human label: the visible text, else the type. */
  label: string;
  /** Nearest enclosing component's id, if any. */
  parentId?: string;
  /** Nesting depth (root = 0). */
  depth: number;
}

export interface Point {
  x: number;
  y: number;
}

interface HostLike extends Element {
  node?: { type?: unknown };
  context?: { componentModel?: { type?: unknown } };
}

function typeOf(el: Element): string {
  const h = el as HostLike;
  const t = h.node?.type ?? h.context?.componentModel?.type;
  if (typeof t === "string") return t;
  return el.tagName.toLowerCase().replace(/^a2ui-(basic-)?/, "");
}

function union(a: DOMRect | null, b: DOMRect | null): DOMRect | null {
  if (!b || (b.width === 0 && b.height === 0)) return a;
  if (!a) return b;
  const x = Math.min(a.left, b.left);
  const y = Math.min(a.top, b.top);
  return new DOMRect(x, y, Math.max(a.right, b.right) - x, Math.max(a.bottom, b.bottom) - y);
}

/** On-screen box of an element, falling back to its rendered contents for display:contents hosts. */
function boxOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width > 0 || r.height > 0) return r;
  let box: DOMRect | null = null;
  const kids: Node[] = [...(el.shadowRoot?.childNodes ?? []), ...el.childNodes];
  for (const k of kids) {
    if (k instanceof Element) box = union(box, boxOf(k));
    else if (k.nodeType === Node.TEXT_NODE && k.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(k);
      box = union(box, range.getBoundingClientRect());
    }
  }
  return box;
}

function textOf(el: Element): string {
  const raw = el instanceof HTMLElement && el.innerText ? el.innerText.split(/\n+/).map((x) => x.trim()).filter(Boolean).join(" · ") : (el.textContent ?? "");
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 42 ? `${t.slice(0, 40)}…` : t;
}

/** Every rendered A2UI component inside `frame`, with frame-relative rects (0..1). */
export function componentRects(frame: Element): ComponentRect[] {
  const fr = frame.getBoundingClientRect();
  if (!fr.width || !fr.height) return [];
  const out: ComponentRect[] = [];

  const visit = (el: Element, parentId: string | undefined, depth: number) => {
    const id = componentIdOf(el);
    let nextParent = parentId;
    let nextDepth = depth;
    if (id) {
      const b = boxOf(el);
      if (b && (b.width > 0 || b.height > 0)) {
        const type = typeOf(el);
        out.push({
          id,
          type,
          label: textOf(el) || type,
          parentId,
          depth,
          x: (b.left - fr.left) / fr.width,
          y: (b.top - fr.top) / fr.height,
          w: b.width / fr.width,
          h: b.height / fr.height,
        });
      }
      nextParent = id;
      nextDepth = depth + 1;
    }
    if (el.shadowRoot) for (const c of el.shadowRoot.children) visit(c, nextParent, nextDepth);
    for (const c of el.children) visit(c, nextParent, nextDepth);
  };
  for (const c of frame.children) visit(c, undefined, 0);
  return out;
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Share of the rect covered by the polygon, sampled on a grid. */
function coverage(r: Rect, poly: Point[], n = 7): number {
  let hit = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) if (pointInPolygon({ x: r.x + ((i + 0.5) / n) * r.w, y: r.y + ((j + 0.5) / n) * r.h }, poly)) hit++;
  return hit / (n * n);
}

function intersects(r: Rect, poly: Point[]): boolean {
  if (coverage(r, poly, 5) > 0) return true;
  return poly.some((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

/**
 * Components a lasso selects. A component counts when the lasso touches it and covers most of
 * it, so a loop around "the total" picks the total rather than the card it sits in. When one
 * selected component encloses another, the outer one wins (a Button, not its label). If the
 * lasso was too tight to cover anything, the smallest components it touches are used instead.
 */
export function pickInLasso(rects: ComponentRect[], poly: Point[]): ComponentRect[] {
  if (poly.length < 3) return [];
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const lassoArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const touched = rects.filter((r) => r.depth > 0 && intersects(r, poly));
  // Containers much bigger than the loop (the card around everything) are never what was meant.
  let picked = touched.filter((r) => coverage(r, poly) >= 0.5 && r.w * r.h <= lassoArea * 1.2);
  if (!picked.length) picked = touched.filter((r) => !touched.some((o) => o.parentId === r.id));
  const ids = new Set(picked.map((r) => r.id));
  const byId = new Map(rects.map((r) => [r.id, r]));
  const hasPickedAncestor = (r: ComponentRect) => {
    for (let p = r.parentId; p; p = byId.get(p)?.parentId) if (ids.has(p)) return true;
    return false;
  };
  return picked.filter((r) => !hasPickedAncestor(r));
}

/** Area centroid of a polygon (falls back to the vertex mean for degenerate shapes). */
export function centroid(poly: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
