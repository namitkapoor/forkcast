import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Journey, JourneysFile, Persona, Query } from "../../journeys/types";
import { prefersReducedMotion } from "../storage";
import { CircledScreen } from "./CircledScreen";
import { cap, contextChips, goalVerdict, isTap, shortPersona, sortQueries, turnOk } from "./data";
import { IconCheck, IconChevron, IconPlay, IconSend, IconX } from "../icons";

const CHAR_MS = 35;

interface Props {
  file: JourneysFile;
  queryId: string;
  turn: number;
  onQuery: (id: string) => void;
  onTurn: (i: number) => void;
  onOpen: (personaId: string, run: number, turn: number) => void;
}

/** "Same question, three travelers": one phone per persona, the question typed in each, the generated screen as the reply. */
export function Hero({ file, queryId, turn, onQuery, onTurn, onOpen }: Props) {
  const queries = sortQueries(file.queries);
  const q = file.queries.find((x) => x.id === queryId) ?? queries[0];
  const cols = file.personas.map((p) => ({ p, j: pickJourney(file.journeys, q.id, p.id) }));
  const maxTurns = Math.max(1, ...cols.map((c) => c.j?.turns.length ?? 0));
  // Typing clock: characters typed so far in the current turn's message; null = everything sent.
  const [clock, setClock] = useState<number | null>(null);
  const longest = Math.max(0, ...cols.map(({ j }) => {
    const m = j?.turns[turn]?.userMessage ?? "";
    return isTap(m) ? 0 : m.length;
  }));

  useEffect(() => {
    if (clock === null) return;
    if (clock >= longest) {
      setClock(null);
      return;
    }
    const id = window.setTimeout(() => setClock((c) => (c === null ? null : c + 1)), CHAR_MS);
    return () => window.clearTimeout(id);
  }, [clock, longest]);

  const startTyping = () => setClock(prefersReducedMotion() ? null : 0);
  const play = () => {
    onTurn(0);
    startTyping();
  };
  const next = () => {
    if (turn >= maxTurns - 1) return;
    onTurn(turn + 1);
    startTyping();
  };
  const prev = () => {
    if (turn <= 0) return;
    onTurn(turn - 1);
    setClock(null);
  };

  // Arrow keys step the three journeys together.
  const keys = useRef({ next, prev });
  keys.current = { next, prev };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".scrim")) return;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") keys.current.next();
      else if (e.key === "ArrowLeft") keys.current.prev();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  return (
    <section className="hero" aria-label="Same question, three travelers">
      <header className="hero__head">
        <h1>Same question, three travelers</h1>
        <p className="muted">
          Getaway’s assistant generates a different screen for each person. Forkcast checks every one against the real fare data.
        </p>
      </header>

      <div className="hero__bar">
        <div className="hero__queries" role="tablist" aria-label="Question">
          {queries.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={x.id === q.id}
              className={`pill${x.id === q.id ? " is-on" : ""}`}
              data-query={x.id}
              onClick={() => {
                if (x.id === q.id) return;
                onQuery(x.id);
                onTurn(0);
                setClock(null);
              }}
            >
              “{x.text}”
            </button>
          ))}
        </div>
        <div className="hero__controls">
          <button className="btn btn--primary" onClick={play} data-play>
            <IconPlay width={12} height={12} /> Play
          </button>
          <span className="hero__step">
            <button className="icon-btn icon-btn--sm" onClick={prev} disabled={turn <= 0} aria-label="Previous turn" data-prev>
              <IconChevron width={14} height={14} style={{ transform: "scaleX(-1)" }} />
            </button>
            <span className="hero__turn" aria-live="polite">
              Turn {turn + 1}
              <span className="muted"> / {maxTurns}</span>
            </span>
            <button className="btn btn--ghost" onClick={next} disabled={turn >= maxTurns - 1} data-next>
              Next turn <IconChevron width={13} height={13} />
            </button>
          </span>
        </div>
      </div>

      <div className="hero__phones">
        {cols.map(({ p, j }) => (
          <PersonaColumn key={p.id} p={p} q={q} j={j} turn={turn} clock={clock} onOpen={onOpen} onTurn={(i) => {
            onTurn(i);
            setClock(null);
          }} />
        ))}
      </div>
    </section>
  );
}

