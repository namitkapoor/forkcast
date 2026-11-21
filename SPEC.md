# Forkcast Studio — Product & Technical Specification (`SPEC.md`)

**Version:** 1.0 (Locked MVP Spec)  
**Branch / Worktree:** `designer-studio`  
**Event:** Gemini 4 NYC Hackathon  
**Related Docs:** [README.md](./README.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ONE_PAGER.pdf](./ONE_PAGER.pdf)

---

## 1. Executive Summary & Core Thesis

**Forkcast Studio** is a pure client-side, GenAI-native **UI Generator & UX Evaluator Studio for Designers** built on a Figma-like infinite spatial canvas. It replaces chat walls and blind one-shot screen generation with a closed human-AI design & evaluation loop:

1. **Disambiguate Before Generating & Progressive Reveal**: Detect underspecified goals first and ask with minimum-effort visual controls (choice cards, palette/layout swatches, sliders, chips) instead of prose walls; generate a lightweight **Journey Skeleton** first and expand fidelity progressively.
2. **Spatial Multi-Option Screen Graph**: Organize user journeys as an interactive graph/tree of screens where clicking any screen reveals its **Proposed Alternatives**, a clearly marked **Finalized Version**, per-option **Show/Hide** toggles to manage designer cognitive load, and immediate **Final Flow Highlighting** across committed nodes and edges.
3. **Point & Paint + Voice Steering with Versioned Revisions**: Annotate any screen or option by pointing at exact DOM elements (`Point Mode C`), brush-painting over regions (`Paint Mode B`), or speaking short directives (*Paint & Speak*). All annotations persist as versioned **Revisions** with per-annotation **`Include in AI`** toggles, alongside draggable edge wiring and `@Screen` / `@Pin` / `@Mask` prompt references.
4. **Empirical Traversal "Unit Tests" & Self-Evolving Workflow Graphs**: Validate generated UIs through live manual walkthroughs (`Play Mode P`), 1-click **Simulated Personas**, and automated multimodal **UX Evaluation**. Implicit signals (completion, dwell hesitation, dead clicks, backtracking) and explicit critiques update per-variant **Thompson Sampling `Beta(α, β)`** posteriors, compiling exploration trees into a persistent **Workflow Graph**.
5. **UX Focus Zones & Exploit/Explore Token Spend Budgeting**: Concentrate GenAI token spend (stronger Gemini models, deeper thinking budgets, more divergent options, deeper evaluation) on **Core UX Focus** and high-uncertainty (`Explore`) branches while locking proven (`Exploit`) and supporting screens onto fast, economical tiers.

---

## 2. Design Principles

| Principle | What It Means in the UI |
|---|---|
| **Zero Wall-of-Text** | Never dump 500-word chat responses. Communicate intent via visual cards, swatches, sliders, pins, paint masks, and concise 1-line rationales. |
| **Designer Cognitive Load First** | Let the designer hide distracting screen alternatives with one click, progressively reveal fidelity only where needed, and keep the committed Final Flow visually unmistakable at all times. |
| **Spatial & Multimodal Over Prose** | Pointing at a `<button>`, painting over a pricing block, speaking 4 words, or referencing `@Checkout` replaces paragraphs of text prompting. |
| **Every UI Has an Empirical Test** | Traversal behavior (completion, hesitation, dead clicks, backtracking) + cross-screen continuity critique act as the live "unit test" for generative UI. |
| **Budget Follows UX Impact** | Token spend is a first-class design resource — visibly allocated to Core UX flows and uncertain branches, never burned evenly across trivial states. |

---

## 3. Locked MVP Decisions

