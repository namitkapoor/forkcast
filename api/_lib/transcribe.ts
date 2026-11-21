import type { TranscribeRequest, TranscribeResponse } from "../../src/lib/api.js";
import { getClient, HttpError } from "./gemini.js";
import { buildThinkingConfig, taskConfigs } from "./models.js";

export async function transcribe(req: TranscribeRequest): Promise<TranscribeResponse> {
  const audioBase64 = typeof req?.audioBase64 === "string" ? req.audioBase64.trim() : "";
  if (!audioBase64) throw new HttpError(400, "audioBase64 is required");
  if (audioBase64.length > 8_000_000) throw new HttpError(413, "audio clip too large");

  const rawMime = typeof req.mimeType === "string" ? req.mimeType : "audio/webm";
  const cleanMime = (rawMime.split(";")[0] || "audio/webm").trim();

  const task = taskConfigs.transcribe;
  const isDedicatedTranscriber = /transcribe/i.test(task.model);
  const thinkingConfig = !isDedicatedTranscriber ? buildThinkingConfig(task.model, task.thinkingLevel, false) : undefined;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22_000);
  try {
    const res = await getClient().models.generateContent({
      model: task.model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: cleanMime, data: audioBase64 } },
            {
              text: isDedicatedTranscriber
                ? "Transcribe the spoken words accurately."
                : "Transcribe this audio verbatim. Output ONLY the spoken words with no quotes or commentary. Output nothing if silent.",
            },
          ],
        },
      ],
      config: {
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

    const transcript = (res.text ?? "").trim();
    const meta = res.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
      | undefined;
    const promptTokens = meta?.promptTokenCount ?? 0;
    const outputTokens = meta?.candidatesTokenCount ?? 0;
    const thoughtTokens = meta?.thoughtsTokenCount ?? 0;

    return {
      transcript,
      model: task.model,
      usage: {
        model: task.model,
        thinkingLevel: task.thinkingLevel,
        promptTokens,
        outputTokens,
        thoughtTokens,
        totalTokens: promptTokens + outputTokens + thoughtTokens,
      },
    };
  } catch (e) {
    throw new HttpError(502, `voice transcription failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
