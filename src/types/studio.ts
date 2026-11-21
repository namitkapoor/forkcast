export type PriorityTier = 'core' | 'standard' | 'supporting';
export type PolicyMode = 'explore' | 'exploit-locked';
export type FidelityStage = 'skeleton' | 'wireframe' | 'interactive';
export type CanvasViewMode = 'free' | 'flow' | 'tree' | 'compiled';
export type StudioTool = 'select' | 'pan' | 'point' | 'paint' | 'connect' | 'play';
export type DevicePreset = 'desktop' | 'mobile';

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
  uncertaintyScore: number;
  rationale: string;
  estimatedTokenSavings: number;
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
  slug: string;
  title: string;
  stage: string;
  description: string;
  priority: PriorityTier;
  policyMode: PolicyMode;
  fidelity: FidelityStage;
  isInFinalFlow: boolean;
  position: { x: number; y: number };
  variants: DesignVariant[];
  activeVariantId: string | null;
  finalizedVariantId: string | null;
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
  isHidden: boolean;
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
  isFinalFlowEdge: boolean;
  condition?: string;
  metrics: {
    traversals: number;
    completions: number;
    backtracks: number;
    continuityScore?: number;
  };
}

export type AnnotationCategory =
  | 'usability'
  | 'hierarchy'
  | 'copy'
  | 'accessibility'
  | 'layout'
  | 'flow';

export interface AnnotationRevision {
  id: string;
  revisionNumber: number;
  timestamp: number;
  author: 'designer' | 'ai-evaluator';
  comment: string;
  category: AnnotationCategory;
  status: 'open' | 'resolved';
  resolvedByVariantId?: string;
}

export interface ScreenAnnotation {
  id: string;
  mentionTag: string;
  screenId: string;
  variantId: string;
  author: 'designer' | 'ai-evaluator';
  kind: 'point-element' | 'paint-region';
  includeInAiFeedback: boolean;
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
  category: AnnotationCategory;
  severity?: 'info' | 'warning' | 'critical';
  comment: string;
  status: 'open' | 'resolved';
  revisions: AnnotationRevision[];
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
  model: string;
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
  action:
    | 'disambiguate'
    | 'generate-flow'
    | 'generate-variant'
    | 'point-paint-refine'
    | 'ux-eval'
    | 'simulate-personas';
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
  useMockFallback: boolean;
  models: {
    core: string;
    standard: string;
    supporting: string;
  };
}
