import { useMemo, useState } from "react";
import type { FlowGraph } from "../graph/types";
import type { Screen } from "../a2ui/types";
import type { Picks, Selection } from "../canvas/context";
import { componentTree, type TreeNode } from "../a2ui/tree";
import { setHover, useHover } from "../canvas/hoverStore";
import { IconBox, IconButton, IconChevron, IconCols, IconDevice, IconImage, IconInput, IconRows, IconStep, IconText } from "./icons";

// Figma-style layers: Steps → screens (by traveler context) → the selected screen's A2UI
// component tree. Hovering a component row outlines it on the canvas; clicking picks it.

export interface LayersProps {
  graph: FlowGraph;
  screensByNode: Map<string, Screen[]>;
  failing: Set<string>;
  selection: Selection;
  picks: Picks | null;
  shown: (s: Screen) => Screen;
  onSelectNode: (id: string) => void;
  onSelectScreen: (id: string, nodeId: string) => void;
  onPick: (screenId: string, node: TreeNode, additive: boolean) => void;
}

const typeIcon = (t: string) =>
  t === "Text" ? IconText : t === "Button" ? IconButton : t === "Row" ? IconCols : t === "Column" || t === "List" ? IconRows : t === "Image" || t === "Icon" ? IconImage : /Field|Picker|CheckBox|Slider|DateTime/.test(t) ? IconInput : IconBox;

export function Layers(p: LayersProps) {
  const activeNode = p.selection.kind === "node" ? p.selection.id : p.selection.kind === "screen" ? p.selection.nodeId : null;
  const activeScreen = p.selection.kind === "screen" ? p.selection.id : null;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string, dflt: boolean) => open[id] ?? dflt;
  const toggle = (id: string, dflt: boolean) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? dflt) }));

  return (
    <div className="layers" onPointerLeave={() => setHover(null)}>
      <div className="layers__title">Steps</div>
      {p.graph.nodes.map((n) => {
        const screens = p.screensByNode.get(n.id) ?? [];
        const nodeOpen = isOpen(n.id, n.id === activeNode);
        return (
          <div key={n.id}>
            <button className={`layer${p.selection.kind === "node" && p.selection.id === n.id ? " is-selected" : ""}`} onClick={() => p.onSelectNode(n.id)} style={{ paddingLeft: 4 }}>
              <span
                className="layer__caret"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(n.id, n.id === activeNode);
                }}
              >
                <IconChevron width={11} height={11} style={{ transform: nodeOpen ? "rotate(90deg)" : undefined }} />
              </span>
              <IconStep width={13} height={13} className="layer__icon" />
              <span className="layer__name">{n.label}</span>
              {p.failing.has(n.id) && <span className="layer__dot" aria-label="failing" />}
              <span className="layer__meta">{screens.length}</span>
            </button>
            {nodeOpen &&
              screens.map((s) => (
                <ScreenLayer key={s.id} {...p} screen={s} active={s.id === activeScreen} open={isOpen(s.id, s.id === activeScreen)} onToggle={() => toggle(s.id, s.id === activeScreen)} />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function ScreenLayer(p: LayersProps & { screen: Screen; active: boolean; open: boolean; onToggle: () => void }) {
  const shown = p.shown(p.screen);
  const tree = useMemo(() => (p.open ? componentTree(shown.messages) : null), [p.open, shown.messages]);
  const label = Object.values(p.screen.context).filter((v) => !v.includes("→")).join(" · ") || shown.variant;
  return (
    <>
      <button className={`layer${p.active && !(p.picks?.screenId === p.screen.id && p.picks.items.length) ? " is-selected" : ""}`} style={{ paddingLeft: 20 }} onClick={() => p.onSelectScreen(p.screen.id, p.screen.nodeId)} title={shown.variant}>
        <span
          className="layer__caret"
          onClick={(e) => {
            e.stopPropagation();
            p.onToggle();
          }}
        >
          <IconChevron width={11} height={11} style={{ transform: p.open ? "rotate(90deg)" : undefined }} />
        </span>
        <IconDevice width={13} height={13} className="layer__icon" />
        <span className="layer__name">{label}</span>
        {shown !== p.screen && <span className="scr__ver">{shown.id.split("@")[1]}</span>}
      </button>
      {p.open && tree && <TreeRows node={tree} screenId={p.screen.id} {...p} />}
    </>
  );
}

function TreeRows(p: LayersProps & { node: TreeNode; screenId: string }) {
  const hover = useHover();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const rows: { n: TreeNode; hidden: boolean }[] = [];
  const walk = (n: TreeNode, hidden: boolean) => {
    rows.push({ n, hidden });
    n.children.forEach((c) => walk(c, hidden || closed.has(n.id)));
  };
  walk(p.node, false);
  const picked = new Set(p.picks?.screenId === p.screenId ? p.picks.items.map((i) => i.id) : []);
  return (
    <>
      {rows
        .filter((r) => !r.hidden)
        .map(({ n }) => {
          const Icon = typeIcon(n.type);
          const isHover = hover?.screenId === p.screenId && hover.id === n.id;
          return (
            <button
              key={`${n.id}-${n.depth}`}
              className={`layer${picked.has(n.id) ? " is-selected" : ""}${isHover ? " is-hover" : ""}`}
              style={{ paddingLeft: 36 + Math.min(n.depth, 8) * 12 }}
              onPointerEnter={() => setHover({ screenId: p.screenId, id: n.id })}
              onClick={(e) => p.onPick(p.screenId, n, e.shiftKey)}
              title={`${n.type} · ${n.id}`}
              data-layer={n.id}
            >
              <span
                className="layer__caret"
                onClick={(e) => {
                  if (!n.children.length) return;
                  e.stopPropagation();
                  setClosed((c) => {
                    const x = new Set(c);
                    if (x.has(n.id)) x.delete(n.id);
                    else x.add(n.id);
                    return x;
                  });
                }}
              >
                {n.children.length > 0 && <IconChevron width={10} height={10} style={{ transform: closed.has(n.id) ? undefined : "rotate(90deg)" }} />}
              </span>
              <Icon width={12} height={12} className="layer__icon" />
              <span className="layer__name">{n.label !== n.type ? n.label : n.id}</span>
              <span className="layer__meta">{n.template ? `${n.type} · each` : n.type}</span>
            </button>
          );
        })}
    </>
  );
}
