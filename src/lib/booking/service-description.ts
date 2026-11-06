/**
 * The two or three lines a service shows under its name on its own booking
 * page, written by the model from what the form already knows.
 *
 * It exists because the description is the one field an owner skips: it is
 * optional, it is the only thing on the form that asks for prose, and an empty
 * one makes the public page look unfinished. Fresha solved it the same way
 * («Generate with AI» / «Enhance»), and the parts worth testing — what we ask
 * for and what we accept back — live here rather than in the route.
 *
 * What comes back is marketing copy for a page the client reads, so it is
 * cleaned before it reaches the form: the model answers with a preamble, with
 * the sentence in quotation marks or with markdown often enough that handing
 * that straight to the field would be a bug the owner has to fix by hand.
 */

export interface ServiceDescriptionInput {
  title: string
  category?: string | null
  durationMinutes: number
  locationType: "office" | "phone" | "online"
  /** As typed in the form; the currency is for the model's sense of scale only. */
  price?: string | null
  currency?: string | null
  /** Present when the owner already wrote something and asked to improve it. */
  current?: string | null
  /** The language the CRM is in for this person — what the client will read. */
  locale: string
}

/**
 * What the preview card and the public page can hold without the text turning
 * into an article. The schema allows 2000; this is an editorial limit, and the
 * owner can always keep typing past it themselves.
 */
export const SERVICE_DESCRIPTION_MAX = 320

const LANGUAGE: Record<string, string> = { az: "Azerbaijani", ru: "Russian", en: "English" }

const PLACE: Record<ServiceDescriptionInput["locationType"], string> = {
  office: "at the company's own address",
  phone: "over the phone",
  online: "as an online meeting",
}

/** The language name for the prompt; an unknown locale falls back to English. */
export function descriptionLanguage(locale: string): string {
  return LANGUAGE[locale.slice(0, 2).toLowerCase()] ?? LANGUAGE.en
}

export function serviceDescriptionPrompt(input: ServiceDescriptionInput): string {
  const facts = [
    `Service name: ${input.title.trim().slice(0, 120)}`,
    input.category?.trim() ? `Group: ${input.category.trim().slice(0, 60)}` : null,
    `Duration: ${input.durationMinutes} minutes`,
    `Takes place: ${PLACE[input.locationType]}`,
    input.price?.trim() ? `Price: ${input.price.trim()} ${input.currency ?? ""}`.trim() : null,
  ].filter(Boolean).join("\n")

  const task = input.current?.trim()
    ? `Rewrite the existing description below so it reads better. Keep every fact it states; do not invent new ones.\n\nExisting description:\n${input.current.trim().slice(0, 1000)}`
    : "Write the description from scratch."

  return `You write the short description shown to a customer on an online booking page for one service.

${task}

What is known about the service:
${facts}

Rules:
- Answer in ${descriptionLanguage(input.locale)}.
- One or two sentences, at most ${SERVICE_DESCRIPTION_MAX} characters in total.
- Say what the customer gets and why it is worth booking. Address the customer directly.
- The page already shows the price, the duration and the address next to this text. Do not repeat them.
- Invent nothing: no brand names, no guarantees, no results, no staff names, no discounts.
- No emoji, no markdown, no quotation marks around the answer, no heading, no preamble.
- Output the description itself and nothing else.`
}

/**
 * The description as the field may receive it.
 *
 * Models answer the instruction above with a preamble («Here is a short
 * description:»), with the sentence wrapped in quotes, or with markdown
 * emphasis; the form would then hold text the owner has to clean by hand, so
 * it is cleaned here. Over-long answers are cut at the last sentence that
 * fits, because a description ending mid-word reads as a failure of the CRM.
 */
export function cleanServiceDescription(raw: string): string {
  let text = raw.replace(/\r/g, "").trim()
  // A preamble the model added before the text it was asked for. Only a short
  // leading line ending in a colon counts — a colon inside the description
  // itself («Мы предлагаем: …») must survive.
  text = text.replace(/^[^\n:]{0,60}:[ \t]*\n+/, "").trim()
  text = text.replace(/^```[a-z]*\n?|```$/g, "").trim()
  text = text.replace(/[*_`#]/g, "")
  // Collapse the paragraphs a model sometimes returns into one line: the field
  // is two rows high and the public page shows it as a single paragraph.
  text = text.replace(/\s*\n+\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim()
  // Quotation marks around the whole answer, straight or typographic.
  const quoted = /^["«“'](.+)["»”']$/s.exec(text)
  if (quoted) text = quoted[1].trim()
  if (text.length <= SERVICE_DESCRIPTION_MAX) return text

  // The ellipsis counts too: what comes back is never longer than the limit.
  const cut = text.slice(0, SERVICE_DESCRIPTION_MAX)
  const lastSentence = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"))
  if (lastSentence > SERVICE_DESCRIPTION_MAX / 2) return cut.slice(0, lastSentence + 1).trim()
  const lastSpace = cut.slice(0, SERVICE_DESCRIPTION_MAX - 1).lastIndexOf(" ")
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : SERVICE_DESCRIPTION_MAX - 1).trim()}…`
}
