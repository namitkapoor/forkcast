# Forkcast spec: query-driven QA for generated UI

## The problem in one paragraph

Getaway's assistant generates its booking UI for each traveler. The same question produces different screens for different people (context), different wording, and even reruns (the model is non-deterministic). The flow branches per person too. Classic QA tests **screens**, and these screens never repeat. So nothing is tested.

## The idea

- **Test truth along a journey, not screens.** Layouts vary, but the right answer doesn't: given the fare data, the correct options for "cheapest morning flight to Lisbon for 4" are computable.
- **The test suite is a set of queries.** Each query runs across personas and several reruns. A regression is a falling pass rate, not a screenshot diff.
- **The decision tree is an output.** Forkcast builds it by aggregating sessions: nodes are what people were trying to do (intents), edges are weighted by how many people moved between them, and each node splits into persona lanes.
- **Converge where people are.** For a busy (intent, persona) pair, pin the variant that passed and converted. Pinned screens are deterministic again, so classic tests apply. Rare cases stay generated and guarded by checks.

> Forkcast turns generated UI back into testable UI where most people are, and guards the rest.

## MVP (what the demo shows)

**Scope:** 1 hero query + 2 supporting queries, 3 personas, 2 reruns each, at most 5 turns per journey.

| Persona | Context |
|-|-|
| Family | 4 travelers, phone (inline chat), EUR, from LHR |
| Solo business | 1 traveler, desktop (fullscreen), USD, from JFK |
| Budget couple | 2 travelers, phone, GBP, from MAN |

Hero query: **"Cheapest morning flight to Lisbon in March"**

**The demo, in four beats:**
1. **Same words, different UI.** Level 2 shows the hero query across the 3 personas, with the screens for each turn side by side.
2. **Why each screen looks the way it does.** Level 3 shows one journey turn by turn: the message, then the **ingredients** (context, history, tool results, carried data, prompt version), then the screen, then the next action.
3. **What broke.** Grounding circles a fact that isn't in the tool results (e.g. a departure time the model invented), and the goal check says whether the cheapest morning fare was on screen and bookable.
4. **Converge.** Press Converge: the best variant per (intent, persona) gets pinned, the suite re-runs, and the pass rate and the "% of traffic on pinned UI" go up.

**Done means:** `public/data/journeys.json` comes from a real Gemini run; the three levels render it; at least one grounding failure is found that nobody planted; Converge measurably raises the pass rate on a re-run.

## Data model (`src/journeys/types.ts`)

- `Persona`: id, label, context.
- `Query`: id, text, constraints (a machine-readable form the oracle uses: destination, month, time-of-day window, sort).
- `Journey`: queryId, personaId, run index, `turns[]`, outcome.
- `Turn`: user message, intent label, `Ingredients`, generated `Screen` (A2UI v0.9), what the user did next, check results.
- `Ingredients`: context, history (prior turns as text), `toolResults` (fares returned by the deterministic tool), `carry` (chosen fare etc.), prompt version, and `pinned` (the layout source, if one was used).
- `JourneysFile`: personas, queries, journeys, models, createdAt, and optionally `pins` and a `previous` summary for before/after.

## Pieces

| Piece | Where | What it does |
|-|-|-|
| Fares tool | `src/domains/flights/fares.ts` | Fixed fare table plus `searchFares(constraints, context)`. This is the ground truth |
| Journey simulator | `scripts/simulate-journeys.ts`, `api/_lib/` | For each (query, persona, run): the persona writes a message, the assistant labels an intent and calls tools, the generator builds the screen from the ingredients, and the persona reacts. It records everything |
| Checks | `src/journeys/checks.ts` | **Grounding**: every price, time and flight number on screen is in toolResults ∪ carry. **Carry-over**: the chosen fare stays the same. **Goal**: the oracle's best fare was shown and bookable, and the booked fare matches what was chosen |
| Aggregation | `src/journeys/aggregate.ts` | Intent graph: nodes = intents, edges = transition counts, lanes = personas; pass rates per node × persona |
| Convergence | `src/journeys/converge.ts` | Score variants per (intent, persona) by checks passed × journey completion; pin the best when there's enough evidence. Pinned = reuse the winner's component tree and fill the data model from fresh tool results |
| UI | `src/ui/journeys/` | One page, progressive disclosure: L1 query suite + derived tree; L2 query × persona lanes; L3 journey with ingredients and circled failures. Lasso editing stays at L3 |

## Not in the MVP

Live production tracking (staged with replayed simulated traffic; `forkcast.track()` is a stub), an LLM judge, more domains, accounts, and the Components page.

## Risks

- Pinning toward the common case can erase the uncommon user. Pin only with enough evidence, never across personas, and keep exploring.
- LLM-labeled intents can drift. The MVP uses a fixed intent vocabulary plus "other".
