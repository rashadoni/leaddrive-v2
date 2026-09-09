import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { notificationDomainPredicate } from "@/lib/mtm/notification-domain"
import { productCapabilitiesForMixedSurface } from "@/lib/workforce-capability"

type NotificationIdRow = { id: string }
type NotificationCountRow = { count: number }

// GET /api/v1/mtm/notifications?agentId=...&unreadOnly=true&limit=50
// Web admin / supervisor view.
export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get("agentId") || ""
  const unreadOnly = searchParams.get("unreadOnly") === "true"
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const capabilities = await productCapabilitiesForMixedSurface(orgId, "MTM/notifications GET")
    const domainPredicate = notificationDomainPredicate(capabilities)
    const agentPredicate = agentId ? Prisma.sql`AND "agentId" = ${agentId}` : Prisma.empty
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
export const PATCH = withRls(async (req, { orgId }) => {
  try {
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
        ${targetPredicate}
    `
    return NextResponse.json({ success: true, data: { updated } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to update notifications"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
