import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { hiddenChannelIdsFor } from "@/lib/inbox/channel-access"
import { listRulePosts } from "@/lib/inbox/comment-rule-posts"

/**
 * GET /api/v1/inbox/comments/posts?channel=<channelConfigId> — the page's latest posts and reels, to
 * tie a keyword rule to one of them (lib/inbox/comment-rule-posts). Administrators only, as the rules
 * themselves; a page hidden from the caller is «not found».
 */
export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const channel = new URL(req.url).searchParams.get("channel") ?? ""
  if (!channel || (await hiddenChannelIdsFor(auth)).has(channel)) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const result = await listRulePosts(auth.orgId, channel)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 502 })
  return NextResponse.json({ success: true, data: { posts: result.posts } })
})
