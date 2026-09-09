import { NextRequest, NextResponse } from "next/server"
import {
  SocialMonitoringRunJobError,
  cancelSocialMonitoringRunJob,
} from "@/lib/social/monitoring-run-job"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

type RouteCtx = { params: Promise<{ id: string }> }

export const POST = withSocialMonitoringMutationFence("social", "write", async (_request: NextRequest, auth, { params }: RouteCtx) => {
  const { id } = await params
  try {
    const data = await cancelSocialMonitoringRunJob(auth.orgId, id, auth.userId, auth.role)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof SocialMonitoringRunJobError) {
      return NextResponse.json({ error: error.code, ...error.details }, { status: error.status })
    }
    console.error("[social-monitoring-run-jobs/cancel] error", error)
    return NextResponse.json({ error: "social_monitoring_run_job_cancel_failed" }, { status: 500 })
  }
})
