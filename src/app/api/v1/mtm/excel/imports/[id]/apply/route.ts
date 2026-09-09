import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"
import { applyMtmExcelImportJob, isMtmValidatedExcelSnapshot } from "@/lib/mtm/excel-import"
import { getQueue } from "@/lib/queue/queues"

type RouteContext = { params: Promise<{ id: string }> }
const INLINE_ROW_LIMIT = 5_000

export const POST = withRouteFieldWebRlsAuth("write", async (req, auth, context: RouteContext) => {
  const access = await resolveMtmExcelAccess(prisma, auth)
  if (!access.actor || !access.canImport) return NextResponse.json({ error: "Excel import is not permitted" }, { status: 403 })
  const { id } = await context.params
  const body = await req.json().catch(() => ({})) as { allowConflictOverride?: boolean }
  const allowConflictOverride = body.allowConflictOverride === true
  if (allowConflictOverride && access.actor.role !== "ADMIN" && access.actor.role !== "MANAGER" && access.actor.role !== "SUPERVISOR") {
    return NextResponse.json({ error: "Conflict override requires manager authority" }, { status: 403 })
  }
  const job = await prisma.mtmImportJob.findFirst({ where: { id, organizationId: auth.orgId } })
  if (!job) return NextResponse.json({ error: "Import job not found" }, { status: 404 })
  const snapshot = job.validatedSnapshot
  if (!isMtmValidatedExcelSnapshot(snapshot)) return NextResponse.json({ error: "Validated snapshot is unavailable" }, { status: 409 })

  if (snapshot.summary.totalRows > INLINE_ROW_LIMIT) {
    const queue = getQueue("mtm-import")
    if (!queue) {
      return NextResponse.json({
        error: "Large imports require the background worker",
        code: "MTM_IMPORT_WORKER_UNAVAILABLE",
        jobId: id,
      }, { status: 503 })
    }
    await queue.add("apply", {
      organizationId: auth.orgId,
      jobId: id,
      requestedBy: auth.userId,
      allowConflictOverride,
    }, { jobId: `mtm-import-${id}` })
    return NextResponse.json({ success: true, data: { jobId: id, queued: true } }, { status: 202 })
  }

  try {
    const result = await applyMtmExcelImportJob({
      db: prisma,
      organizationId: auth.orgId,
      jobId: id,
      requestedBy: auth.userId,
      allowConflictOverride,
    })
    return NextResponse.json({ success: true, data: { jobId: id, queued: false, ...result } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import apply failed", jobId: id }, { status: 409 })
  }
})
