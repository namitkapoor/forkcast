import { useMemo, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "./canvas/Canvas";
import { foldTraces } from "./graph/fold";
import { runChecks } from "./checks/run";
import { coverage } from "./checks/coverage";
import { STAGES, flightGraph, flightInvariants } from "./domains/flights/graph";
import { simulateFlights } from "./domains/flights/simulate";

export function App() {
  const [bug, setBug] = useState(true);
  const [seed, setSeed] = useState(42);

  const { folded, report, cov, completed } = useMemo(() => {
    const traces = simulateFlights({ traces: 500, seed, priceDriftBug: bug ? 0.05 : 0 });
    const folded = foldTraces(flightGraph, traces);
    return {
      folded,
      report: runChecks(flightGraph, flightInvariants, traces),
      cov: coverage(flightGraph, folded),
      completed: traces.filter((t) => t.outcome === "completed").length,
    };
  }, [bug, seed]);

  return (
    <div className="app">
      <aside className="panel">
        <h1>Forkcast</h1>
        <p className="muted">Flight booking · {folded.traceCount} simulated sessions</p>

        <section>
          <h2>Coverage</h2>
          <p>
            <strong>{cov.edgesExercised}</strong> of {cov.edgesTotal} transitions exercised
          </p>
          <p>
            95% of traffic runs over <strong>{cov.edgesFor95}</strong> transitions
          </p>
          <p>{Math.round((completed / folded.traceCount) * 100)}% of sessions completed a booking</p>
        </section>

        <section>
          <h2>Failures ({report.failures.length})</h2>
          {[...report.failingEdges, ...report.failingNodes].map((w) => (
            <p key={w} className="bad">{w}</p>
          ))}
          {report.failures[0] && <p className="muted small">e.g. {report.failures[0].message}</p>}
        </section>

        <section className="controls">
          <label>
            <input type="checkbox" checked={bug} onChange={(e) => setBug(e.target.checked)} /> Seed price-drift bug
          </label>
          <button onClick={() => setSeed((s) => s + 1)}>Re-run simulation (seed {seed})</button>
        </section>

        <p className="muted small">Zoom out for the whole flow, in for stats, further in for the screens generated at each state.</p>
      </aside>
      <main className="stage">
        <ReactFlowProvider>
          <Canvas graph={flightGraph} stages={STAGES} folded={folded} report={report} />
        </ReactFlowProvider>
      </main>
    </div>
  );
}
