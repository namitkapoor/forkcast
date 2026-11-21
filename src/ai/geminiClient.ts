import { Type, type Schema } from '@google/genai';
import type {
  AnnotationCategory,
  DisambiguationRequest,
  EvaluationReport,
  FlowEdge,
  FlowProject,
  LlmTaskConfig,
  LlmTaskKey,
  PriorityTier,
  RuntimeSettings,
  ScreenAnnotation,
  ScreenNode,
  TokenUsageEntry,
  TraversalTrace,
} from '../types/studio';
import type { AssembledPromptContext } from './contextBuilder';
import { resolveExecutionPolicy } from './budgetPolicy';
import { callGeminiJson } from './geminiSdk';
import { runSimulatedPersonas } from '../eval/traversalRunner';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
}

export interface GenResult<T> {
  data: T;
  usage: TokenUsageEntry;
  usedMock: boolean;
}

export function shouldUseLiveGemini(settings: RuntimeSettings): boolean {
  return Boolean(settings.apiKey.trim()) && !settings.useMockFallback;
}

function makeUsage(
  action: TokenUsageEntry['action'],
  taskKey: LlmTaskKey,
  taskConfig: LlmTaskConfig,
  priority: PriorityTier,
  promptTokens: number,
  outputTokens: number,
  thoughtTokens: number,
  screenId?: string
): TokenUsageEntry {
  return {
    id: uid('tok'),
    timestamp: Date.now(),
    action,
    taskKey,
    screenId,
    priority,
    model: taskConfig.model,
    thinkingLevel: taskConfig.thinkingLevel,
    promptTokens,
    outputTokens,
    thoughtTokens,
    totalTokens: promptTokens + outputTokens + thoughtTokens,
  };
}

