import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import {
  SOCIAL_MONITORING_RUN_JOB_KINDS,
  SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES,
  SocialMonitoringRunJobError,
  createSocialMonitoringRunJob,
  getLatestSocialMonitoringRunJob,
  type SocialMonitoringRunJobKind,
} from "@/lib/social/monitoring-run-job"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

const createSchema = z.object({
  kind: z.enum(SOCIAL_MONITORING_RUN_JOB_KINDS),
  sourceScope: z.enum(SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES).optional(),
  fullArchiveConfirmed: z.literal(true).optional(),
  paidConfirmed: z.literal(true).optional(),
  sharedConfirmed: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === "PROFILE_FULL" && value.sourceScope) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope"],
      message: "sourceScope is incompatible with PROFILE_FULL",
    })
  }
  if (value.kind !== "PROFILE_FULL" && !value.sourceScope) {
    context.addIssue({
      code: "custom",
      path: ["sourceScope"],
      message: "sourceScope is required for watchlist jobs",
    })
  }
})

function errorResponse(error: unknown) {
  if (error instanceof SocialMonitoringRunJobError) {
    return NextResponse.json({ error: error.code, ...error.details }, { status: error.status })
  }
  console.error("[social-monitoring-run-jobs] error", error)
  return NextResponse.json({ error: "social_monitoring_run_job_failed" }, { status: 500 })
}

function idempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get("idempotency-key")?.trim()
  if (!value) return null
  if (value.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(value)) return null
  return value
}

export const GET = withRlsAuth("social", "read", async (request: NextRequest, auth) => {
  const rawKind = request.nextUrl.searchParams.get("kind")?.trim()
  const rawSourceScope = request.nextUrl.searchParams.get("sourceScope")?.trim()
  if (rawKind && !SOCIAL_MONITORING_RUN_JOB_KINDS.includes(rawKind as SocialMonitoringRunJobKind)) {
    return NextResponse.json({ error: "kind is invalid" }, { status: 400 })
  }
  if (
    rawSourceScope
    && !SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES.includes(
      rawSourceScope as typeof SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES[number],
    )
  ) {
    return NextResponse.json({ error: "sourceScope is invalid" }, { status: 400 })
  }
  if (rawSourceScope && (!rawKind || rawKind === "PROFILE_FULL")) {
    return NextResponse.json({ error: "sourceScope is incompatible with kind" }, { status: 400 })
  }
  const data = await getLatestSocialMonitoringRunJob(
    auth.orgId,
    rawKind as SocialMonitoringRunJobKind | undefined,
    rawSourceScope as typeof SOCIAL_MONITORING_RUN_JOB_SOURCE_SCOPES[number] | undefined,
  )
  return NextResponse.json({ success: true, data })
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (request: NextRequest, auth) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid monitoring run job" },
      { status: 400 },
    )
  }
  const requestKey = idempotencyKey(request)
  if (!requestKey) {
    return NextResponse.json({ error: "Idempotency-Key is required and must be valid" }, { status: 400 })
  }
  try {
    const data = await createSocialMonitoringRunJob({
      organizationId: auth.orgId,
      requestedBy: auth.userId,
      requestedByRole: auth.role,
      idempotencyKey: requestKey,
      ...parsed.data,
    })
    return NextResponse.json({ success: true, data }, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
})
