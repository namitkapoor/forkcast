import { useMemo, useState } from "react";
import type { Screen } from "../a2ui/types";
import type { FlowGraph } from "../graph/types";
import { formatVersionedRef } from "./annotations";
import type { ChatMsg } from "./Chat";
import { ensureCritiqueVersionedPins, type CritiqueRecord, type HistoryEvent } from "./history";
import {
  IconBranch,
  IconBrush,
  IconChat,
  IconDevice,
  IconDownload,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconHistory,
  IconPin,
  IconPlay,
  IconSpark,
  IconStep,
  IconUndo,
} from "./icons";

export interface HistoryPanelProps {
  graph: FlowGraph;
  screenById: Map<string, Screen>;
  chats: Record<string, ChatMsg[]>;
  critiques: CritiqueRecord[];
  activeCritiqueId: string | null;
  events: HistoryEvent[];
  activeChatKey: string;
  onOpenChatThread: (chatKey: string) => void;
  onToggleCritiqueOnCanvas: (rec: CritiqueRecord) => void;
  onEditCritiquePin: (critiqueId: string, pinId: string, nextText: string) => void;
  onRestoreCritiquePinRevision: (critiqueId: string, pinId: string, revisionId: string) => void;
  onMentionInChat: (token: string) => void;
  onOpenEvent: (ev: HistoryEvent) => void;
  onExportHistory: () => void;
}

type FilterTab = "all" | "critiques" | "chats" | "activity";

