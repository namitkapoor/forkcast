import { useEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import type { AnnotationKind } from "../a2ui/types";
import type { Picked } from "../canvas/context";
import type { FlowGraph } from "../graph/types";
import type { DisambiguationControl, TokenUsage } from "../lib/api";
import {
  IconAlert,
  IconBrush,
  IconChat,
  IconCheck,
  IconCols,
  IconCrown,
  IconDevice,
  IconFlag,
  IconPin,
  IconPlus,
  IconSend,
  IconSliders,
  IconSpark,
  IconStep,
  IconStop,
  IconX,
} from "./icons";
import {
  detectCaretMention,
  filterReferenceCatalog,
  type CatalogReferenceItem,
  type ResolvedAnnotationItem,
} from "./references";
import { useVoiceInput, VoiceMicButton } from "./useVoiceInput";

// Chat-first panel, scoped to the current selection. Supports @Pin-N:vK / @Mask-N:vK / @step
// autocomplete, add/remove context chips, Gemini Voice AI, pre-flight disambiguation micro-UIs,
// and cancellable edits.

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  tone?: "edit" | "flag" | "error" | "info";
  /** Component or @mention chips the message refers to. */
  chips?: string[];
  /** For edit cards: the version index it produced (to jump back to it). */
  versionIndex?: number;
}

export interface PendingDisambiguationState {
  originalPrompt: string;
  rationale: string;
  controls: DisambiguationControl[];
}

export interface ChatProps {
  scope: "screen" | "node" | "edge" | "run";
  ctxTitle: string;
  ctxSub: string;
  draft: string;
  onDraftChange: (next: string) => void;
  messages: ChatMsg[];
  picks: Picked[];
  catalog: CatalogReferenceItem[];
  attachedAnnotations: ResolvedAnnotationItem[];
  screenAttached: boolean;
  busy: { label: string; startedAt: number } | null;
  disambiguation: PendingDisambiguationState | null;
  versions?: {
    count: number;
    active: number;
    finalized?: number;
    hidden: number[];
    onSet: (i: number) => void;
    onCompare: () => void;
  };
  suggestions: string[];
  tokenTotal?: number;
  graph?: FlowGraph;
  inputRef?: Ref<HTMLTextAreaElement>;
  onRemovePick: (id: string) => void;
  onClearPicks: () => void;
  onAttachItem: (item: CatalogReferenceItem) => void;
  onDetachAnnotation: (annId: string, mentionTag?: string) => void;
  onDetachScreen: () => void;
  onClearAllContext: () => void;
  onCancelBusy: () => void;
  onUpdateDisambiguation: (id: string, fn: (c: DisambiguationControl) => DisambiguationControl) => void;
  onConfirmDisambiguation: () => void;
  onSkipDisambiguation: () => void;
  onSend: (text: string) => void;
  onFlag: (text: string, kind: Exclude<AnnotationKind, "mask">) => void;
  onOpenVersion: (i: number) => void;
  onVoiceUsage?: (u: TokenUsage) => void;
  onVoiceError?: (msg: string) => void;
}

