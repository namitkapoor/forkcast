import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Journey, JourneysFile, Persona, Query } from "../../journeys/types";
import { prefersReducedMotion } from "../storage";
import { CircledScreen } from "./CircledScreen";
import { cap, checkReason, contractStatus, contextChips, goalVerdict, isTap, pct, personaColor, pickJourney, SHOW_PERSONA_CONTRACTS, shortPersona, sortQueries, turnOk, type HeroMode } from "./data";
import { decisionMarks, decisionsOf, humanize, onlyIn, SOURCE_LABEL } from "./why";
import { IconCheck, IconChevron, IconPlay, IconSend, IconX } from "../icons";

const CHAR_MS = 35;

interface Props {
  file: JourneysFile;
  /** Which run the phones show; undefined hides the toggle. */
  mode?: HeroMode;
  onMode?: (m: HeroMode) => void;
  queryId: string;
  turn: number;
  onQuery: (id: string) => void;
  onTurn: (i: number) => void;
  onOpen: (personaId: string, run: number, turn: number) => void;
}

/** "Same question, three travelers": one phone per persona, the question typed in each, the generated screen as the reply. */
export function Hero({ file, mode, onMode, queryId, turn, onQuery, onTurn, onOpen }: Props) {
  const queries = sortQueries(file.queries);
  const q = file.queries.find((x) => x.id === queryId) ?? queries[0];
  const cols = file.personas.map((p) => ({ p, j: pickJourney(file.journeys, q.id, p.id) }));
  const maxTurns = Math.max(1, ...cols.map((c) => c.j?.turns.length ?? 0));
  // Typing clock: characters typed so far in the current turn's message; null = everything sent.
  const [clock, setClock] = useState<number | null>(null);
  // Explain mode: numbered "why" tags on each phone, from the screen's decisions (gen-v2).
  const [explain, setExplain] = useState(false);
  const conceal = false;
  const [hl, setHl] = useState<{ personaId: string; componentId: string } | null>(null);
  const curScreens = cols.map(({ j }) => (j && turn <= j.turns.length - 1 ? j.turns[turn]?.screen : undefined));
  const only = onlyIn(curScreens);
  const anyDecisions = curScreens.some((x) => decisionsOf(x).length);
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
          Three synthetic travelers ask Getaway’s assistant the same question. Forkcast checks whether each screen fits the person who asked.
        </p>
      </header>

      {mode && onMode && (
        <div className={`hero-mode hero-mode--${mode}`} data-mode={mode}>
          <div className="hero-seg" role="tablist" aria-label="Which assistant">
            <button role="tab" aria-selected={mode === "naive"} className={mode === "naive" ? "is-on" : ""} onClick={() => onMode("naive")} data-mode-btn="naive">
              Generic assistant
            </button>
            <button role="tab" aria-selected={mode === "checked"} className={mode === "checked" ? "is-on" : ""} onClick={() => onMode("checked")} data-mode-btn="checked">
              Persona-aware
            </button>
          </div>
          <p className="hero-mode__line" data-headline>
            {mode === "naive"
              ? `Generic assistant: same screen logic for everyone · fits the person ${pct(summarizeServes(file) ?? 0)}`
              : `Persona-aware: tuned to what the assistant knows · fits the person ${pct(summarizeServes(file) ?? 0)}`}
          </p>
        </div>
      )}

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
          {anyDecisions && <button
            className={`btn btn--ghost hero-explain${explain ? " is-on" : ""}`}
            onClick={() => setExplain((x) => !x)}
            aria-pressed={explain}
            title={anyDecisions ? "Tag each component with the ingredient that put it there" : "This run has no recorded decisions (gen-v2 adds them); shows rationale only"}
            data-explain
          >
            Explain
          </button>}
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

      <div className="hero__phones" style={{ ["--cols" as string]: cols.map(() => "minmax(0, 1fr)").join(" ") }}>
        {cols.map(({ p, j }, i) => (
          <PersonaColumn
            key={p.id}
            p={p}
            color={personaColor(p.id, i)}
            q={q}
            j={j}
            turn={turn}
            clock={clock}
            explain={explain}
            conceal={conceal}
            naive={mode === "naive"}
            highlight={hl?.personaId === p.id ? hl.componentId : null}
            onHighlight={(componentId) => setHl(componentId ? { personaId: p.id, componentId } : null)}
            onOpen={onOpen}
            onTurn={(i) => {
              onTurn(i);
              setClock(null);
            }}
          />
        ))}
      </div>

      {anyDecisions && only.some((x) => x.length) && (
        <div className="hero-diff" aria-label="What's different this turn" data-diff>
          <span className="hero-diff__h">What’s different</span>
          {cols.map(({ p }, i) =>
            only[i].length ? (
              <span key={p.id} className="hero-diff__item" title={only[i].join(", ")}>
                <i style={{ background: personaColor(p.id, i) }} />
                Only for {shortPersona(p).replace(/^The (\w+) family$/, "the $1s")}: <b>{only[i].slice(0, 3).join(", ")}</b>
                {only[i].length > 3 && <span className="muted"> +{only[i].length - 3}</span>}
              </span>
            ) : null,
          )}
        </div>
      )}
    </section>
  );
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
  /** Hide every check result (naive run before "Run Forkcast on these travelers"). */
  conceal: boolean;
  /** Naive run: circle correctness failures only, tagged with the invented value. */
  naive: boolean;
  color: string;
  explain: boolean;
  highlight: string | null;
  onHighlight: (componentId: string | null) => void;
  q: Query;
  j: Journey | undefined;
  turn: number;
  clock: number | null;
  onOpen: (personaId: string, run: number, turn: number) => void;
  onTurn: (i: number) => void;
}

