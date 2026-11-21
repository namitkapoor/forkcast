// Query-driven journeys: the test suite is a set of queries run across personas.
// See SPEC.md. This file is the shared contract between simulator, checks, aggregation and UI.
import type { Context } from "../graph/types";
import type { Screen } from "../a2ui/types";
import type { Fare, FareConstraints } from "../domains/flights/fares";

export interface Persona {
  id: string; // "family" | "solo" | "budget-couple"
  label: string; // "Family of 4 · phone · EUR"
  context: Context; // { party, pax, surface, currency, origin }
  /** How this persona behaves, for the simulated user prompt. */
  style: string;
}

export interface Query {
  id: string;
  text: string; // "Cheapest morning flight to Lisbon in March"
  constraints: FareConstraints;
  hero?: boolean;
}

/** Fixed vocabulary of what a person is trying to do at a turn. */
export const INTENTS = [
  "search",
  "refine",
  "compare",
  "select",
  "seats",
  "extras",
  "passengers",
  "pay",
  "confirm",
  "question",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export interface Ingredients {
  context: Context;
  /** Prior turns, oldest first, as short text lines ("user: …", "assistant showed: …"). */
  history: string[];
  /** What the deterministic tools returned this turn. Ground truth for grounding checks. */
  toolResults: { tool: string; args: Record<string, unknown>; fares: Fare[] }[];
  /** Data that must carry over from earlier turns (chosen fare, pax, currency). */
  carry: Record<string, unknown>;
  promptVersion: string;
  /** Set when the layout came from a pinned variant instead of free generation. */
  pinned?: { key: string; fromScreenId: string };
}

export type CheckKind = "grounding" | "carry" | "goal" | "schema";

export interface CheckResult {
  kind: CheckKind;
  ok: boolean;
  message: string;
  /** Component the failure points at, for circling it on screen. */
  componentId?: string;
  /** The offending value, e.g. "09:15". */
  value?: string;
}

export interface Turn {
  index: number;
  userMessage: string;
  intent: Intent;
  ingredients: Ingredients;
  screen: Screen;
  /** What the person did after seeing the screen ("Tapped TP1353 €1,116", "asked: anything earlier?"). */
  userAction: string;
  checks: CheckResult[];
  ms?: number;
}

export type JourneyOutcome = "booked" | "abandoned" | "max-turns" | "error";

export interface Journey {
  id: string; // `${queryId}:${personaId}:${run}`
  queryId: string;
  personaId: string;
  run: number;
  turns: Turn[];
  outcome: JourneyOutcome;
  /** Oracle verdict: did the person end up able to do what they asked? */
  goalMet: boolean;
}

/** Key for convergence: one pinned layout per (intent, persona). */
export const pinKey = (intent: Intent, personaId: string) => `${intent}|${personaId}`;

export interface Pin {
  key: string;
  intent: Intent;
  personaId: string;
  /** Screen whose component tree is reused; data model is refilled from fresh tool results. */
  screenId: string;
  score: number;
  evidence: number; // how many turns backed the choice
}

export interface SuiteSummary {
  journeys: number;
  passRate: number; // share of journeys with zero failing checks
  goalRate: number;
  bookedRate: number;
  pinnedShare: number; // share of turns rendered from a pinned layout
  failingChecks: Record<CheckKind, number>;
}

export interface JourneysFile {
  version: 1;
  createdAt: string;
  models: Record<string, string>;
  personas: Persona[];
  queries: Query[];
  journeys: Journey[];
  pins?: Pin[];
  /** Summary of the run before convergence, for the before/after beat. */
  previous?: SuiteSummary;
}
