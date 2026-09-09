import { NextResponse } from "next/server"
import { withSocialConnectAuth } from "@/lib/social/oauth-access"
import { getTenantMetaApp, getTenantInstagramLoginApp } from "@/lib/social/tenant-meta-app"

/**
 * Which social OAuth providers are actually connectable for THIS tenant —
 * i.e. their start route would begin a real authorize flow instead of
 * erroring with "not configured".
 *
 * Mirrors each start route's own requirements exactly (keep in sync):
 *  - facebook:  (tenant Meta app OR FACEBOOK_APP_ID) + FACEBOOK_REDIRECT_URI
 *  - instagram: (tenant IG-Login app OR INSTAGRAM_APP_ID) + INSTAGRAM_REDIRECT_URI
 *  - tiktok:    TIKTOK_CLIENT_KEY + TIKTOK_REDIRECT_URI
 *  - twitter:   TWITTER_CLIENT_ID + TWITTER_REDIRECT_URI
 *  - youtube:   GOOGLE_CLIENT_ID + (YOUTUBE_REDIRECT_URI || GOOGLE_REDIRECT_URI)
 *
 * The connect tiles on /social-monitoring use this to render one-click
 * connect buttons for live providers and a "needs setup" state for the
 * rest — so an unconfigured platform never dead-ends on an error page.
 * No secrets are returned, only booleans.
 */
export const GET = withSocialConnectAuth("read", async (_req, auth) => {
  const [metaApp, igApp] = await Promise.all([
    getTenantMetaApp(auth.orgId).catch(() => null),
    getTenantInstagramLoginApp(auth.orgId).catch(() => null),
  ])

  return NextResponse.json({
    providers: {
      facebook: Boolean((metaApp?.appId || process.env.FACEBOOK_APP_ID) && process.env.FACEBOOK_REDIRECT_URI),
      instagram: Boolean((igApp?.appId || process.env.INSTAGRAM_APP_ID) && process.env.INSTAGRAM_REDIRECT_URI),
      tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_REDIRECT_URI),
      twitter: Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_REDIRECT_URI),
      youtube: Boolean(process.env.GOOGLE_CLIENT_ID && (process.env.YOUTUBE_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI)),
    },
  })
})
