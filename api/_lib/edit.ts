import type { EditScreenRequest, EditScreenResponse } from "../../src/lib/api.js";
import { A2UI_VERSION, BASIC_CATALOG_ID, type A2uiMessage, type Screen } from "../../src/a2ui/types.js";
import { catalogPromptSummary, validateMessages } from "../../src/a2ui/validate.js";
import { callJson, HttpError, TimeoutError } from "./gemini.js";
import { getAt, getComponents, getDataModel, lintBindings, pinSurfaceId, screenToText } from "./dataModel.js";
import { getLlmConfig, type ResolvedLlmConfig } from "./models.js";

// Edits an existing A2UI screen from a chat instruction, touching only what the instruction needs.
// Same shape as screen.ts: primary model with fallback, validate, one repair round, then guardrails.

const SYSTEM = () => `You edit one existing screen of a flight-booking flow inside a chat assistant. The screen is an A2UI v0.9 message stream using ONLY the basic catalog below.

${catalogPromptSummary()}

Editing rules (all required):
1. Output one JSON object: {"summary": "<one short sentence on what you changed>", "messages": [ ...the FULL revised A2UI message stream... ]}.
2. messages = createSurface (catalogId "${BASIC_CATALOG_ID}"), then ONE updateComponents with EVERY component of the revised screen, then ONE updateDataModel with path "/" holding the whole data model. Use the surfaceId you are given. The root component id stays "root".
3. Change ONLY what the instruction needs. Keep every other component exactly as it was: same id, same type, same props, same order. New components get new descriptive snake_case ids.
4. If target components are listed, the change is about them; touch components outside that set only when the instruction can't be done otherwise (e.g. adding a sibling row next to a target).
5. Keep the data model stable: same keys, same values, same bindings. NEVER change prices, totals, flight numbers or ids, dates, times, passenger counts or currency unless the instruction explicitly asks to change those values. "Make the total bigger" means visual size, not a larger amount.
6. Any new dynamic value (a per-traveler price, a count) goes in the data model as a display-ready string derived from existing values (e.g. total / pax, formatted in the same currency) and is bound with {"path": "/..."}. Never hard-code a price in component props.
7. Visual emphasis tools in the basic catalog: Text variant (h1 > h2 > h3 > h4 > h5 > body > caption), Card grouping, Row/Column alignment, Divider, Icon. At most one Button with variant "primary".`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface ModelEdit {
  summary?: unknown;
  variant?: unknown;
  messages?: unknown;
}

function surfaceIdOf(screen: Screen): string {
  for (const m of screen.messages) {
    const cs = (m as Obj).createSurface;
    if (isObj(cs) && typeof cs.surfaceId === "string") return cs.surfaceId;
  }
  return screen.id;
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
  const ids = Array.isArray(req.componentIds) ? req.componentIds.filter((x): x is string => typeof x === "string").slice(0, 24) : [];

  const t0 = Date.now();
  const remaining = () => budgetMs - (Date.now() - t0);
  const surfaceId = surfaceIdOf(screen);
  const before = screen.messages;
  const allowValues = ASKS_FOR_VALUES.test(instruction);
  const comps = new Map(getComponents(before).map((c) => [String(c.id), c]));
  const targets = ids.map((id) => comps.get(id)).filter(Boolean);

  const system = SYSTEM();
  const prompt = [
    `surfaceId: "${surfaceId}"`,
    `Node: "${screen.nodeId}". User context: ${JSON.stringify(screen.context ?? {})}. Layout: "${screen.variant}".`,
    `Screen as the user sees it:\n${screenToText(before, 80)}`,
    `Current message stream:\n${JSON.stringify(before)}`,
    targets.length
      ? `Target components (the user lassoed these on the screen):\n${targets.map((c) => JSON.stringify(c)).join("\n")}`
      : `No components were selected: the instruction applies to the whole screen.`,
    `Instruction: "${instruction}"`,
    `Return the JSON object now.`,
  ].join("\n\n");

  const attempts: EditScreenResponse["attempts"] = [];
  const editorCfg = getLlmConfig("editor");
  const fallbackCfg = getLlmConfig("generatorFallback");
  let first: { data: ModelEdit; model: string; raw: string; cfg: ResolvedLlmConfig } | undefined;
  for (const cfg of [editorCfg, fallbackCfg]) {
    const timeoutMs = Math.min(cfg === editorCfg ? cfg.timeoutMs : remaining() - 2000, remaining() - 2000);
    if (timeoutMs < 4000) break;
    try {
      const r = await callJson<ModelEdit>({
        model: cfg.model,
        system,
        prompt,
        temperature: cfg.temperature ?? 0.3,
        thinkingConfig: cfg.thinkingConfig,
        timeoutMs,
        retries: cfg.retries,
      });
      attempts.push({ model: cfg.model, ms: r.ms, ok: true });
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
        thinkingConfig: first.cfg.thinkingConfig,
        timeoutMs: remaining() - 1000,
        retries: 1,
      });
      attempts.push({ model: first.model, ms: r.ms, ok: true });
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
    attempts,
  };
}
