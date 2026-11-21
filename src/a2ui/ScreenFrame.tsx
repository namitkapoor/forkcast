import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type MouseEvent, type ReactNode } from "react";
import { A2uiSurface, MarkdownContext, type ReactCatalogComponent } from "@a2ui/react/v0_9";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
// Ships with @a2ui/react (its own dependency); renders Text markdown via markdown-it + DOMPurify.
import { renderMarkdown } from "@a2ui/markdown-it";
import type { Screen, ScreenAction } from "./types";
import { componentIdFromEvent } from "./componentId";
import { validateMessages } from "./validate";
import "./screenFrame.css";

// Renders one Screen (an A2UI v0.9 message stream) inside a phone-shaped frame.
// Content is laid out at a fixed 360px base width and CSS-scaled to `width`, so
// thumbnails are true miniatures of the live screen.

export interface ScreenFrameProps {
  screen: Screen;
  /** "thumb" = static, non-interactive (canvas overview); "live" = interactive. */
  mode?: "thumb" | "live";
  /** Rendered width in px; height follows a phone aspect ratio (9:19.5). */
  width?: number;
  onAction?: (action: ScreenAction) => void;
  /** Click on a component (live mode) — used to pin annotations. */
  onComponentClick?: (componentId: string, rel: { x: number; y: number }, mods: { shiftKey: boolean }) => void;
  /** Live mode only: clicks pick a component (onComponentClick) instead of triggering actions. */
  annotate?: boolean;
  /** No device chrome (status bar, home bar) and height follows the content: for embedding a screen in a chat bubble. */
  bare?: boolean;
}

export const BASE_WIDTH = 360;
const ASPECT = 19.5 / 9;
const BASE_HEIGHT = Math.round(BASE_WIDTH * ASPECT);

interface Prepared {
  processor: MessageProcessor<ReactCatalogComponent> | null;
  surface: SurfaceModel<ReactCatalogComponent> | null;
  errors: string[];
}

/** One processor per screen instance. Pure (no subscriptions), so StrictMode double-render is safe. */
function prepare(screen: Screen, onAction: (a: ScreenAction) => void): Prepared {
  // Same strict check the server applies; the processor alone tolerates unknown components.
  const check = validateMessages(screen.messages);
  if (!check.ok) return { processor: null, surface: null, errors: check.errors };
  try {
    const processor = new MessageProcessor<ReactCatalogComponent>([basicCatalog], (action) => {
      onAction({ name: action.name, sourceComponentId: action.sourceComponentId, context: action.context });
    });
    const errs = processor.processMessagesWithErrors(screen.messages);
    const errors = errs.map((e) => {
      const err = (e as { error?: { code?: string; path?: string; message?: string } }).error;
      return err ? `${err.code ?? "ERROR"}${err.path ? ` at ${err.path}` : ""}: ${err.message ?? ""}` : JSON.stringify(e);
    });
    const surface = processor.getSurfaces().values().next().value ?? null;
    if (!surface && errors.length === 0) errors.push("no surface was created (missing createSurface?)");
    return { processor, surface, errors };
  } catch (e) {
    return { processor: null, surface: null, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

export function ScreenFrame({ screen, mode = "thumb", width = 240, onAction, onComponentClick, annotate = false, bare = false }: ScreenFrameProps) {
  const live = mode === "live";
  const scale = width / BASE_WIDTH;
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState<number | null>(null);
  // Bare frames size to their content; transforms don't affect offsetHeight, so this is the unscaled height.
  useLayoutEffect(() => {
    if (!bare) return;
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setContentH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bare]);
  const height = bare ? Math.round((contentH ?? BASE_HEIGHT * 0.5) * scale) : Math.round(width * ASPECT);

  // Latest callbacks/flags in refs so the processor isn't rebuilt when they change.
  const onActionRef = useRef(onAction);
  const annotatingRef = useRef(live && annotate);
  useEffect(() => {
    onActionRef.current = onAction;
    annotatingRef.current = live && annotate;
  });

  const dispatch = useCallback((a: ScreenAction) => {
    if (annotatingRef.current) return;
    onActionRef.current?.(a);
  }, []);

  // Keyed on id + messages identity: a regenerated screen with the same id still re-renders.
  const prepared = useMemo(() => prepare(screen, dispatch), [screen.id, screen.messages, dispatch]);

  const frameRef = useRef<HTMLDivElement>(null);
  const annotating = live && annotate;

  // Capture phase on the frame runs before the components' own handlers (also inside shadow DOM),
  // so stopping it here means annotate-mode clicks never press buttons.
  const onClickCapture = (e: MouseEvent) => {
    if (!annotating) return;
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const r = frame.getBoundingClientRect();
    const rel = { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
    const id = componentIdFromEvent(e.nativeEvent, frame);
    if (id) onComponentClick?.(id, rel, { shiftKey: e.shiftKey });
  };

  const radius = Math.max(8, Math.round(28 * scale));

  return (
    <div
      ref={frameRef}
      className={`fc-phone fc-phone--${mode}${bare ? " fc-phone--bare" : ""}${annotating ? " fc-phone--annotating" : ""}`}
      style={{ width, height, borderRadius: bare ? undefined : radius }}
      onClickCapture={live ? onClickCapture : undefined}
      data-screen-id={screen.id}
    >
      <div
        ref={innerRef}
        className="fc-phone__screen a2ui-light"
        style={{ width: BASE_WIDTH, height: bare ? undefined : BASE_HEIGHT, transform: `scale(${scale})` }}
        inert={!live}
        aria-hidden={!live || undefined}
      >
        {!bare && <StatusBar />}
        <div className="fc-phone__content">
          <FrameErrorBoundary key={`${screen.id}:${screen.messages.length}`} variant={screen.variant}>
            {prepared.errors.length > 0 || !prepared.surface ? (
              <ErrorState variant={screen.variant} errors={prepared.errors} />
            ) : (
              <MarkdownContext.Provider value={renderMarkdown}>
                <A2uiSurface surface={prepared.surface} />
              </MarkdownContext.Provider>
            )}
          </FrameErrorBoundary>
        </div>
        {!bare && <div className="fc-phone__home" />}
      </div>

      {screen.annotations.length > 0 && (
        <div className="fc-phone__pins">
          {screen.annotations.map((a, i) => (
            <div
              key={a.id}
              className={`fc-pin fc-pin--${a.kind}`}
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, ["--pin" as string]: `${Math.max(14, Math.round(22 * Math.min(1, scale * 1.4)))}px` }}
              title={a.text}
            >
              {i + 1}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function StatusBar() {
  return (
    <div className="fc-phone__status">
      <span>9:41</span>
      <span className="fc-phone__status-icons">
        <i className="fc-bars" />
        <i className="fc-battery" />
      </span>
    </div>
  );
}

function ErrorState({ variant, errors }: { variant: string; errors: string[] }) {
  return (
    <div className="fc-phone__error" role="alert">
      <div className="fc-phone__error-variant">{variant}</div>
      <div className="fc-phone__error-title">Couldn’t render this screen</div>
      <ul>
        {errors.slice(0, 4).map((e, i) => (
          <li key={i}>{e}</li>
        ))}
        {errors.length > 4 && <li>…and {errors.length - 4} more</li>}
      </ul>
    </div>
  );
}

class FrameErrorBoundary extends Component<{ variant: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[ScreenFrame] render failed for "${this.props.variant}"`, error, info.componentStack);
  }
  render() {
    if (this.state.error) return <ErrorState variant={this.props.variant} errors={[this.state.error.message]} />;
    return this.props.children;
  }
}