| Area | Locked Specification |
|---|---|
| **Architecture & Auth** | Pure client-side **Vite + React 19 + TypeScript + Tailwind CSS v4 + `@xyflow/react` + `dagre` + Zustand + `@google/genai`**. Zero backend required; user enters Gemini API key in Studio Settings (`localStorage`). |
| **Artboards & Initial State** | **Desktop web frames (`1280×800`)** by default (cleanly scaled on the infinite canvas) with a one-click **Mobile (`390×844`)** toggle. Opens pre-loaded with a rich starter journey (e.g., SaaS / Specialty Coffee Web Subscription & Checkout) so every interaction works immediately before entering an API key. |
| **Multimodal Input & Disambiguation** | Interactive visual micro-UI controls (**choice cards, palette/layout swatches, sliders, scope chips**) **+ optional Mic / Voice input** (*Paint & Speak* via browser Web Speech API in the Paint popover and Prompt Composer). |
| **Per-Screen Controls & Revisions** | Clicking any screen displays **Proposed Alternatives** + a clearly badged **Finalized Version**, per-option **Show/Hide** buttons (`isHidden`), **Annotation Revisions** across all screens with per-annotation **`Include in AI`** toggles (`includeInAiFeedback`), and **Final Flow Highlighting** (borders & edges of the committed path highlighted clearly). |
| **Act 3 Traversal & Evolution** | **Both** interactive manual **Play Mode (`P`)** walkthroughs **and** a 1-click **"Simulate Personas"** button to rapidly generate behavioral traces, update `Beta(α, β)` posteriors, lock proven `Exploit` nodes, and evolve the Compiled Workflow Graph live. |
| **Model Config & Demo Resilience** | Live Gemini API with **configurable model IDs per tier** (`Flash-Lite` / `Flash` / `Pro`) in Settings **+ a built-in Demo/Mock fallback toggle** so demos run reliably even offline or under rate limits. |

---

## 4. Functional Requirements

### FR-1: Figma-Style Infinite Canvas & Layout Views
- **Canvas Controls**: Smooth 60fps pan & zoom via `@xyflow/react` (scroll/pinch zoom, `Space + Drag` pan, `Shift+1` Fit to Screen, `Shift+2` Zoom to Selection, Minimap toggle, grid snap toggle).
- **Artboard Viewport Toggle**: Switch project artboards between **Desktop (`1280×800`, default)** and **Mobile (`390×844`)**; desktop frames render at native `1280×800` inside a crisp CSS-transformed wrapper so layouts never collapse into mobile breakpoints when viewed side-by-side on the canvas.
- **4 View Modes**:
  1. **Free**: Manual Figma-style spatial arrangement.
  2. **Flow (`L→R`)**: Auto-laid-out left-to-right user journey (`dagre`).
  3. **Tree (`T→B`)**: Top-down branching hierarchy showing stages and decision splits.
  4. **Compiled Graph**: Consolidated workflow view showing edge traffic/backtrack heat, `Exploit-Locked` badges, `Explore` uncertainty rings, and Final Flow prominence.
- **Starter Preset**: First load populates a realistic 6-screen desktop journey with multiple alternatives, pre-selected Finalized options, sample Focus Zones, sample annotations with revisions, and initial traversal metrics.

### FR-2: Per-Screen Options, Finalized State, Visibility & Final Flow Highlighting
- **Clicking Any Screen / Micro-UI**:
  - **Final Flow Highlight**: Immediately highlights the **borders of all nodes** (`isInFinalFlow === true`) and **all connecting edges** (`isFinalFlowEdge === true`) belonging to the Final Flow using a crisp high-contrast emerald/cyan glow and animated directional styling, while softly dimming (`opacity: 0.35–0.45`) non-final exploratory branches and alternate paths. The Final Flow remains visually unambiguous regardless of which screen is selected.
  - **Alternatives & Finalized Drawer / Inspector**: Displays:
    1. The clearly badged **Finalized Version** (`finalizedVariantId`) pinned prominently with a checkmark/crown badge (`FINALIZED`).
    2. All **Proposed Alternatives** for that screen, each previewable live on the artboard with one click and promotable via a 1-click **"Mark as Finalized"** button.
    3. A **Show / Hide (`Eye` / `EyeOff`) toggle button** on every option (`isHidden: boolean`). Hidden options disappear from the canvas quick-tabs and comparison strip to reduce designer cognitive load and collapse into a compact **"Show N hidden"** pill to restore at any time. (The active Finalized version cannot be accidentally orphaned; hiding the currently previewed option switches preview cleanly to the Finalized or next visible option.)
    4. Option to **Include / Exclude screen from Final Flow** and toggle edges as Final Flow edges so designers have full manual override alongside Tree-to-Graph compilation.

