import { z } from "zod"

/**
 * What the organization says on its phone order line, in its own words
 * (owner, 2026-10-31: «завтра, если меня не будет, чтобы клиент сам мог
 * редактировать речь ассистента и его знания»; mockup approved «Давай»).
 * Stored in `settings.pharmacyPhoneOrders.lineSpeech` of the organization the
 * line saves orders to. An empty field is the line's own text from code. How
 * the order is taken (tools, saving, units, cancel, transfer, language) stays
 * in code: these fields are appended below it and never replace it.
 */

/** Station limits (scripts/pbx/fanum-zeytun-inbound.py): opening ≤ 500, closing 3–120. */
export const LINE_SPEECH_GREETING_MAX = 200
export const LINE_SPEECH_CLOSING_MAX = 120
/** Each note alone; together they also fit the notes budget (composeLinePrompt). */
export const LINE_SPEECH_NOTE_MAX = 2000

export type LineSpeech = { greeting: string; closing: string; manner: string; knowledge: string; rules: string }
export const EMPTY_LINE_SPEECH: LineSpeech = { greeting: "", closing: "", manner: "", knowledge: "", rules: "" }

// One line of speech: the station voices it and matches the closing word by word.
const phrase = (max: number) => z.string().trim().max(max)
  .refine(value => !/[\p{Cc}]/u.test(value), "one_line")
  .refine(value => value === "" || (value.match(/\p{L}/gu)?.length ?? 0) >= 3, "too_short")
const note = z.string().max(LINE_SPEECH_NOTE_MAX * 2)
  .transform(value => value.replace(/\r\n?/gu, "\n").replace(/[^\P{Cc}\n\t]/gu, "").replace(/\n{3,}/gu, "\n\n").trim())
  .refine(value => value.length <= LINE_SPEECH_NOTE_MAX, "too_long")

export const lineSpeechSchema = z.strictObject({
  greeting: phrase(LINE_SPEECH_GREETING_MAX),
  closing: phrase(LINE_SPEECH_CLOSING_MAX),
  manner: note, knowledge: note, rules: note,
})

/** The organization's line speech; anything unreadable is the line's own text. */
export function readLineSpeech(settings: unknown): LineSpeech {
  const section = (settings as { pharmacyPhoneOrders?: { lineSpeech?: unknown } } | null)?.pharmacyPhoneOrders?.lineSpeech
  const parsed = lineSpeechSchema.safeParse(section)
  return parsed.success ? parsed.data : EMPTY_LINE_SPEECH
}

/** The notes' total length: what the station's prompt limit is spent on. */
export const lineNotesLength = (speech: Pick<LineSpeech, "manner" | "knowledge" | "rules">) =>
  speech.manner.length + speech.knowledge.length + speech.rules.length
