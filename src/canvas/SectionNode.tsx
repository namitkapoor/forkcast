import { memo, useCallback, useRef, type MouseEvent, type PointerEvent } from "react";
import { Handle, Position, useViewportStore, type Node, type NodeProps } from "@xyflow/react";
import type { StateNode } from "../graph/types";
import type { NodeStats } from "../graph/fold";
import type { Screen } from "../a2ui/types";
import { ScreenFrame } from "../a2ui/ScreenFrame";
import { componentIdFromEvent } from "../a2ui/componentId";
import { componentRects } from "../a2ui/componentRects";
import { useCanvas, type Picked } from "./context";
import { setHover } from "./hoverStore";
import { ScreenOverlay } from "./ScreenOverlay";
import { COL_GAP, MORE_H, THUMB_H, THUMB_W, slotOffset, visibleScreens, type SectionSize } from "./geometry";
import { IconDevice, IconPerson } from "../ui/icons";

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

/** Screens become interactive (hover boxes, picking, lasso) once they're this large on screen. */
export const LIVE_ZOOM = 0.7;

const useZoom = () => useViewportStore((s) => Math.max(0.05, s.transform[2]));

function SectionNodeView({ data }: NodeProps<SectionFlowNode>) {
  const zoom = useZoom();
  const inv = 1 / zoom;
  const { selection, selectNode } = useCanvas();
  const { state, stats, failing, edgeFailing, screens, size, isBranch } = data;
  const nodeSelected =
    (selection.kind === "node" && selection.id === state.id) || (selection.kind === "screen" && selection.nodeId === state.id);
  const risky = failing || edgeFailing;
  const cls = ["step", nodeSelected && "is-selected", risky && "is-failing", isBranch && "is-branch"].filter(Boolean).join(" ");

  return (
    <div className={cls} style={{ width: size.w, height: size.h, ["--inv" as string]: inv }} data-node={state.id}>
      <div className="step__bg" />
      <Handle type="target" position={Position.Left} isConnectable={false} className="sec__handle" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="sec__handle" />
      <div
        className="step__head"
        style={{ transform: `scale(${inv})`, maxWidth: Math.max(60, (size.w + COL_GAP * 0.8) * zoom) }}
        onClick={(e) => {
          e.stopPropagation();
          selectNode(state.id);
        }}
        title={`${state.label} · ${stats.traces} sessions reached this step`}
      >
        <span className="step__label">{state.label}</span>
        <span className="step__reach">
          <IconPerson width={12} height={12} className="person" />
          {stats.traces.toLocaleString()} reached
        </span>
        {isBranch && <span className="badge badge--branch">branch</span>}
        {risky && <span className="step__fail">{failing ? "invariant" : "contract"}</span>}
      </div>
      <Slots screens={screens} nodeId={state.id} stats={stats} size={size} zoom={zoom} />
    </div>
  );
}

export const SectionNode = memo(SectionNodeView);

function Slots({ screens, nodeId, stats, size, zoom }: { screens: Screen[]; nodeId: string; stats: NodeStats; size: SectionSize; zoom: number }) {
  const { selection, selectNode } = useCanvas();
  const selectedId = selection.kind === "screen" ? selection.id : undefined;
  const { shown, more } = visibleScreens(screens, selectedId);

  if (!screens.length) {
    const sample = stats.samples[0];
    const o = slotOffset(size, 0);
    return (
      <div className="scr-wrap" style={{ left: o.x, top: o.y }}>
        <div className="ghost" style={{ width: THUMB_W, height: THUMB_H }}>
          <div className="ghost__title">No rendering recorded · props seen here</div>
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
    );
  }

  const last = slotOffset(size, shown.length - 1);
  return (
    <>
      {shown.map((s, i) => {
        const o = slotOffset(size, i);
        return (
          <div className="scr-wrap" key={s.id} style={{ left: o.x, top: o.y - 22 }}>
            <Slot screen={s} nodeId={nodeId} live={zoom >= LIVE_ZOOM && s.id === selectedId} selected={s.id === selectedId} zoom={zoom} />
          </div>
        );
      })}
      {more > 0 && (
        <button
          className="scr__more"
          style={{ left: last.x, width: THUMB_W, top: last.y + THUMB_H + (MORE_H - 36) / 2 }}
          onClick={(e) => {
            e.stopPropagation();
            selectNode(nodeId);
          }}
        >
          +{more} more screens
        </button>
      )}
    </>
  );
}

