import type { MouseEvent } from "react";
import { IconMic, IconMicOff, IconX } from "./icons";
import type { BrowserVoiceState } from "./useBrowserVoice";

export interface VoiceButtonProps {
  voice: BrowserVoiceState;
  disabled?: boolean;
  /** Compact icon-only mode (e.g. narrow inline input rows) vs. labeled voice-first pill. */
  compact?: boolean;
  /** Label shown when idle in non-compact mode. Defaults to "Speak". */
  label?: string;
  /** Accessible label for the mic trigger. */
  ariaLabel?: string;
}

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function VoiceButton({
  voice,
  disabled,
  compact = false,
  label = "Speak",
  ariaLabel = "Voice input",
}: VoiceButtonProps) {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    voice.toggle();
  };

  const title = !voice.isSupported
    ? "Microphone recording is not supported in this browser"
    : voice.isTranscribing
      ? "Transcribing audio with Gemini…"
      : voice.isListening
        ? "Stop recording & transcribe"
        : "Speak (transcribed via Gemini)";

  return (
    <button
      type="button"
      className={`voice-btn${compact ? " voice-btn--compact" : ""}${voice.isListening ? " is-listening" : ""}${voice.isTranscribing ? " is-transcribing" : ""}${!voice.isSupported ? " is-unsupported" : ""}`}
      onClick={onClick}
      disabled={disabled || voice.isTranscribing}
      title={title}
      aria-label={voice.isListening ? "Stop recording" : voice.isTranscribing ? "Transcribing audio" : ariaLabel}
      aria-pressed={voice.isListening}
    >
      {voice.isTranscribing ? (
        <span className="spinner" aria-hidden="true" />
      ) : voice.isListening ? (
        <span className="voice-btn__pulse" aria-hidden="true" />
      ) : voice.isSupported ? (
        <IconMic width={14} height={14} />
      ) : (
        <IconMicOff width={14} height={14} />
      )}
      {!compact && (
        <span>
          {voice.isTranscribing ? "Transcribing…" : voice.isListening ? `Stop ${fmtSecs(voice.seconds)}` : label}
        </span>
      )}
    </button>
  );
}

export function VoiceFeedback({ voice }: { voice: BrowserVoiceState }) {
  if (!voice.isListening && !voice.isTranscribing && !voice.error) return null;

  if (voice.error) {
    return (
      <div className="voice-feedback voice-feedback--error" role="alert">
        <span>{voice.error}</span>
        <button
          type="button"
          className="voice-feedback__close"
          onClick={(e) => {
            e.stopPropagation();
            voice.clearError();
          }}
          aria-label="Dismiss voice error"
        >
          <IconX width={11} height={11} />
        </button>
      </div>
    );
  }

  if (voice.isTranscribing) {
    return (
      <div className="voice-feedback voice-feedback--transcribing" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>{voice.interimText ? `Transcribing: "${voice.interimText}"` : "Transcribing with Gemini…"}</span>
      </div>
    );
  }

  return (
    <div className="voice-feedback voice-feedback--live" aria-live="polite">
      <span className="voice-btn__pulse" aria-hidden="true" />
      <span>Recording {fmtSecs(voice.seconds)} — click Stop when done</span>
    </div>
  );
}
