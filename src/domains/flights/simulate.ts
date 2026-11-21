import type { Context, Outcome, Step, Trace, TransitionKind } from "../../graph/types";
import { mulberry32, pick, weighted, type Rng } from "../../sim/random";
import { flightGraph } from "./graph";

export interface SimOptions {
  traces: number;
  seed: number;
  /** Seeded bug: chance the price silently changes between passengers and payment. */
  priceDriftBug: number;
}

const CONTEXTS = {
  trip: ["one-way", "round-trip", "multi-city"],
  party: ["solo", "couple", "family"],
  surface: ["inline", "fullscreen"],
  currency: ["USD", "EUR", "GBP"],
} as const;

const PAX: Record<string, number> = { solo: 1, couple: 2, family: 4 };
const MAX_STEPS = 20;

// How likely each kind of move is. Errors and abandons are rare; refining is common.
const MOVE_WEIGHTS: Partial<Record<TransitionKind, number>> = { next: 0.72, back: 0.08, refine: 0.1, error: 0.06 };
const ABANDON_PER_STEP = 0.04;

function randomContext(rng: Rng): Context {
  return Object.fromEntries(Object.entries(CONTEXTS).map(([k, vals]) => [k, pick(rng, vals)]));
}

export function simulateFlights({ traces, seed, priceDriftBug }: SimOptions): Trace[] {
  const rng = mulberry32(seed);
  const outgoing = new Map<string, typeof flightGraph.transitions>();
  for (const tr of flightGraph.transitions) outgoing.set(tr.from, [...(outgoing.get(tr.from) ?? []), tr]);

  const out: Trace[] = [];
  for (let i = 0; i < traces; i++) {
    const context = randomContext(rng);
    const pax = PAX[context.party];
    const currency = context.currency;
    let fare: { flightId?: string; price?: number; fareSource?: string } = {};

    const steps: Step[] = [{ node: "intent", props: { pax, currency } }];
    let outcome: Outcome = "abandoned";

    while (steps.length < MAX_STEPS) {
      const here = steps[steps.length - 1].node;
      if (here === "confirm") {
        outcome = "completed";
        break;
      }
      if (rng() < ABANDON_PER_STEP) break;

      const options = outgoing.get(here) ?? [];
      const kinds = new Set(options.map((o) => o.kind));
      const weights = Object.fromEntries(Object.entries(MOVE_WEIGHTS).filter(([k]) => kinds.has(k as TransitionKind)));
      const kind = weighted(rng, weights);
      const next = pick(rng, options.filter((o) => o.kind === kind));

      if (next.to === "select") {
        const price = Math.round((120 + rng() * 600) * pax);
        fare = { flightId: `FL${100 + Math.floor(rng() * 900)}`, price, fareSource: "fares-api" };
      }
      if (next.to === "results") fare = {};
      if (next.from === "price-changed" && next.to === "payment" && fare.price) {
        fare = { ...fare, price: fare.price + Math.round(20 * pax) };
      }
      if (next.from === "passengers" && next.to === "payment" && fare.price && rng() < priceDriftBug) {
        fare = { ...fare, price: fare.price + 37 }; // the bug the checks should catch
      }

      const props: Record<string, unknown> = { pax, currency, ...fare };
      if (next.to === "passengers") props.forms = pax;
      steps.push({ node: next.to, props });
    }

    out.push({ id: `t${i}`, context, steps, outcome });
  }
  return out;
}
