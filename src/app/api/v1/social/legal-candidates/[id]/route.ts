import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { SOCIAL_LEGAL_CATEGORIES } from "@/lib/social/legal-categories"
import { dismissLegalCandidate, promoteLegalCandidate } from "@/lib/social/legal-workflow"

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("promote"), category: z.enum(SOCIAL_LEGAL_CATEGORIES).optional(), notes: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("dismiss"), reason: z.string().trim().max(1000).optional() }),
])

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withSocialMonitoringMutationFence("social-legal", "write", async (req: NextRequest, auth, context: RouteContext) => {
  const { id } = await context.params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid action" }, { status: 400 })
  try {
    if (parsed.data.action === "dismiss") {
      await dismissLegalCandidate(auth.orgId, id, auth.userId, parsed.data.reason)
      return NextResponse.json({ success: true })
    }
    const legalCase = await promoteLegalCandidate({
      organizationId: auth.orgId,
      candidateId: id,
      reviewedBy: auth.userId,
      category: parsed.data.category,
      notes: parsed.data.notes,
    })
    return NextResponse.json({ success: true, data: legalCase })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update legal candidate"
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 409 })
  }
})
