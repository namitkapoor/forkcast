import { GoogleGenAI } from '@google/genai';
import type {
  AnnotationCategory,
  DisambiguationRequest,
  EvaluationReport,
  FlowEdge,
  FlowProject,
  PriorityTier,
  RuntimeSettings,
  ScreenAnnotation,
  ScreenNode,
  TokenUsageEntry,
} from '../types/studio';
import type { AssembledPromptContext } from './contextBuilder';
import { resolveExecutionPolicy } from './budgetPolicy';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
}

export interface GenResult<T> {
  data: T;
  usage: TokenUsageEntry;
  usedMock: boolean;
}

function shouldUseLiveGemini(settings: RuntimeSettings): boolean {
  return Boolean(settings.apiKey.trim()) && !settings.useMockFallback;
}

function extractBase64FromDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function callGeminiJson<T>(
  settings: RuntimeSettings,
  model: string,
  systemPrompt: string,
  userText: string,
  images: Array<{ dataUrl: string }> = [],
  thinkingBudget = 0
): Promise<{ parsed: T; promptTokens: number; outputTokens: number; thoughtTokens: number }> {
  const ai = new GoogleGenAI({ apiKey: settings.apiKey.trim() });

  const parts: Array<Record<string, unknown>> = [{ text: userText }];
  for (const img of images) {
    const parsedImg = extractBase64FromDataUrl(img.dataUrl);
    if (parsedImg) {
      parts.push({
        inlineData: {
          mimeType: parsedImg.mimeType,
          data: parsedImg.data,
        },
      });
    }
  }

  const config: Record<string, unknown> = {
    systemInstruction: systemPrompt,
    responseMimeType: 'application/json',
  };

  if (thinkingBudget > 0 && !model.includes('lite')) {
    config.thinkingConfig = { thinkingBudget };
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config,
  });

  const rawText = response.text ?? '{}';
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as T;
  const meta = response.usageMetadata as
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      }
    | undefined;

  return {
    parsed,
    promptTokens: meta?.promptTokenCount ?? 800,
    outputTokens: meta?.candidatesTokenCount ?? 1200,
    thoughtTokens: meta?.thoughtsTokenCount ?? 0,
  };
}

function makeUsage(
  action: TokenUsageEntry['action'],
  priority: PriorityTier,
  model: string,
  promptTokens: number,
  outputTokens: number,
  thoughtTokens: number,
  screenId?: string
): TokenUsageEntry {
  return {
    id: uid('tok'),
    timestamp: Date.now(),
    action,
    screenId,
    priority,
    model,
    promptTokens,
    outputTokens,
    thoughtTokens,
    totalTokens: promptTokens + outputTokens + thoughtTokens,
  };
}

