import { useEffect, useRef, useState } from "react";
import { useViewportStore } from "@xyflow/react";
import type { StateNode } from "../graph/types";
import type { Tool } from "../canvas/context";
import { zoomLevel } from "../canvas/zoom";
import {
  IconBranch,
  IconCursor,
  IconDownload,
  IconFit,
  IconHand,
  IconHelp,
  IconMenu,
  IconMinus,
  IconPin,
  IconPlay,
  IconPlus,
  IconX,
} from "./icons";

export interface TopBarProps {
  title: string;
  subtitle: string;
  nodes: StateNode[];
  activeNode?: string;
  failing: Set<string>;
  onTab: (id: string) => void;
  onRun: () => void;
  onExport: () => void;
  onFit: () => void;
  onHelp: () => void;
  onTogglePanel: () => void;
  onClearNotes: () => void;
}

export function TopBar(p: TopBarProps) {
  const [menu, setMenu] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.activeNode) return;
    const el = tabs.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(p.activeNode)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [p.activeNode]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const item = (label: string, kbd: string, fn: () => void) => (
    <button
      role="menuitem"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        setMenu(false);
        fn();
      }}
    >
      <span>{label}</span>
      <span className="kbd">{kbd}</span>
    </button>
  );

  return (
    <header className="topbar">
      <div className="topbar__left floating">
        <div className="menu-anchor">
          <button className="icon-btn" aria-label="Menu" aria-expanded={menu} onPointerDown={(e) => e.stopPropagation()} onClick={() => setMenu((m) => !m)}>
            <IconMenu />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <div className="menu__brand">Forkcast</div>
              {item("Fit whole flow", "⇧1", p.onFit)}
              {item("Toggle inspector", "\\", p.onTogglePanel)}
              {item("Keyboard shortcuts", "?", p.onHelp)}
              {item("Clear my annotations", "", p.onClearNotes)}
            </div>
          )}
        </div>
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div className="brand__text">
            <div className="brand__title">{p.title}</div>
            <div className="brand__sub">{p.subtitle}</div>
          </div>
        </div>
      </div>

      <nav className="tabs floating" aria-label="States" ref={tabs}>
        {p.nodes.map((n) => (
          <button
            key={n.id}
            data-tab={n.id}
            className={`tab${p.activeNode === n.id ? " is-active" : ""}`}
            onClick={() => p.onTab(n.id)}
            aria-current={p.activeNode === n.id ? "true" : undefined}
          >
            {p.failing.has(n.id) && <span className="tab__dot" aria-label="failing" />}
            {n.label}
          </button>
        ))}
      </nav>

      <div className="topbar__right">
        <button className="pill" onClick={p.onRun} title="Run simulation (R)">
          <IconPlay width={13} height={13} />
          <span className="pill__text">Run simulation</span>
        </button>
        <button className="pill pill--accent" onClick={p.onExport} title="Export failing traces and annotations">
          <IconDownload width={14} height={14} />
          <span className="pill__text">Export</span>
        </button>
      </div>
    </header>
  );
}

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof IconCursor }[] = [
  { id: "select", label: "Select", key: "V", Icon: IconCursor },
  { id: "hand", label: "Hand", key: "H", Icon: IconHand },
  { id: "annotate", label: "Annotate", key: "A", Icon: IconPin },
  { id: "branch", label: "Branch", key: "B", Icon: IconBranch },
];

export function ToolRail({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div className="rail floating" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map(({ id, label, key, Icon }) => (
        <button
          key={id}
          className={`rail__btn${tool === id ? " is-active" : ""}`}
          aria-pressed={tool === id}
          aria-label={`${label} (${key})`}
          onClick={() => onTool(id)}
        >
          <Icon />
          <span className="rail__tip">
            {label} <span className="kbd">{key}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function ZoomPill(p: { onIn: () => void; onOut: () => void; onFit: () => void; onHelp: () => void }) {
  const zoom = useViewportStore((s) => s.transform[2]);
  const level = zoomLevel(zoom);
  return (
    <div className="zoom-dock">
      <div className="zoom floating">
        <button className="icon-btn icon-btn--sm" onClick={p.onOut} aria-label="Zoom out (−)">
          <IconMinus width={14} height={14} />
        </button>
        <button className="zoom__value" onClick={p.onFit} title="Fit (⇧1)">
          {Math.round(zoom * 100)}%<span className={`zoom__level zoom__level--${level}`}>{level}</span>
        </button>
        <button className="icon-btn icon-btn--sm" onClick={p.onIn} aria-label="Zoom in (+)">
          <IconPlus width={14} height={14} />
        </button>
        <span className="zoom__sep" />
        <button className="icon-btn icon-btn--sm" onClick={p.onFit} aria-label="Fit whole flow">
          <IconFit width={14} height={14} />
        </button>
      </div>
      <button className="help-btn floating" onClick={p.onHelp} aria-label="Keyboard shortcuts (?)">
        <IconHelp />
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["V", "Select"],
  ["H  or hold Space", "Hand / pan"],
  ["A", "Annotate: click a screen to pin a note"],
  ["B", "Branch from the selected screen"],
  ["+ / −", "Zoom in / out"],
  ["⇧1", "Fit whole flow"],
  ["⇧2", "Zoom to selection"],
  ["0", "Zoom to 100%"],
  ["1 – 9", "Jump to state tab"],
  ["Enter", "Open selected screen up close"],
  ["R", "Re-run simulation"],
  ["\\", "Toggle inspector"],
  ["Esc", "Clear selection / cancel"],
  ["?", "This panel"],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="help floating" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </header>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                {k.split("  ").map((part) => (
                  <span className="kbd" key={part}>
                    {part}
                  </span>
                ))}
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">
          Zoom out for the decision tree, in for each state's screens, and further in to use a screen live. Scroll to pan, pinch or ⌘/Ctrl-scroll to zoom.
        </p>
      </div>
    </div>
  );
}

export interface Toast {
  id: number;
  tone: "info" | "ok" | "error";
  title: string;
  body?: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <div className="toast__text">
            <b>{t.title}</b>
            {t.body && <span>{t.body}</span>}
          </div>
          <button className="icon-btn icon-btn--sm" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <IconX width={12} height={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
