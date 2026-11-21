import { edgeKey, type FlowGraph, type Invariant, type Trace } from "../graph/types";

export interface Failure {
  traceId: string;
  stepIndex: number;
  kind: "invariant" | "contract";
  /** Node id for invariant failures, edge key for contract failures. */
  where: string;
  message: string;
}

export interface CheckReport {
  failures: Failure[];
  failingNodes: Set<string>;
  failingEdges: Set<string>;
}

/** Run every component invariant on every step, and every edge contract on every jump. */
export function runChecks(graph: FlowGraph, invariants: Invariant[], traces: Trace[]): CheckReport {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const transitionByKey = new Map(graph.transitions.map((t) => [edgeKey(t.from, t.to), t]));
  const byComponent = new Map<string, Invariant[]>();
  for (const inv of invariants) {
    byComponent.set(inv.component, [...(byComponent.get(inv.component) ?? []), inv]);
  }

  const failures: Failure[] = [];

  for (const trace of traces) {
    trace.steps.forEach((step, i) => {
      const node = nodeById.get(step.node);
      for (const inv of byComponent.get(node?.component ?? "") ?? []) {
        const message = inv.check(step.props);
        if (message) {
          failures.push({ traceId: trace.id, stepIndex: i, kind: "invariant", where: step.node, message: `${inv.id}: ${message}` });
        }
      }

      if (i === 0) return;
      const prev = trace.steps[i - 1];
      const key = edgeKey(prev.node, step.node);
      for (const prop of transitionByKey.get(key)?.contract?.carries ?? []) {
        if (prev.props[prop] !== step.props[prop]) {
          failures.push({
            traceId: trace.id,
            stepIndex: i,
            kind: "contract",
            where: key,
            message: `"${prop}" changed across ${key}: ${String(prev.props[prop])} → ${String(step.props[prop])}`,
          });
        }
      }
    });
  }

  return {
    failures,
    failingNodes: new Set(failures.filter((f) => f.kind === "invariant").map((f) => f.where)),
    failingEdges: new Set(failures.filter((f) => f.kind === "contract").map((f) => f.where)),
  };
}
