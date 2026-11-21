import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { useViewportStore } from "@xyflow/react";
import type { Annotation, Screen } from "../a2ui/types";
import { componentRects, pickInLasso, type ComponentRect, type Point } from "../a2ui/componentRects";
import { THUMB_H, THUMB_W } from "./geometry";
import { useCanvas } from "./context";
import { useHover } from "./hoverStore";
import { useBrowserVoice } from "../ui/useBrowserVoice";
import { VoiceButton, VoiceFeedback } from "../ui/VoiceButton";

// Figma-style overlay above a selected screen: hover box with a type tag, selected boxes with
// corner handles, the lasso, AI-changed outlines, annotation pins and the comment popover.
// Boxes come from componentRects (frame-relative, so zoom/pan never invalidates them); they are
// re-measured when the screen re-renders or its content scrolls. Never touches the A2UI DOM.

const NO_NOTES: Annotation[] = [];

export function ScreenOverlay({
  baseId,
  shown,
  live,
  phone,
  zoom,
}: {
  baseId: string;
  nodeId: string;
  shown: Screen;
  live: boolean;
  phone: () => HTMLElement | null;
  zoom: number;
}) {
  const { tool, picks, changed, annotations, draft, setPicks } = useCanvas();
  const hover = useHover();
  const [rects, setRects] = useState<ComponentRect[]>([]);
  const inv = 1 / zoom;

  const measure = useCallback(() => {
    const el = phone();
    if (el) setRects(componentRects(el));
  }, [phone]);

  // Re-measure after render (Lit children paint a frame later), on DOM changes and on content scroll.
  useLayoutEffect(() => {
    measure();
    const el = phone();
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(measure)));
    const t = window.setTimeout(measure, 250);
    if (!el) return () => cancelAnimationFrame(raf);
    let pending = 0;
    const soon = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(measure);
    };
    const mo = new MutationObserver(soon);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", soon, true);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pending);
      window.clearTimeout(t);
      mo.disconnect();
      el.removeEventListener("scroll", soon, true);
    };
  }, [measure, phone, shown.messages, live]);

  // Lasso drawing (lasso tool on a live screen).
  const [path, setPath] = useState<Point[] | null>(null);
  const drawing = useRef(false);
  const lassoing = live && tool === "lasso";
  const rel = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDown = (e: PointerEvent) => {
    if (!lassoing || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    setPath([rel(e)]);
  };
  const onMove = (e: PointerEvent) => {
    if (!drawing.current) return;
    const p = rel(e);
    setPath((pts) => {
      if (!pts) return [p];
      const q = pts[pts.length - 1];
      return Math.hypot((p.x - q.x) * THUMB_W, (p.y - q.y) * THUMB_H) * zoom > 3 ? [...pts, p] : pts;
    });
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = path ?? [];
    setPath(null);
    const el = phone();
    if (pts.length < 3 || !el) return;
    const all = componentRects(el);
    setRects(all);
    const hit = pickInLasso(all, pts);
    const seen = new Set<string>();
    const items = hit.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ id: r.id, type: r.type, label: r.label }));
    setPicks(items.length ? { screenId: baseId, items, lasso: pts } : null);
  };
  // Wheel over the capture layer scrolls the phone content, as it would without the overlay.
  const onWheel = (e: WheelEvent) => {
    const c = phone()?.querySelector<HTMLElement>(".fc-phone__content");
    if (c) c.scrollTop += e.deltaY;
  };

  useEffect(() => {
    if (!lassoing) setPath(null);
  }, [lassoing]);

  const mine = picks?.screenId === baseId ? picks : null;
  const pickedIds = new Set(mine?.items.map((p) => p.id));
  const boxes: ReactNode[] = [];
  const box = (r: ComponentRect, i: number, kind: "hover" | "sel" | "changed") => (
    <div
      key={`${kind}-${r.id}-${i}`}
      className={`ov__box${kind === "sel" ? " ov__box--sel" : kind === "changed" ? " ov__box--changed" : ""}`}
      style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
    >
      {kind === "sel" && (
        <>
          <i className="ov__h ov__h--tl" />
          <i className="ov__h ov__h--tr" />
          <i className="ov__h ov__h--bl" />
          <i className="ov__h ov__h--br" />
        </>
      )}
      {kind !== "changed" && (i === 0 || kind === "hover") && (
        <span className="ov__tag" style={{ transform: `scale(${inv})` }}>
          {r.type} · {r.id}
        </span>
      )}
    </div>
  );

  if (changed?.versionId === shown.id && !mine) {
    const ids = new Set(changed.ids);
    rects.filter((r) => ids.has(r.id)).forEach((r, i) => boxes.push(box(r, i, "changed")));
  }
  for (const p of mine?.items ?? []) rects.filter((r) => r.id === p.id).forEach((r, i) => boxes.push(box(r, i, "sel")));
  if (hover?.screenId === baseId && !pickedIds.has(hover.id) && !path) {
    rects.filter((r) => r.id === hover.id).forEach((r, i) => boxes.push(box(r, i, "hover")));
  }

  const lasso = path ?? mine?.lasso ?? null;
  const notes = annotations[shown.id] ?? NO_NOTES;
  const draftHere = draft?.screenId === shown.id ? draft : null;
  const draftBox = draftHere?.componentId ? rects.find((r) => r.id === draftHere.componentId) : undefined;

  return (
    <div
      className={`ov${lassoing ? " ov--capture nodrag nopan" : ""}`}
      style={{ ["--inv" as string]: inv }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={lassoing ? onWheel : undefined}
      onClick={lassoing ? (e) => e.stopPropagation() : undefined}
    >
      {boxes}
      {lasso && lasso.length > 1 && (
        <svg className="lasso" viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden="true">
          <path
            d={`M${lasso.map((p) => `${(p.x * THUMB_W).toFixed(1)},${(p.y * THUMB_H).toFixed(1)}`).join(" L")}${path ? "" : " Z"}`}
            style={{ strokeWidth: 1.5 * inv, strokeDasharray: `${5 * inv} ${4 * inv}` }}
          />
        </svg>
      )}
      {notes.map((a, i) => (
        <span key={a.id} className={`pin pin--${a.kind}`} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: `scale(${inv})` }} title={a.text}>
          {i + 1}
        </span>
      ))}
      {draftHere && <DraftPopover top={draftBox ? draftBox.y : draftHere.y} x={draftHere.x} y={draftHere.y} inv={inv} />}
    </div>
  );
}

