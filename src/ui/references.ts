import type { Annotation, AnnotationRevision, Screen } from "../a2ui/types";
import type { FlowGraph, StateNode } from "../graph/types";
import type { EditAnnotationContext } from "../lib/api";
import { formatVersionedRef, getLatestRevision, getRevisionByNumber, normalizeAnnotation } from "./annotations";

export interface CatalogReferenceItem {
  /** Exact token inserted into prompt, e.g. `@Pin-2:v1`, `@Mask-1:v1`, or `@payment` */
  token: string;
  kind: "pin" | "mask" | "step" | "screen";
  screenId?: string;
  nodeId?: string;
  annotationId?: string;
  revisionNumber?: number;
  isLatestRevision?: boolean;
  isResolved?: boolean;
  includeInAiFeedback?: boolean;
  primaryText: string;
  secondaryText: string;
  sortTime: number;
}

export interface ResolvedAnnotationItem {
  token: string;
  screenId: string;
  annotation: Annotation;
  revision: AnnotationRevision;
  source: "explicit-mention" | "auto-included";
}

export interface ResolvedPromptContext {
  rawTokens: string[];
  explicitNodes: StateNode[];
  explicitScreens: Screen[];
  includedAnnotations: ResolvedAnnotationItem[];
  editAnnotations: EditAnnotationContext[];
  referencedContext: string;
}

function normalizeSearchKey(val: string): string {
  return val.toLowerCase().replace(/[@:_\-\s.]/g, "");
}

/**
 * Builds the autocomplete catalog across ALL pins, masks, revisions, and flow steps.
 * Open latest pins/masks sort first, followed by steps, then older/resolved pin revisions.
 */
export function buildReferenceCatalog(
  graph: FlowGraph,
  screensById: Map<string, Screen>,
  annotationsByScreen: Record<string, Annotation[]>,
): CatalogReferenceItem[] {
  const openItems: CatalogReferenceItem[] = [];
  const resolvedItems: CatalogReferenceItem[] = [];
  const stepItems: CatalogReferenceItem[] = [];

  const labelByNode = new Map(graph.nodes.map((n) => [n.id, n.label]));

  for (const node of graph.nodes) {
    stepItems.push({
      token: `@${node.id}`,
      kind: "step",
      nodeId: node.id,
      primaryText: node.label,
      secondaryText: `${node.stage} · ${node.component}`,
      sortTime: 1,
    });
  }

  for (const [screenId, list] of Object.entries(annotationsByScreen)) {
    const baseId = screenId.split("@")[0];
    const ownerScreen = screensById.get(screenId) ?? screensById.get(baseId);
    const stepLabel = ownerScreen ? (labelByNode.get(ownerScreen.nodeId) ?? ownerScreen.nodeId) : screenId;

    for (const rawAnn of list) {
      const ann = normalizeAnnotation(rawAnn);
      const latest = getLatestRevision(ann);
      const revsDesc = ann.revisions?.length ? [...ann.revisions].reverse() : [latest];

      for (const rev of revsDesc) {
        const isLatest = rev.revisionNumber === latest.revisionNumber;
        const token = formatVersionedRef(ann, rev.revisionNumber);
        const ts = Date.parse(rev.timestamp || ann.createdAt) || 0;
        const item: CatalogReferenceItem = {
          token,
          kind: ann.kind === "mask" ? "mask" : "pin",
          screenId,
          nodeId: ownerScreen?.nodeId,
          annotationId: ann.id,
          revisionNumber: rev.revisionNumber,
          isLatestRevision: isLatest,
          isResolved: ann.status === "resolved",
          includeInAiFeedback: ann.includeInAiFeedback !== false,
          primaryText: rev.text,
          secondaryText: `${stepLabel} · ${isLatest ? `v${rev.revisionNumber} latest` : `v${rev.revisionNumber} history`}${
            ann.status === "resolved" ? " · resolved" : ann.includeInAiFeedback === false ? " · AI off" : " · AI on"
          }`,
          sortTime: isLatest ? ts : ts - 10_000,
        };

        if (ann.status === "resolved") resolvedItems.push(item);
        else openItems.push(item);
      }
    }
  }

  openItems.sort((a, b) => b.sortTime - a.sortTime);
  resolvedItems.sort((a, b) => b.sortTime - a.sortTime);

  return [...openItems, ...stepItems, ...resolvedItems];
}

