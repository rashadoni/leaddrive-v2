import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * Replay / duplicate protection for inbound Meta webhook messages.
 *
 * Meta redelivers a webhook whenever the endpoint does not answer 2xx quickly, and the redelivery
 * carries the SAME provider message id (`mid` for Messenger/Instagram, `id` for WhatsApp Cloud API).
 * A redelivery must therefore be recognised and dropped, not ingested again.
 *
 * Two layers, because either alone is insufficient:
 *
 *  1. `alreadyIngested` — a read-then-skip check. Cheap, and it catches the ordinary SEQUENTIAL
 *     retry, which is the overwhelming majority.
 *  2. `isDuplicateInsert` — the TOCTOU backstop. Two CONCURRENT redeliveries can both pass step 1
 *     and both insert; the partial unique index
 *     `channel_messages_meta_inbound_external_uniq` (migration 20260920160000) turns the loser into
 *     a Prisma P2002, which callers treat as "already ingested".
 *
 * Why this matters more on WhatsApp than anywhere else: an inbound WhatsApp message can trigger the
 * auto-reply, so an un-deduplicated redelivery does not merely duplicate a row — it sends a second
 * real message to a real customer.
 */

export type MetaInboundChannel = "whatsapp" | "facebook" | "instagram"

/**
 * Has this provider message id already been ingested for this tenant?
 *
 * Scoped by organizationId: a provider message id is not unique across tenants, and two tenants may
 * legitimately hold the same id when both have connected the same asset.
 */
export async function alreadyIngested(
  organizationId: string,
  channelType: MetaInboundChannel,
  externalId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId || !externalId) return false
  const existing = await prisma.channelMessage.findFirst({
    where: { organizationId, channelType, direction: "inbound", externalId },
    select: { id: true },
  })
  return Boolean(existing)
}

/**
 * True when an insert failed because the row was already there — the concurrent-redelivery race.
 *
 * Deliberately narrow: only Prisma's unique-constraint code. Anything else is a real failure and
 * must keep propagating, because silently swallowing it would drop a genuine inbound message.
 */
export function isDuplicateInsert(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
