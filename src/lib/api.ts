import type { Context, NodeId, StateNode, Transition, TransitionKind } from "../graph/types";
import type { A2uiMessage, AnnotationKind, Screen } from "../a2ui/types";

// Client for the serverless routes in /api. The Gemini key never reaches the browser.
// Request/response shapes here are the contract; api/* implements them.

export interface TokenUsage {
  model: string;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH" | "XHIGH";
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface GenerateScreenRequest {
  nodeId: NodeId;
  /** The node's stage and label give the model the task step. */
  node: StateNode;
  context: Context;
  /** What the user just said or did that led here, if anything. */
  utterance?: string;
  /** Data that must carry over from the previous screen (selected product, price, quantity...). */
  carry?: Record<string, unknown>;
}

export interface BranchRequest {
  fromScreen: Screen;
  fromNode: StateNode;
  /** The "what if" the developer typed, e.g. "user asks for something cheaper". */
  utterance: string;
}

export interface BranchResponse {
  node: StateNode;
  transition: Transition;
  screen: Screen;
  usage?: TokenUsage;
}

export interface SimulateStepRequest {
  persona: string;
  goal: string;
  context: Context;
  screen: { nodeId: NodeId; messages: A2uiMessage[] };
  /** Options the graph allows from here. */
  options: { to: NodeId; kind: TransitionKind; label: string }[];
  history: string[];
}

export interface SimulateStepResponse {
  choice: { to: NodeId; kind: TransitionKind } | { abandon: true };
  /** What the persona did, in their words, e.g. "Tapped the €1,048 Iberia fare". */
  userAction: string;
  reason: string;
}

export interface EditAnnotationContext {
  id: string;
  token: string;
  kind: AnnotationKind;
  text: string;
  componentId?: string;
  intersectingIds?: string[];
  maskDataUrl?: string;
}

export interface EditScreenRequest {
  /** The version being edited (its messages are the starting point). */
  screen: Screen;
  /** Components the user lassoed or painted; empty = the instruction applies to the whole screen. */
  componentIds: string[];
  /** What to change, e.g. "make the total bigger and show per-traveler price". */
  instruction: string;
  /** Included @Pin / @Mask annotations resolved for this edit. */
  annotations?: EditAnnotationContext[];
  /** Optional direct composite PNG mask data URL from a Paint & Speak edit. */
  maskDataUrl?: string;
  /** Compact summary of referenced sibling screens/steps if @mentioned. */
  referencedContext?: string;
}

export interface EditScreenResponse {
  /** The revised screen: same id, nodeId and context as the request; the client re-ids it as a version. */
  screen: Screen;
  /** One line on what changed, for the chat. */
  summary: string;
  /** Component ids that were added, removed or changed. */
  changed: string[];
  /** Guardrail notes left after repair (e.g. a carried value moved). */
  warnings: string[];
  /** Annotation ids addressed by this edit so the UI can mark them resolved. */
  resolvedAnnotationIds?: string[];
  attempts: { model: string; ms: number; ok: boolean; error?: string }[];
  usage?: TokenUsage;
}

export interface AskRequest {
  question: string;
  /** Human summary of what is selected, e.g. "State: Payment (payment)" or "Whole run". */
  selection: string;
  stats: { sessions: number; completedPct: number; failedChecks: number; edgesExercised: number; edgesTotal: number; edgesFor95: number };
  failingEdges: { edge: string; count: number; example: string }[];
  /** When a screen is selected, its messages, so answers can cite what it shows. */
  screen?: { variant: string; messages: A2uiMessage[] };
  /** Optional included @Pin / @Mask / @Screen notes referenced in the question. */
  referencedContext?: string;
  /** Recent chat turns for follow-ups. */
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface AskResponse {
  answer: string;
  model: string;
  usage?: TokenUsage;
}

export interface TranscribeRequest {
  /** Base64-encoded audio payload (without data URL prefix). */
  audioBase64: string;
  mimeType: string;
}

export interface TranscribeResponse {
  transcript: string;
  model: string;
  usage?: TokenUsage;
}

export type DisambiguationControl =
  | {
      id: string;
      kind: "choice-cards";
      label: string;
      options: { id: string; title: string; subtitle: string; badge?: string }[];
      selectedId: string;
    }
  | {
      id: string;
      kind: "chips";
      label: string;
      options: string[];
      selected: string[];
    }
  | {
      id: string;
      kind: "slider";
      label: string;
      min: number;
      max: number;
      step: number;
      unit: string;
      value: number;
    };

export interface DisambiguationRequestPayload {
  prompt: string;
  scope: "screen" | "node" | "edge" | "run";
  nodeLabel?: string;
  screenVariant?: string;
}

export interface DisambiguationResponse {
  ambiguous: boolean;
  uncertaintyScore: number;
  rationale: string;
  controls: DisambiguationControl[];
  usage?: TokenUsage;
}

export interface CritiqueScreenRequest {
  screen: Screen;
  nodeLabel: string;
  stage: string;
  contracts?: string[];
}

export interface CritiquePin {
  componentId?: string;
  kind: "bug" | "rule" | "note";
  text: string;
}

export interface UxEvaluationReport {
  overallScore: number;
  dimensions: {
    usability: number;
    hierarchy: number;
    accessibility: number;
    continuity: number;
  };
  summary: string;
  pins: CritiquePin[];
  model: string;
  evaluatedAt: string;
}

export interface CritiqueScreenResponse {
  report: UxEvaluationReport;
  usage?: TokenUsage;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

async function post<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: opts?.signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${path} failed (${res.status})`);
  return json as T;
}

export const generateScreen = (req: GenerateScreenRequest, opts?: RequestOptions) =>
  post<{ screen: Screen }>("/api/generate-screen", req, opts).then((r) => r.screen);
export const branchFromScreen = (req: BranchRequest, opts?: RequestOptions) => post<BranchResponse>("/api/branch", req, opts);
export const simulateStep = (req: SimulateStepRequest, opts?: RequestOptions) => post<SimulateStepResponse>("/api/simulate-step", req, opts);
export const editScreen = (req: EditScreenRequest, opts?: RequestOptions) => post<EditScreenResponse>("/api/edit-screen", req, opts);
export const askForkcast = (req: AskRequest, opts?: RequestOptions) => post<AskResponse>("/api/ask", req, opts);
export const transcribeAudio = (req: TranscribeRequest, opts?: RequestOptions) => post<TranscribeResponse>("/api/transcribe", req, opts);
export const assessDisambiguation = (req: DisambiguationRequestPayload, opts?: RequestOptions) =>
  post<DisambiguationResponse>("/api/disambiguate", req, opts);
export const critiqueScreen = (req: CritiqueScreenRequest, opts?: RequestOptions) =>
  post<CritiqueScreenResponse>("/api/critique-screen", req, opts);
