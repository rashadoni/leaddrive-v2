import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  createMonitoringSubject,
  listMonitoringSubjects,
} from "@/lib/social/monitoring-subjects"
import { monitoringSubjectSchema } from "@/lib/social/monitoring-subject-schema"

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const subjects = await listMonitoringSubjects(auth.orgId)
  return NextResponse.json({
    success: true,
    data: {
      subjects,
      stats: {
        total: subjects.length,
        active: subjects.filter((subject: { status: string }) => subject.status === "active").length,
        brands: subjects.filter((subject: { type: string }) => subject.type === "BRAND").length,
        people: subjects.filter((subject: { type: string }) => subject.type === "PERSON").length,
      },
    },
  })
})

export const POST = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = monitoringSubjectSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid subject" }, { status: 400 })
  try {
    const { sourceIds: _deprecatedSourceIds, ...subjectInput } = parsed.data
    void _deprecatedSourceIds
    const subject = await createMonitoringSubject(auth.orgId, auth.userId, subjectInput)
    logAudit(auth.orgId, "create", "monitoring_subject", subject.id, subject.name)
    return NextResponse.json({ success: true, data: subject }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create subject" }, { status: 400 })
  }
})
