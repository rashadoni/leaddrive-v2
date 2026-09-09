import { createHash } from "node:crypto"

import type { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { validateConversationTagsInput, normalizeConversationTags, MAX_CONVERSATION_TAGS } from "@/lib/inbox/conversation-tags"
import {
  executeConversationAction,
  type ConversationSnapshot,
} from "@/lib/inbox/conversation-actions"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { CLOSE_OUTCOMES } from "@/lib/inbox/close-outcome"
import { setCustomerStage, type CustomerStage } from "@/lib/inbox/customer-stage"

/**
 * Bulk operations on inbox conversations — a thin batch orchestrator over the
 * existing tenant-guarded action layer (executeConversationAction), NOT a new
 * send path: the farewell message of bulk-close goes through send_reply →
 * sendConversationReply, so every per-channel gate (WhatsApp 24h window,
 * Telegram config, Chatwoot routing) stays enforced.
 *
 * Web-chat threads are status/assignment-driven by WebChatSession (not
 * SocialConversation) — they arrive as `webChatSessionIds` and get their own
 * branch: farewell = WebChatMessage(fromRole:"agent"), close = status "closed"
 * (the widget already resets cleanly on a closed session).
 *
 * Partial-failure semantics: cross-tenant/unknown ids are reported per-id as
 * {ok:false, error:"not_found"} (never a 4xx that aborts the batch), and a
 * failed farewell send does NOT prevent the close — the operator's intent is
 * closure; the message is best-effort (reported as sent:false + error).
 */

const MAX_BULK_IDS = 50
const SEND_CHUNK = 5
const BULK_FAREWELL_LEDGER_KEY = "bulkFarewellOperations"
const BULK_FAREWELL_LEDGER_LIMIT = 20

type BulkFarewellLedgerState = "claimed" | "sent" | "failed" | "delivery_unknown"

type BulkFarewellLedgerEntry = {
  state: BulkFarewellLedgerState
  messageHash: string
  claimedAt: string
  completedAt?: string
  error?: string
}

type BulkFarewellDelivery = {
  sent: boolean
  error?: string
  deliveryUnknown?: true
  replayed?: true
}

type BulkFarewellClaim =
  | { kind: "claimed" }
  | { kind: "result"; delivery: BulkFarewellDelivery }

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readBulkFarewellLedger(metadata: unknown): Record<string, BulkFarewellLedgerEntry> {
  const raw = objectValue(objectValue(metadata)[BULK_FAREWELL_LEDGER_KEY])
  const ledger: Record<string, BulkFarewellLedgerEntry> = {}
  for (const [operationId, value] of Object.entries(raw)) {
    const entry = objectValue(value)
    const state = entry.state
    if (
      (state === "claimed" || state === "sent" || state === "failed" || state === "delivery_unknown")
      && typeof entry.messageHash === "string"
      && typeof entry.claimedAt === "string"
    ) {
      ledger[operationId] = {
        state,
        messageHash: entry.messageHash,
        claimedAt: entry.claimedAt,
        ...(typeof entry.completedAt === "string" ? { completedAt: entry.completedAt } : {}),
        ...(typeof entry.error === "string" ? { error: entry.error } : {}),
      }
    }
  }
  return ledger
}

function metadataWithBulkFarewellEntry(
  metadata: unknown,
  operationId: string,
  entry: BulkFarewellLedgerEntry,
): Prisma.InputJsonObject {
  const base = objectValue(metadata)
  const ledger = readBulkFarewellLedger(metadata)
  ledger[operationId] = entry

  // Bound successful/failed history, but never discard the one unresolved
  // attempt: it is the durable "do not send again" fence after a crash or an
  // ambiguous provider response.
  const unresolved = Object.entries(ledger).filter(([, item]) =>
    item.state === "claimed" || item.state === "delivery_unknown")
  const completed = Object.entries(ledger)
    .filter(([, item]) => item.state === "sent" || item.state === "failed")
    .sort(([, left], [, right]) => left.claimedAt.localeCompare(right.claimedAt))
    .slice(-BULK_FAREWELL_LEDGER_LIMIT)

  return {
    ...base,
    [BULK_FAREWELL_LEDGER_KEY]: Object.fromEntries([...completed, ...unresolved]),
  } as Prisma.InputJsonObject
}

function replayBulkFarewell(entry: BulkFarewellLedgerEntry, messageHash: string): BulkFarewellDelivery {
  if (entry.messageHash !== messageHash) {
    return { sent: false, error: "idempotency_conflict", replayed: true }
  }
  if (entry.state === "sent") return { sent: true, replayed: true }
  if (entry.state === "failed") {
    return { sent: false, error: entry.error || "send_failed", replayed: true }
  }
  return { sent: false, error: "delivery_unknown", deliveryUnknown: true, replayed: true }
}

async function claimBulkFarewell(params: {
  organizationId: string
  conversationId: string
  operationId: string
  messageHash: string
}): Promise<BulkFarewellClaim> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bulk-farewell:${params.organizationId}:${params.conversationId}`}, 0))`

    // updatedAt is an optimistic compare-and-set fence. The advisory lock
    // serializes bulk farewell requests; the CAS additionally prevents this
    // JSON ledger write from overwriting unrelated concurrent metadata edits.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const conversation = await tx.socialConversation.findFirst({
        where: { id: params.conversationId, organizationId: params.organizationId },
        select: { metadata: true, updatedAt: true },
      })
      if (!conversation) {
        return { kind: "result", delivery: { sent: false, error: "conversation_unavailable" } }
      }

      const ledger = readBulkFarewellLedger(conversation.metadata)
      const existing = ledger[params.operationId]
      if (existing) {
        return { kind: "result", delivery: replayBulkFarewell(existing, params.messageHash) }
      }

      const unresolvedLedgerEntry = Object.values(ledger).some((entry) =>
        entry.state === "claimed" || entry.state === "delivery_unknown")
      if (unresolvedLedgerEntry) {
        return {
          kind: "result",
          delivery: { sent: false, error: "delivery_unknown", deliveryUnknown: true, replayed: true },
        }
      }

      // sendConversationReply writes the channel attempt before the provider
      // call. Honour that marker too, including attempts made outside bulk UI.
      const unresolvedMessage = await tx.channelMessage.findFirst({
        where: {
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          direction: "outbound",
          OR: [
            { status: "pending", metadata: { path: ["deliveryAttempted"], equals: true } },
            { status: "failed", metadata: { path: ["deliveryUnknown"], equals: true } },
          ],
        },
        select: { id: true },
      })
      if (unresolvedMessage) {
        return {
          kind: "result",
          delivery: { sent: false, error: "delivery_unknown", deliveryUnknown: true, replayed: true },
        }
      }

      const claimedAt = new Date().toISOString()
      const updated = await tx.socialConversation.updateMany({
        where: {
          id: params.conversationId,
          organizationId: params.organizationId,
          updatedAt: conversation.updatedAt,
        },
        data: {
          metadata: metadataWithBulkFarewellEntry(conversation.metadata, params.operationId, {
            state: "claimed",
            messageHash: params.messageHash,
            claimedAt,
          }),
        },
      })
      if (updated.count === 1) return { kind: "claimed" }
    }

    throw new Error("bulk_farewell_claim_conflict")
  })
}

