// Voice input modality. Uses the browser's WebSpeech API
// (`SpeechRecognition`) for transcription — runs entirely on the
// operator's browser without on-device microphone hardware. The
// recognised utterance routes through a small command grammar
// that maps phrases onto the canonical verb vocabulary; matches
// dispatch through the shared verb dispatcher.
//
// Browsers without WebSpeech support: `start()` reports
// `unsupported` and the rest of the shell continues unaffected.
// Operators on those browsers fall back to keyboard / touch /
// gesture modalities.

import type { Verb, VerbDispatcher } from "./dispatcher";

/** One voice grammar entry. */
export interface VoicePattern {
  /** Regex matched against the lowercased recognised utterance. */
  readonly pattern: RegExp;
  /** Build the verb from the regex match groups. */
  readonly toVerb: (match: RegExpMatchArray) => Verb;
  /** Human-readable hint for the operator (rendered in the help surface). */
  readonly hint: string;
}

/** Framework default voice grammar — playback transport + navigation + search. */
export const DEFAULT_VOICE_PATTERNS: readonly VoicePattern[] = Object.freeze<
  VoicePattern[]
>([
  {
    pattern: /^(play|resume)$/,
    toVerb: (): Verb => ({ kind: "play" }),
    hint: 'Say "play" to resume playback',
  },
  {
    pattern: /^(pause|stop playing)$/,
    toVerb: (): Verb => ({ kind: "pause" }),
    hint: 'Say "pause" to pause playback',
  },
  {
    pattern: /^(stop)$/,
    toVerb: (): Verb => ({ kind: "stop" }),
    hint: 'Say "stop" to end playback',
  },
  {
    pattern: /^(next|skip( track)?)$/,
    toVerb: (): Verb => ({ kind: "next" }),
    hint: 'Say "next" to advance to the next track',
  },
  {
    pattern: /^(previous|back|prev)$/,
    toVerb: (): Verb => ({ kind: "previous" }),
    hint: 'Say "previous" to go back',
  },
  {
    pattern: /^volume up$/,
    toVerb: (): Verb => ({ kind: "volume_relative", delta: 0.1 }),
    hint: 'Say "volume up" to raise volume',
  },
  {
    pattern: /^volume down$/,
    toVerb: (): Verb => ({ kind: "volume_relative", delta: -0.1 }),
    hint: 'Say "volume down" to lower volume',
  },
  {
    pattern: /^search (.+)$/,
    toVerb: (m: RegExpMatchArray): Verb => ({
      kind: "search",
      query: m[1].trim(),
    }),
    hint: 'Say "search <query>" to find content',
  },
]);

/** Status emitted to consumers via the start() callback. */
export type VoiceStatus =
  | { readonly kind: "unsupported" }
  | { readonly kind: "started" }
  | { readonly kind: "stopped" }
  | { readonly kind: "transcribed"; readonly text: string }
  | { readonly kind: "dispatched"; readonly verb: Verb }
  | { readonly kind: "no_match"; readonly text: string }
  | { readonly kind: "error"; readonly message: string };

/** Active voice session. Call `stop()` to release the microphone. */
export interface VoiceSession {
  stop(): void;
}

/**
 * Begin a voice-input session. Returns a handle that releases the
 * microphone on call; the status callback fires for every relevant
 * lifecycle event so the renderer can show recognised text + verb
 * dispatch outcomes to the operator.
 */
export function startVoiceInput(
  dispatcher: VerbDispatcher,
  onStatus: (s: VoiceStatus) => void,
  patterns: readonly VoicePattern[] = DEFAULT_VOICE_PATTERNS,
): VoiceSession {
  if (typeof window === "undefined") {
    onStatus({ kind: "unsupported" });
    return { stop: () => {} };
  }
  const Recognizer = resolveRecognizer();
  if (Recognizer === null) {
    onStatus({ kind: "unsupported" });
    return { stop: () => {} };
  }
  const recognition = new Recognizer();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = window.navigator.language || "en-US";
  let stopped = false;

  recognition.onstart = (): void => onStatus({ kind: "started" });
  recognition.onend = (): void => {
    if (!stopped) {
      // Some browsers terminate after each utterance; restart to
      // keep the session live until the operator stops it.
      try {
        recognition.start();
      } catch {
        onStatus({ kind: "stopped" });
      }
    } else {
      onStatus({ kind: "stopped" });
    }
  };
  recognition.onerror = (event: SpeechRecognitionEventLike): void => {
    onStatus({
      kind: "error",
      message: event.error ?? "speech recognition refused",
    });
  };
  recognition.onresult = (event: SpeechRecognitionResultEvent): void => {
    const results = event.results;
    if (results === undefined || results.length === 0) return;
    const last = results[results.length - 1];
    if (last === undefined || last.length === 0) return;
    const alt = last[0];
    if (alt === undefined) return;
    const text = alt.transcript.trim().toLowerCase();
    onStatus({ kind: "transcribed", text });
    for (const pattern of patterns) {
      const m = text.match(pattern.pattern);
      if (m !== null) {
        const verb = pattern.toVerb(m);
        onStatus({ kind: "dispatched", verb });
        void dispatcher.dispatch(verb, "voice");
        return;
      }
    }
    onStatus({ kind: "no_match", text });
  };
  try {
    recognition.start();
  } catch (e) {
    onStatus({
      kind: "error",
      message: e instanceof Error ? e.message : "recognition.start refused",
    });
  }
  return {
    stop: () => {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // Browser refused — best-effort.
      }
    },
  };
}

// --- WebSpeech API typing (the lib.dom declarations are partial
// across browsers; declare just the surface we use) -----------

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onerror:
    | ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => unknown)
    | null;
  onresult:
    | ((
        this: SpeechRecognitionLike,
        ev: SpeechRecognitionResultEvent,
      ) => unknown)
    | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike extends Event {
  readonly error?: string;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative | undefined;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionResultEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

type RecognizerCtor = new () => SpeechRecognitionLike;

function resolveRecognizer(): RecognizerCtor | null {
  const w = window as unknown as Record<string, unknown>;
  const c =
    (w.SpeechRecognition as RecognizerCtor | undefined) ??
    (w.webkitSpeechRecognition as RecognizerCtor | undefined);
  return c ?? null;
}
