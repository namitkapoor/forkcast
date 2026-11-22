import type { BranchRequest, BranchResponse } from "../../src/lib/api.js";
import type { StateNode, Transition, TransitionKind } from "../../src/graph/types.js";
import { callJson, CARBON_TIMEOUT_MS, HttpError, isCarbonModel } from "./gemini.js";
import { getDataModel, screenToText } from "./dataModel.js";
import { generateScreen } from "./screen.js";
import { getLlmConfig, models } from "./models.js";

const KINDS: TransitionKind[] = ["next", "back", "refine", "digress", "error", "abandon"];
const CARRY_KEYS = ["flightId", "price", "currency", "pax", "fareSource", "trip"];

interface Plan {
  node?: Partial<StateNode>;
  kind?: string;
  carries?: unknown;
}

const PLAN_SYSTEM = `You maintain a state graph of a generated flight-booking interface inside a chat assistant.
Given the current screen and a "what if" utterance, decide the NEW state the assistant moves to.
Return JSON: {"node":{"id":"kebab-slug","stage":"<stage>","label":"Short Label","component":"PascalCaseComponent","acts":boolean},"kind":"next|back|refine|digress|error|abandon","carries":["prop", ...]}
- stage: one of intent, search, results, compare, select, seats, extras, passengers, payment, confirm, post-booking, or a new short stage if none fits.
- id: a descriptive slug distinct from the current node id (e.g. "results-cheaper", "wifi-answer").
- kind: refine = same task narrowed/changed ("cheaper", "later"); digress = side question; back = return to an earlier stage; next = forward; error = something failed.
- carries: which of [flightId, price, currency, pax, fareSource, trip] must stay identical across this jump (e.g. a "cheaper" refine keeps pax and currency but not price/flightId).
- acts: true only if the user commits to something (select, pay, confirm) on the new screen.`;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export async function branch(req: BranchRequest, budgetMs = 55_000): Promise<BranchResponse & { warnings: string[] }> {
  if (!req?.fromScreen?.messages || !req.fromNode?.id || typeof req.utterance !== "string" || !req.utterance.trim()) {
    throw new HttpError(400, "fromScreen (with messages), fromNode and utterance are required");
  }
  const t0 = Date.now();
  const { fromScreen, fromNode, utterance } = req;
  const planCfg = getLlmConfig("branchPlanner");
  const plan = await callJson<Plan>({
    model: planCfg.model,
    system: PLAN_SYSTEM,
    prompt: [
      `Current node: ${JSON.stringify(fromNode)}`,
      `User context: ${JSON.stringify(fromScreen.context)}`,
      `Current screen:\n${screenToText(fromScreen.messages)}`,
      `Utterance: "${utterance}"`,
    ].join("\n\n"),
    temperature: planCfg.temperature,
    thinkingConfig: planCfg.thinkingConfig,
    timeoutMs: planCfg.timeoutMs,
    retries: planCfg.retries,
  }).catch((e) => {
    throw new HttpError(502, `branch planning failed: ${(e as Error).message}`);
  });

  const p = plan.data ?? {};
  const kind = (KINDS as string[]).includes(String(p.kind)) ? (p.kind as TransitionKind) : "refine";
  let id = slugify(String(p.node?.id ?? "")) || `${fromNode.id}-${slugify(utterance).slice(0, 20) || "branch"}`;
  if (id === fromNode.id) id = `${id}-alt`;
  const node: StateNode = {
    id,
    stage: slugify(String(p.node?.stage ?? "")) || fromNode.stage,
    label: String(p.node?.label ?? "").slice(0, 40) || utterance.slice(0, 40),
    component: String(p.node?.component ?? "").replace(/[^A-Za-z0-9]/g, "") || fromNode.component,
    ...(p.node?.acts ? { acts: true } : {}),
  };
  const carries = Array.isArray(p.carries) ? p.carries.filter((c): c is string => typeof c === "string" && CARRY_KEYS.includes(c)) : [];

  // What the new screen must carry: the contracted props, read from the old screen's /booking.
  const booking = (getDataModel(fromScreen.messages).booking ?? {}) as Record<string, unknown>;
  const carry: Record<string, unknown> = {};
  for (const k of new Set([...carries, "currency", "pax"])) {
    if (booking[k] !== undefined && typeof booking[k] !== "object") carry[k] = booking[k];
  }
  if (carry.currency === undefined && fromScreen.context?.currency) carry.currency = fromScreen.context.currency;

  const transition: Transition = {
    id: `${fromNode.id}->${node.id}`,
    from: fromNode.id,
    to: node.id,
    kind,
    ...(carries.length ? { contract: { carries } } : {}),
  };

  const effectiveBudget =
    isCarbonModel(models.generator) || isCarbonModel(models.generatorFallback)
      ? Math.max(budgetMs, CARBON_TIMEOUT_MS + 40_000)
      : budgetMs;
  const gen = await generateScreen(
    { node, context: fromScreen.context ?? {}, utterance, carry, previous: screenToText(fromScreen.messages) },
    { budgetMs: effectiveBudget - (Date.now() - t0) },
  );
  return { node, transition, screen: gen.screen, warnings: gen.warnings };
}
