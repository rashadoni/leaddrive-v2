/**
 * The inbox agent is configured the same way the voice agent is: rules in one
 * field, approved product facts in another.
 *
 * Keeping them apart is not cosmetic. Rules are how the assistant behaves and
 * change rarely; facts are what it may state and change whenever a price list
 * or a product does. Mixed into one box, an administrator editing a fact has to
 * hunt through behaviour instructions to find it, and every edit risks
 * disturbing the rules — which is exactly how an assistant quietly starts
 * behaving differently after a routine content change.
 *
 * The heading is the same one the voice agent uses, so the model meets a
 * familiar shape on both channels and an administrator auditing a reply can
 * tell which field supplied which sentence.
 */
export const INBOX_KNOWLEDGE_HEADING =
  "# Şirkət və məhsullar haqqında təsdiqlənmiş biliklər"

export function composeInboxAgentInstruction(params: {
  prompt?: unknown
  knowledge?: unknown
}): string {
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : ""
  const knowledge = typeof params.knowledge === "string" ? params.knowledge.trim() : ""

  if (!knowledge) return prompt
  if (!prompt) return `${INBOX_KNOWLEDGE_HEADING}\n${knowledge}`
  return `${prompt}\n\n${INBOX_KNOWLEDGE_HEADING}\n${knowledge}`
}

/**
 * The behaviour half of the instruction: either the organisation's own rules or
 * the built-in ones — never both, since a persona written by an administrator
 * would fight a persona written here.
 *
 * What a custom prompt must NOT silently drop are the rules that are not about
 * personality at all. Escalation was already re-appended for that reason. The
 * language rule belongs in the same category and was not, which is how an
 * assistant configured entirely in Azerbaijani answered a customer in English.
 *
 * Both are appended only to a custom prompt: the built-in one already carries
 * them, and repeating an instruction weakens the rest of the list.
 */
export function composeInboxAgentRules(params: {
  systemPrompt?: unknown
  builtIn: string
  escalationRule?: string
  languageRule?: string
}): string {
  const custom = typeof params.systemPrompt === "string" ? params.systemPrompt.trim() : ""
  if (!custom) return params.builtIn
  return custom + (params.languageRule ?? "") + (params.escalationRule ?? "")
}

export type AgentReplyLanguage = "az" | "ru" | "en"

export const AGENT_REPLY_LANGUAGES: AgentReplyLanguage[] = ["az", "ru", "en"]

export function normalizeReplyLanguage(value: unknown): AgentReplyLanguage | null {
  return typeof value === "string" && (AGENT_REPLY_LANGUAGES as string[]).includes(value)
    ? (value as AgentReplyLanguage)
    : null
}

const LANGUAGE_NAMES: Record<AgentReplyLanguage, string> = {
  az: "АЗЕРБАЙДЖАНСКОМ (Azərbaycan dili)",
  ru: "РУССКОМ",
  en: "АНГЛИЙСКОМ (English)",
}

/**
 * The language directive appended to a custom agent prompt.
 *
 * Two different products, and conflating them is what produced an assistant
 * configured entirely in Azerbaijani answering a customer in English:
 *
 *  - null — follow the customer. Right for a tenant serving a mixed audience.
 *  - a fixed language — answer only in it, whatever the customer writes. Right
 *    for a brand that speaks one language, and the only way to be sure: the
 *    surrounding machinery this engine appends is written in Russian, so
 *    "mirror the customer" has a pull towards Russian and, when the customer
 *    writes nothing but a phone number, towards English.
 *
 * Written in Russian to match the rest of the appended scaffolding, and it says
 * so — otherwise the instruction's own language argues against its content.
 */
export function languageRuleFor(replyLanguage: unknown): string {
  const fixed = normalizeReplyLanguage(replyLanguage)
  if (fixed) {
    return `\n\nЯЗЫК ОТВЕТА — ЖЁСТКОЕ ПРАВИЛО: отвечай ТОЛЬКО на ${LANGUAGE_NAMES[fixed]}, независимо от того, на каком языке написал клиент. Если клиент пишет на другом языке — всё равно отвечай на ${LANGUAGE_NAMES[fixed]}. Эти служебные инструкции написаны по-русски, но это не язык ответа.`
  }
  return `\n\nЯЗЫК ОТВЕТА: по умолчанию отвечай на АЗЕРБАЙДЖАНСКОМ (Azərbaycan dili). Если клиент пишет на русском — отвечай на русском; на английском — на английском. НЕ путай азербайджанский с турецким/узбекским. Если в сообщении клиента нет слов (только цифры, номер телефона, эмодзи или ссылка), НЕ меняй язык — продолжай на том же языке, на котором шла переписка. Эти служебные инструкции написаны по-русски, но язык ответа определяется правилом выше, а не языком инструкций.`
}
