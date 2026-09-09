import { NextRequest, NextResponse } from "next/server"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  disableWorkforceMobileWriteCohort,
  upsertWorkforceMobileWriteCohort,
  WorkforceMobileWriteCohortDisableSchema,
  WorkforceMobileWriteCohortUpsertSchema,
  WorkforceMobileWriteFenceError,
} from "@/lib/workforce/mobile-write-fence"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

function fenceErrorStatus(error: WorkforceMobileWriteFenceError): number {
  return error.code === "WORKFORCE_MOBILE_WRITE_FENCE_AGENT_NOT_FOUND"
    || error.code === "WORKFORCE_MOBILE_WRITE_FENCE_COHORT_NOT_FOUND"
    ? 404
    : 409
}

/**
 * PUT /api/v1/workforce/configuration/mobile-write-fence/cohorts
 *
 * An exact `(agentId, deviceId)` row is enabled or renewed. It is a server
 * selector for a controlled release, not an APK provenance/attestation claim.
 */
export const PUT = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceMobileWriteCohortUpsertSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce mobile write cohort" }, { status: 400 })
  }
  try {
    const cohort = await upsertWorkforceMobileWriteCohort({
      organizationId: auth.orgId,
      actorUserId: auth.userId,
      cohort: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { cohort } })
  } catch (error) {
    if (error instanceof WorkforceMobileWriteFenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: fenceErrorStatus(error) })
    }
    console.error("[workforce/configuration/mobile-write-fence/cohorts PUT]", error)
    return NextResponse.json({ error: "Failed to enable Workforce mobile write cohort" }, { status: 500 })
  }
})

/**
 * DELETE /api/v1/workforce/configuration/mobile-write-fence/cohorts
 *
 * Rows are disabled, never deleted, to preserve the release-control audit.
 * The final active row cannot be disabled while the tenant is cohort-only.
 */
export const DELETE = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceMobileWriteCohortDisableSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce mobile write cohort" }, { status: 400 })
  }
  try {
    const cohort = await disableWorkforceMobileWriteCohort({
      organizationId: auth.orgId,
      actorUserId: auth.userId,
      cohort: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { cohort } })
  } catch (error) {
    if (error instanceof WorkforceMobileWriteFenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: fenceErrorStatus(error) })
    }
    console.error("[workforce/configuration/mobile-write-fence/cohorts DELETE]", error)
    return NextResponse.json({ error: "Failed to disable Workforce mobile write cohort" }, { status: 500 })
  }
})