function formatAgo(ts: number): string {
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function HistoryPanel(p: HistoryPanelProps) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [editingPinKey, setEditingPinKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [expandedRevKey, setExpandedRevKey] = useState<string | null>(null);

  const labelOf = useMemo(() => {
    const m = new Map(p.graph.nodes.map((n) => [n.id, n.label]));
    return (id: string) => m.get(id) ?? id;
  }, [p.graph.nodes]);

  const describeChatKey = (key: string): { scope: string; title: string; sub: string } => {
    if (key === "run") return { scope: "Run", title: "Whole run", sub: "Global run Q&A" };
    if (key.startsWith("node:")) {
      const nid = key.slice(5);
      return { scope: "Step", title: labelOf(nid), sub: `@${nid}` };
    }
    if (key.startsWith("edge:")) {
      const ek = key.slice(5);
      return { scope: "Transition", title: ek.split("->").map(labelOf).join(" → "), sub: ek };
    }
    const baseId = key.split("@")[0];
    const scr = p.screenById.get(baseId);
    if (scr) {
      const ctx = [scr.context.party, scr.context.surface, scr.context.currency].filter(Boolean).join(" · ");
      return { scope: "Screen", title: `${labelOf(scr.nodeId)} · ${scr.variant}`, sub: ctx || baseId };
    }
    return { scope: "Screen", title: key, sub: "Saved screen thread" };
  };

  const q = query.trim().toLowerCase();

  const threads = useMemo(() => {
    return Object.entries(p.chats)
      .filter(([, msgs]) => msgs.length > 0)
      .map(([key, msgs]) => {
        const last = msgs[msgs.length - 1];
        const meta = describeChatKey(key);
        return { key, msgs, lastAt: last?.at ?? 0, last, ...meta };
      })
      .filter((t) => {
        if (!q) return true;
        if (t.title.toLowerCase().includes(q) || t.sub.toLowerCase().includes(q)) return true;
        return t.msgs.some((m) => m.text.toLowerCase().includes(q) || m.chips?.some((c) => c.toLowerCase().includes(q)));
      })
      .sort((a, b) => b.lastAt - a.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.chats, p.screenById, labelOf, q]);

  const critiques = useMemo(() => {
    return p.critiques
      .map(ensureCritiqueVersionedPins)
      .filter((c) => {
        if (!q) return true;
        return (
          c.nodeLabel.toLowerCase().includes(q) ||
          c.variant.toLowerCase().includes(q) ||
          c.report.summary.toLowerCase().includes(q) ||
          (c.versionedPins ?? []).some(
            (pin) => pin.text.toLowerCase().includes(q) || formatVersionedRef(pin).toLowerCase().includes(q),
          )
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [p.critiques, q]);

  const activities = useMemo(() => {
    return [...p.events]
      .filter((ev) => {
        if (!q) return true;
        return (
          ev.title.toLowerCase().includes(q) ||
          (ev.detail?.toLowerCase().includes(q) ?? false) ||
          (ev.chips?.some((c) => c.toLowerCase().includes(q)) ?? false)
        );
      })
      .sort((a, b) => b.at - a.at);
  }, [p.events, q]);

  const totalCount = threads.length + critiques.length + activities.length;

  return (
    <div className="hist">
      <div className="hist__top">
        <div className="seg hist__tabs" role="tablist" aria-label="History filter">
          <button role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
            All
          </button>
          <button role="tab" aria-selected={filter === "critiques"} className={filter === "critiques" ? "is-on" : ""} onClick={() => setFilter("critiques")}>
            Critiques ({p.critiques.length})
          </button>
          <button role="tab" aria-selected={filter === "chats"} className={filter === "chats" ? "is-on" : ""} onClick={() => setFilter("chats")}>
            Chats ({Object.values(p.chats).filter((m) => m.length > 0).length})
          </button>
          <button role="tab" aria-selected={filter === "activity"} className={filter === "activity" ? "is-on" : ""} onClick={() => setFilter("activity")}>
            Log ({p.events.length})
          </button>
        </div>

        <div className="hist__search-row">
          <input
            type="search"
            className="hist__search nokeys"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, critiques, @Critic, @Pin…"
            aria-label="Search history"
          />
          <button className="icon-btn icon-btn--sm" onClick={p.onExportHistory} title="Export full history JSON" aria-label="Export history">
            <IconDownload width={13} height={13} />
          </button>
        </div>
      </div>

      <div className="hist__body">
        {totalCount === 0 && (
          <div className="chat__empty" style={{ padding: "18px 6px" }}>
            <b>No history recorded yet</b>
            <span>
              Every Chat conversation, every UX Critique (with its versioned canvas pins), and every AI edit, @Pin, @Mask, branch, and walkthrough is saved here and persisted to disk.
            </span>
          </div>
        )}

        {/* 1. UX Critique Outputs + Ephemeral Canvas Pin Toggle + Versioned Critic Pins */}
        {(filter === "all" || filter === "critiques") && critiques.length > 0 && (
          <section className="hist__sec">
            <div className="hist__sec-title">
              <IconSpark width={12} height={12} /> UX Critique Outputs ({critiques.length})
            </div>
            {critiques.map((c) => {
              const isShowingOnCanvas = p.activeCritiqueId === c.id;
              const vPins = c.versionedPins ?? [];
              return (
                <div key={c.id} className={`hist-card hist-card--critique${isShowingOnCanvas ? " is-active" : ""}`}>
                  <div className="hist-card__head">
                    <span className="badge badge--accent">{c.report.overallScore}/100</span>
                    <b className="hist-card__title">
                      {c.nodeLabel} · v{c.versionIndex + 1}
                    </b>
                    <span className="hist-card__time">{formatAgo(c.createdAt)}</span>
                  </div>
                  <div className="muted small mono">
                    {c.variant} · {c.report.model}
                    {c.report.thinkingLevel ? ` (${c.report.thinkingLevel.toLowerCase()})` : ""}
                  </div>
                  <div className="ux-dims" style={{ marginTop: 6 }}>
                    <div className="ux-dim">
                      <span>Usability</span>
                      <b>{c.report.dimensions.usability}</b>
                    </div>
                    <div className="ux-dim">
                      <span>Hierarchy</span>
                      <b>{c.report.dimensions.hierarchy}</b>
                    </div>
                    <div className="ux-dim">
                      <span>Access.</span>
                      <b>{c.report.dimensions.accessibility}</b>
                    </div>
                    <div className="ux-dim">
                      <span>Continuity</span>
                      <b>{c.report.dimensions.continuity}</b>
                    </div>
                  </div>
                  <p className="hist-card__summary">{c.report.summary}</p>

                  {vPins.length > 0 && (
                    <ul className="hist-pins">
                      {vPins.map((pin) => {
                        const tok = formatVersionedRef(pin);
                        const pinKey = `${c.id}:${pin.id}`;
                        const isEditing = editingPinKey === pinKey;
                        const showRevs = expandedRevKey === pinKey;
                        const revs = pin.revisions ?? [];

                        return (
                          <li key={pin.id} className="hist-pin-item">
                            <div className="hist-pin-item__top">
                              <button
                                type="button"
                                className="note__tok"
                                onClick={() => {
                                  if (!isShowingOnCanvas) p.onToggleCritiqueOnCanvas(c);
                                  p.onMentionInChat(tok);
                                }}
                                title={`Show on canvas & insert ${tok} in Chat`}
                              >
                                {tok}
                              </button>
                              {pin.componentId && <code className="muted">{pin.componentId}</code>}
                              <div className="note__foot-btns" style={{ marginLeft: "auto" }}>
                                <button
                                  type="button"
                                  className="note__mini"
                                  onClick={() => {
                                    setEditingPinKey(pinKey);
                                    setEditDraft(pin.text);
                                  }}
                                >
                                  <IconEdit width={10} height={10} /> Edit
                                </button>
                                <button
                                  type="button"
                                  className="note__mini"
                                  onClick={() => setExpandedRevKey(showRevs ? null : pinKey)}
                                >
                                  <IconHistory width={10} height={10} /> v{Math.max(1, revs.length)}
                                </button>
                              </div>
                            </div>

                            {isEditing ? (
                              <div className="note__edit nokeys" style={{ width: "100%", marginTop: 4 }}>
                                <textarea rows={2} value={editDraft} onChange={(e) => setEditDraft(e.target.value)} />
                                <div className="row-btns" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditingPinKey(null)}>
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--sm btn--accent"
                                    onClick={() => {
                                      if (editDraft.trim()) p.onEditCritiquePin(c.id, pin.id, editDraft.trim());
                                      setEditingPinKey(null);
                                    }}
                                  >
                                    Save v{revs.length + 1}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ width: "100%", color: "var(--text)" }}>{pin.text}</div>
                            )}

                            {showRevs && revs.length > 0 && (
                              <div className="rev-list" style={{ width: "100%" }}>
                                {[...revs].reverse().map((rev) => {
                                  const rTok = formatVersionedRef(pin, rev.revisionNumber);
                                  return (
                                    <div key={rev.id} className="rev-row">
                                      <div className="rev-row__head">
                                        <code className="mono">{rTok}</code>
                                        <span className="muted">{rev.author}</span>
                                        {rev.revisionNumber < revs.length && (
                                          <button
                                            type="button"
                                            className="msg__link"
                                            onClick={() => p.onRestoreCritiquePinRevision(c.id, pin.id, rev.id)}
                                          >
                                            <IconUndo width={10} height={10} /> Restore
                                          </button>
                                        )}
                                      </div>
                                      <div className="rev-row__txt">{rev.text}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="hist-card__foot">
                    <button
                      className={`btn btn--sm${isShowingOnCanvas ? " btn--accent" : ""}`}
                      onClick={() => p.onToggleCritiqueOnCanvas(c)}
                    >
                      {isShowingOnCanvas ? (
                        <>
                          <IconEyeOff width={12} height={12} /> Hide pins on canvas
                        </>
                      ) : (
                        <>
                          <IconEye width={12} height={12} /> Show {vPins.length} pin{vPins.length === 1 ? "" : "s"} on canvas (v{c.versionIndex + 1})
                        </>
                      )}
                    </button>
                    {!isShowingOnCanvas && (
                      <button className="btn btn--sm btn--ghost" onClick={() => p.onToggleCritiqueOnCanvas(c)} title="Jump to screen on freeform canvas">
                        <IconDevice width={12} height={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* 2. All Saved Chat Conversations */}
        {(filter === "all" || filter === "chats") && threads.length > 0 && (
          <section className="hist__sec">
            <div className="hist__sec-title">
              <IconChat width={12} height={12} /> Saved Conversations ({threads.length})
            </div>
            {threads.map((t) => {
              const isExpanded = expandedChat === t.key;
              const isCurrent = p.activeChatKey === t.key;
              return (
                <div key={t.key} className={`hist-card${isCurrent ? " is-active" : ""}`}>
                  <div className="hist-card__head">
                    <span className="badge">{t.scope}</span>
                    <b className="hist-card__title">{t.title}</b>
                    <span className="hist-card__time">{formatAgo(t.lastAt)}</span>
                  </div>
                  <div className="muted small">{t.sub} · {t.msgs.length} message{t.msgs.length === 1 ? "" : "s"}</div>
                  {!isExpanded && t.last && (
                    <div className="hist-card__preview">
                      <b>{t.last.role === "user" ? "You: " : t.last.role === "assistant" ? "Forkcast: " : ""}</b>
                      {t.last.text.split("\n")[0]}
                    </div>
                  )}
                  {isExpanded && (
                    <div className="hist-thread-log">
                      {t.msgs.map((m) => (
                        <div key={m.id} className={`hist-msg hist-msg--${m.role}`}>
                          <div className="hist-msg__meta">
                            <b>{m.role === "user" ? "You" : m.role === "assistant" ? "Forkcast" : m.tone ?? "System"}</b>
                            <span>{formatAgo(m.at)}</span>
                          </div>
                          <div>{m.text}</div>
                          {m.chips && m.chips.length > 0 && (
                            <div className="msg__chips">
                              {m.chips.map((ch) => (
                                <code key={ch}>{ch}</code>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="hist-card__foot">
                    <button className="btn btn--sm btn--accent" onClick={() => p.onOpenChatThread(t.key)}>
                      <IconChat width={12} height={12} /> Open in Chat
                    </button>
                    <button className="btn btn--sm btn--ghost" onClick={() => setExpandedChat(isExpanded ? null : t.key)}>
                      {isExpanded ? "Collapse" : `Read all (${t.msgs.length})`}
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* 3. Full Activity Timeline */}
        {(filter === "all" || filter === "activity") && activities.length > 0 && (
          <section className="hist__sec">
            <div className="hist__sec-title">
              <IconStep width={12} height={12} /> Activity Log ({activities.length})
            </div>
            {activities.map((ev) => {
              const EvIcon =
                ev.kind === "critique" || ev.kind === "edit"
                  ? IconSpark
                  : ev.kind === "branch"
                    ? IconBranch
                    : ev.kind === "mask"
                      ? IconBrush
                      : ev.kind === "pin"
                        ? IconPin
                        : ev.kind === "play"
                          ? IconPlay
                          : IconChat;
              return (
                <button key={ev.id} type="button" className="hist-ev" onClick={() => p.onOpenEvent(ev)}>
                  <EvIcon width={13} height={13} className="hist-ev__icon" />
                  <div className="hist-ev__body">
                    <div className="hist-ev__row">
                      <b>{ev.title}</b>
                      <span>{formatAgo(ev.at)}</span>
                    </div>
                    {ev.detail && <div className="hist-ev__det">{ev.detail}</div>}
                    {ev.chips && ev.chips.length > 0 && (
                      <div className="msg__chips">
                        {ev.chips.slice(0, 5).map((c) => (
                          <code key={c}>{c}</code>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