### FR-3: Intent & Ambiguity Engine (Multimodal Disambiguation & Progressive Reveal)
- **Ambiguity Detection**: Submitting a new flow or major redesign prompt calls `ambiguityEngine.ts` (lightweight structured JSON schema) to score `uncertaintyScore` (`0..1`).
- **Disambiguation Micro-UI (`uncertaintyScore >= 0.45`)**:
  - Expands inline above the floating Prompt Composer — **never** as a chat wall.
  - Supports 4 low-effort control primitives:
    - `choice-cards` (2–3 concise architectural options with badges),
    - `visual-preview` (color palette swatches + layout thumbnail hints),
    - `slider` (e.g., Information Density: Minimal ↔ Data-Rich; Steps: 1-Page ↔ Guided Multi-Step),
    - `chips` (toggleable scope/feature tags).
  - Includes a **"Skip & Generate Now"** fast-path button and shows estimated token savings from clarifying first.
- **Progressive Reveal (`FidelityStage`)**:
  - Initial flow generation emits cheap **`skeleton`** nodes (title, stage, 3 key UI affordances, connected edges) across the journey.
  - Screens inside **Core UX Focus Zones** (or explicitly clicked/expanded by the designer) progressively upgrade to **`wireframe`** or full **`interactive`** multi-option HTML/Tailwind screens.

### FR-4: Point & Paint Manipulation, Voice Input, Annotation Revisions & AI Inclusion Toggle
- **Universal Annotation**: Designers can annotate **every screen and every option/variant** in the project.
- **Point Mode (`C`)**:
  - Hovering over a live screen iframe highlights exact DOM elements with a blue Figma-style bounding box + tag pill (`<button> "Start Free Trial"`).
  - Clicking captures `{ selector, tagName, textSnippet, boundingBox, xPercent, yPercent }` via `postMessage` and opens an inline comment popover tagged `@Pin-N`.
- **Paint Mode (`B`) + Paint & Speak (Mic)**:
  - Activates a transparent `<canvas>` drawing layer directly over the screen frame.
  - Designer brushes over any visual region and either types or clicks the **Mic button (Web Speech API)** to dictate a short directive (*"make this section a sticky 2-column summary"*).
  - Captures normalized stroke paths, bounding box, all intersecting DOM selectors from the iframe bridge, and a composite visual mask PNG (`maskDataUrl`) tagged `@Mask-N`.
- **Saved Annotation Revisions (`AnnotationRevision[]`)**:
  - Creating, editing, categorizing, or resolving any annotation appends an immutable revision entry (`v1`, `v2`, `v3`...) storing `timestamp`, `author` (`designer` | `ai-evaluator`), `comment`, `category`, `status`, and `resolvedByVariantId`.
  - Designers can inspect the full revision timeline for any pin/mask in the Right Inspector and restore prior wording without losing history.
- **Selective AI Feedback Inclusion (`includeInAiFeedback: boolean`)**:
  - Every annotation displays a prominent **`Include in AI`** toggle (and batch *"Include All / Exclude All"* controls per screen).
  - Annotations toggled **OFF** stay visible/saved on the canvas (subtle muted badge) for designer reference, history, or deferred ideas, and are **strictly excluded** from Gemini prompts by `contextBuilder.ts`.

### FR-5: Interactive Flow Wiring & `@Screen` / `@Pin` / `@Mask` Prompt Steering
- **Connect & Disconnect Screens**:
  - Drag from any screen handle to another screen to create a `FlowEdge`; click any edge to edit its transition label (`On Submit`, `Skip`, `Payment Failed`), edge type (`primary | alternate | error | back`), Final Flow membership, or disconnect/delete it.
- **Floating Prompt Composer with `@` Autocomplete & Voice**:
  - Typing `@` opens a crisp popup listing all screens (`@Checkout`, `@Cart`), opted-in pins (`@Pin-1`), painted masks (`@Mask-2`), and Focus Zones (`@CoreCheckout`).
  - Supports **Mic dictation** via Web Speech API right inside the composer.
  - Displays a live **pre-flight estimated token & model tier badge** before submission.
