import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { pollTwitterAccount } from "@/lib/social/twitter-poller"
import { pollTikTokAccount } from "@/lib/social/tiktok-poller"
import { pollYouTubeAccount } from "@/lib/social/youtube-poller"
import { pollVkAccount } from "@/lib/social/vk-poller"
import { scanTelegramForOrg } from "@/lib/social/telegram-scanner"
import { pollFacebookAccount, pollInstagramAccount } from "@/lib/social/facebook-poller"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"

export const POST = withRlsAuth("social", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const account = await prisma.socialAccount.findFirst({ where: { id, organizationId: orgId } })
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!["twitter", "tiktok", "youtube", "vkontakte", "telegram", "facebook", "instagram"].includes(account.platform)) {
    return NextResponse.json(
      { error: `Polling for ${account.platform} uses webhook delivery — POST to /api/v1/webhooks/meta-social instead.` },
      { status: 501 },
    )
  }

  const fenced = await withSocialMonitoringTenantCollectionFence(orgId, async () => {
    switch (account.platform) {
      case "twitter":
        return pollTwitterAccount(account.id)
      case "tiktok":
        return pollTikTokAccount(account.id)
      case "youtube":
        return pollYouTubeAccount(account.id)
      case "vkontakte":
        return pollVkAccount(account.id)
      case "telegram":
        return scanTelegramForOrg(orgId)
      case "facebook":
        return pollFacebookAccount(account.id)
      case "instagram":
        return pollInstagramAccount(account.id)
      default:
        return { ingested: 0, error: "unsupported_platform" }
    }
  })
  if (!fenced.allowed) {
    return NextResponse.json({ success: false, error: fenced.reason }, { status: 409 })
  }
  const result: { ingested: number; error?: string } = fenced.value
  return NextResponse.json({ success: !result.error, data: result })
})
