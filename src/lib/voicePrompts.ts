/**
 * Spoken calibration prompts ("Move back", "Perfect, hold still", "Step in")
 * via `expo-speech`. Nothing is spoken after the hold except "Step in".
 *
 * The user is across the room from the phone during framing, so a voice is
 * the one channel that works at any distance. Rules:
 *   - rate-limited: at least SPEECH_MIN_GAP_MS between utterances, and the
 *     same line is never repeated back to back
 *   - off when the user disabled "Voice prompts" (playSetup.voicePrompts);
 *     the ring/silent switch is not observable from JS, hence the toggle
 *   - the module is probed with `requireOptionalNativeModule` before its JS
 *     package is imported, so a development build that predates expo-speech
 *     (it needs a native build) degrades to silence, never a red screen
 *
 * `nextUtterance` is pure so the replay can pin the rate limit.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { INITIAL_SPEECH_GATE, nextUtterance } from '@/lib/speechGate';

export { INITIAL_SPEECH_GATE, nextUtterance, SPEECH_MIN_GAP_MS, type SpeechGate } from '@/lib/speechGate';

type SpeechModule = typeof import('expo-speech');

let speechPromise: Promise<SpeechModule | null> | null = null;

function loadSpeech(): Promise<SpeechModule | null> {
  if (!speechPromise) {
    speechPromise = (async () => {
      try {
        if (Platform.OS === 'web') return null;
        if (requireOptionalNativeModule('ExpoSpeech') === null) return null;
        return await import('expo-speech');
      } catch {
        return null;
      }
    })();
  }
  return speechPromise;
}

export type VoicePrompter = {
  /** Speak `line` if the rate limit and de-dup allow it. Fire-and-forget. */
  say(line: string | null, now?: number, urgent?: boolean): void;
  setEnabled(enabled: boolean): void;
  /** Stop anything in flight (leaving the screen). */
  stop(): void;
};

export function createVoicePrompter(enabled = true): VoicePrompter {
  let gate = INITIAL_SPEECH_GATE;
  let on = enabled;
  return {
    say(line, now = Date.now(), urgent = false) {
      if (!on) return;
      const decision = nextUtterance(gate, line, now, urgent);
      if (!decision.speak || !line) return;
      gate = decision.gate;
      void loadSpeech()
        .then((speech) => {
          if (!speech || !on) return;
          speech.stop().catch(() => {});
          speech.speak(line, { rate: 1.0, pitch: 1.0 });
        })
        .catch(() => {});
    },
    setEnabled(next) {
      on = next;
      if (!next) this.stop();
    },
    stop() {
      void loadSpeech()
        .then((speech) => speech?.stop())
        .catch(() => {});
    },
  };
}