- **Graph-Aware Multimodal Context Builder (`contextBuilder.ts`)**:
  - Sends compact full-graph topology + full HTML & active/finalized variant for targeted/`@mentioned` screens + **only annotations where `includeInAiFeedback === true && status === 'open'`** + compact summaries of 1-hop upstream/downstream neighbors + `inlineData` PNGs for included `@Mask` regions.
  - Accepts structured JSON responses capable of creating refined variants, resolving specific annotation IDs (appending a resolved revision), and adding/updating/removing screens and edges.

### FR-6: Live Traversal "Unit Test" Mode (`Play Mode P`) & 1-Click Persona Simulation
- **Manual Play Mode (`P`)**:
  - Opens a focused interactive walkthrough runner (starting from the entry screen or currently selected screen) rendering the live clickable HTML of each screen.
  - Clicking interactive buttons/links mapped to outgoing `FlowEdge`s transitions to the next screen.
  - Records a `TraversalTrace` with per-step telemetry:
    - `dwellMs` (time spent on screen),
    - `deadClicks` (clicks on non-interactive elements),
    - `hesitated` (`dwellMs > threshold` or `deadClicks >= 2`),
    - `backtracked` (returning to the immediately preceding screen),
    - `completed` (reaching a terminal goal screen).
- **1-Click "Simulate Personas"**:
  - Runs 3–5 configurable synthetic personas (e.g., *Impatient Executive*, *Price-Sensitive First-Timer*, *Accessibility Keyboard User*) across the current graph (via live Gemini or deterministic Mock engine) to immediately populate realistic traversal traces, hesitation hotspots, dead-click clusters, and edge drop-offs during live demos.

### FR-7: Automated Multimodal UX Evaluator
- Runs on a **single screen**, a **Focus Zone**, or the **entire graph**.
- Evaluates 4 dimensions (`0–100`): **Usability**, **Visual Hierarchy**, **Accessibility**, and **Cross-Screen Flow Continuity** (verifying state/price/copy/navigation consistency across incoming & outgoing `FlowEdge`s).
- Emits structured `AI-Evaluator` annotations directly anchored to offending DOM elements (`author: 'ai-evaluator'`, `severity: 'info' | 'warning' | 'critical'`, defaulted to `includeInAiFeedback: true` so the designer can toggle which AI critiques to fix and click **"Resolve Selected with AI"**).

### FR-8: Tree-to-Graph Compilation & UX Focus / Exploit+Explore Token Budget Engine
- **UX Focus Zones**: Designers mark screens or group sub-flows into `core`, `standard`, or `supporting` priority tiers and adjust session token cap + tier budget sliders in the Left Sidebar.
- **Thompson Sampling (`Beta(α, β)`) Reward Model**:
  - Each `DesignVariant` tracks `alpha` (completions, UX eval `>= 80`, designer Finalize/approval) and `beta` (hesitations, dead clicks, backtracks, unresolved critical pins).
  - Expected quality = `α / (α + β)`; uncertainty = Beta variance.
- **Tree-to-Graph Compilation**:
  - In **Compiled Graph View**, `compiler.ts` folds branching variant trees into a clean workflow graph:
    - High-confidence winners (`impressions >= 3` & posterior mean `>= 0.75`) are recommended/promoted to **`exploit-locked`** and **Finalized**;
    - High-variance or high-friction nodes (high hesitation/backtracking or low continuity) are flagged as **`explore`** bottlenecks.
- **Token Budget Router (`budgetPolicy.ts`)**:
  - Allocates remaining session budget proportional to `PriorityWeight(core=3.0, standard=1.5, supporting=0.5) × ExplorationNeed`.
  - Default tier policies (editable in Settings):
    - **Core Focus — Explore (`~60–65%` budget)**: Configurable `Pro` tier + thinking budget, `3–4` variants, `interactive` fidelity, `deep` evaluation.
    - **Standard (`~25%` budget)**: Configurable `Flash` tier, `2` variants, `wireframe`/`interactive` fidelity, `standard` evaluation.
    - **Supporting / Exploit-Locked (`~10–15%` budget)**: Configurable `Flash-Lite` tier (`thinkingBudget: 0`), `1` variant (or skipped when `exploit-locked`), `skeleton` progressive reveal, `quick` evaluation.
  - Logs actual Gemini `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`) into `tokenLedger` with live top-bar and per-zone burn gauges.

---

## 5. UI & Visual Design Specification

