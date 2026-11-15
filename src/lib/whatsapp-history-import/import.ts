/**
 * The one-shot import of a coexistence number's WhatsApp Business app: its contacts and the last six
 * months of its chats, written into the inbox as if they had always been there — and with nothing
 * set in motion by it.
 *
 * Why "nothing set in motion" is the whole design. A live message goes through the webhook, and the
 * webhook is where a customer's message becomes an AI reply, a ticket, a notification, a push, an
 * automation or a sequence exit. The import never goes through it: rows are written here directly,
 * and every reader that later looks at the table and might act sees them for what they are:
 *
 *   • `createdAt` is the message's own time on the phone, not the time we received the webhook — so
 *     every age window (the booking agent's deferred turn, the backlog sweep's lookback, Meta's
 *     24-hour window) sees six-month-old messages as six months old;
 *   • `historyImportedAt` marks the row, and the readers of Meta's customer-service window skip it:
 *     Meta opens that window only for messages sent to a number already on the Cloud API;
 *   • `metadata.historyImport` makes the AI coverage reader (`selectUncoveredAiInboundBatch`) count
 *     an imported customer message as answered, and keeps an imported reply out of AI training;
 *   • `deferredTurnAt` is stamped on arrival, so the deferred booking turn has nothing to claim even
 *     for a message written a minute before the number was connected;
 *   • a customer's message is stored `read`, and a new conversation starts with no unread messages.
 *
 * Idempotent by construction: a message is keyed by its wamid under the partial unique indexes the
 * live webhook already relies on (inbound; and `source = business_app` for what the team sent from
 * the app, the same key as a live echo), and a chunk is keyed by its fingerprint. A redelivered
 * webhook or a chunk processed twice adds nothing.
 *
 * Contacts are written the way the webhook writes them — a plain row, matched by phone first — and
 * NOT through the contact command, whose whole point is the automations, notifications, outgoing
 * webhooks and loyalty bonus that an import of an address book must not fire.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { sanitizeLog } from "@/lib/sanitize"
import { isDuplicateInsert } from "@/lib/social/meta-inbound-idempotency"
import { BUSINESS_APP_SOURCE } from "@/lib/inbox/whatsapp-app-echo"
import { fetchAndStoreWaMedia } from "@/lib/whatsapp-media"
import { resolveWhatsAppConfig } from "@/lib/whatsapp"
import { describeWaMessage, type WaMessageTextPayload } from "@/lib/whatsapp-message-text"
import {
  addressBookOf,
  chunksOf,
  digits,
  mediaOf,
  outboundStatus,
  str,
  threadsOf,
  type HistoryThread,
} from "./payload"

type Rec = Record<string, unknown>

export type HistoryChannel = { id: string; organizationId: string; settings?: unknown }

/** A chunk not done after this many tries is left `failed` and shown as such. */
const MAX_ATTEMPTS = 5
/** Long enough for a chunk of thousands of messages; a crashed run is taken over after it. */
const LEASE_MS = 5 * 60_000
const INSERT_BATCH = 400

const KIND_ORDER: Record<string, number> = { contacts: 0, history: 1, media: 2 }

function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {}
}

// ─── capture ────────────────────────────────────────────────────────────────

/**
 * Store what a `history` / `smb_app_state_sync` webhook carries, untouched, and nothing else.
 * Runs inside `runWithTenant` of the workspace the number belongs to. Returns how many chunks are
 * new — zero for a redelivery.
 */
