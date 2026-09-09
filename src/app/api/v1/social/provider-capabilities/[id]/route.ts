import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

const updateSchema = z.object({
  status: z.literal("REVOKED").optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  attributionRequired: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).strict()

export const PATCH = withRlsAuth("social", "write", async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!new Set(["admin", "superadmin"]).has(auth.role)) return NextResponse.json({ error: "admin_required" }, { status: 403 })
  const { id } = await params
  const proof = await prisma.socialProviderCapabilityProof.findFirst({ where: { id, organizationId: auth.orgId } })
  if (!proof) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const parsed = updateSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  if (proof.status !== "DRAFT" && parsed.data.status !== "REVOKED") return NextResponse.json({ error: "verified_proof_is_immutable" }, { status: 409 })
  const updated = await prisma.socialProviderCapabilityProof.update({ where: { id }, data: parsed.data })
  await compileOrganizationSourceRoutePlans(auth.orgId)
  logAudit(auth.orgId, "update", "social_provider_capability_proof", id, parsed.data.status ?? "metadata")
  return NextResponse.json({ success: true, data: updated })
})
