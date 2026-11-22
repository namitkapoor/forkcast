# Contributing

Live: https://forkcast-qa.vercel.app (deploys from `main`). Every pull request gets its own Vercel preview.

## Setup

```bash
npm install
cp .env.example .env                # populate GEMINI_API_KEY; never commit .env
npm run dev                         # studio + /api routes at http://localhost:5173
```

Useful pages in dev:
- `/` (`Journeys`), `/#tests` (Traveler persona matrix + invariant checks), `/#flow` (Persona flows & freeform Studio canvas)
- `/gallery.html` (every recorded screen)
- `/harness.html` (A2UI renderer sandbox)
- `/api/health` (server & model configuration health check)

| Command | What it does |
|-|-|
| `npm run typecheck` / `npm run typecheck:api` | Strict TypeScript checks for the client app and `/api` serverless routes |
| `npm run check` | Headless seeded simulation + invariant/contract checks + coverage |
| `npm run check:journeys` | Validates recorded persona journeys, grounding, carry, and contract assertions |
| `npm run check:studio` | Verifies `@Pin`/`@Mask`/`@Critic` versioning, `@mention` catalog, voice normalization, and Gemini 4 thinking clamping |
| `npm run check:prod` | Verifies ESM `.js` import graph, `vercel.json` timeouts, serverless storage fallback, API rate/size guards, and `dist/` bundle hygiene |
| `npm run check:all` | Runs the complete verification suite above |
| `npm run simulate:llm -- --bug` | Real Gemini run → `public/data/run.json` (screens cached in `.cache/`) |
| `npx tsx scripts/validate-fixtures.ts` | A2UI v0.9 validator sanity check |

## Workstreams and boundaries

Work on a branch per workstream and open PRs into `main`. Stay inside your folders. If you need to change a shared contract, say so in the PR.

| Workstream | Owns | Contract with everyone else |
|-|-|-|
| **Gen-UI & Critic**: screen generation, multimodal edits, UX critique, voice | `config.yaml`, `api/_lib/`, `api/*.ts`, `src/lib/criticModels.ts` | `Screen` (`src/a2ui/types.ts`) and request/response types in `src/lib/api.ts` |
| **Studio & Flows**: canvas, journeys, persona matrix, history | `src/canvas/`, `src/ui/`, `src/App.tsx`, `src/index.css` | `RunFile` (`src/data/run.ts`), graph types (`src/graph/types.ts`), `ScreenFrame` props, `src/lib/api.ts` |
| **Renderer** (shared, change carefully) | `src/a2ui/` | `ScreenFrame` props, `validateMessages`, `catalogPromptSummary` |

## Shared contracts (change only with a heads-up)

- `src/graph/types.ts`: nodes, transitions, contracts, traces.
- `src/a2ui/types.ts`: `Screen` = an A2UI v0.9 message stream plus metadata and versioned annotations.
- `src/data/run.ts`: `RunFile`, the recorded run the canvas loads.
- `src/lib/api.ts`: every `/api/*` request and response shape.

## Models & Configuration

All default model IDs, reasoning (`thinkingConfig`), temperatures, timeouts, and retries live in git-tracked `config.yaml` and are loaded server-side by `api/_lib/models.ts` (with optional `FORKCAST_MODEL_*` env overrides). `GEMINI_API_KEY` stays strictly server-side in `.env` and is never sent to the browser.

- **Generator**: `gemini-4-hydrogen` (fallback `gemini-4-argon`)
- **Multimodal Editor**: `gemini-4-hydrogen` (`editor`) / `gemini-4-neon` (`editorCore`)
- **UX Critic**: `gemini-4-carbon` (`200s` timeout enforced across Carbon calls; selectable in Inspector UI across Carbon, Argon, Neon, Hydrogen)
- **Persona Judge**: `gemini-4-neon` (fallback `gemini-4-argon`)
- **Voice Transcription**: `gemini-3.5-transcribe` (fallback `gemini-3.5-flash-lite`)

## Notes

- **ESM `.js` rule**: Every runtime relative import under `api/` and anything `api/` imports must end in `.js` (enforced by `npm run check:prod`). Deployed functions run as plain Node ESM.
- **Public quota protection**: `api/_lib/http.ts` enforces per-IP sliding-window rate limiting (`FORKCAST_RATE_LIMIT_RPM`, default `60/min`) and request body size bounds.
