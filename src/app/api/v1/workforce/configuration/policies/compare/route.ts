import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import { compareWorkforcePolicyVersions, WorkforcePolicyComparisonError } from "@/lib/workforce/policy-version-comparison"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }
const identifier = (value: string | null): value is string => value !== null && value.trim().length > 0 && value.length <= 191 && !/[\u0000-\u001f]/u.test(value)
const select = {
  id: true, organizationId: true, teamId: true, version: true, status: true, name: true,
  effectiveFrom: true, effectiveTo: true, definition: true, definitionHash: true,
} as const

/** Bounded same-scope administrative read. No employee, workday, snapshot or policy mutation. */
export const GET = withWorkforceSessionPolicyConfigurationAuth(async (req: NextRequest, auth) => {
  const query = req.nextUrl.searchParams, from = query.get("from"), to = query.get("to")
  if (!identifier(from) || !identifier(to) || from === to
    || query.getAll("from").length !== 1 || query.getAll("to").length !== 1
    || Array.from(query.keys()).some(key => key !== "from" && key !== "to")) {
    return NextResponse.json({ error: "Choose two distinct policy versions.", code: "WORKFORCE_POLICY_COMPARISON_INPUT_INVALID" }, { status: 400, headers })
  }
  try {
    // One SELECT observes both versions at one statement snapshot. Exact tenant predicate is mandatory.
    const records = await prisma.workforcePolicy.findMany({
      where: { organizationId: auth.orgId, id: { in: [from, to] } }, select, take: 2,
    })
    const before = records.find(record => record.id === from), after = records.find(record => record.id === to)
    if (!before || !after) {
      return NextResponse.json({ error: "The requested policy versions are unavailable.", code: "WORKFORCE_POLICY_COMPARISON_NOT_FOUND" }, { status: 404, headers })
    }
    const comparison = compareWorkforcePolicyVersions({ organizationId: auth.orgId, from: before, to: after })
    return NextResponse.json({ success: true, data: { comparison } }, { headers })
  } catch (error) {
    if (error instanceof WorkforcePolicyComparisonError) {
      return NextResponse.json({ error: "These policy versions cannot be compared safely.", code: error.code }, { status: 409, headers })
    }
    logWorkforceSensitiveOperationFailure({ operation: "configuration-policy-version-comparison" })
    return NextResponse.json({ error: "Unable to compare policy versions.", code: "WORKFORCE_POLICY_COMPARISON_UNAVAILABLE" }, { status: 503, headers })
  }
})
