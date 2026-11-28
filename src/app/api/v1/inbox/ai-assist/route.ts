import { NextResponse } from "next/server"
import { z } from "zod"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { checkPermission } from "@/lib/permissions"
import { runAiAssist } from "@/lib/inbox/ai-assist"
import { suggestConversationReply } from "@/lib/inbox/ai-suggest-reply"
import { conversationAccessDenial } from "@/lib/inbox/channel-access"

// E3.2 — compose-assist endpoint. Gated by the "ai" module (write) like the other AI
// routes; the heavy lifting + budget guard live in runAiAssist().
const schema = z.object({
  action: z.enum(["rewrite", "shorten", "polite", "translate", "suggest"]),
  draft: z.string().max(8000).optional().default(""),
  lastInbound: z.string().max(8000).optional(),
  lang: z.string().max(20).optional(),
  /** The open conversation: «suggest» then answers it the way the page's AI would (ai-suggest-reply). */
  conversationId: z.string().min(1).max(100).optional(),
})

export const POST = withInboxSessionWrite(async (req, auth) => {
  // Preserve the AI entitlement in addition to the operator/session boundary.
  if (!checkPermission(auth.role, "ai", "write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { conversationId, ...assist } = parsed.data
  if (assist.action === "suggest" && conversationId) {
    const denied = await conversationAccessDenial(auth, conversationId)
    if (denied) return denied
    const suggested = await suggestConversationReply({ organizationId: auth.orgId, conversationId })
    if (suggested) {
      if (!suggested.ok) {
        const status =
          suggested.error === "budget" ? 429
            : suggested.error === "not_found" ? 404
              : suggested.error === "no_customer_message" || suggested.error === "prompt_attack" ? 400
                : 502
        return NextResponse.json({ error: suggested.error }, { status })
      }
      return NextResponse.json({
        success: true,
        data: { suggestion: suggested.suggestion, unverifiedOffer: suggested.unverifiedOffer },
      })
    }
  }

  const outcome = await runAiAssist({ organizationId: auth.orgId, ...assist })
  if (!outcome.ok) {
    const status =
      outcome.error === "budget" ? 429 : outcome.error === "empty_input" ? 400 : 502
    return NextResponse.json({ error: outcome.error }, { status })
  }
  return NextResponse.json({ success: true, data: { suggestion: outcome.suggestion } })
})
