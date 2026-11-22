import type { TranscribeRequest, TranscribeResponse } from "../../src/lib/api.js";
import { getClient, HttpError } from "./gemini.js";
import { buildThinkingConfig, getLlmConfig, taskConfigs } from "./models.js";

function extractTranscriptFromResponse(res: unknown): string {
  const r = res as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thought?: boolean;
          audioTranscription?: { text?: string };
        }>;
      };
    }>;
  };
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.audioTranscription?.text === "string" && part.audioTranscription.text) {
      chunks.push(part.audioTranscription.text);
    } else if (typeof part.text === "string" && part.text) {
      chunks.push(part.text);
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export async function transcribe(req: TranscribeRequest): Promise<TranscribeResponse> {
  const audioBase64 = typeof req?.audioBase64 === "string" ? req.audioBase64.trim() : "";
  if (!audioBase64) throw new HttpError(400, "audioBase64 is required");
  if (audioBase64.length > 8_000_000) throw new HttpError(413, "audio clip too large");

  const rawMime = typeof req.mimeType === "string" ? req.mimeType : "audio/webm";
  const cleanMime = (rawMime.split(";")[0] || "audio/webm").trim().toLowerCase();
  const safeMime = cleanMime.startsWith("audio/") ? cleanMime : "audio/webm";

  const primaryTask = taskConfigs.transcribe;
  const fallbackCfg = getLlmConfig("transcribeFallback");
  const candidates = [
    { model: primaryTask.model, level: primaryTask.thinkingLevel, timeoutMs: getLlmConfig("transcribe").timeoutMs },
    ...(fallbackCfg.model !== primaryTask.model
      ? [{ model: fallbackCfg.model, level: "LOW" as const, timeoutMs: fallbackCfg.timeoutMs }]
      : []),
  ];

  const errors: string[] = [];
  for (const cand of candidates) {
    const isDedicatedTranscriber = /transcribe/i.test(cand.model);
    const thinkingConfig = !isDedicatedTranscriber ? buildThinkingConfig(cand.model, cand.level, false) : undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cand.timeoutMs || 25_000);
    try {
      const res = await getClient().models.generateContent({
        model: cand.model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: safeMime, data: audioBase64 } },
              {
                text: isDedicatedTranscriber
                  ? "Transcribe the spoken words accurately."
                  : "Transcribe this audio verbatim. Output ONLY the spoken words with no quotes or commentary. Output nothing if silent.",
              },
            ],
          },
        ],
        config: {
          temperature: 0,
          ...(!isDedicatedTranscriber
            ? {
                systemInstruction:
                  "You are an exact speech-to-text transcriber for a UI design & QA tool. Output ONLY the spoken words verbatim with no commentary or quotes. If silent, output an empty string.",
              }
            : {}),
          ...(thinkingConfig ? { thinkingConfig } : {}),
          abortSignal: ctrl.signal,
        },
      });

      const transcript = extractTranscriptFromResponse(res);
      const meta = res.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
        | undefined;
      const promptTokens = meta?.promptTokenCount ?? 0;
      const outputTokens = meta?.candidatesTokenCount ?? 0;
      const thoughtTokens = meta?.thoughtsTokenCount ?? 0;

      return {
        transcript,
        model: cand.model,
        usage: {
          model: cand.model,
          thinkingLevel: cand.level,
          promptTokens,
          outputTokens,
          thoughtTokens,
          totalTokens: promptTokens + outputTokens + thoughtTokens,
        },
      };
    } catch (e) {
      errors.push(`${cand.model}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new HttpError(502, `voice transcription failed: ${errors.join(" | ")}`);
}
