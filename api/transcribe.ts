import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGeminiClient } from "./_lib/gemini.js";
import { getLlmConfig } from "./_lib/models.js";

export const config = { maxDuration: 30 };

interface TranscribeBody {
  audioBase64?: unknown;
  mimeType?: unknown;
}

const PROMPT =
  "Transcribe the spoken audio verbatim into plain text. Return only the exact words spoken with natural punctuation. Do not add quotes, labels, timestamps, or commentary. If the audio is silent or unintelligible, return an empty string.";

function normalizeMime(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const base = s.split(";")[0]?.trim();
  if (base && base.startsWith("audio/")) return base;
  return "audio/webm";
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const body = (req.body ?? {}) as TranscribeBody;
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!audioBase64) {
    res.status(400).json({ error: "audioBase64 is required" });
    return;
  }
  const mimeType = normalizeMime(body.mimeType);

  let ai;
  try {
    ai = getGeminiClient();
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "GEMINI_API_KEY is not configured" });
    return;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");

  const writeEvent = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const configs = [getLlmConfig("transcribe"), getLlmConfig("transcribeFallback")];
  let lastError: unknown;

  for (const cfg of configs) {
    let emittedAny = false;
    try {
      const stream = await ai.models.generateContentStream({
        model: cfg.model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: PROMPT },
            ],
          },
        ],
        config: {
          temperature: cfg.temperature ?? 0,
          ...(cfg.thinkingConfig ? { thinkingConfig: cfg.thinkingConfig } : {}),
          abortSignal: AbortSignal.timeout(cfg.timeoutMs),
        },
      });

      for await (const chunk of stream) {
        const delta = chunk.text;
        if (delta) {
          emittedAny = true;
          writeEvent({ delta });
        }
      }

      writeEvent({ done: true, model: cfg.model });
      res.end();
      return;
    } catch (e) {
      lastError = e;
      if (emittedAny) {
        writeEvent({ error: e instanceof Error ? e.message : String(e) });
        res.end();
        return;
      }
      // Try fallback model if nothing was streamed yet.
    }
  }

  writeEvent({
    error: lastError instanceof Error ? lastError.message : "Gemini voice transcription failed",
  });
  res.end();
}
