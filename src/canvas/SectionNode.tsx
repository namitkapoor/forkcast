import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import { Handle, Position, useViewportStore, type Node, type NodeProps } from "@xyflow/react";
import type { StateNode } from "../graph/types";
import type { NodeStats } from "../graph/fold";
import type { Annotation, Screen } from "../a2ui/types";
import { ScreenFrame } from "../a2ui/ScreenFrame";
import { useZoomLevel } from "./zoom";
import { prefersReducedMotion } from "../ui/storage";
import { useCanvas } from "./context";
import { THUMB_H, THUMB_W, visibleScreens, type SectionSize } from "./geometry";

export type SectionData = {
  state: StateNode;
  stats: NodeStats;
  /** An invariant failed on this node. */
  failing: boolean;
  /** A contract failed on an edge touching this node. */
  edgeFailing: boolean;
  reach: number;
  completion: number;
  screens: Screen[];
  size: SectionSize;
  depth: number;
  isBranch: boolean;
};

export type SectionFlowNode = Node<SectionData, "section">;

function SectionNodeView({ data }: NodeProps<SectionFlowNode>) {
  const level = useZoomLevel();
  const { selection } = useCanvas();
  const { state, stats, failing, edgeFailing, reach, completion, screens, size, depth, isBranch } = data;
  const nodeSelected =
    (selection.kind === "node" && selection.id === state.id) || (selection.kind === "screen" && selection.nodeId === state.id);
  const risky = failing || edgeFailing;
  const fresh = useFirstAppearance(drawnNodes, state.id, (isBranch ? 0 : depth * 0.12) + 2.4);
  const cls = ["sec", `sec--${level}`, nodeSelected && "is-selected", risky && "is-failing", isBranch && "is-branch", fresh && "is-drawing"]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      style={{ width: size.w, height: size.h, ["--d" as string]: `${isBranch ? 0 : depth * 0.12}s` }}
      data-node={state.id}
    >
      <span className="wf wf--top" aria-hidden="true" />
      <span className="wf wf--right" aria-hidden="true" />
      <span className="wf wf--bottom" aria-hidden="true" />
      <span className="wf wf--left" aria-hidden="true" />
      <Handle type="target" position={Position.Left} isConnectable={false} className="sec__handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="sec__handle" />

      {level === "far" ? (
        <div className="tile">
          <div className="tile__top">
            <span className="tile__step">{isBranch ? "branch" : `step ${depth + 1}`}</span>
            {state.acts && <span className="tile__acts">commits</span>}
            {risky && <span className="tile__dot" aria-label="failing checks" />}
          </div>
          <div className="tile__label">{state.label}</div>
          <div className="tile__component">{state.component}</div>
          <div className="tile__reach">
            <b>{reach}%</b>
            <span>reach</span>
          </div>
          <div className="tile__bar">
            <i style={{ width: `${Math.max(reach, reach ? 2 : 0)}%` }} />
          </div>
          <div className="tile__screens">
            {screens.length ? `${screens.length} screen${screens.length === 1 ? "" : "s"}` : "no screens yet"}
          </div>
        </div>
      ) : (
        <>
          <div className="sec__head">
            <span className="sec__label">{state.label}</span>
            {state.acts && <span className="badge badge--acts">commits</span>}
            {isBranch && <span className="badge badge--branch">branch</span>}
            {risky && <span className="badge badge--bad">{failing ? "invariant failing" : "contract failing"}</span>}
            <span className="sec__count">{screens.length || "no"} screen{screens.length === 1 ? "" : "s"}</span>
          </div>
          <div className="sec__frame">
            <Slots screens={screens} nodeId={state.id} stats={stats} level={level} />
            <div className="sec__foot">
              <span>
                <b>{reach}%</b> reach
              </span>
              <span>
                <b>{stats.visits.toLocaleString()}</b> visits
              </span>
              <span>
                <b>{completion}%</b> complete
              </span>
              <span className="sec__component">{state.component}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const SectionNode = memo(SectionNodeView);

function Slots({
  screens,
  nodeId,
  stats,
  level,
}: {
  screens: Screen[];
  nodeId: string;
  stats: NodeStats;
  level: "mid" | "near";
}) {
  const { selection } = useCanvas();
  const selectedId = selection.kind === "screen" ? selection.id : undefined;
  const { shown, more } = visibleScreens(screens, selectedId);

  if (!screens.length) {
    const sample = stats.samples[0];
    return (
      <div className="sec__row">
        <div className="slot-wrap">
          <div className="slot__cap">no rendering recorded</div>
          <div className="ghost" style={{ width: THUMB_W, height: THUMB_H }}>
            <div className="ghost__notch" />
            <div className="ghost__title">props seen here</div>
            {sample ? (
              <dl className="ghost__props">
                {Object.entries(sample)
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="ghost__empty">No traffic yet. Generate a screen or run a simulation.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sec__row">
      {shown.map((s, i) => {
        const isLast = i === shown.length - 1 && more > 0;
        return (
          <div className="slot-wrap" key={s.id}>
            <div className={`slot__cap${s.id === selectedId ? " is-selected" : ""}`} title={s.variant}>
              {s.variant}
            </div>
            <Slot screen={s} nodeId={nodeId} live={level === "near" && s.id === selectedId} />
            {isLast && (
              <div className="slot__more" aria-label={`${more} more screens`}>
                +{more} more
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const NO_ANNOTATIONS: Annotation[] = [];

function Slot({ screen, nodeId, live }: { screen: Screen; nodeId: string; live: boolean }) {
  const { selection, tool, annotations, draft, selectScreen, startDraft, onScreenAction } = useCanvas();
  const selected = selection.kind === "screen" && selection.id === screen.id;
  const pins = annotations[screen.id] ?? NO_ANNOTATIONS;
  const componentClickAt = useRef(0);
  const ref = useRef<HTMLDivElement>(null);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (tool === "hand") return;
    if (tool === "annotate") {
      if (Date.now() - componentClickAt.current < 80) return; // renderer already reported the component
      const r = ref.current!.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (!selected) selectScreen(screen.id, nodeId, { focus: !live });
      startDraft({ screenId: screen.id, x: clamp01(x), y: clamp01(y) });
      return;
    }
    selectScreen(screen.id, nodeId);
  };

  const onDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    selectScreen(screen.id, nodeId, { focus: true });
  };

  return (
    <div
      ref={ref}
      className={`slot${selected ? " is-selected" : ""}${live ? " is-live nodrag nopan nowheel" : " is-thumb"}${tool === "annotate" ? " is-annotating" : ""}`}
      style={{ width: THUMB_W, height: THUMB_H }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      data-screen={screen.id}
    >
      <ScreenFrame
        screen={screen}
        mode={live ? "live" : "thumb"}
        width={THUMB_W}
        onAction={live ? (a) => onScreenAction(screen.id, a) : undefined}
        annotate={live && tool === "annotate"}
        onComponentClick={
          live && tool === "annotate"
            ? (componentId, rel) => {
                componentClickAt.current = Date.now();
                startDraft({ screenId: screen.id, x: clamp01(rel.x), y: clamp01(rel.y), componentId });
              }
            : undefined
        }
      />
      {pins.length > 0 && <Pins pins={pins} />}
      {draft?.screenId === screen.id && <Composer />}
    </div>
  );
}

/** Pins and the composer keep a constant on-screen size whatever the canvas zoom. */
const useInverseZoom = () => useViewportStore((st) => 1 / Math.max(0.05, st.transform[2]));

function Pins({ pins }: { pins: Annotation[] }) {
  const inv = useInverseZoom();
  return (
    <>
      {pins.map((a, i) => (
        <span
          key={a.id}
          className={`pin pin--${a.kind}`}
          style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: `scale(${inv})` }}
          title={a.text}
        >
          {i + 1}
        </span>
      ))}
    </>
  );
}

function Composer() {
  const { draft, cancelDraft, saveDraft } = useCanvas();
  const inv = useInverseZoom();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Annotation["kind"]>("note");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  if (!draft) return null;
  const flipX = draft.x > 0.5;
  const style = {
    transform: `scale(${inv})`,
    transformOrigin: flipX ? "top right" : "top left",
    top: `${draft.y * 100}%`,
    ...(flipX ? { right: `${(1 - draft.x) * 100}%` } : { left: `${draft.x * 100}%` }),
  };
  const submit = () => (text.trim() ? saveDraft(text.trim(), kind) : cancelDraft());
  return (
    <>
      <span className="pin pin--draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, transform: `scale(${inv})` }} />
      <div
        className={`composer nodrag nopan nowheel nokeys${flipX ? " composer--left" : ""}`}
        style={style}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="composer__kinds" role="radiogroup" aria-label="Annotation type">
          {(["note", "bug", "rule"] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
        {draft.componentId && <div className="composer__target">on {draft.componentId}</div>}
        <textarea
          ref={input}
          value={text}
          rows={2}
          placeholder="Wrong price shown…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") cancelDraft();
          }}
        />
        <div className="composer__actions">
          <button onClick={cancelDraft}>Cancel</button>
          <button className="is-primary" onClick={submit}>
            Pin note
          </button>
        </div>
      </div>
    </>
  );
}

/** Ids whose entrance animation already ran, so remounts (zoom changes, re-runs) don't replay it. */
const drawnNodes = new Set<string>();

/** True only for the first mount of this id in the session, and never under reduced motion. */
export function useFirstAppearance(registry: Set<string>, id: string, seconds: number): boolean {
  const [fresh, setFresh] = useState(() => !registry.has(id) && !prefersReducedMotion());
  useEffect(() => {
    registry.add(id);
    if (!fresh) return;
    const t = window.setTimeout(() => setFresh(false), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [registry, id, fresh, seconds]);
  return fresh;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

