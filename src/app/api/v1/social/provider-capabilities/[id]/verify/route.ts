import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

const verifySchema = z.object({
  confirm: z.literal("VERIFIED_IN_CONTRACT_AND_SANDBOX"),
  contractVersion: z.string().trim().min(1).max(200),
  contractDocumentRef: z.string().trim().min(1).max(1000),
  sandboxRunRef: z.string().trim().max(1000).nullable().optional(),
  readAllowed: z.boolean(),
  replyAllowed: z.boolean(),
  aiProcessingAllowed: z.boolean(),
  exportAllowed: z.boolean(),
  expiresAt: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
}).strict()

export const POST = withRlsAuth("social", "write", async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!new Set(["admin", "superadmin"]).has(auth.role)) return NextResponse.json({ error: "admin_required" }, { status: 403 })
  const { id } = await params
  const proof = await prisma.socialProviderCapabilityProof.findFirst({ where: { id, organizationId: auth.orgId } })
  if (!proof) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (proof.status !== "DRAFT") return NextResponse.json({ error: "proof_not_draft" }, { status: 409 })
  const parsed = verifySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  if (parsed.data.expiresAt.getTime() <= Date.now()) return NextResponse.json({ error: "proof_expiry_must_be_future" }, { status: 400 })
  if (parsed.data.replyAllowed && !parsed.data.sandboxRunRef) return NextResponse.json({ error: "reply_capability_requires_sandbox_proof" }, { status: 400 })
  if (!parsed.data.readAllowed && !parsed.data.replyAllowed) return NextResponse.json({ error: "proof_grants_no_capability" }, { status: 400 })
  const now = new Date()
  const updated = await prisma.socialProviderCapabilityProof.update({
    where: { id },
    data: {
      status: "VERIFIED",
      contractVersion: parsed.data.contractVersion,
      readAllowed: parsed.data.readAllowed,
      replyAllowed: parsed.data.replyAllowed,
      aiProcessingAllowed: parsed.data.aiProcessingAllowed,
      exportAllowed: parsed.data.exportAllowed,
      evidence: {
        contractDocumentRef: parsed.data.contractDocumentRef,
        sandboxRunRef: parsed.data.sandboxRunRef ?? null,
        notes: parsed.data.notes ?? null,
      },
      verifiedBy: auth.userId,
      verifiedAt: now,
      sandboxVerifiedAt: parsed.data.sandboxRunRef ? now : null,
      expiresAt: parsed.data.expiresAt,
    },
  })
  await compileOrganizationSourceRoutePlans(auth.orgId)
  logAudit(auth.orgId, "verify", "social_provider_capability_proof", id, parsed.data.contractVersion)
  return NextResponse.json({ success: true, data: updated })
})
