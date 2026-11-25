/**
 * GET /api/v1/public/portal-documents — the counterparty's «Sənədlər»
 * (src/lib/portal-documents.ts): what waits for this person's signature and
 * the company's agreed contracts. Portal session only.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { WAITING_ENVELOPE_SELECT, portalContractWhere, portalDocumentsAccess, waitingForSigner, type EnvelopeForWaiting } from "@/lib/portal-documents"

export async function GET() {
  const access = await portalDocumentsAccess()
  if (!access.ok) return NextResponse.json({ error: access.code, code: access.code }, { status: access.status })
  const { user, companyId, email } = access
  try {
    return await runWithTenant(user.organizationId, async () => {
      const [contracts, envelopes] = await Promise.all([
        prisma.contract.findMany({
          where: portalContractWhere(user.organizationId, companyId),
          orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
          select: { id: true, contractNumber: true, title: true, status: true, startDate: true, endDate: true, signedAt: true },
        }),
        prisma.esignEnvelope.findMany({
          where: { organizationId: user.organizationId, status: { in: ["sent", "in_progress"] }, contract: portalContractWhere(user.organizationId, companyId) },
          select: WAITING_ENVELOPE_SELECT,
        }),
      ])
      return NextResponse.json({
        success: true,
        data: {
          contracts: contracts.map((c: { id: string; contractNumber: string; title: string; status: string; startDate: Date | null; endDate: Date | null; signedAt: Date | null }) => ({
            ...c,
            signed: Boolean(c.signedAt),
          })),
          waiting: waitingForSigner(envelopes as EnvelopeForWaiting[], email, new Date()),
        },
      })
    })
  } catch (e) {
    console.error("[portal-documents GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
