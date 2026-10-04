import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import { WorkforcePolicyWindowPreviewError } from "@/lib/workforce/policy-future-window-preview"
import { readWorkforcePolicyFutureWindow } from "@/lib/workforce/policy-future-window-read"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

type RouteContext = { params: Promise<{ id: string }> }
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }

/** Read a future draft and its complete bounded scope in one repeatable-read snapshot. */
export const GET = withWorkforceSessionPolicyConfigurationAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  const { id } = await params
  if (typeof id !== "string" || !id.trim() || id.length > 191 || /[\u0000-\u001f]/u.test(id)
    || Array.from(req.nextUrl.searchParams).length !== 0) {
    return NextResponse.json({ error: "Choose a policy draft.", code: "WORKFORCE_POLICY_WINDOW_INPUT_INVALID" }, { status: 400, headers })
  }
  try {
    const result = await prisma.$transaction((tx: Prisma.TransactionClient) => readWorkforcePolicyFutureWindow(tx, {
      organizationId: auth.orgId, policyId: id, observedAt: new Date(),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
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
