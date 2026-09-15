/**
 * Pure rate limit for spoken prompts (no native imports, so the replay can
 * pin it). Used by `voicePrompts.ts`.
 */

/** Minimum gap between spoken prompts. */
export const SPEECH_MIN_GAP_MS = 2_500;

export type SpeechGate = {
  lastSpokenAt: number;
  lastLine: string | null;
};

export const INITIAL_SPEECH_GATE: SpeechGate = { lastSpokenAt: -Infinity, lastLine: null };

/**
 * Decide whether `line` may be spoken at `now`. Returns the next gate and
 * whether to speak. `urgent` lines ("Step in") skip the de-dup but never
 * the minimum gap.
 */
export function nextUtterance(
  gate: SpeechGate,
  line: string | null,
  now: number,
  urgent = false,
): { speak: boolean; gate: SpeechGate } {
  if (!line) return { speak: false, gate };
  if (!urgent && gate.lastLine === line) return { speak: false, gate };
  if (now - gate.lastSpokenAt < SPEECH_MIN_GAP_MS) return { speak: false, gate };
  return { speak: true, gate: { lastSpokenAt: now, lastLine: line } };
}
