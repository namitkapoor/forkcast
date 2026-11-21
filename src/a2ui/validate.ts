// Node-safe A2UI v0.9 validation + LLM prompt summary.
// No DOM, no React: server routes import this to check model output before storing it.
//
// Validation runs the stream through web_core's own MessageProcessor with STRICT_VALIDATION
// and the basic catalog, so "valid" means exactly "the renderer will accept it", plus a few
// cheap structural checks the processor tolerates (version string, one surface per stream,
// catalog id, a root component).

import { MessageProcessor, STRICT_VALIDATION } from "@a2ui/web_core/v0_9";
import { basicCatalog } from "@a2ui/web_core/v0_9/basic_catalog";
import { A2UI_VERSION, BASIC_CATALOG_ID } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const OPS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateMessages(messages: unknown[]): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(messages)) return { ok: false, errors: ["messages must be an array"] };
  if (messages.length === 0) return { ok: false, errors: ["messages is empty"] };

  // 1. Envelope checks (cheap, give the model precise feedback).
  const surfaceIds = new Set<string>();
  let sawCreate = false;
  let sawRoot = false;
  messages.forEach((m, i) => {
    if (!isObj(m)) {
      errors.push(`messages[${i}]: not an object`);
      return;
    }
    if (m.version !== A2UI_VERSION) errors.push(`messages[${i}]: version must be "${A2UI_VERSION}" (got ${JSON.stringify(m.version)})`);
    const ops = OPS.filter((k) => k in m);
    const extra = Object.keys(m).filter((k) => k !== "version" && !(OPS as readonly string[]).includes(k));
    if (ops.length !== 1) errors.push(`messages[${i}]: must contain exactly one of ${OPS.join(", ")} (found ${ops.length ? ops.join(", ") : "none"})`);
    if (extra.length) errors.push(`messages[${i}]: unknown key(s) ${extra.join(", ")}`);
    const op = ops[0];
    const body = op ? m[op] : undefined;
    if (!isObj(body)) return;
    if (typeof body.surfaceId === "string") surfaceIds.add(body.surfaceId);
    if (op === "createSurface") {
      if (i !== 0) errors.push(`messages[${i}]: createSurface must be the first message`);
      sawCreate = true;
      if (body.catalogId !== BASIC_CATALOG_ID) errors.push(`messages[${i}]: catalogId must be "${BASIC_CATALOG_ID}"`);
    }
    if (op === "updateComponents" && Array.isArray(body.components)) {
      if (body.components.some((c) => isObj(c) && c.id === "root")) sawRoot = true;
    }
  });
  if (!sawCreate) errors.push("stream must start with a createSurface message");
  if (!sawRoot) errors.push('no component with id "root" (the surface renders from "root")');
  if (surfaceIds.size > 1) errors.push(`stream must target one surface (found ${[...surfaceIds].join(", ")})`);

  // 2. Run it through the real processor: schema, catalog props, references, graph integrity.
  const processor = new MessageProcessor([basicCatalog], undefined, { validationConfig: STRICT_VALIDATION });
  try {
    const rendererErrors = processor.processMessagesWithErrors(messages);
    for (const e of rendererErrors) {
      const err = (e as { error?: { code?: string; path?: string; message?: string } }).error;
      if (!err) continue;
      errors.push(`${err.code ?? "ERROR"}${err.path ? ` at ${err.path}` : ""}: ${err.message ?? "unknown error"}`);
    }
  } catch (e) {
    errors.push(`processor threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try {
      processor.dispose();
    } catch {
      /* ignore */
    }
  }

  // De-dupe (envelope + processor can report the same thing).
  const unique = [...new Set(errors)];
  return { ok: unique.length === 0, errors: unique };
}

// ---------------------------------------------------------------------------
// Prompt summary, derived from the basic catalog's published JSON schema.

type JsonSchema = Record<string, any>;

const COMMON_PROPS = new Set(["id", "component", "accessibility", "weight", "checks"]);

const REF_LABEL: Record<string, string> = {
  ComponentId: "id",
  ChildList: 'id[] | {componentId,path}',
  DynamicString: "str|{path}",
  DynamicNumber: "num|{path}",
  DynamicBoolean: "bool|{path}",
  DynamicStringList: "str[]|{path}",
  DynamicValue: "any|{path}",
  Action: "Action",
};

function propType(p: JsonSchema): string {
  if (p.$ref) {
    const name = String(p.$ref).split("/").pop() ?? "?";
    return REF_LABEL[name] ?? name;
  }
  if (Array.isArray(p.enum)) return p.enum.join("|");
  if (p.type === "array" && p.items?.properties) {
    const inner = Object.entries<JsonSchema>(p.items.properties)
      .map(([k, v]) => `${k}:${propType(v)}`)
      .join(", ");
    return `[{${inner}}]`;
  }
  if (Array.isArray(p.oneOf)) {
    const e = p.oneOf.find((o: JsonSchema) => Array.isArray(o.enum));
    if (e) return `iconName|{path}`;
    return p.oneOf.map(propType).join(" | ");
  }
  return String(p.type ?? "any");
}

let cachedSummary: string | undefined;

export function catalogPromptSummary(): string {
  if (cachedSummary) return cachedSummary;
  const vs = (basicCatalog as unknown as { validationSchema: JsonSchema }).validationSchema;
  const comps = Object.entries<JsonSchema>(vs.components ?? {});
  const lines = comps.map(([name, s]) => {
    const req = new Set<string>(s.required ?? []);
    const props = Object.entries<JsonSchema>(s.properties ?? {})
      .filter(([k]) => !COMMON_PROPS.has(k))
      .map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${propType(v)}`);
    return `- ${name} { ${props.join("; ")} }`;
  });

  const iconEnum: string[] =
    vs.components?.Icon?.properties?.name?.oneOf?.find((o: JsonSchema) => Array.isArray(o.enum))?.enum ?? [];
  const fnNames = Object.keys(vs.functions ?? {});

  const example = [
    { version: "v0.9", createSurface: { surfaceId: "s1", catalogId: BASIC_CATALOG_ID } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "s1",
        components: [
          { id: "root", component: "Column", children: ["title", "price", "buy"], align: "stretch" },
          { id: "title", component: "Text", text: "Your trip", variant: "h2" },
          { id: "price", component: "Text", text: { path: "/total" } },
          { id: "buy_label", component: "Text", text: "Continue" },
          { id: "buy", component: "Button", child: "buy_label", variant: "primary", action: { event: { name: "continue", context: { total: { path: "/total" } } } } },
        ],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId: "s1", path: "/", value: { total: "€412" } } },
  ];

  cachedSummary = [
    `A2UI v0.9 — a screen is a JSON array of messages. Every message is {"version":"v0.9", <one op>}.`,
    `Ops: createSurface {surfaceId, catalogId:"${BASIC_CATALOG_ID}"} (first) · updateComponents {surfaceId, components:[...]} · updateDataModel {surfaceId, path?:"/x", value}.`,
    `Components are a FLAT list: {"id":"...","component":"<Name>", ...props}. Exactly one has id "root". Parents reference children by id (child / children); every referenced id must exist and every component must be reachable from root. No unknown props.`,
    `Data binding: any str|{path} prop takes a literal or {"path":"/json/pointer"} into the data model (set via updateDataModel). In a ChildList template {componentId,path}, paths inside the template are relative to each list item.`,
    `Action: {"event":{"name":"camelCaseName","context":{key: literal|{path}}}} — the button press reported to the app. (Or {"functionCall":{call,args}} for local functions: ${fnNames.join(", ")}.)`,
    `Text.text supports simple Markdown (**bold**, *italic*); variants h1–h5/caption skip Markdown. Button needs a child (usually a Text). Any component may set weight (flex-grow) inside Row/Column.`,
    `Basic catalog components (prop? = optional):`,
    ...lines,
    iconEnum.length ? `Icon names: ${iconEnum.join(", ")}.` : "",
    `Example:`,
    JSON.stringify(example),
  ]
    .filter(Boolean)
    .join("\n");
  return cachedSummary;
}
