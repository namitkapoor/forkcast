import { Fragment, useEffect, useRef, useState } from "react";
import { useViewportStore } from "@xyflow/react";
import type { Tool } from "../canvas/context";
import {
  IconBranch,
  IconBrush,
  IconCheck,
  IconComment,
  IconCursor,
  IconDownload,
  IconFit,
  IconHand,
  IconHelp,
  IconLasso,
  IconMenu,
  IconMinus,
  IconPlay,
  IconPlus,
  IconRedo,
  IconUndo,
  IconX,
} from "./icons";

export type Page = "journeys" | "flow" | "tests";

export interface TopBarProps {
  title: string;
  subtitle: string;
  page: Page;
  onPage: (p: Page) => void;
  onOpenCanvas?: () => void;
  canvasOn?: boolean;
  playTraffic: boolean;
  onPlayTraffic: (v: boolean) => void;
  onPlayMode?: () => void;
  onRunTests: () => void;
  onRun: () => void;
  onExport: () => void;
  onFit: () => void;
  onHelp: () => void;
  onTogglePanel: () => void;
  onClearNotes: () => void;
  /** Journeys page only: a quiet provenance badge on the right ("Real Gemini run"). */
  badge?: string;
  badgeTitle?: string;
  /** Session AI token usage summary shown quietly in the menu. */
  tokenSummary?: string;
  onResetTokens?: () => void;
  /** Extra menu items (data source, seeded bug). Shown on the Advanced pages only. */
  menuItems?: { label: string; fn: () => void }[];
}

