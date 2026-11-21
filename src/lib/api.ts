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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${path} failed (${res.status})`);
  return json as T;
}

export const generateScreen = (req: GenerateScreenRequest) => post<{ screen: Screen }>("/api/generate-screen", req).then((r) => r.screen);
export const branchFromScreen = (req: BranchRequest) => post<BranchResponse>("/api/branch", req);
export const simulateStep = (req: SimulateStepRequest) => post<SimulateStepResponse>("/api/simulate-step", req);
