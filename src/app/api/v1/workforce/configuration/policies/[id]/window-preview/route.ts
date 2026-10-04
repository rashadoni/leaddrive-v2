import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import {
  previewWorkforcePolicyFutureWindow,
  WorkforcePolicyWindowPreviewError,
  WORKFORCE_POLICY_WINDOW_LIMIT,
} from "@/lib/workforce/policy-future-window-preview"
import type { WorkforcePolicyComparisonRecord } from "@/lib/workforce/policy-version-comparison"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

type RouteContext = { params: Promise<{ id: string }> }
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }
const select = { id: true, organizationId: true, teamId: true, version: true, status: true, name: true,
  effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true } as const

/** Read a future draft and its complete bounded scope in one repeatable-read snapshot. */
export const GET = withWorkforceSessionPolicyConfigurationAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  const { id } = await params
  if (typeof id !== "string" || !id.trim() || id.length > 191 || /[\u0000-\u001f]/u.test(id)
    || Array.from(req.nextUrl.searchParams).length !== 0) {
    return NextResponse.json({ error: "Choose a policy draft.", code: "WORKFORCE_POLICY_WINDOW_INPUT_INVALID" }, { status: 400, headers })
  }
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const draft: WorkforcePolicyComparisonRecord | null = await tx.workforcePolicy.findFirst({
        where: { id, organizationId: auth.orgId }, select,
      })
      if (!draft) return null
      const timezoneSetting: { value: unknown } | null = await tx.mtmSetting.findFirst({
        where: { organizationId: auth.orgId, key: "timezone" }, select: { value: true },
      })
      // Same string/default/invalid->UTC rules as the existing canonical activation route.
      const configuredTimezone = typeof timezoneSetting?.value === "string" ? timezoneSetting.value : MTM_SETTING_DEFAULTS.timezone
      const timezone = isValidTimezone(configuredTimezone) ? configuredTimezone : "UTC"
      const observedAt = new Date()
      const published: WorkforcePolicyComparisonRecord[] = await tx.workforcePolicy.findMany({
        where: { organizationId: auth.orgId, teamId: draft.teamId, status: "ACTIVE" }, select,
        orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }], take: WORKFORCE_POLICY_WINDOW_LIMIT + 1,
      })
      return { ...previewWorkforcePolicyFutureWindow({ organizationId: auth.orgId,
        currentDate: currentDateKey(observedAt, timezone), draft, published }), timezone, observedAt: observedAt.toISOString() }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    if (!result) return NextResponse.json({ error: "The requested policy draft is unavailable.", code: "WORKFORCE_POLICY_WINDOW_NOT_FOUND" }, { status: 404, headers })
    return NextResponse.json({ success: true, data: { preview: result } }, { headers })
  } catch (error) {
    if (error instanceof WorkforcePolicyWindowPreviewError) {
      return NextResponse.json({ error: "A future window cannot be projected from these recorded policies.", code: error.code }, { status: 409, headers })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-policy-future-window-preview" })
    return NextResponse.json({ error: "Unable to preview this policy window.", code: "WORKFORCE_POLICY_WINDOW_UNAVAILABLE" }, { status: 503, headers })
  }
})