async function finalizeBulkFarewell(params: {
  organizationId: string
  conversationId: string
  operationId: string
  messageHash: string
  state: Exclude<BulkFarewellLedgerState, "claimed">
  error?: string
}): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bulk-farewell:${params.organizationId}:${params.conversationId}`}, 0))`

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const conversation = await tx.socialConversation.findFirst({
        where: { id: params.conversationId, organizationId: params.organizationId },
        select: { metadata: true, updatedAt: true },
      })
      if (!conversation) return false
      const ledger = readBulkFarewellLedger(conversation.metadata)
      const claimed = ledger[params.operationId]
      if (!claimed || claimed.messageHash !== params.messageHash) return false
      if (claimed.state !== "claimed") return claimed.state === params.state

      const updated = await tx.socialConversation.updateMany({
        where: {
          id: params.conversationId,
          organizationId: params.organizationId,
          updatedAt: conversation.updatedAt,
        },
        data: {
          metadata: metadataWithBulkFarewellEntry(conversation.metadata, params.operationId, {
            ...claimed,
            state: params.state,
            completedAt: new Date().toISOString(),
            ...(params.error ? { error: params.error } : {}),
          }),
        },
      })
      if (updated.count === 1) return true
    }
    return false
  })
}

async function executeIdempotentBulkFarewell(params: {
  organizationId: string
  conversationId: string
  operationId: string
  message: string
  send: () => Promise<{ sent: boolean; error?: string; deliveryUnknown?: boolean }>
}): Promise<BulkFarewellDelivery> {
  const messageHash = createHash("sha256").update(params.message, "utf8").digest("hex")
  let claim: BulkFarewellClaim
  try {
    claim = await claimBulkFarewell({
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      operationId: params.operationId,
      messageHash,
    })
  } catch {
    // No external action ran when the durable claim failed.
    return { sent: false, error: "idempotency_unavailable" }
  }
  if (claim.kind === "result") return claim.delivery

  let attempted: { sent: boolean; error?: string; deliveryUnknown?: boolean }
  try {
    attempted = await params.send()
  } catch {
    attempted = { sent: false, error: "delivery_unknown", deliveryUnknown: true }
  }

  const state: Exclude<BulkFarewellLedgerState, "claimed"> = attempted.sent
    ? "sent"
    : attempted.deliveryUnknown
      ? "delivery_unknown"
      : "failed"
  const finalized = await finalizeBulkFarewell({
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    operationId: params.operationId,
    messageHash,
    state,
    error: attempted.error,
  }).catch(() => false)

  // The provider may have accepted the send even when the final ledger update
  // failed. Keep the original claim unresolved and forbid a retry.
  if (!finalized) return { sent: false, error: "delivery_unknown", deliveryUnknown: true }
  if (attempted.sent) return { sent: true }
  if (attempted.deliveryUnknown) {
    return { sent: false, error: attempted.error || "delivery_unknown", deliveryUnknown: true }
  }
  return { sent: false, error: attempted.error || "send_failed" }
}

