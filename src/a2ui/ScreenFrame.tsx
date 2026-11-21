import type { Screen, ScreenAction } from "./types";

// STUB — the renderer workstream replaces the body with a real @a2ui/react/v0_9 render.
// Keep this props signature stable: the canvas depends on it.

export interface ScreenFrameProps {
  screen: Screen;
  /** "thumb" = static, non-interactive (canvas overview); "live" = interactive. */
  mode?: "thumb" | "live";
  /** Rendered width in px; height follows a phone aspect ratio (9:19.5). */
  width?: number;
  onAction?: (action: ScreenAction) => void;
  /** Click on a component (live mode) — used to pin annotations. */
  onComponentClick?: (componentId: string, rel: { x: number; y: number }) => void;
}

export function ScreenFrame({ screen, width = 240 }: ScreenFrameProps) {
  return (
    <div style={{ width, height: Math.round(width * 19.5 / 9), border: "1px solid #444", borderRadius: 24, padding: 12, fontSize: 11 }}>
      {screen.variant}
    </div>
  );
}