### Workspace Chrome (Dark Figma Aesthetic)
- **Canvas Surface**: `#141416` with `#26262B` subtle dot grid; panels `#1B1B1F` with `1px solid #2C2C33` dividers; crisp typography (`Inter` UI + `JetBrains Mono` for metrics/tokens/`@mentions`).
- **Semantic Accents**:
  - **Final Flow Highlight**: `#10B981` (Emerald) glowing node border (`2px solid` + soft outer halo) + bright animated Final Flow edges; non-final branches softly dimmed (`opacity: 0.38`) when any screen is clicked.
  - **Core UX Focus Zone**: `#8B5CF6` (Violet) translucent group frame with live token share pill.
  - **Point Pin / Paint Mask**: `#3B82F6` (Figma Blue) for designer pins, `#F59E0B` (Amber) for AI UX critique pins, `#EC4899` (Rose) translucent brush mask; muted slate outline when `includeInAiFeedback === false`.
  - **Exploit-Locked**: Lock icon + emerald/teal pill; **Explore Bottleneck**: Pulsing amber/violet ring.

### Top Toolbar & Keyboard Shortcuts
- **View Switcher**: `Free` · `Flow` · `Tree` · `Compiled`
- **Viewport Switcher**: `Desktop (1280×800)` · `Mobile (390×844)`
- **Tools**: `Select (V)` · `Pan (H)` · `Point Pin (C)` · `Paint Region (B)` · `Connect (L)` · `Play / Test (P)`
- **Right Actions**: Live Token Budget Pill (`48k / 250k tok • 66% Core`), `Simulate Personas`, `Run UX Eval`, `Demo/Live Toggle`, `Settings (API Key)`.

### Per-Screen Node Anatomy (On Canvas)
1. **Header Bar**: Screen Title + `@Slug` badge + Priority badge (`Core / Std / Supp`) + `FINALIZED` / `Exploit-Locked` status + Final Flow indicator.
2. **Option Strip (Visible Variants Only)**: Tabs for visible alternatives (`★ Finalized: Opt A`, `Opt B`, `+ New`), each with a quick hover/inline **Eye (`Hide`)** toggle, plus a **"2 hidden"** reveal chip when options are hidden.
3. **Artboard Body**: Scaled `1280×800` (or `390×844`) sandboxed `<iframe>` (or lightweight Skeleton card in `skeleton` fidelity), overlaid with `AnnotationLayer` (Point pins & Paint strokes) and `PaintOverlay` (active in `Paint Mode B`).
4. **Footer Bar**: Active option UX score (`88/100`), `Beta` win-rate pill (`84% • 12 runs`), included-for-AI annotation count (`2/4 pins → AI`), and token spend on this screen.

### Right Inspector (When a Screen Is Selected)
- **Tab 1 — Options & Finalize**:
  - **Finalized Version Card** pinned at top (preview, rationale, `Beta(α, β)` bar, `Exploit-Locked` toggle).
  - **Proposed Alternatives List**: Preview, **"Mark as Finalized"**, **Show/Hide Eye button** (cognitive load control), Compare Side-by-Side modal button, and **"+ Explore New Alternative"** button.
  - **Hidden Alternatives Accordion**: Lists hidden options with 1-click **"Unhide"**.
- **Tab 2 — Annotations & Revisions**:
  - Scope toggle: **This Screen** vs. **All Screens in Flow**.
  - Each annotation card shows `@Pin-N` / `@Mask-N`, target element or mask thumbnail, latest comment, category/severity, an explicit **`Include in AI`** switch, **"Edit (Saves New Revision)"**, and an expandable **Revision History (`v1 → v2 → v3`)** timeline.
  - Primary CTA: **"Send Included Feedback to AI (`N` selected)"**.
- **Tab 3 — UX Eval & Traversal**:
  - 4-dimension UX scorecard, edge continuity checks, dwell/dead-click/backtrack breakdown, and 1-click **"Re-Evaluate"** / **"Promote to Core Focus"**.

---

## 6. Complete TypeScript Data Schema (`src/types/studio.ts`)