function Slot({ screen, nodeId, live, selected, zoom }: { screen: Screen; nodeId: string; live: boolean; selected: boolean; zoom: number }) {
  const { tool, picks, shown: shownOf, selectScreen, setPicks, startDraft, onScreenAction } = useCanvas();
  const shown = shownOf(screen);
  const ref = useRef<HTMLDivElement>(null);
  const inv = 1 / zoom;
  const picking = live && (tool === "select" || tool === "annotate" || tool === "branch");
  const phone = useCallback(() => ref.current?.querySelector<HTMLElement>(".fc-phone") ?? null, []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (tool === "hand") return;
    if (!live) {
      selectScreen(screen.id, nodeId, { focus: tool === "lasso" || tool === "annotate" || e.detail > 1 });
      return;
    }
    // Live: component clicks are handled by ScreenFrame; a click on empty screen area clears picks.
    if (tool === "select" && picks?.screenId === screen.id && !(e.target as Element).closest?.(".fc-phone__content *")) setPicks(null);
  };

  const describe = (id: string): Picked => {
    const el = phone();
    const r = el ? componentRects(el).find((x) => x.id === id) : undefined;
    return { id, type: r?.type ?? "Component", label: r?.label ?? id };
  };

  const onComponentClick = (id: string, rel: { x: number; y: number }, mods: { shiftKey: boolean }) => {
    const item = describe(id);
    if (tool === "annotate") {
      setPicks({ screenId: screen.id, items: [item] });
      startDraft({ screenId: shown.id, x: clamp01(rel.x), y: clamp01(rel.y), componentId: id });
      return;
    }
    if (mods.shiftKey && picks?.screenId === screen.id && !picks.lasso) {
      const has = picks.items.some((p) => p.id === id);
      const items = has ? picks.items.filter((p) => p.id !== id) : [...picks.items, item];
      setPicks(items.length ? { screenId: screen.id, items } : null);
    } else {
      setPicks({ screenId: screen.id, items: [item] });
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!picking) return;
    const el = phone();
    const id = el ? componentIdFromEvent(e.nativeEvent, el) : undefined;
    setHover(id ? { screenId: screen.id, id } : null);
  };

  return (
    <>
      <div
        className={`scr__cap${selected ? " is-selected" : ""}`}
        style={{ transform: `scale(${inv})`, width: THUMB_W * zoom }}
        onClick={(e) => {
          e.stopPropagation();
          selectScreen(screen.id, nodeId);
        }}
        title={`${shown.variant} · ${Object.values(screen.context).join(" · ")}`}
      >
        <IconDevice width={12} height={12} />
        <span>{captionOf(screen) || shown.variant}</span>
        {shown !== screen && <span className="scr__ver">{shown.id.split("@")[1] ?? "v2"}</span>}
      </div>
      <div
        ref={ref}
        className={`scr${selected ? " is-selected" : ""}${live ? " is-live nodrag nopan nowheel" : " is-thumb"}`}
        style={{ width: THUMB_W, height: THUMB_H }}
        onClick={onClick}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        data-screen={screen.id}
      >
        <ScreenFrame
          screen={shown}
          mode={live ? "live" : "thumb"}
          width={THUMB_W}
          onAction={live ? (a) => onScreenAction(screen.id, a) : undefined}
          annotate={picking}
          onComponentClick={picking ? onComponentClick : undefined}
        />
        {selected && <ScreenOverlay baseId={screen.id} nodeId={nodeId} shown={shown} live={live} phone={phone} zoom={zoom} />}
      </div>
    </>
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Frame label: who this rendering is for (party · surface · currency), like a Stitch frame name. */
function captionOf(s: Screen): string {
  const c = s.context;
  const parts = [c.party, c.surface, c.currency].filter(Boolean);
  const tag = s.id.includes("--repriced") ? "repriced" : s.id.includes("--drift") ? "drift" : "";
  return [...(parts.length ? parts : Object.values(c).filter((v) => !v.includes("→"))), tag].filter(Boolean).join(" · ");
}
