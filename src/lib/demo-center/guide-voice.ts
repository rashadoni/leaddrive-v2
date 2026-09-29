import { DEMO_PREPARED_INTENTS, DEMO_PREPARED_INTENT_IDS, stepNarration } from "./assistant/prepared-answers"
import { PROSPECT_TO_CLOSED_WON, withLiveCall, type DemoJourneyManifest, type DemoJourneyStep } from "./journey"

/**
 * The talking guide's recordings (owner, 2026-09-29: the guide speaks, the
 * prospect clicks and types).
 *
 * Every text the guide can say is known in advance — a step's narration or a
 * prepared answer — so each is recorded once with Google Gemini TTS (voice
 * Kore, as the demo clips) by `scripts/demo-guide/generate-voice.ts` and
 * shipped as a static file. Nothing is synthesised while a prospect waits:
 * the preview TTS allows a request or two a minute, and a demo costs nothing
 * to narrate.
 *
 * A file is named after its text (and the voice), so an edited sentence gets
 * a new file instead of a stale recording a service worker keeps serving
 * (the video-rename lesson), and `demo-guide-voice.test.ts` fails while any
 * text the guide can say has no recording.
 */

/** Change either and every recording is regenerated under new names. */
export const DEMO_GUIDE_VOICE = { model: "gemini-2.5-flash-preview-tts", voice: "Kore" } as const

/** Under public/sounds, which the proxy serves without a session. */
export const DEMO_GUIDE_VOICE_DIR = "sounds/demo-guide"

/** FNV-1a, twice with different seeds — a stable file key, not a secret. */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function demoVoiceKey(text: string): string {
  const keyed = `${DEMO_GUIDE_VOICE.model}|${DEMO_GUIDE_VOICE.voice}|${text.normalize("NFC")}`
  return fnv1a(keyed, 0x811c9dc5) + fnv1a(keyed, 0x01000193)
}

/** Where the browser fetches a text's recording. */
export function demoVoiceUrl(text: string): string {
  return `/${DEMO_GUIDE_VOICE_DIR}/${demoVoiceKey(text)}.mp3`
}

export function stepVoiceUrl(step: Pick<DemoJourneyStep, "title" | "instruction" | "targetLabel">): string {
  return demoVoiceUrl(stepNarration(step))
}

/** Every text the guide can say: each step of every manifest variant, and each fixed prepared answer. */
export function demoGuideVoiceTexts(manifests: readonly DemoJourneyManifest[] = [PROSPECT_TO_CLOSED_WON, withLiveCall(PROSPECT_TO_CLOSED_WON)]): string[] {
  const texts = new Set<string>()
  for (const manifest of manifests) {
    for (const section of manifest.sections) for (const step of section.steps) texts.add(stepNarration(step))
  }
  for (const id of DEMO_PREPARED_INTENT_IDS) {
    const answer = DEMO_PREPARED_INTENTS[id].answer
    // The step-dependent answer is a step narration, already in the set.
    if (answer && id !== "screen_help") texts.add((answer as () => string)())
  }
  return [...texts]
}