```ts
export type PriorityTier = 'core' | 'standard' | 'supporting';
export type PolicyMode = 'explore' | 'exploit-locked';
export type FidelityStage = 'skeleton' | 'wireframe' | 'interactive';
export type CanvasViewMode = 'free' | 'flow' | 'tree' | 'compiled';
export type StudioTool = 'select' | 'pan' | 'point' | 'paint' | 'connect' | 'play';
export type DevicePreset = 'desktop' | 'mobile'; // 'desktop' (1280x800) is default

export interface FlowProject {
  id: string;
  name: string;
  productBrief: string;
  devicePreset: DevicePreset;
  canvasView: CanvasViewMode;
  selectedScreenId: string | null;
  selectedEdgeId: string | null;
  budgetConfig: BudgetConfig;
  screens: Record<string, ScreenNode>;
  edges: Record<string, FlowEdge>;
  focusZones: Record<string, FocusZone>;
  traces: TraversalTrace[];
  tokenLedger: TokenUsageEntry[];
  pendingDisambiguation: DisambiguationRequest | null;
}

export interface DisambiguationRequest {
  id: string;
  originalPrompt: string;
  uncertaintyScore: number;        // 0..1; >= 0.45 displays micro-UI controls
  rationale: string;
  controls: DisambiguationControl[];
  createdAt: number;
}

export type DisambiguationControl =
  | {
      id: string;
      kind: 'choice-cards';
      label: string;
      multiSelect: boolean;
      options: Array<{ id: string; title: string; subtitle: string; badge?: string }>;
      selectedIds: string[];
    }
  | {
      id: string;
      kind: 'visual-preview';
      label: string;
      options: Array<{ id: string; title: string; palette: string[]; layoutHint: string }>;
      selectedId: string | null;
    }
  | {
      id: string;
      kind: 'slider';
      label: string;
      min: number;
      max: number;
      step: number;
      unit: string;
      value: number;
      minLabel: string;
      maxLabel: string;
    }
  | {
      id: string;
      kind: 'chips';
      label: string;
      options: string[];
      selected: string[];
    };

export interface ScreenNode {
  id: string;
  slug: string;                    // Referenced as @Slug
  title: string;
  stage: string;
  description: string;
  priority: PriorityTier;
  policyMode: PolicyMode;
  fidelity: FidelityStage;
  isInFinalFlow: boolean;          // Highlighted whenever any screen is clicked
  position: { x: number; y: number };
  variants: DesignVariant[];
  activeVariantId: string | null;     // Currently viewed alternative
  finalizedVariantId: string | null;  // Clearly badged committed Finalized version
  annotations: ScreenAnnotation[];
  evaluation: EvaluationReport | null;
  status: 'idle' | 'generating' | 'evaluating' | 'error';
}

export interface BanditStats {
  alpha: number;
  beta: number;
  impressions: number;
  completions: number;
  hesitations: number;
  backtracks: number;
  avgDwellMs: number;
}

export interface DesignVariant {
  id: string;
  label: string;
  rationale: string;
  fidelity: FidelityStage;
  isHidden: boolean;               // Show/Hide cognitive-load toggle
  html: string;
  skeletonBullets?: string[];
  createdAt: number;
  parentVariantId?: string;
  modelUsed: string;
  tokensUsed: number;
  banditStats: BanditStats;
}

export interface FlowEdge {
  id: string;
  sourceScreenId: string;
  targetScreenId: string;
  label: string;
  edgeType: 'primary' | 'alternate' | 'error' | 'back';
  isFinalFlowEdge: boolean;        // Highlighted clearly when any screen is clicked
  condition?: string;
  metrics: {
    traversals: number;
    completions: number;
    backtracks: number;
    continuityScore?: number;
  };
}

export interface AnnotationRevision {
  id: string;
  revisionNumber: number;          // v1, v2, v3...
  timestamp: number;
  author: 'designer' | 'ai-evaluator';
  comment: string;
  category: ScreenAnnotation['category'];
  status: 'open' | 'resolved';
  resolvedByVariantId?: string;
}

export interface ScreenAnnotation {
  id: string;
  mentionTag: string;              // e.g. "Pin-1" or "Mask-1"
  screenId: string;
  variantId: string;
  author: 'designer' | 'ai-evaluator';
  kind: 'point-element' | 'paint-region';
  includeInAiFeedback: boolean;    // Opt-in/out toggle for sending to AI
  xPercent: number;
  yPercent: number;
  elementTarget?: {
    selector: string;
    tagName: string;
    textSnippet: string;
    boundingBox: { x: number; y: number; w: number; h: number };
  };
  paintTarget?: {
    strokes: Array<Array<{ xPercent: number; yPercent: number }>>;
    boundingBoxPercent: { x: number; y: number; w: number; h: number };
    maskDataUrl?: string;
    intersectingSelectors: string[];
  };
  category: 'usability' | 'hierarchy' | 'copy' | 'accessibility' | 'layout' | 'flow';
  severity?: 'info' | 'warning' | 'critical';
  comment: string;                 // Mirrors latest revision
  status: 'open' | 'resolved';
  revisions: AnnotationRevision[]; // Immutable saved revision history
  createdAt: number;
}

export interface TraversalStep {
  screenId: string;
  variantId: string;
  edgeIdTaken?: string;
  enteredAt: number;
  dwellMs: number;
  deadClicks: number;
  hesitated: boolean;
  backtracked: boolean;
}

export interface TraversalTrace {
  id: string;
  actor: 'designer' | 'simulated-persona';
  personaLabel?: string;
  startedAt: number;
  completed: boolean;
  steps: TraversalStep[];
}

export interface EvaluationReport {
  overallScore: number;
  dimensions: {
    usability: number;
    visualHierarchy: number;
    accessibility: number;
    flowContinuity: number;
  };
  summary: string;
  modelUsed: string;
  tokensUsed: number;
  evaluatedAt: number;
}

export interface FocusZone {
  id: string;
  name: string;
  priority: PriorityTier;
  screenIds: string[];
  budgetWeight: number;
}

export interface TierPolicy {
  model: string;                   // Configurable in SettingsModal
  thinkingBudget: number;
  defaultVariantCount: number;
  initialFidelity: FidelityStage;
  evaluationDepth: 'deep' | 'standard' | 'quick';
}

export interface BudgetConfig {
  totalTokenBudget: number;
  tierShares: Record<PriorityTier, number>;
  tierPolicies: Record<PriorityTier, TierPolicy>;
}

export interface TokenUsageEntry {
  id: string;
  timestamp: number;
  action: 'disambiguate' | 'generate-flow' | 'generate-variant' | 'point-paint-refine' | 'ux-eval' | 'simulate-personas';
  screenId?: string;
  priority: PriorityTier;
  model: string;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface RuntimeSettings {
  apiKey: string;
  useMockFallback: boolean;        // Toggleable Demo/Mock engine for offline/rate-limit safety
  models: {
    core: string;                  // Default configurable Pro model ID
    standard: string;              // Default configurable Flash model ID
    supporting: string;            // Default configurable Flash-Lite model ID
  };
}
```

