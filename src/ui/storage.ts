import type { Annotation } from "../a2ui/types";
import { normalizeAnnotation } from "./annotations";
import { loadJson, saveJson, type StorageLike } from "./persist";

// Annotations persist per screen in this browser. Storage can be blocked (private mode,
// previews) or hit quota when many Paint & Speak PNG masks exist, so writes fall back to
// stripping inline PNG previews while keeping strokes, bounding boxes, and revisions intact.

const key = (screenId: string) => `forkcast:annotations:${screenId}`;

export function loadAnnotations(screenId: string, store?: StorageLike | null): Annotation[] {
  const parsed = loadJson<unknown>(key(screenId), [], store);
  return Array.isArray(parsed) ? (parsed as Annotation[]).map((a, i) => normalizeAnnotation(a, i + 1)) : [];
}

export function saveAnnotations(screenId: string, list: Annotation[], store?: StorageLike | null): void {
  if (!list.length) {
    saveJson(key(screenId), null, store);
    return;
  }
  if (saveJson(key(screenId), list, store)) return;
  // Last-resort fallback: drop heavy base64 maskDataUrl on this screen's list so text & strokes still persist
  const slimmed = list.map(({ maskDataUrl: _m, ...rest }) => rest);
  saveJson(key(screenId), slimmed, store);
}

export function mergeAnnotations(a: Annotation[], b: Annotation[]): Annotation[] {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))].map((item, i) => normalizeAnnotation(item, i + 1));
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
