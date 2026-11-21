import { useEffect, useRef, useState, type Ref } from "react";
import type { Annotation } from "../a2ui/types";
import type { Picked } from "../canvas/context";
import { IconAlert, IconChat, IconCheck, IconDevice, IconFlag, IconSend, IconSpark, IconStep, IconX } from "./icons";
import { useBrowserVoice } from "./useBrowserVoice";
import { VoiceButton, VoiceFeedback } from "./VoiceButton";

// Chat-first panel, scoped to the current selection. On a screen, instructions edit it (lassoed
// components or the whole screen); elsewhere, questions about the run get short answers.

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  tone?: "edit" | "flag" | "error" | "info";
  /** Component ids the message refers to. */
  chips?: string[];
  /** For edit cards: the version index it produced (to jump back to it). */
  versionIndex?: number;
}

export interface ChatProps {
  scope: "screen" | "node" | "edge" | "run";
  ctxTitle: string;
  ctxSub: string;
  messages: ChatMsg[];
  picks: Picked[];
  busy: { label: string; startedAt: number } | null;
  versions?: { count: number; active: number; onSet: (i: number) => void };
  suggestions: string[];
  inputRef?: Ref<HTMLTextAreaElement>;
  onRemovePick: (id: string) => void;
  onClearPicks: () => void;
  onSend: (text: string) => void;
  onFlag: (text: string, kind: Annotation["kind"]) => void;
  onOpenVersion: (i: number) => void;
}

export function Chat(p: ChatProps) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"bug" | "rule">("bug");
  const log = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.messages.length, p.busy]);

  useEffect(() => {
    if (!p.busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [p.busy]);

  const voice = useBrowserVoice({ value: text, onChange: setText });

  const editing = p.scope === "screen";
  const canSend = !!text.trim() && !p.busy;
  const send = () => {
    if (!canSend) return;
    voice.stop();
    p.onSend(text.trim());
    setText("");
  };
  const flag = () => {
    if (!text.trim() || !p.picks.length) return;
    voice.stop();
    p.onFlag(text.trim(), kind);
    setText("");
  };
  const placeholder = editing
    ? p.picks.length
      ? `Speak or type changes for ${p.picks.length === 1 ? "this component" : `these ${p.picks.length} components`}…`
      : "Speak or type what you'd like to change or test…"
    : "Speak or ask about this run…";
  const hint = editing
    ? p.picks.length
      ? "Enter to edit · Flag saves a note"
      : "Whole screen · L to lasso · ? to ask"
    : "Enter to send · Shift+Enter for new line";
  const ScopeIcon = p.scope === "screen" ? IconDevice : p.scope === "run" ? IconChat : IconStep;

  return (
    <div className="chat">
      <div className="chat__ctx" title={`${p.ctxTitle} · ${p.ctxSub}`}>
        <ScopeIcon width={14} height={14} className="chat__ctx-icon" />
        <div className="chat__ctx-text">
          {p.ctxTitle} {p.ctxSub && <span>· {p.ctxSub}</span>}
        </div>
      </div>
      {p.versions && p.versions.count > 1 && (
        <div className="chat__versions">
          <span className="chat__versions-label">Versions</span>
          {Array.from({ length: p.versions.count }, (_, i) => (
            <button key={i} className={`vchip${p.versions!.active === i ? " is-on" : ""}`} onClick={() => p.versions!.onSet(i)}>
              v{i + 1}
            </button>
          ))}
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
        {p.messages.length === 0 && !p.busy && (
          <div className="chat__empty">
            <b>{editing ? "Tweak this screen" : "Ask about the run"}</b>
            <span>
              {editing
                ? "Describe a change and Forkcast regenerates only what's needed, as a new version. Lasso (L) to target specific components, or flag them for QA."
                : "Questions are answered from this run's sessions, checks and coverage."}
            </span>
            <div className="chat__sugs">
              {p.suggestions.map((s) => (
                <button key={s} onClick={() => setText(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {p.messages.map((m) => (m.role === "system" ? <SystemCard key={m.id} m={m} onOpenVersion={p.onOpenVersion} /> : <Bubble key={m.id} m={m} />))}
        {p.busy && (
          <div className="msg msg--pending">
            <span className="spinner" /> {p.busy.label} · {Math.max(0, Math.round((now - p.busy.startedAt) / 1000))}s
          </div>
        )}
      </div>
      <div className={`chat__composer${voice.isListening ? " is-listening" : ""}`}>
        {(p.picks.length > 0 || editing) && (
          <div className="chat__chips">
            {p.picks.length === 0 && <span className="selchip selchip--scope">Whole screen</span>}
            {p.picks.map((it) => (
              <span key={it.id} className="selchip" title={`${it.type} · ${it.id}`}>
                <code>{it.type}</code>
                <span>{it.label !== it.type ? it.label : it.id}</span>
                <button onClick={() => p.onRemovePick(it.id)} aria-label={`Remove ${it.id}`}>
                  <IconX width={10} height={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={p.inputRef}
          className="chat__input"
          rows={2}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              if (voice.isListening) voice.stop();
              else if (p.picks.length) p.onClearPicks();
              else (e.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Message"
        />
        <VoiceFeedback voice={voice} />
        <div className="chat__bar">
          <VoiceButton voice={voice} disabled={!!p.busy} label="Speak" ariaLabel="Speak message" />
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
              <button className="chat__flag" onClick={flag} disabled={!text.trim()} title="Save as an annotation on the lassoed component, no regeneration">
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