export async function captureHistoryWebhook(params: {
  channel: HistoryChannel
  field: "history" | "smb_app_state_sync"
  value: Rec
  phoneNumberId: string
}): Promise<{ stored: number; duplicates: number; declined: boolean }> {
  const { channel, field, value, phoneNumberId } = params
  const chunks = chunksOf(field, value, phoneNumberId)
  let stored = 0
  let duplicates = 0
  let declined = false
  for (const chunk of chunks) {
    if (chunk.errorCode !== null) declined = true
    try {
      await prisma.whatsAppHistoryChunk.create({
        data: {
          organizationId: channel.organizationId,
          channelConfigId: channel.id,
          kind: chunk.kind,
          fingerprint: chunk.fingerprint,
          phase: chunk.phase,
          chunkOrder: chunk.chunkOrder,
          progress: chunk.progress,
          errorCode: chunk.errorCode,
          items: chunk.items,
          payload: chunk.payload === null ? Prisma.DbNull : (chunk.payload as Prisma.InputJsonValue),
          // A refusal has nothing to import: it is the answer, recorded as it came.
          status: chunk.payload === null ? "done" : "pending",
          processedAt: chunk.payload === null ? new Date() : null,
        },
      })
      stored += 1
    } catch (error) {
      if (!isDuplicateInsert(error)) throw error
      duplicates += 1
    }
  }
  console.log(
    `[WA History] captured org=${sanitizeLog(channel.organizationId)} channel=${sanitizeLog(channel.id)} field=${field}`
    + ` chunks=${chunks.length} stored=${stored} duplicates=${duplicates}`
    + chunks.map((c) => ` [${c.kind} phase=${c.phase ?? "-"} order=${c.chunkOrder ?? "-"} progress=${c.progress ?? "-"} items=${c.items}${c.errorCode !== null ? ` error=${c.errorCode}` : ""}]`).join(""),
  )
  return { stored, duplicates, declined }
}

// ─── processing ─────────────────────────────────────────────────────────────

type ClaimedChunk = {
  id: string
  kind: string
  payload: Prisma.JsonValue | null
  attempts: number
}

