import { GoogleGenAI } from '@google/genai';
import type { FlowProject, RuntimeSettings, TokenUsageEntry } from '../types/studio';
import { buildThinkingConfig } from './llmConfig';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Failed to encode recorded audio'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Audio read error'));
    reader.readAsDataURL(blob);
  });
}

const WORD_NUMS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

/**
 * Converts spoken Studio mentions like "at pin 2 version 1" -> `@Pin-2:v1`,
 * "at mask one" -> `@Mask-1`, and "at checkout" -> `@Checkout`.
 */
export function normalizeSpokenStudioMentions(text: string, project: FlowProject): string {
  let out = text;

  // "at pin 2 version 1" / "at pin two v 1" -> @Pin-2:v1
  out = out.replace(
    /\b(?:at|@)\s*(pin|mask)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:version|ver|v)\s*(\d+|one|two|three|four|five))?\b/gi,
    (_, kindRaw: string, numRaw: string, verRaw?: string) => {
      const kind = kindRaw.toLowerCase() === 'mask' ? 'Mask' : 'Pin';
      const num = WORD_NUMS[numRaw.toLowerCase()] ?? numRaw;
      if (verRaw) {
        const ver = WORD_NUMS[verRaw.toLowerCase()] ?? verRaw;
        return `@${kind}-${num}:v${ver}`;
      }
      return `@${kind}-${num}`;
    }
  );

  // Match "at <ScreenSlug>" against actual project screens
  for (const sc of Object.values(project.screens)) {
    const escapedSlug = sc.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const slugWords = sc.slug.replace(/([a-z])([A-Z])/g, '$1\\s*$2');
    const re = new RegExp(`\\bat\\s+(?:${escapedSlug}|${slugWords})\\b`, 'gi');
    out = out.replace(re, `@${sc.slug}`);
  }

  return out.replace(/\s+/g, ' ').trim();
}

export interface StreamTranscriptionOptions {
  audioBlob: Blob;
  mimeType: string;
  settings: RuntimeSettings;
  project: FlowProject;
  onStreamUpdate: (transcriptSoFar: string) => void;
  signal?: AbortSignal;
}

export interface StreamTranscriptionResult {
  transcript: string;
  usage: TokenUsageEntry;
}

/**
 * Sends recorded microphone audio to Google AI Studio asynchronously and streams
 * transcribed text chunks back in real time via `ai.models.generateContentStream`.
 *
 * Compatible with both dedicated transcription models (`gemini-3.5-transcribe`, which
 * disallow `systemInstruction`) and `gemini-4-*` multimodal models (`thinkingLevel`).
 */
export async function streamTranscribeAudio({
  audioBlob,
  mimeType,
  settings,
  project,
  onStreamUpdate,
  signal,
}: StreamTranscriptionOptions): Promise<StreamTranscriptionResult> {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    throw new Error('Set GEMINI_API_KEY in .env (or Settings) to use Gemini Voice AI.');
  }

  const taskConfig = settings.llmTasks.VOICE_TRANSCRIBE;
  const base64Audio = await blobToBase64(audioBlob);
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Strip codecs suffix (e.g. "audio/webm;codecs=opus" -> "audio/webm") for clean API MIME acceptance
  const cleanMime = (mimeType.split(';')[0] || 'audio/webm').trim();
  const isDedicatedTranscriber = /transcribe/i.test(taskConfig.model);
  const isGemini4 = /gemini-4/i.test(taskConfig.model);

  const ai = new GoogleGenAI({ apiKey });

  const config: Record<string, unknown> = {
    abortSignal: signal,
  };

  if (!isDedicatedTranscriber) {
    config.systemInstruction =
      'You are an exact speech-to-text transcriber for a UI design tool. Output ONLY the spoken words verbatim with no commentary or quotes. If there is no speech, output an empty string.';
  }
  if (isGemini4) {
    config.thinkingConfig = buildThinkingConfig(taskConfig, false);
  }

  const promptInstruction = isDedicatedTranscriber
    ? 'Transcribe the spoken words accurately.'
    : 'Transcribe this audio verbatim. Output nothing if silent.';

  const stream = await ai.models.generateContentStream({
    model: taskConfig.model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: base64Audio,
            },
          },
          { text: promptInstruction },
        ],
      },
    ],
    config,
  });

  let rawAccumulated = '';
  let promptTokens = 0;
  let outputTokens = 0;
  let thoughtTokens = 0;

  for await (const chunk of stream) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const piece = chunk.text ?? '';
    if (piece) {
      rawAccumulated += piece;
      const normalized = normalizeSpokenStudioMentions(rawAccumulated, project);
      onStreamUpdate(normalized);
    }
    const meta = chunk.usageMetadata as
      | {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
        }
      | undefined;
    if (meta) {
      promptTokens = meta.promptTokenCount ?? promptTokens;
      outputTokens = meta.candidatesTokenCount ?? outputTokens;
      thoughtTokens = meta.thoughtsTokenCount ?? thoughtTokens;
    }
  }

  const finalTranscript = normalizeSpokenStudioMentions(rawAccumulated, project);
  onStreamUpdate(finalTranscript);

  return {
    transcript: finalTranscript,
    usage: {
      id: uid('tok-voice'),
      timestamp: Date.now(),
      action: 'voice-transcribe',
      taskKey: 'VOICE_TRANSCRIBE',
      priority: 'supporting',
      model: taskConfig.model,
      thinkingLevel: taskConfig.thinkingLevel,
      promptTokens: promptTokens || 180,
      outputTokens: outputTokens || 24,
      thoughtTokens,
      totalTokens: (promptTokens || 180) + (outputTokens || 24) + thoughtTokens,
    },
  };
}
