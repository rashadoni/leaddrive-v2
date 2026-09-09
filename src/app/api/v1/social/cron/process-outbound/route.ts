import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { processOutboundSocialReplies, reconcileOutboundSocialReplies } from "@/lib/social/outbound-worker"

export async function POST(req: NextRequest) {
  const authError = requireCronAuth(req)
  if (authError) return authError
  const requestedLimit = Number(new URL(req.url).searchParams.get("limit") ?? "20")
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20
  const data = await runWithRlsBypass(async () => ({
    processed: await processOutboundSocialReplies({ limit }),
    reconciled: await reconcileOutboundSocialReplies({ limit }),
  }))
  return NextResponse.json({ success: true, data })
}
