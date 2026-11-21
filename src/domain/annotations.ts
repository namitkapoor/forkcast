import type {
  AnnotationCategory,
  AnnotationRevision,
  FlowProject,
  ScreenAnnotation,
} from '../types/studio';

export function createRevisionId(): string {
  return `rev-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
}

export function createAnnotationId(prefix = 'ann'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Generates a guaranteed collision-free monotonic tag (`Pin-1`, `Pin-2`, `Mask-1`, ...).
 */
export function nextAnnotationMentionTag(
  project: FlowProject,
  kind: ScreenAnnotation['kind']
): string {
  const prefix = kind === 'paint-region' ? 'Mask' : 'Pin';
  const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let maxNum = 0;

  for (const screen of Object.values(project.screens)) {
    for (const ann of screen.annotations) {
      const m = ann.mentionTag.match(regex);
      if (m) {
        const num = Number(m[1]);
        if (Number.isFinite(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  return `${prefix}-${maxNum + 1}`;
}

export function getLatestRevision(ann: ScreenAnnotation): AnnotationRevision {
  if (ann.revisions.length > 0) {
    return ann.revisions[ann.revisions.length - 1];
  }
  return {
    id: 'rev-fallback',
    revisionNumber: 1,
    timestamp: ann.createdAt,
    author: ann.author,
    comment: ann.comment,
    category: ann.category,
    status: ann.status,
  };
}

export function getRevisionByNumber(
  ann: ScreenAnnotation,
  version?: number | null
): AnnotationRevision {
  if (!version) return getLatestRevision(ann);
  return (
    ann.revisions.find((r) => r.revisionNumber === version) ?? getLatestRevision(ann)
  );
}

/**
 * Formats a versioned mention handle, e.g. `@Pin-2:v1` or `@Pin-1:v2`.
 */
export function formatVersionedRef(
  ann: Pick<ScreenAnnotation, 'mentionTag' | 'revisions'>,
  revisionNumber?: number
): string {
  const ver =
    revisionNumber ??
    (ann.revisions.length > 0
      ? ann.revisions[ann.revisions.length - 1].revisionNumber
      : 1);
  return `@${ann.mentionTag}:v${ver}`;
}

export function appendRevision(
  ann: ScreenAnnotation,
  patch: {
    comment?: string;
    category?: AnnotationCategory;
    status?: 'open' | 'resolved';
    author?: 'designer' | 'ai-evaluator';
    resolvedByVariantId?: string;
  }
): ScreenAnnotation {
  const now = Date.now();
  const nextNumber = ann.revisions.length + 1;
  const nextComment = patch.comment ?? ann.comment;
  const nextCategory = patch.category ?? ann.category;
  const nextStatus = patch.status ?? ann.status;

  const newRev: AnnotationRevision = {
    id: createRevisionId(),
    revisionNumber: nextNumber,
    timestamp: now,
    author: patch.author ?? 'designer',
    comment: nextComment,
    category: nextCategory,
    status: nextStatus,
    ...(patch.resolvedByVariantId ? { resolvedByVariantId: patch.resolvedByVariantId } : {}),
  };

  return {
    ...ann,
    comment: nextComment,
    category: nextCategory,
    status: nextStatus,
    revisions: [...ann.revisions, newRev],
  };
}