async function claimNext(channel: HistoryChannel, now: Date): Promise<ClaimedChunk | null> {
  const candidates = await prisma.whatsAppHistoryChunk.findMany({
    where: {
      organizationId: channel.organizationId,
      channelConfigId: channel.id,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ status: "pending" }, { status: "processing", leaseUntil: { lt: now } }],
    },
    select: { id: true, kind: true, phase: true, chunkOrder: true, status: true, leaseUntil: true, receivedAt: true },
    take: 500,
  })
  // Contacts first, so the conversations the history creates already know whose they are; the
  // media follow-ups last, after the placeholders they fill in.
  candidates.sort((a, b) =>
    (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
    || (a.phase ?? 0) - (b.phase ?? 0)
    || (a.chunkOrder ?? 0) - (b.chunkOrder ?? 0)
    || a.receivedAt.getTime() - b.receivedAt.getTime())
  for (const candidate of candidates) {
    const taken = await prisma.whatsAppHistoryChunk.updateMany({
      where: {
        id: candidate.id,
        organizationId: channel.organizationId,
        status: candidate.status,
        ...(candidate.status === "processing" ? { leaseUntil: candidate.leaseUntil } : {}),
      },
      data: { status: "processing", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    })
    if (taken.count !== 1) continue
    const row = await prisma.whatsAppHistoryChunk.findFirst({
      where: { id: candidate.id, organizationId: channel.organizationId },
      select: { id: true, kind: true, payload: true, attempts: true },
    })
    if (row) return row
  }
  return null
}

export type ProcessOutcome = { processed: number; failed: number; remaining: boolean }

/**
 * Work through the channel's captured chunks, oldest phase first, for at most `budgetMs`.
 * Safe to run from several places at once: each chunk is taken with one conditional UPDATE.
 */
export async function processHistoryChunks(channel: HistoryChannel, opts: { budgetMs?: number; now?: () => Date } = {}): Promise<ProcessOutcome> {
  const clock = opts.now ?? (() => new Date())
  const started = Date.now()
  const budget = opts.budgetMs ?? 50_000
  let processed = 0
  let failed = 0
  while (Date.now() - started < budget) {
    const chunk = await claimNext(channel, clock())
    if (!chunk) return { processed, failed, remaining: false }
    try {
      const payload = rec(chunk.payload)
      const result = chunk.kind === "contacts"
        ? await importAddressBook(channel, payload, clock())
        : chunk.kind === "media"
          ? await importMedia(channel, payload)
          : await importHistory(channel, payload, clock())
      await prisma.whatsAppHistoryChunk.updateMany({
        where: { id: chunk.id, organizationId: channel.organizationId },
        // The copy of the chats is not kept once they are in the inbox: the row stays as the record.
        data: { status: "done", payload: Prisma.DbNull, result: result as Prisma.InputJsonValue, processedAt: new Date(), leaseUntil: null, lastError: null },
      })
      processed += 1
    } catch (error) {
      failed += 1
      const message = String((error as Error)?.message || error).slice(0, 500)
      console.error(`[WA History] chunk ${sanitizeLog(chunk.id)} (${chunk.kind}) failed, attempt ${chunk.attempts}: ${sanitizeLog(message)}`)
      await prisma.whatsAppHistoryChunk.updateMany({
        where: { id: chunk.id, organizationId: channel.organizationId },
        data: { status: chunk.attempts >= MAX_ATTEMPTS ? "failed" : "pending", leaseUntil: null, lastError: message },
      }).catch(() => null)
    }
  }
  const left = await prisma.whatsAppHistoryChunk.count({
    where: { organizationId: channel.organizationId, channelConfigId: channel.id, status: { in: ["pending", "processing"] }, attempts: { lt: MAX_ATTEMPTS } },
  })
  return { processed, failed, remaining: left > 0 }
}

/**
 * Import every channel with work waiting, across workspaces — the backstop for a chunk whose
 * after-response run was cut short (a deploy, a crash). Resolution is the cross-tenant phase; each
 * channel is then processed under its own tenant.
 */
export async function processAllPendingHistory(opts: { budgetMs?: number } = {}): Promise<{ channels: number; processed: number; failed: number }> {
  const { runWithRlsBypass } = await import("@/lib/rls-context")
  const waiting = await runWithRlsBypass(() =>
    prisma.whatsAppHistoryChunk.findMany({
      where: { attempts: { lt: MAX_ATTEMPTS }, OR: [{ status: "pending" }, { status: "processing", leaseUntil: { lt: new Date() } }] },
      select: { organizationId: true, channelConfigId: true },
      distinct: ["channelConfigId"],
      take: 50,
    }),
  )
  const started = Date.now()
  const budget = opts.budgetMs ?? 100_000
  let processed = 0
  let failed = 0
  for (const row of waiting) {
    const left = budget - (Date.now() - started)
    if (left <= 0) break
    const outcome = await runWithTenant(row.organizationId, () =>
      processHistoryChunks({ id: row.channelConfigId, organizationId: row.organizationId }, { budgetMs: left }))
    processed += outcome.processed
    failed += outcome.failed
  }
  return { channels: waiting.length, processed, failed }
}

// ─── contacts ───────────────────────────────────────────────────────────────

const PLACEHOLDER_NAME = /^(?:WhatsApp\s*)?\+?\d[\d\s]*$/

/** A contact already known by this phone, matched the way the live webhook matches a sender. */
async function findContactByPhone(organizationId: string, phone: string): Promise<{ id: string; fullName: string } | null> {
  const variants = [phone, `+${phone}`]
  const tail = phone.slice(-9)
  return prisma.contact.findFirst({
    where: {
      organizationId,
      OR: [{ phone: { in: variants } }, ...(tail.length >= 7 ? [{ phone: { contains: tail } }] : [])],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true },
  })
}

/** Point the conversation with this phone, and its rows, at the contact — where nothing else does. */
async function linkThreadToContact(organizationId: string, phone: string, contactId: string, fullName: string | null): Promise<void> {
  const keys = [phone, `+${phone}`]
  const conversations = await prisma.socialConversation.findMany({
    where: { organizationId, platform: "whatsapp", externalId: { in: keys } },
    select: { id: true, contactId: true, contactName: true },
  })
  for (const convo of conversations) {
    const betterName = fullName && (!convo.contactName || PLACEHOLDER_NAME.test(convo.contactName)) ? fullName : null
    if (!convo.contactId || betterName) {
      await prisma.socialConversation.update({
        where: { id: convo.id },
        data: { ...(convo.contactId ? {} : { contactId }), ...(betterName ? { contactName: betterName } : {}) },
      })
    }
    await prisma.channelMessage.updateMany({
      where: { organizationId, conversationId: convo.id, contactId: null },
      data: { contactId },
    })
  }
}

async function contactsRoom(organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { maxContacts: true, _count: { select: { contacts: true } } },
  })
  if (!org) return 0
  if (org.maxContacts === -1) return Number.POSITIVE_INFINITY
  return Math.max(0, org.maxContacts - org._count.contacts)
}

