# Forkcast

**A map of every path through a generated interface, used to test it and to predict it.**

When an assistant generates its UI on the fly (a flight picker inside a chat, a checkout card, a seat map), no two users see the same screen. QA can't snapshot a screen that is different every time, and product can't learn from flows that never repeat exactly. Forkcast treats a generated interface as a graph of **states** and **transitions** rather than a pile of screens, then gives you an infinite canvas to see, test and annotate that graph.

Zoom out and you see the decision tree: every route users and simulated agents took, colored by traffic and risk. Zoom in on a node and you see the actual screens that were generated there, side by side for different users, and you can annotate or edit them in place.

---

## Who it's for

| | Primary: dev and QA teams | Secondary: product and personalization |
|-|-|-|
| Building | Generative UI inside agents and assistants (commerce, booking, support) | The same surfaces |
| Question | "Did this generated flow break anything, and where would it?" | "Given this user's context and path so far, what should we show next?" |
| What Forkcast gives them | Coverage of states and transitions weighted by traffic, contract checks at every handoff, plus failing paths they can replay | The aggregate graph as a prior: what similar users were shown next, and what led to completion or abandonment |

**Scope decision:** the hackathon build targets **dev and QA**. Prediction is a *view onto the same graph*, not a separate system. Recorded traces that power coverage also power "what usually comes next". If testing works, prediction comes almost free. The reverse doesn't hold.

### Not for
- Pixel-level visual regression. Screens are supposed to differ.
- Generating the UI itself. Forkcast observes and checks a generator; it isn't one.
- Per-user profiling. Prediction uses aggregate patterns only (see Privacy).

---

## Core idea: test nodes and edges, not screens

Paths explode. States and transitions don't.

- **Node** = a state in the task (`fare-compare`, `seat-select`, `payment`) plus the component type rendering it. A node can have thousands of different-looking **screens** (renderings for different users and contexts), all of which must satisfy the same **invariants**.
- **Edge** = a transition, with a **contract** saying what must survive the jump: the selected flight, the price, the passenger count, the currency.
- **Trace** = one session, real or simulated, folded into the graph as a walk across nodes and edges.
- **Coverage** = which nodes and edges have been exercised, weighted by how often real users take them, with extra weight where users move from *reading* to *acting* (selecting, paying, confirming).

### Example: "Book me a flight to Lisbon" inside a chat assistant

How big is that graph? Rough estimate, to be checked against the demo data:

| Layer | What varies | Rough size |
|-|-|-|
| Stages | intent → search params → results → compare → select → seats → bags/extras → passengers → payment → confirm → post-booking (change/cancel) | ~11 |
| Nodes | ~4 component variants per stage (inline card, full sheet, table, conversational fallback) | ~45 |
| Edges | next, back, refine ("cheaper", "later"), digress ("is there wifi?"), error, abandon: ~6 per node | ~250 |
| Interruptions | price changed, sold out, payment declined, 3DS challenge, session timeout | woven through ~30% of edges |
| Context | trip type (3) × party (solo / family / group) × loyalty (2) × surface (inline / fullscreen) × locale (3) | ~108 combinations |
| **Distinct paths** | loops plus refinements, up to 15 steps | **tens of millions or more** |

You can't test tens of millions of paths. You *can* test about 250 edges against a pairwise sample of contexts (~10 instead of 108): about 2,500 edge checks. **Hypothesis:** ranked by traffic, a few hundred of those cover about 95% of real sessions. Forkcast's job is to show that number and which edges sit in the untested tail.

---

## The canvas

An infinite, node-based canvas (in the spirit of TouchDesigner / node editors), with **semantic zoom**: each zoom level shows a different kind of information, not just a bigger version of the same thing.

