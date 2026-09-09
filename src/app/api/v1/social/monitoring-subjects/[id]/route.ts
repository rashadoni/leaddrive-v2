import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { archiveMonitoringSubject, updateMonitoringSubject } from "@/lib/social/monitoring-subjects"
import { monitoringSubjectSchema } from "@/lib/social/monitoring-subject-schema"

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withRlsAuth("social", "write", async (req: NextRequest, auth, ctx: RouteContext) => {
  const { id } = await ctx.params
  const parsed = monitoringSubjectSchema.partial().safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid subject" }, { status: 400 })
  try {
    const { sourceIds: _deprecatedSourceIds, ...subjectInput } = parsed.data
    void _deprecatedSourceIds
    const subject = await updateMonitoringSubject(auth.orgId, id, subjectInput)
    logAudit(auth.orgId, "update", "monitoring_subject", id, subject.name)
    return NextResponse.json({ success: true, data: subject })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update subject"
    return NextResponse.json({ error: message }, { status: message === "Monitoring subject not found" ? 404 : 400 })
  }
})

export const DELETE = withRlsAuth("social", "write", async (_req: NextRequest, auth, ctx: RouteContext) => {
  const { id } = await ctx.params
  try {
    await archiveMonitoringSubject(auth.orgId, id)
    logAudit(auth.orgId, "archive", "monitoring_subject", id, "archived")
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive subject"
    return NextResponse.json({ error: message }, { status: message === "Monitoring subject not found" ? 404 : 400 })
  }
})
