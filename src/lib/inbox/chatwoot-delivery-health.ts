import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

/**
 * What "delivered" is allowed to mean for a Chatwoot-bridged reply.
 *
 * Our outbound row went to `delivered` the moment Chatwoot answered 2xx to the
 * message-create call. That answer only says Chatwoot stored the text. The
 * provider behind the inbox decides afterwards, and when it refuses, Chatwoot
 * flips its own message to status "failed" and records the provider's words in
 * `content_attributes.external_error` — while our inbox kept showing a double
 * tick.
 *
 * That gap cost ten days in production. From 2026-08-21 every TikTok reply for
 * one tenant was rejected — first `40105: Access token is invalid`, then
 * `40002: User is not entitled to access MAPI capabilities` — and nothing in
 * the CRM said so. Worse, the poller treats a failed provider message as no
 * reply at all, so the AI answered the same customer again and again: three
 * identical price tables to somebody who received none of them.
 *
 * These two functions close both halves. Reconciliation makes the row tell the
 * truth; the failure count stops the agent from talking into a channel that has
 * stopped carrying its words.
 */

type DeliveryDb = Pick<PrismaClient, "channelMessage">

/**
 * How many consecutive undelivered replies end the automated conversation.
 *
 * One failure is worth retrying: a single provider hiccup should not park a
 * live conversation. A second one in a row is a broken channel, and every
 * further generated answer is spend that reaches nobody while the customer
 * watches an agent ignore them.
 */
export const CHATWOOT_DELIVERY_FAILURE_LIMIT = 2

/** How far back a repeat notification about the same conversation is a duplicate. */
export const DELIVERY_BREAKDOWN_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000

type ChatwootStatusMessage = {
  id?: unknown
  message_type?: unknown
  private?: unknown
  status?: unknown
  content_attributes?: unknown
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isOutgoing(value: unknown): boolean {
  return value === "outgoing" || value === 1
}

/** The provider's own words, capped so a hostile body cannot bloat the row. */
function providerError(message: ChatwootStatusMessage): string | null {
  const raw = objectRecord(message.content_attributes).external_error
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 500) : null
}

/**
 * Mark our outbound rows failed for every Chatwoot message the provider refused.
 *
 * Matching is by `externalId` only. Content matching would be actively wrong
 * here: the loop this fix exists to stop produces several byte-identical
 * messages in one conversation, so text would pick an arbitrary one. Rows sent
 * before we started recording the id therefore stay as they are — the history
 * is not rewritten, only everything from here on is honest.
 */
export async function reconcileChatwootDeliveryFailures(
  db: DeliveryDb,
  params: { organizationId: string; messages: readonly ChatwootStatusMessage[] },
): Promise<number> {
  const failedIds = new Map<string, string | null>()
  for (const message of params.messages) {
    if (!isOutgoing(message.message_type) || message.private === true) continue
    if (String(message.status ?? "").toLowerCase() !== "failed") continue
    const id = message.id == null ? "" : String(message.id)
    if (id) failedIds.set(id, providerError(message))
  }
  if (failedIds.size === 0) return 0

  const rows = await db.channelMessage.findMany({
    where: {
      organizationId: params.organizationId,
      channelType: "tiktok",
      direction: "outbound",
      externalId: { in: [...failedIds.keys()] },
      status: { not: "failed" },
    },
    select: { id: true, externalId: true, metadata: true },
  })

  let reconciled = 0
  for (const row of rows) {
    const error = row.externalId ? failedIds.get(row.externalId) ?? null : null
    // updateMany cannot merge JSON, and the existing metadata carries the
    // delivery ledger the sender wrote — overwriting it would lose the
    // idempotency key that stops a retry from double-sending.
    await db.channelMessage.update({
      where: { id: row.id },
      data: {
        status: "failed",
        metadata: {
          ...objectRecord(row.metadata),
          deliveryConfirmed: false,
          deliveryFailed: true,
          providerStatus: "failed",
          ...(error ? { providerError: error, error } : {}),
        },
      },
    })
    reconciled++
  }
  return reconciled
}

/**
 * How many of the newest replies in this conversation failed, back to back.
 *
 * Counting stops at the first row that did not fail, so one delivered answer
 * clears the record and the agent resumes on its own once the channel heals.
 * Rows still `pending` also stop the count: an in-flight send is not yet
 * evidence of anything.
 */
export async function deliveryFailureStreak(
  db: DeliveryDb,
  params: { organizationId: string; conversationId: string; limit?: number },
): Promise<{ streak: number; providerError: string | null; newestFailureAt: Date | null }> {
  const inspect = Math.max(1, params.limit ?? CHATWOOT_DELIVERY_FAILURE_LIMIT * 3)
  const rows = await db.channelMessage.findMany({
    where: {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      channelType: "tiktok",
      direction: "outbound",
    },
    orderBy: { createdAt: "desc" },
    take: inspect,
    select: { status: true, metadata: true, createdAt: true },
  })
  let streak = 0
  let providerError: string | null = null
  let newestFailureAt: Date | null = null
  for (const row of rows) {
    if (row.status !== "failed") break
    streak++
    if (newestFailureAt === null) newestFailureAt = row.createdAt ?? null
    if (providerError === null) {
      const recorded = objectRecord(row.metadata).providerError
      if (typeof recorded === "string" && recorded.trim()) providerError = recorded.trim()
    }
  }
  return { streak, providerError, newestFailureAt }
}

