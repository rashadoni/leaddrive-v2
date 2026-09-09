import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteFieldWebRlsAuth("read", async (_req, auth, context: RouteContext) => {
  const access = await resolveMtmExcelAccess(prisma, auth)
  if (!access.actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await context.params
  const job = await prisma.mtmImportJob.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { rowErrors: { orderBy: [{ rowNumber: "asc" }, { columnName: "asc" }], take: 500 } },
  })
  if (!job) return NextResponse.json({ error: "Import job not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { job, capabilities: { canApply: access.canImport && job.status === "READY" && job.errorRows === 0 } } })
})
