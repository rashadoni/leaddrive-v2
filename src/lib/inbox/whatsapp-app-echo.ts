/**
 * What the team typed on the phone, mirrored into the CRM thread.
 *
 * A number onboarded in coexistence («WhatsApp Business app onboarding» in Meta's words) lives in
 * two places at once: the WhatsApp Business app on someone's phone and our Cloud API. Every reply
 * typed in that app arrives here as an `smb_message_echoes` webhook, and writing it down is not
 * cosmetic — it is what keeps us from answering a customer twice.
 *
 * The echo lands as an ORDINARY OUTBOUND row with status `sent`, and that is the whole trick:
 *   • `selectUncoveredAiInboundBatch` (lib/social/ai-autoreply) treats a delivered outbound row
 *     without `inReplyToInboundId(s)` as a broad acknowledgement of every earlier inbound message,
 *     so the autonomous backlog agent stands down by itself;
 *   • `runAutonomousInboxAgent` only picks conversations whose latest row is inbound;
 *   • the booking agent reads the same rows as its history, so it stops greeting a customer it has
 *     been talking to all morning and stops re-offering times a human already agreed.
 * Nothing in those three had to learn about coexistence; they only had to be told the truth about
 * who has already answered.
 *
 * Deliberately NOT inbound-shaped: an echo must not reopen a closed conversation, must not bump
 * `unreadCount` and must not touch the 24-hour window. Meta is explicit that a message sent from the
 * app «do[es] not create, extend, or affect Cloud API conversation windows», and our window readers
 * (`insideSessionWindow`, booking's `windowOpen`) look at inbound rows only — so they stay correct
 * precisely because this row is outbound.
 */
import { prisma } from "@/lib/prisma"
import { isDuplicateInsert } from "@/lib/social/meta-inbound-idempotency"
import { describeWaMessage, type WaMessageTextPayload } from "@/lib/whatsapp-message-text"
import { sanitizeLog } from "@/lib/sanitize"

/** The marker the migration's partial unique index and the inbox badge both read. */
export const BUSINESS_APP_SOURCE = "business_app"

type Rec = Record<string, unknown>

export type WaEchoContact = {
  profile?: { username?: unknown }
  wa_id?: unknown
  user_id?: unknown
}

export type WaMessageEcho = WaMessageTextPayload & {
  from?: unknown
  to?: unknown
  to_user_id?: unknown
  to_parent_user_id?: unknown
  id?: unknown
  timestamp?: unknown
  revoke?: { original_message_id?: unknown }
  edit?: { original_message_id?: unknown; message?: WaMessageTextPayload }
}

export type WaEchoValue = {
  metadata?: { display_phone_number?: unknown; phone_number_id?: unknown }
  contacts?: WaEchoContact[]
  message_echoes?: WaMessageEcho[]
}

export type AppEchoChannel = { id: string; organizationId: string }

export type AppEchoOutcome = {
  stored: number
  duplicates: number
  revoked: number
  edited: number
  skipped: number
  /** Meta sent us back a message we had sent through the Cloud API ourselves — see below. */
  ownSendsEchoed: number
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Bare digits, the shape every WhatsApp row in this database is keyed by. */
function digits(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const clean = String(value).replace(/\D/g, "")
  return clean || null
}

function unixDate(value: unknown): Date | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n * 1000)
}

function metadataRecord(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Rec) } : {}
}

/**
 * The customer this echo was sent to.
 *
 * Meta warns that `to` is omitted when the user has adopted a username and their phone number is
 * unavailable, so the business-scoped user id is the fallback thread key. It is a different key from
 * the phone, which is why it is kept separate: a thread opened under a BSUID must not silently
 * merge with a phone-keyed one.
 */
function echoRecipient(echo: WaMessageEcho): { threadKey: string; phone: string | null } | null {
  const phone = digits(echo.to)
  if (phone) return { threadKey: phone, phone }
  const userId = str(echo.to_user_id) ?? str(echo.to_parent_user_id)
  return userId ? { threadKey: userId, phone: null } : null
}

function contactNameFor(contacts: WaEchoContact[] | undefined, recipient: { threadKey: string; phone: string | null }): string {
  const match = contacts?.find((c) => {
    const byPhone = recipient.phone && digits(c.wa_id) === recipient.phone
    return byPhone || str(c.user_id) === recipient.threadKey
  })
  return str(match?.profile?.username) ?? recipient.threadKey
}

