import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { listMediaDashboard, submitDiscoveryLead } from "@/lib/social/media-observations"
import { discoveryLeadSchema } from "@/lib/social/media-schema"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

const MEDIA_SENTIMENTS = new Set(["negative", "neutral", "positive", "unknown"])

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const requestedSentiment = req.nextUrl.searchParams.get("sentiment")?.trim() || undefined
  if (requestedSentiment && !MEDIA_SENTIMENTS.has(requestedSentiment)) {
    return NextResponse.json({ error: "Invalid sentiment filter" }, { status: 400 })
  }
  return NextResponse.json({
    success: true,
    data: await listMediaDashboard(auth.orgId, {
      sentiment: requestedSentiment as "negative" | "neutral" | "positive" | "unknown" | undefined,
    }),
  })
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const parsed = discoveryLeadSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid discovery lead" }, { status: 400 })
  try {
    const result = await submitDiscoveryLead(auth.orgId, auth.userId, parsed.data)
    await logAudit(auth.orgId, "create", "social_discovery_lead", result.lead.id, result.lead.canonicalUrl)
    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create discovery lead" }, { status: 400 })
  }
})
