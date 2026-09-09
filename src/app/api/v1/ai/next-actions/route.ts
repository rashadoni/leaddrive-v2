import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { generateNextBestActions } from "@/lib/ai/next-best-action"
import { getOrgModuleContext } from "@/lib/api-auth"
import { canRead } from "@/lib/permissions"
import { hasModule } from "@/lib/modules"

export const GET = withRlsAuth("ai", "read", async (req, auth) => {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "10")

  try {
    const orgCtx = await getOrgModuleContext(auth.orgId)
    const actions = await generateNextBestActions(auth.orgId, auth.userId, limit, {
      role: auth.role,
      deals: canRead(auth.role, "deals") && hasModule(orgCtx, "sales"),
      leads: canRead(auth.role, "leads") && hasModule(orgCtx, "sales"),
      tasks: canRead(auth.role, "tasks") && hasModule(orgCtx, "crm"),
      tickets: canRead(auth.role, "tickets") && hasModule(orgCtx, "support"),
    })
    return NextResponse.json({ success: true, data: actions })
  } catch (e: any) {
    console.error("Next actions error:", e)
    return NextResponse.json({ error: "Failed to generate actions" }, { status: 500 })
  }
})
