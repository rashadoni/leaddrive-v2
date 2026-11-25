/**
 * POST /api/v1/public/portal-documents/sign { signerId } — «İmzala» in the
 * counterparty's cabinet: a fresh signing link for this person and this
 * envelope, then the same public signing page as the e-mail's.
 *
 * Only the portal contact who IS that signer (same e-mail) on a live envelope
 * of an agreed contract of their company, and only while they have not signed.
 * The new token replaces the stored hash, so the e-mailed link stops working:
 * a signer has one live link at a time — as the signing reminders already do.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { issueToken } from "@/lib/esign/token-issuer"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import { portalContractWhere, portalDocumentsAccess } from "@/lib/portal-documents"

const bodySchema = z.object({ signerId: z.string().min(1).max(64) }).strict()

export async function POST(req: Request) {
  const access = await portalDocumentsAccess()
  if (!access.ok) return NextResponse.json({ error: access.code, code: access.code }, { status: access.status })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const secret = process.env.ESIGN_SECRET
  if (!secret) return NextResponse.json({ error: "E-sign is not configured" }, { status: 500 })
  const { user, companyId, email } = access
  try {
    return await runWithTenant(user.organizationId, async () => {
      const signer = await prisma.esignSigner.findFirst({
        where: {
          id: parsed.data.signerId,
          organizationId: user.organizationId,
          role: "signer",
          status: { in: ["sent", "viewed"] },
          email: { equals: email, mode: "insensitive" },
          envelope: { status: { in: ["sent", "in_progress"] }, contract: portalContractWhere(user.organizationId, companyId) },
        },
        select: { id: true, status: true, envelopeId: true, envelope: { select: { expiresAt: true } } },
      })
      if (!signer) return NextResponse.json({ error: "Nothing to sign here", code: "NOT_YOURS" }, { status: 404 })
      const expiresAt = signer.envelope.expiresAt
      if (expiresAt && expiresAt.getTime() <= Date.now()) return NextResponse.json({ error: "The signing has expired", code: "EXPIRED" }, { status: 410 })
      const exp = Math.floor((expiresAt?.getTime() ?? Date.now() + 30 * 86_400_000) / 1000)
      const { token, tokenHash } = issueToken({ claims: { eid: signer.envelopeId, sid: signer.id, exp }, secret })
      const now = new Date()
      const audit = buildAuditEvent({
        organizationId: user.organizationId,
        envelopeId: signer.envelopeId,
        signerId: signer.id,
        eventType: "token_issued",
        actorType: "signer",
        actorId: signer.id,
        ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
        metadata: { via: "portal", contactId: user.contactId },
        at: now,
      })
      const ok = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Only while still unsigned: a signature in between keeps its state.
        const cas = await tx.esignSigner.updateMany({
          where: { id: signer.id, status: { in: ["sent", "viewed"] } },
          data: { tokenHash },
        })
        if (cas.count !== 1) return false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (audit.ok) await tx.esignAuditEvent.create({ data: audit.record as any })
        return true
      })
      if (!ok) return NextResponse.json({ error: "Already signed", code: "ALREADY_DONE" }, { status: 409 })
      return NextResponse.json({ success: true, data: { url: `/sign/${token}` } })
    })
  } catch (e) {
    console.error("[portal-documents/sign POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
