import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTranscribeAudio } from '../ai/voiceTranscriber';
import { isAbortError } from '../ai/asyncController';
import { useStudioStore } from '../store/useStudioStore';

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'audio/webm';
}

export interface UseVoiceInputOptions {
  /** Reads the current text right when recording starts so streamed words append cleanly without duplication */
  getCurrentText: () => string;
  /** Receives the progressively updated full text as Gemini streams chunks back */
  onTextUpdate: (nextText: string) => void;
}

/**
 * Gemini-powered async streaming Voice AI hook:
 * 1. Captures real microphone audio via `getUserMedia` + `MediaRecorder` (works across Chrome, Arc, Brave, Safari, Firefox).
 * 2. Periodically streams live interim snapshots while speaking (~every 2.8s) via `generateContentStream`.
 * 3. On stop, streams the complete recording through `generateContentStream` for crisp final accuracy and logs token usage.
 */
export function useVoiceInput({ getCurrentText, onTextUpdate }: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  const getTextRef = useRef(getCurrentText);
  getTextRef.current = getCurrentText;
  const onUpdateRef = useRef(onTextUpdate);
  onUpdateRef.current = onTextUpdate;

  const prefixTextRef = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');
  const interimTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interimAbortRef = useRef<AbortController | null>(null);
  const finalAbortRef = useRef<AbortController | null>(null);
  const interimBusyRef = useRef(false);

  const cleanupRecording = useCallback(() => {
    if (interimTimerRef.current) {
      clearInterval(interimTimerRef.current);
      interimTimerRef.current = null;
    }
    interimAbortRef.current?.abort();
    interimAbortRef.current = null;
    interimBusyRef.current = false;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    const supported = Boolean(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        typeof MediaRecorder !== 'undefined'
    );
    setIsSupported(supported);

    return () => {
      cleanupRecording();
      finalAbortRef.current?.abort();
    };
  }, [cleanupRecording]);

  const applyTranscriptWithPrefix = useCallback((transcript: string) => {
    if (!transcript) return;
    const prefix = prefixTextRef.current;
    const combined = prefix ? `${prefix} ${transcript}` : transcript;
    onUpdateRef.current(combined);
  }, []);

  const stopAndFinalize = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setIsListening(false);
      return;
    }

    if (interimTimerRef.current) {
      clearInterval(interimTimerRef.current);
      interimTimerRef.current = null;
    }
    interimAbortRef.current?.abort();
    interimAbortRef.current = null;

    setIsListening(false);
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopAndFinalize();
      return;
    }

    if (isTranscribing) {
      finalAbortRef.current?.abort();
      setIsTranscribing(false);
      return;
    }

    const { settings, showToast } = useStudioStore.getState();
    if (!settings.apiKey.trim()) {
      showToast('Add GEMINI_API_KEY in .env to enable Gemini streaming voice transcription', 'warning');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mimeType = pickSupportedAudioMime();
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];
      prefixTextRef.current = getTextRef.current().trimEnd();

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        const collected = [...chunksRef.current];
        const mime = mimeTypeRef.current;
        cleanupRecording();

        const finalBlob = new Blob(collected, { type: mime });
        if (finalBlob.size < 400) {
          return;
        }

        setIsTranscribing(true);
        const ctrl = new AbortController();
        finalAbortRef.current = ctrl;

        try {
          const store = useStudioStore.getState();
          const res = await streamTranscribeAudio({
            audioBlob: finalBlob,
            mimeType: mime,
            settings: store.settings,
            project: store.project,
            onStreamUpdate: (partial) => applyTranscriptWithPrefix(partial),
            signal: ctrl.signal,
          });

          store.recordTokenUsage(res.usage);
          if (!res.transcript.trim()) {
            store.showToast('No speech detected in audio clip', 'info');
          }
        } catch (err) {
          if (!isAbortError(err)) {
            useStudioStore
              .getState()
              .showToast(`Voice transcription error: ${(err as Error).message}`, 'warning');
          }
        } finally {
          finalAbortRef.current = null;
          setIsTranscribing(false);
        }
      };

      // Collect chunks every 900ms so incremental streaming can run while speaking
      recorder.start(900);
      setIsListening(true);

      // Async incremental live preview stream every 2.7s while speaking
      interimTimerRef.current = setInterval(async () => {
        if (interimBusyRef.current || chunksRef.current.length < 2) return;
        const snapshotBlob = new Blob([...chunksRef.current], { type: mimeTypeRef.current });
        if (snapshotBlob.size < 1200) return;

        interimBusyRef.current = true;
        const ctrl = new AbortController();
        interimAbortRef.current = ctrl;

        try {
          const store = useStudioStore.getState();
          await streamTranscribeAudio({
            audioBlob: snapshotBlob,
            mimeType: mimeTypeRef.current,
            settings: store.settings,
            project: store.project,
            onStreamUpdate: (partial) => applyTranscriptWithPrefix(partial),
            signal: ctrl.signal,
          });
        } catch {
          // Ignore interim preview cancellations; final stream on stop is authoritative
        } finally {
          interimBusyRef.current = false;
        }
      }, 2700);
    } catch (err) {
      cleanupRecording();
      setIsListening(false);
      useStudioStore
        .getState()
        .showToast(
          `Microphone access blocked or unavailable: ${(err as Error).message}`,
          'warning'
        );
    }
  }, [applyTranscriptWithPrefix, cleanupRecording, isListening, isTranscribing, stopAndFinalize]);

  return { isListening, isTranscribing, isSupported, toggleListening };
}
