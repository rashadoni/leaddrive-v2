import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getOrgModuleContext } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"
import { PAGE_SIZE } from "@/lib/constants"
import type { Role } from "@/lib/permissions"
import { ENTITY_TO_MODULE } from "@/lib/notifications/taxonomy"
import { canNotifyEntityType } from "@/lib/notifications/access"

/**
 * Entity-type allowlist filter, shared by GET (read-gate) and PATCH (mark-read
 * gate) so both honour the SAME access rule. A row is in scope iff its
 * entityType is null (system/global) OR maps to a module the user may access.
 * Fail-CLOSED: any ctx error → only null-entityType rows.
 */
async function computeEntityTypeFilter(orgId: string, role: Role) {
  let allowed: string[] = []
  try {
    const orgCtx = await getOrgModuleContext(orgId)
    const ctx = { role, ...orgCtx }
    allowed = Object.keys(ENTITY_TO_MODULE).filter((et) => canNotifyEntityType(ctx, et))
  } catch {
    // fail-closed: keep allowed=[] so only null-entityType rows pass
  }
  return allowed.length > 0
    ? { OR: [{ entityType: null }, { entityType: { in: allowed } }] }
    : { entityType: null }
}

type NotificationTarget = {
  entityType: string | null
  entityId: string | null
}

const notificationEntityUrls: Record<string, string> = {
  task: "/tasks",
  deal: "/deals",
  lead: "/leads",
  contact: "/contacts",
  company: "/companies",
  ticket: "/tickets",
  campaign: "/campaigns",
  contract: "/contracts",
  complaint: "/complaints",
  invoice: "/invoices",
}

function getNotificationUrl(notification: NotificationTarget) {
  if (!notification.entityType) return null
  const base = notificationEntityUrls[notification.entityType]
  if (!base) return null
  return notification.entityId ? `${base}/${notification.entityId}` : base
}

async function enrichNotificationTargets<T extends NotificationTarget>(
  notifications: T[],
  orgId: string,
) {
  const dealIds = Array.from(
    new Set(
      notifications
        .filter((notification) => notification.entityType === "deal" && notification.entityId)
        .map((notification) => notification.entityId as string),
    ),
  )

  const existingDealIds = new Set<string>()
  if (dealIds.length > 0) {
    const deals: Array<{ id: string }> = await prisma.deal.findMany({
      where: { organizationId: orgId, id: { in: dealIds } },
      select: { id: true },
    })
    deals.forEach((deal) => existingDealIds.add(deal.id))
  }

  return notifications.map((notification) => {
    if (
      notification.entityType === "deal" &&
      notification.entityId &&
      !existingDealIds.has(notification.entityId)
    ) {
      return {
        ...notification,
        url: notificationEntityUrls.deal,
        targetMissing: true,
      }
    }

    return {
      ...notification,
      url: getNotificationUrl(notification),
      targetMissing: false,
    }
  })
}

export const GET = withRls(async (req, { orgId, session }) => {
  // FIX D: require an end-user session — no API key / null-session all-org path
  const userId = session?.userId
  if (!userId) {
    // No legitimate non-web caller hits /api/v1/notifications (confirmed by grep).
    // Fail with 401 so the all-org default (userFilter={}) is impossible.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const role = (session?.role || "viewer") as Role

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get("page") || "1")
  const limit = PAGE_SIZE.DEFAULT

  if (isNaN(page) || page < 1) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 })
  }

  try {
    // ALLOWLIST read-gate (shared with PATCH via computeEntityTypeFilter):
    // unknown entityTypes fail closed; entityType IS NULL (system/global) always
    // visible. Same filter on the list + both counts so they stay consistent.
    const recipientFilter = { OR: [{ userId }, { userId: "" }] }
    const entityTypeFilter = await computeEntityTypeFilter(orgId, role)

    // Optional entityType scope — lets a caller (e.g. the sidebar Inbox badge) narrow the unread count
    // to one kind (e.g. inbox_message). Still AND-ed with the allowlist gate below, so it can only
    // narrow, never widen, what this user may see.
    const entityTypeParam = searchParams.get("entityType")
    const scopeFilter = entityTypeParam ? { entityType: entityTypeParam } : {}
    const baseWhere = {
      organizationId: orgId,
      AND: [recipientFilter, entityTypeFilter, scopeFilter],
    }

    const [notifications, unreadCount, total] = await Promise.all([
      prisma.notification.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({
        where: { ...baseWhere, isRead: false },
      }),
      prisma.notification.count({
        where: baseWhere,
      }),
    ])
    const notificationsWithTargets = await enrichNotificationTargets(notifications, orgId)

    return NextResponse.json({
      success: true,
      data: {
        notifications: notificationsWithTargets,
        unreadCount,
        total,
        page,
        limit,
        hasMore: page * limit < total,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PATCH = withRls(async (req, { orgId, session }) => {
  // FIX D: require an end-user session for PATCH too
  const userId = session?.userId
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const role = (session?.role || "viewer") as Role

  const body = await req.json()
  const { ids, markAll, entityType, entityId } = body

  // Gate-consistency: PATCH honours the SAME entityType allowlist as GET, so a
  // user can't mark inaccessible-section notifications read (mark state must match
  // what the read-gate shows). + recipient scope (FIX C: IDOR).
  const recipientFilter = { OR: [{ userId }, { userId: "" }] }
  const entityTypeFilter = await computeEntityTypeFilter(orgId, role)

  try {
    if (markAll) {
      await prisma.notification.updateMany({
        where: {
          organizationId: orgId,
          AND: [recipientFilter, entityTypeFilter],
          isRead: false,
        },
        data: { isRead: true },
      })
    } else if (typeof entityType === "string" && typeof entityId === "string") {
      // Scoped mark — reading a conversation clears ITS OWN unread notifications (e.g. the sidebar
      // Inbox badge for inbox_message). entityTypeFilter still gates which sections may be marked;
      // recipientFilter still prevents IDOR across users.
      await prisma.notification.updateMany({
        where: {
          organizationId: orgId,
          entityType,
          entityId,
          AND: [recipientFilter, entityTypeFilter],
          isRead: false,
        },
        data: { isRead: true },
      })
    } else if (ids && Array.isArray(ids)) {
      await prisma.notification.updateMany({
        where: {
          id: { in: ids },
          organizationId: orgId,
          AND: [recipientFilter, entityTypeFilter],
        },
        data: { isRead: true },
      })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
