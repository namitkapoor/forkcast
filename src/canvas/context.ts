import { createContext, useContext } from "react";
import type { Annotation, ScreenAction } from "../a2ui/types";

export type Tool = "select" | "hand" | "annotate" | "branch";

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

export interface CanvasApi {
  selection: Selection;
  tool: Tool;
  annotations: Record<string, Annotation[]>;
  draft: Draft | null;
  selectNode: (id: string) => void;
  selectEdge: (key: string) => void;
  selectScreen: (id: string, nodeId: string, opts?: { focus?: boolean }) => void;
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
