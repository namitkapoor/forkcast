import { Fragment, useEffect, useMemo, useState } from "react";
import type { CheckResult, Intent, Journey, JourneysFile, Persona, Turn } from "../../journeys/types";
import { cap, checkReason, contextChips, laneName, loadJourneys, loadNaiveJourneys, shortPersona, truncate, type HeroMode } from "../journeys/data";
import { CircledScreen, contractLabel } from "../journeys/CircledScreen";
import { JourneyView } from "../journeys/JourneyView";
import { IconBack } from "../journeys/icons";
import "../journeys/journeys.css";
import "./personaFlow.css";

export interface Drill {
  mode: HeroMode;
  personaId: string;
  intent: Intent;
}

/** `#flow/generic/family/search` ⇄ Drill. */
export const drillHash = (d: Drill) => `#flow/${d.mode === "naive" ? "generic" : "persona"}/${encodeURIComponent(d.personaId)}/${encodeURIComponent(d.intent)}`;
export function drillFromHash(h: string): Drill | null {
  const m = /^#flow\/(generic|persona)\/([^/]+)\/([^/]+)/.exec(h);
  return m ? { mode: m[1] === "generic" ? "naive" : "checked", personaId: decodeURIComponent(m[2]), intent: decodeURIComponent(m[3]) as Intent } : null;
}

const failingOf = (t: Turn) => t.checks.filter((c) => !c.ok);
const misfit = (t: Turn) => t.checks.some((c) => c.kind === "persona" && !c.ok);

/** The persona's journeys, by query order then run. */
function journeysOf(f: JourneysFile, personaId: string): Journey[] {
  const qi = (id: string) => f.queries.findIndex((q) => q.id === id);
  return f.journeys.filter((j) => j.personaId === personaId).sort((a, b) => qi(a.queryId) - qi(b.queryId) || a.run - b.run);
}

/** First journey whose turn at `intent` doesn't fit the persona, else any failing check there, else the first that reached it. */
export function pickDrill(f: JourneysFile, personaId: string, intent: Intent): { journeyId: string; turn: number } | null {
  const js = journeysOf(f, personaId);
  for (const test of [misfit, (t: Turn) => failingOf(t).length > 0, () => true]) {
    for (const j of js) {
      const t = j.turns.find((x) => x.intent === intent && test(x));
      if (t) return { journeyId: j.id, turn: j.turns.indexOf(t) };
    }
  }
  return js[0] ? { journeyId: js[0].id, turn: 0 } : null;
}

/** "Seat-together status is shown" → "Seat-together status isn't shown". */
function negate(label: string): string {
  const out = label
    .replace(/\bis shown\b/, "isn’t shown")
    .replace(/\bare shown\b/, "aren’t shown")
    .replace(/\bis\b/, "isn’t")
    .replace(/\bare\b/, "aren’t")
    .replace(/\bshows\b/, "doesn’t show")
    .replace(/\bsays\b/, "doesn’t say");
  return out === label ? `Not met: ${label}` : out;
}

const KIND_PLAIN: Record<string, string> = {
  grounding: "Not in fare data",
  carry: "Lost between turns",
  goal: "Goal missed",
  schema: "Broken screen",
};

function plain(c: CheckResult, p: Persona | undefined): { head: string; body: string; tag: string; persona: boolean } {
  if (c.kind === "persona") {
    const fromMemory = p?.memory ? ` (assistant memory: ${p.memory})` : "";
    return { head: negate(contractLabel(c)), body: `${checkReason(c)}${fromMemory}`, tag: c.source === "judge" ? "Persona · judge" : "Persona · rule", persona: true };
  }
  return { head: KIND_PLAIN[c.kind] ?? cap(c.kind), body: c.message, tag: c.kind, persona: false };
}

const IconArrow = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

interface Props {
  drill: Drill;
  onDrill: (d: Drill) => void;
  onBack: (mode: HeroMode) => void;
  onCanvas: () => void;
}

