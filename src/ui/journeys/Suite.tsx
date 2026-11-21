import { useMemo } from "react";
import type { JourneysFile, SuiteSummary } from "../../journeys/types";
import { buildIntentGraph, matrix, summarize } from "./agg";
import { pct, shortPersona, sortQueries, tone } from "./data";
import { IntentTree } from "./IntentTree";

const METRICS: { key: keyof Omit<SuiteSummary, "failingChecks">; label: string; fmt: (v: number) => string }[] = [
  { key: "journeys", label: "Journeys", fmt: (v) => String(v) },
  { key: "passRate", label: "Pass rate", fmt: pct },
  { key: "goalRate", label: "Goal met", fmt: pct },
  { key: "bookedRate", label: "Booked", fmt: pct },
  { key: "pinnedShare", label: "Turns on pinned UI", fmt: pct },
];

export function Suite({ file, onOpen }: { file: JourneysFile; onOpen: (queryId: string, personaId?: string) => void }) {
  const summary = useMemo(() => summarize(file.journeys), [file]);
  const cells = useMemo(() => matrix(file.journeys, file.queries, file.personas), [file]);
  const graph = useMemo(() => buildIntentGraph(file.journeys, file.personas), [file]);
  const prev = file.previous;
  const queries = sortQueries(file.queries);
  const turns = file.journeys.reduce((n, j) => n + j.turns.length, 0);
  const failing = Object.entries(summary.failingChecks).filter(([, n]) => n > 0);

  return (
    <div className="jr-suite">
      <section className="jr-metrics" aria-label="Suite metrics">
        {METRICS.map((m) => {
          const now = summary[m.key];
          const before = prev?.[m.key];
          const delta = before === undefined ? 0 : now - before;
          return (
            <div className="jr-metric" key={m.key}>
              <span className="jr-metric__label">{m.label}</span>
              <span className="jr-metric__value">
                {before !== undefined && before !== now && (
                  <>
                    <span className="jr-metric__before">{m.fmt(before)}</span>
                    <span className="jr-metric__arrow">→</span>
                  </>
                )}
                {m.fmt(now)}
              </span>
              {before !== undefined && m.key !== "journeys" && Math.abs(delta) >= 0.005 && (
                <span className={`jr-metric__delta ${delta > 0 ? "tone-good" : "tone-bad"}`}>
                  {delta > 0 ? "+" : ""}
                  {Math.round(delta * 100)} pts
                </span>
              )}
            </div>
          );
        })}
      </section>
      {failing.length > 0 && (
        <p className="jr-fails">
          Failing checks:{" "}
          {failing.map(([k, n]) => (
            <span key={k} className="badge badge--bad">
              {n} {k}
            </span>
          ))}
        </p>
      )}

      <section className="jr-card">
        <header className="jr-card__head">
          <h2>Queries × people</h2>
          <span className="muted small">Pass rate and goal met over runs. Click a cell or a query.</span>
        </header>
        <div className="jr-grid-scroll">
          <table className="jr-grid">
            <thead>
              <tr>
                <th className="jr-grid__q">Query</th>
                {file.personas.map((p) => (
                  <th key={p.id}>
                    <span className="jr-grid__who">{shortPersona(p)}</span>
                    <span className="jr-grid__sub">{p.label.split(" · ").slice(1).join(" · ")}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr key={q.id}>
                  <th className="jr-grid__q">
                    <button className="jr-qbtn" onClick={() => onOpen(q.id)} data-query={q.id}>
                      {q.hero && <span className="badge badge--accent">hero</span>}
                      <span>{q.text}</span>
                    </button>
                  </th>
                  {file.personas.map((p) => {
                    const c = cells.find((x) => x.queryId === q.id && x.personaId === p.id);
                    if (!c || !c.runs) return <td key={p.id} className="jr-cell jr-cell--empty">no runs</td>;
                    return (
                      <td key={p.id}>
                        <button className={`jr-cell tone-bg-${tone(c.passRate)}`} onClick={() => onOpen(q.id, p.id)} data-cell={`${q.id}:${p.id}`}>
                          <span className="jr-cell__pass">{pct(c.passRate)}</span>
                          <span className="jr-cell__meta">
                            goal {pct(c.goalRate)} · {c.runs} run{c.runs === 1 ? "" : "s"}
                            {c.booked ? ` · ${c.booked} booked` : ""}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="jr-card">
        <header className="jr-card__head">
          <h2>Derived intent tree</h2>
          <span className="muted small">
            Built from {file.journeys.length} sessions ({turns} turns) — nobody drew this flow.
          </span>
        </header>
        <IntentTree graph={graph} personas={file.personas} journeys={file.journeys} />
      </section>
    </div>
  );
}
