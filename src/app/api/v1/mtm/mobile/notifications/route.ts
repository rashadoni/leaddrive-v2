import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { notificationDomainPredicate } from "@/lib/mtm/notification-domain"

type MobileNotificationRow = {
  id: string
  organizationId: string
  agentId: string
  title: string
  body: string | null
  type: string
  isRead: boolean
  metadata: Prisma.JsonValue | null
  createdAt: Date
}

// GET /api/v1/mtm/mobile/notifications
// Returns this agent's own notifications + unread count.
export const GET = withMobileRls(async (req: NextRequest, auth) => {
  try {
    const domainPredicate = notificationDomainPredicate(auth.tenantCapabilities)
    const [items, unreadRows] = await Promise.all([
      prisma.$queryRaw<MobileNotificationRow[]>`
        SELECT
          "id", "organizationId", "agentId", "title", "body", "type",
          "isRead", "metadata", "createdAt"
        FROM "mtm_notifications"
        WHERE "organizationId" = ${auth.orgId}
          AND "agentId" = ${auth.agentId}
          AND ${domainPredicate}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 100
      `,
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::integer AS "count"
        FROM "mtm_notifications"
        WHERE "organizationId" = ${auth.orgId}
          AND "agentId" = ${auth.agentId}
          AND "isRead" = FALSE
          AND ${domainPredicate}
      `,
    ])
    const unread = unreadRows[0]?.count ?? 0
    return NextResponse.json({ success: true, data: { items, unread } })
  } catch (e) {
    console.error("[MTM/mobile/notifications GET]", e)
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 })
  }
})

// PATCH /api/v1/mtm/mobile/notifications  body: { ids?: string[], all?: boolean, isRead: boolean }
export const PATCH = withMobileRls(async (req: NextRequest, auth) => {
  try {
    const body = await req.json()
    const isRead = !!body.isRead
    const domainPredicate = notificationDomainPredicate(auth.tenantCapabilities)
    let targetPredicate: Prisma.Sql
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      if (ids.length === 0 || ids.length > 100) {
        return NextResponse.json({ error: "ids[] must contain 1-100 notification ids" }, { status: 400 })
      }
      targetPredicate = Prisma.sql`AND "id" IN (${Prisma.join(ids)})`
    } else if (body.all !== true) {
      return NextResponse.json({ error: "Provide either ids[] or all:true" }, { status: 400 })
    } else {
      targetPredicate = Prisma.sql`AND "isRead" = ${!isRead}`
    }
    const updated = await prisma.$executeRaw`
      UPDATE "mtm_notifications"
      SET "isRead" = ${isRead}
      WHERE "organizationId" = ${auth.orgId}
        AND "agentId" = ${auth.agentId}
        AND ${domainPredicate}
        ${targetPredicate}
    `
    return NextResponse.json({ success: true, data: { updated } })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to update notifications"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