const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export function Chat(p: ChatProps) {
  const [kind, setKind] = useState<"bug" | "rule">("bug");
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef(p.draft);
  draftRef.current = p.draft;
  const [now, setNow] = useState(() => Date.now());

  const setInputRefs = (el: HTMLTextAreaElement | null) => {
    localInputRef.current = el;
    if (!p.inputRef) return;
    if (typeof p.inputRef === "function") p.inputRef(el);
    else (p.inputRef as RefObject<HTMLTextAreaElement | null>).current = el;
  };

  const voice = useVoiceInput({
    getCurrentText: () => draftRef.current,
    onTextUpdate: p.onDraftChange,
    graph: p.graph,
    onUsage: p.onVoiceUsage,
    onError: p.onVoiceError,
  });

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.messages.length, p.busy, p.disambiguation]);

  useEffect(() => {
    if (!p.busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [p.busy]);

  const filteredMentions = useMemo(() => {
    if (!mentionRange) return [];
    return filterReferenceCatalog(p.catalog, mentionRange.query).slice(0, 12);
  }, [mentionRange, p.catalog]);

  const attachedAnnIds = useMemo(
    () => new Set(p.attachedAnnotations.map((a) => a.annotation.id)),
    [p.attachedAnnotations],
  );

  // Quick "+ @Pin-N" pills for open unattached pins/masks
  const addablePins = useMemo(
    () =>
      p.catalog
        .filter(
          (it) =>
            (it.kind === "pin" || it.kind === "mask") &&
            it.isLatestRevision &&
            !it.isResolved &&
            it.annotationId !== undefined &&
            !attachedAnnIds.has(it.annotationId),
        )
        .slice(0, 6),
    [p.catalog, attachedAnnIds],
  );

  const syncCaret = (value: string, caret: number) => {
    const det = detectCaretMention(value, caret);
    setMentionRange(det);
    if (det) setMentionIdx(0);
  };

  const selectMention = (item: CatalogReferenceItem) => {
    if (!mentionRange) {
      p.onAttachItem(item);
      requestAnimationFrame(() => localInputRef.current?.focus());
      return;
    }
    const next = `${p.draft.slice(0, mentionRange.start)}${item.token} ${p.draft.slice(mentionRange.end)}`;
    p.onAttachItem(item);
    p.onDraftChange(next);
    setMentionRange(null);
    const caret = mentionRange.start + item.token.length + 1;
    requestAnimationFrame(() => {
      const el = localInputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  };

  const editing = p.scope === "screen" && p.screenAttached;
  const canSend = !!p.draft.trim() && !p.busy;
  const send = () => {
    if (!canSend) return;
    voice.stop();
    const text = p.draft.trim();
    p.onDraftChange("");
    setMentionRange(null);
    p.onSend(text);
  };
  const flag = () => {
    if (!p.draft.trim() || !p.picks.length) return;
    voice.stop();
    const text = p.draft.trim();
    p.onDraftChange("");
    setMentionRange(null);
    p.onFlag(text, kind);
  };

  const placeholder = editing
    ? p.picks.length
      ? `Change ${p.picks.length === 1 ? "this component" : `these ${p.picks.length} components`}, or type @Pin…`
      : "Type @ to attach @Pin:v1 / @Mask:v1, or describe changes…"
    : "Ask about this run, or type @step / @Pin…";
  const hint = editing
    ? p.picks.length
      ? "Enter to edit · Flag saves @Pin"
      : "L lasso · M mask · ? to ask"
    : "Enter to send · @ to mention";
  const ScopeIcon = p.scope === "screen" ? IconDevice : p.scope === "run" ? IconChat : IconStep;

  const hasContextChips = p.picks.length > 0 || p.attachedAnnotations.length > 0 || (p.scope === "screen" && p.screenAttached);
  const hiddenSet = useMemo(() => new Set(p.versions?.hidden ?? []), [p.versions?.hidden]);

  return (
    <div className="chat">
      <div className="chat__ctx" title={`${p.ctxTitle} · ${p.ctxSub}`}>
        <ScopeIcon width={14} height={14} className="chat__ctx-icon" />
        <div className="chat__ctx-text">
          {p.ctxTitle} {p.ctxSub && <span>· {p.ctxSub}</span>}
        </div>
        {p.tokenTotal !== undefined && p.tokenTotal > 0 && (
          <span className="tok-pill" title="Session Gemini tokens used across edits, asks, critiques & voice">
            {fmtTok(p.tokenTotal)} tok
          </span>
        )}
      </div>

      {p.versions && p.versions.count > 1 && (
        <div className="chat__versions">
          <span className="chat__versions-label">Versions</span>
          {Array.from({ length: p.versions.count }, (_, i) => {
            if (hiddenSet.has(i) && p.versions!.active !== i) return null;
            return (
              <button key={i} className={`vchip${p.versions!.active === i ? " is-on" : ""}`} onClick={() => p.versions!.onSet(i)}>
                {p.versions!.finalized === i && <IconCrown width={10} height={10} style={{ marginRight: 3, verticalAlign: -1 }} />}
                v{i + 1}
              </button>
            );
          })}
          <button className="vchip" onClick={p.versions.onCompare} title="Compare versions side-by-side">
            <IconCols width={11} height={11} style={{ verticalAlign: -1, marginRight: 3 }} />
            Compare
          </button>
          <div className="seg chat__ba" role="radiogroup" aria-label="Before or after">
            <button role="radio" aria-checked={p.versions.active === 0} className={p.versions.active === 0 ? "is-on" : ""} onClick={() => p.versions!.onSet(0)}>
              Before
            </button>
            <button
              role="radio"
              aria-checked={p.versions.active !== 0}
              className={p.versions.active !== 0 ? "is-on" : ""}
              onClick={() => p.versions!.onSet(p.versions!.count - 1)}
            >
              After
            </button>
          </div>
        </div>
      )}

      <div className="chat__log" ref={log} aria-live="polite">
        {p.messages.length === 0 && !p.busy && !p.disambiguation && (
          <div className="chat__empty">
            <b>{editing ? "Tweak this screen" : "Ask about the run"}</b>
            <span>
              {editing
                ? "Describe a change and Forkcast regenerates only what's needed as a new version. Lasso (L), pin (C), paint a mask (M), or reference @Pin-1:v1."
                : "Questions are answered from this run's sessions, checks, coverage, and any @Pin/@step references."}
            </span>
            <div className="chat__sugs">
              {p.suggestions.map((s) => (
                <button key={s} onClick={() => p.onDraftChange(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {p.messages.map((m) => (m.role === "system" ? <SystemCard key={m.id} m={m} onOpenVersion={p.onOpenVersion} /> : <Bubble key={m.id} m={m} />))}

        {p.disambiguation && (
          <DisambiguationInline
            state={p.disambiguation}
            onUpdate={p.onUpdateDisambiguation}
            onConfirm={p.onConfirmDisambiguation}
            onSkip={p.onSkipDisambiguation}
          />
        )}

        {p.busy && (
          <div className="msg msg--pending">
            <span className="spinner" />
            <span style={{ flex: 1 }}>
              {p.busy.label} · {Math.max(0, Math.round((now - p.busy.startedAt) / 1000))}s
            </span>
            <button className="btn btn--sm btn--ghost" onClick={p.onCancelBusy} title="Cancel active AI request">
              <IconStop width={11} height={11} /> Stop
            </button>
          </div>
        )}
      </div>

      <div className={`chat__composer${voice.isListening ? " is-listening" : ""}`}>
        {mentionRange !== null && (
          <div className="mention-menu floating" role="listbox" aria-label="Autocomplete @mentions">
            <div className="mention-menu__head">
              <span>@Pins, @Masks &amp; Steps ({filteredMentions.length})</span>
              <span>↑↓ Tab</span>
            </div>
            {filteredMentions.length === 0 ? (
              <div className="mention-menu__empty">No matching @Pin:vK, @Mask:vK, or @step</div>
            ) : (
              filteredMentions.map((it, idx) => (
                <button
                  key={`${it.kind}-${it.token}-${it.annotationId ?? it.nodeId ?? idx}`}
                  type="button"
                  role="option"
                  aria-selected={idx === mentionIdx}
                  className={`mention-item${idx === mentionIdx ? " is-active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMention(it);
                  }}
                >
                  <div className="mention-item__row">
                    <span className={`mention-item__tok mention-item__tok--${it.kind}`}>
                      {it.kind === "mask" ? <IconBrush width={11} height={11} /> : it.kind === "pin" ? <IconPin width={11} height={11} /> : <IconStep width={11} height={11} />}
                      {it.token}
                    </span>
                    <span className="mention-item__sec">{it.secondaryText}</span>
                  </div>
                  <div className="mention-item__pri">{it.primaryText}</div>
                </button>
              ))
            )}
          </div>
        )}

        {(hasContextChips || addablePins.length > 0) && (
          <div className="ctx-bar">
            {hasContextChips && (
              <div className="chat__chips">
                {p.scope === "screen" && p.screenAttached && p.picks.length === 0 && (
                  <span className="selchip selchip--scope" title="Editing active screen (click × to ask about whole run instead)">
                    <span>Screen</span>
                    <button onClick={p.onDetachScreen} aria-label="Detach screen scope">
                      <IconX width={10} height={10} />
                    </button>
                  </span>
                )}
                {p.picks.map((it) => (
                  <span key={it.id} className="selchip" title={`${it.type} · ${it.id}`}>
                    <code>{it.type}</code>
                    <span>{it.label !== it.type ? it.label : it.id}</span>
                    <button onClick={() => p.onRemovePick(it.id)} aria-label={`Remove ${it.id}`}>
                      <IconX width={10} height={10} />
                    </button>
                  </span>
                ))}
                {p.attachedAnnotations.map((ref) => (
                  <span
                    key={ref.token}
                    className={`selchip ${ref.annotation.kind === "mask" ? "selchip--mask" : "selchip--pin"}`}
                    title={`${ref.token}: "${ref.revision.text}" (click × to exclude from this prompt)`}
                  >
                    <code>{ref.token}</code>
                    <span>{ref.revision.text}</span>
                    <button
                      onClick={() => p.onDetachAnnotation(ref.annotation.id, ref.annotation.mentionTag)}
                      aria-label={`Detach ${ref.token}`}
                    >
                      <IconX width={10} height={10} />
                    </button>
                  </span>
                ))}
                {(p.picks.length + p.attachedAnnotations.length > 1) && (
                  <button type="button" className="ctx-clear" onClick={p.onClearAllContext} title="Detach all chips">
                    Clear ×
                  </button>
                )}
              </div>
            )}

            {addablePins.length > 0 && (
              <div className="ctx-attach">
                <span className="ctx-attach__lbl">Attach:</span>
                {addablePins.map((it) => (
                  <button
                    key={it.token}
                    type="button"
                    className={`attach-chip attach-chip--${it.kind}`}
                    onClick={() => selectMention(it)}
                    title={`Attach ${it.token}: ${it.primaryText}`}
                  >
                    <IconPlus width={9} height={9} />
                    <span>{it.token}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={setInputRefs}
          className="chat__input"
          rows={2}
          value={p.draft}
          placeholder={placeholder}
          onChange={(e) => {
            p.onDraftChange(e.target.value);
            syncCaret(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) => {
            const t = e.currentTarget;
            syncCaret(t.value, t.selectionStart ?? t.value.length);
          }}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              const t = e.currentTarget;
              syncCaret(t.value, t.selectionStart ?? t.value.length);
            }
          }}
          onKeyDown={(e) => {
            if (mentionRange !== null && filteredMentions.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIdx((i) => (i + 1) % filteredMentions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIdx((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectMention(filteredMentions[mentionIdx]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionRange(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              if (voice.isListening) voice.stop();
              else if (mentionRange) setMentionRange(null);
              else if (p.picks.length) p.onClearPicks();
              else (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Message"
        />
        <div className="chat__bar">
          <VoiceMicButton voice={voice} disabled={!!p.busy} compact />
          <span className="chat__hint">{hint}</span>
          {editing && p.picks.length > 0 && (
            <>
              <div className="seg chat__kind" role="radiogroup" aria-label="Flag type">
                {(["bug", "rule"] as const).map((k) => (
                  <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
                    {k === "bug" ? "Bug" : "Rule"}
                  </button>
                ))}
              </div>
              <button className="chat__flag" onClick={flag} disabled={!p.draft.trim()} title="Save as @Pin annotation on the lassoed component, no regeneration">
                <IconFlag width={13} height={13} /> Flag
              </button>
            </>
          )}
          <button className="chat__send" onClick={send} disabled={!canSend} aria-label="Send">
            <IconSend width={15} height={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DisambiguationInline({
  state,
  onUpdate,
  onConfirm,
  onSkip,
}: {
  state: PendingDisambiguationState;
  onUpdate: (id: string, fn: (c: DisambiguationControl) => DisambiguationControl) => void;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="disambig-card">
      <div className="disambig-card__head">
        <span className="badge badge--accent">
          <IconSliders width={11} height={11} /> Quick clarify
        </span>
        <button className="icon-btn icon-btn--sm" onClick={onSkip} title="Skip & run directly" aria-label="Dismiss">
          <IconX width={12} height={12} />
        </button>
      </div>
      <div className="muted small">{state.rationale}</div>
      {state.controls.map((ctrl) => {
        if (ctrl.kind === "choice-cards") {
          return (
            <div key={ctrl.id} className="disambig-ctrl">
              <div className="disambig-ctrl__lbl">{ctrl.label}</div>
              <div className="disambig-choices">
                {ctrl.options.map((opt) => {
                  const sel = ctrl.selectedId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`disambig-choice${sel ? " is-on" : ""}`}
                      onClick={() => onUpdate(ctrl.id, (c) => (c.kind === "choice-cards" ? { ...c, selectedId: opt.id } : c))}
                    >
                      <div className="disambig-choice__top">
                        <b>{opt.title}</b>
                        {sel && <IconCheck width={12} height={12} />}
                      </div>
                      {opt.subtitle && <span>{opt.subtitle}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }
        if (ctrl.kind === "chips") {
          return (
            <div key={ctrl.id} className="disambig-ctrl">
              <div className="disambig-ctrl__lbl">{ctrl.label}</div>
              <div className="chips" style={{ marginTop: 4 }}>
                {ctrl.options.map((opt) => {
                  const on = ctrl.selected.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`vchip${on ? " is-on" : ""}`}
                      onClick={() =>
                        onUpdate(ctrl.id, (c) => {
                          if (c.kind !== "chips") return c;
                          const next = on ? c.selected.filter((x) => x !== opt) : [...c.selected, opt];
                          return { ...c, selected: next.length ? next : [opt] };
                        })
                      }
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }
        return (
          <div key={ctrl.id} className="disambig-ctrl">
            <div className="disambig-ctrl__lbl">
              <span>{ctrl.label}</span>
              <code style={{ marginLeft: "auto" }}>
                {ctrl.value}
                {ctrl.unit}
              </code>
            </div>
            <input
              type="range"
              min={ctrl.min}
              max={ctrl.max}
              step={ctrl.step}
              value={ctrl.value}
              onChange={(e) => onUpdate(ctrl.id, (c) => (c.kind === "slider" ? { ...c, value: Number(e.target.value) } : c))}
              className="disambig-range"
            />
          </div>
        );
      })}
      <div className="row-btns" style={{ marginTop: 6 }}>
        <button type="button" className="btn btn--sm btn--accent" style={{ flex: 1 }} onClick={onConfirm}>
          <IconSpark width={12} height={12} /> Apply &amp; Edit
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMsg }) {
  if (m.role === "user")
    return (
      <div className="msg msg--user">
        {m.text}
        {m.chips && m.chips.length > 0 && (
          <div className="msg__chips">
            {m.chips.map((c) => (
              <code key={c}>{c}</code>
            ))}
          </div>
        )}
      </div>
    );
  return (
    <div className="msg msg--assistant">
      <div className="msg__who">
        <span className="file__mark" style={{ width: 12, height: 12 }} aria-hidden="true" /> Forkcast
      </div>
      {m.text}
    </div>
  );
}

function SystemCard({ m, onOpenVersion }: { m: ChatMsg; onOpenVersion: (i: number) => void }) {
  const Icon = m.tone === "edit" ? IconSpark : m.tone === "flag" ? IconFlag : m.tone === "error" ? IconAlert : IconCheck;
  const [head, ...rest] = m.text.split("\n");
  return (
    <div className={`msg msg--system msg--${m.tone ?? "info"}`}>
      <Icon width={14} height={14} className="msg__icon" />
      <div className="msg__body">
        <b>{head}</b>
        {rest.length > 0 && <span>{rest.join("\n")}</span>}
        {m.versionIndex !== undefined && (
          <button className="msg__link" onClick={() => onOpenVersion(m.versionIndex!)}>
            Show v{m.versionIndex + 1}
          </button>
        )}
      </div>
    </div>
  );
}
