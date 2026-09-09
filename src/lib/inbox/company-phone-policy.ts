import { normalizeChatbotText } from "@/lib/chatbot-engine"
import {
  azerbaijaniLocalPart,
  extractPhoneNumber,
  isPlausibleLeadPhone,
} from "@/lib/inbox/customer-phone"

const APPROVED_PHONE_LINE = /^[ \t]*APPROVED_COMPANY_PHONE[ \t]*:[ \t]*(.*)$/gimu
const APPROVED_PHONE_CONTROL_LINE =
  /^[ \t]*APPROVED_COMPANY_PHONE[ \t]*:[^\r\n]*(?:\r?\n|$)/gimu
const APPROVED_ADDRESS_LINE = /^[ \t]*APPROVED_COMPANY_ADDRESS[ \t]*:[ \t]*(.*)$/gimu
const PHONE_CANDIDATE = /(?:\+?\d[\d\s().\/-]{5,}\d)/g

/**
 * The business phone is an approved fact, so it lives in the agent's second
 * prompt (knowledgeBase). Only the explicit marker is trusted; a phone found
 * incidentally in an article, chat history or model response is not.
 */
export function approvedCompanyPhoneFromKnowledge(knowledgeBase: unknown): string | null {
  if (typeof knowledgeBase !== "string") return null
  const markers = [...knowledgeBase.matchAll(APPROVED_PHONE_LINE)]
  // A duplicated or conflicting setting is configuration corruption. Never
  // guess which occurrence wins in a customer-facing reply.
  if (markers.length !== 1) return null
  const value = markers[0][1]?.trim()
  if (!value || value.length > 32 || !/^[+\d\s().-]+$/u.test(value)) return null
  const matches = value.match(PHONE_CANDIDATE) ?? []
  if (matches.length !== 1 || matches[0] !== value || !isPlausibleLeadPhone(value)) return null
  return value
}

export function hasApprovedCompanyPhoneMarker(knowledgeBase: unknown): boolean {
  return typeof knowledgeBase === "string"
    && [...knowledgeBase.matchAll(APPROVED_PHONE_LINE)].length > 0
}

