import type {
  FlowProject,
  ScreenAnnotation,
  ScreenNode,
} from '../types/studio';

export interface ParsedMentions {
  screenIds: string[];
  annotationIds: string[];
  zoneIds: string[];
  rawTokens: string[];
}

export interface AssembledPromptContext {
  prompt: string;
  mentions: ParsedMentions;
  targetScreens: ScreenNode[];
  includedAnnotations: ScreenAnnotation[];
  excludedAnnotationCount: number;
  topologySummary: string;
  neighborSummaries: string[];
  maskImages: Array<{ mentionTag: string; screenSlug: string; dataUrl: string }>;
}

/**
 * Parses @ScreenSlug, @Pin-N, @Mask-N, and @ZoneName references from a designer prompt.
 */
export function parsePromptMentions(prompt: string, project: FlowProject): ParsedMentions {
  const matches = prompt.match(/@([A-Za-z0-9_-]+)/g) ?? [];
  const rawTokens = matches.map((m) => m.slice(1));

  const screenIds = new Set<string>();
  const annotationIds = new Set<string>();
  const zoneIds = new Set<string>();

  for (const token of rawTokens) {
    const lower = token.toLowerCase();

    for (const screen of Object.values(project.screens)) {
      if (screen.slug.toLowerCase() === lower || screen.id.toLowerCase() === lower) {
        screenIds.add(screen.id);
      }
      for (const ann of screen.annotations) {
        if (ann.mentionTag.toLowerCase() === lower) {
          annotationIds.add(ann.id);
          screenIds.add(screen.id);
        }
      }
    }

    for (const zone of Object.values(project.focusZones)) {
      const zoneSlug = zone.name.replace(/\s+/g, '').toLowerCase();
      if (zoneSlug === lower || zone.id.toLowerCase() === lower) {
        zoneIds.add(zone.id);
        zone.screenIds.forEach((sid) => screenIds.add(sid));
      }
    }
  }

  return {
    screenIds: Array.from(screenIds),
    annotationIds: Array.from(annotationIds),
    zoneIds: Array.from(zoneIds),
    rawTokens,
  };
}

/**
 * Builds a token-efficient multimodal context payload for Gemini.
 * Strictly enforces `includeInAiFeedback === true` on annotations.
 */
export function buildMultimodalContext(
  prompt: string,
  project: FlowProject,
  fallbackScreenId?: string | null
): AssembledPromptContext {
  const mentions = parsePromptMentions(prompt, project);

  const targetIds = new Set<string>(mentions.screenIds);
  if (targetIds.size === 0 && fallbackScreenId && project.screens[fallbackScreenId]) {
    targetIds.add(fallbackScreenId);
  }

  const targetScreens = Array.from(targetIds)
    .map((id) => project.screens[id])
    .filter(Boolean);

  // Strict opt-in filter: only send annotations where includeInAiFeedback === true & status === 'open'
  const includedAnnotations: ScreenAnnotation[] = [];
  let excludedAnnotationCount = 0;

  for (const screen of targetScreens) {
    for (const ann of screen.annotations) {
      if (ann.status !== 'open') continue;
      if (ann.includeInAiFeedback) {
        includedAnnotations.push(ann);
      } else {
        excludedAnnotationCount += 1;
      }
    }
  }

  // Compact full-graph topology
  const topologyLines: string[] = [];
  for (const screen of Object.values(project.screens)) {
    const outEdges = Object.values(project.edges)
      .filter((e) => e.sourceScreenId === screen.id)
      .map((e) => {
        const target = project.screens[e.targetScreenId];
        return `--(${e.label}${e.isFinalFlowEdge ? ' ★FINAL' : ''})--> @${target?.slug ?? e.targetScreenId}`;
      });
    topologyLines.push(
      `@${screen.slug} [${screen.priority}${screen.isInFinalFlow ? ', FINAL-FLOW' : ''}, ${screen.policyMode}]: ${outEdges.join(' | ') || '(terminal)'}`
    );
  }

  // 1-hop upstream/downstream neighbors of target screens
  const neighborIds = new Set<string>();
  for (const edge of Object.values(project.edges)) {
    if (targetIds.has(edge.sourceScreenId) && !targetIds.has(edge.targetScreenId)) {
      neighborIds.add(edge.targetScreenId);
    }
    if (targetIds.has(edge.targetScreenId) && !targetIds.has(edge.sourceScreenId)) {
      neighborIds.add(edge.sourceScreenId);
    }
  }

  const neighborSummaries = Array.from(neighborIds)
    .map((id) => project.screens[id])
    .filter(Boolean)
    .map((s) => {
      const active =
        s.variants.find((v) => v.id === s.finalizedVariantId) ??
        s.variants.find((v) => v.id === s.activeVariantId) ??
        s.variants[0];
      return `@${s.slug} (${s.title}, ${s.stage}): ${s.description}. Active option: "${active?.label ?? 'none'}"`;
    });

  // Collect painted mask snapshots strictly from included annotations
  const maskImages = includedAnnotations
    .filter((a) => a.kind === 'paint-region' && a.paintTarget?.maskDataUrl)
    .map((a) => ({
      mentionTag: a.mentionTag,
      screenSlug: project.screens[a.screenId]?.slug ?? a.screenId,
      dataUrl: a.paintTarget!.maskDataUrl!,
    }));

  return {
    prompt,
    mentions,
    targetScreens,
    includedAnnotations,
    excludedAnnotationCount,
    topologySummary: topologyLines.join('\n'),
    neighborSummaries,
    maskImages,
  };
}
