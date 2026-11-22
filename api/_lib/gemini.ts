import { GoogleGenAI, type ContentListUnion, type ThinkingConfig } from "@google/genai";
import { loadDotEnv } from "./env.js";
import { buildThinkingConfig, type ThinkingLevelSetting } from "./models.js";

let client: GoogleGenAI | undefined;

export function getGeminiClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY?.trim()) loadDotEnv();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new HttpError(500, "GEMINI_API_KEY is not set on the server (expected in .env)");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export const getClient = getGeminiClient;

/** Error carrying an HTTP status for route handlers. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export class TimeoutError extends Error {}

export const CARBON_TIMEOUT_MS = 200_000;
export const isCarbonModel = (model: string): boolean => /carbon/i.test(model);

export interface InlineMediaPart {
  mimeType: string;
  data: string;
}

export interface TokenUsageInfo {
  model: string;
  thinkingLevel?: ThinkingLevelSetting;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface JsonCallOptions {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  /** Reasoning level shortcut (converted via buildThinkingConfig). */
  thinkingLevel?: ThinkingLevelSetting;
  /** Explicit ThinkingConfig sourced from config.yaml. */
  thinkingConfig?: ThinkingConfig;
  /** Optional multimodal inline media (e.g. Paint & Speak region mask PNG). */
  inlineMedia?: InlineMediaPart[];
  /** Per-attempt timeout (automatically raised to CARBON_TIMEOUT_MS when using gemini-4-carbon). */
  timeoutMs?: number;
  /** Retries on 429 / 5xx / network errors (exponential backoff). Timeouts are not retried. */
  retries?: number;
}

export interface JsonCallResult<T> {
  data: T;
  raw: string;
  model: string;
  ms: number;
  usage: TokenUsageInfo;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

function isRetryable(e: unknown): boolean {
  if (e instanceof TimeoutError) return false;
  const s = statusOf(e);
  if (s === undefined) return !(e instanceof SyntaxError); // network-ish
  return s === 429 || s >= 500;
}

/** Strip code fences / leading prose and parse the first JSON value. */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1];
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new SyntaxError("model did not return JSON");
  }
}

async function once(opts: JsonCallOptions): Promise<{ text: string; usage: TokenUsageInfo }> {
  const baseTimeout = opts.timeoutMs ?? 45_000;
  const timeoutMs = isCarbonModel(opts.model) ? Math.max(baseTimeout, CARBON_TIMEOUT_MS) : baseTimeout;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError(`${opts.model} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const contents: ContentListUnion =
      opts.inlineMedia && opts.inlineMedia.length > 0
        ? [
            {
              role: "user",
              parts: [
                { text: opts.prompt },
                ...opts.inlineMedia.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })),
              ],
            },
          ]
        : opts.prompt;

    const resolvedThinking = opts.thinkingConfig ?? buildThinkingConfig(opts.model, opts.thinkingLevel);
    const res = await Promise.race([
      getGeminiClient().models.generateContent({
        model: opts.model,
        contents,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          temperature: opts.temperature,
          ...(resolvedThinking ? { thinkingConfig: resolvedThinking } : {}),
          abortSignal: ctrl.signal,
        },
      }),
      timeout,
    ]);
    const text = res.text;
    if (!text) throw new Error(`${opts.model} returned an empty response`);
    const meta = res.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
      | undefined;
    const promptTokens = meta?.promptTokenCount ?? 0;
    const outputTokens = meta?.candidatesTokenCount ?? 0;
    const thoughtTokens = meta?.thoughtsTokenCount ?? 0;
    return {
      text,
      usage: {
        model: opts.model,
        thinkingLevel: opts.thinkingLevel,
        promptTokens,
        outputTokens,
        thoughtTokens,
        totalTokens: promptTokens + outputTokens + thoughtTokens,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One JSON-mode call with backoff on rate limits. */
export async function callJson<T = unknown>(opts: JsonCallOptions): Promise<JsonCallResult<T>> {
  const retries = opts.retries ?? 4;
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const { text: raw, usage } = await once(opts);
      return { data: parseJsonLoose(raw) as T, raw, model: opts.model, ms: Date.now() - t0, usage };
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const base = statusOf(e) === 429 ? 2000 : 800;
      await sleep(base * 2 ** attempt + Math.random() * 500);
    }
  }
}
