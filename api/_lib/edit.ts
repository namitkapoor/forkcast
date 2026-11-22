import type { EditScreenRequest, EditScreenResponse, TokenUsage } from "../../src/lib/api.js";
import { A2UI_VERSION, BASIC_CATALOG_ID, type A2uiMessage, type Screen } from "../../src/a2ui/types.js";
import { catalogPromptSummary, validateMessages } from "../../src/a2ui/validate.js";
import { callJson, CARBON_TIMEOUT_MS, HttpError, isCarbonModel, TimeoutError, type InlineMediaPart } from "./gemini.js";
import { getAt, getComponents, getDataModel, lintBindings, pinSurfaceId, screenToText } from "./dataModel.js";
import { getLlmConfig, taskConfigs, type ResolvedLlmConfig } from "./models.js";

// Edits an existing A2UI screen from a chat instruction, @Pin/@Mask feedback, and optional Paint mask PNG.
// Same shape as screen.ts: task-routed model with fallback, validate, one repair round, then guardrails.

const SYSTEM = () => `You edit one existing screen of a flight-booking flow inside a chat assistant. The screen is an A2UI v0.9 message stream using ONLY the basic catalog below.

${catalogPromptSummary()}

Editing rules (all required):
1. Output one JSON object: {"summary": "<one short sentence on what you changed>", "resolvedAnnotationIds": ["<id>", ...], "messages": [ ...the FULL revised A2UI message stream... ]}.
2. messages = createSurface (catalogId "${BASIC_CATALOG_ID}"), then ONE updateComponents with EVERY component of the revised screen, then ONE updateDataModel with path "/" holding the whole data model. Use the surfaceId you are given. The root component id stays "root".
3. Change ONLY what the instruction and attached @Pin/@Mask annotations need. Keep every other component exactly as it was: same id, same type, same props, same order. New components get new descriptive snake_case ids.
4. If target components or @Pin/@Mask annotations are listed, focus your edits on those components; touch components outside that set only when the instruction can't be done otherwise (e.g. adding a sibling row next to a target).
5. Keep the data model stable: same keys, same values, same bindings. NEVER change prices, totals, flight numbers or ids, dates, times, passenger counts or currency unless the instruction explicitly asks to change those values. "Make the total bigger" means visual size, not a larger amount.
6. Any new dynamic value (a per-traveler price, a count) goes in the data model as a display-ready string derived from existing values (e.g. total / pax, formatted in the same currency) and is bound with {"path": "/..."}. Never hard-code a price in component props.
7. Visual emphasis tools in the basic catalog: Text variant (h1 > h2 > h3 > h4 > h5 > body > caption), Card grouping, Row/Column alignment, Divider, Icon. At most one Button with variant "primary".
8. In "resolvedAnnotationIds", list the exact id of each attached annotation that your edit addressed.`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface ModelEdit {
  summary?: unknown;
  variant?: unknown;
  resolvedAnnotationIds?: unknown;
  messages?: unknown;
}

function surfaceIdOf(screen: Screen): string {
  for (const m of screen.messages) {
    const cs = (m as Obj).createSurface;
    if (isObj(cs) && typeof cs.surfaceId === "string") return cs.surfaceId;
  }
  return screen.id;
}

function parseDataUrlMedia(dataUrl?: string): InlineMediaPart | undefined {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return undefined;
  const comma = dataUrl.indexOf(",");
  if (comma < 5) return undefined;
  const header = dataUrl.slice(5, comma);
  const mimeType = header.split(";")[0]?.trim() || "image/png";
  const data = dataUrl.slice(comma + 1).trim();
  if (!data || data.length > 4_000_000) return undefined;
  return { mimeType, data };
}

/** Scalar leaves of a data model as pointer → value. */
function leaves(v: unknown, path = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}/${i}`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) leaves(x, `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
  else out.set(path || "/", v);
  return out;
}

const PROTECTED = /price|total|amount|fare|fee|cost|flight|date|depart|arriv|time|pax|traveler|passenger|currency|code|seat/i;
const ASKS_FOR_VALUES = /\b(change|set|update|correct|fix|lower|raise|reduce|increase)\b[^.]*\b(price|total|fare|fee|amount|date|time|flight|currency|pax|seat)s?\b[^.]*\b(to|by)\b/i;

/** Existing protected values the edit changed (path, before, after). */
function movedValues(before: unknown[], after: unknown[]) {
  const a = leaves(getDataModel(before));
  const b = getDataModel(after);
  const moved: { path: string; from: unknown; to: unknown }[] = [];
  for (const [path, v] of a) {
    if (!PROTECTED.test(path)) continue;
    const now = getAt(b, path);
    if (now !== undefined && now !== v) moved.push({ path, from: v, to: now });
  }
  return moved;
}