// ---------------------------------------------------------------------------
// 1. Intent & Ambiguity Engine (Multimodal Disambiguation)
// ---------------------------------------------------------------------------
export async function assessPromptAmbiguity(
  prompt: string,
  project: FlowProject,
  settings: RuntimeSettings
): Promise<GenResult<{ ambiguous: boolean; request: DisambiguationRequest | null }>> {
  const policy = resolveExecutionPolicy(project, settings, null, 'disambiguate');
  const hasExplicitMention = /@[A-Za-z0-9_-]+/.test(prompt);
  const isShortOpenFlowPrompt =
    !hasExplicitMention &&
    /(design|create|build|new flow|journey|app|onboarding|checkout|dashboard|portal|store)/i.test(
      prompt
    ) &&
    prompt.trim().split(/\s+/).length < 22;

  if (shouldUseLiveGemini(settings)) {
    try {
      const systemPrompt = `You are the Intent & Ambiguity Engine for Forkcast Studio.
Decide if a designer's prompt is underspecified (new flow or broad redesign without specific @Screen targets) or clear enough for direct execution.
Return strict JSON:
{
  "uncertaintyScore": 0.0-1.0,
  "rationale": "short 1-line explanation of why clarifying saves tokens",
  "estimatedTokenSavings": 12000,
  "controls": [
    { "id": "c1", "kind": "choice-cards", "label": "...", "multiSelect": false, "options": [{ "id": "o1", "title": "...", "subtitle": "...", "badge": "Fast" }], "selectedIds": ["o1"] },
    { "id": "c2", "kind": "visual-preview", "label": "Visual Direction", "options": [{ "id": "v1", "title": "...", "palette": ["#111827","#F59E0B","#FAF8F5"], "layoutHint": "Editorial Split" }], "selectedId": "v1" },
    { "id": "c3", "kind": "slider", "label": "Information Density", "min": 1, "max": 5, "step": 1, "unit": "/5", "value": 3, "minLabel": "Minimal", "maxLabel": "Data-Rich" }
  ]
}
If prompt mentions @Screen or @Pin or is a localized edit, set uncertaintyScore <= 0.2 and controls: [].`;

      const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
        uncertaintyScore: number;
        rationale: string;
        estimatedTokenSavings?: number;
        controls: DisambiguationRequest['controls'];
      }>(
        settings,
        policy.model,
        systemPrompt,
        `Project: ${project.name}. Existing screens: ${Object.values(project.screens)
          .map((s) => '@' + s.slug)
          .join(', ')}.\nDesigner prompt: "${prompt}"`
      );

      const ambiguous = parsed.uncertaintyScore >= 0.45 && (parsed.controls?.length ?? 0) > 0;
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
        usage: makeUsage('disambiguate', 'supporting', policy.model, promptTokens, outputTokens, thoughtTokens),
        usedMock: false,
      };
    } catch {
      // Fall through cleanly to mock
    }
  }

  // Deterministic smart mock
  await new Promise((r) => setTimeout(r, 320));
  if (!isShortOpenFlowPrompt) {
    return {
      data: { ambiguous: false, request: null },
      usage: makeUsage('disambiguate', 'supporting', policy.model, 240, 120, 0),
      usedMock: true,
    };
  }

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
                layoutHint: 'Airy cards & crisp serif/sans hierarchy',
              },
              {
                id: 'linear-dark',
                title: 'Precision Dark',
                palette: ['#09090B', '#6366F1', '#10B981'],
                layoutHint: 'High-contrast studio SaaS controls',
              },
              {
                id: 'clinical-clean',
                title: 'Clean Utility',
                palette: ['#FFFFFF', '#0F172A', '#2563EB'],
                layoutHint: 'High-clarity enterprise tables & forms',
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
          {
            id: 'focus-areas',
            kind: 'chips',
            label: 'Core Token Focus (65% Budget)',
            options: ['Onboarding', 'Comparison / Pricing', 'Express Checkout', 'Error Recovery'],
            selected: ['Comparison / Pricing', 'Express Checkout'],
          },
        ],
      },
    },
    usage: makeUsage('disambiguate', 'supporting', policy.model, 310, 290, 0),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 2. Refine Existing Screen(s) with Point & Paint + @Mentions (Strict Opt-In)
// ---------------------------------------------------------------------------
export interface RefinementOutput {
  targetScreenId: string;
  newVariantLabel: string;
  rationale: string;
  html: string;
  resolvedAnnotationIds: string[];
  addedScreen?: {
    slug: string;
    title: string;
    stage: string;
    description: string;
    edgeLabel: string;
    html: string;
  };
}

