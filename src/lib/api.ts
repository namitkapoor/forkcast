import type { Context, NodeId, StateNode, Transition, TransitionKind } from "../graph/types";
import type { A2uiMessage, Screen } from "../a2ui/types";

// Client for the serverless routes in /api. The Gemini key never reaches the browser.
// Request/response shapes here are the contract; api/* implements them.

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

export interface EditScreenRequest {
  /** The version being edited (its messages are the starting point). */
  screen: Screen;
  /** Components the user lassoed; empty = the instruction applies to the whole screen. */
  componentIds: string[];
  /** What to change, e.g. "make the total bigger and show per-traveler price". */
  instruction: string;
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
  attempts: { model: string; ms: number; ok: boolean; error?: string }[];
}

export interface AskRequest {
  question: string;
  /** Human summary of what is selected, e.g. "State: Payment (payment)" or "Whole run". */
  selection: string;
  stats: { sessions: number; completedPct: number; failedChecks: number; edgesExercised: number; edgesTotal: number; edgesFor95: number };
  failingEdges: { edge: string; count: number; example: string }[];
  /** When a screen is selected, its messages, so answers can cite what it shows. */
  screen?: { variant: string; messages: A2uiMessage[] };
  /** Recent chat turns for follow-ups. */
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface AskResponse {
  answer: string;
  model: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${path} failed (${res.status})`);
  return json as T;
}

export const generateScreen = (req: GenerateScreenRequest) => post<{ screen: Screen }>("/api/generate-screen", req).then((r) => r.screen);
export const branchFromScreen = (req: BranchRequest) => post<BranchResponse>("/api/branch", req);
export const simulateStep = (req: SimulateStepRequest) => post<SimulateStepResponse>("/api/simulate-step", req);
export const editScreen = (req: EditScreenRequest) => post<EditScreenResponse>("/api/edit-screen", req);
export const askForkcast = (req: AskRequest) => post<AskResponse>("/api/ask", req);