/** Keep the control marker in the stored KB, but never expose it or its digits to the LLM. */
export function knowledgeWithoutApprovedCompanyPhone(knowledgeBase: unknown): string {
  if (typeof knowledgeBase !== "string") return ""
  return knowledgeBase
    .replace(APPROVED_PHONE_CONTROL_LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** The exact physical address is another tenant-approved fact in the second prompt. */
export function approvedCompanyAddressFromKnowledge(knowledgeBase: unknown): string | null {
  if (typeof knowledgeBase !== "string") return null
  const markers = [...knowledgeBase.matchAll(APPROVED_ADDRESS_LINE)]
  if (markers.length !== 1) return null
  const value = markers[0][1]?.trim()
  if (
    !value
    || value.length > 300
    || !/\p{L}/u.test(value)
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) return null
  return value
}

export function hasApprovedCompanyAddressMarker(knowledgeBase: unknown): boolean {
  return typeof knowledgeBase === "string"
    && [...knowledgeBase.matchAll(APPROVED_ADDRESS_LINE)].length > 0
}

/**
 * Tenant contacts stay in the stored Knowledge Base, but neither markers nor
 * values are left for the model to paraphrase. Runtime code inserts the exact
 * approved value only for a matching customer request.
 */
export function knowledgeWithoutApprovedCompanyContacts(knowledgeBase: unknown): string {
  if (typeof knowledgeBase !== "string") return ""
  return knowledgeBase
    .replace(APPROVED_PHONE_LINE, "")
    .replace(APPROVED_ADDRESS_LINE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * This is deliberately narrower than a generic mention of a number. "Write
 * your number" is customer intake; "give me your number / where can I call?"
 * asks for the company's contact.
 */
export function isCompanyPhoneRequest(
  text: string,
  opts: { customerPhoneWasRequested?: boolean } = {},
): boolean {
  const normalized = normalizeChatbotText(text)
  const explicit = [
    // Azerbaijani (including common ASCII/transliterated spellings).
    /(?:^| )(?:sizin|sirketin|magazanin|ofisin|gobustone(?: un)?|qobustone(?: un)?) (?:(?:elaqe|telefon) )?nomre\p{L}*(?= |$)/u,
    /(?:^| )(?:(?:elaqe|telefon) )?nomrenizi (?:ver|yaz|gonder|paylas)\p{L}*(?= |$)/u,
    /(?:^| )(?:hara|hansi nomreye) zeng ed\p{L}*(?= |$)/u,
    /(?:^| )size nece zeng ed\p{L}*(?= |$)/u,
    // Russian.
    /(?:^| )(?:ваш|вашу|вашего) (?:телефон|контактный номер|номер(?! (?:заказа|договора|счета|заявки|отправления|модели|карты|полиса|документа)))(?= |$)/u,
    /(?:^| )(?:телефон|номер|контактный номер) (?:компании|магазина|офиса|gobustone|qobustone)(?= |$)/u,
    /(?:^| )(?:дайте|напишите|пришлите|скиньте) (?:мне )?(?:ваш |свой )?(?:телефон|контакт|номер(?! (?:заказа|договора|счета|заявки|отправления|модели|карты|полиса|документа)))(?= |$)/u,
    /(?:^| )(?:куда|по какому номеру) (?:вам )?(?:можно )?позвон\p{L}*(?= |$)/u,
    /(?:^| )как (?:вам|в компанию|в магазин|в офис) позвон\p{L}*(?= |$)/u,
    // English.
    /(?:^| )your (?:phone |contact )?number(?= |$)/u,
    /(?:^| )(?:company|store|office|gobustone|qobustone) (?:phone|number|contact number)(?= |$)/u,
    /(?:^| )(?:give|send|share) (?:me )?(?:your )?(?:phone |contact )?number(?= |$)/u,
    /(?:^| )(?:what|which) number (?:can|should|do) i call(?= |$)/u,
    /(?:^| )how (?:can|do) i (?:call|reach) you(?= |$)/u,
  ].some((pattern) => pattern.test(normalized))
  if (explicit) return true

  const reciprocal = [
    /(?:menim )?(?:telefon |elaqe )?nomrem(?= |$).*(?:bes )?sizin(?:ki)?$/u,
    /(?:мой|мои) (?:номер телефона|контактный номер|телефон|номер)(?= |$).*(?:а )?ваш$/u,
    /my (?:phone |contact )?number(?= |$).*(?:and |what about )?yours$/u,
  ].some((pattern) => pattern.test(normalized))
  if (reciprocal) return true

  if (!opts.customerPhoneWasRequested) return false
  return [
    /^(?:bes |yaxsi bes )?sizin(?:ki)?$/u,
    /^(?:а |ну а )?ваш(?: номер)?$/u,
    /^(?:а )?у вас$/u,
    /^(?:and |what about )?yours$/u,
  ].some((pattern) => pattern.test(normalized))
}

export function isCompanyAddressRequest(text: string): boolean {
  const normalized = normalizeChatbotText(text)
  return [
    // Azerbaijani.
    /^(?:unvan|adres|haradasiniz)$/u,
    /(?:^| )(?:unvaniniz|unvaninizi|adresiniz|adresinizi) (?:nedir|haradadir|yazin|gonderin|verin)(?= |$)/u,
    /(?:^| )(?:unvani|adresi) (?:yazin|gonderin|verin|paylasin)(?= |$)/u,
    /(?:^| )(?:harada yerlesirsiniz|siz haradasiniz|magaza haradadir|ofis haradadir|gobustone haradadir|qobustone haradadir)(?= |$)/u,
    /(?:^| )(?:magaza|ofis|gobustone|qobustone) harada (?:yerlesir|yerlesib)(?= |$)/u,
    /(?:^| )(?:unvan|adres) (?:olar|mumkundur)(?= |$)/u,
    // Russian.
    /^(?:адрес|где вы)$/u,
    /(?:^| )где (?:(?:вы|компания|магазин|офис) )?(?:находитесь|расположен\p{L}*)(?= |$)/u,
    /(?:^| )где (?:находится|расположен\p{L}*) (?:компания|магазин|офис|gobustone|qobustone)(?= |$)/u,
    /(?:^| )(?:можно|подскажите) (?:ваш )?адрес(?= |$)/u,
    /(?:^| )(?:како[йи]|напишите|пришлите|дайте) (?:у вас )?(?:ваш )?адрес(?= |$)/u,
    /(?:^| )(?:ваш адрес|адрес (?:компании|магазина|офиса|gobustone|qobustone))(?= |$)/u,
    // English.
    /^(?:address|where are you)$/u,
    /(?:^| )where (?:are you|is (?:the )?(?:company|store|office|gobustone|qobustone)) located(?= |$)/u,
    /(?:^| )where is (?:the )?(?:company|store|office|gobustone|qobustone)(?= |$)/u,
    /(?:^| )can i (?:get|have) (?:your |the )?(?:company |store |office )?address(?= |$)/u,
    /(?:^| )(?:what is|send|share|give me) (?:your |the )?(?:company |store |office )?address(?= |$)/u,
    /(?:^| )your address(?= |$)/u,
  ].some((pattern) => pattern.test(normalized))
}

/**
 * Distinguish a customer's own number from a number they attribute to the
 * business. A mixed message such as "my number is X, and yours?" still yields
 * X; "is X your number?" never becomes a lead phone.
 */
export function extractCustomerPhoneNumber(text: string): string | null {
  // When a message contains two phones, select the one immediately owned by
  // the customer rather than the first number in the text:
  // "Is X yours? My number is Y" must persist Y, never X.
  const ownedPhonePatterns = [
    /(?:m[əe]nim\s+)?(?:(?:telefon|[əe]laq[əe])\s+)?n[öo]mr[əe]m(?:\s+(?:budur|odur))?\s*[:=—–-]?\s*(\+?\d[\d\s().-]{5,}\d)/iu,
    /(?:мой|мои)\s+(?:номер телефона|контактный номер|телефон|номер)(?:\s+(?:это|такой))?\s*[:=—–-]?\s*(\+?\d[\d\s().-]{5,}\d)/iu,
    /my\s+(?:phone\s+|contact\s+)?number(?:\s+is)?\s*[:=—–-]?\s*(\+?\d[\d\s().-]{5,}\d)/iu,
  ]
  for (const pattern of ownedPhonePatterns) {
    const owned = pattern.exec(text)?.[1]
    const phone = owned ? extractPhoneNumber(owned) : null
    if (phone) return phone
  }

  const phone = extractPhoneNumber(text)
  if (!phone) return null
  return isCompanyPhoneRequest(text) ? null : phone
}

export function shouldResolveAfterCustomerPhone(platform: string, text: string): boolean {
  return platform === "tiktok" && extractCustomerPhoneNumber(text) !== null
}

export function isCompanyPhoneInsistence(text: string): boolean {
  const normalized = normalizeChatbotText(text)
  return [
    /(?:^| )(?:israr edirem|yene de|mutleq|mehz sizin|nomrenizi isteyirem)(?= |$)/u,
    /(?:^| )(?:настаиваю|все равно|всё равно|все таки|всё таки|именно ваш|дайте уже|нужен ваш)(?= |$)/u,
    /(?:^| )(?:i insist|still|anyway|specifically your|need your number)(?= |$)/u,
  ].some((pattern) => pattern.test(normalized))
}

function isPhoneCandidate(candidate: string): boolean {
  if (!isPlausibleLeadPhone(candidate)) return false
  const digits = candidate.replace(/\D/g, "")
  // A bare ten-digit order/reference is not enough to call it a phone. Catch
  // valid Azerbaijani mobile spellings and visibly phone-formatted foreign
  // numbers; these are the shapes the model can otherwise hallucinate.
  return azerbaijaniLocalPart(digits) !== null
    || candidate.startsWith("+")
    || /[\s().\/-]/u.test(candidate.slice(1))
}

export function containsCompanyPhoneCandidate(text: string): boolean {
  return (text.match(PHONE_CANDIDATE) ?? []).some(isPhoneCandidate)
}

/** Remove only sentence(s) carrying a phone, preserving any useful answer. */
export function withoutCompanyPhoneSentences(text: string): string {
  const sentinel = "__REMOVED_COMPANY_PHONE__"
  const masked = text.replace(PHONE_CANDIDATE, (candidate) =>
    isPhoneCandidate(candidate) ? sentinel : candidate,
  )
  const sentences = masked.match(/[^.!?…\n]+[.!?…]*/gu) ?? [masked]
  const cleaned = sentences
    .filter((sentence) => !sentence.includes(sentinel))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  return containsCompanyPhoneCandidate(cleaned) ? "" : cleaned
}
