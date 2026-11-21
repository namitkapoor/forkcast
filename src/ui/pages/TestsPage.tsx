import { Fragment, useEffect, useMemo, useState } from "react";
import { edgeKey, type Context, type Trace } from "../../graph/types";
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

function ctxKey(c: Context): string {
  const rest: Record<string, string> = {};
  for (const k of Object.keys(c).sort()) if (k !== "route") rest[k] = c[k];
  return JSON.stringify(rest);
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
  const { graph, traces, invariants, report, cov, lastRun, onRunTests, onOpenEdge, onOpenNode, onReplay } = p;

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

  const matrix = useMemo(() => {
    const groups = new Map<string, { label: string; traces: Trace[] }>();
    for (const t of traces) {
      const k = ctxKey(t.context);
      const g = groups.get(k);
      if (g) g.traces.push(t);
      else groups.set(k, { label: ctxLabel(t.context), traces: [t] });
    }
    const failuresByTrace = new Map<string, Failure[]>();
    for (const f of report.failures) {
      const arr = failuresByTrace.get(f.traceId);
      if (arr) arr.push(f);
      else failuresByTrace.set(f.traceId, [f]);
    }
    const nodeOfFailure = (f: Failure) => (f.kind === "invariant" ? f.where : f.where.split("->")[1] ?? f.where);

    return [...groups.entries()]
      .map(([key, g]) => {
        const cells = new Map<string, { sessions: number; failures: number }>();
        for (const n of graph.nodes) cells.set(n.id, { sessions: 0, failures: 0 });
        for (const t of g.traces) {
          for (const id of new Set(t.steps.map((s) => s.node))) {
            const c = cells.get(id);
            if (c) c.sessions++;
          }
          for (const f of failuresByTrace.get(t.id) ?? []) {
            const c = cells.get(nodeOfFailure(f));
            if (c) c.failures++;
          }
        }
        return { key, label: g.label, count: g.traces.length, cells };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graph, traces, report]);

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

      <section className="tp-card">
        <div className="tp-card-head">
          <h2 className="tp-h2">By traveler type</h2>
          <span className="tp-legend">
            <span className="tp-legend-item">
              <span className="tp-cell tp-cell--ok tp-cell--sw" /> Passing
            </span>
            <span className="tp-legend-item">
              <span className="tp-cell tp-cell--bad tp-cell--sw" /> Failing
            </span>
            <span className="tp-legend-item">
              <span className="tp-cell tp-cell--none tp-cell--sw" /> Not visited
            </span>
          </span>
        </div>
        <div className="tp-matrix-wrap">
          <table className="tp-matrix">
            <thead>
              <tr>
                <th className="tp-mx-corner">Traveler</th>
                {graph.nodes.map((n) => (
                  <th key={n.id} className="tp-mx-col" title={n.label}>
                    <span>{n.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.key}>
                  <th className="tp-mx-row" scope="row">
                    <span className="tp-mx-label">{row.label}</span>
                    <span className="tp-mx-n">{row.count}</span>
                  </th>
                  {graph.nodes.map((n) => {
                    const c = row.cells.get(n.id)!;
                    const state = c.failures ? "bad" : c.sessions ? "ok" : "none";
                    return (
                      <td key={n.id}>
                        <button
                          type="button"
                          className={`tp-cell tp-cell--${state}`}
                          title={`${n.label}: ${plural(c.sessions, "session")} · ${plural(c.failures, "failure")}`}
                          aria-label={`${row.label}, ${n.label}: ${plural(c.sessions, "session")}, ${plural(c.failures, "failure")}`}
                          onClick={() => onOpenNode(n.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
