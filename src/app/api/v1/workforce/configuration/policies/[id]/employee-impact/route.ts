import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import { WorkforcePolicyEmployeeImpactError } from "@/lib/workforce/policy-employee-impact-preview"
import { WorkforcePolicyWindowPreviewError } from "@/lib/workforce/policy-future-window-preview"
import { readWorkforcePolicyEmployeeImpact } from "@/lib/workforce/policy-employee-impact-read"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

type RouteContext = { params: Promise<{ id: string }> }
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }

export const GET = withWorkforceSessionPolicyConfigurationAuth<RouteContext>(async (req: NextRequest, auth, { params }) => {
  const { id } = await params
  if (typeof id !== "string" || !id.trim() || id.length > 191 || /[\u0000-\u001f]/u.test(id)
    || Array.from(req.nextUrl.searchParams).length !== 0) {
    return NextResponse.json({ error: "Choose a future policy draft.", code: "WORKFORCE_POLICY_IMPACT_INPUT_INVALID" }, { status: 400, headers })
  }
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`
      return readWorkforcePolicyEmployeeImpact(tx, { organizationId: auth.orgId, policyId: id, observedAt: new Date() })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5_000, timeout: 15_000 })
    if (!result) return NextResponse.json({ error: "The requested policy draft is unavailable.", code: "WORKFORCE_POLICY_IMPACT_NOT_FOUND" }, { status: 404, headers })
    return NextResponse.json({ success: true, data: { preview: result } }, { headers })
  } catch (error) {
    if (error instanceof WorkforcePolicyEmployeeImpactError || error instanceof WorkforcePolicyWindowPreviewError) {
      return NextResponse.json({ error: "Employee impact cannot be projected from these recorded facts.", code: error.code }, { status: 409, headers })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-policy-employee-impact-preview" })
    return NextResponse.json({ error: "Unable to preview employee policy impact.", code: "WORKFORCE_POLICY_IMPACT_UNAVAILABLE" }, { status: 503, headers })
  }
})
