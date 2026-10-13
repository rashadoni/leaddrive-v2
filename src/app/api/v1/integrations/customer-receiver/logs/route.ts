import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { utcTime } from "@/lib/integrations/customer-receiver/contract"
import { BUILDER_AUDIT_ACTIONS, exportBuilderAudit, type BuilderAuditRow } from "@/lib/integrations/customer-receiver/constructor/audit-export"

export const GET = withRlsSessionAuth(async (request, session) => {
  if (session.role !== "admin" && session.role !== "superadmin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const query = new URL(request.url).searchParams
  let from: string, to: string
  const environment = query.get("environment")
  try {
    from = utcTime(query.get("from")); to = utcTime(query.get("to"))
    if (environment !== "TEST" && environment !== "PROD") throw new Error("invalid_environment")
    const length = Date.parse(to) - Date.parse(from)
    if (length <= 0 || length > 31 * 86400 * 1000) throw new Error("invalid_interval")
  } catch { return NextResponse.json({ error: "Use a UTC interval of up to 31 days and TEST or PROD" }, { status: 400 }) }
  try {
    const rows: BuilderAuditRow[] = await prisma.auditLog.findMany({
      where: { organizationId: session.orgId, entityType: "receiver_draft", action: { in: [...BUILDER_AUDIT_ACTIONS] }, createdAt: { gte: new Date(from), lt: new Date(to) }, newValue: { path: ["environment"], equals: environment } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5001,
      select: { id: true, organizationId: true, userId: true, action: true, entityType: true, entityId: true, createdAt: true, newValue: true },
    })
    if (rows.length > 5000) return NextResponse.json({ error: "Reduce the interval: package exceeds 5000 records" }, { status: 413 })
    const generatedAt = new Date().toISOString()
    const result = exportBuilderAudit({ organizationId: session.orgId, environment, from, to, generatedAt, rows })
    // Audit availability is required before the authorized export is released.
    await prisma.auditLog.create({ data: { organizationId: session.orgId, userId: session.userId, action: "receiver_draft_logs_exported", entityType: "receiver_draft", newValue: { environment, from, to, records: rows.length, manifestHash: result.manifest.files[0].sha256 } } })
    return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "no-store" } })
  } catch { return NextResponse.json({ error: "Security export unavailable" }, { status: 503 }) }
})
