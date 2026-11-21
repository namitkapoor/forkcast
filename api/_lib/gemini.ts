import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new HttpError(500, "GEMINI_API_KEY is not set on the server");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

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

export interface JsonCallOptions {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries on 429 / 5xx / network errors (exponential backoff). Timeouts are not retried. */
  retries?: number;
}

export interface JsonCallResult<T> {
  data: T;
  raw: string;
  model: string;
  ms: number;
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

async function once(opts: JsonCallOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError(`${opts.model} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      getClient().models.generateContent({
        model: opts.model,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          temperature: opts.temperature,
          abortSignal: ctrl.signal,
        },
      }),
      timeout,
    ]);
    const text = res.text;
    if (!text) throw new Error(`${opts.model} returned an empty response`);
    return text;
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
      const raw = await once(opts);
      return { data: parseJsonLoose(raw) as T, raw, model: opts.model, ms: Date.now() - t0 };
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      const base = statusOf(e) === 429 ? 2000 : 800;
      await sleep(base * 2 ** attempt + Math.random() * 500);
    }
  }
}