function PersonaColumn({ p, conceal, color, q, j, turn, clock, explain, highlight, onHighlight, onOpen, onTurn }: ColProps) {
  const [chatRef, chatW] = useWidth<HTMLDivElement>();
  const desktop = false; // every traveler shown on a phone for consistency
  const len = j?.turns.length ?? 0;
  const shown = Math.min(turn, len - 1);
  const ended = turn > len - 1;
  const cur = j?.turns[shown];
  const msg = cur?.userMessage ?? "";
  const typing = !ended && clock !== null && !isTap(msg) && clock < msg.length;
  const draft = typing ? msg.slice(0, clock) : "";
  const verdict = j ? goalVerdict(j, q, p) : null;
  const visibleFails = (t: Journey["turns"][number]) => (conceal ? [] : t.checks.filter((c) => !c.ok && c.kind === "persona"));
  const failing = cur && !ended ? visibleFails(cur) : [];
  const errors = failing.filter((c) => c.kind !== "persona");
  const contracts = !ended ? contractStatus(p, cur) : [];
  const judged = contracts.filter((c) => c.check);
  const marks = explain && !ended ? decisionMarks(cur?.screen) : [];
  const [openReason, setOpenReason] = useState<string | null>(null);
  const screenW = Math.max(160, chatW - 24);
  // Numbered markers on the phone (one per outlined component); the matching text is in the list below.
  const markNum = new Map<string, number>();
  for (const c of failing) if (c.componentId && !markNum.has(c.componentId)) markNum.set(c.componentId, markNum.size + 1);

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
        <PersonaHead p={p} color={color} />
        <div className="page-stub">No journey for this traveler.</div>
      </div>
    );
  }

  const items = j.turns.slice(0, shown + 1);

  return (
    <div className="hero-col" data-persona={p.id}>
      <PersonaHead p={p} color={color} />

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
                      <CircledScreen
                        screen={t.screen}
                        width={screenW}
                        failing={last ? failing : visibleFails(t)}
                        tags={last ? "numbered" : false}
                        bare
                        marks={last ? marks : []}
                        highlight={last ? highlight : null}
                      />
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
          <span className="hero-intent">
            Turn {shown + 1} · <span className="chip chip--intent">{cap(cur.intent)}</span>

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
                <span className={`dot dot--${conceal || turnOk(t) ? "pass" : "fail"}`} />
              </button>
            ))}
          </span>
        </div>
        {explain && !ended && (
          <ol className="hero-legend" data-legend>
            {decisionsOf(cur.screen).length ? (
              decisionsOf(cur.screen).map((d, i) => (
                <li
                  key={`${d.componentId}-${i}`}
                  onMouseEnter={() => onHighlight(d.componentId)}
                  onMouseLeave={() => onHighlight(null)}
                  onFocus={() => onHighlight(d.componentId)}
                  onBlur={() => onHighlight(null)}
                  tabIndex={0}
                >
                  <span className={`jr-mark jr-mark--${d.source} jr-mark--static`}>{i + 1}</span>
                  <b>{cap(humanize(d.componentId) || d.componentId)}</b>
                  <span className="hero-legend__src">
                    ← {SOURCE_LABEL[d.source] ?? d.source}: {d.because}
                  </span>
                </li>
              ))
            ) : (
              <li className="muted">No per-component decisions on this screen (recorded from gen-v2 on).</li>
            )}
          </ol>
        )}
        {conceal ? null : errors.length ? (
          <ul className="hero-fails">
            {errors.slice(0, 2).map((c, i) => (
              <li key={i}>
                <IconX width={12} height={12} /> {c.message}
              </li>
            ))}
            {errors.length > 2 && <li className="muted">+{errors.length - 2} more</li>}
          </ul>
        ) : (
          <div className="hero-ok">
            <IconCheck width={12} height={12} /> {ended ? "Journey finished" : "Fits what this traveler needs"}
          </div>
        )}
        {SHOW_PERSONA_CONTRACTS && !conceal && contracts.length > 0 && (
          <div className="hero-serves" data-serves>
            <div className="hero-serves__h">
              Serves {shortPersona(p).replace(/^The /, "")}:{" "}
              <b className={judged.length && judged.every((c) => c.check!.ok) ? "tone-good" : "tone-warn"}>
                {judged.filter((c) => c.check!.ok).length}/{judged.length || contracts.length}
              </b>
              {judged.length < contracts.length && <span className="muted"> · {contracts.length - judged.length} not checked here</span>}
            </div>
            <ul className="hero-serves__list">
              {contracts.map(({ contract, check }) => {
                const reason = check ? checkReason(check) : "Nothing on this screen to check it against";
                const open = openReason === contract.id;
                return (
                  <li key={contract.id} className={check ? (check.ok ? "is-ok" : "is-bad") : "is-na"} data-contract={contract.id}>
                    <button onClick={() => setOpenReason(open ? null : contract.id)} title={reason} aria-expanded={open}>
                      <span className="hero-serves__mark" aria-hidden="true">{check ? (check.ok ? "✓" : "✗") : "–"}</span>
                      {check && !check.ok && check.componentId && markNum.has(check.componentId) && (
                        <span className="jr-circle__num jr-circle__num--static" title="Outlined on the screen above">{markNum.get(check.componentId)}</span>
                      )}
                      <span>{contract.label}</span>
                      {check?.source === "judge" && <span className="hero-serves__judge" title="Scored by the Gemini judge">judge</span>}
                    </button>
                    {open && <div className="hero-serves__why">{reason}</div>}
                  </li>
                );
              })}
            </ul>
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

function PersonaHead({ p, color }: { p: Persona; color?: string }) {
  return (
    <div className="hero-who">
      <span className="hero-ring" style={{ boxShadow: color ? `0 0 0 2px var(--bg, #fff), 0 0 0 4px ${color}` : undefined }}>
        <Avatar p={p} size={40} />
      </span>
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

function summarizeServes(file: { journeys: Journey[] }): number | undefined {
  let ok = 0, n = 0;
  for (const j of file.journeys) for (const t of j.turns) for (const c of t.checks) if (c.kind === "persona") { n++; if (c.ok) ok++; }
  return n ? ok / n : undefined;
}
