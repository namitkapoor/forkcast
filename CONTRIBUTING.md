# Contributing

Live: https://forkcast-qa.vercel.app (deploys from `main`). Every pull request gets its own Vercel preview.

## Setup

```
npm install
echo "GEMINI_API_KEY=..." > .env    # ask the team for the key; never commit it
npm run dev                         # canvas + /api routes at http://localhost:5173
```

Useful pages in dev: `/` (canvas), `/gallery.html` (every recorded screen), `/harness.html` (renderer sandbox).

| Command | What it does |
|-|-|
| `npm run typecheck` / `npm run typecheck:api` | Types for the app / for the serverless routes |
| `npm run check` | Headless: seeded simulation + checks + coverage |
| `npm run simulate:llm -- --bug` | Real Gemini run → `public/data/run.json` (screens cached in `.cache/`) |
| `npx tsx scripts/validate-fixtures.ts` | A2UI validator sanity check |

## Workstreams and boundaries

Work on a branch per workstream and open PRs into `main`. Stay inside your folders. If you need to change a shared contract, say so in the PR.

| Workstream | Owns | Contract with everyone else |
|-|-|-|
| **Gen-UI**: how Getaway's assistant generates screens | `api/_lib/` (prompts, models, repair), `api/*.ts`, `src/domains/flights/` | `Screen` (`src/a2ui/types.ts`) and the request/response types in `src/lib/api.ts` |
| **Node editor**: the canvas | `src/canvas/`, `src/ui/`, `src/App.tsx`, `src/index.css` | `RunFile` (`src/data/run.ts`), graph types (`src/graph/types.ts`), `ScreenFrame` props, `src/lib/api.ts` |
| **Learning loop**: better UIs over time | new `src/learn/`, new `api/feedback.ts`, `scripts/` | reads `RunFile` + annotations; writes a policy file (preferred variants per context, best example screens, prompt rules) that the generator reads |
| **Renderer** (shared, change carefully) | `src/a2ui/` | `ScreenFrame` props, `validateMessages`, `catalogPromptSummary` |

## Shared contracts (change only with a heads-up)

- `src/graph/types.ts`: nodes, transitions, contracts, traces.
- `src/a2ui/types.ts`: `Screen` = an A2UI v0.9 message stream plus metadata.
- `src/data/run.ts`: `RunFile`, the recorded run the canvas loads.
- `src/lib/api.ts`: every `/api/*` request and response shape.

## Models

All model ids are in `api/_lib/models.ts`. Generator: `gemini-4-hydrogen` (fallback `gemini-4-argon`). Simulated travelers: `gemini-3.5-flash-lite`. The Gemini key stays server-side and is never sent to the browser.

## Notes

- Import paths under `api/` and anything `api/` imports must end in `.js`. Deployed functions are plain ESM.
- The production site is public, and its API routes spend the shared Gemini quota.
