import type {
  AnnotationRevision,
  FlowProject,
  FocusZone,
  ScreenAnnotation,
  ScreenNode,
} from '../types/studio';
import { formatVersionedRef, getLatestRevision, getRevisionByNumber } from './annotations';

export interface CatalogReferenceItem {
  /** Exact token inserted into prompt, e.g. `@Pin-2:v1` or `@Checkout` */
  token: string;
  kind: 'pin' | 'mask' | 'screen' | 'zone';
  screenId?: string;
  screenSlug?: string;
  annotationId?: string;
  revisionNumber?: number;
  isLatestRevision?: boolean;
  isResolved?: boolean;
  includeInAiFeedback?: boolean;
  primaryText: string;
  secondaryText: string;
  sortTimestamp: number;
}

export interface ResolvedAnnotationReference {
  token: string;
  screen: ScreenNode;
  annotation: ScreenAnnotation;
  revision: AnnotationRevision;
  explicitVersion: number | null;
  source: 'explicit-mention' | 'screen-auto-included';
}

export interface ResolvedPromptReferences {
  rawTokens: string[];
  explicitScreens: ScreenNode[];
  explicitZones: FocusZone[];
  explicitAnnotations: ResolvedAnnotationReference[];
  targetScreens: ScreenNode[];
  effectiveAnnotations: ResolvedAnnotationReference[];
  excludedAnnotations: ScreenAnnotation[];
}

function normalizeSearchKey(val: string): string {
  return val.toLowerCase().replace(/[@:_\-\s.]/g, '');
}

/**
 * Builds the complete autocomplete catalog across ALL screens, pins, masks, and revisions.
 * - Includes EVERY revision of every pin/mask (`@Pin-2:v1`, `@Pin-1:v2`, `@Pin-1:v1`)
 * - Sorts open pins/masks newest-first at the top, followed by screens, then resolved pins.
 */
export function buildReferenceCatalog(project: FlowProject): CatalogReferenceItem[] {
  const openPinItems: CatalogReferenceItem[] = [];
  const resolvedPinItems: CatalogReferenceItem[] = [];
  const screenItems: CatalogReferenceItem[] = [];

  for (const screen of Object.values(project.screens)) {
    screenItems.push({
      token: `@${screen.slug}`,
      kind: 'screen',
      screenId: screen.id,
      screenSlug: screen.slug,
      primaryText: screen.title,
      secondaryText: `${screen.stage}${screen.isInFinalFlow ? ' · Final Flow' : ''}`,
      sortTimestamp: 1,
    });

    for (const ann of screen.annotations) {
      const latestRev = getLatestRevision(ann);
      const revsDescending =
        ann.revisions.length > 0 ? [...ann.revisions].reverse() : [latestRev];

      for (const rev of revsDescending) {
        const isLatest = rev.revisionNumber === latestRev.revisionNumber;
        const token = formatVersionedRef(ann, rev.revisionNumber);
        const item: CatalogReferenceItem = {
          token,
          kind: ann.kind === 'paint-region' ? 'mask' : 'pin',
          screenId: screen.id,
          screenSlug: screen.slug,
          annotationId: ann.id,
          revisionNumber: rev.revisionNumber,
          isLatestRevision: isLatest,
          isResolved: ann.status === 'resolved',
          includeInAiFeedback: ann.includeInAiFeedback,
          primaryText: rev.comment,
          secondaryText: `@${screen.slug} · ${ isLatest ? `v${rev.revisionNumber} latest` : `v${rev.revisionNumber} history` }${
            ann.status === 'resolved'
              ? ' · resolved'
              : ann.includeInAiFeedback
              ? ' · AI on'
              : ' · AI off'
          }`,
          sortTimestamp: rev.timestamp || ann.createdAt,
        };

        if (ann.status === 'open' && isLatest) {
          openPinItems.push(item);
        } else if (ann.status === 'open') {
          // Older revisions of open pins appear right after latest open pins
          openPinItems.push({ ...item, sortTimestamp: item.sortTimestamp - 1000 });
        } else {
          resolvedPinItems.push(item);
        }
      }
    }
  }

  openPinItems.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  resolvedPinItems.sort((a, b) => b.sortTimestamp - a.sortTimestamp);

  return [...openPinItems, ...screenItems, ...resolvedPinItems];
}

/**
 * Fuzzy-matches `@Pin`, `@pin2`, `@Pin-2`, `@Pin-2:v1`, `@Check`, etc.
 */
export function filterReferenceCatalog(
  catalog: CatalogReferenceItem[],
  query: string
): CatalogReferenceItem[] {
  const trimmed = query.trim();
  if (!trimmed) return catalog;

  const normQ = normalizeSearchKey(trimmed);
  const lowerQ = trimmed.toLowerCase();

  return catalog.filter((item) => {
    if (item.token.toLowerCase().includes(lowerQ)) return true;
    if (normalizeSearchKey(item.token).includes(normQ)) return true;
    if (item.primaryText.toLowerCase().includes(lowerQ)) return true;
    if (item.secondaryText.toLowerCase().includes(lowerQ)) return true;
    return false;
  });
}

/**
 * Detects an active `@query` token immediately preceding `caretPos`,
 * supporting version suffixes like `@Pin-2:v1` or `@Pin-2:`.
 */
export function detectCaretMention(
  text: string,
  caretPos: number
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, caretPos);
  const match = before.match(/(?:^|\s)@([A-Za-z0-9_:-]*)$/);
  if (!match) return null;
  const query = match[1];
  const start = caretPos - query.length - 1;
  return { start, end: caretPos, query };
}

/**
 * Removes all occurrences of `@handle` or `@handle:vK` (case-insensitive) from prompt text,
 * tidying extra spaces cleanly.
 */
