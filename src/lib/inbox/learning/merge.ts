/**
 * How a conversation's facts join what a channel already knows. Pure: the runner applies the plan.
 *
 * - A fact nobody knew becomes a row. One that names a price, a discount, «бесплатно» or a promo code
 *   — by the same detector the price rule uses (lib/ai/offer-grounding) — waits for «Подтвердить»
 *   whatever its type: a price inside a service's description would otherwise become a fact unseen.
 * - A fact said again is counted, not duplicated.
 * - A different price for the same thing is a conflict for a person to settle; until then the AI names
 *   neither (owner 2026-11-15, «только после «Подтвердить»»). That holds for a price a person already
 *   confirmed too: prices change, and the AI must not keep the old one on its own word.
 * - Other knowledge follows what people say now — unless a person edited the row, which learning
 *   never overwrites. A row a person removed stays removed.
 */
import { isUngroundedOffer, offerFactsFrom } from "@/lib/ai/offer-grounding"
import { MONEY_TYPES, foldTitle, sameAnswer } from "@/lib/inbox/learning/model"
import type { ExtractedFact } from "@/lib/inbox/learning/judge"

const NO_FACTS = offerFactsFrom("")

/** Whether a text names money or an offer — the things the AI may state only once confirmed. */
export function namesMoney(text: string): boolean {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .some((sentence) => sentence.trim() && isUngroundedOffer(sentence, NO_FACTS))
}

export function needsConfirmation(type: string, body: string): boolean {
  return MONEY_TYPES.has(type) || namesMoney(body)
}

export type Alternative = { body: string; seen: number; lastSeenAt: string }

export type ExistingItem = {
  id: string
  type: string
  title: string
  body: string
  status: string
  alternatives: unknown
  removedAt: Date | null
  editedAt: Date | null
  seenCount: number
}

export type MergeOp =
  | { op: "create"; type: string; title: string; body: string; status: "active" | "pending"; messageIndex: number | null }
  | { op: "seen"; id: string }
  | { op: "update"; id: string; body: string; status: "active" | "pending" }
  | { op: "conflict"; id: string; alternatives: Alternative[] }

export function readAlternatives(value: unknown): Alternative[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((a) => {
    if (!a || typeof a !== "object") return []
    const r = a as Record<string, unknown>
    if (typeof r.body !== "string" || !r.body.trim()) return []
    return [{ body: r.body, seen: typeof r.seen === "number" ? r.seen : 1, lastSeenAt: typeof r.lastSeenAt === "string" ? r.lastSeenAt : "" }]
  })
}

export function planMerge(existing: readonly ExistingItem[], facts: readonly ExtractedFact[], now: Date): MergeOp[] {
  const byId = new Map(existing.map((e) => [e.id, e]))
  const byTitle = new Map<string, ExistingItem>()
  for (const e of existing) {
    const key = foldTitle(e.title)
    // A live row wins the title over a removed one.
    if (!byTitle.has(key) || (byTitle.get(key)!.removedAt && !e.removedAt)) byTitle.set(key, e)
  }
  const ops: MergeOp[] = []
  const touched = new Set<string>()
  const created = new Set<string>()
  const stamp = now.toISOString()

  for (const fact of facts) {
    const target = (fact.sameAs ? byId.get(fact.sameAs) : undefined) ?? byTitle.get(foldTitle(fact.title))
    if (!target) {
      const key = foldTitle(fact.title)
      if (created.has(key)) continue
      created.add(key)
      ops.push({
        op: "create", type: fact.type, title: fact.title, body: fact.body,
        status: needsConfirmation(fact.type, `${fact.title}\n${fact.body}`) ? "pending" : "active", messageIndex: fact.messageIndex,
      })
      continue
    }
    if (target.removedAt || touched.has(target.id)) continue
    touched.add(target.id)

    const money = MONEY_TYPES.has(target.type) || MONEY_TYPES.has(fact.type) || namesMoney(target.body) || namesMoney(fact.body)
    if (target.status === "conflict") {
      const alternatives = readAlternatives(target.alternatives)
      const same = alternatives.find((a) => sameAnswer(a.body, fact.body))
      if (same) { same.seen += 1; same.lastSeenAt = stamp } else alternatives.push({ body: fact.body, seen: 1, lastSeenAt: stamp })
      ops.push({ op: "conflict", id: target.id, alternatives })
      continue
    }
    if (sameAnswer(target.body, fact.body)) {
      ops.push({ op: "seen", id: target.id })
      continue
    }
    if (money) {
      ops.push({
        op: "conflict",
        id: target.id,
        alternatives: [
          { body: target.body, seen: target.seenCount, lastSeenAt: "" },
          { body: fact.body, seen: 1, lastSeenAt: stamp },
        ],
      })
      continue
    }
    if (target.editedAt) {
      ops.push({ op: "seen", id: target.id })
      continue
    }
    ops.push({ op: "update", id: target.id, body: fact.body, status: needsConfirmation(target.type, `${target.title}\n${fact.body}`) ? "pending" : "active" })
  }
  return ops
}
