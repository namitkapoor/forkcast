import type { FlowGraph, Invariant, NodeId, StateNode, Trace, Transition } from "../graph/types";
import type { Screen } from "../a2ui/types";
import type { RunFile } from "../data/run";
import { flightGraph, flightInvariants } from "../domains/flights/graph";
import { simulateFlights } from "../domains/flights/simulate";
import { fixtureScreens } from "../data/fixtures";

export type Source = "run" | "sim";

/** Everything the canvas draws, whichever way it was produced. */
export interface Project {
  title: string;
  source: Source;
  graph: FlowGraph;
  traces: Trace[];
  screens: Screen[];
  invariants: Invariant[];
}

/** Nodes, transitions, screens and manual walkthrough traces added from the canvas. */
export interface Branches {
  nodes: StateNode[];
  transitions: Transition[];
  screens: Screen[];
  traces?: Trace[];
}

export const emptyBranches: Branches = { nodes: [], transitions: [], screens: [], traces: [] };

const TITLES: Record<string, string> = { flights: "Getaway · Flight booking", flight: "Getaway · Flight booking", "flight-booking": "Getaway · Flight booking" };

export function titleFor(domain: string | undefined): string {
  if (!domain) return "Untitled flow";
  if (TITLES[domain]) return TITLES[domain];
  const words = domain.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isRunFile(v: unknown): v is RunFile {
  const r = v as RunFile | null;
  return !!r && Array.isArray(r.graph?.nodes) && Array.isArray(r.graph?.transitions) && Array.isArray(r.traces);
}

export function projectFromRun(run: RunFile): Project {
  const isFlights = /flight/i.test(run.domain ?? "");
  return {
    title: titleFor(run.domain),
    source: "run",
    graph: run.graph,
    traces: run.traces,
    screens: Object.values(run.screens ?? {}),
    invariants: isFlights ? flightInvariants : [],
  };
}

export function simulatedProject(seed: number, bug: boolean): Project {
  return {
    title: titleFor("flights"),
    source: "sim",
    graph: flightGraph,
    traces: simulateFlights({ traces: 500, seed, priceDriftBug: bug ? 0.05 : 0 }),
    screens: fixtureScreens,
    invariants: flightInvariants,
  };
}

export function withBranches(p: Project, b: Branches): Project {
  const extraTraces = b.traces ?? [];
  if (!b.nodes.length && !b.transitions.length && !b.screens.length && !extraTraces.length) return p;
  return {
    ...p,
    graph: { nodes: [...p.graph.nodes, ...b.nodes], transitions: [...p.graph.transitions, ...b.transitions] },
    screens: [...p.screens, ...b.screens],
    traces: [...p.traces, ...extraTraces],
  };
}

export function groupScreens(graph: FlowGraph, screens: Screen[]): Map<NodeId, Screen[]> {
  const by = new Map<NodeId, Screen[]>(graph.nodes.map((n) => [n.id, []]));
  for (const s of screens) by.get(s.nodeId)?.push(s);
  return by;
}