---

## 7. AI Contracts, Structured Outputs & Demo/Mock Fallback

Every AI call flows through `src/ai/geminiClient.ts` (`BudgetedGenAIClient`) with a uniform interface supporting both live `@google/genai` execution and deterministic **Demo/Mock Fallback** mode:

| Operation | Model Policy | Input Payload | Structured JSON Output |
|---|---|---|---|
| `assessAmbiguity(prompt)` | `supporting` (Fast) | Prompt + project brief + current screen slugs | `{ uncertaintyScore, rationale, controls[] }` |
| `generateFlowSkeleton(brief, answers)` | `standard` | Brief + disambiguation answers + device preset | `{ screens[], edges[], focusZones[] }` (progressive skeletons) |
| `generateScreenVariants(screen, count)` | Determined by `priority × explorationNeed` | Screen spec + 1-hop neighbor summaries + Final Flow visual theme | `{ variants: [{ label, rationale, html }] }` |
| `refineWithFeedback(prompt, context)` | Determined by target screen priority | Prompt + `@Screen` HTML + **only `includeInAiFeedback: true` annotations & revisions** + `@Mask` PNG `inlineData` | `{ updatedVariants[], resolvedAnnotationIds[], graphMutations? }` |
| `evaluateUX(targetScreens, edges)` | `deep` (Core) / `standard` / `quick` | Target HTML + incoming/outgoing edge labels & neighbor summaries | `{ report: EvaluationReport, aiPins[] }` |
| `simulatePersonas(graph, personas)` | `standard` or Mock | Graph topology + active/finalized variant summaries | `{ traces: TraversalTrace[] }` |

