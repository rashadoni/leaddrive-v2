import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/permissions"

type RouteContext = { params: Promise<{ id: string }> }

const LIMIT = 500

/**
 * What one reviewer opened: the newest reads first, straight from the
 * append-only compliance_audit_log (written by src/lib/audit/reviewer-read-log.ts).
 */
export const GET = withRlsSessionAuth<RouteContext>(async (_req, auth, { params }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const grant = await prisma.reviewerAccessGrant.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { userId: true },
  })
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const rows = await prisma.complianceAuditLog.findMany({
    where: { organizationId: auth.orgId, userId: grant.userId },
    orderBy: { occurredAt: "desc" },
    take: LIMIT,
    select: { id: true, occurredAt: true, recordTable: true, recordId: true, ipAddress: true, metadata: true },
  })
  return NextResponse.json({
    success: true,
    data: rows.map((row: { id: string; occurredAt: Date; recordTable: string; recordId: string | null; ipAddress: string | null; metadata: unknown }) => {
      const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>
      return {
        id: row.id,
        occurredAt: row.occurredAt,
        section: row.recordTable,
        recordId: row.recordId,
        kind: typeof meta.kind === "string" ? meta.kind : "list",
        path: typeof meta.path === "string" ? meta.path : null,
        query: typeof meta.query === "string" ? meta.query : null,
        ipAddress: row.ipAddress,
      }
    }),
    limit: LIMIT,
  })
})
