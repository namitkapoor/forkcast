import { createContext, useContext } from "react";
import type { Annotation, AnnotationKind, Screen, ScreenAction } from "../a2ui/types";
import type { Point } from "../a2ui/componentRects";
import type { FlowGraph } from "../graph/types";
import type { TokenUsage } from "../lib/api";

export type Tool = "select" | "hand" | "lasso" | "annotate" | "mask" | "branch";

export type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "screen"; id: string; nodeId: string }
  | { kind: "edge"; key: string };

export interface Draft {
  screenId: string;
  x: number;
  y: number;
  componentId?: string;
}

export interface MaskCommitPayload {
  baseScreenId: string;
  shownScreenId: string;
  x: number;
  y: number;
  strokes: Point[][];
  maskBox: { x: number; y: number; w: number; h: number };
  maskDataUrl: string;
  intersectingIds: string[];
  text: string;
  includeInAiFeedback: boolean;
  applyImmediately: boolean;
}

/** A component picked on a live screen (click, shift-click, lasso or the Layers tree). */
export interface Picked {
  id: string;
  type: string;
  label: string;
}

export interface Picks {
  /** Base screen id (the slot), not the version id. */
  screenId: string;
  items: Picked[];
  /** Lasso polygon (frame-relative 0..1) when the picks came from a lasso. */
  lasso?: Point[];
}

export interface ActiveCritiqueOverlay {
  critiqueId: string;
  /** Exact shown screen id (`s-1` or `s-1@v2`) these critic pins belong to. */
  screenId: string;
  label: string;
  pins: Annotation[];
}

export interface CanvasApi {
  graph?: FlowGraph;
  selection: Selection;
  tool: Tool;
  annotations: Record<string, Annotation[]>;
  activeCritiqueOverlay?: ActiveCritiqueOverlay | null;
  draft: Draft | null;
  picks: Picks | null;
  /** Components the last AI edit changed, outlined in green on that version. */
  changed: { versionId: string; ids: string[] } | null;
  playTraffic: boolean;
  /** The version of a base screen currently shown in its slot. */
  shown: (screen: Screen) => Screen;
  /** Whether the currently shown version of a base screen is marked finalized. */
  isFinalized?: (baseScreenId: string) => boolean;
  selectNode: (id: string) => void;
  selectEdge: (key: string) => void;
  selectScreen: (id: string, nodeId: string, opts?: { focus?: boolean }) => void;
  setPicks: (p: Picks | null) => void;
  startDraft: (d: Draft) => void;
  cancelDraft: () => void;
  saveDraft: (text: string, kind: AnnotationKind, includeInAi?: boolean) => void;
  commitMask: (payload: MaskCommitPayload) => void;
  onDismissCritiqueOverlay?: () => void;
  onMentionCritiquePin?: (token: string) => void;
  onScreenAction: (screenId: string, action: ScreenAction) => void;
  onVoiceUsage?: (usage: TokenUsage) => void;
  onVoiceError?: (msg: string) => void;
}

export const CanvasContext = createContext<CanvasApi | null>(null);

export function useCanvas(): CanvasApi {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas outside CanvasContext");
  return ctx;
}
