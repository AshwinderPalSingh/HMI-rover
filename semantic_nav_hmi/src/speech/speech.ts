/**
 * Web Speech API wrappers. Recognition needs Chrome/Edge and a secure context
 * (https or localhost); text commands always work.
 */

import { app, notify } from '../state/store';

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string; confidence: number };
}

interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechInputSupported = (): boolean => ctor() !== null;

/** Why voice input can't work here, or null if it should. */
export function speechInputBlocker(): string | null {
  if (!ctor()) return 'Voice input needs Chrome or Edge. Typed commands work everywhere.';
  if (!window.isSecureContext) return 'Voice input needs HTTPS or localhost (browser microphone policy).';
  return null;
}

let rec: Recognition | null = null;

export function startListening(onFinal: (text: string) => void): void {
  const blocker = speechInputBlocker();
  const Ctor = ctor();
  if (blocker || !Ctor) {
    notify('warn', 'Voice', 'Voice input unavailable', blocker ?? undefined);
    return;
  }
  stopListening();
  const r = new Ctor();
  r.lang = app().settings.voice.lang;
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let finalText = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    app().patch({ interim: (finalText + interim).trim() });
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      notify('error', 'Voice', 'Microphone blocked', 'Allow microphone access for this site in the browser.');
    } else if (e.error === 'no-speech') {
      notify('info', 'Voice', 'No speech detected');
    } else if (e.error !== 'aborted') {
      notify('warn', 'Voice', 'Speech recognition error', e.error);
    }
  };
  r.onend = () => {
    rec = null;
    app().patch({ listening: false, interim: '' });
    const text = finalText.trim();
    if (text) onFinal(text);
  };
  try {
    r.start();
    rec = r;
    app().patch({ listening: true, interim: '' });
  } catch (err) {
    notify('warn', 'Voice', 'Could not start the microphone', String(err));
  }
}

export function stopListening(): void {
  if (rec) {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function speak(text: string): void {
  const s = app().settings.voice;
  if (!s.speak || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = s.lang;
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  } catch {
    /* TTS is a convenience; ignore failures */
  }
}
