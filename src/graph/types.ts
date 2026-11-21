// Core model: a generated interface is a graph of states and transitions.
// Screens are renderings of a state; many screens map to one node.

export type NodeId = string;

/** Who the user is and where they are. Drives how a screen gets generated. */
export type Context = Record<string, string>;

export interface StateNode {
  id: NodeId;
  /** Task stage, e.g. "results", "payment". */
  stage: string;
  /** Component type that renders this state, e.g. "FareTable". */
  component: string;
  label: string;
  /** True where the user commits to something (select, pay, confirm). */
  acts?: boolean;
}

export type TransitionKind = "next" | "back" | "refine" | "digress" | "error" | "abandon";

/** What must survive a jump between two states. */
export interface Contract {
  /** Prop keys whose values must be identical on both sides of the edge. */
  carries: string[];
}

export interface Transition {
  id: string;
  from: NodeId;
  to: NodeId;
  kind: TransitionKind;
  contract?: Contract;
}

export interface FlowGraph {
  nodes: StateNode[];
  transitions: Transition[];
}

/** One rendered screen in a session: which state, with which props. */
export interface Step {
  node: NodeId;
  props: Record<string, unknown>;
  /** Generated screen shown at this step (RunFile.screens), when recorded. */
  screenId?: string;
  /** What the (simulated) user did to leave this step, e.g. "tapped Pay" or "asked: is there wifi?". */
  userAction?: string;
}

export type Outcome = "completed" | "abandoned" | "error";

/** One session, real or simulated. */
export interface Trace {
  id: string;
  context: Context;
  steps: Step[];
  outcome: Outcome;
}

/** A rule every rendering of a component must satisfy, whatever it looks like. */
export interface Invariant {
  id: string;
  component: string;
  description: string;
  /** Returns null when the props pass, or a message describing the failure. */
  check: (props: Record<string, unknown>) => string | null;
}

export const edgeKey = (from: NodeId, to: NodeId) => `${from}->${to}`;