// Threads with NO persisted conversation (WhatsApp / SMS / Telegram / Email
// groupings of ChannelMessage) arrive as threadRefs and are materialized into
// the same idempotent platform-"inbox" shells that single-thread notes,
// participants and web-chat folder/tags already use. `key` is the client's
// thread key, echoed back in results.
const threadRefSchema = z.object({
  key: z.string().min(1).max(200),
  channel: z.string().min(1).max(40),
  contactId: z.string().min(1).max(64).optional(),
  contactEmail: z.string().max(320).optional(),
  contactPhone: z.string().max(64).optional(),
  contactName: z.string().max(200).optional(),
  telegramChatId: z.string().max(64).optional(),
  messageIds: z.array(z.string().min(1)).max(500).default([]),
}).refine(
  ref => Boolean(ref.contactId || ref.contactEmail || ref.contactPhone || ref.telegramChatId),
  { message: "threadRef needs a stable identity" },
)

const bulkSchema = z.object({
  action: z.enum(["close", "pending", "assign", "folder", "tags"]),
  ids: z.array(z.string().min(1)).max(MAX_BULK_IDS).default([]),
  webChatSessionIds: z.array(z.string().min(1)).max(MAX_BULK_IDS).default([]),
  threadRefs: z.array(threadRefSchema).max(MAX_BULK_IDS).default([]),
  message: z.string().max(4000).optional(),
  operationId: z.string().uuid().optional(),
  closeOutcome: z.enum(CLOSE_OUTCOMES).optional(),
  closeOutcomeReason: z.string().max(2000).optional(),
  followUpAt: z.string().datetime().optional(),
  assignedTo: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
  if (data.action === "close" && data.message?.trim() && !data.operationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operationId"],
      message: "operationId is required when sending a farewell message",
    })
  }
})

