import type { Context, NodeId } from "../graph/types";

// Screens are A2UI v0.9 message streams (https://a2ui.org), rendered by @a2ui/react/v0_9
// with the basic catalog. v0.9 because that's what the published React renderer supports.

export const A2UI_VERSION = "v0.9" as const;
export const BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

/** One server→client A2UI message: { version: "v0.9", createSurface | updateComponents | updateDataModel | deleteSurface }. */
export type A2uiMessage = { version: typeof A2UI_VERSION } & Record<string, unknown>;

export interface Annotation {
  id: string;
  /** Component id inside the screen the note is pinned to, if any. */
  componentId?: string;
  /** Position relative to the screen frame, 0..1. */
  x: number;
  y: number;
  text: string;
  kind: "note" | "bug" | "rule";
  createdAt: string;
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
}

/** A user action emitted by the renderer (button press etc.). */
export interface ScreenAction {
  name: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
}