async function importAddressBook(channel: HistoryChannel, payload: Rec, now: Date) {
  const organizationId = channel.organizationId
  const entries = addressBookOf(payload, now)
  const out = {
    contacts: entries.length, created: 0, matched: 0, renamed: 0, removedInApp: 0, withoutPhone: 0, overPlanLimit: 0,
    // Who arrived, for the import screen's «new contacts» — the first ones only, it is a glimpse.
    createdContactIds: [] as string[],
  }
  // The plan's contact limit holds for an import too — the rest are still matched, never created.
  let room = await contactsRoom(organizationId)
  for (const entry of entries) {
    if (entry.action === "remove") {
      // Deleting a person from the CRM because they left a phone's address book would lose deals,
      // tickets and notes that are not the phone's to remove. It is counted, and that is all.
      out.removedInApp += 1
      continue
    }
    if (!entry.phone) {
      out.withoutPhone += 1
      continue
    }
    const existing = await findContactByPhone(organizationId, entry.phone)
    let contactId: string
    if (existing) {
      out.matched += 1
      contactId = existing.id
      // A contact the webhook created from a bare number gets the name the business gave it.
      if (entry.fullName && PLACEHOLDER_NAME.test(existing.fullName.trim())) {
        await prisma.contact.update({ where: { id: existing.id }, data: { fullName: entry.fullName } })
        out.renamed += 1
      }
    } else {
      if (room <= 0) {
        out.overPlanLimit += 1
        continue
      }
      const created = await prisma.contact.create({
        data: {
          organizationId,
          fullName: entry.fullName || `WhatsApp +${entry.phone}`,
          phone: `+${entry.phone}`,
          source: "whatsapp",
          ...(entry.at && entry.at.getTime() < now.getTime() ? { createdAt: entry.at } : {}),
        },
        select: { id: true },
      })
      room -= 1
      out.created += 1
      if (out.createdContactIds.length < 40) out.createdContactIds.push(created.id)
      contactId = created.id
    }
    await linkThreadToContact(organizationId, entry.phone, contactId, entry.fullName)
  }
  return out
}

// ─── history ────────────────────────────────────────────────────────────────

async function businessPhoneOf(channel: HistoryChannel, payload: Rec): Promise<string | null> {
  const fromPayload = str(payload.businessPhone)
  if (fromPayload) return fromPayload
  const settings = channel.settings !== undefined
    ? channel.settings
    : (await prisma.channelConfig.findFirst({ where: { id: channel.id, organizationId: channel.organizationId }, select: { settings: true } }))?.settings
  return digits(rec(settings).displayPhoneNumber)
}

/** The conversation for this thread — an existing one whatever spelling it was keyed under. */
async function ensureThreadConversation(
  channel: HistoryChannel,
  thread: HistoryThread,
  contact: { id: string; fullName: string } | null,
): Promise<{ id: string; created: boolean } | null> {
  const organizationId = channel.organizationId
  const keys = thread.phone ? Array.from(new Set([thread.phone, `+${thread.phone}`])) : [thread.threadKey]
  const last = thread.messages.reduce((a, b) => (b.at > a.at ? b : a))
  const candidates = await prisma.socialConversation.findMany({
    where: { organizationId, platform: "whatsapp", externalId: { in: keys } },
    select: { id: true, externalId: true, contactId: true },
  })
  const existing = candidates.find((row) => row.externalId === thread.threadKey) ?? candidates[0] ?? null
  if (existing) {
    // Only the list line moves, and only forward: a live message is newer than any history.
    await prisma.socialConversation.updateMany({
      where: { id: existing.id, organizationId, lastMessageAt: { lt: last.at } },
      data: { lastMessage: last.text.slice(0, 500), lastMessageAt: last.at },
    })
    if (!existing.contactId && contact) {
      await prisma.socialConversation.updateMany({ where: { id: existing.id, organizationId, contactId: null }, data: { contactId: contact.id } })
    }
    return { id: existing.id, created: false }
  }
  const contactName = contact?.fullName || thread.username || (thread.phone ? `+${thread.phone}` : thread.threadKey)
  try {
    const created = await prisma.socialConversation.create({
      data: {
        organizationId,
        platform: "whatsapp",
        externalId: thread.threadKey,
        channelConfigId: channel.id,
        contactName,
        ...(contact ? { contactId: contact.id } : {}),
        lastMessage: last.text.slice(0, 500),
        lastMessageAt: last.at,
        // History is read: the team saw these chats on the phone, and nobody owes them an answer
        // because they arrived in the CRM today.
        unreadCount: 0,
        metadata: { historyImport: true },
      },
      select: { id: true },
    })
    return { id: created.id, created: true }
  } catch (error) {
    if (!isDuplicateInsert(error)) throw error
    const raced = await prisma.socialConversation.findFirst({
      where: { organizationId, platform: "whatsapp", externalId: thread.threadKey },
      select: { id: true },
    })
    return raced ? { id: raced.id, created: false } : null
  }
}