function pickJourney(all: Journey[], queryId: string, personaId: string): Journey | undefined {
  return all.filter((j) => j.queryId === queryId && j.personaId === personaId).sort((a, b) => a.run - b.run)[0];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setW(el.clientWidth);
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Avatar({ p, size }: { p: Persona; size: number }) {
  const initials = shortPersona(p)
    .replace(/^The /, "")
    .split(/[\s&]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return p.photo ? (
    <img className="avatar" src={p.photo} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="avatar avatar--initials" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials}
    </span>
  );
}

interface ColProps {
  p: Persona;
  q: Query;
  j: Journey | undefined;
  turn: number;
  clock: number | null;
  onOpen: (personaId: string, run: number, turn: number) => void;
  onTurn: (i: number) => void;
}

function PersonaColumn({ p, q, j, turn, clock, onOpen, onTurn }: ColProps) {
  const [chatRef, chatW] = useWidth<HTMLDivElement>();
  const desktop = p.context.surface === "fullscreen";
  const len = j?.turns.length ?? 0;
  const shown = Math.min(turn, len - 1);
  const ended = turn > len - 1;
  const cur = j?.turns[shown];
  const msg = cur?.userMessage ?? "";
  const typing = !ended && clock !== null && !isTap(msg) && clock < msg.length;
  const draft = typing ? msg.slice(0, clock) : "";
  const verdict = j ? goalVerdict(j, q, p) : null;
  const failing = cur && !ended ? cur.checks.filter((c) => !c.ok) : [];
  const screenW = Math.max(160, chatW - 24);

  // Keep the newest message in view: the latest user bubble near the top, or the bottom while typing.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const place = () => {
      if (typing || ended) {
        el.scrollTop = el.scrollHeight;
        return;
      }
      const users = el.querySelectorAll<HTMLElement>("[data-msg='user']");
      const last = users[users.length - 1];
      el.scrollTop = last ? last.offsetTop - 8 : 0;
    };
    place();
    // Screens settle asynchronously (renderer mounts, bare frames measure), so re-place a few times.
    const timers = [60, 200, 500, 1000].map((ms) => window.setTimeout(place, ms));
    return () => timers.forEach(clearTimeout);
  }, [shown, typing, ended, j?.id, screenW]);

  if (!j || !cur) {
    return (
      <div className="hero-col">
        <PersonaHead p={p} />
        <div className="page-stub">No journey for this traveler.</div>
      </div>
    );
  }

  const items = j.turns.slice(0, shown + 1);

  return (
    <div className="hero-col" data-persona={p.id}>
      <PersonaHead p={p} />

      <div
        className={`device${desktop ? " device--desktop" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`Open ${shortPersona(p)}’s journey`}
        title="Open this journey"
        onClick={() => onOpen(p.id, j.run, shown)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen(p.id, j.run, shown);
        }}
        data-device={p.id}
      >
        {desktop ? (
          <div className="device__window">
            <i />
            <i />
            <i />
            <span>getaway.com/assistant</span>
          </div>
        ) : (
          <div className="device__status">
            <span>9:41</span>
            <span className="device__status-icons">
              <i className="fc-bars" />
              <i className="fc-battery" />
            </span>
          </div>
        )}
        <div className="device__app">
          <div className="gw-head">
            <span className="gw-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 13.5l19-8-6.5 15-3-6.5z" />
              </svg>
            </span>
            <span className="gw-head__name">Getaway</span>
            <span className="gw-head__sub">assistant</span>
          </div>
          <div className="gw-chat" ref={scrollRef}>
            <div className="gw-chat__inner" ref={chatRef}>
              <div className="gw-sys">Hi! Where would you like to go?</div>
              {items.map((t, i) => {
                const last = i === shown;
                if (last && typing) return null;
                const tap = isTap(t.userMessage);
                return (
                  <div key={i} className="gw-turn" data-turn={i}>
                    <div className={`gw-user${tap ? " gw-user--tap" : ""}`} data-msg="user">
                      <span className="gw-bubble">
                        {tap && <span className="gw-tap">Tapped</span>}
                        {tap ? t.userMessage.replace(/^Tapped\s+/i, "") : t.userMessage}
                      </span>
                      <Avatar p={p} size={22} />
                    </div>
                    <div className="gw-bot">
                      <CircledScreen screen={t.screen} width={screenW} failing={last ? failing : t.checks.filter((c) => !c.ok)} tags={false} bare />
                    </div>
                  </div>
                );
              })}
              {ended && <div className="gw-sys">Journey ended · {j.outcome === "booked" ? "booked" : j.outcome.replace("-", " ")}</div>}
            </div>
          </div>
          <div className="gw-composer">
            <span className={`gw-input${draft ? " has-text" : ""}`}>
              {draft || "Message Getaway"}
              {typing && <i className="gw-caret" aria-hidden="true" />}
            </span>
            <span className={`gw-send${draft ? " is-on" : ""}`} aria-hidden="true">
              <IconSend width={13} height={13} />
            </span>
          </div>
        </div>
      </div>

      <div className="hero-col__foot">
        {p.memory && (
          <div className="hero-memory" title="What the assistant knows about this traveler: why the screens differ">
            <span>Assistant knows</span> {p.memory}
          </div>
        )}
        <div className="hero-col__turn">
          <span>
            Turn {shown + 1} · <b>{cap(cur.intent)}</b>
          </span>
          <span className="hero-dots" role="group" aria-label="Turns">
            {j.turns.map((t, i) => (
              <button
                key={i}
                className={`hero-dot${i === shown ? " is-on" : ""}`}
                onClick={() => onTurn(i)}
                aria-label={`Turn ${i + 1}: ${cap(t.intent)}, ${turnOk(t) ? "all checks pass" : "failing checks"}`}
                title={`Turn ${i + 1} · ${cap(t.intent)}`}
              >
                <span className={`dot dot--${turnOk(t) ? "pass" : "fail"}`} />
              </button>
            ))}
          </span>
        </div>
        {failing.length ? (
          <ul className="hero-fails">
            {failing.slice(0, 2).map((c, i) => (
              <li key={i}>
                <IconX width={12} height={12} /> {c.message}
              </li>
            ))}
            {failing.length > 2 && <li className="muted">+{failing.length - 2} more</li>}
          </ul>
        ) : (
          <div className="hero-ok">
            <IconCheck width={12} height={12} /> {ended ? "Journey finished" : "Every price, time and flight on screen is real"}
          </div>
        )}
        {verdict && (
          <div className={`hero-goal ${verdict.ok ? "is-ok" : "is-bad"}`} title={verdict.text}>
            {verdict.ok ? <IconCheck width={12} height={12} /> : <IconX width={12} height={12} />}
            <b>{verdict.ok ? "Goal met" : "Goal not met"}</b>
            <span className="muted">· {j.outcome === "max-turns" ? "gave up after 5 turns" : j.outcome}</span>
            <button className="hero-open" onClick={() => onOpen(p.id, j.run, shown)}>
              Open journey <IconChevron width={11} height={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PersonaHead({ p }: { p: Persona }) {
  return (
    <div className="hero-who">
      <Avatar p={p} size={40} />
      <div className="hero-who__text">
        <b>{shortPersona(p)}</b>
        <span className="hero-who__chips">
          {contextChips(p).map((c) => (
            <span className="chip" key={c}>
              {c}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
