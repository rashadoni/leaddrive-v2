import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { SOCIAL_LEGAL_CATEGORIES, suggestLegalCategory } from "@/lib/social/legal-categories"
import { createLegalCandidate, promoteLegalCandidate } from "@/lib/social/legal-workflow"

const flagSchema = z.object({
  category: z.enum(SOCIAL_LEGAL_CATEGORIES).optional(),
  notes: z.string().trim().max(1000).optional(),
})

/** Flag a mention as a legal case (or update its category/notes). */
export const POST = withSocialMonitoringMutationFence("social-legal", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const parsed = flagSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, text: true, platform: true },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const suggested = parsed.data.category ? null : suggestLegalCategory(mention.text)
  const category = parsed.data.category ?? suggested ?? "other"

  const candidate = await createLegalCandidate({
    organizationId: orgId,
    mentionId: mention.id,
    requestedBy: auth.userId,
    category,
    notes: parsed.data.notes,
    runAi: false,
  })
  const legalCase = await promoteLegalCandidate({
    organizationId: orgId,
    candidateId: candidate.id,
    reviewedBy: auth.userId,
    category,
    notes: parsed.data.notes,
  })

  await logAudit(orgId, "social_legal_case_flagged", "social_mention", mention.id, mention.platform, {
    newValue: { caseId: legalCase.id, category: legalCase.category },
  })

  return NextResponse.json({ success: true, data: legalCase })
})

/** Dismiss the legal case for a mention (kept for audit, excluded from reports). */
export const DELETE = withSocialMonitoringMutationFence("social-legal", "write", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const legalCase = await prisma.socialLegalCase.findFirst({
    where: { organizationId: orgId, mentionId: id },
    select: { id: true, reportId: true },
  })
  if (!legalCase) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (legalCase.reportId) {
    return NextResponse.json({ error: "Case is attached to a report" }, { status: 409 })
  }

  const dismissed = await prisma.socialLegalCase.update({
    where: { id: legalCase.id },
    data: { status: "dismissed" },
  })

  await logAudit(orgId, "social_legal_case_dismissed", "social_mention", id, undefined, {
    newValue: { caseId: legalCase.id },
  })

  return NextResponse.json({ success: true, data: dismissed })
})