/** Stored on every breakdown alert; it is also how the daily de-duplication finds them. */
const DELIVERY_BREAKDOWN_TITLE = "Ответы не доходят до клиента"

/**
 * Tell the inbox team that a channel stopped carrying our replies.
 *
 * Not the keyword escalation in ./escalation: nothing is wrong with what the
 * customer wrote, the provider is refusing what we write back. Fires once per
 * conversation per day — the condition persists until somebody fixes the
 * channel, and an alert on every later inbound would train the team to ignore
 * exactly the one that matters. The provider's own error is carried verbatim,
 * because "40002: User is not entitled to access MAPI capabilities" is the one
 * string that tells an operator where to go.
 */
export async function notifyDeliveryBreakdown(
  opts: {
    orgId: string
    conversationId: string
    platform: string
    contactName: string
    failures: number
    providerError?: string | null
  },
  db: Pick<PrismaClient, "notification" | "user"> = prisma,
): Promise<boolean> {
  try {
    // Notification stores no event kind — the `kind` below only gates the push
    // preference — so the de-duplication keys on stored columns that do
    // identify this alert: the conversation it is about, and its title.
    const recent = await db.notification.findFirst({
      where: {
        organizationId: opts.orgId,
        entityType: "inbox_message",
        entityId: opts.conversationId,
        title: DELIVERY_BREAKDOWN_TITLE,
        createdAt: { gte: new Date(Date.now() - DELIVERY_BREAKDOWN_NOTICE_WINDOW_MS) },
      },
      select: { id: true },
    })
    if (recent) return false

    const team = await db.user.findMany({
      where: {
        organizationId: opts.orgId,
        role: { in: ["admin", "manager", "support"] },
        isActive: true,
      },
      select: { id: true },
    })
    const detail = opts.providerError ? ` Ошибка канала: ${opts.providerError}` : ""
    await Promise.all(
      team.map((member: { id: string }) =>
        createNotification({
          organizationId: opts.orgId,
          userId: member.id,
          type: "warning",
          title: DELIVERY_BREAKDOWN_TITLE,
          message: `${opts.platform}: ${opts.failures} ответа подряд не доставлены клиенту ${opts.contactName}. Автоответы в этом диалоге остановлены.${detail}`,
          entityType: "inbox_message",
          entityId: opts.conversationId,
          kind: "inbox.delivery_failure",
          push: true,
        }).catch(() => {}),
      ),
    )
    return true
  } catch {
    /* the alert is best-effort; it must never break the reply path */
    return false
  }
}

/**
 * How long a parked conversation waits before risking one probe reply.
 *
 * Without this the silence is permanent: the gate reads the failure streak, a
 * gated conversation never writes a new outbound row, so nothing can ever clear
 * the streak — even after the provider restores access. The tenant this gate
 * was built for runs its ads at night with nobody on shift, so "an operator
 * unparks it by replying manually" is not an answer; the agent must come back
 * on its own.
 *
 * Every interval the gate lets exactly one generated reply through. If the
 * provider still refuses it, the failure row it leaves behind restarts the
 * clock — at most four undeliverable replies per conversation per day. The
 * moment one probe is delivered, the streak is broken and the conversation is
 * fully live again; the poller then sees the older unanswered inbounds as
 * uncovered and works through the backlog by itself.
 */
export const DELIVERY_PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Should the bots stay silent in this conversation, and has the team been told?
 *
 * Returns true when the automated reply must not be attempted. Deliberately
 * fails OPEN: if this check itself throws we answer the customer, because a
 * broken health lookup is a far weaker reason to go quiet than a provider that
 * has actually refused us twice.
 */
export async function stopAutoReplyForBrokenDelivery(
  params: {
    orgId: string
    conversationId: string
    contactName: string
    platform?: string
    nowMs?: number
  },
  db: Pick<PrismaClient, "channelMessage" | "notification" | "user"> = prisma,
): Promise<boolean> {
  try {
    const { streak, providerError, newestFailureAt } = await deliveryFailureStreak(db, {
      organizationId: params.orgId,
      conversationId: params.conversationId,
    })
    if (streak < CHATWOOT_DELIVERY_FAILURE_LIMIT) return false
    const now = params.nowMs ?? Date.now()
    if (
      newestFailureAt !== null
      && now - newestFailureAt.getTime() >= DELIVERY_PROBE_INTERVAL_MS
    ) {
      // The newest refusal has aged past the probe interval: let one reply
      // through to test the channel. Whatever row that attempt leaves behind
      // makes the next decision — a delivered one reopens the conversation, a
      // failed one restarts this clock.
      return false
    }
    await notifyDeliveryBreakdown({
      orgId: params.orgId,
      conversationId: params.conversationId,
      platform: params.platform ?? "TikTok",
      contactName: params.contactName,
      failures: streak,
      providerError,
    }, db)
    return true
  } catch {
    return false
  }
}
