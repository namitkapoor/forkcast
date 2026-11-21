import { useMemo } from "react";
import type { JourneysFile, SuiteSummary } from "../../journeys/types";
import { buildIntentGraph, summarize } from "./agg";
import { pct } from "./data";
import { Hero } from "./Hero";
import { IntentTree } from "./IntentTree";

const METRICS: { label: string; get: (s: SuiteSummary) => number; fmt: (v: number) => string; lowerIsBetter?: boolean }[] = [
  { label: "Journeys with zero errors", get: (s) => s.passRate, fmt: pct },
  { label: "Made-up facts on screen", get: (s) => s.failingChecks.grounding, fmt: (v) => String(v), lowerIsBetter: true },
  { label: "Goal met", get: (s) => s.goalRate, fmt: pct },
  { label: "Turns on pinned UI", get: (s) => s.pinnedShare, fmt: pct },
];

interface Props {
  file: JourneysFile;
  /** File the hero reads (unpinned turns when available); metrics and tree stay on `file`. */
  heroFile: JourneysFile;
  queryId: string;
  turn: number;
  onQuery: (id: string) => void;
  onTurn: (i: number) => void;
  onOpen: (queryId: string, personaId: string, run: number, turn: number) => void;
}

export function Suite({ file, heroFile, queryId, turn, onQuery, onTurn, onOpen }: Props) {
  const summary = useMemo(() => summarize(file.journeys), [file]);
  const graph = useMemo(() => buildIntentGraph(file.journeys, file.personas), [file]);
  const before = file.baseline?.summary ?? file.previous;
  const turns = file.journeys.reduce((n, j) => n + j.turns.length, 0);

  return (
    <div className="jr-suite">
      <Hero file={heroFile} queryId={queryId} turn={turn} onQuery={onQuery} onTurn={onTurn} onOpen={(personaId, run, t) => onOpen(queryId, personaId, run, t)} />

      {before && (
        <section className="jr-strip" aria-label="Before and after">
          <div className="jr-strip__legend">
            <span className="muted">{file.baseline ? `Naive prompt (${file.baseline.promptVersion})` : "Before"}</span>
            <span className="jr-strip__arrow">→</span>
            <span>Grounded + pinned</span>
          </div>
          {METRICS.map((m) => {
            const a = m.get(before);
            const b = m.get(summary);
            const better = m.lowerIsBetter ? b < a : b > a;
            return (
              <div className="jr-strip__item" key={m.label}>
                <span className="jr-strip__label">{m.label}</span>
                <span className="jr-strip__value">
                  <span className="muted">{m.fmt(a)}</span>
                  <span className="jr-strip__arrow">→</span>
                  <span className={a === b ? "" : better ? "tone-good" : "tone-bad"}>{m.fmt(b)}</span>
                </span>
              </div>
            );
          })}
        </section>
      )}

      <section className="jr-card">
        <header className="jr-card__head">
          <h2>The flow people actually took</h2>
          <span className="muted small">
            Built from {file.journeys.length} journeys ({turns} turns), nobody drew it. Each box is what people were trying to do, with each traveler’s pass rate.
          </span>
        </header>
        <IntentTree graph={graph} personas={file.personas} journeys={file.journeys} />
      </section>
    </div>
  );
}
