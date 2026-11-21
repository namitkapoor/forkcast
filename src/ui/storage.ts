import type { Annotation } from "../a2ui/types";

// Annotations persist per screen in this browser. Storage can be blocked (private mode,
// previews), so every access is guarded and the canvas works without it.

const key = (screenId: string) => `forkcast:annotations:${screenId}`;

export function loadAnnotations(screenId: string): Annotation[] {
  try {
    const raw = window.localStorage.getItem(key(screenId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Annotation[]) : [];
  } catch {
    return [];
  }
}

export function saveAnnotations(screenId: string, list: Annotation[]): void {
  try {
    if (list.length) window.localStorage.setItem(key(screenId), JSON.stringify(list));
    else window.localStorage.removeItem(key(screenId));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function mergeAnnotations(a: Annotation[], b: Annotation[]): Annotation[] {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
