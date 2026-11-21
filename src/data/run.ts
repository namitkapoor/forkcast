import type { FlowGraph, Trace } from "../graph/types";
import type { Screen } from "../a2ui/types";

/**
 * A recorded run: the graph, the sessions walked through it, and the generated screens
 * those sessions saw (Step.screenId → screens[id]). Produced by `npm run simulate:llm`
 * into public/data/run.json; the canvas loads it and falls back to the seeded random walk.
 */
export interface RunFile {
  version: 1;
  domain: string;
  createdAt: string;
  models: Record<string, string>;
  graph: FlowGraph;
  traces: Trace[];
  screens: Record<string, Screen>;
}

export async function loadRun(url = "/data/run.json"): Promise<RunFile | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as RunFile;
  } catch {
    return null;
  }
}
