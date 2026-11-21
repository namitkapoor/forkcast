import { useCallback, useMemo, useState } from "react";
import type { Intent, JourneysFile, SuiteSummary } from "../../journeys/types";
import { buildIntentGraph, summarize } from "./agg";
import { pct, personaColor, pickJourney, shortPersona, SHOW_PERSONA_CONTRACTS, type HeroMode } from "./data";
import { Hero } from "./Hero";
import { IntentTree, type HeroPath } from "./IntentTree";
import { NodePanel } from "./NodePanel";

const METRICS: { label: string; get: (s: SuiteSummary) => number | undefined; fmt: (v: number) => string; lowerIsBetter?: boolean; title?: string }[] = [
  { label: "Journeys with zero errors", get: (s) => s.passRate, fmt: pct },
  {
    label: "Serves the person",
    get: (s) => (SHOW_PERSONA_CONTRACTS ? s.servesRate : undefined),
    fmt: pct,
    title: "Share of applicable persona-contract checks that pass (rules + Gemini judge), e.g. totals for 4, stops labeled, exclusions stated",
  },
  { label: "Made-up facts on screen", get: (s) => s.failingChecks.grounding, fmt: (v) => String(v), lowerIsBetter: true },
  { label: "Goal met", get: (s) => s.goalRate, fmt: pct },
  { label: "Turns on pinned UI", get: (s) => s.pinnedShare, fmt: pct },
];

interface Props {
  file: JourneysFile;
  /** File the hero reads (unpinned turns when available); metrics and tree stay on `file`. */
  heroFile: JourneysFile;
  /** Hero view: naive-prompt run vs the checked run. Undefined when there is no baseline to compare. */
  mode?: HeroMode;
  onMode: (m: HeroMode) => void;
  queryId: string;
  turn: number;
  onQuery: (id: string) => void;
  onTurn: (i: number) => void;
  onOpen: (queryId: string, personaId: string, run: number, turn: number) => void;
}

export function Suite({ file, heroFile, mode, onMode, queryId, turn, onQuery, onTurn, onOpen }: Props) {
  const summary = useMemo(() => summarize(file.journeys), [file]);
  const graph = useMemo(() => buildIntentGraph(file.journeys, file.personas), [file]);
  const before = file.baseline?.summary ?? file.previous;
  const turns = file.journeys.reduce((n, j) => n + j.turns.length, 0);

  // The hero's journeys, lit on the tree: one path per persona, with where each one is at this turn.
  const heroPaths = useMemo(
    () =>
      heroFile.personas.flatMap((p, i): HeroPath[] => {
        const j = pickJourney(heroFile.journeys, queryId, p.id);
        if (!j?.turns.length) return [];
        const len = j.turns.length;
        return [{ personaId: p.id, name: shortPersona(p), color: personaColor(p.id, i), intents: j.turns.map((t) => t.intent), current: turn > len - 1 ? -1 : turn }];
      }),
    [heroFile, queryId, turn],
  );
  const [openIntent, setOpenIntent] = useState<Intent | null>(null);
  const closePanel = useCallback(() => setOpenIntent(null), []);

  return (
    <div className="jr-suite">
      <Hero file={heroFile} mode={mode} onMode={onMode} queryId={queryId} turn={turn} onQuery={onQuery} onTurn={onTurn} onOpen={(personaId, run, t) => onOpen(queryId, personaId, run, t)} />

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
            if (a === undefined || b === undefined) return null;
            const better = m.lowerIsBetter ? b < a : b > a;
            return (
              <div className="jr-strip__item" key={m.label} title={m.title} data-metric={m.label}>
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
            Built from {file.journeys.length} journeys ({turns} turns). Each box is what people were trying to do, with each traveler’s pass rate.
          </span>
        </header>
        <ol className="it-steps" aria-label="How the flow is built">
          <li>
            <span>
              <b>Each turn is labeled</b> by what the person was trying to do.
            </span>
          </li>
          <li>
            <span>
              <b>Turns with the same intent become one node</b>, however the screen looked.
            </span>
          </li>
          <li>
            <span>
              <b>Arrows count how many people moved</b> between intents. Nobody drew this flow.
            </span>
          </li>
        </ol>
        {heroPaths.length > 0 && (
          <div className="it-legend" aria-label="Travelers from the phones above">
            <span className="it-legend__lead">The phones above, at turn {turn + 1}:</span>
            {heroPaths.map((h) => (
              <span className="it-legend__item" key={h.personaId}>
                <span className="it-legend__dot" style={{ background: h.color }} />
                {h.name}
                {h.current === -1 && <span className="it-legend__state">· done</span>}
              </span>
            ))}
            <span className="it-legend__hint">Click a box to see every screen behind it</span>
          </div>
        )}
        <IntentTree graph={graph} personas={file.personas} journeys={file.journeys} heroPaths={heroPaths} heroTurn={turn} onNodeOpen={setOpenIntent} />
      </section>
      {openIntent && (
        <NodePanel
          file={file}
          intent={openIntent}
          onClose={closePanel}
          // Thumbnails come from journeys.json; the journey view opens the hero's file, so only link when they are the same.
          onOpen={heroFile === file ? (q, p, run, t) => onOpen(q, p, run, t) : undefined}
        />
      )}
    </div>
  );
}
