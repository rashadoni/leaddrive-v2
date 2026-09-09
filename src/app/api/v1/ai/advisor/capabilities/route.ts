import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { getAdvisorOrgContext } from "@/lib/ai/advisor/service"
import { buildAdvisorCapabilities } from "@/lib/ai/advisor/capabilities"

export const GET = withRlsAuth("ai", "read", async (_req, auth) => {
  const org = await getAdvisorOrgContext(auth.orgId)
  return NextResponse.json({ data: buildAdvisorCapabilities(org, auth.role) })
})