export function TopBar(p: TopBarProps) {
  const [menu, setMenu] = useState(false);
  const advanced = p.page !== "journeys";

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
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );

  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="menu-anchor">
          <button className="icon-btn" aria-label="Menu" aria-expanded={menu} onPointerDown={(e) => e.stopPropagation()} onClick={() => setMenu((m) => !m)}>
            <IconMenu />
          </button>
          {menu && (
            <div className="menu" role="menu">
              {advanced ? (
                <>
                  {item("Back to journeys", "", () => p.onPage("journeys"))}
                  <hr />
                  {p.page === "flow" && item("Fit whole flow", "⇧1", p.onFit)}
                  {p.page === "flow" && p.onPlayMode && item("Play walkthrough", "P", p.onPlayMode)}
                  {p.page === "flow" && item("Toggle left panel", "\\", p.onTogglePanel)}
                  {item("Keyboard shortcuts", "?", p.onHelp)}
                  {p.menuItems?.map((m) => <Fragment key={m.label}>{item(m.label, "", m.fn)}</Fragment>)}
                  {item("Clear my annotations", "", p.onClearNotes)}
                  {p.tokenSummary && p.onResetTokens && item(`AI tokens: ${p.tokenSummary} (reset)`, "", p.onResetTokens)}
                  <hr />
                </>
              ) : null}
              <div className="menu__label">Advanced</div>
              {item(p.canvasOn ? "Flow canvas ✓" : "Flow canvas", "", () => (p.onOpenCanvas ? p.onOpenCanvas() : p.onPage("flow")))}
              {item(p.page === "tests" ? "Invariant tests ✓" : "Invariant tests", "", () => p.onPage("tests"))}
            </div>
          )}
        </div>
        <div className="file">
          <span className="file__mark" aria-hidden="true" />
          <span className="file__name">{p.title}</span>
          <span className="file__sub">{p.subtitle}</span>
        </div>
      </div>

      <div className="topbar__mid">
        <nav className="seg" aria-label="Pages">
          {([["journeys", "Journeys"], ["flow", "Flows"], ["tests", "Tests"]] as const).map(([id, label]) => (
            <button key={id} className={p.page === id ? "is-on" : ""} aria-current={p.page === id ? "page" : undefined} onClick={() => p.onPage(id)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="topbar__right">
        {!advanced ? (
          p.badge && (
            <span className="tb-badge" title={p.badgeTitle}>
              <span className="dot dot--pass" aria-hidden="true" />
              <span className="tb-label">{p.badge}</span>
            </span>
          )
        ) : (
          <>
            <button
              className={`switch${p.playTraffic ? " is-on" : ""}`}
              role="switch"
              aria-checked={p.playTraffic}
              onClick={() => p.onPlayTraffic(!p.playTraffic)}
              title="Animate sessions flowing along each transition (T)"
            >
              <span className="switch__track" aria-hidden="true" />
              <span className="tb-label">Play traffic</span>
            </button>
            {p.page === "flow" && p.onPlayMode && (
              <button className="btn btn--ghost" onClick={p.onPlayMode} title="Walk through the live flow interactively (P)">
                <IconPlay width={13} height={13} />
                <span className="tb-label">Play</span>
              </button>
            )}
            <button className="btn btn--ghost" onClick={p.onRunTests} title="Re-run every check over the loaded sessions">
              <IconCheck width={14} height={14} />
              <span className="tb-label">Run tests</span>
            </button>
            <button className="btn btn--ghost" onClick={p.onRun} title="Run a fresh simulation (R)">
              <IconPlay width={13} height={13} />
              <span className="tb-label">Run simulation</span>
            </button>
            <button className="btn btn--primary" onClick={p.onExport} title="Export failing traces and annotations">
              <IconDownload width={14} height={14} />
              <span className="tb-label">Export</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof IconCursor }[] = [
  { id: "select", label: "Select", key: "V", Icon: IconCursor },
  { id: "hand", label: "Hand", key: "H", Icon: IconHand },
  { id: "lasso", label: "Lasso components", key: "L", Icon: IconLasso },
  { id: "annotate", label: "Comment / pin", key: "C", Icon: IconComment },
  { id: "mask", label: "Paint & Speak mask", key: "M", Icon: IconBrush },
  { id: "branch", label: "Branch: what if…", key: "B", Icon: IconBranch },
];

export function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div className="toolbar floating" role="toolbar" aria-label="Tools">
      {TOOLS.map(({ id, label, key, Icon }) => (
        <button key={id} className={`tool${tool === id ? " is-on" : ""}`} aria-pressed={tool === id} aria-label={`${label} (${key})`} data-tool={id} onClick={() => onTool(id)}>
          <Icon width={17} height={17} />
          <span className="tool__tip">
            {label} <span className="kbd">{key}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function Dock(p: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onIn: () => void; onOut: () => void; onFit: () => void; onHelp: () => void }) {
  const zoom = useViewportStore((s) => s.transform[2]);
  return (
    <div className="dock floating">
      <button className="icon-btn icon-btn--sm" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo (⌘Z)" title="Undo (⌘Z)">
        <IconUndo width={15} height={15} />
      </button>
      <button className="icon-btn icon-btn--sm" onClick={p.onRedo} disabled={!p.canRedo} aria-label="Redo (⇧⌘Z)" title="Redo (⇧⌘Z)">
        <IconRedo width={15} height={15} />
      </button>
      <span className="dock__sep" />
      <button className="icon-btn icon-btn--sm" onClick={p.onOut} aria-label="Zoom out (−)">
        <IconMinus width={14} height={14} />
      </button>
      <button className="dock__zoom" onClick={p.onFit} title="Fit (⇧1)">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn icon-btn--sm" onClick={p.onIn} aria-label="Zoom in (+)">
        <IconPlus width={14} height={14} />
      </button>
      <button className="icon-btn icon-btn--sm" onClick={p.onFit} aria-label="Fit whole flow">
        <IconFit width={14} height={14} />
      </button>
      <button className="icon-btn icon-btn--sm" onClick={p.onHelp} aria-label="Keyboard shortcuts (?)">
        <IconHelp width={15} height={15} />
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["V", "Select"],
  ["H  or hold Space", "Hand / pan"],
  ["L", "Lasso components on the selected screen"],
  ["C  or A", "Comment / pin: click a component to pin @Pin-N"],
  ["M", "Paint & Speak region mask (@Mask-N)"],
  ["B", "Branch from the selected screen"],
  ["P", "Play interactive flow walkthrough"],
  ["+ / −", "Zoom in / out"],
  ["⇧1", "Fit whole flow"],
  ["⇧2", "Zoom to selection"],
  ["0", "Zoom to 100%"],
  ["T", "Play traffic"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["1 – 9", "Jump to step"],
  ["Enter", "Open selected screen up close"],
  ["R", "Re-run simulation"],
  ["\\", "Toggle left panel"],
  ["Esc", "Clear lasso / mask / selection / cancel"],
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
          Each column is a step; each phone is a real generated screen. Zoom in on a selected screen to pick components, pin notes, or paint masks.
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
