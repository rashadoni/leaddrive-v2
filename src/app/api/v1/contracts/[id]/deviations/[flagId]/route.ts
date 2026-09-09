/**
 * CLM Slice 4c — PATCH /api/v1/contracts/:id/deviations/:flagId
 *
 * Acknowledge or waive a deviation flag.
 * requireAuth contracts "write".
 *
 * Body: { action: "acknowledge" | "waive", reason?: string }
 *
 * - acknowledge → status = "acknowledged"
 * - waive       → status = "waived", waivedBy, waivedAt, waivedReason
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const patchSchema = z.object({
  action: z.enum(["acknowledge", "waive"]),
  reason: z.string().min(1).max(1000).optional(),
})

export const PATCH = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string; flagId: string }> }) => {
  const { orgId, userId } = auth
  const { id: contractId, flagId } = await params

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { action, reason } = parsed.data

  // Org-scope guard: verify the flag belongs to this org + this contract.
  const flag = await prisma.contractDeviationFlag.findFirst({
    where: { id: flagId, organizationId: orgId, contractId },
  })
  if (!flag) {
    return NextResponse.json({ error: "Deviation flag not found" }, { status: 404 })
  }

  const now = new Date()

  // Use updateMany with the full tenant + contract predicate so the write is
  // bound to id + organizationId + contractId (closes the TOCTOU footgun where
  // a flag could be re-associated between the findFirst guard and the write).
  // count === 0 means the row vanished or shifted tenant/contract between the
  // findFirst and the write — treat as 404.
  const data =
    action === "waive"
      ? {
          status:       "waived",
          waivedBy:     userId ?? undefined,
          waivedAt:     now,
          waivedReason: reason ?? null,
        }
      : { status: "acknowledged" }

  const { count } = await prisma.contractDeviationFlag.updateMany({
    where: { id: flagId, organizationId: orgId, contractId },
    data,
  })

  if (count === 0) {
    return NextResponse.json({ error: "Deviation flag not found" }, { status: 404 })
  }

  // Re-fetch the updated record to return full shape (updateMany does not return rows).
  const updated = await prisma.contractDeviationFlag.findFirst({
    where: { id: flagId, organizationId: orgId, contractId },
  })

  return NextResponse.json({ success: true, data: updated })
})
