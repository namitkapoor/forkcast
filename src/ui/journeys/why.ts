// "Why it looks like this": decisions (gen-v2 screens) as numbered marks, and what each persona got that the others didn't.
import type { Screen, ScreenDecision } from "../../a2ui/types";
import type { Mark } from "./CircledScreen";

/** "seat_banner_text" → "seat banner". */
export function humanize(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b(lbl|label|txt|text|val|value|btn|button|title|heading|caption|row|col|column|container|wrap|wrapper|item|card|list|section|top|bottom|group|block|area|box|inner|outer|divider|spacer|separator|\d+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const decisionsOf = (s: Screen | undefined): ScreenDecision[] => (s?.decisions ?? []).filter((d) => d && typeof d.componentId === "string" && d.because);

export function decisionMarks(s: Screen | undefined): Mark[] {
  return decisionsOf(s).map((d, i) => ({ componentId: d.componentId, n: i + 1, source: d.source, title: `${d.source}: ${d.because}` }));
}

interface Comp {
  id: string;
  component: string;
}

function components(s: Screen | undefined): Comp[] {
  const out = new Map<string, Comp>();
  for (const m of s?.messages ?? []) {
    const comps = (m as { updateComponents?: { components?: { id?: unknown; component?: unknown }[] } }).updateComponents?.components ?? [];
    for (const c of comps) if (typeof c.id === "string") out.set(c.id, { id: c.id, component: String(c.component ?? "") });
  }
  return [...out.values()];
}

const LAYOUT = new Set(["Column", "Row", "List", "Card", "Divider", "Text", "Button", "Icon", "Modal", ""]);
/** Ids that are just plumbing ("root", "header", "fare_meta"), not features someone would name. */
const PLUMBING = /^(root|main|body|content|header|footer|top|bottom|hdr|stack|section|spacer|divider|sep)\b/;

/**
 * Feature labels a screen offers: decision components (humanized) when the screen has decisions, plus
 * non-layout component types and meaningful component ids otherwise.
 */
export function features(s: Screen | undefined): Map<string, string> {
  const out = new Map<string, string>(); // key → label
  const ds = decisionsOf(s);
  if (ds.length) {
    for (const d of ds) {
      const label = humanize(d.componentId) || d.componentId;
      out.set(label, label);
    }
    return out;
  }
  for (const c of components(s)) {
    if (!LAYOUT.has(c.component)) out.set(`type:${c.component}`, humanize(c.component));
    const h = humanize(c.id);
    if (h && !PLUMBING.test(h) && h.length > 2) out.set(h, h);
  }
  return out;
}

/** For each screen, the feature labels only it has among the given screens. */
export function onlyIn(screens: (Screen | undefined)[]): string[][] {
  const sets = screens.map(features);
  return sets.map((mine, i) => [...mine.entries()].filter(([k]) => sets.every((o, j) => j === i || !o.has(k))).map(([, label]) => label));
}

export const SOURCE_LABEL: Record<string, string> = {
  memory: "memory",
  query: "question",
  context: "context",
  tool: "fare data",
  carry: "carried",
  history: "history",
};
