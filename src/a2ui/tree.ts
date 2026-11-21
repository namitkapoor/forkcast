// Reads an A2UI v0.9 message stream without rendering it: the component tree (from
// updateComponents child/children/tabs), the folded data model, and resolved bindings.
// Used by the Layers panel, the properties panel and the Components page.

import type { A2uiMessage } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface A2uiComponent {
  id: string;
  /** Catalog type, e.g. "Text", "Button", "Row". */
  type: string;
  /** Every prop except id/component, as authored. */
  props: Obj;
}

export interface TreeNode {
  id: string;
  type: string;
  props: Obj;
  /** Short readable label: resolved text/label, else the type. */
  label: string;
  depth: number;
  children: TreeNode[];
  /** True when this child is a list template (children: {componentId, path}). */
  template?: boolean;
}

function pointerParts(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function getAt(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const p of pointerParts(path)) {
    if (Array.isArray(cur)) cur = cur[Number(p)];
    else if (isObj(cur)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function setAt(root: Obj, path: string, value: unknown): Obj {
  const parts = pointerParts(path);
  if (!parts.length) return isObj(value) ? { ...value } : root;
  let cur: Obj = root;
  parts.slice(0, -1).forEach((p) => {
    if (!isObj(cur[p]) && !Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p] as Obj;
  });
  cur[parts[parts.length - 1]] = value;
  return root;
}

/** The data model after every updateDataModel, in order. */
export function getDataModel(messages: A2uiMessage[] | unknown[]): Obj {
  let model: Obj = {};
  for (const m of messages) {
    if (!isObj(m) || !isObj(m.updateDataModel)) continue;
    const u = m.updateDataModel;
    model = setAt(model, typeof u.path === "string" ? u.path : "/", structuredClone(u.value));
  }
  return model;
}

/** Every component definition (last definition of an id wins). */
export function getComponents(messages: A2uiMessage[] | unknown[]): A2uiComponent[] {
  const byId = new Map<string, A2uiComponent>();
  for (const m of messages) {
    if (!isObj(m) || !isObj(m.updateComponents) || !Array.isArray(m.updateComponents.components)) continue;
    for (const c of m.updateComponents.components) {
      if (!isObj(c) || typeof c.id !== "string") continue;
      const { id, component, ...props } = c;
      byId.set(id, { id, type: String(component ?? "Unknown"), props });
    }
  }
  return [...byId.values()];
}

/** A binding is `{path: "/x"}` (absolute) or `{path: "x"}` (relative to a list item). */
export function bindingPath(v: unknown): string | undefined {
  return isObj(v) && typeof v.path === "string" ? v.path : undefined;
}

/** Resolve a prop value to display text (bindings read from the model; `scope` for list items). */
export function resolveText(v: unknown, model: Obj, scope = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const p = bindingPath(v);
  if (p) {
    const r = getAt(model, p.startsWith("/") ? p : `${scope}/${p}`);
    return r === undefined ? "" : typeof r === "object" ? JSON.stringify(r) : String(r);
  }
  return "";
}

/** Child ids a component references (child, children[], children template, tabs[].child). */
export function childRefs(c: A2uiComponent): { id: string; template?: boolean }[] {
  const out: { id: string; template?: boolean }[] = [];
  const p = c.props;
  if (typeof p.child === "string") out.push({ id: p.child });
  if (Array.isArray(p.children)) for (const k of p.children) if (typeof k === "string") out.push({ id: k });
  if (isObj(p.children) && typeof p.children.componentId === "string") out.push({ id: p.children.componentId, template: true });
  if (Array.isArray(p.tabs)) for (const t of p.tabs) if (isObj(t) && typeof t.child === "string") out.push({ id: t.child });
  if (typeof p.trigger === "string") out.push({ id: p.trigger });
  if (typeof p.content === "string") out.push({ id: p.content });
  return out;
}

/** Readable label for a component: its text/label (resolved), a Button's child text, else its type. */
export function componentLabel(c: A2uiComponent, byId: Map<string, A2uiComponent>, model: Obj): string {
  const p = c.props;
  let t = resolveText(p.text ?? p.label ?? p.value ?? p.name ?? "", model).trim();
  if (!t && c.type === "Button" && typeof p.child === "string") {
    const ch = byId.get(p.child);
    if (ch) t = resolveText(ch.props.text ?? "", model).trim();
  }
  t = t.replace(/[#*_`]/g, "").replace(/\s+/g, " ");
  return t ? (t.length > 36 ? `${t.slice(0, 34)}…` : t) : c.type;
}

/** The component tree rooted at "root" (or the first unreferenced component). */
export function componentTree(messages: A2uiMessage[] | unknown[]): TreeNode | null {
  const comps = getComponents(messages);
  if (!comps.length) return null;
  const byId = new Map(comps.map((c) => [c.id, c]));
  const model = getDataModel(messages);
  const referenced = new Set(comps.flatMap((c) => childRefs(c).map((r) => r.id)));
  const rootId = byId.has("root") ? "root" : (comps.find((c) => !referenced.has(c.id))?.id ?? comps[0].id);
  const seen = new Set<string>();
  const build = (id: string, depth: number, template?: boolean): TreeNode | null => {
    const c = byId.get(id);
    if (!c || seen.has(id) || depth > 24) return null;
    seen.add(id);
    const children = childRefs(c)
      .map((r) => build(r.id, depth + 1, r.template))
      .filter((n): n is TreeNode => !!n);
    return { id, type: c.type, props: c.props, label: componentLabel(c, byId, model), depth, children, ...(template ? { template } : {}) };
  };
  return build(rootId, 0);
}

/** Flattened tree in display order. */
export function flattenTree(t: TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  if (t) walk(t);
  return out;
}

/** Every binding path a component's props use, with its current value. */
export function componentBindings(c: A2uiComponent, model: Obj): { prop: string; path: string; value: unknown }[] {
  const out: { prop: string; path: string; value: unknown }[] = [];
  const visit = (v: unknown, prop: string) => {
    const p = bindingPath(v);
    if (p) out.push({ prop, path: p, value: p.startsWith("/") ? getAt(model, p) : undefined });
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${prop}[${i}]`));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) visit(x, `${prop}.${k}`);
  };
  for (const [k, v] of Object.entries(c.props)) visit(v, k);
  return out;
}