// ---------------------------------------------------------------------------
// 1. Intent & Ambiguity Engine (Task: DISAMBIGUATE)
// ---------------------------------------------------------------------------
export async function assessPromptAmbiguity(
  prompt: string,
  project: FlowProject,
  settings: RuntimeSettings,
  signal?: AbortSignal
): Promise<GenResult<{ ambiguous: boolean; request: DisambiguationRequest | null }>> {
  const policy = resolveExecutionPolicy(project, settings, null, 'disambiguate');

  // Fast local short-circuit: if the prompt contains any @Screen or @Pin-N:vK mention,
  // it is an explicit targeted refinement — skip network disambiguation immediately!
  const hasExplicitMention = /@[A-Za-z0-9_:-]+/.test(prompt);
  if (hasExplicitMention) {
    return {
      data: { ambiguous: false, request: null },
      usage: makeUsage('disambiguate', policy.taskKey, policy.taskConfig, 'supporting', 0, 0, 0),
      usedMock: !shouldUseLiveGemini(settings),
    };
  }

  const looksLikeOpenNewFlow =
    /(design|create|build|new flow|journey|app|onboarding|portal|store|marketplace)/i.test(
      prompt
    ) && prompt.trim().split(/\s+/).length < 24;

  if (!looksLikeOpenNewFlow) {
    return {
      data: { ambiguous: false, request: null },
      usage: makeUsage('disambiguate', policy.taskKey, policy.taskConfig, 'supporting', 0, 0, 0),
      usedMock: !shouldUseLiveGemini(settings),
    };
  }

  if (shouldUseLiveGemini(settings)) {
    const systemPrompt = `You are the Intent & Ambiguity Engine for Forkcast Studio.
Given an open-ended UI flow request, output 3 concise visual disambiguation controls so the designer clarifies structure and tone in 3 clicks instead of prose walls.
Return strict JSON:
{
  "uncertaintyScore": 0.0-1.0,
  "rationale": "short 1-line explanation of why clarifying saves tokens",
  "estimatedTokenSavings": 14000,
  "controls": [
    { "id": "c1", "kind": "choice-cards", "label": "Journey Structure", "multiSelect": false, "options": [{ "id": "o1", "title": "...", "subtitle": "...", "badge": "Recommended" }], "selectedIds": ["o1"] },
    { "id": "c2", "kind": "visual-preview", "label": "Visual Direction", "options": [{ "id": "v1", "title": "...", "palette": ["#111827","#10B981","#FAF8F5"], "layoutHint": "Editorial Split" }], "selectedId": "v1" },
    { "id": "c3", "kind": "slider", "label": "Information Density", "min": 1, "max": 5, "step": 1, "unit": "/5", "value": 3, "minLabel": "Minimal", "maxLabel": "Data-Rich" }
  ]
}`;

    const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
      uncertaintyScore: number;
      rationale: string;
      estimatedTokenSavings?: number;
      controls: DisambiguationRequest['controls'];
    }>({
      settings,
      taskConfig: policy.taskConfig,
      systemPrompt,
      userText: `Project: ${project.name}.\nNew flow request: "${prompt}"`,
      signal,
    });

    const ambiguous = parsed.uncertaintyScore >= 0.4 && (parsed.controls?.length ?? 0) > 0;
    return {
      data: {
        ambiguous,
        request: ambiguous
          ? {
              id: uid('disambig'),
              originalPrompt: prompt,
              uncertaintyScore: parsed.uncertaintyScore,
              rationale: parsed.rationale,
              estimatedTokenSavings: parsed.estimatedTokenSavings ?? 14500,
              controls: parsed.controls,
              createdAt: Date.now(),
            }
          : null,
      },
      usage: makeUsage(
        'disambiguate',
        policy.taskKey,
        policy.taskConfig,
        'supporting',
        promptTokens,
        outputTokens,
        thoughtTokens
      ),
      usedMock: false,
    };
  }

  await new Promise((r) => setTimeout(r, 250));
  return {
    data: {
      ambiguous: true,
      request: {
        id: uid('disambig'),
        originalPrompt: prompt,
        uncertaintyScore: 0.78,
        rationale:
          '3 quick visual decisions prevent blind full-screen guessing and focus ~65% of token spend on your core UX path.',
        estimatedTokenSavings: 18400,
        createdAt: Date.now(),
        controls: [
          {
            id: 'flow-depth',
            kind: 'choice-cards',
            label: 'Journey Structure',
            multiSelect: false,
            selectedIds: ['guided-core'],
            options: [
              {
                id: 'guided-core',
                title: 'Guided 4-Step Flow',
                subtitle: 'Entry → Personalize → Core Action → Confirmation',
                badge: 'Recommended',
              },
              {
                id: 'express-2',
                title: 'Express 2-Step Fast Path',
                subtitle: 'Minimal friction, single conversion screen',
                badge: 'Low Friction',
              },
              {
                id: 'branched-pro',
                title: 'Branched Flow + Recovery',
                subtitle: 'Includes error/edge-case recovery screen',
                badge: 'Complete',
              },
            ],
          },
          {
            id: 'visual-tone',
            kind: 'visual-preview',
            label: 'Visual Direction',
            selectedId: 'editorial-light',
            options: [
              {
                id: 'editorial-light',
                title: 'Warm Editorial',
                palette: ['#FAF8F5', '#1C1917', '#D97706'],
                layoutHint: 'Airy cards & crisp hierarchy',
              },
              {
                id: 'linear-dark',
                title: 'Precision Dark',
                palette: ['#09090B', '#6366F1', '#10B981'],
                layoutHint: 'High-contrast SaaS controls',
              },
              {
                id: 'clinical-clean',
                title: 'Clean Utility',
                palette: ['#FFFFFF', '#0F172A', '#2563EB'],
                layoutHint: 'High-clarity tables & forms',
              },
            ],
          },
          {
            id: 'density',
            kind: 'slider',
            label: 'Information Density',
            min: 1,
            max: 5,
            step: 1,
            unit: '/5',
            value: 3,
            minLabel: 'Spacious',
            maxLabel: 'Dense',
          },
        ],
      },
    },
    usage: makeUsage('disambiguate', policy.taskKey, policy.taskConfig, 'supporting', 280, 240, 0),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 2. Refine Screen with Versioned Pins & Masks (Tasks: REFINE_CORE / REFINE_SMALL)
// ---------------------------------------------------------------------------
export interface RefinementOutput {
  targetScreenId: string;
  newVariantLabel: string;
  rationale: string;
  html: string;
  resolvedAnnotationIds: string[];
}

export async function refineScreenWithAI(
  context: AssembledPromptContext,
  project: FlowProject,
  settings: RuntimeSettings,
  signal?: AbortSignal
): Promise<GenResult<RefinementOutput>> {
  const targetScreen =
    context.targetScreens[0] ??
    (project.selectedScreenId ? project.screens[project.selectedScreenId] : null) ??
    Object.values(project.screens)[0];

  const policy = resolveExecutionPolicy(project, settings, targetScreen, 'point-paint-refine');
  const currentVariant =
    targetScreen.variants.find((v) => v.id === targetScreen.activeVariantId) ??
    targetScreen.variants[0];

  if (shouldUseLiveGemini(settings)) {
    const systemPrompt = `You are a Principal Product Designer AI inside Forkcast Studio.
Your job is to produce a VISIBLY IMPROVED, production-polished Tailwind CSS HTML iteration of the target screen that directly and unmistakably implements the designer's prompt AND every referenced versioned annotation (@Pin-N:vK / @Mask-N:vK).
Rules:
1. Locate the exact DOM element(s) or painted region(s) described in the Versioned Annotations section and apply clear, noticeable visual, structural, and UX improvements matching the requested revision text.
2. Return the COMPLETE self-contained HTML body markup (starting with <div class="min-h-screen ...">), styled cleanly with Tailwind CSS utility classes.
3. Preserve existing data-fc-edge="..." attributes on navigation buttons so interactive flow testing stays wired.
4. Return strict JSON matching the schema.`;

    const userPayload = `Designer Prompt: ${context.prompt}
Device Preset: ${project.devicePreset} (${project.devicePreset === 'desktop' ? '1280x800' : '390x844'})
Target Screen: @${targetScreen.slug} — ${targetScreen.title} (${targetScreen.stage})
Active Variant Being Iterated: "${currentVariant?.label ?? 'Initial'}"

Flow Topology:
${context.topologySummary}

Connected 1-Hop Neighbors:
${context.neighborSummaries.join('\n') || 'None'}

Versioned Annotations & Pin Context Passed to AI (${context.includedRefs.length} item(s)):
${context.formattedAnnotationContext || 'None — execute Designer Prompt directly on Target Screen.'}

Current Screen HTML:
${
  currentVariant?.html ||
  `<div class="min-h-screen bg-[#FAF8F5] p-12"><h1>${targetScreen.title}</h1><p>${targetScreen.description}</p></div>`
}`;

    const refineSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        newVariantLabel: { type: Type.STRING },
        rationale: { type: Type.STRING },
        html: { type: Type.STRING },
        resolvedAnnotationIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['newVariantLabel', 'rationale', 'html', 'resolvedAnnotationIds'],
    };

    const { parsed, promptTokens, outputTokens, thoughtTokens } =
      await callGeminiJson<Omit<RefinementOutput, 'targetScreenId'>>({
        settings,
        taskConfig: policy.taskConfig,
        systemPrompt,
        userText: userPayload,
        images: context.maskImages.map((m) => ({ dataUrl: m.dataUrl })),
        responseSchema: refineSchema,
        signal,
      });

    return {
      data: {
        targetScreenId: targetScreen.id,
        newVariantLabel:
          parsed.newVariantLabel ||
          `Option ${String.fromCharCode(65 + targetScreen.variants.length)} — AI Iteration`,
        rationale: parsed.rationale || 'Applied versioned pin feedback and designer directive.',
        html: parsed.html || currentVariant.html,
        resolvedAnnotationIds:
          parsed.resolvedAnnotationIds?.length > 0
            ? parsed.resolvedAnnotationIds
            : context.includedRefs.map((r) => r.annotation.id),
      },
      usage: makeUsage(
        'point-paint-refine',
        policy.taskKey,
        policy.taskConfig,
        policy.tier,
        promptTokens,
        outputTokens,
        thoughtTokens,
        targetScreen.id
      ),
      usedMock: false,
    };
  }

  // Demo Mode fallback
  await new Promise((r) => setTimeout(r, 700));
  const combinedIntent = `${context.prompt} ${context.includedRefs
    .map((r) => r.revision.comment)
    .join(' ')}`.toLowerCase();

  let refinedHtml = currentVariant?.html || '';
  const nextLetter = String.fromCharCode(65 + targetScreen.variants.length);
  const refTokens = context.includedRefs.map((r) => r.token).join(', ');
  let label = `Option ${nextLetter} — Refined`;
  let rationale = `Applied ${refTokens || 'prompt feedback'} (${context.prompt.slice(0, 72)}).`;

  if (!refinedHtml.trim()) {
    refinedHtml = buildRichMockScreenHtml(targetScreen, combinedIntent);
    label = 'Option A — Expanded Live UI';
  } else if (combinedIntent.includes('dark')) {
    label = `Option ${nextLetter} — Precision Dark`;
    refinedHtml = refinedHtml
      .replace(/bg-\[#FAF8F5\]/g, 'bg-zinc-950')
      .replace(/bg-white/g, 'bg-zinc-900')
      .replace(/text-stone-900/g, 'text-zinc-100')
      .replace(/text-stone-950/g, 'text-white')
      .replace(/border-stone-200/g, 'border-zinc-800');
  } else {
    label = `Option ${nextLetter} — Emerald Trust Iteration`;
    refinedHtml = refinedHtml
      .replace(
        /bg-stone-950 text-white/g,
        'bg-emerald-600 text-white ring-2 ring-emerald-400/40 shadow-emerald-600/25'
      )
      .replace(
        '<main',
        `<div class="bg-emerald-950 text-emerald-200 text-xs font-medium px-12 py-2.5 flex items-center justify-between border-b border-emerald-800">
          <span>✓ Iterated from ${refTokens || 'Designer Prompt'}: ${
            context.includedRefs[0]?.revision.comment ?? context.prompt.slice(0, 64)
          }</span>
          <span class="font-mono text-[11px] opacity-80">Demo Fallback</span>
        </div><main`
      );
  }

  return {
    data: {
      targetScreenId: targetScreen.id,
      newVariantLabel: label,
      rationale,
      html: refinedHtml,
      resolvedAnnotationIds: context.includedRefs.map((r) => r.annotation.id),
    },
    usage: makeUsage(
      'point-paint-refine',
      policy.taskKey,
      policy.taskConfig,
      policy.tier,
      Math.round(policy.estimatedTokens * 0.42),
      Math.round(policy.estimatedTokens * 0.44),
      policy.thinkingLevel !== 'LOW' ? Math.round(policy.estimatedTokens * 0.14) : 0,
      targetScreen.id
    ),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 3. Explore Variant (Tasks: VARIANT_CORE / VARIANT_STANDARD / VARIANT_SUPPORTING)
// ---------------------------------------------------------------------------
export async function generateVariantForScreen(
  screen: ScreenNode,
  project: FlowProject,
  settings: RuntimeSettings,
  styleHint = 'Explore a distinct layout direction that reduces cognitive load and improves conversion clarity.',
  signal?: AbortSignal
): Promise<GenResult<{ label: string; rationale: string; html: string }>> {
  const policy = resolveExecutionPolicy(project, settings, screen, 'generate-variant');

  if (shouldUseLiveGemini(settings)) {
    const systemPrompt = `You are an expert UI designer inside Forkcast Studio.
Create ONE genuinely distinct, production-polished Tailwind CSS web screen variant for the given screen node.
Return strict JSON matching the schema.`;

    const outEdges = Object.values(project.edges)
      .filter((e) => e.sourceScreenId === screen.id)
      .map((e) => `data-fc-edge="${e.id}" for "${e.label}"`)
      .join(', ');

    const userPayload = `Screen: @${screen.slug} — ${screen.title} (${screen.stage})
Description: ${screen.description}
Device: ${project.devicePreset} (${project.devicePreset === 'desktop' ? '1280x800' : '390x844'})
Existing option labels (make something visually distinct): ${screen.variants.map((v) => v.label).join(', ')}
Wire primary CTA buttons with: ${outEdges || 'standard buttons'}
Creative direction: ${styleHint}`;

    const variantSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        rationale: { type: Type.STRING },
        html: { type: Type.STRING },
      },
      required: ['label', 'rationale', 'html'],
    };

    const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
      label: string;
      rationale: string;
      html: string;
    }>({
      settings,
      taskConfig: policy.taskConfig,
      systemPrompt,
      userText: userPayload,
      responseSchema: variantSchema,
      signal,
    });

    return {
      data: parsed,
      usage: makeUsage(
        'generate-variant',
        policy.taskKey,
        policy.taskConfig,
        policy.tier,
        promptTokens,
        outputTokens,
        thoughtTokens,
        screen.id
      ),
      usedMock: false,
    };
  }

  await new Promise((r) => setTimeout(r, 650));
  const nextLetter = String.fromCharCode(65 + screen.variants.length);
  return {
    data: {
      label: `Option ${nextLetter} — Guided Minimal`,
      rationale:
        screen.fidelity === 'skeleton'
          ? 'Expanded progressive skeleton into full interactive desktop UI.'
          : 'Explored a high-clarity asymmetric layout with prominent trust signals and single focal CTA.',
      html: buildRichMockScreenHtml(screen, styleHint),
    },
    usage: makeUsage(
      'generate-variant',
      policy.taskKey,
      policy.taskConfig,
      policy.tier,
      Math.round(policy.estimatedTokens * 0.35),
      Math.round(policy.estimatedTokens * 0.5),
      policy.thinkingLevel !== 'LOW' ? Math.round(policy.estimatedTokens * 0.15) : 0,
      screen.id
    ),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 4. Generate New Flow from Disambiguation (Task: FLOW_ARCHITECT)
// ---------------------------------------------------------------------------
export async function generateNewFlowFromDisambiguation(
  prompt: string,
  answersSummary: string,
  project: FlowProject,
  settings: RuntimeSettings,
  signal?: AbortSignal
): Promise<
  GenResult<{
    projectName: string;
    screens: Record<string, ScreenNode>;
    edges: Record<string, FlowEdge>;
  }>
> {
  const policy = resolveExecutionPolicy(project, settings, null, 'generate-flow');

  if (shouldUseLiveGemini(settings)) {
    const systemPrompt = `You are a Principal UX Architect inside Forkcast Studio.
Generate a progressive-reveal 4-screen user flow graph for the product prompt and disambiguation choices.
Core UX screens get full interactive Tailwind HTML; Supporting screens get skeletonBullets only (Progressive Reveal).
Return strict JSON matching the schema.`;

    const flowSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        projectName: { type: Type.STRING },
        screens: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              slug: { type: Type.STRING },
              title: { type: Type.STRING },
              stage: { type: Type.STRING },
              description: { type: Type.STRING },
              priority: { type: Type.STRING },
              isInFinalFlow: { type: Type.BOOLEAN },
              fidelity: { type: Type.STRING },
              variantLabel: { type: Type.STRING },
              rationale: { type: Type.STRING },
              html: { type: Type.STRING },
              skeletonBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['id', 'slug', 'title', 'stage', 'description', 'priority', 'isInFinalFlow', 'fidelity', 'variantLabel', 'rationale'],
          },
        },
        edges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              sourceScreenId: { type: Type.STRING },
              targetScreenId: { type: Type.STRING },
              label: { type: Type.STRING },
              edgeType: { type: Type.STRING },
              isFinalFlowEdge: { type: Type.BOOLEAN },
            },
            required: ['id', 'sourceScreenId', 'targetScreenId', 'label', 'edgeType', 'isFinalFlowEdge'],
          },
        },
      },
      required: ['projectName', 'screens', 'edges'],
    };

    const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
      projectName: string;
      screens: Array<{
        id: string;
        slug: string;
        title: string;
        stage: string;
        description: string;
        priority: PriorityTier;
        isInFinalFlow: boolean;
        fidelity: 'interactive' | 'skeleton';
        variantLabel: string;
        rationale: string;
        html?: string;
        skeletonBullets?: string[];
      }>;
      edges: Array<{
        id: string;
        sourceScreenId: string;
        targetScreenId: string;
        label: string;
        edgeType: FlowEdge['edgeType'];
        isFinalFlowEdge: boolean;
      }>;
    }>({
      settings,
      taskConfig: policy.taskConfig,
      systemPrompt,
      userText: `Prompt: ${prompt}\nDisambiguation Choices:\n${answersSummary}\nViewport: ${project.devicePreset}`,
      responseSchema: flowSchema,
      signal,
    });

    const screens: Record<string, ScreenNode> = {};
    const now = Date.now();
    parsed.screens.forEach((s, idx) => {
      const varId = uid('var');
      const prio: PriorityTier =
        s.priority === 'core' || s.priority === 'standard' || s.priority === 'supporting'
          ? s.priority
          : 'standard';
      const fid = s.fidelity === 'skeleton' ? 'skeleton' : 'interactive';
      screens[s.id] = {
        id: s.id,
        slug: s.slug.replace(/[^A-Za-z0-9_-]/g, '') || `Screen${idx + 1}`,
        title: s.title,
        stage: s.stage,
        description: s.description,
        priority: prio,
        policyMode: 'explore',
        fidelity: fid,
        isInFinalFlow: s.isInFinalFlow ?? true,
        position: { x: 60 + idx * 510, y: s.isInFinalFlow ? 100 : 540 },
        activeVariantId: varId,
        finalizedVariantId: varId,
        annotations: [],
        evaluation: null,
        status: 'idle',
        variants: [
          {
            id: varId,
            label: s.variantLabel || 'Option A — Initial Concept',
            rationale: s.rationale || 'Generated from disambiguated journey brief.',
            fidelity: fid,
            isHidden: false,
            html: s.html || '',
            skeletonBullets: s.skeletonBullets,
            createdAt: now,
            modelUsed: policy.model,
            tokensUsed: Math.round(
              (promptTokens + outputTokens) / Math.max(1, parsed.screens.length)
            ),
            banditStats: {
              alpha: 2,
              beta: 2,
              impressions: 0,
              completions: 0,
              hesitations: 0,
              backtracks: 0,
              avgDwellMs: 0,
            },
          },
        ],
      };
    });

    const edges: Record<string, FlowEdge> = {};
    parsed.edges.forEach((e) => {
      edges[e.id] = {
        ...e,
        edgeType:
          e.edgeType === 'primary' ||
          e.edgeType === 'alternate' ||
          e.edgeType === 'error' ||
          e.edgeType === 'back'
            ? e.edgeType
            : 'primary',
        metrics: { traversals: 0, completions: 0, backtracks: 0 },
      };
    });

    return {
      data: { projectName: parsed.projectName || 'Generated Studio Flow', screens, edges },
      usage: makeUsage(
        'generate-flow',
        policy.taskKey,
        policy.taskConfig,
        'core',
        promptTokens,
        outputTokens,
        thoughtTokens
      ),
      usedMock: false,
    };
  }

  // Demo Mode Flow Generation
  await new Promise((r) => setTimeout(r, 750));
  const cleanTitle = prompt.trim().slice(0, 40) || 'Custom Product Flow';
  const now = Date.now();
  const s1: ScreenNode = {
    id: 'gen-entry',
    slug: 'Entry',
    title: 'Landing & Value Hook',
    stage: 'Discovery',
    description: `Hero entry screen for: ${prompt}`,
    priority: 'standard',
    policyMode: 'explore',
    fidelity: 'interactive',
    isInFinalFlow: true,
    position: { x: 60, y: 110 },
    activeVariantId: 'gen-entry-a',
    finalizedVariantId: 'gen-entry-a',
    annotations: [],
    evaluation: null,
    status: 'idle',
    variants: [
      {
        id: 'gen-entry-a',
        label: 'Option A — Editorial Hero',
        rationale: 'Clear value hook aligned with disambiguated visual direction.',
        fidelity: 'interactive',
        isHidden: false,
        html: buildRichMockScreenHtml(
          { title: cleanTitle, slug: 'Entry', stage: 'Discovery', description: prompt } as ScreenNode,
          answersSummary,
          'e-entry-core'
        ),
        createdAt: now,
        modelUsed: settings.llmTasks.VARIANT_STANDARD.model,
        tokensUsed: 2400,
        banditStats: { alpha: 3, beta: 1.5, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
    ],
  };

  const s2: ScreenNode = {
    id: 'gen-core',
    slug: 'CoreAction',
    title: 'Core Configuration & Options',
    stage: 'Core UX Focus',
    description: `High-impact interactive step for ${prompt}`,
    priority: 'core',
    policyMode: 'explore',
    fidelity: 'interactive',
    isInFinalFlow: true,
    position: { x: 580, y: 110 },
    activeVariantId: 'gen-core-a',
    finalizedVariantId: 'gen-core-a',
    annotations: [],
    evaluation: null,
    status: 'idle',
    variants: [
      {
        id: 'gen-core-a',
        label: 'Option A — Guided Cards',
        rationale: 'Core Focus screen with 2 divergent options pre-generated.',
        fidelity: 'interactive',
        isHidden: false,
        html: buildRichMockScreenHtml(
          { title: 'Core Selection & Config', slug: 'CoreAction', stage: 'Core UX Focus', description: prompt } as ScreenNode,
          answersSummary,
          'e-core-done'
        ),
        createdAt: now,
        modelUsed: settings.llmTasks.VARIANT_CORE.model,
        tokensUsed: 4100,
        banditStats: { alpha: 3, beta: 2, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
    ],
  };

  const s3: ScreenNode = {
    id: 'gen-done',
    slug: 'Success',
    title: 'Confirmation & Next Steps',
    stage: 'Post-Action',
    description: 'Progressive skeleton conserving Core Focus token spend.',
    priority: 'supporting',
    policyMode: 'explore',
    fidelity: 'skeleton',
    isInFinalFlow: true,
    position: { x: 1100, y: 110 },
    activeVariantId: 'gen-done-skel',
    finalizedVariantId: 'gen-done-skel',
    annotations: [],
    evaluation: null,
    status: 'idle',
    variants: [
      {
        id: 'gen-done-skel',
        label: 'Skeleton Preview',
        rationale: 'Low-token progressive reveal — expand to full UI anytime.',
        fidelity: 'skeleton',
        isHidden: false,
        html: '',
        skeletonBullets: [
          'Success state confirmation header + reference ID',
          'Summary of selected plan / action & immediate receipt',
          'Primary return CTA + share/invite secondary action',
        ],
        createdAt: now,
        modelUsed: settings.llmTasks.VARIANT_SUPPORTING.model,
        tokensUsed: 620,
        banditStats: { alpha: 4, beta: 1, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
    ],
  };

  return {
    data: {
      projectName: cleanTitle,
      screens: { [s1.id]: s1, [s2.id]: s2, [s3.id]: s3 },
      edges: {
        'e-entry-core': {
          id: 'e-entry-core',
          sourceScreenId: 'gen-entry',
          targetScreenId: 'gen-core',
          label: 'Get Started',
          edgeType: 'primary',
          isFinalFlowEdge: true,
          metrics: { traversals: 0, completions: 0, backtracks: 0 },
        },
        'e-core-done': {
          id: 'e-core-done',
          sourceScreenId: 'gen-core',
          targetScreenId: 'gen-done',
          label: 'Complete',
          edgeType: 'primary',
          isFinalFlowEdge: true,
          metrics: { traversals: 0, completions: 0, backtracks: 0 },
        },
      },
    },
    usage: makeUsage('generate-flow', policy.taskKey, policy.taskConfig, 'core', 1800, 3600, 750),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 5. Multimodal UX Evaluator (Tasks: UX_EVAL_CORE / UX_EVAL_LIGHT)
// ---------------------------------------------------------------------------
export async function evaluateScreenWithAI(
  screen: ScreenNode,
  project: FlowProject,
  settings: RuntimeSettings,
  signal?: AbortSignal
): Promise<
  GenResult<{
    report: EvaluationReport;
    aiPins: Omit<ScreenAnnotation, 'id' | 'mentionTag' | 'createdAt' | 'revisions'>[];
  }>
> {
  const policy = resolveExecutionPolicy(project, settings, screen, 'ux-eval');
  const active =
    screen.variants.find((v) => v.id === screen.activeVariantId) ?? screen.variants[0];

  const connectedEdges = Object.values(project.edges).filter(
    (e) => e.sourceScreenId === screen.id || e.targetScreenId === screen.id
  );

  if (shouldUseLiveGemini(settings) && active?.html) {
    const systemPrompt = `You are a Staff UX Researcher & Design Critic inside Forkcast Studio.
Evaluate the screen HTML for usability, visualHierarchy, accessibility, and flowContinuity across connected edges.
Return strict JSON matching the schema.`;

    const evalSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        overallScore: { type: Type.NUMBER },
        dimensions: {
          type: Type.OBJECT,
          properties: {
            usability: { type: Type.NUMBER },
            visualHierarchy: { type: Type.NUMBER },
            accessibility: { type: Type.NUMBER },
            flowContinuity: { type: Type.NUMBER },
          },
          required: ['usability', 'visualHierarchy', 'accessibility', 'flowContinuity'],
        },
        summary: { type: Type.STRING },
        pins: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              xPercent: { type: Type.NUMBER },
              yPercent: { type: Type.NUMBER },
              category: { type: Type.STRING },
              severity: { type: Type.STRING },
              selector: { type: Type.STRING },
              tagName: { type: Type.STRING },
              textSnippet: { type: Type.STRING },
              comment: { type: Type.STRING },
            },
            required: ['xPercent', 'yPercent', 'category', 'severity', 'selector', 'tagName', 'textSnippet', 'comment'],
          },
        },
      },
      required: ['overallScore', 'dimensions', 'summary', 'pins'],
    };

    const userPayload = `Screen: @${screen.slug} (${screen.title})
Connected transitions: ${connectedEdges.map((e) => `${e.sourceScreenId} --(${e.label})--> ${e.targetScreenId}`).join(' | ')}
HTML:\n${active.html}`;

    const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
      overallScore: number;
      dimensions: EvaluationReport['dimensions'];
      summary: string;
      pins: Array<{
        xPercent: number;
        yPercent: number;
        category: AnnotationCategory;
        severity: 'info' | 'warning' | 'critical';
        selector: string;
        tagName: string;
        textSnippet: string;
        comment: string;
      }>;
    }>({
      settings,
      taskConfig: policy.taskConfig,
      systemPrompt,
      userText: userPayload,
      responseSchema: evalSchema,
      signal,
    });

    const validCategories = new Set(['usability', 'hierarchy', 'copy', 'accessibility', 'layout', 'flow']);
    return {
      data: {
        report: {
          overallScore: Math.round(parsed.overallScore),
          dimensions: {
            usability: Math.round(parsed.dimensions.usability),
            visualHierarchy: Math.round(parsed.dimensions.visualHierarchy),
            accessibility: Math.round(parsed.dimensions.accessibility),
            flowContinuity: Math.round(parsed.dimensions.flowContinuity),
          },
          summary: parsed.summary,
          modelUsed: policy.model,
          tokensUsed: promptTokens + outputTokens + thoughtTokens,
          evaluatedAt: Date.now(),
        },
        aiPins: (parsed.pins ?? []).slice(0, 2).map((p) => ({
          screenId: screen.id,
          variantId: active.id,
          author: 'ai-evaluator' as const,
          kind: 'point-element' as const,
          includeInAiFeedback: true,
          xPercent: Math.min(90, Math.max(10, Math.round(p.xPercent))),
          yPercent: Math.min(90, Math.max(10, Math.round(p.yPercent))),
          elementTarget: {
            selector: p.selector || 'main button',
            tagName: p.tagName || 'button',
            textSnippet: p.textSnippet || 'Target UI element',
            boundingBox: { x: 100, y: 100, w: 200, h: 48 },
          },
          category: (validCategories.has(p.category) ? p.category : 'usability') as AnnotationCategory,
          severity: p.severity === 'critical' || p.severity === 'info' ? p.severity : 'warning',
          comment: p.comment,
          status: 'open' as const,
        })),
      },
      usage: makeUsage(
        'ux-eval',
        policy.taskKey,
        policy.taskConfig,
        policy.tier,
        promptTokens,
        outputTokens,
        thoughtTokens,
        screen.id
      ),
      usedMock: false,
    };
  }

  await new Promise((r) => setTimeout(r, 550));
  const baseScore = screen.id === 'checkout' ? 76 : 86;
  const totalTok = policy.estimatedTokens;

  return {
    data: {
      report: {
        overallScore: baseScore,
        dimensions: {
          usability: Math.min(98, baseScore + 3),
          visualHierarchy: Math.min(96, baseScore + 1),
          accessibility: Math.min(95, baseScore - 1),
          flowContinuity: Math.min(96, baseScore - 3),
        },
        summary: `Good structural clarity on @${screen.slug}; primary action contrast and upstream continuity can be tightened.`,
        modelUsed: policy.model,
        tokensUsed: totalTok,
        evaluatedAt: Date.now(),
      },
      aiPins: [
        {
          screenId: screen.id,
          variantId: active?.id ?? '',
          author: 'ai-evaluator',
          kind: 'point-element',
          includeInAiFeedback: true,
          xPercent: 60,
          yPercent: 30,
          elementTarget: {
            selector: 'main h1, main h2',
            tagName: 'h2',
            textSnippet: screen.title,
            boundingBox: { x: 120, y: 140, w: 320, h: 40 },
          },
          category: 'flow',
          severity: 'warning',
          comment: `Reinforce the upstream selection directly in @${screen.slug} header to reduce backtracking.`,
          status: 'open',
        },
      ],
    },
    usage: makeUsage(
      'ux-eval',
      policy.taskKey,
      policy.taskConfig,
      policy.tier,
      Math.round(totalTok * 0.55),
      Math.round(totalTok * 0.35),
      policy.thinkingLevel !== 'LOW' ? Math.round(totalTok * 0.1) : 0,
      screen.id
    ),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 6. Simulated Persona Traversals (Task: PERSONA_SIM)
// ---------------------------------------------------------------------------
export async function simulatePersonasWithAI(
  project: FlowProject,
  settings: RuntimeSettings,
  signal?: AbortSignal
): Promise<GenResult<TraversalTrace[]>> {
  const policy = resolveExecutionPolicy(project, settings, null, 'simulate-personas');

  if (shouldUseLiveGemini(settings)) {
    const systemPrompt = `You are a UX Behavioral Simulator inside Forkcast Studio.
Simulate 4 diverse user personas walking through the given UI flow graph. Estimate realistic dwellMs, deadClicks, hesitated, backtracked, and completed outcomes.
Use ONLY valid screenId, variantId, and edgeId values from the input. Return strict JSON.`;

    const personaSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        traces: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              personaLabel: { type: Type.STRING },
              completed: { type: Type.BOOLEAN },
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    screenId: { type: Type.STRING },
                    variantId: { type: Type.STRING },
                    edgeIdTaken: { type: Type.STRING },
                    dwellMs: { type: Type.NUMBER },
                    deadClicks: { type: Type.NUMBER },
                    hesitated: { type: Type.BOOLEAN },
                    backtracked: { type: Type.BOOLEAN },
                  },
                  required: ['screenId', 'variantId', 'dwellMs', 'deadClicks', 'hesitated', 'backtracked'],
                },
              },
            },
            required: ['personaLabel', 'completed', 'steps'],
          },
        },
      },
      required: ['traces'],
    };

    const screenSummary = Object.values(project.screens)
      .map((s) => {
        const active = s.variants.find((v) => v.id === s.activeVariantId) ?? s.variants[0];
        const issues = s.annotations
          .filter((a) => a.status === 'open')
          .map((a) => a.comment)
          .join('; ');
        return `Screen id="${s.id}" (@${s.slug}), activeVariantId="${active?.id ?? ''}", uxScore=${
          s.evaluation?.overallScore ?? 'n/a'
        }, openIssues="${issues || 'none'}"`;
      })
      .join('\n');

    const edgeSummary = Object.values(project.edges)
      .map(
        (e) =>
          `Edge id="${e.id}": ${e.sourceScreenId} --(${e.label}, type=${e.edgeType}, final=${e.isFinalFlowEdge})--> ${e.targetScreenId}`
      )
      .join('\n');

    const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
      traces: Array<{
        personaLabel: string;
        completed: boolean;
        steps: Array<{
          screenId: string;
          variantId: string;
          edgeIdTaken?: string;
          dwellMs: number;
          deadClicks: number;
          hesitated: boolean;
          backtracked: boolean;
        }>;
      }>;
    }>({
      settings,
      taskConfig: policy.taskConfig,
      systemPrompt,
      userText: `Screens:\n${screenSummary}\n\nEdges:\n${edgeSummary}`,
      responseSchema: personaSchema,
      signal,
    });

    const now = Date.now();
    const validTraces: TraversalTrace[] = (parsed.traces ?? [])
      .map((t, idx) => ({
        id: uid(`trace-ai-${idx}`),
        actor: 'simulated-persona' as const,
        personaLabel: t.personaLabel || `Persona ${idx + 1}`,
        startedAt: now - (4 - idx) * 12000,
        completed: Boolean(t.completed),
        steps: (t.steps ?? [])
          .filter((st) => Boolean(project.screens[st.screenId]))
          .map((st) => ({
            screenId: st.screenId,
            variantId: st.variantId || project.screens[st.screenId]?.activeVariantId || '',
            edgeIdTaken:
              st.edgeIdTaken && project.edges[st.edgeIdTaken] ? st.edgeIdTaken : undefined,
            enteredAt: now,
            dwellMs: Math.max(1200, Math.min(30000, Math.round(Number(st.dwellMs) || 5000))),
            deadClicks: Math.max(0, Math.min(6, Math.round(Number(st.deadClicks) || 0))),
            hesitated: Boolean(st.hesitated),
            backtracked: Boolean(st.backtracked),
          })),
      }))
      .filter((t) => t.steps.length > 0);

    return {
      data: validTraces.length > 0 ? validTraces : runSimulatedPersonas(project),
      usage: makeUsage(
        'simulate-personas',
        policy.taskKey,
        policy.taskConfig,
        'standard',
        promptTokens,
        outputTokens,
        thoughtTokens
      ),
      usedMock: false,
    };
  }

  const traces = runSimulatedPersonas(project);
  return {
    data: traces,
    usage: makeUsage(
      'simulate-personas',
      policy.taskKey,
      policy.taskConfig,
      'standard',
      1120,
      840,
      policy.thinkingLevel !== 'LOW' ? 220 : 0
    ),
    usedMock: true,
  };
}

