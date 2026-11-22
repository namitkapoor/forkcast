import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { useViewportStore } from "@xyflow/react";
import type { Annotation, AnnotationKind, Screen } from "../a2ui/types";
import { componentRects, pickInLasso, type ComponentRect, type Point } from "../a2ui/componentRects";
import { formatVersionedRef } from "../ui/annotations";
import { IconBrush, IconSpark, IconX } from "../ui/icons";
import { useVoiceInput, VoiceMicButton } from "../ui/useVoiceInput";
import { THUMB_H, THUMB_W } from "./geometry";
import { useCanvas } from "./context";
import { useHover } from "./hoverStore";

// Figma-style overlay above a selected screen: hover box with a type tag, selected boxes with
// corner handles, the lasso, Paint & Speak region masks, AI-changed outlines, versioned annotation
// pins and the comment/mask popovers. Never touches the A2UI DOM.

const NO_NOTES: Annotation[] = [];

function boxesOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function renderSpatialMaskSnapshot(rects: ComponentRect[], strokes: Point[][]): string {
  const W = THUMB_W * 2;
  const H = THUMB_H * 2;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return "";

  // Clean dark-blueprint wireframe of A2UI components + vivid magenta brush mask
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(30, 41, 59, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#334155";
  for (const r of rects) {
    const rx = r.x * W;
    const ry = r.y * H;
    const rw = r.w * W;
    const rh = r.h * H;
    ctx.strokeRect(rx, ry, rw, rh);
    if (rw > 40 && rh > 16) {
      ctx.fillText(`${r.type}#${r.id}`.slice(0, 26), rx + 4, ry + 13);
    }
  }

  ctx.strokeStyle = "rgba(236, 72, 153, 0.78)";
  ctx.lineWidth = 26;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (!s.length) continue;
    ctx.beginPath();
    ctx.moveTo(s[0].x * W, s[0].y * H);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x * W, s[i].y * H);
    if (s.length === 1) ctx.lineTo(s[0].x * W + 0.5, s[0].y * H + 0.5);
    ctx.stroke();
  }
  return c.toDataURL("image/png");
}

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
  const {
    tool,
    picks,
    changed,
    annotations,
    activeCritiqueOverlay,
    draft,
    setPicks,
    commitMask,
    onDismissCritiqueOverlay,
    onMentionCritiquePin,
  } = useCanvas();
  const hover = useHover();
  const [rects, setRects] = useState<ComponentRect[]>([]);
  const [focusedCriticPinId, setFocusedCriticPinId] = useState<string | null>(null);
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

  // Paint Mask drawing (mask tool on a live screen).
  const masking = live && tool === "mask";
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const painting = useRef(false);
  const [maskPopoverOpen, setMaskPopoverOpen] = useState(false);

  const rel = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(0.99, Math.max(0.01, (e.clientX - r.left) / r.width)),
      y: Math.min(0.99, Math.max(0.01, (e.clientY - r.top) / r.height)),
    };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (lassoing) {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drawing.current = true;
      setPath([rel(e)]);
      return;
    }
    if (masking && !(e.target as HTMLElement).closest?.(".composer")) {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      painting.current = true;
      setMaskPopoverOpen(false);
      const pt = rel(e);
      setStrokes((prev) => [...prev, [pt]]);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (drawing.current) {
      const p = rel(e);
      setPath((pts) => {
        if (!pts) return [p];
        const q = pts[pts.length - 1];
        return Math.hypot((p.x - q.x) * THUMB_W, (p.y - q.y) * THUMB_H) * zoom > 3 ? [...pts, p] : pts;
      });
      return;
    }
    if (painting.current) {
      const p = rel(e);
      setStrokes((prev) => {
        if (!prev.length) return [[p]];
        const last = prev[prev.length - 1];
        const q = last[last.length - 1];
        if (q && Math.hypot((p.x - q.x) * THUMB_W, (p.y - q.y) * THUMB_H) * zoom <= 2.5) return prev;
        const next = [...prev];
        next[next.length - 1] = [...last, p];
        return next;
      });
    }
  };

  const computeMaskTarget = useCallback(
    (curStrokes: Point[][]) => {
      const pts = curStrokes.flat();
      if (!pts.length) return { box: { x: 0.2, y: 0.2, w: 0.6, h: 0.3 }, hits: [] as ComponentRect[] };
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.max(0.02, Math.min(...xs) - 0.03);
      const maxX = Math.min(0.98, Math.max(...xs) + 0.03);
      const minY = Math.max(0.02, Math.min(...ys) - 0.03);
      const maxY = Math.min(0.98, Math.max(...ys) + 0.03);
      const box = { x: minX, y: minY, w: Math.max(0.08, maxX - minX), h: Math.max(0.06, maxY - minY) };
      const el = phone();
      const all = el ? componentRects(el) : rects;
      const hits = all.filter((r) => r.id !== "root" && boxesOverlap(r, box));
      return { box, hits };
    },
    [phone, rects],
  );

  const onUp = () => {
    if (drawing.current) {
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
      return;
    }
    if (painting.current) {
      painting.current = false;
      setStrokes((cur) => {
        if (cur.flat().length > 0) {
          const { hits } = computeMaskTarget(cur);
          const seen = new Set<string>();
          const items = hits.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ id: r.id, type: r.type, label: r.label }));
          if (items.length) setPicks({ screenId: baseId, items });
          setMaskPopoverOpen(true);
        }
        return cur;
      });
    }
  };

  // Wheel over the capture layer scrolls the phone content, as it would without the overlay.
  const onWheel = (e: WheelEvent) => {
    const c = phone()?.querySelector<HTMLElement>(".fc-phone__content");
    if (c) c.scrollTop += e.deltaY;
  };

  useEffect(() => {
    if (!lassoing) setPath(null);
  }, [lassoing]);

  useEffect(() => {
    if (!masking) {
      setStrokes([]);
      setMaskPopoverOpen(false);
    }
  }, [masking, shown.id]);

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
  if (hover?.screenId === baseId && !pickedIds.has(hover.id) && !path && !masking) {
    rects.filter((r) => r.id === hover.id).forEach((r, i) => boxes.push(box(r, i, "hover")));
  }

  const lasso = path ?? mine?.lasso ?? null;
  const notes = annotations[shown.id] ?? NO_NOTES;
  const criticOverlayHere = activeCritiqueOverlay?.screenId === shown.id ? activeCritiqueOverlay : null;
  const criticPins = criticOverlayHere?.pins ?? NO_NOTES;
  const draftHere = draft?.screenId === shown.id ? draft : null;
  const draftBox = draftHere?.componentId ? rects.find((r) => r.id === draftHere.componentId) : undefined;
  const capturing = lassoing || masking;

  const activeMaskInfo = strokes.length > 0 ? computeMaskTarget(strokes) : null;

  useEffect(() => {
    setFocusedCriticPinId(null);
  }, [criticOverlayHere?.critiqueId, shown.id]);

  return (
    <div
      className={`ov${capturing ? " ov--capture nodrag nopan" : ""}${masking ? " ov--masking" : ""}`}
      style={{ ["--inv" as string]: inv }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={capturing ? onWheel : undefined}
      onClick={capturing ? (e) => e.stopPropagation() : undefined}
    >
      {boxes}

      {/* Saved @Mask region outlines */}
      {notes
        .filter((a) => a.kind === "mask" && a.maskBox && a.status !== "resolved")
        .map((a) => (
          <div
            key={`maskbox-${a.id}`}
            className="ov__maskbox"
            style={{
              left: `${a.maskBox!.x * 100}%`,
              top: `${a.maskBox!.y * 100}%`,
              width: `${a.maskBox!.w * 100}%`,
              height: `${a.maskBox!.h * 100}%`,
            }}
          />
        ))}

      {lasso && lasso.length > 1 && (
        <svg className="lasso" viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden="true">
          <path
            d={`M${lasso.map((p) => `${(p.x * THUMB_W).toFixed(1)},${(p.y * THUMB_H).toFixed(1)}`).join(" L")}${path ? "" : " Z"}`}
            style={{ strokeWidth: 1.5 * inv, strokeDasharray: `${5 * inv} ${4 * inv}` }}
          />
        </svg>
      )}

      {/* Live painted brush strokes */}
      {strokes.length > 0 && (
        <svg className="paint-svg" viewBox={`0 0 ${THUMB_W} ${THUMB_H}`} aria-hidden="true">
          {strokes.map((s, idx) =>
            s.length ? (
              <path
                key={idx}
                d={`M${s.map((p) => `${(p.x * THUMB_W).toFixed(1)},${(p.y * THUMB_H).toFixed(1)}`).join(" L")}`}
                style={{ strokeWidth: Math.max(10, 14 * inv) }}
              />
            ) : null,
          )}
        </svg>
      )}

      {masking && strokes.length === 0 && !maskPopoverOpen && (
        <div className="mask-banner" style={{ transform: `translateX(-50%) scale(${inv})` }}>
          <IconBrush width={12} height={12} /> Brush over a region · release to speak or type
        </div>
      )}

      {/* Ephemeral Critic Overlay Banner & Component Outlines (non-persistent; shown when Critique runs or is opened from History) */}
      {criticOverlayHere && criticPins.length > 0 && !masking && (
        <>
          <div
            className="critic-banner nodrag nopan"
            style={{ transform: `translateX(-50%) scale(${inv})` }}
            onClick={(e) => e.stopPropagation()}
          >
            <IconSpark width={11} height={11} />
            <span>{criticOverlayHere.label} · {criticPins.length} pin{criticPins.length === 1 ? "" : "s"}</span>
            {onDismissCritiqueOverlay && (
              <button
                type="button"
                className="critic-banner__hide"
                onClick={() => onDismissCritiqueOverlay()}
                title="Hide ephemeral Critic pins from canvas (Esc)"
              >
                Hide <IconX width={10} height={10} />
              </button>
            )}
          </div>
          {criticPins.map((cp) => {
            const cr = cp.componentId ? rects.find((r) => r.id === cp.componentId) : undefined;
            if (!cr) return null;
            return (
              <div
                key={`cbox-${cp.id}`}
                className={`ov__critic-box${focusedCriticPinId === cp.id ? " is-focused" : ""}`}
                style={{
                  left: `${cr.x * 100}%`,
                  top: `${cr.y * 100}%`,
                  width: `${cr.w * 100}%`,
                  height: `${cr.h * 100}%`,
                }}
              />
            );
          })}
        </>
      )}

      {/* Persistent Designer @Pin-N / @Mask-N Annotations */}
      {notes.map((a, i) => {
        const refLabel = formatVersionedRef(a);
        const resolved = a.status === "resolved";
        return (
          <span
            key={a.id}
            className={`pin pin--${a.kind}${resolved ? " pin--resolved" : ""}`}
            style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: `scale(${inv})` }}
            title={`${refLabel}${a.includeInAiFeedback === false ? " (AI off)" : ""}: ${a.text}`}
          >
            {a.kind === "mask" ? `M${i + 1}` : i + 1}
          </span>
        );
      })}

      {/* Ephemeral Versioned Critic Pins on Freeform Canvas */}
      {criticPins.map((cp, idx) => {
        const cr = cp.componentId ? rects.find((r) => r.id === cp.componentId) : undefined;
        const px = cr ? Math.min(0.94, Math.max(0.06, cr.x + cr.w - 0.04)) : cp.x;
        const py = cr ? Math.min(0.94, Math.max(0.06, cr.y + 0.06)) : cp.y;
        const verTok = formatVersionedRef(cp);
        const isOpenCard = focusedCriticPinId === cp.id;
        return (
          <span key={cp.id}>
            <button
              type="button"
              className={`pin pin--critic pin--critic-${cp.kind}${cp.status === "resolved" ? " pin--resolved" : ""}${isOpenCard ? " is-open" : ""} nodrag nopan`}
              style={{ left: `${px * 100}%`, top: `${py * 100}%`, transform: `scale(${inv})` }}
              title={`${verTok}${cp.componentId ? ` on ${cp.componentId}` : ""}: ${cp.text}`}
              onClick={(e) => {
                e.stopPropagation();
                setFocusedCriticPinId(isOpenCard ? null : cp.id);
              }}
            >
              C{idx + 1}
            </button>
            {isOpenCard && (
              <div
                className="composer composer--critic nodrag nopan nowheel nokeys"
                style={{
                  left: `calc(100% + ${14 * inv}px)`,
                  top: `${Math.min(0.78, Math.max(0.04, py)) * 100}%`,
                  transform: `scale(${inv})`,
                  transformOrigin: "top left",
                  pointerEvents: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="composer__head-critic">
                  <code>{verTok}</code>
                  <span className="badge">{cp.kind}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    style={{ marginLeft: "auto" }}
                    onClick={() => setFocusedCriticPinId(null)}
                    aria-label="Close critic pin"
                  >
                    <IconX width={11} height={11} />
                  </button>
                </div>
                {cp.componentId && (
                  <div className="composer__target">
                    on <code>{cp.componentId}</code>
                  </div>
                )}
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text)" }}>{cp.text}</div>
                {onMentionCritiquePin && (
                  <div className="composer__actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => {
                        onMentionCritiquePin(verTok);
                        setFocusedCriticPinId(null);
                      }}
                    >
                      + Mention {verTok} in Chat
                    </button>
                  </div>
                )}
              </div>
            )}
          </span>
        );
      })}

      {draftHere && <DraftPopover top={draftBox ? draftBox.y : draftHere.y} x={draftHere.x} y={draftHere.y} inv={inv} />}

      {masking && maskPopoverOpen && activeMaskInfo && (
        <MaskPopover
          top={activeMaskInfo.box.y}
          inv={inv}
          intersectingCount={activeMaskInfo.hits.length}
          onCancel={() => {
            setStrokes([]);
            setMaskPopoverOpen(false);
          }}
          onCommit={(text, includeInAi, applyImmediately) => {
            const el = phone();
            const curRects = el ? componentRects(el) : rects;
            const maskDataUrl = renderSpatialMaskSnapshot(curRects, strokes);
            const intersectingIds = [...new Set(activeMaskInfo.hits.map((h) => h.id))];
            commitMask({
              baseScreenId: baseId,
              shownScreenId: shown.id,
              x: activeMaskInfo.box.x + activeMaskInfo.box.w / 2,
              y: activeMaskInfo.box.y + activeMaskInfo.box.h / 2,
              strokes,
              maskBox: activeMaskInfo.box,
              maskDataUrl,
              intersectingIds,
              text,
              includeInAiFeedback: includeInAi,
              applyImmediately,
            });
            setStrokes([]);
            setMaskPopoverOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Comment popover: sits beside the phone (never over it), level with the selected box. */
function DraftPopover({ top, x, y, inv }: { top: number; x: number; y: number; inv: number }) {
  const { draft, graph, cancelDraft, saveDraft, onVoiceUsage, onVoiceError } = useCanvas();
  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const [kind, setKind] = useState<Exclude<AnnotationKind, "mask">>("note");
  const [includeInAi, setIncludeInAi] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const voice = useVoiceInput({
    getCurrentText: () => textRef.current,
    onTextUpdate: setText,
    graph,
    onUsage: onVoiceUsage,
    onError: onVoiceError,
  });

  const zoom = useViewportStore((s) => s.transform[2]);
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
    if (text.trim()) saveDraft(text.trim(), kind, includeInAi);
    else cancelDraft();
  };

  return (
    <>
      <span ref={anchor} className="pin pin--draft" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `scale(${inv})` }} />
      <div
        className={`composer nodrag nopan nowheel nokeys${flip ? " composer--flip" : ""}`}
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
          placeholder="Speak or type feedback…"
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
        <div className="composer__opt">
          <label className="ai-toggle">
            <input type="checkbox" checked={includeInAi} onChange={(e) => setIncludeInAi(e.target.checked)} />
            <span>Include in AI</span>
          </label>
          <VoiceMicButton voice={voice} compact />
        </div>
        <div className="composer__actions">
          <button onClick={cancel}>Cancel</button>
          <button className="is-primary" onClick={submit}>
            Pin {kind}
          </button>
        </div>
      </div>
    </>
  );
}

/** Paint & Speak Mask popover: sits beside the phone after brushing a region. */
function MaskPopover({
  top,
  inv,
  intersectingCount,
  onCancel,
  onCommit,
}: {
  top: number;
  inv: number;
  intersectingCount: number;
  onCancel: () => void;
  onCommit: (text: string, includeInAi: boolean, applyImmediately: boolean) => void;
}) {
  const { graph, onVoiceUsage, onVoiceError } = useCanvas();
  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const [includeInAi, setIncludeInAi] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const voice = useVoiceInput({
    getCurrentText: () => textRef.current,
    onTextUpdate: setText,
    graph,
    onUsage: onVoiceUsage,
    onError: onVoiceError,
  });

  const zoom = useViewportStore((s) => s.transform[2]);
  const anchor = useRef<HTMLSpanElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const ov = anchor.current?.parentElement;
    if (!ov) return;
    const r = ov.getBoundingClientRect();
    const rightEdge = window.innerWidth - (document.querySelector(".rpanel") ? 324 : 16);
    const leftEdge = document.querySelector(".lpanel:not(.is-collapsed)") && window.innerWidth >= 760 ? 364 : 16;
    setFlip(r.right + 290 > rightEdge && r.left - 290 > leftEdge);
  }, [zoom, top]);

  const finish = (applyImmediately: boolean) => {
    if (!text.trim()) return;
    voice.stop();
    onCommit(text.trim(), includeInAi, applyImmediately);
  };

  return (
    <>
      <span ref={anchor} style={{ position: "absolute", left: 0, top: `${top * 100}%` }} />
      <div
        className={`composer composer--mask nodrag nopan nowheel nokeys${flip ? " composer--flip" : ""}`}
        style={{
          ...(flip ? { right: `calc(100% + ${14 * inv}px)` } : { left: `calc(100% + ${14 * inv}px)` }),
          top: `${Math.min(0.75, Math.max(0.04, top)) * 100}%`,
          transform: `scale(${1 / Math.max(zoom, 0.05)})`,
          transformOrigin: flip ? "top right" : "top left",
          pointerEvents: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="composer__head-mask">
          <IconBrush width={13} height={13} />
          <b>Paint &amp; Speak Mask</b>
          <span>{intersectingCount} comp{intersectingCount === 1 ? "" : "s"}</span>
        </div>
        <textarea
          ref={input}
          value={text}
          rows={2}
          placeholder="e.g. Group these into a sticky summary card…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              finish(false);
            }
            if (e.key === "Escape") {
              if (voice.isListening) voice.stop();
              else onCancel();
            }
          }}
        />
        <div className="composer__opt">
          <label className="ai-toggle">
            <input type="checkbox" checked={includeInAi} onChange={(e) => setIncludeInAi(e.target.checked)} />
            <span>Include in AI</span>
          </label>
          <VoiceMicButton voice={voice} compact />
        </div>
        <div className="composer__actions">
          <button
            onClick={() => {
              voice.stop();
              onCancel();
            }}
          >
            Cancel
          </button>
          <button disabled={!text.trim()} onClick={() => finish(false)}>
            Pin Mask
          </button>
          <button className="is-primary is-mask-ai" disabled={!text.trim()} onClick={() => finish(true)}>
            <IconSpark width={11} height={11} /> Apply AI
          </button>
        </div>
      </div>
    </>
  );
}
