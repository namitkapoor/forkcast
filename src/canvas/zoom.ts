import { useViewportStore } from "@xyflow/react";

export type ZoomLevel = "far" | "mid" | "near";

// Semantic zoom thresholds: each level shows a different kind of information.
export const zoomLevel = (z: number): ZoomLevel => (z < 0.55 ? "far" : z < 1.4 ? "mid" : "near");

export const useZoomLevel = () => useViewportStore((s) => zoomLevel(s.transform[2]));