---

## 8. Non-Functional Requirements & Sandbox Isolation

- **Iframe Security**: All generated UI HTML executes inside `<iframe sandbox="allow-scripts">` using `srcdoc` (no parent DOM access; strict `postMessage` origin/envelope validation).
- **Canvas Performance**: Scaled `1280×800` desktop iframes disable pointer events while panning/zooming (`Select / Pan` mode) and re-enable pointer events cleanly in `Point (C)` or `Play (P)` modes so React Flow maintains smooth 60fps interactions.
- **Persistence**: Full `FlowProject` state (including every `AnnotationRevision`, `isHidden` flags, `finalizedVariantId`, `traces`, and `tokenLedger`) persists automatically to `localStorage` with a 1-click **"Reset to Starter Preset"** recovery button.
- **API Key Safety**: Gemini API key is stored strictly in browser `localStorage` and never committed to git or sent to any third-party proxy.

---

## 9. Phased Delivery Plan & Acceptance Checklist

### Phase 1 — Figma-Style Canvas, Desktop/Mobile Artboards & Per-Screen Controls
- [ ] Vite + React 19 + TypeScript + Tailwind v4 + `@xyflow/react` + `dagre` + Zustand scaffolded in `forkcast-designer-studio`.
- [ ] Pre-loaded Desktop (`1280×800`) starter journey with Mobile (`390×844`) toggle and `Free / Flow / Tree / Compiled` views.
- [ ] Clicking any screen highlights **Final Flow node borders & connecting edges** while dimming exploratory branches.
- [ ] Per-screen **Finalized Version** badge + 1-click *"Mark as Finalized"*, **Proposed Alternatives** switcher, and per-option **Show/Hide** eye toggle with *"N hidden"* restore pill.
- [ ] Drag-to-connect and click-to-edit/disconnect `FlowEdge`s.

### Phase 2 — Client-Side Gemini Engine, Multimodal Disambiguation & Progressive Reveal
- [ ] Settings modal with Gemini API key input, configurable model IDs per tier, session token cap, and **Demo/Mock Fallback** toggle.
- [ ] `ambiguityEngine.ts` rendering interactive choice cards, visual palette swatches, sliders, and chips inline above the Prompt Composer.
- [ ] Progressive flow generator (Skeleton → Wireframe → Interactive multi-option HTML) with live `usageMetadata` tracking in Top Toolbar & Left Sidebar.

### Phase 3 — Point & Paint Bridge, Voice Input, Annotation Revisions & `@Screen` Prompts
- [ ] `Point Mode (C)` DOM hover highlight & click-to-pin via iframe `postMessage` bridge.
- [ ] `Paint Mode (B)` `<canvas>` brush overlay + intersecting DOM extraction + composite mask PNG + **Mic / Voice input** (*Paint & Speak*).
- [ ] **Annotation Revisions** timeline (`v1, v2, ...`) persisted across all screens/options + per-annotation **`Include in AI`** toggle strictly enforced in `contextBuilder.ts`.
- [ ] Floating Prompt Composer with `@Screen` / `@Pin` / `@Mask` autocomplete and *"Send Included Feedback to AI"* loop.

### Phase 4 — Live Traversal "Unit Test" (`Play Mode P`), Persona Simulator & UX Evaluator
- [ ] Interactive **Play Mode (`P`)** recording `dwellMs`, `deadClicks`, `hesitated`, `backtracked`, and `completed` traces.
- [ ] 1-click **"Simulate Personas"** runner populating traces immediately for demos.
- [ ] Automated Multimodal UX Evaluator scoring 4 dimensions + dropping AI critique pins onto weak DOM elements.

### Phase 5 — Tree-to-Graph Compilation & Exploit/Explore Token Budget Studio
- [ ] `compiler.ts` updating `Beta(α, β)` posteriors from traversal + eval signals, locking proven `Exploit` nodes, and flagging `Explore` bottlenecks in **Compiled Graph View**.
- [ ] Focus Zone grouping frames + dynamic budget reallocation sliders demonstrating live token concentration on Core UX flows.
