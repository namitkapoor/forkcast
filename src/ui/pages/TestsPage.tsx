import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { edgeKey, type Context } from "../../graph/types";
import { INTENTS, type Intent, type JourneysFile, type Persona } from "../../journeys/types";
import { buildIntentGraph } from "../../journeys/aggregate";
import { cap, laneName, loadJourneys, loadNaiveJourneys, type HeroMode } from "../journeys/data";
import { IconDevice, IconPerson } from "../icons";
import type { Failure } from "../../checks/run";
import type { TestsPageProps } from "./types";
import "./testsPage.css";

const MAX_SESSIONS = 8;
const CTX_ORDER = ["party", "surface", "currency", "trip"];

type Status = "fail" | "pass" | "untested";

interface CheckRow {
  id: string;
  kind: "invariant" | "contract";
  name: string;
  description: string;
  carries?: string[];
  where: string;
  /** Node id (invariant) or edge key (contract) targets for "Show on canvas". */
  targets: { kind: "node" | "edge"; id: string; label: string }[];
  steps: number;
  failures: Failure[];
  failingSessions: number;
  status: Status;
}

function ctxLabel(c: Context): string {
  const keys = Object.keys(c).filter((k) => k !== "route");
  keys.sort((a, b) => {
    const ia = CTX_ORDER.indexOf(a);
    const ib = CTX_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((k) => c[k]).join(" · ");
}

function relTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function TestsPage(p: TestsPageProps) {
  const { graph, traces, invariants, report, cov, lastRun, onRunTests, onOpenEdge, onOpenNode, onReplay, onOpenPersona } = p;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, [lastRun]);

  const [open, setOpen] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const traceById = useMemo(() => new Map(traces.map((t) => [t.id, t])), [traces]);

  const rows = useMemo<CheckRow[]>(() => {
    // Step counts per component and jump counts per edge.
    const stepsByComponent = new Map<string, number>();
    const jumpsByEdge = new Map<string, number>();
    for (const t of traces) {
      t.steps.forEach((s, i) => {
        const comp = nodeById.get(s.node)?.component;
        if (comp) stepsByComponent.set(comp, (stepsByComponent.get(comp) ?? 0) + 1);
        if (i > 0) {
          const k = edgeKey(t.steps[i - 1].node, s.node);
          jumpsByEdge.set(k, (jumpsByEdge.get(k) ?? 0) + 1);
        }
      });
    }

    const out: CheckRow[] = [];
    for (const inv of invariants) {
      const nodes = graph.nodes.filter((n) => n.component === inv.component);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const failures = report.failures.filter(
        (f) => f.kind === "invariant" && nodeIds.has(f.where) && f.message.startsWith(`${inv.id}:`),
      );
      const steps = stepsByComponent.get(inv.component) ?? 0;
      out.push({
        id: `inv:${inv.id}`,
        kind: "invariant",
        name: inv.id,
        description: inv.description,
        where: nodes.length ? nodes.map((n) => n.label).join(", ") : inv.component,
        targets: nodes.map((n) => ({ kind: "node", id: n.id, label: n.label })),
        steps,
        failures,
        failingSessions: new Set(failures.map((f) => f.traceId)).size,
        status: failures.length ? "fail" : steps ? "pass" : "untested",
      });
    }
    for (const tr of graph.transitions) {
      const carries = tr.contract?.carries;
      if (!carries?.length) continue;
      const key = edgeKey(tr.from, tr.to);
      const failures = report.failures.filter((f) => f.kind === "contract" && f.where === key);
      const steps = jumpsByEdge.get(key) ?? 0;
      const fromTo = `${nodeById.get(tr.from)?.label ?? tr.from} → ${nodeById.get(tr.to)?.label ?? tr.to}`;
      out.push({
        id: `edge:${key}`,
        kind: "contract",
        name: "Carries across jump",
        description: `Values must match on both sides of ${fromTo}`,
        carries,
        where: fromTo,
        targets: [{ kind: "edge", id: key, label: fromTo }],
        steps,
        failures,
        failingSessions: new Set(failures.map((f) => f.traceId)).size,
        status: failures.length ? "fail" : steps ? "pass" : "untested",
      });
    }
    const rank: Record<Status, number> = { fail: 0, pass: 1, untested: 2 };
    return out
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank[a.r.status] - rank[b.r.status] || b.r.failures.length - a.r.failures.length || a.i - b.i)
      .map(({ r }) => r);
  }, [graph, traces, invariants, report, nodeById]);

  const failingCount = rows.filter((r) => r.status === "fail").length;

  return (
    <div className="tp">
      <header className="tp-head">
        <div className="tp-head-main">
          <h1 className="tp-title">Tests</h1>
          <p className="tp-summary">
            <span>{plural(rows.length, "check")}</span>
            <span className="tp-sep">·</span>
            <span className={failingCount ? "tp-bad" : "tp-ok"}>{failingCount} failing</span>
            <span className="tp-sep">·</span>
            <span>{plural(traces.length, "session")}</span>
            <span className="tp-sep">·</span>
            <span>
              {cov.edgesExercised} of {cov.edgesTotal} transitions exercised
            </span>
            <span className="tp-sep">·</span>
            <span>{plural(cov.edgesFor95, "edge")} carry 95% of traffic</span>
          </p>
        </div>
        <div className="tp-head-actions">
          <span className="tp-ran muted" title={new Date(lastRun).toLocaleString()}>
            Ran {relTime(now - lastRun)}
          </span>
          <button type="button" className="btn btn--primary" onClick={onRunTests}>
            Run tests
          </button>
        </div>
      </header>

      <PersonaMatrix onOpen={onOpenPersona} />

      <section className="tp-card">
        <div className="tp-card-head">
          <h2 className="tp-h2">Checks</h2>
          <span className="tp-card-note muted">Component invariants and edge contracts, failing first</span>
        </div>
        <div className="tp-table" role="table">
          <div className="tp-tr tp-tr--head" role="row">
            <span role="columnheader" aria-label="Status" />
            <span role="columnheader">Check</span>
            <span role="columnheader">Where</span>
            <span role="columnheader" className="tp-num">Steps</span>
            <span role="columnheader" className="tp-num">Failures</span>
            <span role="columnheader" className="tp-num">Sessions</span>
          </div>
          {rows.map((r) => {
            const isOpen = open === r.id;
            const firstByTrace: Failure[] = [];
            if (isOpen) {
              const seen = new Set<string>();
              for (const f of r.failures) {
                if (seen.has(f.traceId)) continue;
                seen.add(f.traceId);
                firstByTrace.push(f);
              }
            }
            return (
              <Fragment key={r.id}>
                <button
                  type="button"
                  role="row"
                  aria-expanded={isOpen}
                  className={`tp-tr tp-row${isOpen ? " is-open" : ""}`}
                  onClick={() => setOpen(isOpen ? null : r.id)}
                >
                  <span role="cell" className="tp-dotcell">
                    <span className={`tp-dot tp-dot--${r.status}`} title={r.status === "untested" ? "Not run" : r.status === "fail" ? "Failing" : "Passing"} />
                  </span>
                  <span role="cell" className="tp-check">
                    <span className="tp-check-name">
                      {r.kind === "invariant" ? <code className="tp-code">{r.name}</code> : r.name}
                      {r.carries?.map((c) => (
                        <code key={c} className="tp-carry">
                          {c}
                        </code>
                      ))}
                    </span>
                    <span className="tp-check-desc">{r.description}</span>
                  </span>
                  <span role="cell" className="tp-where">
                    {r.where}
                  </span>
                  <span role="cell" className="tp-num">
                    <span className="tp-mlabel">Steps </span>
                    {r.steps}
                  </span>
                  <span role="cell" className={`tp-num${r.failures.length ? " tp-bad" : ""}`}>
                    <span className="tp-mlabel">Failures </span>
                    {r.failures.length}
                  </span>
                  <span role="cell" className={`tp-num${r.failingSessions ? " tp-bad" : ""}`}>
                    <span className="tp-mlabel">Sessions </span>
                    {r.failingSessions}
                  </span>
                </button>
                {isOpen && (
                  <div className="tp-detail">
                    {firstByTrace.length === 0 ? (
                      <p className="tp-empty muted">
                        {r.status === "untested" ? "No session has reached this yet." : `Passing on all ${plural(r.steps, "step")}.`}
                      </p>
                    ) : (
                      <ul className="tp-sessions">
                        {firstByTrace.slice(0, MAX_SESSIONS).map((f) => {
                          const t = traceById.get(f.traceId);
                          return (
                            <li key={f.traceId} className="tp-session">
                              <div className="tp-session-main">
                                <div className="tp-session-top">
                                  <code className="tp-code">{f.traceId}</code>
                                  {t && <span className="muted">{ctxLabel(t.context)}</span>}
                                  <span className="muted">step {f.stepIndex}</span>
                                </div>
                                <div className="tp-session-msg">{f.message}</div>
                              </div>
                              <button type="button" className="btn tp-replay" onClick={() => onReplay(f.traceId)}>
                                Replay
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="tp-detail-foot">
                      {firstByTrace.length > MAX_SESSIONS && (
                        <span className="muted">+{firstByTrace.length - MAX_SESSIONS} more sessions</span>
                      )}
                      {r.targets.map((tg) => (
                        <button
                          key={tg.id}
                          type="button"
                          className="tp-link"
                          onClick={() => (tg.kind === "edge" ? onOpenEdge(tg.id) : onOpenNode(tg.id))}
                        >
                          Show {r.targets.length > 1 ? tg.label : ""} on canvas
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
          {rows.length === 0 && <p className="tp-empty muted">No checks defined.</p>}
        </div>
      </section>

    </div>
  );
}

const IconCoin = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.1-1 2-2.5 2-1.2 0-2.1-.5-2.6-1.3M12 6.5V8m0 8v1.5" />
  </svg>
);
const IconPlane = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 13.5l19-8-6.5 15-3-6.5z" />
  </svg>
);

/** "Maya", "Okafor family", "Sam & Priya": short enough for a tooltip sentence. */
const callName = (p: Persona) => {
  const n = laneName(p);
  return /family|&/.test(n) ? n : n.split(" ")[0];
};

type Cell = { turns: number; misfit: number };

function cellsFor(f: JourneysFile | null): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const j of f?.journeys ?? []) {
    for (const t of j.turns) {
      const k = `${j.personaId}|${t.intent}`;
      const c = out.get(k) ?? { turns: 0, misfit: 0 };
      c.turns++;
      if (t.checks.some((x) => x.kind === "persona" && !x.ok)) c.misfit++;
      out.set(k, c);
    }
  }
  return out;
}

/** The three personas × the intents their journeys reached: does each screen fit the person? */
function PersonaMatrix({ onOpen }: { onOpen?: (mode: HeroMode, personaId: string, intent: Intent) => void }) {
  const [files, setFiles] = useState<{ checked: JourneysFile | null; naive: JourneysFile | null } | null>(null);
  // `#tests/generic` keeps the switch on Generic when coming back from a persona flow.
  const [mode, setModeState] = useState<HeroMode>(() => (typeof window !== "undefined" && window.location.hash.startsWith("#tests/generic") ? "naive" : "checked"));
  const setMode = (m: HeroMode) => {
    setModeState(m);
    try {
      if (window.location.hash.startsWith("#tests")) window.history.replaceState(null, "", m === "naive" ? "#tests/generic" : "#tests");
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    let live = true;
    Promise.all([loadJourneys(), loadNaiveJourneys()]).then(([c, n]) => {
      if (live) setFiles({ checked: c?.file ?? null, naive: n });
    });
    return () => {
      live = false;
    };
  }, []);

  const checked = files?.checked ?? null;
  const naive = files?.naive ?? null;
  const shown = mode === "naive" && naive ? naive : checked;
  const intents = useMemo<Intent[]>(() => {
    const seen: Intent[] = [];
    for (const f of [checked, naive]) {
      if (!f) continue;
      for (const n of buildIntentGraph(f.journeys, f.personas).nodes) if (!seen.includes(n.intent)) seen.push(n.intent);
    }
    const rank = (i: Intent) => ((INTENTS as readonly string[]).indexOf(i) + 1 || 99);
    return seen.sort((a, b) => rank(a) - rank(b));
  }, [checked, naive]);
  const cells = useMemo(() => cellsFor(shown), [shown]);
  const dataMode: HeroMode = mode === "naive" && naive ? "naive" : "checked";
  const open = (personaId: string, intent: Intent) => onOpen?.(dataMode, personaId, intent);
  /** A persona row opens its worst intent: the first red cell, else the first visited one. */
  const rowIntent = (personaId: string) =>
    intents.find((it) => cells.get(`${personaId}|${it}`)?.misfit) ?? intents.find((it) => cells.has(`${personaId}|${it}`));
  const onKey = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <section className="tp-card" data-persona-matrix>
      <div className="tp-card-head">
        <h2 className="tp-h2">By traveler type</h2>
        {naive && (
          <div className="tp-seg" role="tablist" aria-label="Which assistant">
            <button role="tab" aria-selected={mode === "naive"} className={mode === "naive" ? "is-on" : ""} onClick={() => setMode("naive")}>
              Generic
            </button>
            <button role="tab" aria-selected={mode === "checked"} className={mode === "checked" ? "is-on" : ""} onClick={() => setMode("checked")}>
              Persona-aware
            </button>
          </div>
        )}
        <span className="tp-legend">
          <span className="tp-legend-item">
            <span className="tp-cell tp-cell--ok tp-cell--sw" /> Every screen fits
          </span>
          <span className="tp-legend-item">
            <span className="tp-cell tp-cell--bad tp-cell--sw" /> Some don’t fit
          </span>
          <span className="tp-legend-item">
            <span className="tp-cell tp-cell--none tp-cell--sw" /> Not visited
          </span>
        </span>
      </div>
      <p className="tp-caption muted">Empty = no traveler of this type goes here, so no test is needed yet. Red = where to look first.</p>
      {!shown ? (
        <p className="tp-empty muted">{files ? "No journeys recorded yet." : "Loading journeys…"}</p>
      ) : (
        <div className="tp-matrix-wrap">
          <table className="tp-matrix tp-matrix--personas">
            <thead>
              <tr>
                <th className="tp-mx-corner">Traveler</th>
                {intents.map((it) => (
                  <th key={it} className="tp-mx-icol">
                    {cap(it)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.personas.map((p) => {
                const pax = Number(p.context.pax) || 1;
                const desktop = p.context.surface === "fullscreen";
                return (
                  <tr key={p.id} data-persona={p.id}>
                    <th className="tp-mx-row" scope="row">
                      <div
                        className={`tp-mx-person${onOpen && rowIntent(p.id) ? " is-link" : ""}`}
                        {...(onOpen && rowIntent(p.id)
                          ? {
                              role: "button",
                              tabIndex: 0,
                              title: `Open ${callName(p)}’s flow`,
                              onClick: () => open(p.id, rowIntent(p.id)!),
                              onKeyDown: onKey(() => open(p.id, rowIntent(p.id)!)),
                            }
                          : {})}
                      >
                      {p.photo ? <img className="tp-avatar" src={p.photo} alt="" width={36} height={36} /> : <span className="tp-avatar" />}
                      <span className="tp-person">
                        <span className="tp-person-name">{p.name ?? laneName(p)}</span>
                        <span className="tp-tags">
                          <span className="tp-tag" title="Party size">
                            <IconPerson width={12} height={12} /> {pax} traveler{pax === 1 ? "" : "s"}
                          </span>
                          <span className="tp-tag" title="Device">
                            <IconDevice width={12} height={12} /> {desktop ? "desktop" : "phone"}
                          </span>
                          <span className="tp-tag" title="Currency">
                            <IconCoin /> {p.context.currency}
                          </span>
                          <span className="tp-tag" title="Flies from">
                            <IconPlane /> {p.context.origin}
                          </span>
                        </span>
                      </span>
                      </div>
                    </th>
                    {intents.map((it) => {
                      const c = cells.get(`${p.id}|${it}`);
                      const state = !c ? "none" : c.misfit ? "bad" : "ok";
                      const tip = !c
                        ? `No ${callName(p)} journey reached ${cap(it)} — no test needed yet`
                        : c.misfit
                        ? `${callName(p)} · ${cap(it)}: ${c.misfit} of ${c.turns} screen${c.turns === 1 ? "" : "s"} don’t fit`
                        : `${callName(p)} · ${cap(it)}: all ${c.turns} screen${c.turns === 1 ? "" : "s"} fit`;
                      return (
                        <td key={it}>
                          <span
                            className={`tp-cell tp-cell--${state} tp-cell--wide${c && onOpen ? " is-link" : ""}`}
                            title={c && onOpen ? `${tip} — click to see the flow` : tip}
                            aria-label={tip}
                            role={c && onOpen ? "button" : "img"}
                            tabIndex={0}
                            data-cell={`${p.id}|${it}`}
                            onClick={c && onOpen ? () => open(p.id, it) : undefined}
                            onKeyDown={c && onOpen ? onKey(() => open(p.id, it)) : undefined}
                          >
                            {c?.misfit ? c.misfit : null}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