function changedComponents(before: unknown[], after: unknown[]): string[] {
  const a = new Map(getComponents(before).map((c) => [String(c.id), JSON.stringify(c)]));
  const b = new Map(getComponents(after).map((c) => [String(c.id), JSON.stringify(c)]));
  const ids = new Set<string>();
  for (const [id, json] of b) if (a.get(id) !== json) ids.add(id);
  for (const id of a.keys()) if (!b.has(id)) ids.add(id);
  return [...ids];
}

function check(out: ModelEdit, surfaceId: string, before: unknown[], allowValues: boolean) {
  if (!out || !Array.isArray(out.messages)) return { messages: [] as unknown[], a2ui: ["response has no messages array"], other: [] as string[] };
  const messages = pinSurfaceId(out.messages, surfaceId);
  const v = validateMessages(messages);
  if (!v.ok) return { messages, a2ui: v.errors, other: [] as string[] };
  const other = lintBindings(messages).filter((e) => !e.includes("flight id"));
  if (!allowValues) {
    for (const m of movedValues(before, messages)) other.push(`data model ${m.path} changed from ${JSON.stringify(m.from)} to ${JSON.stringify(m.to)} — keep existing values unchanged`);
  }
  return { messages, a2ui: [] as string[], other };
}

export async function editScreen(req: EditScreenRequest, budgetMs = 55_000): Promise<EditScreenResponse> {
  const screen = req?.screen;
  if (!screen || !Array.isArray(screen.messages) || !screen.messages.length) throw new HttpError(400, "screen with messages is required");
  const instruction = typeof req.instruction === "string" ? req.instruction.trim() : "";
  if (!instruction) throw new HttpError(400, "instruction is required");

  const annotations = Array.isArray(req.annotations) ? req.annotations.slice(0, 16) : [];
  const annCompIds = annotations.flatMap((a) => [
    ...(a.componentId ? [a.componentId] : []),
    ...(Array.isArray(a.intersectingIds) ? a.intersectingIds : []),
  ]);
  const rawIds = Array.isArray(req.componentIds) ? req.componentIds.filter((x): x is string => typeof x === "string") : [];
  const ids = [...new Set([...rawIds, ...annCompIds])].slice(0, 24);

  const inlineMedia: InlineMediaPart[] = [];
  const directMedia = parseDataUrlMedia(req.maskDataUrl);
  if (directMedia) inlineMedia.push(directMedia);
  for (const ann of annotations) {
    if (inlineMedia.length >= 3) break;
    const m = parseDataUrlMedia(ann.maskDataUrl);
    if (m) inlineMedia.push(m);
  }

  const t0 = Date.now();
  const useCorePolicy = inlineMedia.length > 0 || annotations.length >= 2;
  const primaryCfg = getLlmConfig(useCorePolicy ? "editorCore" : "editor");
  const primaryTask = useCorePolicy ? taskConfigs.editCore : taskConfigs.editSmall;
  const fallbackCfg = getLlmConfig("generatorFallback");
  const effectiveBudgetMs =
    isCarbonModel(primaryCfg.model) || isCarbonModel(fallbackCfg.model)
      ? Math.max(budgetMs, CARBON_TIMEOUT_MS + 35_000)
      : budgetMs;
  const remaining = () => effectiveBudgetMs - (Date.now() - t0);
  const surfaceId = surfaceIdOf(screen);
  const before = screen.messages;
  const combinedInstructionText = [instruction, ...annotations.map((a) => a.text)].join(". ");
  const allowValues = ASKS_FOR_VALUES.test(combinedInstructionText);
  const comps = new Map(getComponents(before).map((c) => [String(c.id), c]));
  const targets = ids.map((id) => comps.get(id)).filter(Boolean);

  const system = SYSTEM();
  const prompt = [
    `surfaceId: "${surfaceId}"`,
    `Node: "${screen.nodeId}". User context: ${JSON.stringify(screen.context ?? {})}. Layout: "${screen.variant}".`,
    `Screen as the user sees it:\n${screenToText(before, 80)}`,
    `Current message stream:\n${JSON.stringify(before)}`,
    targets.length
      ? `Target components (selected / lassoed / painted on the screen):\n${targets.map((c) => JSON.stringify(c)).join("\n")}`
      : `No specific components were lassoed: apply the instruction to the relevant parts of the screen.`,
    annotations.length
      ? `Attached @Pin / @Mask feedback to resolve:\n${annotations
          .map(
            (a) =>
              `- id="${a.id}" ${a.token} [${a.kind}]${a.componentId ? ` on component "${a.componentId}"` : ""}${
                a.intersectingIds?.length ? ` intersecting [${a.intersectingIds.join(", ")}]` : ""
              }: "${a.text}"`,
          )
          .join("\n")}`
      : "",
    req.referencedContext ? `Referenced flow context:\n${req.referencedContext.slice(0, 2000)}` : "",
    inlineMedia.length ? `Note: ${inlineMedia.length} painted region mask image(s) attached showing the highlighted target area.` : "",
    `Instruction: "${instruction}"`,
    `Return the JSON object now.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const attempts: EditScreenResponse["attempts"] = [];
  let totalUsage: TokenUsage | undefined;
  const accumulateUsage = (u: TokenUsage) => {
    if (!totalUsage) {
      totalUsage = { ...u };
    } else {
      totalUsage.promptTokens += u.promptTokens;
      totalUsage.outputTokens += u.outputTokens;
      totalUsage.thoughtTokens += u.thoughtTokens;
      totalUsage.totalTokens += u.totalTokens;
    }
  };

  let first: { data: ModelEdit; model: string; raw: string; cfg: ResolvedLlmConfig } | undefined;
  const candidates = [primaryCfg, ...(fallbackCfg.model !== primaryCfg.model ? [fallbackCfg] : [])];
  for (const cfg of candidates) {
    const modelCap = isCarbonModel(cfg.model) ? CARBON_TIMEOUT_MS : cfg === primaryCfg ? cfg.timeoutMs : remaining() - 2000;
    const timeoutMs = Math.min(modelCap, remaining() - 2000);
    if (timeoutMs < 4000) break;
    try {
      const r = await callJson<ModelEdit>({
        model: cfg.model,
        system,
        prompt,
        temperature: cfg.temperature ?? 0.3,
        thinkingLevel: cfg === primaryCfg ? primaryTask.thinkingLevel : undefined,
        thinkingConfig: cfg === primaryCfg ? undefined : cfg.thinkingConfig,
        inlineMedia: inlineMedia.length ? inlineMedia : undefined,
        timeoutMs,
        retries: cfg.retries,
      });
      attempts.push({ model: cfg.model, ms: r.ms, ok: true });
      accumulateUsage(r.usage);
      first = { ...r, cfg };
      break;
    } catch (e) {
      attempts.push({ model: cfg.model, ms: 0, ok: false, error: e instanceof TimeoutError ? "timeout" : String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  if (!first) throw new HttpError(502, "screen edit failed", attempts);

  let out = first.data;
  let res = check(out, surfaceId, before, allowValues);
  const problems = [...res.a2ui, ...res.other];
  if (problems.length && remaining() > 8000) {
    const repairPrompt = [
      prompt,
      `Your previous answer:\n${first.raw.length > 30_000 ? first.raw.slice(0, 30_000) : first.raw}`,
      `It has these problems:\n${problems.slice(0, 25).map((p) => `- ${p}`).join("\n")}`,
      `Return the corrected full JSON object (same shape). Fix every problem; keep your edit otherwise.`,
    ].join("\n\n");
    try {
      const r = await callJson<ModelEdit>({
        model: first.model,
        system,
        prompt: repairPrompt,
        temperature: first.cfg.repairTemperature ?? 0.2,
        thinkingLevel: "LOW",
        timeoutMs: remaining() - 1000,
        retries: 1,
      });
      attempts.push({ model: first.model, ms: r.ms, ok: true });
      accumulateUsage(r.usage);
      const res2 = check(r.data, surfaceId, before, allowValues);
      if (res2.a2ui.length < res.a2ui.length || (!res2.a2ui.length && res2.other.length <= res.other.length)) {
        out = r.data;
        res = res2;
      }
    } catch (e) {
      attempts.push({ model: first.model, ms: 0, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  if (res.a2ui.length) throw new HttpError(502, "edited screen failed A2UI validation", { errors: res.a2ui, attempts });

  // Guardrail: values the user didn't ask to change are put back, whatever the model did.
  let messages = res.messages as A2uiMessage[];
  const warnings = res.other.filter((w) => !w.startsWith("data model /"));
  if (!allowValues) {
    const moved = movedValues(before, messages);
    if (moved.length) {
      const patched = [...messages, ...moved.map((m) => ({ version: A2UI_VERSION, updateDataModel: { surfaceId, path: m.path, value: m.from } }) as A2uiMessage)];
      if (validateMessages(patched).ok) {
        messages = patched;
        warnings.push(`restored ${moved.length} value${moved.length === 1 ? "" : "s"} the edit changed (${moved.map((m) => m.path).slice(0, 3).join(", ")})`);
      }
    }
  }

  const validAnnIds = new Set(annotations.map((a) => a.id));
  const resolvedAnnotationIds = Array.isArray(out.resolvedAnnotationIds)
    ? out.resolvedAnnotationIds.filter((id): id is string => typeof id === "string" && validAnnIds.has(id))
    : annotations.map((a) => a.id);

  const revised: Screen = {
    ...screen,
    messages,
    model: first.model,
    createdAt: new Date().toISOString(),
    annotations: [],
  };
  return {
    screen: revised,
    summary: typeof out.summary === "string" && out.summary.trim() ? out.summary.trim().slice(0, 240) : `Applied: ${instruction}`,
    changed: changedComponents(before, messages),
    warnings,
    resolvedAnnotationIds: resolvedAnnotationIds.length ? resolvedAnnotationIds : annotations.map((a) => a.id),
    attempts,
    usage: totalUsage,
  };
}
