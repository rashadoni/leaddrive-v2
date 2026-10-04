import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionPolicyConfigurationAuth } from "@/lib/with-workforce-rls-auth"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }
/** Named bounded choices for comparison. No definition, employee or writer payload is returned. */
export const GET = withWorkforceSessionPolicyConfigurationAuth(async (req: NextRequest, auth) => {
  const query = req.nextUrl.searchParams, q = query.get("q")?.trim() ?? ""
  if (q.length < 2 || q.length > 100 || /[\u0000-\u001f]/u.test(q)
    || query.getAll("q").length !== 1 || Array.from(query.keys()).some(key => key !== "q")) {
    return NextResponse.json({ error: "Enter between two and 100 characters of a policy name.", code: "WORKFORCE_POLICY_SEARCH_INPUT_INVALID" }, { status: 400, headers })
  }
  try {
    const rows = await prisma.workforcePolicy.findMany({
      where: { organizationId: auth.orgId, name: { contains: q, mode: "insensitive" } },
      orderBy: [{ version: "desc" }, { id: "asc" }], take: 21,
      select: { id: true, name: true, version: true, status: true, teamId: true, team: { select: { name: true } } },
    })
    return NextResponse.json({ success: true, data: { policies: rows.slice(0, 20), query: q, limit: 20, hasMore: rows.length > 20 } }, { headers })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "configuration-policy-version-search" })
    return NextResponse.json({ error: "Unable to find policy versions.", code: "WORKFORCE_POLICY_SEARCH_UNAVAILABLE" }, { status: 503, headers })
  }
})