export function filterReferenceCatalog(catalog: CatalogReferenceItem[], query: string): CatalogReferenceItem[] {
  const trimmed = query.trim();
  if (!trimmed) return catalog;
  const normQ = normalizeSearchKey(trimmed);
  const lowerQ = trimmed.toLowerCase();

  return catalog.filter((it) => {
    if (it.token.toLowerCase().includes(lowerQ)) return true;
    if (normalizeSearchKey(it.token).includes(normQ)) return true;
    if (it.primaryText.toLowerCase().includes(lowerQ)) return true;
    if (it.secondaryText.toLowerCase().includes(lowerQ)) return true;
    return false;
  });
}

export function detectCaretMention(
  text: string,
  caretPos: number,
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, caretPos);
  const m = before.match(/(?:^|\s)@([A-Za-z0-9_:-]*)$/);
  if (!m) return null;
  const query = m[1];
  return { start: caretPos - query.length - 1, end: caretPos, query };
}

export function stripReferenceTokenFromText(text: string, baseHandle: string): string {
  const clean = baseHandle.replace(/^@/, "").replace(/:v?\d+$/i, "");
  if (!clean) return text;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const noHyphen = clean.replace(/-/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\s)@(?:${escaped}|${noHyphen})(?::v?\\d+)?(?=\\s|$)`, "gi");
  return text.replace(re, " ").replace(/[ \t]{2,}/g, " ").replace(/^ +/, "");
}

/**
 * Resolves `@Pin-N:vK`, `@Mask-N:vK`, and `@step` mentions in a prompt plus opted-in
 * annotations on the active screen (honoring per-prompt `detachedKeys` in Chat).
 */
export function resolvePromptReferences(opts: {
  prompt: string;
  graph: FlowGraph;
  screensById: Map<string, Screen>;
  annotationsByScreen: Record<string, Annotation[]>;
  activeScreenId?: string;
  shownScreenId?: string;
  detachedKeys?: ReadonlySet<string>;
}): ResolvedPromptContext {
  const { prompt, graph, screensById, annotationsByScreen, activeScreenId, shownScreenId, detachedKeys } = opts;
  const regex = /@([A-Za-z0-9_-]+)(?::v?(\d+))?/gi;
  const rawTokens: string[] = [];

  const explicitNodeMap = new Map<string, StateNode>();
  const explicitScreenMap = new Map<string, Screen>();
  const explicitAnnMap = new Map<string, ResolvedAnnotationItem>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(prompt)) !== null) {
    const full = match[0];
    const handle = match[1];
    const ver = match[2] ? Number(match[2]) : null;
    rawTokens.push(full);
    const normHandle = normalizeSearchKey(handle);

    for (const node of graph.nodes) {
      if (node.id.toLowerCase() === handle.toLowerCase() || normalizeSearchKey(node.id) === normHandle || normalizeSearchKey(node.label) === normHandle) {
        explicitNodeMap.set(node.id, node);
      }
    }

    for (const screen of screensById.values()) {
      if (screen.id.toLowerCase() === handle.toLowerCase() || normalizeSearchKey(screen.variant) === normHandle) {
        explicitScreenMap.set(screen.id, screen);
      }
    }

    for (const [sid, list] of Object.entries(annotationsByScreen)) {
      for (const rawAnn of list) {
        const ann = normalizeAnnotation(rawAnn);
        if (
          ann.mentionTag &&
          (ann.mentionTag.toLowerCase() === handle.toLowerCase() || normalizeSearchKey(ann.mentionTag) === normHandle)
        ) {
          const rev = getRevisionByNumber(ann, ver);
          const key = `${ann.id}:v${rev.revisionNumber}`;
          explicitAnnMap.set(key, {
            token: formatVersionedRef(ann, rev.revisionNumber),
            screenId: sid,
            annotation: ann,
            revision: rev,
            source: "explicit-mention",
          });
        }
      }
    }
  }

  const includedMap = new Map<string, ResolvedAnnotationItem>(explicitAnnMap);
  const explicitIds = new Set([...explicitAnnMap.values()].map((r) => r.annotation.id));

  // Auto-include open `includeInAiFeedback !== false` annotations on the currently viewed screen
  // unless detached via `×` in Chat.
  const candidateScreenIds = [shownScreenId, activeScreenId].filter((x): x is string => Boolean(x));
  const seenCandidateIds = new Set<string>();
  for (const sid of candidateScreenIds) {
    if (seenCandidateIds.has(sid)) continue;
    seenCandidateIds.add(sid);
    if (detachedKeys?.has(`screen:${sid}`) || (activeScreenId && detachedKeys?.has(`screen:${activeScreenId}`))) continue;

    for (const rawAnn of annotationsByScreen[sid] ?? []) {
      const ann = normalizeAnnotation(rawAnn);
      if (explicitIds.has(ann.id)) continue;
      if (ann.status === "resolved") continue;
      if (ann.includeInAiFeedback === false) continue;
      if (detachedKeys?.has(`ann:${ann.id}`)) continue;

      const rev = getLatestRevision(ann);
      includedMap.set(`${ann.id}:v${rev.revisionNumber}`, {
        token: formatVersionedRef(ann, rev.revisionNumber),
        screenId: sid,
        annotation: ann,
        revision: rev,
        source: "auto-included",
      });
    }
  }

  const includedAnnotations = [...includedMap.values()];
  const editAnnotations: EditAnnotationContext[] = includedAnnotations.map((r) => ({
    id: r.annotation.id,
    token: r.token,
    kind: r.revision.kind,
    text: r.revision.text,
    ...(r.annotation.componentId ? { componentId: r.annotation.componentId } : {}),
    ...(r.annotation.intersectingIds?.length ? { intersectingIds: r.annotation.intersectingIds } : {}),
    ...(r.annotation.maskDataUrl ? { maskDataUrl: r.annotation.maskDataUrl } : {}),
  }));

  const contextLines: string[] = [];
  for (const n of explicitNodeMap.values()) {
    contextLines.push(`Referenced step @${n.id}: "${n.label}" (stage: ${n.stage}, component: ${n.component})`);
  }
  for (const s of explicitScreenMap.values()) {
    contextLines.push(`Referenced screen "${s.variant}" on step ${s.nodeId} for ${JSON.stringify(s.context)}`);
  }
  for (const r of includedAnnotations) {
    contextLines.push(
      `${r.token} [${r.revision.kind}]${r.annotation.componentId ? ` on ${r.annotation.componentId}` : ""}: "${r.revision.text}"`,
    );
  }

  return {
    rawTokens,
    explicitNodes: [...explicitNodeMap.values()],
    explicitScreens: [...explicitScreenMap.values()],
    includedAnnotations,
    editAnnotations,
    referencedContext: contextLines.join("\n"),
  };
}

const WORD_NUMS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

/**
 * Converts spoken mentions like "at pin two version one" -> `@Pin-2:v1`,
 * "at mask 1" -> `@Mask-1`, and "at payment" -> `@payment`.
 */
export function normalizeSpokenMentions(text: string, graph?: FlowGraph): string {
  let out = text;
  out = out.replace(
    /\b(?:at|@)\s*(pin|mask)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:version|ver|v)\s*(\d+|one|two|three|four|five))?\b/gi,
    (_, kindRaw: string, numRaw: string, verRaw?: string) => {
      const kind = kindRaw.toLowerCase() === "mask" ? "Mask" : "Pin";
      const num = WORD_NUMS[numRaw.toLowerCase()] ?? numRaw;
      if (verRaw) {
        const ver = WORD_NUMS[verRaw.toLowerCase()] ?? verRaw;
        return `@${kind}-${num}:v${ver}`;
      }
      return `@${kind}-${num}`;
    },
  );

  if (graph) {
    for (const node of graph.nodes) {
      const escapedId = node.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const labelWords = node.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\bat\\s+(?:${escapedId}|${labelWords})\\b`, "gi");
      out = out.replace(re, `@${node.id}`);
    }
  }

  return out.replace(/\s+/g, " ").trim();
}
