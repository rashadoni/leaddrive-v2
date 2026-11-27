/**
 * «Готовые ответы» (saved replies, stored as message snippets) — the text of a reply as the
 * settings screen shows it: words and the customer's data, not `{{contact.first_name}}`.
 *
 * Owner, 2026-11-27 («Да, делай» on the clickable mock): the screen was «сложноватый» — the same
 * variables in three places, a raw template next to every preview, «snippet», «token», «dəyişən».
 * Now a variable is a word in the text («Имя клиента»), and the stored body keeps the tokens the
 * inbox composer already fills (lib/inbox/snippet-vars). No server import: the page reads this.
 */
import { applySnippetVariables } from "@/lib/inbox/snippet-vars"

export type ReplyLocale = "en" | "ru" | "az"

/** The variables a reply may carry, in the order the editor offers them. Same set as SUPPORTED_SNIPPET_VARS. */
export const REPLY_VARIABLES = [
  { key: "contact.first_name", label: { az: "Müştərinin adı", ru: "Имя клиента", en: "Customer's first name" } },
  { key: "contact.name", label: { az: "Ad və soyad", ru: "Имя и фамилия", en: "Full name" } },
  { key: "contact.email", label: { az: "Müştərinin emaili", ru: "Email клиента", en: "Customer's email" } },
  { key: "agent.name", label: { az: "Mənim adım", ru: "Моё имя", en: "My name" } },
] as const

export type ReplyVariableKey = (typeof REPLY_VARIABLES)[number]["key"]

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g
/** `{{contact.firstname}}` predates `first_name`; the composer still fills it, so it is known. */
const ALIASES: Record<string, ReplyVariableKey> = { "contact.firstname": "contact.first_name" }

function knownKey(raw: string): ReplyVariableKey | null {
  const key = raw.trim().toLowerCase()
  if (ALIASES[key]) return ALIASES[key]
  return REPLY_VARIABLES.some((variable) => variable.key === key) ? (key as ReplyVariableKey) : null
}

export function replyVariableLabel(key: ReplyVariableKey, locale: ReplyLocale): string {
  const variable = REPLY_VARIABLES.find((item) => item.key === key)
  return variable ? variable.label[locale] ?? variable.label.en : key
}

export type ReplyPiece = { kind: "text"; text: string } | { kind: "variable"; key: ReplyVariableKey }

/** A stored body as text and variables. An unknown `{{…}}` stays text: it is shown, so it can be removed. */
export function splitReplyText(body: string): ReplyPiece[] {
  const pieces: ReplyPiece[] = []
  let last = 0
  for (const match of body.matchAll(TOKEN_RE)) {
    const key = knownKey(match[1] ?? "")
    if (!key) continue
    const at = match.index ?? 0
    if (at > last) pieces.push({ kind: "text", text: body.slice(last, at) })
    pieces.push({ kind: "variable", key })
    last = at + match[0].length
  }
  if (last < body.length) pieces.push({ kind: "text", text: body.slice(last) })
  return pieces
}

export function variableToken(key: ReplyVariableKey): string {
  return `{{${key}}}`
}

/** `{{…}}` the inbox will not fill — a typo, or a variable that never existed. They block saving. */
export function unknownReplyTokens(body: string): string[] {
  const unknown = new Set<string>()
  for (const match of body.matchAll(TOKEN_RE)) {
    if (!knownKey(match[1] ?? "")) unknown.add(match[0])
  }
  return Array.from(unknown)
}

export interface ReplySample {
  firstName: string
  name: string
  email: string
  agent: string
}

export const REPLY_SAMPLES: Record<ReplyLocale, ReplySample> = {
  az: { firstName: "Aysel", name: "Aysel Məmmədova", email: "aysel@mail.az", agent: "Leyla" },
  ru: { firstName: "Анна", name: "Анна Каримова", email: "anna@mail.az", agent: "Лейла" },
  en: { firstName: "Anna", name: "Anna Karimova", email: "anna@mail.az", agent: "Leila" },
}

/** What the customer reads — the same substitution the inbox composer makes when a reply is picked. */
export function previewReply(body: string, sample: ReplySample): string {
  return applySnippetVariables(body, {
    contact: { name: sample.name, firstName: sample.firstName, email: sample.email },
    agent: { name: sample.agent },
  })
}

/** SMS counts what leaves, not the tokens: 160 characters per message, more means several. */
export function smsParts(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 160)
}

/** A shortcut is one word: the inbox picker matches what follows «/» up to the first space. */
export function cleanShortcut(raw: string): string {
  return raw.replace(/[\s/]+/g, "").toLowerCase()
}

/** Ready replies a new workspace adds with one press. Shortcuts are words the team types in its language. */
export const REPLY_STARTERS: Array<{ key: string; shortcut: Record<ReplyLocale, string>; title: Record<ReplyLocale, string>; body: Record<ReplyLocale, string> }> = [
  {
    key: "hello",
    shortcut: { az: "salam", ru: "privet", en: "hello" },
    title: { az: "Salamlaşma", ru: "Приветствие", en: "Greeting" },
    body: {
      az: "Salam, {{contact.first_name}}! Mən {{agent.name}}. Sizə necə kömək edə bilərəm?",
      ru: "Здравствуйте, {{contact.first_name}}! Меня зовут {{agent.name}}. Чем могу помочь?",
      en: "Hi {{contact.first_name}}, this is {{agent.name}}. How can I help you?",
    },
  },
  {
    key: "price",
    shortcut: { az: "qiymet", ru: "cena", en: "price" },
    title: { az: "Qiymət sorğusu", ru: "Запрос цены", en: "Price request" },
    body: {
      az: "{{contact.first_name}}, zəhmət olmasa hansı məhsulla maraqlandığınızı yazın — aktual qiyməti dərhal göndərim.",
      ru: "{{contact.first_name}}, уточните, пожалуйста, какой товар вас интересует — сразу пришлю актуальную цену.",
      en: "{{contact.first_name}}, which product are you interested in? I will send the current price right away.",
    },
  },
  {
    key: "callback",
    shortcut: { az: "zeng", ru: "zvonok", en: "call" },
    title: { az: "Geri zəng", ru: "Перезвонить", en: "Call back" },
    body: {
      az: "{{contact.first_name}}, sizə zəng edə bilərik? Rahat vaxtı yazın — {{agent.name}} zəng edəcək.",
      ru: "{{contact.first_name}}, можем созвониться? Напишите удобное время — {{agent.name}} перезвонит.",
      en: "{{contact.first_name}}, can we call you? Send a convenient time and {{agent.name}} will call.",
    },
  },
  {
    key: "thanks",
    shortcut: { az: "tesekkur", ru: "spasibo", en: "thanks" },
    title: { az: "Sifariş üçün təşəkkür", ru: "Спасибо за заказ", en: "Thanks for the order" },
    body: {
      az: "Sifarişiniz üçün təşəkkür edirik, {{contact.first_name}}! Sifariş nömrəsini bura göndərəcəyik.",
      ru: "Спасибо за заказ, {{contact.first_name}}! Номер заказа пришлём сюда же.",
      en: "Thank you for your order, {{contact.first_name}}! We will send the order number here.",
    },
  },
]