type BulkResult = {
  id: string
  kind: "conversation" | "webChatSession" | "thread"
  ok: boolean
  sent?: boolean
  deliveryUnknown?: boolean
  replayed?: boolean
  error?: string
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export const POST = withInboxSessionWrite(async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const parsed = bulkSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }
  const { action, ids, webChatSessionIds, threadRefs } = parsed.data
  const message = parsed.data.message?.trim() || ""
  const operationId = parsed.data.operationId

  // Kept in addition to the schema refinement so this invariant remains
  // explicit at the irreversible side-effect boundary below.
  if (action === "close" && message && !operationId) {
    return NextResponse.json({ error: "operationId is required when sending a farewell message" }, { status: 400 })
  }

  if (ids.length + webChatSessionIds.length + threadRefs.length === 0) {
    return NextResponse.json({ error: "No conversations selected" }, { status: 400 })
  }
  if (ids.length + webChatSessionIds.length + threadRefs.length > MAX_BULK_IDS) {
    return NextResponse.json({ error: `At most ${MAX_BULK_IDS} conversations per request` }, { status: 400 })
  }

  // Action-specific target validation — identical rules to the single PATCH
  // (conversations/[id]/route.ts): assignee/folder must live in THIS org.
  if (action === "assign" && parsed.data.assignedTo) {
    const member = await prisma.user.findFirst({
      where: { id: parsed.data.assignedTo, organizationId: orgId },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ error: "Invalid assignee" }, { status: 400 })
  }
  if (action === "folder" && parsed.data.folderId) {
    const folder = await prisma.inboxFolder.findFirst({
      where: { id: parsed.data.folderId, organizationId: orgId },
      select: { id: true },
    })
    if (!folder) return NextResponse.json({ error: "Invalid folder" }, { status: 400 })
  }
  let addTags: string[] = []
  if (action === "tags") {
    const tagsValidation = validateConversationTagsInput(parsed.data.tags ?? [])
    if (!tagsValidation.ok) return NextResponse.json({ error: tagsValidation.error }, { status: 400 })
    addTags = tagsValidation.tags
    if (addTags.length === 0) return NextResponse.json({ error: "No tags provided" }, { status: 400 })
  }

  // Materialize channel threads into their idempotent shells BEFORE the
  // snapshot fetch so every action branch below sees a normal conversation
  // row. Tenant gates: contactId is verified against THIS org, and
  // ensureConversation links only org-scoped, still-unlinked message ids.
  const threadKeyByConvId = new Map<string, string>()
  const earlyResults: BulkResult[] = []
  if (threadRefs.length) {
    const refContactIds = Array.from(new Set(threadRefs.map(ref => ref.contactId).filter((id): id is string => Boolean(id))))
    const ownedContacts = refContactIds.length
      ? new Set(
          (await prisma.contact.findMany({ where: { id: { in: refContactIds }, organizationId: orgId }, select: { id: true } }))
            .map((contact: { id: string }) => contact.id),
        )
      : new Set<string>()
    for (const ref of threadRefs) {
      if (ref.contactId && !ownedContacts.has(ref.contactId)) {
        earlyResults.push({ id: ref.key, kind: "thread", ok: false, error: "not_found" })
        continue
      }
      try {
        const ensured = await ensureConversation(orgId, {
          channel: ref.channel,
          contactId: ref.contactId ?? null,
          contactEmail: ref.contactEmail ?? null,
          contactPhone: ref.contactPhone ?? null,
          contactName: ref.contactName ?? null,
          telegramChatId: ref.telegramChatId ?? null,
          messageIds: ref.messageIds,
        })
        threadKeyByConvId.set(ensured.id, ref.key)
      } catch {
        earlyResults.push({ id: ref.key, kind: "thread", ok: false, error: "ensure_failed" })
      }
    }
  }

  // Org-scoped snapshot fetch = the per-id tenant gate. Ids missing from the
  // result are cross-tenant or nonexistent → reported, never written.
  const fetchIds = [...ids, ...threadKeyByConvId.keys()]
  const conversationRows = fetchIds.length
    ? await prisma.socialConversation.findMany({
        where: { id: { in: fetchIds }, organizationId: orgId },
        select: {
          id: true, contactId: true, contactName: true, platform: true, externalId: true,
          channelConfigId: true, lastMessage: true, status: true, assignedTo: true,
          metadata: true, tags: true,
        },
      })
    : []
  const conversations: Array<ConversationSnapshot & { tags: string[] }> = conversationRows.map(
    (row: { metadata: unknown; tags: string[] | null } & Omit<ConversationSnapshot, "metadata">) => ({
      ...row,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
      tags: row.tags ?? [],
    }),
  )
  const sessions = webChatSessionIds.length
    ? await prisma.webChatSession.findMany({
        where: { id: { in: webChatSessionIds }, organizationId: orgId },
        select: { id: true, assignedUserId: true, visitorName: true },
      })
    : []

  const foundSessionIds = new Set(sessions.map((s: { id: string }) => s.id))
  const results: BulkResult[] = [
    ...earlyResults,
    ...ids.filter(id => !conversationRows.some((c: { id: string }) => c.id === id)).map(id => ({ id, kind: "conversation" as const, ok: false, error: "not_found" })),
    ...webChatSessionIds.filter(id => !foundSessionIds.has(id)).map(id => ({ id, kind: "webChatSession" as const, ok: false, error: "not_found" })),
  ]

  // Results for ensured thread shells are reported under the client's thread
  // key so the dashboard can reconcile them with its selection.
  const convResult = (convId: string, patch: Omit<BulkResult, "id" | "kind">): BulkResult => {
    const threadKey = threadKeyByConvId.get(convId)
    return threadKey ? { id: threadKey, kind: "thread", ...patch } : { id: convId, kind: "conversation", ...patch }
  }

  // Web-chat SHELL rows (platform "inbox", externalId "w:<sessionId>") display their
  // status/assignee from the WebChatSession, not from the shell — closing/assigning
  // the shell would return ok while changing nothing visible. The dashboard UI never
  // sends them here (it routes web-chat via webChatSessionIds), but this endpoint is
  // reachable by API integrations that list conversation ids. Folder/tags DO live on
  // the shell, so those actions keep accepting it.
  const isWebChatShell = (c: ConversationSnapshot) =>
    c.platform === "inbox" && typeof c.externalId === "string" && c.externalId.startsWith("w:")
  let effectiveConversations = conversations
  if (action === "close" || action === "assign") {
    const shells = conversations.filter(isWebChatShell)
    for (const shell of shells) {
      results.push({ id: shell.id, kind: "conversation", ok: false, error: "web_chat_session_required" })
    }
    effectiveConversations = conversations.filter(c => !isWebChatShell(c))
  }
  const foundConvIds = new Set(effectiveConversations.map((c: { id: string }) => c.id))

  if (action === "pending") {
    const pendingFolder = await prisma.inboxFolder.findFirst({
      where: { organizationId: orgId, name: "Gözləmədə" },
      select: { id: true },
    }) ?? await prisma.inboxFolder.create({
      data: { organizationId: orgId, name: "Gözləmədə", color: "#F59E0B", sortOrder: -100 },
      select: { id: true },
    })
    const followUpAt = parsed.data.followUpAt ? new Date(parsed.data.followUpAt) : null
    if (conversations.length) {
      await prisma.socialConversation.updateMany({
        where: { id: { in: conversations.map((conversation) => conversation.id) }, organizationId: orgId },
        data: {
          status: "open",
          closedAt: null,
          closeOutcome: null,
          closeOutcomeReason: null,
          folderId: pendingFolder.id,
          snoozedUntil: followUpAt,
        },
      })
    }
    for (const conv of conversations) results.push(convResult(conv.id, { ok: true }))
    for (const session of sessions) {
      const ensured = await ensureConversation(orgId, {
        channel: "web-chat",
        webChatSessionId: session.id,
        contactName: session.visitorName || "Web visitor",
      })
      await prisma.socialConversation.updateMany({
        where: { id: ensured.id, organizationId: orgId },
        data: { folderId: pendingFolder.id, snoozedUntil: followUpAt },
      })
      results.push({ id: session.id, kind: "webChatSession", ok: true })
    }
  }

  if (action === "close") {
    // 1) Optional farewell — send FIRST (a closed thread reads as "done"; the
    //    message must go out while the conversation is still live), chunked to
    //    bound latency. Every target has a durable per-operation claim, so a
    //    lost HTTP response or a concurrent retry cannot issue the send twice.
    const sendResults = new Map<string, BulkFarewellDelivery>()
    if (message && operationId) {
      for (const group of chunk(effectiveConversations, SEND_CHUNK)) {
        await Promise.all(group.map(async (conv: ConversationSnapshot & { tags: string[] }) => {
          const delivery = await executeIdempotentBulkFarewell({
            organizationId: orgId,
            conversationId: conv.id,
            operationId,
            message,
            send: async () => {
              const sent = await executeConversationAction(
                { type: "send_reply", config: { text: message } },
                { organizationId: orgId, conversationId: conv.id, conversation: conv, actorUserId: auth.userId },
              )
              if (sent.ok) return { sent: true }
              const deliveryUnknown = sent.terminal === true
                || sent.detail?.deliveryUnknown === true
                || sent.error === "delivery_unknown"
              return { sent: false, error: sent.error, deliveryUnknown }
            },
          })
          sendResults.set(conv.id, delivery)
        }))
      }
    }
    // 2) Close everything found — even rows whose farewell failed (see header).
    const closeOutcome = parsed.data.closeOutcome ?? null
    const closeOutcomeReason = parsed.data.closeOutcomeReason?.trim() || null
    const closeData = {
      status: "resolved" as const,
      closedAt: new Date(),
      ...(closeOutcome !== null ? { closeOutcome } : {}),
      ...(closeOutcomeReason !== null ? { closeOutcomeReason } : {}),
    }
    if (effectiveConversations.length) {
      await prisma.socialConversation.updateMany({
        where: { id: { in: Array.from(foundConvIds) }, organizationId: orgId },
        data: closeData,
      })
      const customerStage: CustomerStage | null = closeOutcome === "won"
        ? "sold"
        : closeOutcome === "lost"
          ? "not_sold"
          : closeOutcome === "none"
            ? "no_result"
            : null
      if (customerStage) {
        await Promise.allSettled(effectiveConversations.map((conv) =>
          setCustomerStage(prisma, {
            organizationId: orgId,
            conversationId: conv.id,
            stage: customerStage,
            source: "system",
            changedBy: auth.userId,
            reason: closeOutcomeReason,
          }),
        ))
      }
    }
    for (const conv of effectiveConversations) {
      const delivery = sendResults.get(conv.id)
      results.push(convResult(conv.id, {
        ok: true,
        ...(message ? { sent: delivery?.sent === true } : {}),
        ...(delivery?.error ? { error: delivery.error } : {}),
        ...(delivery?.deliveryUnknown ? { deliveryUnknown: true } : {}),
        ...(delivery?.replayed ? { replayed: true } : {}),
      }))
    }
    for (const session of sessions) {
      let shell: Awaited<ReturnType<typeof ensureConversation>> | null = null
      try {
        shell = await ensureConversation(orgId, {
          channel: "web-chat",
          webChatSessionId: session.id,
          contactName: session.visitorName || "Web visitor",
        })
      } catch {
        // A shell is the durable per-session idempotency owner. Do not send a
        // message if it cannot be resolved first.
      }
      let delivery: BulkFarewellDelivery | null = null
      if (message && operationId) {
        if (!shell) {
          delivery = { sent: false, error: "ensure_failed" }
        } else {
          delivery = await executeIdempotentBulkFarewell({
            organizationId: orgId,
            conversationId: shell.id,
            operationId,
            message,
            send: async () => {
              await prisma.webChatMessage.create({
                data: { organizationId: orgId, sessionId: session.id, fromRole: "agent", authorUserId: auth.userId, text: message },
              })
              await prisma.webChatSession.updateMany({
                where: { id: session.id, organizationId: orgId },
                data: { lastMessageAt: new Date() },
              })
              return { sent: true }
            },
          })
        }
      }
      await prisma.webChatSession.updateMany({
        where: { id: session.id, organizationId: orgId },
        data: {
          status: "closed",
          closedAt: new Date(),
          ...(closeOutcome !== null ? { closeOutcome } : {}),
          ...(closeOutcomeReason !== null ? { closeOutcomeReason } : {}),
        },
      })
      if (!shell) {
        try {
          shell = await ensureConversation(orgId, {
            channel: "web-chat",
            webChatSessionId: session.id,
            contactName: session.visitorName || "Web visitor",
          })
        } catch {
          // Closing the session remains the primary requested action. Stage
          // synchronization is best-effort when shell materialization fails.
        }
      }
      const customerStage: CustomerStage | null = closeOutcome === "won"
        ? "sold"
        : closeOutcome === "lost"
          ? "not_sold"
          : closeOutcome === "none"
            ? "no_result"
            : null
      if (customerStage && shell) {
        await setCustomerStage(prisma, {
          organizationId: orgId,
          conversationId: shell.id,
          stage: customerStage,
          source: "system",
          changedBy: auth.userId,
          reason: closeOutcomeReason,
        }).catch((error: unknown) => console.error("[bulk close] customer stage sync failed:", error))
      }
      results.push({
        id: session.id, kind: "webChatSession", ok: true,
        ...(message ? { sent: delivery?.sent === true } : {}),
        ...(delivery?.error ? { error: delivery.error } : {}),
        ...(delivery?.deliveryUnknown ? { deliveryUnknown: true } : {}),
        ...(delivery?.replayed ? { replayed: true } : {}),
      })
    }
  }

  if (action === "assign") {
    const assignedTo = parsed.data.assignedTo ?? null
    if (effectiveConversations.length) {
      await prisma.socialConversation.updateMany({
        where: { id: { in: Array.from(foundConvIds) }, organizationId: orgId },
        data: { assignedTo },
      })
    }
    if (sessions.length) {
      // Mirrors the single web-chat session PATCH: a human taking over pauses AI.
      await prisma.webChatSession.updateMany({
        where: { id: { in: Array.from(foundSessionIds) }, organizationId: orgId },
        data: { assignedUserId: assignedTo, aiPaused: assignedTo !== null },
      })
    }
    for (const conv of effectiveConversations) results.push(convResult(conv.id, { ok: true }))
    for (const session of sessions) results.push({ id: session.id, kind: "webChatSession", ok: true })
  }

  if (action === "folder") {
    const folderId = parsed.data.folderId ?? null
    if (conversations.length) {
      await prisma.socialConversation.updateMany({
        where: { id: { in: Array.from(foundConvIds) }, organizationId: orgId },
        data: { folderId },
      })
    }
    for (const conv of conversations) results.push(convResult(conv.id, { ok: true }))
    // Web-chat sessions have no folder column — file them via their (idempotent,
    // `w:<sessionId>`-keyed) SocialConversation shell.
    for (const session of sessions) {
      try {
        const ensured = await ensureConversation(orgId, {
          channel: "web-chat",
          webChatSessionId: session.id,
          contactName: session.visitorName || "Web visitor",
        })
        await prisma.socialConversation.updateMany({
          where: { id: ensured.id, organizationId: orgId },
          data: { folderId },
        })
        results.push({ id: session.id, kind: "webChatSession", ok: true })
      } catch {
        results.push({ id: session.id, kind: "webChatSession", ok: false, error: "folder_failed" })
      }
    }
  }

  if (action === "tags") {
    // Union per row (read from the snapshot, merge, write) — fine at ≤50 rows.
    // The merged set is re-capped at MAX_CONVERSATION_TAGS: the input validator
    // caps only the ADDED tags, and the single PATCH enforces the cap on the
    // full replacement set — bulk-add must keep that invariant.
    for (const conv of conversations) {
      const merged = normalizeConversationTags([...(conv.tags ?? []), ...addTags]).slice(0, MAX_CONVERSATION_TAGS)
      await prisma.socialConversation.updateMany({
        where: { id: conv.id, organizationId: orgId },
        data: { tags: merged },
      })
      results.push(convResult(conv.id, { ok: true }))
    }
    // Web-chat threads display tags from their ensured w:<sessionId> shell —
    // same shell the folder branch and single-thread tagging use.
    for (const session of sessions) {
      try {
        const ensured = await ensureConversation(orgId, {
          channel: "web-chat",
          webChatSessionId: session.id,
          contactName: session.visitorName || "Web visitor",
        })
        const shell = await prisma.socialConversation.findMany({
          where: { id: ensured.id, organizationId: orgId },
          select: { id: true, tags: true },
        })
        const currentTags: string[] = shell[0]?.tags ?? []
        const merged = normalizeConversationTags([...currentTags, ...addTags]).slice(0, MAX_CONVERSATION_TAGS)
        await prisma.socialConversation.updateMany({
          where: { id: ensured.id, organizationId: orgId },
          data: { tags: merged },
        })
        results.push({ id: session.id, kind: "webChatSession", ok: true })
      } catch {
        results.push({ id: session.id, kind: "webChatSession", ok: false, error: "tags_failed" })
      }
    }
  }

  const summary = {
    requested: ids.length + webChatSessionIds.length + threadRefs.length,
    updated: results.filter(r => r.ok).length,
    sendFailed: results.filter(r => r.ok && r.sent === false && !r.deliveryUnknown).length,
    deliveryUnknown: results.filter(r => r.ok && r.deliveryUnknown).length,
    notFound: results.filter(r => r.error === "not_found").length,
  }

  await Promise.resolve(logAudit(
    orgId,
    "bulk_update",
    "conversation",
    [...foundConvIds, ...foundSessionIds].join(",").slice(0, 500),
    `Bulk ${action}: ${summary.updated}/${summary.requested} conversations`,
  )).catch(() => {})

  return NextResponse.json({ success: true, data: { results, summary } })
})