/** Comment popover: sits beside the phone (never over it), level with the selected box. */
function DraftPopover({ top, x, y, inv }: { top: number; x: number; y: number; inv: number }) {
  const { draft, cancelDraft, saveDraft } = useCanvas();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Annotation["kind"]>("note");
  const voice = useBrowserVoice({ value: text, onChange: setText });
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  const zoom = useViewportStore((s) => s.transform[2]);
  // Sit to the right of the phone unless that would run under the properties panel / off screen.
  const anchor = useRef<HTMLSpanElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const ov = anchor.current?.parentElement;
    if (!ov) return;
    const r = ov.getBoundingClientRect();
    const rightEdge = window.innerWidth - (document.querySelector(".rpanel") ? 324 : 16);
    const leftEdge = document.querySelector(".lpanel:not(.is-collapsed)") && window.innerWidth >= 760 ? 364 : 16;
    setFlip(r.right + 280 > rightEdge && r.left - 280 > leftEdge);
  }, [zoom, top]);
  if (!draft) return null;
  const cancel = () => {
    voice.stop();
    cancelDraft();
  };
  const submit = () => {
    voice.stop();
    if (text.trim()) saveDraft(text.trim(), kind);
    else cancelDraft();
  };
  return (
    <>
      <span ref={anchor} className="pin pin--draft" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `scale(${inv})` }} />
      <div
        className={`composer nodrag nopan nowheel nokeys${flip ? " composer--flip" : ""}${voice.isListening ? " is-listening" : ""}`}
        style={{
          ...(flip ? { right: `calc(100% + ${14 * inv}px)` } : { left: `calc(100% + ${14 * inv}px)` }),
          top: `${top * 100}%`,
          transform: `scale(${1 / Math.max(zoom, 0.05)})`,
          transformOrigin: flip ? "top right" : "top left",
          pointerEvents: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="composer__kinds" role="radiogroup" aria-label="Annotation type">
          {(["note", "bug", "rule"] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        {draft.componentId && (
          <div className="composer__target">
            on <code>{draft.componentId}</code>
          </div>
        )}
        <textarea
          ref={input}
          value={text}
          rows={2}
          placeholder="Speak or type a note…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              if (voice.isListening) voice.stop();
              else cancel();
            }
          }}
        />
        <VoiceFeedback voice={voice} />
        <div className="composer__actions">
          <VoiceButton voice={voice} label="Speak" ariaLabel="Speak annotation" />
          <div className="composer__actions-right">
            <button onClick={cancel}>Cancel</button>
            <button className="is-primary" onClick={submit}>
              Pin {kind}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