export function stripReferenceTokenFromText(text: string, baseHandle: string): string {
  const cleanHandle = baseHandle.replace(/^@/, '').replace(/:v?\d+$/i, '');
  if (!cleanHandle) return text;
  const escaped = cleanHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Also match normalized without hyphen (e.g. @pin2 vs @Pin-2)
  const noHyphen = cleanHandle.replace(/-/g, '');
  const escapedNoHyphen = noHyphen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(^|\\s)@(?:${escaped}|${escapedNoHyphen})(?::v?\\d+)?(?=\\s|$)`,
    'gi'
  );
  return text
    .replace(pattern, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^ +/, '');
}

/**
 * Parses all `@Screen`, `@Pin-N`, `@Pin-N:vK`, `@Mask-N:vK`, and `@Zone` mentions in a prompt,
 * resolving exact requested revisions and honoring `detachedKeys` (`screen:<id>`, `ann:<id>`).
 */
export function resolvePromptReferences(
  prompt: string,
  project: FlowProject,
  fallbackScreenId?: string | null,
  detachedKeys?: ReadonlySet<string>
): ResolvedPromptReferences {
  // Matches @Checkout, @Pin-2, @Pin-2:v1, @Pin2:v1, @Mask-1:v2
  const regex = /@([A-Za-z0-9_-]+)(?::v?(\d+))?/gi;
  const rawTokens: string[] = [];

  const explicitScreenMap = new Map<string, ScreenNode>();
  const explicitZoneMap = new Map<string, FocusZone>();
  const explicitAnnMap = new Map<string, ResolvedAnnotationReference>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(prompt)) !== null) {
    const fullToken = match[0];
    const baseHandle = match[1];
    const explicitVer = match[2] ? Number(match[2]) : null;
    rawTokens.push(fullToken);

    const normHandle = normalizeSearchKey(baseHandle);

    for (const screen of Object.values(project.screens)) {
      if (
        screen.slug.toLowerCase() === baseHandle.toLowerCase() ||
        normalizeSearchKey(screen.slug) === normHandle ||
        screen.id.toLowerCase() === baseHandle.toLowerCase()
      ) {
        explicitScreenMap.set(screen.id, screen);
      }

      for (const ann of screen.annotations) {
        if (
          ann.mentionTag.toLowerCase() === baseHandle.toLowerCase() ||
          normalizeSearchKey(ann.mentionTag) === normHandle
        ) {
          const rev = getRevisionByNumber(ann, explicitVer);
          const key = `${ann.id}:v${rev.revisionNumber}`;
          explicitAnnMap.set(key, {
            token: formatVersionedRef(ann, rev.revisionNumber),
            screen,
            annotation: ann,
            revision: rev,
            explicitVersion: explicitVer,
            source: 'explicit-mention',
          });
          explicitScreenMap.set(screen.id, screen);
        }
      }
    }

    for (const zone of Object.values(project.focusZones)) {
      if (
        normalizeSearchKey(zone.name) === normHandle ||
        zone.id.toLowerCase() === baseHandle.toLowerCase()
      ) {
        explicitZoneMap.set(zone.id, zone);
        for (const sid of zone.screenIds) {
          if (project.screens[sid]) explicitScreenMap.set(sid, project.screens[sid]);
        }
      }
    }
  }

  // Target screens: explicitly mentioned screens (including screens owning mentioned pins),
  // falling back to currently selected screen on canvas UNLESS detached via `×` in chat!
  const targetScreenMap = new Map<string, ScreenNode>(explicitScreenMap);
  if (
    targetScreenMap.size === 0 &&
    fallbackScreenId &&
    project.screens[fallbackScreenId] &&
    !detachedKeys?.has(`screen:${fallbackScreenId}`)
  ) {
    targetScreenMap.set(fallbackScreenId, project.screens[fallbackScreenId]);
  }
  const targetScreens = Array.from(targetScreenMap.values());

  // Effective annotations sent to AI:
  // 1) EVERY explicitly @mentioned annotation/revision in prompt text is included.
  // 2) Open annotations on targetScreens with `includeInAiFeedback === true` are auto-included
  //    UNLESS detached in chat via `detachedKeys` (`ann:<id>`).
  const effectiveMap = new Map<string, ResolvedAnnotationReference>();
  const explicitlyIncludedAnnIds = new Set<string>();

  for (const [k, ref] of explicitAnnMap.entries()) {
    effectiveMap.set(k, ref);
    explicitlyIncludedAnnIds.add(ref.annotation.id);
  }

  const excludedAnnotations: ScreenAnnotation[] = [];
  for (const screen of targetScreens) {
    for (const ann of screen.annotations) {
      if (explicitlyIncludedAnnIds.has(ann.id)) continue;
      if (ann.status !== 'open') continue;

      const isDetachedInChat = detachedKeys?.has(`ann:${ann.id}`) ?? false;
      if (ann.includeInAiFeedback && !isDetachedInChat) {
        const rev = getLatestRevision(ann);
        effectiveMap.set(`${ann.id}:v${rev.revisionNumber}`, {
          token: formatVersionedRef(ann, rev.revisionNumber),
          screen,
          annotation: ann,
          revision: rev,
          explicitVersion: null,
          source: 'screen-auto-included',
        });
      } else {
        excludedAnnotations.push(ann);
      }
    }
  }

  return {
    rawTokens,
    explicitScreens: Array.from(explicitScreenMap.values()),
    explicitZones: Array.from(explicitZoneMap.values()),
    explicitAnnotations: Array.from(explicitAnnMap.values()),
    targetScreens,
    effectiveAnnotations: Array.from(effectiveMap.values()),
    excludedAnnotations,
  };
}
