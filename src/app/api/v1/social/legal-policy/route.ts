import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { SOCIAL_LEGAL_CATEGORIES } from "@/lib/social/legal-categories"
import { getOrCreateLegalPolicy } from "@/lib/social/legal-workflow"

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  candidateThreshold: z.number().min(0).max(1).optional(),
  allowedCategories: z.array(z.enum(SOCIAL_LEGAL_CATEGORIES)).min(1).optional(),
  autoPromote: z.literal(false).optional(),
  requireHumanReview: z.literal(true).optional(),
})

export const GET = withRlsAuth("social-legal", "read", async (_req: NextRequest, auth) => {
  return NextResponse.json({ success: true, data: await getOrCreateLegalPolicy(auth.orgId) })
})

export const PATCH = withRlsAuth("social-legal", "write", async (req: NextRequest, auth) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid policy" }, { status: 400 })
  const policy = await prisma.socialLegalPolicy.upsert({
    where: { organizationId: auth.orgId },
    create: {
      organizationId: auth.orgId,
      enabled: parsed.data.enabled ?? true,
      candidateThreshold: parsed.data.candidateThreshold ?? 0.65,
      allowedCategories: parsed.data.allowedCategories ?? [...SOCIAL_LEGAL_CATEGORIES].filter(item => item !== "other"),
      autoPromote: false,
      requireHumanReview: true,
      updatedBy: auth.userId,
    },
    update: {
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.candidateThreshold !== undefined ? { candidateThreshold: parsed.data.candidateThreshold } : {}),
      ...(parsed.data.allowedCategories ? { allowedCategories: parsed.data.allowedCategories } : {}),
      autoPromote: false,
      requireHumanReview: true,
      policyVersion: { increment: 1 },
      updatedBy: auth.userId,
    },
  })
  return NextResponse.json({ success: true, data: policy })
})
