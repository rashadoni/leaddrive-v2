/**
 * What the guide's voice may spend (owner, 2026-10-20: «Кнопка "спросить
 * голосом"»).
 *
 * Two paid things, both started on our server and nowhere else: speaking a
 * Da Vinci answer aloud (Gemini TTS) and turning a prospect's spoken question
 * into text (Gemini). They share one budget in seconds of audio — the answer's
 * length plus the clip's — because that is what a minute of voice costs at
 * Google either way.
 *
 * Pure: limits, refusals and the arithmetic. The database claim that enforces
 * them is `../assistant-voice.ts`.
 */

/**
 * Twenty minutes of voice per person who requested a demo, answers spoken
 * plus questions heard (owner, 2026-10-21: «под каждого пользователя который
 * запросил демо. максимально 20 минут»). A person is the request's address
 * (`DemoRequest.emailNormalized`): every grant issued on a request from it —
 * a demo re-issued, a second request with the same address — draws on the
 * same twenty minutes, so a new link is not a new budget. Until then the
 * ceiling was ten minutes per grant, and each re-issue started it afresh.
 */
export const DEMO_ASSISTANT_VOICE_SECONDS_PER_PERSON = 20 * 60
/**
 * Three hundred minutes a day across every demo, a rolling 24 hours: the
 * safety cap over everyone's twenty, however many people ask at once.
 */
export const DEMO_ASSISTANT_VOICE_SECONDS_PER_DAY = 300 * 60

/** The longest question a prospect may say in one press. */
export const DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS = 15
/** Anything shorter is a press, not a question; refused before any call. */
export const DEMO_ASSISTANT_VOICE_CLIP_MIN_SECONDS = 0.4
/** The clip the browser sends: mono 16-bit PCM in a WAV file at this rate. */
export const DEMO_ASSISTANT_VOICE_CLIP_SAMPLE_RATE = 16_000

/** The longest answer that is spoken; a longer one stays text. */
export const DEMO_ASSISTANT_VOICE_MAX_CHARS = 1_200
/**
 * Seconds of speech a character takes, generously. The guide's recordings
 * run at about 0.08 s a character; live on 2026-10-20 an Azerbaijani sentence
 * took 0.093 s and a Russian one 0.11 s. The claim is made before Google
 * answers, so it is an estimate meant to be above the real length — but only
 * an estimate: figures read aloud (a phone number, an amount, a date) take far
 * more time than their characters, and a model can run on. So once the audio
 * is there, its real length is what the demo's row records, lower or higher
 * than the claim (assistant-voice.ts): Google bills the audio it made, and the
 * ceilings count what was billed.
 */
export const DEMO_ASSISTANT_VOICE_SECONDS_PER_CHAR = 0.14

export function speechSecondsUpperBound(text: string): number {
  return Math.max(1, Math.ceil(text.length * DEMO_ASSISTANT_VOICE_SECONDS_PER_CHAR))
}

/** What a heard clip costs, in whole seconds. */
export function clipChargeSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds))
}

export type DemoVoiceRefusal =
  | "not_enabled"
  | "refused"
  | "already_voiced"
  | "too_long"
  /**
   * The person's own twenty minutes. The name is older than the per-person
   * ceiling (it was the demo's ten) and stays: the page — and a tab opened
   * before this change — reads exactly this code to drop the button.
   */
  | "demo_budget"
  | "day_budget"
  | "bad_audio"
  | "too_short"
  | "silent"
  | "unavailable"

/** Azerbaijani copy for every refusal; the routes never invent a message. */
export const DEMO_VOICE_REFUSAL_TEXT: Readonly<Record<DemoVoiceRefusal, string>> = {
  not_enabled: "Səsli sual bu demo sessiyasında aktiv deyil.",
  refused: "Bu cavabı səsləndirmək olmur.",
  already_voiced: "Bu cavab artıq səsləndirilib.",
  too_long: "Bu cavab səsləndirmək üçün çox uzundur — mətni oxuyun.",
  demo_budget: `Sizin üçün ${DEMO_ASSISTANT_VOICE_SECONDS_PER_PERSON / 60} dəqiqəlik səs limiti doldu. Sualları yazın — cavablar mətnlə davam edir.`,
  day_budget: "Bu gün üçün səs limiti doldu. Sualları yazın — cavablar mətnlə davam edir.",
  bad_audio: "Səs yazısını oxuya bilmədik. Yenidən cəhd edin.",
  too_short: "Səs çox qısa oldu. Düyməni basıb sualınızı deyin.",
  silent: "Sualı eşidə bilmədik. Bir az ucadan, yenidən deyin.",
  unavailable: "Səs xidməti indi cavab vermədi. Sualı yazın və ya bir az sonra yenidən cəhd edin.",
}

export interface DemoVoiceSpend {
  /** Seconds this person has used: every claim of every grant on a request from this address, ever. */
  readonly person: number
  /** Seconds every demo together used in the last 24 hours. */
  readonly day: number
}

export interface DemoVoiceLimits {
  readonly perPerson: number
  readonly perDay: number
}

export const DEMO_ASSISTANT_VOICE_LIMITS: DemoVoiceLimits = {
  perPerson: DEMO_ASSISTANT_VOICE_SECONDS_PER_PERSON,
  perDay: DEMO_ASSISTANT_VOICE_SECONDS_PER_DAY,
}

export type DemoVoiceBudgetRefusal = { ok: false; refusal: "demo_budget" | "day_budget"; secondsLeft: number }

/**
 * Whether `claim` more seconds fit both ceilings. The person's own is named
 * first. A refusal knows how many seconds are still left under both — a long
 * answer's claim can be refused while a question still fits — but that
 * figure stays on the server (`demoVoiceExhausted`).
 */
export function checkVoiceBudget(
  spent: DemoVoiceSpend,
  claim: number,
  limits: DemoVoiceLimits = DEMO_ASSISTANT_VOICE_LIMITS,
): { ok: true } | DemoVoiceBudgetRefusal {
  const secondsLeft = Math.max(0, Math.min(limits.perPerson - spent.person, limits.perDay - spent.day))
  if (spent.person + claim > limits.perPerson) return { ok: false, refusal: "demo_budget", secondsLeft }
  if (spent.day + claim > limits.perDay) return { ok: false, refusal: "day_budget", secondsLeft }
  return { ok: true }
}

/**
 * What a budget refusal tells the page: whether voice is over for this
 * person, that is, not even one full question fits; until then a refused
 * answer stays text and «Səslə soruşun» stays. Only that. The seconds left
 * are the smaller of this person's and the whole day's — and the day's are
 * every other prospect's voice, which is none of this one's business.
 */
export function demoVoiceExhausted(secondsLeft: number): { exhausted: boolean } {
  return { exhausted: secondsLeft < DEMO_ASSISTANT_VOICE_CLIP_MAX_SECONDS }
}
