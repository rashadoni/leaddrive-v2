import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { mtmAppLanguage } from "@/lib/mtm/agent-language"

/**
 * PUT /api/v1/mtm/mobile/language  body: { language: "az" | "ru" | "en" }
 * The phone app tells which language it shows, after sign-in and when the
 * agent switches it; text written for him then uses it (agent-language.ts).
 */
export const PUT = withMobileRls(async (req, auth) => {
  const body = await req.json().catch(() => null) as { language?: unknown } | null
  const language = mtmAppLanguage(body?.language)
  if (!language) return NextResponse.json({ error: "language must be az, ru or en", code: "MTM_APP_LANGUAGE_INVALID" }, { status: 400 })
  const updated = await prisma.mtmAgent.updateMany({
    where: { id: auth.agentId, organizationId: auth.orgId },
    data: { appLanguage: language },
  })
  if (updated.count === 0) return NextResponse.json({ error: "Agent not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: { language } })
})
