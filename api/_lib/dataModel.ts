// Helpers that read an A2UI v0.9 message stream without rendering it:
// fold its data model, flatten it to text for persona prompts, and lint for unbound values.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

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

/** The surface's data model after applying every updateDataModel in order. */
export function getDataModel(messages: unknown[]): Obj {
  let model: Obj = {};
  for (const m of messages) {
    if (!isObj(m) || !isObj(m.updateDataModel)) continue;
    const u = m.updateDataModel;
    model = setAt(model, typeof u.path === "string" ? u.path : "/", structuredClone(u.value));
  }
  return model;
}

export function getComponents(messages: unknown[]): Obj[] {
  const out: Obj[] = [];
  for (const m of messages) {
    if (isObj(m) && isObj(m.updateComponents) && Array.isArray(m.updateComponents.components)) {
      for (const c of m.updateComponents.components) if (isObj(c)) out.push(c);
    }
  }
  return out;
}

/** Plain-text outline of a screen (resolved bindings, buttons marked) for persona prompts. */
export function screenToText(messages: unknown[], maxLines = 60): string {
  const comps = new Map(getComponents(messages).map((c) => [String(c.id), c]));
  const model = getDataModel(messages);
  const lines: string[] = [];
  const seen = new Set<string>();

  const resolve = (v: unknown, scope: string): string => {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (isObj(v) && typeof v.path === "string") {
      const p = v.path.startsWith("/") ? v.path : `${scope}/${v.path}`;
      const r = getAt(model, p);
      return r === undefined ? "" : typeof r === "object" ? JSON.stringify(r) : String(r);
    }
    return "";
  };

  const walk = (id: string, depth: number, scope: string) => {
    const key = `${id}@${scope}`;
    if (lines.length >= maxLines || seen.has(key)) return;
    seen.add(key);
    const c = comps.get(id);
    if (!c) return;
    const pad = "  ".repeat(Math.min(depth, 6));
    const type = String(c.component);
    const label = resolve(c.text ?? c.label ?? c.value ?? "", scope).trim();
    if (type === "Button") {
      const childText = typeof c.child === "string" ? resolve(comps.get(c.child)?.text, scope) : "";
      lines.push(`${pad}[button${c.variant === "primary" ? " primary" : ""}] ${childText || label}`);
      return;
    }
    if (label) lines.push(`${pad}${type === "Text" ? "" : `(${type}) `}${label}`);
    else if (["TextField", "CheckBox", "ChoicePicker", "Slider", "DateTimeInput"].includes(type)) lines.push(`${pad}(${type})`);
    if (typeof c.child === "string") walk(c.child, depth + 1, scope);
    const ch = c.children;
    if (Array.isArray(ch)) ch.forEach((k) => typeof k === "string" && walk(k, depth + 1, scope));
    else if (isObj(ch) && typeof ch.componentId === "string" && typeof ch.path === "string") {
      const list = getAt(model, ch.path);
      if (Array.isArray(list)) list.slice(0, 8).forEach((_, i) => walk(ch.componentId as string, depth + 1, `${ch.path}/${i}`));
    }
    if (Array.isArray(c.tabs)) for (const t of c.tabs) if (isObj(t) && typeof t.child === "string") walk(t.child, depth + 1, scope);
  };
  walk("root", 0, "");
  return lines.join("\n");
}

const PRICE_LITERAL = /(?:[€$£]\s?\d)|(?:\b\d[\d,.]*\s?(?:EUR|USD|GBP)\b)/;

/**
 * Forkcast-specific lint on top of A2UI validity: dynamic values must live in the data model,
 * and the carried values must appear under /booking exactly.
 */
export function lintBindings(messages: unknown[], carry: Record<string, unknown> = {}): string[] {
  const errors: string[] = [];
  const flightId = typeof carry.flightId === "string" ? carry.flightId : undefined;
  const visit = (v: unknown, where: string) => {
    if (typeof v === "string") {
      if (PRICE_LITERAL.test(v)) errors.push(`${where}: price literal "${v.slice(0, 60)}" — put it in the data model and bind with {"path": ...}`);
      if (flightId && v.includes(flightId)) errors.push(`${where}: flight id "${flightId}" is hard-coded — bind it with {"path": ...}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${where}[${i}]`));
    else if (isObj(v) && !("path" in v)) for (const [k, x] of Object.entries(v)) visit(x, `${where}.${k}`);
  };
  for (const c of getComponents(messages)) {
    for (const [k, v] of Object.entries(c)) if (k !== "id" && k !== "component") visit(v, `component "${String(c.id)}".${k}`);
  }
  const booking = getAt(getDataModel(messages), "/booking");
  for (const [k, v] of Object.entries(carry)) {
    if (v === undefined || v === null || typeof v === "object") continue;
    const got = isObj(booking) ? booking[k] : undefined;
    if (got !== v) errors.push(`data model /booking/${k} must be ${JSON.stringify(v)} (got ${JSON.stringify(got)})`);
  }
  return errors;
}

/** Force every surfaceId in the stream to `id` (models drift on this; it is not a design choice). */
export function pinSurfaceId(messages: unknown[], id: string): unknown[] {
  return messages.map((m) => {
    if (!isObj(m)) return m;
    const out: Obj = { ...m, version: "v0.9" };
    for (const op of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]) {
      if (isObj(out[op])) out[op] = { ...(out[op] as Obj), surfaceId: id };
    }
    return out;
  });
}
