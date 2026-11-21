// Aggregation: suite summary, the derived intent graph (decision tree as output) and the query × persona matrix.
import type { CheckKind, Intent, Journey, Persona, Query, SuiteSummary, Turn } from "./types.js";

// Correctness (grounding, carry, goal, schema) decides pass/fail. Persona contracts are tracked separately
// (servesRate), so a screen that is correct but doesn't serve the person reads as "correct, not serving".
const turnFails = (t: Turn) => (t.checks ?? []).some((c) => !c.ok && c.kind !== "persona");
const journeyFails = (j: Journey) => j.turns.some(turnFails);
const share = (n: number, d: number) => (d ? n / d : 0);

export function summarize(journeys: Journey[]): SuiteSummary {
  const failingChecks: Record<CheckKind, number> = { grounding: 0, carry: 0, goal: 0, schema: 0, persona: 0 };
  let turns = 0;
  let pinned = 0;
  let personaChecks = 0;
  let personaOk = 0;
  for (const j of journeys) {
    for (const t of j.turns) {
      turns++;
      if (t.ingredients?.pinned) pinned++;
      for (const c of t.checks ?? []) {
        if (!c.ok) failingChecks[c.kind] = (failingChecks[c.kind] ?? 0) + 1;
        if (c.kind === "persona") {
          personaChecks++;
          if (c.ok) personaOk++;
        }
      }
    }
  }
  return {
    journeys: journeys.length,
    passRate: share(journeys.filter((j) => !journeyFails(j)).length, journeys.length),
    goalRate: share(journeys.filter((j) => j.goalMet).length, journeys.length),
    bookedRate: share(journeys.filter((j) => j.outcome === "booked").length, journeys.length),
    pinnedShare: share(pinned, turns),
    failingChecks,
    ...(personaChecks ? { servesRate: share(personaOk, personaChecks), personaChecks } : {}),
  };
}

export interface IntentGraph {
  nodes: {
    intent: Intent;
    count: number;
    lanes: { personaId: string; count: number; passRate: number; screenIds: string[]; pinned: boolean }[];
  }[];
  edges: { from: Intent | "start"; to: Intent | "end"; count: number; failing: number }[];
}

/**
 * Nodes = intents seen; edges = consecutive turn transitions (plus start → first, last → end).
 * An edge is failing when its target turn has a failing check; for edges into "end",
 * failing counts journeys whose goal was not met.
 */
export function buildIntentGraph(journeys: Journey[], personas: Persona[]): IntentGraph {
  const order = new Map(personas.map((p, i) => [p.id, i]));
  type Lane = { count: number; pass: number; screenIds: string[]; pinned: boolean };
  const nodes = new Map<Intent, { count: number; firstSeen: number; lanes: Map<string, Lane> }>();
  const edges = new Map<string, { from: Intent | "start"; to: Intent | "end"; count: number; failing: number }>();
  const bump = (from: Intent | "start", to: Intent | "end", failing: boolean) => {
    const k = `${from}->${to}`;
    const e = edges.get(k) ?? { from, to, count: 0, failing: 0 };
    e.count++;
    if (failing) e.failing++;
    edges.set(k, e);
  };

  let seq = 0;
  for (const j of journeys) {
    let prev: Intent | "start" = "start";
    for (const t of j.turns) {
      const n = nodes.get(t.intent) ?? { count: 0, firstSeen: seq++, lanes: new Map<string, Lane>() };
      n.count++;
      const lane = n.lanes.get(j.personaId) ?? { count: 0, pass: 0, screenIds: [], pinned: false };
      lane.count++;
      if (!turnFails(t)) lane.pass++;
      if (t.screen?.id && !lane.screenIds.includes(t.screen.id)) lane.screenIds.push(t.screen.id);
      if (t.ingredients?.pinned) lane.pinned = true;
      n.lanes.set(j.personaId, lane);
      nodes.set(t.intent, n);
      bump(prev, t.intent, turnFails(t));
      prev = t.intent;
    }
    if (j.turns.length) bump(prev, "end", !j.goalMet);
  }

  return {
    nodes: [...nodes.entries()]
      .sort((a, b) => a[1].firstSeen - b[1].firstSeen)
      .map(([intent, n]) => ({
        intent,
        count: n.count,
        lanes: [...n.lanes.entries()]
          .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
          .map(([personaId, l]) => ({ personaId, count: l.count, passRate: share(l.pass, l.count), screenIds: l.screenIds, pinned: l.pinned })),
      })),
    edges: [...edges.values()].sort((a, b) => b.count - a.count),
  };
}

export function matrix(
  journeys: Journey[],
  queries: Query[],
  personas: Persona[],
): { queryId: string; personaId: string; runs: number; passRate: number; goalRate: number; booked: number }[] {
  return queries.flatMap((q) =>
    personas.map((p) => {
      const js = journeys.filter((j) => j.queryId === q.id && j.personaId === p.id);
      return {
        queryId: q.id,
        personaId: p.id,
        runs: js.length,
        passRate: share(js.filter((j) => !journeyFails(j)).length, js.length),
        goalRate: share(js.filter((j) => j.goalMet).length, js.length),
        booked: js.filter((j) => j.outcome === "booked").length,
      };
    }),
  );
}