export async function refineScreenWithAI(
  context: AssembledPromptContext,
  project: FlowProject,
  settings: RuntimeSettings
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
    try {
      const systemPrompt = `You are a Principal Product Designer AI inside Forkcast Studio.
Refine the target web screen HTML using Tailwind CSS classes based on the designer's directive, opted-in Point/Paint annotations, and connected flow neighbors.
Preserve data-fc-edge="..." attributes on primary navigation buttons so interactive flow testing stays wired.
Return strict JSON:
{
  "newVariantLabel": "Option — concise 3-4 word title",
  "rationale": "1 crisp sentence explaining what changed",
  "html": "<div class=\\"min-h-screen ...\\">...complete Tailwind HTML body...</div>",
  "resolvedAnnotationIds": ["id1", "id2"]
}`;

      const includedAnnText = context.includedAnnotations
        .map(
          (a) =>
            `- [${a.id}] @${a.mentionTag} (${a.kind}, ${a.category}): "${a.comment}"` +
            (a.elementTarget
              ? ` | Target element: <${a.elementTarget.tagName}> "${a.elementTarget.textSnippet}" (${a.elementTarget.selector})`
              : '') +
            (a.paintTarget
              ? ` | Painted region box: x=${a.paintTarget.boundingBoxPercent.x}%, y=${a.paintTarget.boundingBoxPercent.y}%, w=${a.paintTarget.boundingBoxPercent.w}%, h=${a.paintTarget.boundingBoxPercent.h}%; intersecting: ${a.paintTarget.intersectingSelectors.join(', ')}`
              : '')
        )
        .join('\n');

      const userPayload = `Designer Directive: ${context.prompt}
Device Preset: ${project.devicePreset} (${project.devicePreset === 'desktop' ? '1280x800' : '390x844'})
Target Screen: @${targetScreen.slug} (${targetScreen.title})
Flow Topology:\n${context.topologySummary}
Connected Neighbors:\n${context.neighborSummaries.join('\n') || 'None'}
Opted-In Annotations to Address:\n${includedAnnText || 'None — follow directive directly'}
Current HTML:\n${currentVariant?.html ?? '<div>Empty</div>'}`;

      const { parsed, promptTokens, outputTokens, thoughtTokens } =
        await callGeminiJson<Omit<RefinementOutput, 'targetScreenId'>>(
          settings,
          policy.model,
          systemPrompt,
          userPayload,
          context.maskImages.map((m) => ({ dataUrl: m.dataUrl })),
          policy.thinkingBudget
        );

      return {
        data: {
          targetScreenId: targetScreen.id,
          newVariantLabel: parsed.newVariantLabel || 'AI Refined Option',
          rationale: parsed.rationale || 'Applied targeted designer feedback.',
          html: parsed.html || currentVariant.html,
          resolvedAnnotationIds:
            parsed.resolvedAnnotationIds?.length > 0
              ? parsed.resolvedAnnotationIds
              : context.includedAnnotations.map((a) => a.id),
        },
        usage: makeUsage(
          'point-paint-refine',
          policy.tier,
          policy.model,
          promptTokens,
          outputTokens,
          thoughtTokens,
          targetScreen.id
        ),
        usedMock: false,
      };
    } catch {
      // Fallback gracefully to deterministic visual refinement
    }
  }

  // Smart Demo/Mock Visual Refinement Engine
  await new Promise((r) => setTimeout(r, 850));
  const promptLower = context.prompt.toLowerCase();
  const includedText = context.includedAnnotations.map((a) => a.comment).join(' ').toLowerCase();
  const combinedIntent = `${promptLower} ${includedText}`;

  let refinedHtml = currentVariant?.html || '';
  let label = `Refined v${targetScreen.variants.length + 1}`;
  let rationale = `Addressed "${context.prompt.slice(0, 68)}"${
    context.includedAnnotations.length > 0
      ? ` + ${context.includedAnnotations.length} opted-in annotation(s)`
      : ''
  }.`;

  if (!refinedHtml.trim()) {
    // Expanding skeleton into interactive HTML
    refinedHtml = buildRichMockScreenHtml(targetScreen, combinedIntent);
    label = 'Option A — Expanded Live UI';
    rationale = 'Progressively expanded skeleton into interactive Tailwind screen.';
  } else if (
    combinedIntent.includes('emerald') ||
    combinedIntent.includes('green') ||
    combinedIntent.includes('reassurance') ||
    combinedIntent.includes('cancel') ||
    targetScreen.id === 'checkout'
  ) {
    label = `Option ${String.fromCharCode(65 + targetScreen.variants.length)} — Emerald Trust CTA`;
    rationale =
      'Promoted primary Subscribe CTA to high-contrast emerald with inline 1-click cancel reassurance and compact sticky summary.';
    refinedHtml = refinedHtml
      .replace(
        /bg-stone-950 text-white font-bold text-base shadow-lg hover:bg-stone-800/g,
        'bg-emerald-600 text-white font-bold text-base shadow-xl shadow-emerald-600/25 hover:bg-emerald-500 ring-2 ring-emerald-400/40'
      )
      .replace(
        /Start Subscription · \$31\.00/g,
        '🔒 Start Subscription · $31.00 — Cancel in 1 Click'
      );
    if (!refinedHtml.includes('100% Fresh Roast Guarantee')) {
      refinedHtml = refinedHtml.replace(
        '</section>',
        `<div class="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
          <span>✓ 100% Fresh Roast Guarantee · Skip or cancel anytime in 1 click</span>
          <span class="font-bold">0 lock-in</span>
        </div></section>`
      );
    }
  } else if (combinedIntent.includes('dark') || combinedIntent.includes('contrast')) {
    label = `Option ${String.fromCharCode(65 + targetScreen.variants.length)} — Precision Dark`;
    rationale = 'Transformed surface into high-contrast dark studio palette with crisp accents.';
    refinedHtml = refinedHtml
      .replace(/bg-\[#FAF8F5\]/g, 'bg-zinc-950')
      .replace(/bg-white/g, 'bg-zinc-900')
      .replace(/text-stone-900/g, 'text-zinc-100')
      .replace(/text-stone-950/g, 'text-white')
      .replace(/border-stone-200/g, 'border-zinc-800');
  } else {
    label = `Option ${String.fromCharCode(65 + targetScreen.variants.length)} — Streamlined Focus`;
    rationale = `Synthesized cleaner visual hierarchy directly addressing ${
      context.includedAnnotations.length > 0
        ? context.includedAnnotations.map((a) => '@' + a.mentionTag).join(', ')
        : 'prompt intent'
    }.`;
    refinedHtml = refinedHtml.replace(
      '<main',
      `<div class="bg-violet-600 text-white text-xs font-medium px-12 py-2 flex items-center justify-between">
        <span>✨ AI Refined Variant · ${context.prompt.slice(0, 72)}</span>
        <span class="opacity-80">Forkcast Studio</span>
      </div><main`
    );
  }

  return {
    data: {
      targetScreenId: targetScreen.id,
      newVariantLabel: label,
      rationale,
      html: refinedHtml,
      resolvedAnnotationIds: context.includedAnnotations.map((a) => a.id),
    },
    usage: makeUsage(
      'point-paint-refine',
      policy.tier,
      policy.model,
      Math.round(policy.estimatedTokens * 0.42),
      Math.round(policy.estimatedTokens * 0.44),
      policy.thinkingBudget > 0 ? Math.round(policy.estimatedTokens * 0.14) : 0,
      targetScreen.id
    ),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 3. Explore a New Divergent Alternative for a Screen
// ---------------------------------------------------------------------------
export async function generateVariantForScreen(
  screen: ScreenNode,
  project: FlowProject,
  settings: RuntimeSettings,
  styleHint = 'Explore a distinct layout direction that reduces cognitive load and improves conversion clarity.'
): Promise<GenResult<{ label: string; rationale: string; html: string }>> {
  const policy = resolveExecutionPolicy(project, settings, screen, 'generate-variant');

  if (shouldUseLiveGemini(settings)) {
    try {
      const systemPrompt = `You are an expert UI designer inside Forkcast Studio.
Create ONE genuinely distinct, production-polished Tailwind CSS web screen variant for the given screen node.
Return strict JSON: { "label": "Option X — 3-word style", "rationale": "1 sentence UX reasoning", "html": "<div class=\\"min-h-screen ...\\">...</div>" }`;

      const outEdges = Object.values(project.edges)
        .filter((e) => e.sourceScreenId === screen.id)
        .map((e) => `data-fc-edge="${e.id}" for "${e.label}"`)
        .join(', ');

      const userPayload = `Screen: @${screen.slug} — ${screen.title} (${screen.stage})
Description: ${screen.description}
Device: ${project.devicePreset}
Existing option labels (make something clearly different): ${screen.variants.map((v) => v.label).join(', ')}
Wire primary CTA buttons with: ${outEdges || 'standard buttons'}
Creative direction: ${styleHint}`;

      const { parsed, promptTokens, outputTokens, thoughtTokens } = await callGeminiJson<{
        label: string;
        rationale: string;
        html: string;
      }>(settings, policy.model, systemPrompt, userPayload, [], policy.thinkingBudget);

      return {
        data: parsed,
        usage: makeUsage(
          'generate-variant',
          policy.tier,
          policy.model,
          promptTokens,
          outputTokens,
          thoughtTokens,
          screen.id
        ),
        usedMock: false,
      };
    } catch {
      // Fallback cleanly to rich mock
    }
  }

  await new Promise((r) => setTimeout(r, 750));
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
      policy.tier,
      policy.model,
      Math.round(policy.estimatedTokens * 0.35),
      Math.round(policy.estimatedTokens * 0.5),
      policy.thinkingBudget > 0 ? Math.round(policy.estimatedTokens * 0.15) : 0,
      screen.id
    ),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 4. Generate a Brand-New User Flow from Prompt + Disambiguation Answers
// ---------------------------------------------------------------------------
export async function generateNewFlowFromDisambiguation(
  prompt: string,
  answersSummary: string,
  project: FlowProject,
  settings: RuntimeSettings
): Promise<
  GenResult<{
    projectName: string;
    screens: Record<string, ScreenNode>;
    edges: Record<string, FlowEdge>;
  }>
> {
  const policy = resolveExecutionPolicy(project, settings, null, 'generate-flow');

  if (shouldUseLiveGemini(settings)) {
    try {
      const systemPrompt = `You are a Principal UX Architect inside Forkcast Studio.
Generate a progressive-reveal 4-to-5 screen user flow graph for the product prompt and disambiguation choices.
Core UX screens get full interactive Tailwind HTML; Supporting screens get skeletonBullets only (Progressive Reveal).
Return strict JSON:
{
  "projectName": "Short Studio Project Title",
  "screens": [
    {
      "id": "s1",
      "slug": "Landing",
      "title": "...",
      "stage": "Entry",
      "description": "...",
      "priority": "core" | "standard" | "supporting",
      "isInFinalFlow": true,
      "fidelity": "interactive" | "skeleton",
      "variantLabel": "Option A — ...",
      "rationale": "...",
      "html": "<div class=\\"min-h-screen ...\\">...</div>",
      "skeletonBullets": ["...", "..."]
    }
  ],
  "edges": [
    { "id": "e1", "sourceScreenId": "s1", "targetScreenId": "s2", "label": "Continue", "edgeType": "primary", "isFinalFlowEdge": true }
  ]
}`;

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
      }>(
        settings,
        policy.model,
        systemPrompt,
        `Prompt: ${prompt}\nDisambiguation Choices:\n${answersSummary}\nViewport: ${project.devicePreset}`
      );

      const screens: Record<string, ScreenNode> = {};
      const now = Date.now();
      parsed.screens.forEach((s, idx) => {
        const varId = uid('var');
        screens[s.id] = {
          id: s.id,
          slug: s.slug.replace(/[^A-Za-z0-9_-]/g, '') || `Screen${idx + 1}`,
          title: s.title,
          stage: s.stage,
          description: s.description,
          priority: s.priority,
          policyMode: 'explore',
          fidelity: s.fidelity,
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
              fidelity: s.fidelity,
              isHidden: false,
              html: s.html || '',
              skeletonBullets: s.skeletonBullets,
              createdAt: now,
              modelUsed: policy.model,
              tokensUsed: Math.round((promptTokens + outputTokens) / Math.max(1, parsed.screens.length)),
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
          metrics: { traversals: 0, completions: 0, backtracks: 0 },
        };
      });

      return {
        data: { projectName: parsed.projectName || 'Generated Studio Flow', screens, edges },
        usage: makeUsage('generate-flow', 'core', policy.model, promptTokens, outputTokens, thoughtTokens),
        usedMock: false,
      };
    } catch {
      // Fallback to crisp mock flow
    }
  }

  // Deterministic Mock Progressive Flow Generator
  await new Promise((r) => setTimeout(r, 900));
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
        modelUsed: settings.models.standard,
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
    description: `High-impact interactive workspace / selection step for ${prompt}`,
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
          'e-core-commit'
        ),
        createdAt: now,
        modelUsed: settings.models.core,
        tokensUsed: 4100,
        banditStats: { alpha: 3, beta: 2, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
      {
        id: 'gen-core-b',
        label: 'Option B — Split Live Preview',
        rationale: 'Alternative side-by-side live summary layout for comparison.',
        fidelity: 'interactive',
        isHidden: false,
        html: buildRichMockScreenHtml(
          { title: 'Live Split Builder', slug: 'CoreAction', stage: 'Core UX Focus', description: prompt } as ScreenNode,
          'dark contrast',
          'e-core-commit'
        ),
        createdAt: now,
        modelUsed: settings.models.core,
        tokensUsed: 3800,
        banditStats: { alpha: 2.5, beta: 2, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
    ],
  };

  const s3: ScreenNode = {
    id: 'gen-commit',
    slug: 'Commit',
    title: 'Review & Express Confirm',
    stage: 'Conversion',
    description: 'High-trust summary and 1-click commitment step.',
    priority: 'core',
    policyMode: 'explore',
    fidelity: 'interactive',
    isInFinalFlow: true,
    position: { x: 1100, y: 110 },
    activeVariantId: 'gen-commit-a',
    finalizedVariantId: 'gen-commit-a',
    annotations: [],
    evaluation: null,
    status: 'idle',
    variants: [
      {
        id: 'gen-commit-a',
        label: 'Option A — Trust Summary',
        rationale: 'Transparent summary with zero-surprise reassurance.',
        fidelity: 'interactive',
        isHidden: false,
        html: buildRichMockScreenHtml(
          { title: 'Review & Confirm', slug: 'Commit', stage: 'Conversion', description: prompt } as ScreenNode,
          answersSummary,
          'e-commit-done'
        ),
        createdAt: now,
        modelUsed: settings.models.core,
        tokensUsed: 3900,
        banditStats: { alpha: 2.8, beta: 2.1, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
    ],
  };

  const s4: ScreenNode = {
    id: 'gen-done',
    slug: 'Success',
    title: 'Confirmation & Next Steps',
    stage: 'Post-Action',
    description: 'Kept as progressive skeleton to conserve Core Focus token spend.',
    priority: 'supporting',
    policyMode: 'explore',
    fidelity: 'skeleton',
    isInFinalFlow: true,
    position: { x: 1620, y: 110 },
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
        modelUsed: settings.models.supporting,
        tokensUsed: 620,
        banditStats: { alpha: 4, beta: 1, impressions: 0, completions: 0, hesitations: 0, backtracks: 0, avgDwellMs: 0 },
      },
    ],
  };

  const edges: Record<string, FlowEdge> = {
    'e-entry-core': {
      id: 'e-entry-core',
      sourceScreenId: 'gen-entry',
      targetScreenId: 'gen-core',
      label: 'Get Started',
      edgeType: 'primary',
      isFinalFlowEdge: true,
      metrics: { traversals: 0, completions: 0, backtracks: 0 },
    },
    'e-core-commit': {
      id: 'e-core-commit',
      sourceScreenId: 'gen-core',
      targetScreenId: 'gen-commit',
      label: 'Continue to Review',
      edgeType: 'primary',
      isFinalFlowEdge: true,
      metrics: { traversals: 0, completions: 0, backtracks: 0 },
    },
    'e-commit-done': {
      id: 'e-commit-done',
      sourceScreenId: 'gen-commit',
      targetScreenId: 'gen-done',
      label: 'Confirm & Complete',
      edgeType: 'primary',
      isFinalFlowEdge: true,
      metrics: { traversals: 0, completions: 0, backtracks: 0 },
    },
  };

  return {
    data: {
      projectName: cleanTitle,
      screens: { [s1.id]: s1, [s2.id]: s2, [s3.id]: s3, [s4.id]: s4 },
      edges,
    },
    usage: makeUsage('generate-flow', 'core', settings.models.core, 1950, 4200, 850),
    usedMock: true,
  };
}

// ---------------------------------------------------------------------------
// 5. Multimodal UX Evaluator (Screen Craft + Cross-Screen Continuity Pins)
// ---------------------------------------------------------------------------
export async function evaluateScreenWithAI(
  screen: ScreenNode,
  project: FlowProject,
  settings: RuntimeSettings
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
    try {
      const systemPrompt = `You are a Staff UX Researcher & Design Critic inside Forkcast Studio.
Evaluate the screen HTML for usability, visualHierarchy, accessibility, and flowContinuity across connected edges.
Return strict JSON:
{
  "overallScore": 0-100,
  "dimensions": { "usability": 0-100, "visualHierarchy": 0-100, "accessibility": 0-100, "flowContinuity": 0-100 },
  "summary": "2 crisp actionable sentences",
  "pins": [
    {
      "xPercent": 15-85,
      "yPercent": 15-85,
      "category": "usability" | "hierarchy" | "copy" | "accessibility" | "layout" | "flow",
      "severity": "info" | "warning" | "critical",
      "selector": "css selector or button description",
      "tagName": "button",
      "textSnippet": "short element label",
      "comment": "concise specific UX fix"
    }
  ]
}`;

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
      }>(settings, policy.model, systemPrompt, userPayload, [], policy.thinkingBudget);

      return {
        data: {
          report: {
            overallScore: parsed.overallScore,
            dimensions: parsed.dimensions,
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
            xPercent: Math.min(90, Math.max(10, p.xPercent)),
            yPercent: Math.min(90, Math.max(10, p.yPercent)),
            elementTarget: {
              selector: p.selector || 'main button',
              tagName: p.tagName || 'button',
              textSnippet: p.textSnippet || 'Target UI element',
              boundingBox: { x: 100, y: 100, w: 200, h: 48 },
            },
            category: p.category || 'usability',
            severity: p.severity || 'warning',
            comment: p.comment,
            status: 'open' as const,
          })),
        },
        usage: makeUsage(
          'ux-eval',
          policy.tier,
          policy.model,
          promptTokens,
          outputTokens,
          thoughtTokens,
          screen.id
        ),
        usedMock: false,
      };
    } catch {
      // Fall back cleanly
    }
  }

  await new Promise((r) => setTimeout(r, 650));
  const hasTrustUpgrade = active?.html.includes('100% Fresh Roast Guarantee') || active?.html.includes('bg-emerald-600');
  const baseScore = hasTrustUpgrade ? 91 : screen.id === 'checkout' ? 75 : 85;
  const totalTok = policy.estimatedTokens;

  return {
    data: {
      report: {
        overallScore: baseScore,
        dimensions: {
          usability: Math.min(98, baseScore + 3),
          visualHierarchy: Math.min(96, baseScore + 1),
          accessibility: Math.min(95, baseScore - 1),
          flowContinuity: Math.min(96, hasTrustUpgrade ? 92 : baseScore - 3),
        },
        summary: hasTrustUpgrade
          ? 'Strong visual hierarchy and clear reassurance directly adjacent to the commitment CTA. Continuity with upstream plan selection is seamless.'
          : `Good structural clarity on @${screen.slug}, but primary action contrast and carry-over context from connected upstream screen can be tightened.`,
        modelUsed: policy.model,
        tokensUsed: totalTok,
        evaluatedAt: Date.now(),
      },
      aiPins: hasTrustUpgrade
        ? []
        : [
            {
              screenId: screen.id,
              variantId: active?.id ?? '',
              author: 'ai-evaluator',
              kind: 'point-element',
              includeInAiFeedback: true,
              xPercent: 62,
              yPercent: 28,
              elementTarget: {
                selector: 'main h1, main h2',
                tagName: 'h2',
                textSnippet: screen.title,
                boundingBox: { x: 120, y: 140, w: 320, h: 40 },
              },
              category: 'flow',
              severity: screen.id === 'checkout' ? 'critical' : 'warning',
              comment: `Continuity check: reinforce the user's prior choice from upstream screen directly in the @${screen.slug} header to reduce backtracking.`,
              status: 'open',
            },
          ],
    },
    usage: makeUsage(
      'ux-eval',
      policy.tier,
      policy.model,
      Math.round(totalTok * 0.55),
      Math.round(totalTok * 0.35),
      policy.thinkingBudget > 0 ? Math.round(totalTok * 0.1) : 0,
      screen.id
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
      <div class="space-y-2 text-sm ${muted}">
        <div class="flex justify-between"><span>Clarity Score</span><span class="font-semibold text-emerald-500">94%</span></div>
        <div class="flex justify-between"><span>Estimated Time</span><span class="font-semibold">~18 sec</span></div>
      </div>
    </aside>
  </main>
</div>`;
}
