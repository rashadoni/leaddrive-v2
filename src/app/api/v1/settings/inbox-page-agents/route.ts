import { NextResponse } from "next/server"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { listPageAgents } from "@/lib/inbox/page-agent-settings"

/**
 * GET /api/v1/settings/inbox-page-agents — every page the inbox AI answers on, with its own agent (or
 * none), whether and when the AI answers there, and its own working hours (or none).
 * Admin only, like the reply matrix it sits beside: an agent's rules and knowledge are settings.
 */
export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  return NextResponse.json({ data: await listPageAgents(auth.orgId) })
})
