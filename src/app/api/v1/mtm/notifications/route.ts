import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, type RlsAuth } from "@/lib/with-rls"
import {
  isAgentInFieldScope,
  mtmAgentOutOfScopeResponse,
  mtmFieldScopeRequiredResponse,
  resolveMtmFieldScope,
  type MtmFieldScope,
} from "@/lib/mtm/field-access"
import { notificationDomainPredicate } from "@/lib/mtm/notification-domain"
import { productCapabilitiesForMixedSurface } from "@/lib/workforce-capability"

type NotificationIdRow = { id: string }
type NotificationCountRow = { count: number }

/**
 * Notifications are addressed to agents, so the web inbox follows the caller's
 * field scope (audit 2026-09-14): an agent sees their own, a manager or
 * supervisor their agents', an admin everyone's. Before, any `?agentId` was
 * accepted and the unfiltered list was the whole organization. API keys (no
 * session) stay organization-wide. Returns a response to send instead when the
 * caller has no scope.
 */
async function notificationScopePredicate(
  orgId: string,
  session: RlsAuth["session"],
): Promise<{ predicate: Prisma.Sql; scope: MtmFieldScope | null } | Response> {
  if (!session) return { predicate: Prisma.empty, scope: null }
  const scope = await resolveMtmFieldScope(prisma, {
    organizationId: orgId,
    userId: session.userId,
    webRole: session.role,
  })
  if (scope.kind === "none") return mtmFieldScopeRequiredResponse()
  if (scope.kind === "organization") return { predicate: Prisma.empty, scope }
  return { predicate: Prisma.sql`AND "agentId" IN (${Prisma.join(scope.agentIds)})`, scope }
}

// GET /api/v1/mtm/notifications?agentId=...&unreadOnly=true&limit=50
// Web admin / supervisor view.
export const GET = withRls(async (req, { orgId, session }) => {
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const unreadOnly = searchParams.get("unreadOnly") === "true"
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const scoped = await notificationScopePredicate(orgId, session)
    if (scoped instanceof Response) return scoped
    if (agentId && scoped.scope && !isAgentInFieldScope(scoped.scope, agentId)) return mtmAgentOutOfScopeResponse()
    const capabilities = await productCapabilitiesForMixedSurface(orgId, "MTM/notifications GET")
    const domainPredicate = notificationDomainPredicate(capabilities)
    const agentPredicate = agentId ? Prisma.sql`AND "agentId" = ${agentId}` : scoped.predicate
    const unreadPredicate = unreadOnly ? Prisma.sql`AND "isRead" = FALSE` : Prisma.empty
    const [idRows, unreadRows] = await Promise.all([
      prisma.$queryRaw<NotificationIdRow[]>`
        SELECT "id"
        FROM "mtm_notifications"
        WHERE "organizationId" = ${orgId}
          ${agentPredicate}
          ${unreadPredicate}
          AND ${domainPredicate}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT ${limit}
      `,
      prisma.$queryRaw<NotificationCountRow[]>`
        SELECT COUNT(*)::integer AS "count"
        FROM "mtm_notifications"
        WHERE "organizationId" = ${orgId}
          ${agentPredicate}
          AND "isRead" = FALSE
          AND ${domainPredicate}
      `,
    ])
    const ids = idRows.map((row) => row.id)
    const unorderedItems = ids.length > 0
      ? await prisma.mtmNotification.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          include: { agent: { select: { id: true, name: true } } },
        })
      : []
    const byId = new Map(unorderedItems.map((item) => [item.id, item]))
    const items = ids.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
    const unread = unreadRows[0]?.count ?? 0

    return NextResponse.json({ success: true, data: { items, unread } })
  } catch (e) {
    console.error("[MTM/notifications GET]", e)
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 })
  }
})

// PATCH /api/v1/mtm/notifications  body: { ids?: string[], isRead: boolean, all?: boolean }
// Mark a list (or all unread) as read/unread for the calling user's org.
export const PATCH = withRls(async (req, { orgId, session }) => {
  try {
    // Marking read is scoped like reading: `all: true` from a manager touches
    // only their agents' notifications, never another team's inbox.
    const scoped = await notificationScopePredicate(orgId, session)
    if (scoped instanceof Response) return scoped
    const body = await req.json()
    const isRead = !!body.isRead
    const capabilities = await productCapabilitiesForMixedSurface(orgId, "MTM/notifications PATCH")
    const domainPredicate = notificationDomainPredicate(capabilities)
    let targetPredicate: Prisma.Sql
    if (body.all === true) {
      targetPredicate = Prisma.sql`AND "isRead" = ${!isRead}`
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      if (ids.length === 0 || ids.length > 200) {
        return NextResponse.json({ error: "ids[] must contain 1-200 notification ids" }, { status: 400 })
      }
      targetPredicate = Prisma.sql`AND "id" IN (${Prisma.join(ids)})`
    } else {
      return NextResponse.json({ error: "Provide either ids[] or all:true" }, { status: 400 })
    }
    const updated = await prisma.$executeRaw`
      UPDATE "mtm_notifications"
      SET "isRead" = ${isRead}
      WHERE "organizationId" = ${orgId}
        AND ${domainPredicate}
        ${scoped.predicate}
        ${targetPredicate}
    `
    return NextResponse.json({ success: true, data: { updated } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to update notifications"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
