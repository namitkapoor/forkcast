import { useCallback, useEffect, useRef, useState } from "react";

// Only one input surface should hold the microphone at a time.
let activeStop: (() => void) | null = null;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read recorded audio"));
    reader.onloadend = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.readAsDataURL(blob);
  });
}

function describeMicError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone permission blocked. Allow mic access in your browser settings.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone detected on this device.";
  }
  if (name === "NotReadableError") {
    return "Microphone is busy in another app.";
  }
  return err instanceof Error ? err.message : "Could not access microphone.";
}

export interface UseBrowserVoiceOptions {
  /** Current text in the controlled input, preserved as prefix when dictating. */
  value: string;
  /** Controlled setter updated live as Gemini streams the transcription. */
  onChange: (next: string) => void;
}

export interface BrowserVoiceState {
  isSupported: boolean;
  isListening: boolean;
  isTranscribing: boolean;
  seconds: number;
  interimText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  clearError: () => void;
}

export function useBrowserVoice({ value, onChange }: UseBrowserVoiceOptions): BrowserVoiceState {
  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const prefixRef = useRef("");

  valueRef.current = value;
  onChangeRef.current = onChange;

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseTracks = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob, mimeType: string) => {
    if (!blob.size) {
      if (mountedRef.current) setError("No audio recorded — try speaking a bit longer.");
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (mountedRef.current) {
      setIsTranscribing(true);
      setInterimText("");
    }

    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: mimeType || blob.type || "audio/webm" }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = `Transcription failed (${res.status})`;
        try {
          const j = JSON.parse(text) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          if (text) msg = text.slice(0, 160);
        }
        throw new Error(msg);
      }

      if (!res.body) throw new Error("Empty transcription stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          let evt: { delta?: string; error?: string; done?: boolean };
          try {
            evt = JSON.parse(jsonStr) as { delta?: string; error?: string; done?: boolean };
          } catch {
            continue;
          }
          if (evt.error) throw new Error(evt.error);
          if (evt.delta) {
            accumulated += evt.delta;
            if (mountedRef.current) {
              const cleaned = accumulated.trimStart();
              setInterimText(cleaned);
              const combined = prefixRef.current ? `${prefixRef.current} ${cleaned}` : cleaned;
              onChangeRef.current(combined);
            }
          }
        }
      }

      if (mountedRef.current && !accumulated.trim()) {
        setError("No speech detected — tap Speak and try again.");
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Voice transcription failed.");
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      if (mountedRef.current) {
        setIsTranscribing(false);
        setInterimText("");
      }
    }
  }, []);

  const stop = useCallback(() => {
    stopTimer();
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (activeStop === stop) activeStop = null;
    setIsListening(false);
    setSeconds(0);
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        releaseTracks();
      }
    } else {
      releaseTracks();
    }
  }, [releaseTracks, stopTimer]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("Audio recording isn't supported in this browser.");
      return;
    }

    if (activeStop && activeStop !== stop) {
      activeStop();
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    setError(null);
    setInterimText("");
    setSeconds(0);
    prefixRef.current = valueRef.current.trimEnd();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef.current = stream;

      const mimeType = pickAudioMimeType();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      activeStop = stop;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      rec.onerror = () => {
        releaseTracks();
        stopTimer();
        if (mountedRef.current) {
          setIsListening(false);
          setError("Audio recording failed.");
        }
      };

      rec.onstop = () => {
        const usedMime = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: usedMime });
        chunksRef.current = [];
        releaseTracks();
        void transcribeBlob(blob, usedMime);
      };

      rec.start(250);
      setIsListening(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        if (mountedRef.current) setSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 500);
    } catch (err) {
      releaseTracks();
      if (mountedRef.current) {
        setIsListening(false);
        setError(describeMicError(err));
      }
    }
  }, [isSupported, releaseTracks, stop, stopTimer, transcribeBlob]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else if (!isTranscribing) void start();
  }, [isListening, isTranscribing, start, stop]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopTimer();
      if (activeStop === stop) activeStop = null;
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== "inactive") {
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }
      }
      releaseTracks();
    };
  }, [releaseTracks, stop, stopTimer]);

  return {
    isSupported,
    isListening,
    isTranscribing,
    seconds,
    interimText,
    error,
    start: () => void start(),
    stop,
    toggle,
    clearError,
  };
}
