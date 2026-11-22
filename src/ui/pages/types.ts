import type { FlowGraph, Invariant, Trace } from "../../graph/types";
import type { FoldedGraph } from "../../graph/fold";
import type { CheckReport } from "../../checks/run";
import type { Coverage } from "../../checks/coverage";
import type { Intent } from "../../journeys/types";

// Props contract for the full-page Tests view. App.tsx owns the data and wiring.

export interface TestsPageProps {
  graph: FlowGraph;
  traces: Trace[];
  invariants: Invariant[];
  report: CheckReport;
  folded: FoldedGraph;
  cov: Coverage;
  /** Epoch ms of the last check run. */
  lastRun: number;
  /** Re-run every invariant and contract over the loaded traces (synchronous, instant). */
  onRunTests: () => void;
  /** Persona matrix cell/row → the Flows page persona view for that traveler, intent and dataset. */
  onOpenPersona?: (mode: "naive" | "checked", personaId: string, intent: Intent) => void;
  /** Jump to the Flow page focused on that edge (key "from->to") / node. */
  onOpenEdge: (key: string) => void;
  onOpenNode: (id: string) => void;
  /** Jump to the Flow page and step through this session's screens. */
  onReplay: (traceId: string) => void;
}
