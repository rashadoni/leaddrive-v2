import { NextResponse } from "next/server"
import { z } from "zod"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { checkPermission } from "@/lib/permissions"
import { runAiAssist } from "@/lib/inbox/ai-assist"

// E3.2 — compose-assist endpoint. Gated by the "ai" module (write) like the other AI
// routes; the heavy lifting + budget guard live in runAiAssist().
const schema = z.object({
  action: z.enum(["rewrite", "shorten", "polite", "translate", "suggest"]),
  draft: z.string().max(8000).optional().default(""),
  lastInbound: z.string().max(8000).optional(),
  lang: z.string().max(20).optional(),
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

  const outcome = await runAiAssist({ organizationId: auth.orgId, ...parsed.data })
  if (!outcome.ok) {
    const status =
      outcome.error === "budget" ? 429 : outcome.error === "empty_input" ? 400 : 502
    return NextResponse.json({ error: outcome.error }, { status })
  }
  return NextResponse.json({ success: true, data: { suggestion: outcome.suggestion } })
})
