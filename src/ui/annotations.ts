import type { Annotation, AnnotationKind, AnnotationRevision } from "../a2ui/types";

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Computes a collision-free monotonic mention handle (`Pin-1`, `Pin-2`, `Mask-1`, ...).
 */
export function nextMentionTag(
  allAnnotations: Record<string, Annotation[]>,
  kind: AnnotationKind,
): string {
  const prefix = kind === "mask" ? "Mask" : "Pin";
  const regex = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let maxNum = 0;

  for (const list of Object.values(allAnnotations)) {
    for (const a of list) {
      if (!a.mentionTag) continue;
      const m = a.mentionTag.match(regex);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxNum) maxNum = n;
      }
    }
  }
  return `${prefix}-${maxNum + 1}`;
}

export function getLatestRevision(ann: Annotation): AnnotationRevision {
  if (ann.revisions && ann.revisions.length > 0) {
    return ann.revisions[ann.revisions.length - 1];
  }
  return {
    id: `${ann.id}-r1`,
    revisionNumber: 1,
    timestamp: ann.createdAt,
    author: ann.author ?? "designer",
    text: ann.text,
    kind: ann.kind,
    status: ann.status ?? "open",
  };
}

export function getRevisionByNumber(ann: Annotation, version?: number | null): AnnotationRevision {
  if (!version || !ann.revisions?.length) return getLatestRevision(ann);
  return ann.revisions.find((r) => r.revisionNumber === version) ?? getLatestRevision(ann);
}

export function formatVersionedRef(ann: Pick<Annotation, "mentionTag" | "revisions" | "kind">, ver?: number): string {
  const tag = ann.mentionTag || (ann.kind === "mask" ? "Mask-1" : "Pin-1");
  const revisionNumber =
    ver ?? (ann.revisions && ann.revisions.length > 0 ? ann.revisions[ann.revisions.length - 1].revisionNumber : 1);
  return `@${tag}:v${revisionNumber}`;
}

/**
 * Ensures any legacy annotation loaded from storage or run.json has full versioned metadata.
 */
export function normalizeAnnotation(ann: Annotation, fallbackIndex = 1): Annotation {
  const prefix = ann.kind === "mask" ? "Mask" : "Pin";
  const mentionTag = ann.mentionTag || `${prefix}-${fallbackIndex}`;
  const status = ann.status ?? "open";
  const author = ann.author ?? "designer";
  const includeInAiFeedback = ann.includeInAiFeedback ?? true;
  const revisions =
    ann.revisions && ann.revisions.length > 0
      ? ann.revisions
      : [
          {
            id: `${ann.id}-r1`,
            revisionNumber: 1,
            timestamp: ann.createdAt || new Date().toISOString(),
            author,
            text: ann.text,
            kind: ann.kind,
            status,
          },
        ];
  return {
    ...ann,
    mentionTag,
    status,
    author,
    includeInAiFeedback,
    revisions,
  };
}

export function normalizeAnnotationMap(map: Record<string, Annotation[]>): Record<string, Annotation[]> {
  let pinCounter = 0;
  let maskCounter = 0;
  const usedTags = new Set<string>();

  // First pass: collect existing explicit tags so we never collide
  for (const list of Object.values(map)) {
    for (const a of list) {
      if (a.mentionTag) {
        usedTags.add(a.mentionTag.toLowerCase());
        const pm = a.mentionTag.match(/^Pin-(\d+)$/i);
        if (pm) pinCounter = Math.max(pinCounter, Number(pm[1]));
        const mm = a.mentionTag.match(/^Mask-(\d+)$/i);
        if (mm) maskCounter = Math.max(maskCounter, Number(mm[1]));
      }
    }
  }

  const out: Record<string, Annotation[]> = {};
  for (const [screenId, list] of Object.entries(map)) {
    out[screenId] = list.map((a) => {
      if (a.mentionTag) return normalizeAnnotation(a);
      const tag = a.kind === "mask" ? `Mask-${++maskCounter}` : `Pin-${++pinCounter}`;
      usedTags.add(tag.toLowerCase());
      return normalizeAnnotation({ ...a, mentionTag: tag });
    });
  }
  return out;
}

export function createVersionedAnnotation(
  allAnnotations: Record<string, Annotation[]>,
  init: {
    x: number;
    y: number;
    text: string;
    kind: AnnotationKind;
    componentId?: string;
    author?: "designer" | "ai-evaluator";
    includeInAiFeedback?: boolean;
    strokes?: { x: number; y: number }[][];
    maskBox?: { x: number; y: number; w: number; h: number };
    maskDataUrl?: string;
    intersectingIds?: string[];
  },
): Annotation {
  const now = new Date().toISOString();
  const id = uid("an");
  const mentionTag = nextMentionTag(allAnnotations, init.kind);
  const author = init.author ?? "designer";
  const includeInAiFeedback = init.includeInAiFeedback ?? true;
  const rev: AnnotationRevision = {
    id: uid("rev"),
    revisionNumber: 1,
    timestamp: now,
    author,
    text: init.text,
    kind: init.kind,
    status: "open",
  };
  return {
    id,
    mentionTag,
    x: init.x,
    y: init.y,
    text: init.text,
    kind: init.kind,
    componentId: init.componentId,
    author,
    status: "open",
    includeInAiFeedback,
    createdAt: now,
    ...(init.strokes ? { strokes: init.strokes } : {}),
    ...(init.maskBox ? { maskBox: init.maskBox } : {}),
    ...(init.maskDataUrl ? { maskDataUrl: init.maskDataUrl } : {}),
    ...(init.intersectingIds?.length ? { intersectingIds: init.intersectingIds } : {}),
    revisions: [rev],
  };
}

export function appendAnnotationRevision(
  ann: Annotation,
  patch: {
    text?: string;
    kind?: AnnotationKind;
    status?: "open" | "resolved";
    author?: "designer" | "ai-evaluator";
    resolvedByVersionId?: string;
  },
): Annotation {
  const norm = normalizeAnnotation(ann);
  const prevRevs = norm.revisions ?? [];
  const nextNumber = prevRevs.length + 1;
  const nextText = patch.text ?? norm.text;
  const nextKind = patch.kind ?? norm.kind;
  const nextStatus = patch.status ?? norm.status ?? "open";
  const now = new Date().toISOString();

  const rev: AnnotationRevision = {
    id: uid("rev"),
    revisionNumber: nextNumber,
    timestamp: now,
    author: patch.author ?? "designer",
    text: nextText,
    kind: nextKind,
    status: nextStatus,
    ...(patch.resolvedByVersionId ? { resolvedByVersionId: patch.resolvedByVersionId } : {}),
  };

  return {
    ...norm,
    text: nextText,
    kind: nextKind,
    status: nextStatus,
    revisions: [...prevRevs, rev],
  };
}
