import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { SOCIAL_LEGAL_CATEGORIES } from "@/lib/social/legal-categories"
import { createLegalCandidate, listLegalCandidates } from "@/lib/social/legal-workflow"

const createSchema = z.object({
  mentionId: z.string().min(1),
  category: z.enum(SOCIAL_LEGAL_CATEGORIES).optional(),
  notes: z.string().trim().max(1000).optional(),
  runAi: z.boolean().optional().default(true),
})

export const GET = withRlsAuth("social-legal", "read", async (req: NextRequest, auth) => {
  const status = req.nextUrl.searchParams.get("status")?.trim() || undefined
  const candidates = await listLegalCandidates(auth.orgId, status)
  return NextResponse.json({ success: true, data: candidates })
})

export const POST = withSocialMonitoringMutationFence("social-legal", "write", async (req: NextRequest, auth) => {
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid candidate" }, { status: 400 })
  try {
    const candidate = await createLegalCandidate({
      organizationId: auth.orgId,
      mentionId: parsed.data.mentionId,
      requestedBy: auth.userId,
      category: parsed.data.category,
      notes: parsed.data.notes,
      runAi: parsed.data.runAi,
    })
    return NextResponse.json({ success: true, data: candidate }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create legal candidate"
    return NextResponse.json({ error: message }, { status: message === "Mention not found" ? 404 : 400 })
  }
})
