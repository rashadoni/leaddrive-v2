/**
 * What a channel learned, as the two blocks the reply prompt takes (lib/inbox/learning/prompt-blocks).
 *
 * Character joins the rules; knowledge joins the facts. Only CONFIRMED knowledge is a fact: a price or
 * a discount that waits for «Подтвердить» (status "pending"), or that people named differently
 * ("conflict"), is left out — so the price rule (lib/ai/offer-grounding) finds no fact behind it and
 * hands the question to a person instead of letting the AI promise it (owner 2026-11-15: «только
 * после «Подтвердить»»). A removed row is gone from both.
 */
import { MONEY_TYPES } from "@/lib/inbox/learning/model"

export type LearnedRow = {
  kind: string
  type: string
  title: string
  body: string
  status: string
  source: string
  removedAt: Date | null
}

/** A row a person added with «Добавить знание»: the company's own word, a price included. */
export const MANUAL_SOURCE = "manual"

/**
 * The share of the prompt the learned knowledge may take. What a person added comes first, then the
 * newest-seen learned rows: learned rows refresh their date on every conversation, so by date alone
 * a price the company typed in would be the first thing to fall out, and the price rule would stop
 * finding it among the facts.
 */
export const LEARNED_KNOWLEDGE_MAX_CHARS = 6000

const TRAIT_LABEL: Record<string, string> = {
  tone: "Тон",
  address: "Обращение к покупателю",
  length: "Длина ответа",
  language: "Язык",
  emoji: "Эмодзи",
  phrases: "Типичные фразы",
  avoid: "Чего не делать",
}

/** Whether a learned row may be stated to a customer. */
export function isUsableKnowledge(row: Pick<LearnedRow, "kind" | "type" | "status" | "removedAt">): boolean {
  if (row.kind !== "knowledge" || row.removedAt) return false
  if (row.status !== "active") return false
  return true
}

export function composeLearnedCharacter(rows: readonly LearnedRow[]): string {
  const traits = rows.filter((r) => r.kind === "trait" && !r.removedAt && r.body.trim())
  if (traits.length === 0) return ""
  const order = Object.keys(TRAIT_LABEL)
  const lines = traits
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    .map((r) => {
      const body = r.type === "phrases"
        ? r.body.split("\n").map((p) => p.trim()).filter(Boolean).map((p) => `«${p}»`).join(", ")
        : r.body.trim().replace(/\s+/g, " ")
      return `- ${TRAIT_LABEL[r.type] ?? r.title}: ${body}`
    })
  return `\n\nХАРАКТЕР ЭТОЙ СТРАНИЦЫ (так здесь отвечают сотрудники компании; пиши так же, но правила выше главнее):\n${lines.join("\n")}`
}

export function composeLearnedKnowledge(rows: readonly LearnedRow[], maxChars = LEARNED_KNOWLEDGE_MAX_CHARS): string {
  const usable = rows.filter(isUsableKnowledge)
  const ordered = [
    ...usable.filter((r) => r.source === MANUAL_SOURCE),
    ...usable.filter((r) => r.source !== MANUAL_SOURCE),
  ]
  const lines: string[] = []
  let used = 0
  for (const row of ordered) {
    const line = `- ${row.title.trim()}: ${row.body.trim().replace(/\s+/g, " ")}`
    // One long row does not cost the shorter ones after it their place.
    if (used + line.length + 1 > maxChars) continue
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ""
  return `Выучено из ответов сотрудников этой страницы и проверено компанией:\n${lines.join("\n")}`
}

/** Rows a person still has to decide on — shown on the screen, never stated by the AI. */
export function waitsForPerson(row: Pick<LearnedRow, "kind" | "type" | "status" | "removedAt">): boolean {
  return row.kind === "knowledge" && !row.removedAt && (row.status === "pending" || row.status === "conflict")
}

/** A learned money row starts out waiting; everything else is usable at once. */
export function initialStatus(type: string): "active" | "pending" {
  return MONEY_TYPES.has(type) ? "pending" : "active"
}
