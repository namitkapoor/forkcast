import { createContext, useContext } from "react";
import type { Annotation, Screen, ScreenAction } from "../a2ui/types";
import type { Point } from "../a2ui/componentRects";

export type Tool = "select" | "hand" | "lasso" | "annotate" | "branch";

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

export interface CanvasApi {
  selection: Selection;
  tool: Tool;
  annotations: Record<string, Annotation[]>;
  draft: Draft | null;
  picks: Picks | null;
  /** Components the last AI edit changed, outlined in green on that version. */
  changed: { versionId: string; ids: string[] } | null;
  playTraffic: boolean;
  /** The version of a base screen currently shown in its slot. */
  shown: (screen: Screen) => Screen;
  selectNode: (id: string) => void;
  selectEdge: (key: string) => void;
  selectScreen: (id: string, nodeId: string, opts?: { focus?: boolean }) => void;
  setPicks: (p: Picks | null) => void;
  startDraft: (d: Draft) => void;
  cancelDraft: () => void;
  saveDraft: (text: string, kind: Annotation["kind"]) => void;
  onScreenAction: (screenId: string, action: ScreenAction) => void;
}

export const CanvasContext = createContext<CanvasApi | null>(null);

export function useCanvas(): CanvasApi {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas outside CanvasContext");
  return ctx;
}