| Zoom | You see | You can do |
|-|-|-|
| **Far: the forecast** | Whole decision graph. Edge thickness = traffic, color = test status (passed / failed / never run), red halos on read→act handoffs | Filter by context ("family, mobile, EUR"), highlight a single user's path, find the untested tail |
| **Mid: a node** | A stack of the real screens generated at this state for different contexts, plus the node's invariants and the in/out edge contracts | Compare variants, see which context produced which screen, replay a trace step through this node |
| **Near: a screen** | One live, rendered screen | Annotate in place (pin comments, mark "wrong price shown"), edit props, turn an annotation into a new invariant, re-run the check |

Annotations stick to the node, not the screen, so a note on one rendering applies to every future rendering of that state.

### Prediction mode (secondary)

Same canvas, different overlay. Pick a context and a partial path, and the graph lights up the likely next nodes with probabilities, plus what similar users were shown there and whether they finished. Useful for answering "should the assistant show seat selection inline or skip to payment for solo travelers on mobile?"

---

## Hackathon scope

### MVP (must ship)
1. **Graph schema**: nodes, edges, contracts, invariants, traces, written in TypeScript.
2. **Example domain: flight booking**: a small component catalog (~10 components) and a mock fare API with seeded randomness, including price changes and sold-out errors.
3. **Trace generator**: simulated users (personas with context: family, solo business traveler, budget, etc.), driven by an LLM to produce realistic, varied walks through the flow.
4. **Checks**: per-component invariants (schema, every price traces to a fare record, at most one primary action) and per-edge contracts (selected flight and price carry over). Each check runs against every recorded step.
5. **Canvas**: the three zoom levels above, with coverage coloring and click-to-annotate on the near view.

### Stretch
- Seeded-bug mode: inject 20 known bugs at handoffs, then compare how many runs each strategy needs to catch them: random paths, exhaustive, or traffic-weighted pairwise.
- Export failing traces as Playwright tests.
- Prediction overlay.
- Ingest real traces from an app via a small SDK (`forkcast.track(node, props)`).

### Success criteria for the demo
- The canvas shows at least 500 simulated traces for flight booking collapsed into one readable graph.
- A user can zoom from the full graph to a single screen and back without losing their place.
- A seeded handoff bug, such as the price changing between `select` and `payment`, shows up as a red edge and replays as a failing trace.
- The coverage panel reports "X% of traffic covered by Y edge checks" with real numbers from the run.

---

## Proposed stack

| Piece | Choice | Why |
|-|-|-|
| App | Vite + React + TypeScript | Fast to scaffold |
| Canvas | React Flow (`@xyflow/react`) | Built-in zoom/pan, custom nodes can render live React components |
| Annotations | Custom pin layer on React Flow nodes | Keeps annotations attached to nodes |
| Simulated users | LLM-driven persona agents | Variety of paths without hand-writing them |
| Checks | Plain TS functions plus Zod schemas | Run in the browser and in CI |
| Replay / export | Playwright | Turns failing traces into real e2e tests |

```
forkcast/
  src/
    graph/        # schema: Node, Edge, Contract, Invariant, Trace; fold traces into graph
    checks/       # invariant + contract runners, coverage math
    sim/          # persona agents, trace generation
    domains/
      flights/    # component catalog, mock fare API, contracts
    canvas/       # React Flow canvas, semantic zoom, annotation layer
```

---

## Run

```
npm install
npm run dev                 # canvas at http://localhost:5173
npm run check               # headless: simulate 500 sessions, run checks, print coverage
npm run check -- --clean    # same, with the seeded price-drift bug turned off
npm run build
```

## Privacy

Prediction runs only on aggregate graph statistics (edge counts, completion rates by context class). It never uses individual traces. Context classes below a minimum group size are merged or hidden. Demo data is entirely synthetic.

## Open questions
- What counts as "the same node" when a generator invents a new component on the fly? Do we cluster by component type, by task state, or by both?
- Is a pairwise sample of contexts enough, or do some context combinations (family plus price change, for example) fail only together?
- At what traffic level should a heavily used generated path become a fixed, hand-built screen?

## License

[MIT](LICENSE)
