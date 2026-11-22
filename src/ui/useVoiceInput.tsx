import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowGraph } from "../graph/types";
import { transcribeAudio, type TokenUsage } from "../lib/api";
import { IconMic, IconMicOff } from "./icons";
import { normalizeSpokenMentions } from "./references";

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "audio/webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const comma = res.indexOf(",");
      if (comma < 0) return reject(new Error("Audio encoding failed"));
      resolve(res.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Audio read error"));
    reader.readAsDataURL(blob);
  });
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getBrowserSpeechCtor(): (new () => BrowserSpeechRecognition) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface UseVoiceInputOptions {
  getCurrentText: () => string;
  onTextUpdate: (nextText: string) => void;
  graph?: FlowGraph;
  onUsage?: (usage: TokenUsage) => void;
  onError?: (msg: string) => void;
}

export interface VoiceInputHandle {
  isListening: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  toggle: () => void;
  stop: () => void;
}

/**
 * Captures real microphone audio via MediaRecorder and transcribes incrementally + finally
 * through server-side `/api/transcribe` (Gemini Voice AI), normalizing spoken `@Pin-2:v1`,
 * `@Mask-1`, and `@step` mentions. Falls back to Web Speech API if `/api/transcribe` is offline.
 */
export function useVoiceInput({
  getCurrentText,
  onTextUpdate,
  graph,
  onUsage,
  onError,
}: UseVoiceInputOptions): VoiceInputHandle {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  const getTextRef = useRef(getCurrentText);
  getTextRef.current = getCurrentText;
  const onUpdateRef = useRef(onTextUpdate);
  onUpdateRef.current = onTextUpdate;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const onUsageRef = useRef(onUsage);
  onUsageRef.current = onUsage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const prefixRef = useRef("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const interimTimerRef = useRef<number | null>(null);
  const interimAbortRef = useRef<AbortController | null>(null);
  const finalAbortRef = useRef<AbortController | null>(null);
  const interimBusyRef = useRef(false);

  const cleanup = useCallback(() => {
    if (interimTimerRef.current !== null) {
      window.clearInterval(interimTimerRef.current);
      interimTimerRef.current = null;
    }
    interimAbortRef.current?.abort();
    interimAbortRef.current = null;
    interimBusyRef.current = false;
    if (speechRef.current) {
      try {
        speechRef.current.stop();
      } catch {
        /* ignore */
      }
      speechRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    const mediaSupported = Boolean(
      typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined",
    );
    setIsSupported(mediaSupported || Boolean(getBrowserSpeechCtor()));
    return () => {
      cleanup();
      finalAbortRef.current?.abort();
    };
  }, [cleanup]);

  const applyTranscript = useCallback((raw: string) => {
    const norm = normalizeSpokenMentions(raw, graphRef.current);
    if (!norm) return;
    const prefix = prefixRef.current;
    onUpdateRef.current(prefix ? `${prefix} ${norm}` : norm);
  }, []);

  const stop = useCallback(() => {
    if (interimTimerRef.current !== null) {
      window.clearInterval(interimTimerRef.current);
      interimTimerRef.current = null;
    }
    interimAbortRef.current?.abort();
    interimAbortRef.current = null;
    if (speechRef.current) {
      try {
        speechRef.current.stop();
      } catch {
        /* ignore */
      }
      speechRef.current = null;
    }
    setIsListening(false);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  }, []);

  const startBrowserSpeechFallback = useCallback(() => {
    const Ctor = getBrowserSpeechCtor();
    if (!Ctor) return false;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (ev) => {
        let joined = "";
        for (let i = 0; i < ev.results.length; i++) {
          joined += `${ev.results[i][0]?.transcript ?? ""} `;
        }
        applyTranscript(joined.trim());
      };
      rec.onerror = () => setIsListening(false);
      rec.onend = () => setIsListening(false);
      speechRef.current = rec;
      rec.start();
      setIsListening(true);
      return true;
    } catch {
      return false;
    }
  }, [applyTranscript]);

  const toggle = useCallback(async () => {
    if (isListening) {
      stop();
      return;
    }
    if (isTranscribing) {
      finalAbortRef.current?.abort();
      setIsTranscribing(false);
      return;
    }

    prefixRef.current = getTextRef.current().trimEnd();

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      if (!startBrowserSpeechFallback()) onErrorRef.current?.("Voice input is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = pickSupportedAudioMime();
      mimeRef.current = mimeType;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        const collected = [...chunksRef.current];
        const mime = mimeRef.current;
        cleanup();
        const finalBlob = new Blob(collected, { type: mime });
        if (finalBlob.size < 400) return;

        setIsTranscribing(true);
        const ctrl = new AbortController();
        finalAbortRef.current = ctrl;
        try {
          const audioBase64 = await blobToBase64(finalBlob);
          const res = await transcribeAudio({ audioBase64, mimeType: mime }, { signal: ctrl.signal });
          if (res.usage) onUsageRef.current?.(res.usage);
          if (res.transcript.trim()) applyTranscript(res.transcript);
        } catch (e) {
          if ((e as Error)?.name !== "AbortError") {
            onErrorRef.current?.((e as Error)?.message ?? "Voice transcription failed");
          }
        } finally {
          finalAbortRef.current = null;
          setIsTranscribing(false);
        }
      };

      recorder.start(900);
      setIsListening(true);

      // Live interim preview every ~2.8s while speaking
      interimTimerRef.current = window.setInterval(async () => {
        if (interimBusyRef.current || chunksRef.current.length < 2) return;
        const snap = new Blob([...chunksRef.current], { type: mimeRef.current });
        if (snap.size < 1200) return;
        interimBusyRef.current = true;
        const ctrl = new AbortController();
        interimAbortRef.current = ctrl;
        try {
          const audioBase64 = await blobToBase64(snap);
          const res = await transcribeAudio({ audioBase64, mimeType: mimeRef.current }, { signal: ctrl.signal });
          if (res.transcript.trim()) applyTranscript(res.transcript);
        } catch {
          /* ignore interim failures; final pass on stop is authoritative */
        } finally {
          interimBusyRef.current = false;
        }
      }, 2800);
    } catch (e) {
      cleanup();
      setIsListening(false);
      onErrorRef.current?.(`Microphone unavailable: ${(e as Error).message}`);
    }
  }, [applyTranscript, cleanup, isListening, isTranscribing, startBrowserSpeechFallback, stop]);

  return { isListening, isTranscribing, isSupported, toggle, stop };
}

export function VoiceMicButton({
  voice,
  disabled,
  compact,
  title,
}: {
  voice: VoiceInputHandle;
  disabled?: boolean;
  compact?: boolean;
  title?: string;
}) {
  if (!voice.isSupported) return null;
  const active = voice.isListening;
  const transcribing = voice.isTranscribing;
  return (
    <button
      type="button"
      disabled={disabled && !active && !transcribing}
      onClick={voice.toggle}
      className={`mic-btn${active ? " is-listening" : ""}${transcribing ? " is-transcribing" : ""}${compact ? " mic-btn--compact" : ""}`}
      title={
        title ??
        (active
          ? "Listening… click to stop & transcribe"
          : transcribing
            ? "Transcribing with Gemini… click to cancel"
            : "Speak (supports spoken @Pin-1:v1, @Mask-1, @step)")
      }
      aria-label={active ? "Stop recording" : "Speak"}
    >
      {transcribing ? (
        <span className="spinner" style={{ width: 12, height: 12 }} />
      ) : active ? (
        <IconMicOff width={13} height={13} />
      ) : (
        <IconMic width={13} height={13} />
      )}
      {!compact && <span>{active ? "Stop" : transcribing ? "…" : "Voice"}</span>}
    </button>
  );
}
