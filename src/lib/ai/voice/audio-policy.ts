import {
  ActivityHandling,
  EndSensitivity,
  StartSensitivity,
  TurnCoverage,
  type LiveConnectConfig,
} from "@google/genai"

/**
 * One place for the audio and turn-taking policy (roadmap A3.1, A3.11, A3.12).
 *
 * The local loudness meter has not been able to interrupt anything since the
 * Phase 2 hotfix — it only lights the orb. The remaining authority is the
 * provider's own speech detector, and in a café that is the whole problem:
 * music with vocals is, to a voice-activity detector, the thing it is looking
 * for. Sensitivity is already at its lowest on both ends, which buys a quiet
 * office and does not buy a loud room.
 *
 * So the fix is not a better detector, which the roadmap rightly refuses to
 * add before anyone has measured the current one. It is to take away the
 * consequence: in a noisy room, nothing the microphone hears may cut the
 * assistant off mid-sentence.
 *
 * Two modes, and the difference is one field:
 *
 * - `auto` — what shipped. The provider's detector owns barge-in, so real
 *   speech interrupts the answer immediately. Correct at a desk.
 * - `noisy` — the detector still hears the user and still ends their turn, so
 *   the conversation works normally. It simply may not interrupt playback.
 *   The assistant finishes its sentence; the user's words are not lost, they
 *   are handled after it. Music gets no way to stop anything.
 *
 * What `noisy` costs, stated plainly because the UI has to say it: the user
 * cannot cut the assistant off by talking over it either. The stop button
 * still works, and in a room where every third sentence was being cut by a
 * speaker overhead, that is the better trade.
 *
 * The policy is minted into the ephemeral token, so the mode is fixed for the
 * life of a session: the browser cannot raise its own privileges by editing a
 * request, and changing mode means starting a new session.
 */

export const VOICE_AUDIO_MODES = ["auto", "noisy"] as const

export type VoiceAudioMode = (typeof VOICE_AUDIO_MODES)[number]

export const DEFAULT_VOICE_AUDIO_MODE: VoiceAudioMode = "auto"

export function isVoiceAudioMode(value: unknown): value is VoiceAudioMode {
  return typeof value === "string" && (VOICE_AUDIO_MODES as readonly string[]).includes(value)
}

/**
 * The ear, tuned for a room with people in it.
 *
 * HIGH start sensitivity treats a cough, a keyboard or a colleague two desks
 * away as the user beginning to speak. HIGH end sensitivity with a short
 * window is the same fault in the other direction: the natural pause before a
 * number or a name ends the turn and the assistant answers half a question.
 *
 * LOW on both, with a longer silence window, costs a fraction of a second of
 * responsiveness and buys a conversation that survives an office. It is shared
 * by both modes — detection is not what changes between them.
 */
const DETECTION = {
  disabled: false,
  startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
  endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
  prefixPaddingMs: 300,
  silenceDurationMs: 900,
} as const

export function realtimeInputPolicy(
  mode: VoiceAudioMode = DEFAULT_VOICE_AUDIO_MODE,
): NonNullable<LiveConnectConfig["realtimeInputConfig"]> {
  return {
    automaticActivityDetection: { ...DETECTION },
    activityHandling: mode === "noisy"
      ? ActivityHandling.NO_INTERRUPTION
      : ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
    turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
  }
}

/**
 * What to tell the model about the room it is in.
 *
 * Without this the assistant keeps the habits of a quiet desk: it pauses for a
 * reply it cannot be interrupted into, and it apologises for talking over
 * someone it cannot talk over. One sentence is enough; the rest of the prompt
 * is unchanged.
 */
export function audioModeInstruction(mode: VoiceAudioMode): string | null {
  if (mode !== "noisy") return null
  return "The user is in a noisy place, so you cannot be interrupted by speech: finish each sentence, keep answers short, and never apologise for talking over the user. If their request arrives while you are speaking, answer it after you finish."
}
