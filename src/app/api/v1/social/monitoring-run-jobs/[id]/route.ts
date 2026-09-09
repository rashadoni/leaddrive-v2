import { NextRequest, NextResponse } from "next/server"
import { getSocialMonitoringRunJob } from "@/lib/social/monitoring-run-job"
import { withRlsAuth } from "@/lib/with-rls"

type RouteCtx = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("social", "read", async (_request: NextRequest, auth, { params }: RouteCtx) => {
  const { id } = await params
  const data = await getSocialMonitoringRunJob(auth.orgId, id)
  if (!data) return NextResponse.json({ error: "social_monitoring_run_job_not_found" }, { status: 404 })
  return NextResponse.json({ success: true, data })
})
