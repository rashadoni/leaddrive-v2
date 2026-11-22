import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { hiddenChannelIdsFor } from "@/lib/inbox/channel-access"
import { loadCommentsBoard } from "@/lib/inbox/comments-board"
import { loadCommentKeywordRules } from "@/lib/inbox/comment-keyword-rules"

/**
 * «Комментарии» of Omni-Channel (lib/inbox/comments-board): the organization's comments of the last
 * 30 days grouped by post, on the pages this person may see, and the keyword rules. Rules for a page
 * hidden from the caller are not shown to them.
 */
export const GET = withRlsAuth("inbox", "read", async (_req, auth) => {
  const hidden = await hiddenChannelIdsFor(auth)
  const rules = await loadCommentKeywordRules(auth.orgId)
  const board = await loadCommentsBoard({ organizationId: auth.orgId, hiddenChannelIds: hidden, rules })
  return NextResponse.json({
    success: true,
    data: {
      ...board,
      rules: rules.filter((r) => !r.channelConfigId || !hidden.has(r.channelConfigId)),
      canManageRules: auth.role === "admin" || auth.role === "superadmin",
    },
  })
})
