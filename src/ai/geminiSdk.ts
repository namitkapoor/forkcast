import { GoogleGenAI, type Schema } from '@google/genai';
import type { LlmTaskConfig, RuntimeSettings } from '../types/studio';
import { buildThinkingConfig } from './llmConfig';

export interface GeminiJsonCallOptions {
  settings: RuntimeSettings;
  taskConfig: LlmTaskConfig;
  systemPrompt: string;
  userText: string;
  images?: Array<{ dataUrl: string }>;
  responseSchema?: Schema;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GeminiJsonCallResult<T> {
  parsed: T;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

function extractBase64FromDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function parseJsonResilient<T>(rawText: string, modelLabel: string): T {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error(`Empty response returned by ${modelLabel}`);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(`Malformed JSON returned by ${modelLabel}`);
  }
}

export async function callGeminiJson<T>({
  settings,
  taskConfig,
  systemPrompt,
  userText,
  images = [],
  responseSchema,
  signal,
  timeoutMs = 95_000,
}: GeminiJsonCallOptions): Promise<GeminiJsonCallResult<T>> {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Set it in .env or Studio Settings.');
  }

  const ai = new GoogleGenAI({ apiKey });

  const parts: Array<Record<string, unknown>> = [{ text: userText }];
  for (const img of images) {
    const parsedImg = extractBase64FromDataUrl(img.dataUrl);
    if (parsedImg) {
      parts.push({
        inlineData: {
          mimeType: parsedImg.mimeType,
          data: parsedImg.data,
        },
      });
    }
  }

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onParentAbort = () => timeoutCtrl.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const thinkingConfig = buildThinkingConfig(taskConfig, settings.includeThoughts);
    const response = await ai.models.generateContent({
      model: taskConfig.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        maxOutputTokens: 16384,
        ...(responseSchema ? { responseSchema } : {}),
        thinkingConfig,
        abortSignal: timeoutCtrl.signal,
      },
    });

    const parsed = parseJsonResilient<T>(
      response.text ?? '',
      `${taskConfig.model} (${taskConfig.thinkingLevel})`
    );

    const meta = response.usageMetadata as
      | {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
        }
      | undefined;

    return {
      parsed,
      promptTokens: meta?.promptTokenCount ?? 800,
      outputTokens: meta?.candidatesTokenCount ?? 1200,
      thoughtTokens: meta?.thoughtsTokenCount ?? 0,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}
