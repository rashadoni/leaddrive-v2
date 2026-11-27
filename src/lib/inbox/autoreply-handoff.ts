/**
 * «Автоответы» (owner's mock, 2026-11-27, «Да, делай»): after the bot has answered by a rule,
 * the rule may hand the conversation to people — «Потом: передать сотруднику».
 *
 *  - One person chosen — the conversation is theirs. Several — it goes to whichever of them holds
 *    the fewest open conversations right now (ties: the order they were chosen in).
 *  - Only a conversation nobody holds is taken: an operator who already answers keeps it.
 *  - The ids on the rule are bare strings, like `assignedTo`: each is checked against the
 *    organization when the rule fires — a deleted, deactivated or foreign user is skipped, and a
 *    rule with nobody left hands over to nobody.
 *  - The person hears it in the bell and by push, the same kind of notice the AI's «нужен человек»
 *    sends (lib/inbox/escalation), naming the rule.
 *
 * A handed-over conversation has `assignedTo` set, and that alone stops the AI auto-reply on it
 * (`assignedTo: null` is what lets the AI answer — see «Сотрудник уходит» in CLAUDE.md).
 */
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

export interface HandoffCandidate {
  id: string
  openConversations: number
}

/** The person a conversation goes to: fewest open conversations, ties in the order chosen. Pure. */
export function pickHandoffUser(orderedIds: readonly string[], candidates: readonly HandoffCandidate[]): string | null {
  let best: HandoffCandidate | null = null
  for (const id of orderedIds) {
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate) continue
    if (!best || candidate.openConversations < best.openConversations) best = candidate
  }
  return best?.id ?? null
}

export type HandoffResult =
  | { handedTo: string }
  | { handedTo: null; reason: "no-people" | "nobody-available" | "already-held" | "failed" }

export async function handOffAfterAutoReply(opts: {
  orgId: string
  conversationId: string
  ruleName: string
  channelType: string
  handoffUserIds: readonly string[] | null | undefined
}): Promise<HandoffResult> {
  const wanted = Array.from(new Set((opts.handoffUserIds ?? []).filter((id) => typeof id === "string" && id.length > 0)))
  if (wanted.length === 0) return { handedTo: null, reason: "no-people" }
  try {
    const people = await prisma.user.findMany({
      where: { id: { in: wanted }, organizationId: opts.orgId, isActive: true, anonymizedAt: null, role: { not: "reviewer" } },
      select: { id: true },
    })
    if (people.length === 0) return { handedTo: null, reason: "nobody-available" }
    const loads = people.length === 1 ? [] : await prisma.socialConversation.groupBy({
      by: ["assignedTo"],
      where: { organizationId: opts.orgId, assignedTo: { in: people.map((person: { id: string }) => person.id) }, status: "open", deletedAt: null },
      _count: { _all: true },
    })
    const candidates = people.map((person: { id: string }) => ({
      id: person.id,
      openConversations: (loads as Array<{ assignedTo: string | null; _count: { _all: number } }>)
        .find((row) => row.assignedTo === person.id)?._count._all ?? 0,
    }))
    const chosen = pickHandoffUser(wanted, candidates)
    if (!chosen) return { handedTo: null, reason: "nobody-available" }

    // Compare-and-set: someone who picked the conversation up meanwhile keeps it.
    const taken = await prisma.socialConversation.updateMany({
      where: { id: opts.conversationId, organizationId: opts.orgId, assignedTo: null },
      data: { assignedTo: chosen },
    })
    if (taken.count === 0) return { handedTo: null, reason: "already-held" }

    await createNotification({
      organizationId: opts.orgId,
      userId: chosen,
      type: "info",
      title: "Вам передана переписка",
      message: `Бот ответил клиенту по правилу «${opts.ruleName}» (${opts.channelType}) и передал переписку вам`,
      entityType: "inbox_message",
      entityId: opts.conversationId,
      kind: "inbox.message",
      push: true,
    }).catch((error: unknown) => console.error("[autoreply-handoff] notice failed:", error))
    return { handedTo: chosen }
  } catch (error) {
    console.error("[autoreply-handoff] failed:", error)
    return { handedTo: null, reason: "failed" }
  }
}
