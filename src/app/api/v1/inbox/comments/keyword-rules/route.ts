import { NextResponse } from "next/server"
import { z } from "zod"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { logAudit } from "@/lib/prisma"
import {
  COMMENT_KEYWORD_MAX_CHARS,
  COMMENT_KEYWORD_MESSAGE_MAX_CHARS,
  COMMENT_KEYWORD_RULES_MAX,
  saveCommentKeywordRules,
} from "@/lib/inbox/comment-keyword-rules"

const bodySchema = z.strictObject({
  rules: z.array(z.strictObject({
    id: z.string().min(1).max(64).nullable().optional(),
    keyword: z.string().trim().min(1).max(COMMENT_KEYWORD_MAX_CHARS),
    message: z.string().trim().min(1).max(COMMENT_KEYWORD_MESSAGE_MAX_CHARS),
    channelConfigId: z.string().min(1).max(64).nullable().optional(),
    enabled: z.boolean().optional(),
  })).max(COMMENT_KEYWORD_RULES_MAX),
})

/**
 * Replaces the organization's «word in a comment → message in Direct» rules
 * (lib/inbox/comment-keyword-rules). Administrators only: a rule writes to customers by itself, in
 * the company's name, for as long as it stands.
 */
export const PUT = withInboxSessionWrite(async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const saved = await saveCommentKeywordRules(auth.orgId, parsed.data.rules)
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 })
  void logAudit(auth.orgId, "update", "organization", auth.orgId, "comment keyword rules", {
    userId: auth.userId,
    newValue: { rules: saved.rules.map((r) => ({ id: r.id, keyword: r.keyword, channelConfigId: r.channelConfigId, enabled: r.enabled })) },
  })
  return NextResponse.json({ success: true, data: { rules: saved.rules } })
})
