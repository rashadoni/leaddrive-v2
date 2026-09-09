/**
 * CLM Slice 2a — E-sign envelope API (sender-side).
 *
 * POST /api/v1/contracts/:id/esign  — create an envelope + signers
 * GET  /api/v1/contracts/:id/esign  — list envelopes for a contract
 *
 * Org-scoped + "contracts" module gate + superadmin bypass (mirrors the
 * generate route). Envelope data is validated against the contract's
 * organizationId before any write.
 *
 * Note: tokenHash and signaturePayload are NEVER returned in list responses.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"
import { getContractSignatureEligibilityError } from "@/lib/clm/signature-eligibility"

// ─── Request schema ───────────────────────────────────────────────────────────

const signerSchema = z.object({
  fullName: z.string().min(1).max(255),
  email: z.string().email(),
  order: z.number().int().positive().optional(),
  role: z.enum(["signer", "cc", "copy"]).optional().default("signer"),
})

const createEnvelopeSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  message: z.string().max(2000).optional(),
  signers: z.array(signerSchema).min(1, "At least one signer is required"),
  expiresInDays: z.number().int().positive().max(365).optional().default(30),
})

class ESignEligibilityError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 409,
  ) {
    super(message)
    this.name = "ESignEligibilityError"
  }
}

// ─── POST — create envelope ───────────────────────────────────────────────────

export const POST = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id: contractId } = await params

  const body = await req.json()
  const parsed = createEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Verify contract belongs to this org (cross-tenant guard).
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: { id: true, title: true, status: true, signedAt: true },
    })
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 })
    }

    const eligibilityError = getContractSignatureEligibilityError(contract)
    if (eligibilityError) {
      return NextResponse.json({ error: eligibilityError }, { status: 409 })
    }

    const { subject, message, signers, expiresInDays } = parsed.data
    const now = new Date()
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000)
    const userId = session?.userId ?? null

    // Atomic create: envelope + signer rows.
    const [envelope, createdSigners] = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} AND "organizationId" = ${orgId} FOR UPDATE`

      const lockedContract = await tx.contract.findFirst({
        where: { id: contractId, organizationId: orgId },
        select: { status: true, signedAt: true },
      })
      if (!lockedContract) {
        throw new ESignEligibilityError("Contract not found", 404)
      }

      const lockedEligibilityError = getContractSignatureEligibilityError(lockedContract)
      if (lockedEligibilityError) {
        throw new ESignEligibilityError(lockedEligibilityError)
      }

      const env = await tx.esignEnvelope.create({
        data: {
          organizationId: orgId,
          contractId,
          subject: subject ?? `Signing request: ${contract.title}`,
          message: message ?? null,
          status: "created",
          expiresAt,
          createdBy: userId,
        },
      })

      const signerRows = await Promise.all(
        signers.map((s, idx) =>
          tx.esignSigner.create({
            data: {
              organizationId: orgId,
              envelopeId: env.id,
              fullName: s.fullName,
              email: s.email,
              order: s.order ?? idx + 1,
              role: s.role,
              status: "pending",
            },
          })
        )
      )

      return [env, signerRows]
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          envelope: {
            id: envelope.id,
            contractId: envelope.contractId,
            organizationId: envelope.organizationId,
            subject: envelope.subject,
            message: envelope.message,
            status: envelope.status,
            expiresAt: envelope.expiresAt,
            sentAt: envelope.sentAt,
            completedAt: envelope.completedAt,
            createdAt: envelope.createdAt,
            updatedAt: envelope.updatedAt,
          },
          signers: createdSigners.map((s: { id: string; fullName: string; email: string; order: number; role: string; status: string; signedAt: Date | null; declinedAt: Date | null; viewedAt: Date | null; createdAt: Date }) => ({
            id: s.id,
            fullName: s.fullName,
            email: s.email,
            order: s.order,
            role: s.role,
            status: s.status,
            signedAt: s.signedAt,
            declinedAt: s.declinedAt,
            viewedAt: s.viewedAt,
            createdAt: s.createdAt,
            // tokenHash and signaturePayload intentionally omitted
          })),
        },
      },
      { status: 201 }
    )
  } catch (e) {
    if (e instanceof ESignEligibilityError) {
      return NextResponse.json({ error: e.message }, { status: e.statusCode })
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2003" || e.code === "P2025") {
        return NextResponse.json({ error: "Referenced record not found" }, { status: 404 })
      }
    }
    console.error("[contracts/:id/esign POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── GET — list envelopes for a contract ─────────────────────────────────────

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id: contractId } = await params

  try {
    // Verify contract belongs to this org (cross-tenant guard).
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: { id: true },
    })
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 })
    }

    const envelopes = await prisma.esignEnvelope.findMany({
      where: { contractId, organizationId: orgId },
      orderBy: { createdAt: "desc" },
      include: {
        signers: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            fullName: true,
            email: true,
            order: true,
            role: true,
            status: true,
            signedAt: true,
            declinedAt: true,
            viewedAt: true,
            createdAt: true,
            // tokenHash and signaturePayload explicitly excluded
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: envelopes.map((env: any) => ({
        id: env.id,
        contractId: env.contractId,
        organizationId: env.organizationId,
        subject: env.subject,
        message: env.message,
        status: env.status,
        expiresAt: env.expiresAt,
        sentAt: env.sentAt,
        completedAt: env.completedAt,
        createdAt: env.createdAt,
        updatedAt: env.updatedAt,
        // Explicitly whitelist signer fields — tokenHash and signaturePayload never exposed
        signers: env.signers.map((s: { id: string; fullName: string; email: string; order: number; role: string; status: string; signedAt: Date | null; declinedAt: Date | null; viewedAt: Date | null; createdAt: Date }) => ({
          id: s.id,
          fullName: s.fullName,
          email: s.email,
          order: s.order,
          role: s.role,
          status: s.status,
          signedAt: s.signedAt,
          declinedAt: s.declinedAt,
          viewedAt: s.viewedAt,
          createdAt: s.createdAt,
        })),
      })),
    })
  } catch (e) {
    console.error("[contracts/:id/esign GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
