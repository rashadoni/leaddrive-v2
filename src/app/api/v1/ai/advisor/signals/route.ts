import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { filterAdvisorPayload, getAdvisorPayload } from "@/lib/ai/advisor/service"
import type { AdvisorDomainKey, AdvisorPayload, AdvisorSeverity } from "@/lib/ai/advisor/types"

function applyFilters(payload: AdvisorPayload, req: NextRequest): AdvisorPayload {
  const params = req.nextUrl.searchParams
  return filterAdvisorPayload(payload, {
    entityType: params.get("entityType"),
    entityId: params.get("entityId"),
    domain: params.get("domain") as AdvisorDomainKey | null,
    severity: params.get("severity") as AdvisorSeverity | null,
  })
}

export const GET = withRlsAuth("ai", "read", async (req: NextRequest, auth) => {
  const payload = await getAdvisorPayload(auth.orgId, auth.role, auth.userId)
  return NextResponse.json({ data: applyFilters(payload, req) })
})
