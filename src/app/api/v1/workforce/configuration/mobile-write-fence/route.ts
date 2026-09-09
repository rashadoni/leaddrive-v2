import { NextRequest, NextResponse } from "next/server"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  getWorkforceMobileWriteFenceConfiguration,
  setWorkforceMobileWriteFence,
  WorkforceMobileWriteFenceError,
  WorkforceMobileWriteFenceUpdateSchema,
} from "@/lib/workforce/mobile-write-fence"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

function isMissingFenceSchema(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2021"
}

/**
 * GET /api/v1/workforce/configuration/mobile-write-fence
 *
 * Lists only the tenant-local release posture and enrolled device cohort. It
 * is session-admin-only because seeing or changing an enrolled device is not
 * an integration/API-key concern.
 */
export const GET = withWorkforceSessionAdminAuth(async (_req: NextRequest, auth) => {
  try {
    const configuration = await getWorkforceMobileWriteFenceConfiguration(auth.orgId)
    return NextResponse.json({ success: true, data: configuration })
  } catch (error) {
    if (isMissingFenceSchema(error)) {
      return NextResponse.json({
        error: "The Workforce mobile write fence schema is not available yet.",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_UNAVAILABLE",
      }, { status: 503 })
    }
    console.error("[workforce/configuration/mobile-write-fence GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce mobile write fence" }, { status: 500 })
  }
})

/**
 * PUT /api/v1/workforce/configuration/mobile-write-fence
 *
 * `COHORT_ONLY` is refused until an active server-side cohort row exists;
 * `FROZEN` is the immediate, auditable rollback posture. No tenant is changed
 * by the additive migration or by merely reading this endpoint.
 */
export const PUT = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceMobileWriteFenceUpdateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce mobile write fence" }, { status: 400 })
  }
  try {
    const fence = await setWorkforceMobileWriteFence({
      organizationId: auth.orgId,
      actorUserId: auth.userId,
      update: parsed.data,
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { fence } })
  } catch (error) {
    if (error instanceof WorkforceMobileWriteFenceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    if (isMissingFenceSchema(error)) {
      return NextResponse.json({
        error: "The Workforce mobile write fence schema is not available yet.",
        code: "WORKFORCE_MOBILE_WRITE_FENCE_UNAVAILABLE",
      }, { status: 503 })
    }
    console.error("[workforce/configuration/mobile-write-fence PUT]", error)
    return NextResponse.json({ error: "Failed to update Workforce mobile write fence" }, { status: 500 })
  }
})
