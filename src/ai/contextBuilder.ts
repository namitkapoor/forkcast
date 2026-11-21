import type { FlowProject, ScreenNode } from '../types/studio';
import {
  resolvePromptReferences,
  type ResolvedAnnotationReference,
  type ResolvedPromptReferences,
} from '../domain/references';

export interface AssembledPromptContext {
  prompt: string;
  resolved: ResolvedPromptReferences;
  targetScreens: ScreenNode[];
  includedRefs: ResolvedAnnotationReference[];
  excludedAnnotationCount: number;
  topologySummary: string;
  neighborSummaries: string[];
  formattedAnnotationContext: string;
  maskImages: Array<{ token: string; screenSlug: string; dataUrl: string }>;
}

/**
 * Builds a complete, version-accurate multimodal context payload for Gemini 4.
 * - Resolves versioned mentions (`@Pin-2:v1`, `@Pin-1:v2`, `@Mask-1:v1`, `@Checkout`)
 * - Guarantees EVERY explicitly @mentioned pin/version is passed to Gemini 4 with its exact revision comment,
 *   DOM element target, coordinates, and revision history.
 * - Includes unmentioned open annotations on target screens strictly when `includeInAiFeedback === true`.
 */
export function buildMultimodalContext(
  prompt: string,
  project: FlowProject,
  fallbackScreenId?: string | null,
  detachedKeys?: ReadonlySet<string>
): AssembledPromptContext {
  const resolved = resolvePromptReferences(
    prompt,
    project,
    fallbackScreenId,
    detachedKeys
  );
  const { targetScreens, effectiveAnnotations, excludedAnnotations } = resolved;

  const targetIds = new Set(targetScreens.map((s) => s.id));

  // Full graph topology summary
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

  // 1-hop upstream/downstream neighbors
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

  // Rich versioned annotation serialization for Gemini 4
  const formattedLines = effectiveAnnotations.map((ref) => {
    const { annotation: ann, revision: rev, screen, token, source } = ref;
    const pinnedVariant = screen.variants.find((v) => v.id === ann.variantId);
    const historyTrail =
      ann.revisions.length > 1
        ? ` | Revision history: ${ann.revisions
            .map((r) => `v${r.revisionNumber}="${r.comment}"`)
            .join(' -> ')}`
        : '';

    const domContext = ann.elementTarget
      ? ` | Pinned DOM Element: <${ann.elementTarget.tagName}> text="${ann.elementTarget.textSnippet}" selector="${ann.elementTarget.selector}" coords=(${ann.xPercent}%, ${ann.yPercent}%)`
      : '';

    const paintContext = ann.paintTarget
      ? ` | Painted Region Box: x=${ann.paintTarget.boundingBoxPercent.x}%, y=${ann.paintTarget.boundingBoxPercent.y}%, w=${ann.paintTarget.boundingBoxPercent.w}%, h=${ann.paintTarget.boundingBoxPercent.h}% selectors=[${ann.paintTarget.intersectingSelectors.join(', ')}]`
      : '';

    return `- [annotationId="${ann.id}"] ${token} on @${screen.slug} (variant="${pinnedVariant?.label ?? ann.variantId}", source=${source}, category=${rev.category}, rev=v${rev.revisionNumber}): "${rev.comment}"${domContext}${paintContext}${historyTrail}`;
  });

  const maskImages = effectiveAnnotations
    .filter((r) => r.annotation.kind === 'paint-region' && r.annotation.paintTarget?.maskDataUrl)
    .map((r) => ({
      token: r.token,
      screenSlug: r.screen.slug,
      dataUrl: r.annotation.paintTarget!.maskDataUrl!,
    }));

  return {
    prompt,
    resolved,
    targetScreens,
    includedRefs: effectiveAnnotations,
    excludedAnnotationCount: excludedAnnotations.length,
    topologySummary: topologyLines.join('\n'),
    neighborSummaries,
    formattedAnnotationContext: formattedLines.join('\n'),
    maskImages,
  };
}
