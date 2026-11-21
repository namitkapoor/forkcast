// Headless run: simulate traces, fold them, run checks, print coverage.
// Usage: npm run check            (with the seeded price-drift bug)
//        npm run check -- --clean (bug off)
import { foldTraces } from "../src/graph/fold";
import { runChecks } from "../src/checks/run";
import { coverage } from "../src/checks/coverage";
import { flightGraph, flightInvariants } from "../src/domains/flights/graph";
import { simulateFlights } from "../src/domains/flights/simulate";

const clean = process.argv.includes("--clean");
const traces = simulateFlights({ traces: 500, seed: 42, priceDriftBug: clean ? 0 : 0.05 });
const folded = foldTraces(flightGraph, traces);
const report = runChecks(flightGraph, flightInvariants, traces);
const cov = coverage(flightGraph, folded);

const completed = traces.filter((t) => t.outcome === "completed").length;
console.log(`traces: ${traces.length} (${completed} completed)`);
console.log(`edges exercised: ${cov.edgesExercised}/${cov.edgesTotal}; 95% of traffic on ${cov.edgesFor95} edges`);
if (cov.untested.length) console.log(`untested: ${cov.untested.join(", ")}`);
if (folded.unknownEdges.size) console.log(`undeclared edges walked: ${[...folded.unknownEdges.keys()].join(", ")}`);
console.log(`failures: ${report.failures.length} on edges [${[...report.failingEdges].join(", ")}] nodes [${[...report.failingNodes].join(", ")}]`);
for (const f of report.failures.slice(0, 3)) console.log(`  ${f.traceId}#${f.stepIndex} ${f.message}`);

if (clean && report.failures.length) process.exit(1);
if (!clean && !report.failingEdges.has("passengers->payment")) {
  console.error("expected the seeded price-drift bug on passengers->payment to be caught");
  process.exit(1);
}
