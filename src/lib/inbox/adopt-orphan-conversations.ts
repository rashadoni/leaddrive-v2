/**
 * Gives a reconnected channel back the conversations it lost when its old row was deleted.
 *
 * Deleting a channel leaves its conversations in the CRM with `channelConfigId` empty, and connecting
 * the same account again makes a NEW row. A conversation then rejoins the channel only when that
 * customer writes again, so everything that reads «the channel's conversations» sees a part of them.
 * On 2026-11-23 @leaddrive.az (Fanumsec) was reconnected like that, the owner switched on AI training,
 * and 12 of its 17 Instagram conversations were not there.
 *
 * Which account a conversation belonged to is read from what the customer wrote to: an inbound row
 * keeps the account id in `to`. An organization can hold several accounts on one platform (Zeytun has
 * six), so a conversation without such a row stays unbound rather than being guessed onto one of them.
 * Only an empty binding is ever filled: a conversation on another channel is not moved.
 *
 * Must run inside the organization's tenant scope. Never throws: a connect or a training pass goes on
 * without it, and the next pass tries again.
 */
import { prisma } from "@/lib/prisma"

export async function adoptOrphanConversations(channel: {
  id: string
  organizationId: string
  channelType: string
  pageId?: string | null
}): Promise<number> {
  const { id, organizationId, channelType, pageId } = channel
  if (!pageId) return 0
  try {
    const rows: Array<{ conversationId: string | null }> = await prisma.channelMessage.findMany({
      where: {
        organizationId,
        channelType,
        direction: "inbound",
        to: pageId,
        conversationId: { not: null },
        conversation: { organizationId, platform: channelType, channelConfigId: null },
      },
      distinct: ["conversationId"],
      select: { conversationId: true },
    })
    const ids = rows.map((r) => r.conversationId).filter((x): x is string => !!x)
    if (ids.length === 0) return 0
    const done = await prisma.socialConversation.updateMany({
      where: { organizationId, id: { in: ids }, platform: channelType, channelConfigId: null },
      data: { channelConfigId: id },
    })
    return done.count
  } catch (error) {
    console.error("[adopt-conversations]", id, error instanceof Error ? error.message : "unknown")
    return 0
  }
}
