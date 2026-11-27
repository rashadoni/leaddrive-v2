/**
 * What the «Автоответы» rule routes accept beyond the original fields (owner's mock, 2026-11-27):
 * the people a conversation is handed to, and a reply text the bot can actually fill.
 */
import { prisma } from "@/lib/prisma"
import { unknownReplyTokens } from "@/lib/inbox/saved-reply-text"

/** More people than this on one rule is a list nobody reads; ten covers a sales team. */
export const MAX_HANDOFF_PEOPLE = 10

const AGENT_TOKEN = /\{\{\s*agent\.name\s*\}\}/i

/**
 * Why the bot could not send this text as written, or null. The bot fills {{contact.*}}; it has no
 * name of its own, so {{agent.name}} would leave «Меня зовут .» — refused, like a typo'd token.
 */
export function autoReplyTextProblem(text: string): string | null {
  if (AGENT_TOKEN.test(text)) return "responseText uses {{agent.name}}, which an automatic reply cannot fill"
  const unknown = unknownReplyTokens(text)
  if (unknown.length > 0) return `responseText has words the bot cannot fill: ${unknown.join(", ")}`
  return null
}

/**
 * `handoffUserIds` from a request body: a list of people of THIS organization who can work
 * (active, not anonymized, not a reviewer). The column is bare strings — without this a crafted
 * body could hand conversations to another tenant's user.
 */
export async function readHandoffUserIds(orgId: string, raw: unknown): Promise<{ ids: string[] } | { error: string }> {
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return { error: "handoffUserIds must be a list of user ids" }
  }
  const ids = Array.from(new Set(raw.map((id: string) => id.trim())))
  if (ids.length > MAX_HANDOFF_PEOPLE) return { error: `handoffUserIds: at most ${MAX_HANDOFF_PEOPLE} people` }
  if (ids.length === 0) return { ids }
  const found = await prisma.user.findMany({
    where: { id: { in: ids }, organizationId: orgId, isActive: true, anonymizedAt: null, role: { not: "reviewer" } },
    select: { id: true },
  })
  if (found.length !== ids.length) return { error: "Invalid handoffUserIds" }
  return { ids }
}