export function PersonaFlow({ drill, onDrill, onBack, onCanvas }: Props) {
  const [files, setFiles] = useState<{ checked: JourneysFile | null; naive: JourneysFile | null } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadJourneys(), loadNaiveJourneys()]).then(([c, n]) => {
      if (live) setFiles({ checked: c?.file ?? null, naive: n });
    });
    return () => {
      live = false;
    };
  }, []);

  const file = files ? (drill.mode === "naive" ? files.naive : files.checked) ?? files.checked : null;
  const initial = useMemo(() => (file ? pickDrill(file, drill.personaId, drill.intent) : null), [file, drill.personaId, drill.intent]);
  const [sel, setSel] = useState<{ journeyId: string; turn: number } | null>(null);
  useEffect(() => setSel(initial), [initial]);
  // Keep the selected turn visible in the strip (narrow screens scroll it sideways).
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".pf-turn.is-on");
    const strip = el?.parentElement;
    if (el && strip) strip.scrollTo({ left: Math.max(0, el.offsetLeft - strip.offsetLeft - 12) });
  }, [sel]);

  useEffect(() => {
    document.querySelector(".page")?.scrollTo({ top: 0 });
  }, [drill.personaId, drill.intent, drill.mode]);

  if (!files) {
    return (
      <div className="loading">
        <span className="spinner" /> Loading journeys…
      </div>
    );
  }
  if (!file) return <div className="page-stub">No journeys found.</div>;

  const p = file.personas.find((x) => x.id === drill.personaId);
  const js = journeysOf(file, drill.personaId);
  const cur = sel ?? initial;
  const j = js.find((x) => x.id === cur?.journeyId) ?? js[0];
  if (!p || !j) return <div className="page-stub">No journeys for this traveler.</div>;
  const turnIdx = Math.min(cur?.journeyId === j.id ? cur.turn : 0, j.turns.length - 1);
  const t = j.turns[turnIdx];
  const q = file.queries.find((x) => x.id === j.queryId);
  const failing = t ? failingOf(t) : [];
  const naiveAvail = !!files.naive;

  const setTurn = (i: number) => setSel({ journeyId: j.id, turn: i });
  const openJourney = (x: Journey) => {
    const at = x.turns.findIndex((tt) => tt.intent === t?.intent && failingOf(tt).length);
    const any = x.turns.findIndex((tt) => tt.intent === t?.intent);
    setSel({ journeyId: x.id, turn: Math.max(0, at >= 0 ? at : any) });
  };

  return (
    <div className="jr pf" data-persona-flow data-mode={drill.mode}>
      <header className="pf-head">
        <div className="pf-head__row">
          <button className="icon-btn icon-btn--sm" onClick={() => onBack(drill.mode)} aria-label="Back to Tests" title="Back to Tests" data-back>
            <IconBack width={15} height={15} />
          </button>
          {p.photo ? <img className="pf-avatar" src={p.photo} alt="" width={40} height={40} /> : <span className="pf-avatar" />}
          <div className="pf-who">
            <div className="pf-name">{p.name ?? laneName(p)}</div>
            <div className="pf-tags">
              {contextChips(p).map((c) => (
                <span key={c} className="pf-tag">
                  {c}
                </span>
              ))}
            </div>
          </div>
          <div className="pf-head__end">
            {naiveAvail ? (
              <div className="tp-seg pf-seg" role="tablist" aria-label="Dataset">
                <button role="tab" aria-selected={drill.mode === "naive"} className={drill.mode === "naive" ? "is-on" : ""} onClick={() => onDrill({ ...drill, mode: "naive" })}>
                  Generic
                </button>
                <button role="tab" aria-selected={drill.mode === "checked"} className={drill.mode === "checked" ? "is-on" : ""} onClick={() => onDrill({ ...drill, mode: "checked" })}>
                  Persona-aware
                </button>
              </div>
            ) : (
              <span className="pf-badge">Persona-aware</span>
            )}
            <button className="btn pf-canvas" onClick={onCanvas} title="Open the flow canvas">
              Canvas
            </button>
          </div>
        </div>
        <div className="pf-query">
          <span className="muted">Asked</span> “{q?.text ?? j.queryId}”
        </div>
        <div className="pf-pills" role="tablist" aria-label="Journeys">
          {js.map((x) => {
            const bad = x.turns.some((tt) => failingOf(tt).length);
            const qq = file.queries.find((y) => y.id === x.queryId);
            return (
              <button key={x.id} role="tab" aria-selected={x.id === j.id} className={`pf-pill${x.id === j.id ? " is-on" : ""}`} onClick={() => openJourney(x)} title={qq?.text} data-journey={x.id}>
                <span className={`dot dot--${bad ? "fail" : "pass"}`} />
                {truncate(qq?.text ?? x.queryId, 26)} · run {x.run + 1}
              </button>
            );
          })}
        </div>
      </header>

      <section className="pf-strip" aria-label="The flow">
        {j.turns.map((x, i) => {
          const bad = failingOf(x).length > 0;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <span className="pf-arrow" aria-hidden="true">
                  <IconArrow />
                </span>
              )}
              <button className={`pf-turn${i === turnIdx ? " is-on" : ""} ${bad ? "is-bad" : "is-ok"}`} onClick={() => setTurn(i)} aria-current={i === turnIdx ? "step" : undefined} data-turn={i} data-intent={x.intent}>
                <span className="pf-turn__top">
                  <span className="pf-intent">
                    {i + 1} · {cap(x.intent)}
                  </span>
                  <span className={`pf-status ${bad ? "is-bad" : "is-ok"}`}>{bad ? `${failingOf(x).length} failing` : "pass"}</span>
                </span>
                <span className="pf-thumb">
                  <CircledScreen screen={x.screen} width={112} mode="thumb" failing={failingOf(x)} tags={false} />
                </span>
                <span className="pf-action" title={x.userAction}>
                  {truncate(x.userAction, 60)}
                </span>
              </button>
            </Fragment>
          );
        })}
        <span className="pf-arrow" aria-hidden="true">
          <IconArrow />
        </span>
        <span className={`pf-outcome ${j.goalMet ? "is-ok" : "is-bad"}`}>
          {cap(j.outcome)}
          <span className="muted small">{j.goalMet ? "goal met" : "goal not met"}</span>
        </span>
      </section>

      {t && (
        <section className={`pf-why ${failing.length ? (failing.some((c) => c.kind !== "persona") ? "is-bad" : "is-warn") : "is-ok"}`} data-why aria-live="polite">
          <h2 className="pf-why__h">
            {failing.length
              ? `Why it failed · turn ${turnIdx + 1}, ${cap(t.intent)} · ${failing.length} check${failing.length === 1 ? "" : "s"}`
              : `Turn ${turnIdx + 1}, ${cap(t.intent)} passed every check`}
          </h2>
          {failing.length > 0 && (
            <ul className="pf-why__list">
              {failing.map((c, i) => {
                const x = plain(c, p);
                return (
                  <li key={i} className={x.persona ? "is-warn" : "is-bad"}>
                    <span className="pf-why__tag">{x.tag}</span>
                    <span>
                      <b>{x.head}</b> — {x.body}
                      {c.componentId && <span className="muted"> · circled on screen: {c.componentId.replace(/_/g, " ")}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {failing.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing for {shortPersona(p).replace(/^The /, "")} to trip on at this step.</p>}
        </section>
      )}

      <JourneyView file={file} journey={j} turn={turnIdx} onTurn={setTurn} />
    </div>
  );
}
