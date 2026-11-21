import { useEffect, useRef } from "react";
import type { Journey, JourneysFile } from "../../journeys/types";
import { CircledScreen } from "./CircledScreen";
import { cap, shortPersona, turnOk } from "./data";
import { IconLock } from "./icons";

interface Props {
  file: JourneysFile;
  queryId: string;
  runs: Record<string, number>;
  focusPersona?: string;
  onRun: (personaId: string, run: number) => void;
  onOpenTurn: (personaId: string, run: number, turn: number) => void;
}

export function QueryLanes({ file, queryId, runs, focusPersona, onRun, onOpenTurn }: Props) {
  const q = file.queries.find((x) => x.id === queryId);
  const cols = file.personas.map((p) => {
    const all = file.journeys.filter((j) => j.queryId === queryId && j.personaId === p.id).sort((a, b) => a.run - b.run);
    const run = runs[p.id] ?? all[0]?.run ?? 0;
    return { p, all, j: all.find((j) => j.run === run) ?? all[0] };
  });
  const maxTurns = Math.max(0, ...cols.map((c) => c.j?.turns.length ?? 0));
  const n = cols.length;
  const scroller = useRef<HTMLDivElement>(null);

  // Opened from a grid cell: bring that person's column into view (matters when columns scroll sideways).
  useEffect(() => {
    const el = scroller.current;
    const head = focusPersona ? el?.querySelector<HTMLElement>(`[data-lane="${focusPersona}"]`) : null;
    if (el && head && el.scrollWidth > el.clientWidth) el.scrollLeft = head.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft);
  }, [focusPersona, queryId]);

  return (
    <div className="jr-query">
      <h1 className="jr-query__text">“{q?.text ?? queryId}”</h1>
      <p className="muted small jr-query__sub">Same words, {n} people. Each column is one person’s journey; turns line up by index.</p>
      <div className="jr-lanes-scroll" ref={scroller}>
        <div className="jr-lanes" style={{ gridTemplateColumns: `repeat(${n}, minmax(var(--lane-min), 1fr))` }}>
          {cols.map(({ p, all, j }) => (
            <div key={`h-${p.id}`} className={`jr-lane-head${focusPersona === p.id ? " is-focus" : ""}`} data-lane={p.id}>
              <button className="jr-lane-head__title" onClick={() => j && onOpenTurn(p.id, j.run, 0)} title="Open this journey">
                {shortPersona(p)}
                {j && <Outcome j={j} />}
              </button>
              <div className="chips">
                {Object.entries(p.context).map(([k, v]) => (
                  <span className="chip chip--ctx" key={k}>
                    <span>{k}</span> {v}
                  </span>
                ))}
              </div>
              {all.length > 1 && (
                <div className="seg jr-runs" role="tablist" aria-label="Run">
                  {all.map((r) => (
                    <button key={r.run} className={r.run === j?.run ? "is-on" : ""} onClick={() => onRun(p.id, r.run)}>
                      run {r.run + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {Array.from({ length: maxTurns + 1 }, (_, i) =>
            cols.map(({ p, j }) => {
              const t = j?.turns[i];
              if (!j || !t) {
                return (
                  <div key={`${p.id}-${i}`} className="jr-lane-cell jr-lane-cell--end">
                    {j && i === j.turns.length && <span className="muted small">ended · {j.outcome}</span>}
                  </div>
                );
              }
              const ok = turnOk(t);
              return (
                <button key={`${p.id}-${i}`} className="jr-lane-cell jr-turn" onClick={() => onOpenTurn(p.id, j.run, i)} data-turn={`${p.id}:${i}`}>
                  <span className="jr-turn__meta">
                    <span className={`dot dot--${ok ? "pass" : "fail"}`} />
                    <span>Turn {i + 1}</span>
                    <span className="badge">{cap(t.intent)}</span>
                    {t.ingredients.pinned && (
                      <span className="badge badge--accent" title="Pinned layout">
                        <IconLock width={10} height={10} />
                      </span>
                    )}
                  </span>
                  <span className="jr-bubble">{t.userMessage}</span>
                  <CircledScreen screen={t.screen} width={220} failing={t.checks.filter((c) => !c.ok)} tags={false} />
                  <span className="jr-turn__next">→ {t.userAction}</span>
                </button>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

export function Outcome({ j }: { j: Journey }) {
  const ok = j.turns.every(turnOk);
  return (
    <span className={`badge ${ok ? "badge--ok" : "badge--bad"}`} title={j.goalMet ? "Goal met" : "Goal not met"}>
      {j.outcome}
      {j.goalMet ? " · goal" : " · no goal"}
    </span>
  );
}
