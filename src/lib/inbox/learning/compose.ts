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
  removedAt: Date | null
}

/** The share of the prompt the learned knowledge may take; the newest-seen rows come first. */
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
  if (usable.length === 0) return ""
  const lines: string[] = []
  let used = 0
  for (const row of usable) {
    const line = `- ${row.title.trim()}: ${row.body.trim().replace(/\s+/g, " ")}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
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
