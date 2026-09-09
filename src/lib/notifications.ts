import { createHash } from "node:crypto"
import { Prisma, type Notification as NotificationRow } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { sendPushToUser } from "@/lib/push-send"
import { deriveSection } from "@/lib/notifications/taxonomy"
import { canNotifyEntityType } from "@/lib/notifications/access"
import { shouldPush, type NotificationPrefs } from "@/lib/notifications/prefs"
import { getOrgModuleContext } from "@/lib/api-auth"
import type { Role } from "@/lib/permissions"
import { sendEmail } from "@/lib/email"
import { APP_URL } from "@/lib/domains"

/** Derive a click-through URL from the entity type + id. */
function deriveNotificationUrl(entityType?: string, entityId?: string): string {
  if (!entityType || !entityId) return "/notifications"
  switch (entityType) {
    // Phase 1 — CRM core entities
    case "task":    return `/tasks/${entityId}`
    // A link that lands on the notifications page when the notification is
    // ABOUT a lead is a small lie the recipient pays for with a search.
    case "lead":    return `/leads/${entityId}`
    case "contact": return `/contacts/${entityId}`
    case "company": return `/companies/${entityId}`
    case "deal":    return `/deals/${entityId}`
    case "ticket":   return `/tickets/${entityId}`
    case "contract": return `/contracts/${entityId}`
    // Phase 2a — CRM + Finance
    case "quote":   return `/quotes/${entityId}`
    case "invoice": return `/invoices/${entityId}`
    // Phase 2b — Support + Communication
    case "complaint":     return `/complaints`
    case "inbox_message": return `/inbox`
    // Phase 2c — Route & Field + Marketing
    case "survey":  return `/surveys`
    case "loyalty": return `/loyalty/dashboard`
    default:        return "/notifications"
  }
}

/**
 * Decides whether to send a push to the recipient.
 *
 * Returns true iff:
 *   - entityType maps to a known section (unknown → false; Phase 2 will map them)
 *   - the recipient's role+org-feature grants access to that section
 *   - the recipient's stored push pref (+ per-kind) is enabled
 *
 * Best-effort: any error returns false — never breaks createNotification.
 */
async function resolvePushDecision(
  orgId: string,
  recipientUserId: string,
  entityType: string,
  kind?: string
): Promise<boolean> {
  try {
    // FIX A: Gate delivery per-entityType (not per-section) to prevent sibling
    // module leaks. Unknown entityType → fail-closed (canNotifyEntityType returns false).
    // Derive section only for the shouldPush pref lookup (section is the pref key).
    const section = deriveSection(entityType)
    if (!section) return false // unknown entityType → don't push (fail-closed)

    const [recipient, orgCtx, prefRow] = await Promise.all([
      prisma.user.findUnique({ where: { id: recipientUserId }, select: { role: true } }),
      getOrgModuleContext(orgId),
      prisma.userPreference.findUnique({ where: { userId: recipientUserId } }),
    ])

    if (!recipient) return false

    const ctx = { role: recipient.role as Role, ...orgCtx }
    // Use canNotifyEntityType (per-entity gate) for delivery, not canNotifySection (per-section).
    if (!canNotifyEntityType(ctx, entityType)) return false

    const prefs: NotificationPrefs =
      ((prefRow?.data as any)?.notificationPreferences as NotificationPrefs) ?? {}
    return shouldPush(prefs, section, kind)
  } catch {
    return false
  }
}

function escapeNotificationHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

type NotificationPersistenceClient = Pick<Prisma.TransactionClient, "notification">

export async function deliverNotificationPush({
  organizationId,
  userId,
  title,
  message,
  entityType,
  entityId,
  kind,
  notificationId,
}: {
  organizationId: string
  userId?: string
  title: string
  message: string
  entityType?: string
  entityId?: string
  kind?: string
  notificationId?: string
}): Promise<void> {
  if (!userId) return
  try {
    const allowed = await resolvePushDecision(
      organizationId,
      userId,
      entityType ?? "",
      kind,
    )
    if (!allowed) return
    await sendPushToUser(organizationId, userId, {
      title,
      body: message,
      url: deriveNotificationUrl(entityType, entityId),
      tag: `ld-${entityType ?? "notif"}-${entityId ?? notificationId ?? "notification"}`,
    }).catch(() => {})
  } catch {
    // Push is deliberately best-effort. The durable in-app row is the record.
  }
}

