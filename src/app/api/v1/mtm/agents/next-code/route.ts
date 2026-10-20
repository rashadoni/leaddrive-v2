/**
 * GET /api/v1/mtm/agents/next-code
 *
 * The code the next agent saved without one will get — shown in the agent
 * form's empty «External code» field, so the person filling it sees the code
 * before saving. Nothing is reserved: the code is drawn again at the save
 * (`writeWithMtmAgentCode`), and two forms open at once may show the same one.
 *
 * Asked by whoever may create or edit agent cards on the web.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { resolveMtmAgentAdministration } from "@/lib/mtm/agent-administration"
import { nextMtmAgentCodeFor } from "@/lib/mtm/agent-external-code"

export const GET = withRls(async (_req, auth) => {
  try {
    const administration = await resolveMtmAgentAdministration(prisma, auth)
    if (administration.kind === "denied") return administration.response
    const code = await nextMtmAgentCodeFor(prisma, auth.orgId)
    return NextResponse.json({ success: true, data: { code } }, { headers: { "cache-control": "private, no-store" } })
  } catch (e) {
    console.error("[MTM/agents/next-code GET]", e)
    return NextResponse.json({ error: "Failed to load the next code" }, { status: 500 })
  }
})