function buildRichMockScreenHtml(
  screen: Pick<ScreenNode, 'title' | 'slug' | 'stage' | 'description'>,
  hint: string,
  primaryEdgeId?: string
): string {
  const isDark = /dark|contrast|linear/i.test(hint);
  const bg = isDark ? 'bg-zinc-950 text-zinc-100' : 'bg-[#FAF8F5] text-stone-900';
  const card = isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-stone-200';
  const muted = isDark ? 'text-zinc-400' : 'text-stone-600';
  const cta = isDark
    ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
    : 'bg-stone-950 text-white hover:bg-stone-800';
  const edgeAttr = primaryEdgeId ? `data-fc-edge="${primaryEdgeId}"` : '';

  return `
<div class="min-h-screen ${bg} font-sans">
  <header class="flex items-center justify-between px-12 py-5 border-b ${isDark ? 'border-zinc-800' : 'border-stone-200'}">
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 rounded-lg bg-emerald-500 text-zinc-950 font-bold flex items-center justify-center">F</div>
      <span class="font-semibold tracking-tight">${screen.title}</span>
    </div>
    <span class="text-xs px-3 py-1 rounded-full ${isDark ? 'bg-violet-500/20 text-violet-300' : 'bg-amber-100 text-amber-900'} font-semibold">${screen.stage}</span>
  </header>
  <main class="max-w-5xl mx-auto px-12 py-12 grid grid-cols-12 gap-8 items-start">
    <div class="col-span-7 space-y-6">
      <div class="space-y-2">
        <span class="text-xs uppercase tracking-widest text-emerald-500 font-semibold">@${screen.slug}</span>
        <h1 class="text-4xl font-bold tracking-tight leading-tight">${screen.title}</h1>
        <p class="${muted} text-base leading-relaxed">${screen.description}</p>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="rounded-2xl border ${card} p-5 space-y-2 shadow-sm">
          <div class="text-xs font-semibold text-emerald-500 uppercase">Recommended</div>
          <div class="font-bold text-lg">Streamlined Path</div>
          <p class="text-sm ${muted}">Clear visual hierarchy with immediate reassurance and zero dead-end steps.</p>
        </div>
        <div class="rounded-2xl border ${card} p-5 space-y-2 shadow-sm">
          <div class="text-xs font-semibold ${muted} uppercase">Flexible Control</div>
          <div class="font-bold text-lg">Custom Preferences</div>
          <p class="text-sm ${muted}">Inline toggles carry forward seamlessly into the next connected screen.</p>
        </div>
      </div>
      <button ${edgeAttr} class="px-8 py-4 rounded-2xl ${cta} font-bold text-base shadow-lg transition">
        Continue to Next Step →
      </button>
    </div>
    <aside class="col-span-5 rounded-3xl border ${card} p-7 space-y-4 shadow-lg">
      <div class="text-xs uppercase tracking-wider font-semibold ${muted}">Live Context Summary</div>
      <div class="h-36 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-violet-500/20 to-amber-500/20 border ${isDark ? 'border-zinc-800' : 'border-stone-200'} p-5 flex flex-col justify-end">
        <div class="font-bold text-lg">Ready in 1 click</div>
        <div class="text-xs ${muted}">Synced with Final Flow continuity contract</div>
      </div>
    </aside>
  </main>
</div>`;
}
