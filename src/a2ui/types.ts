import type { Context, NodeId } from "../graph/types";

// Screens are A2UI v0.9 message streams (https://a2ui.org), rendered by @a2ui/react/v0_9
// with the basic catalog. v0.9 because that's what the published React renderer supports.

export const A2UI_VERSION = "v0.9" as const;
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

/** One server→client A2UI message: { version: "v0.9", createSurface | updateComponents | updateDataModel | deleteSurface }. */
export type A2uiMessage = { version: typeof A2UI_VERSION } & Record<string, unknown>;

export type AnnotationKind = "note" | "bug" | "rule" | "mask";

export interface AnnotationRevision {
  id: string;
  revisionNumber: number;
  timestamp: string;
  author: "designer" | "ai-evaluator";
  text: string;
  kind: AnnotationKind;
  status: "open" | "resolved";
  resolvedByVersionId?: string;
}

export interface Annotation {
  id: string;
  /** Component id inside the screen the note is pinned to, if any. */
  componentId?: string;
  /** Position relative to the screen frame, 0..1. */
  x: number;
  y: number;
  text: string;
  kind: AnnotationKind;
  createdAt: string;
  /** Monotonic mention handle, e.g. "Pin-1" or "Mask-1" for @Pin-1:v1 references. */
  mentionTag?: string;
  /** Open vs resolved state (defaults to "open"). */
  status?: "open" | "resolved";
  /** Who created the annotation (defaults to "designer"). */
  author?: "designer" | "ai-evaluator";
  /** Opt-in/out switch controlling whether this annotation is auto-sent in AI context (defaults to true). */
  includeInAiFeedback?: boolean;
  /** Painted region strokes (frame-relative 0..1) and bounding box when kind === "mask". */
  strokes?: { x: number; y: number }[][];
  maskBox?: { x: number; y: number; w: number; h: number };
  /** Composite PNG data URL for multimodal Gemini mask refinement. */
  maskDataUrl?: string;
  /** A2UI component ids intersected by a painted mask. */
  intersectingIds?: string[];
  /** Full monotonic revision history (v1, v2, ...). */
  revisions?: AnnotationRevision[];
}

/** One generated rendering of a node, for one user context. */
export interface Screen {
  id: string;
  nodeId: NodeId;
  context: Context;
  /** Short layout name the generator chose, e.g. "stacked-fare-cards". */
  variant: string;
  /** One sentence on why this layout fits this context. */
  rationale: string;
  messages: A2uiMessage[];
  /** Model id that produced it, or "fixture". */
  model: string;
  createdAt: string;
  annotations: Annotation[];
  /** Why the main components are there: which ingredient drove each choice (gen-v2 and later). */
  decisions?: ScreenDecision[];
}

export type DecisionSource = "query" | "memory" | "context" | "tool" | "carry" | "history";
export const DECISION_SOURCES: DecisionSource[] = ["query", "memory", "context", "tool", "carry", "history"];

/** One design decision on a screen, tied to the ingredient that caused it. */
export interface ScreenDecision {
  componentId: string;
  because: string;
  source: DecisionSource;
}

/** A user action emitted by the renderer (button press etc.). */
export interface ScreenAction {
  name: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
}
