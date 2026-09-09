import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { OutboundReviewError, reviewOutboundSocialReply } from "@/lib/social/outbound-service"

const schema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) })
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRlsAuth("social", "write", async (req: NextRequest, auth, context: RouteContext) => {
  const { id } = await context.params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid review decision" }, { status: 400 })
  try {
    const result = await reviewOutboundSocialReply({
      organizationId: auth.orgId,
      outboundReplyId: id,
      reviewerId: auth.userId,
      reviewerRole: auth.role,
      decision: parsed.data.decision,
    })
    return NextResponse.json({ success: true, data: result }, { status: 201 })
  } catch (error) {
    if (error instanceof OutboundReviewError) {
      return NextResponse.json({ error: error.code, code: error.code, details: error.details }, { status: error.status })
    }
    throw error
  }
})