export async function createNotification({
  organizationId,
  userId,
  type = "info",
  title,
  message,
  entityType,
  entityId,
  push,
  kind,
  awaitPush,
  email,
  idempotencyKey,
  client,
}: {
  organizationId: string
  userId?: string
  type?: "info" | "warning" | "error" | "success"
  title: string
  message: string
  entityType?: string
  entityId?: string
  /** When true, fires a best-effort browser push to the userId's subscriptions. */
  push?: boolean
  /** Optional event kind (e.g. "task.created") used by the push-gate pref check. */
  kind?: string
  /** Wait for the best-effort push attempt before resolving. */
  awaitPush?: boolean
  /**
   * Also send this to the recipient's inbox.
   *
   * For the things a person must act on when they are NOT looking at the CRM —
   * being handed a lead, being handed a task. A bell they will see tomorrow is
   * not a handover; the owner asked for this in as many words, and the same
   * reasoning already sends the call-commitment email.
   *
   * Opt-in per call site rather than automatic: every notification by email is
   * how a mailbox becomes a folder nobody opens.
   */
  email?: boolean
  /**
   * Internal semantic key for jobs that must survive retries and an uncertain
   * INSERT result. The stored id is a tenant/recipient-scoped hash; callers do
   * not control Notification.id and the raw key never reaches the database.
   */
  idempotencyKey?: string
  /**
   * Internal transaction client for callers that atomically couple the row to
   * another state transition. External push/email is deferred by that caller
   * until after commit.
   */
  client?: NotificationPersistenceClient
}) {
  const storedUserId = userId || ""
  const deterministicId = idempotencyKey !== undefined
    ? `notif_idem_${createHash("sha256")
        .update(JSON.stringify([organizationId, storedUserId, idempotencyKey]))
        .digest("hex")}`
    : null

  try {
    const data = {
      ...(deterministicId ? { id: deterministicId } : {}),
      organizationId,
      userId: storedUserId,
      type,
      title,
      message,
      entityType,
      entityId,
    }
    // A unique violation aborts a PostgreSQL transaction even if JavaScript
    // catches it. `createMany(skipDuplicates)` gives transactional callers a
    // non-throwing insert result and, unlike upsert, tells them whether this
    // tick actually created the row (so they do not redeliver the same push).
    let createdNow: boolean | undefined
    let notification: NotificationRow
    if (client && deterministicId) {
      const inserted = await client.notification.createMany({
        data,
        skipDuplicates: true,
      })
      createdNow = inserted.count === 1
      const existing = await client.notification.findFirst({
        where: {
          id: deterministicId,
          organizationId,
          userId: storedUserId,
          entityType: entityType ?? null,
          entityId: entityId ?? null,
        },
      })
      if (!existing) throw new Error("notification_identity_conflict")
      notification = existing
    } else if (client) {
      notification = await client.notification.create({ data })
      createdNow = true
    } else {
      notification = await prisma.notification.create({ data })
    }

    // Best-effort email. Never blocks and never throws into the create path:
    // the notification row is the record, the email is a courtesy on top of it.
    if (!client && email === true && userId && userId.length > 0) {
      void (async () => {
        try {
          const recipient = await prisma.user.findFirst({
            where: { id: userId, organizationId, isActive: true },
            select: { email: true },
          })
          if (!recipient?.email) return
          const link = `${APP_URL}${deriveNotificationUrl(entityType, entityId)}`
          await sendEmail({
            to: recipient.email,
            organizationId,
            transactional: true,
            subject: title.slice(0, 180),
            text: `${message}\n\n${link}`,
            html: `<p>${escapeNotificationHtml(message)}</p><p><a href="${link}">${escapeNotificationHtml(link)}</a></p>`,
          })
        } catch {
          // A mail transport that is down must never cost the notification.
        }
      })()
    }

    // Best-effort browser push — gated by recipient's access + push prefs.
    // Never throws into the create path.
    if (!client && push === true && userId && userId.length > 0) {
      const pushDelivery = deliverNotificationPush({
        organizationId,
        userId,
        title,
        message,
        entityType,
        entityId,
        kind,
        notificationId: notification.id,
      })
      if (awaitPush === true) await pushDelivery
      else void pushDelivery
    }

    return client ? { ...notification, createdNow: createdNow === true } : notification
  } catch (e) {
    // A timeout after COMMIT is indistinguishable from a failed INSERT to the
    // caller. With a semantic key, prove whether the exact row exists before
    // deciding to retry. Returning the winner without re-running push/email
    // closes the crash window without pretending those external transports
    // are exactly-once.
    if (deterministicId && !client) {
      const existing = await prisma.notification.findFirst({
        where: {
          id: deterministicId,
          organizationId,
          userId: storedUserId,
          entityType: entityType ?? null,
          entityId: entityId ?? null,
        },
      }).catch(() => null)
      if (existing) return existing
    }
    console.error("Failed to create notification:", e)
    return null
  }
}