async function importHistory(channel: HistoryChannel, payload: Rec, now: Date) {
  const organizationId = channel.organizationId
  const item = rec(payload.item)
  const businessPhone = await businessPhoneOf(channel, payload)
  const phoneNumberId = str(payload.phoneNumberId) ?? businessPhone ?? "whatsapp"
  const threads = threadsOf(item, businessPhone, now)
  const out = { threads: threads.length, conversationsCreated: 0, messages: 0, imported: 0, duplicates: 0, skipped: 0, contactsLinked: 0 }

  for (const thread of threads) {
    out.skipped += thread.skipped
    if (thread.messages.length === 0) continue
    out.messages += thread.messages.length
    const contact = thread.phone ? await findContactByPhone(organizationId, thread.phone) : null
    if (contact) out.contactsLinked += 1
    const conversation = await ensureThreadConversation(channel, thread, contact)
    if (!conversation) {
      out.skipped += thread.messages.length
      continue
    }
    if (conversation.created) out.conversationsCreated += 1
    const senderName = contact?.fullName || thread.username || thread.phone || thread.threadKey

    const rows: Prisma.ChannelMessageCreateManyInput[] = thread.messages.map((m) => {
      const common = {
        organizationId,
        channelConfigId: channel.id,
        channelType: "whatsapp",
        contactId: contact?.id ?? null,
        conversationId: conversation.id,
        body: m.text,
        externalId: m.wamid,
        messageType: m.messageType,
        createdAt: m.at,
        historyImportedAt: now,
      }
      const metadata = {
        waPhone: thread.phone ?? undefined,
        waUserId: thread.userId ?? undefined,
        waMessageId: m.wamid,
        waMessageType: m.messageType,
        timestamp: Math.floor(m.at.getTime() / 1000),
        historyImport: true,
        historyStatus: m.historyStatus ?? undefined,
      }
      return m.direction === "inbound"
        ? {
          ...common,
          direction: "inbound",
          from: senderName,
          to: "system",
          status: "read",
          // Nothing is waiting for an automatic answer: the deferred booking turn claims only rows
          // where this is null.
          deferredTurnAt: now,
          metadata: { ...metadata, profileName: thread.username ?? undefined },
        }
        : {
          ...common,
          direction: "outbound",
          from: phoneNumberId,
          to: thread.threadKey,
          status: outboundStatus(m.historyStatus),
          // The same key as a live echo of a reply typed in the app: a message that came both ways
          // is stored once (partial unique index channel_messages_business_app_echo_uniq).
          metadata: { channel: "whatsapp", source: BUSINESS_APP_SOURCE, sentFromBusinessApp: true, ...metadata },
        }
    })
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH)
      const written = await prisma.channelMessage.createMany({ data: batch, skipDuplicates: true })
      out.imported += written.count
      out.duplicates += batch.length - written.count
    }
  }
  return out
}

// ─── media of the last two weeks ────────────────────────────────────────────

async function importMedia(channel: HistoryChannel, payload: Rec) {
  const organizationId = channel.organizationId
  const media = mediaOf(payload)
  const out = { media: media.length, stored: 0, notFound: 0, failed: 0 }
  if (media.length === 0) return out
  const token = (await resolveWhatsAppConfig(organizationId, { channelConfigId: channel.id }))?.accessToken ?? null
  for (const item of media) {
    const row = await prisma.channelMessage.findFirst({
      where: { organizationId, channelType: "whatsapp", externalId: item.wamid, historyImportedAt: { not: null } },
      select: { id: true, mediaUrl: true },
    })
    if (!row) {
      out.notFound += 1
      continue
    }
    if (row.mediaUrl) continue
    const stored = item.mediaId && token ? await fetchAndStoreWaMedia(item.mediaId, token, organizationId) : null
    const described = describeWaMessage({ type: item.type, [item.type]: { caption: item.caption } } as WaMessageTextPayload)
    await prisma.channelMessage.updateMany({
      where: { id: row.id, organizationId },
      data: { messageType: item.type, body: described.text, ...(stored ? { mediaUrl: stored.url } : {}) },
    })
    if (stored) out.stored += 1
    else out.failed += 1
  }
  return out
}