/** A contact already known by this phone number, so the mirrored row lands on their timeline. */
async function resolveContactId(organizationId: string, phone: string | null): Promise<string | null> {
  if (!phone) return null
  const variants = [phone, `+${phone}`]
  const tail = phone.slice(-9)
  const contact = await prisma.contact.findFirst({
    where: {
      organizationId,
      OR: [{ phone: { in: variants } }, ...(tail ? [{ phone: { contains: tail } }] : [])],
    },
    select: { id: true },
  }).catch(() => null)
  return contact?.id ?? null
}

/**
 * The thread this echo belongs to, without any of the inbound side effects.
 *
 * An existing row wins whatever spelling it was created under (`+994…` rows predate the digits
 * convention), because landing the echo in a second conversation would hide it from the very
 * coverage check that is the point of storing it.
 */
async function ensureEchoConversation(params: {
  organizationId: string
  channelConfigId: string
  recipient: { threadKey: string; phone: string | null }
  contactId: string | null
  contactName: string
  lastMessage: string
  at: Date
}): Promise<string | null> {
  const { organizationId, channelConfigId, recipient, contactId, contactName, lastMessage, at } = params
  const keys = recipient.phone
    ? Array.from(new Set([recipient.phone, `+${recipient.phone}`]))
    : [recipient.threadKey]
  const candidates = await prisma.socialConversation.findMany({
    where: { organizationId, platform: "whatsapp", externalId: { in: keys } },
    select: { id: true, externalId: true },
  }).catch(() => [] as Array<{ id: string; externalId: string }>)
  // The digits spelling is today's convention, so it wins when a workspace holds both.
  const existing = candidates.find((row) => row.externalId === recipient.threadKey) ?? candidates[0] ?? null

  if (existing) {
    // Only the "last message" line of the inbox list. Status, assignment, snooze and unread count
    // belong to the customer's side of the conversation and are left exactly as they are.
    await prisma.socialConversation.update({
      where: { id: existing.id },
      data: { lastMessage, lastMessageAt: at, ...(contactId ? { contactId } : {}) },
    }).catch(() => null)
    return existing.id
  }

  // The team wrote first, from the phone, to somebody who has never written to us. That thread has
  // to exist for the reply to be visible at all — created read and unassigned, never "open with one
  // unread customer message".
  try {
    const created = await prisma.socialConversation.create({
      data: {
        organizationId,
        platform: "whatsapp",
        externalId: recipient.threadKey,
        contactName,
        lastMessage,
        lastMessageAt: at,
        channelConfigId,
        ...(contactId ? { contactId } : {}),
      },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    if (!isDuplicateInsert(error)) throw error
    const raced = await prisma.socialConversation.findFirst({
      where: { organizationId, platform: "whatsapp", externalId: recipient.threadKey },
      select: { id: true },
    }).catch(() => null)
    return raced?.id ?? null
  }
}

/** The row this echo is talking about — ours or an earlier echo, both are outbound. */
async function findEchoedRow(organizationId: string, originalMessageId: string | null) {
  if (!originalMessageId) return null
  return prisma.channelMessage.findFirst({
    where: {
      organizationId,
      channelType: "whatsapp",
      direction: "outbound",
      externalId: originalMessageId,
    },
    select: { id: true, body: true, metadata: true },
  }).catch(() => null)
}

/**
 * Store one `smb_message_echoes` payload.
 *
 * Runs inside `runWithTenant` — the caller has already resolved which workspace owns this number.
 */
export async function ingestWhatsAppAppEcho(params: {
  channel: AppEchoChannel
  value: WaEchoValue
}): Promise<AppEchoOutcome> {
  const { channel, value } = params
  const organizationId = channel.organizationId
  const out: AppEchoOutcome = { stored: 0, duplicates: 0, revoked: 0, edited: 0, skipped: 0, ownSendsEchoed: 0 }
  const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : []
  const businessNumber = str(value.metadata?.phone_number_id) ?? str(value.metadata?.display_phone_number) ?? "whatsapp"
  const displayPhoneNumber = str(value.metadata?.display_phone_number)

  for (const echo of echoes) {
    const messageId = str(echo.id)
    const recipient = echoRecipient(echo)
    if (!messageId || !recipient) {
      out.skipped += 1
      continue
    }
    const at = unixDate(echo.timestamp) ?? new Date()

    // ─── the team deleted their own message on the phone ───
    if (echo.type === "revoke") {
      const target = await findEchoedRow(organizationId, str(echo.revoke?.original_message_id))
      if (!target) {
        out.skipped += 1
        continue
      }
      // The row stays, and so does its status: coverage of the customer's earlier messages is NOT
      // given back. A deletion is the team editing what the customer sees, not a request for the
      // robot to take the turn over — and an auto-reply fired by a deletion is unrecoverable.
      await prisma.channelMessage.update({
        where: { id: target.id },
        data: { metadata: { ...metadataRecord(target.metadata), revokedAt: at.toISOString(), revokedFromBusinessApp: true } },
      }).catch(() => null)
      out.revoked += 1
      continue
    }

    // ─── the team edited their own message on the phone ───
    if (echo.type === "edit") {
      const target = await findEchoedRow(organizationId, str(echo.edit?.original_message_id))
      const edited = echo.edit?.message ? describeWaMessage(echo.edit.message) : null
      if (!target || !edited) {
        out.skipped += 1
        continue
      }
      await prisma.channelMessage.update({
        where: { id: target.id },
        data: {
          body: edited.text,
          metadata: {
            ...metadataRecord(target.metadata),
            editedAt: at.toISOString(),
            editedFromBusinessApp: true,
            bodyBeforeEdit: target.body,
          },
        },
      }).catch(() => null)
      out.edited += 1
      continue
    }

    // ─── an ordinary reply typed on the phone ───
    // Read-then-skip for the sequential redelivery; the partial unique index behind it turns a
    // concurrent one into P2002 (same two layers as inbound, see meta-inbound-idempotency).
    const already = await prisma.channelMessage.findFirst({
      where: { organizationId, channelType: "whatsapp", direction: "outbound", externalId: messageId },
      select: { id: true, metadata: true },
    }).catch(() => null)
    if (already) {
      // Two different reasons to find a row with this id, and they are worth telling apart.
      //
      // An echo row means Meta redelivered a webhook — ordinary, nothing to see. A row that is NOT
      // an echo means Meta echoed back a message WE sent through the Cloud API: its id is the wamid
      // our own send stored. Meta's documentation only ever describes echoes of the app and its
      // companion devices and never says whether our own sends come back, so this log line is how
      // we find out from a real number instead of guessing.
      //
      // Either way no second row is written, which is what matters: our own reply must appear in the
      // thread once. The guard is this lookup, not the wording of the documentation.
      const wasOurOwnSend = metadataRecord(already.metadata).source !== BUSINESS_APP_SOURCE
      if (wasOurOwnSend) {
        out.ownSendsEchoed += 1
        console.log(
          `[WA Echo] Meta echoed back our own Cloud API send (wamid=${sanitizeLog(messageId)}, org=${sanitizeLog(organizationId)})`
          + " — kept the existing row, no duplicate. Undocumented behaviour; see lib/inbox/whatsapp-app-echo.",
        )
      } else {
        out.duplicates += 1
      }
      continue
    }

    const { text, messageType } = describeWaMessage(echo)
    const contactId = await resolveContactId(organizationId, recipient.phone)
    const conversationId = await ensureEchoConversation({
      organizationId,
      channelConfigId: channel.id,
      recipient,
      contactId,
      contactName: contactNameFor(value.contacts, recipient),
      lastMessage: text,
      at,
    })

    try {
      await prisma.channelMessage.create({
        data: {
          organizationId,
          channelConfigId: channel.id,
          direction: "outbound",
          channelType: "whatsapp",
          contactId: contactId ?? undefined,
          conversationId: conversationId ?? undefined,
          from: businessNumber,
          to: recipient.threadKey,
          body: text,
          // `sent` is load-bearing: the coverage reader counts only sent/delivered/read rows, and a
          // message the customer is already reading must count.
          status: "sent",
          externalId: messageId,
          messageType,
          createdAt: at,
          metadata: {
            channel: "whatsapp",
            source: BUSINESS_APP_SOURCE,
            sentFromBusinessApp: true,
            waPhone: recipient.phone ?? undefined,
            waUserId: str(echo.to_user_id) ?? undefined,
            waMessageId: messageId,
            waMessageType: messageType,
            displayPhoneNumber: displayPhoneNumber ?? undefined,
            timestamp: Number(echo.timestamp) || undefined,
          },
        },
      })
      out.stored += 1
    } catch (error) {
      if (isDuplicateInsert(error)) {
        out.duplicates += 1
        continue
      }
      throw error
    }
  }

  if (out.stored || out.revoked || out.edited || out.duplicates || out.skipped || out.ownSendsEchoed) {
    console.log(
      `[WA Echo] org=${sanitizeLog(organizationId)} stored=${out.stored} revoked=${out.revoked}`
      + ` edited=${out.edited} duplicates=${out.duplicates} ownSends=${out.ownSendsEchoed} skipped=${out.skipped}`,
    )
  }
  return out
}
