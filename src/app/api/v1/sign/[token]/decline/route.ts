/**
 * CLM Slice 2b — Public e-sign decline route.
 *
 * POST /api/v1/sign/[token]/decline
 *
 * SECURITY: Public route — token IS the only auth. Re-verifies HMAC +
 * constant-time tokenHash compare + expiry on every call.
 */
import { timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { verifyToken } from "@/lib/esign/token-issuer"
import { canSignerTransition, canEnvelopeTransition, deriveEnvelopeStatus } from "@/lib/esign/state-machine"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import { createNotification } from "@/lib/notifications"
import { runWithRlsBypass } from "@/lib/rls-context"
import type { EnvelopeStatus, SignerStatus } from "@/lib/esign/types"

// ─── POST — decline ───────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params

  return runWithRlsBypass(async () => {
  const esignSecret = process.env.ESIGN_SECRET
  if (!esignSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Step 1: HMAC verify + expiry
  const verification = verifyToken({ token: rawToken, secret: esignSecret })
  if (!verification.ok) {
    if (verification.reason === "expired") {
      return NextResponse.json({ error: "This signing link has expired" }, { status: 410 })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { claims, tokenHash: sigPortion } = verification

  // Step 2: Load signer
  let signer: Awaited<ReturnType<typeof prisma.esignSigner.findFirst>>
  try {
    signer = await prisma.esignSigner.findFirst({
      where: { id: claims.sid, envelopeId: claims.eid },
    })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  if (!signer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Step 3: Constant-time tokenHash compare
  if (!signer.tokenHash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const storedBuf = Buffer.from(signer.tokenHash, "utf8")
  const claimedBuf = Buffer.from(sigPortion, "utf8")
  if (storedBuf.length !== claimedBuf.length || !timingSafeEqual(storedBuf, claimedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // FIX 3 (MED): Only signers can decline. CC/copy observers have nothing to decline.
  if (signer.role !== "signer") {
    return NextResponse.json(
      { error: "Only signers may decline" },
      { status: 403 }
    )
  }

  // Step 4: State guards
  const signerDeclinable: SignerStatus[] = ["sent", "viewed"]
  if (!signerDeclinable.includes(signer.status as SignerStatus)) {
    const isTerminal = ["signed", "declined", "expired"].includes(signer.status)
    return NextResponse.json(
      { error: `Cannot decline from status "${signer.status}"` },
      { status: isTerminal ? 409 : 409 }
    )
  }

  // Step 5: Load envelope
  let envelope: Awaited<ReturnType<typeof prisma.esignEnvelope.findFirst>> & {
    signers?: Array<{ id: string; role: string; status: string }>
  } | null
  try {
    envelope = await prisma.esignEnvelope.findFirst({
      where: { id: claims.eid },
      include: {
        signers: {
          select: { id: true, role: true, status: true },
        },
      },
    }) as (typeof envelope)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  if (!envelope) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const envelopeDeclinable: EnvelopeStatus[] = ["sent", "in_progress"]
  if (!envelopeDeclinable.includes(envelope.status as EnvelopeStatus)) {
    const isTerminal = ["completed", "declined", "voided", "expired"].includes(envelope.status)
    return NextResponse.json(
      { error: `Envelope is not in a declinable state (${envelope.status})` },
      { status: isTerminal ? 410 : 409 }
    )
  }

  // Parse optional reason from body
  let reason: string | null = null
  try {
    const body = await req.json()
    if (body && typeof body === "object" && typeof (body as Record<string, unknown>).reason === "string") {
      const r = ((body as Record<string, unknown>).reason as string).trim()
      reason = r.length > 0 ? r.slice(0, 500) : null
    }
  } catch {
    // Body is optional — swallow parse errors
  }

  const now = new Date()
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null
  const ua = req.headers.get("user-agent") ?? null

  // Build audit events
  const signerTransition = canSignerTransition(signer.status as SignerStatus, "declined")
  if (!signerTransition.ok) {
    return NextResponse.json({ error: signerTransition.error }, { status: 409 })
  }

  const signerAuditBuild = buildAuditEvent({
    organizationId: signer.organizationId,
    envelopeId: signer.envelopeId,
    signerId: signer.id,
    eventType: "signer_declined",
    actorType: "signer",
    actorId: signer.id,
    ipAddress: ip,
    userAgent: ua,
    metadata: { reason: reason ?? undefined, email: signer.email },
    at: now,
  })
  if (!signerAuditBuild.ok) {
    console.error("[sign/decline POST] buildAuditEvent signer_declined failed:", signerAuditBuild.error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  // Derive envelope status after this signer declines
  const updatedSigners = ((envelope as any).signers as Array<{ id: string; role: string; status: string }>).map(
    (s) => (s.id === signer!.id ? { ...s, status: "declined" } : s)
  )
  const suggestedEnvelopeStatus = deriveEnvelopeStatus(
    envelope.status as EnvelopeStatus,
    updatedSigners as Array<{ role: "signer" | "cc" | "copy"; status: SignerStatus }>
  )

  let conflict = false

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // FIX 2 (HIGH): CAS — only proceed if signer is still in an eligible state
      // and the stored tokenHash still matches. count !== 1 → race → 409.
      const casResult = await tx.esignSigner.updateMany({
        where: {
          id: signer!.id,
          tokenHash: signer!.tokenHash, // must match the hash we verified against
          status: { in: ["sent", "viewed"] },
        },
        data: {
          status: "declined",
          declinedAt: now,
          declineReason: reason,
          // FIX 2: Clear tokenHash on terminal transition → link is single-use
          tokenHash: null,
        },
      })

      if (casResult.count !== 1) {
        conflict = true
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tx.esignAuditEvent.create({ data: signerAuditBuild.record as any })

      // 2. Transition envelope if derivation says so (typically → declined)
      if (suggestedEnvelopeStatus) {
        const envTransition = canEnvelopeTransition(
          envelope!.status as EnvelopeStatus,
          suggestedEnvelopeStatus
        )
        if (envTransition.ok) {
          // FIX 6 (LOW): Use "envelope_declined" when the envelope actually
          // transitions to "declined" (a signer declined). Reserve "envelope_voided"
          // for genuine voids (sender-initiated cancellations).
          const envEventType = suggestedEnvelopeStatus === "declined" ? "envelope_declined" : "envelope_voided"
          const envAuditBuild = buildAuditEvent({
            organizationId: signer!.organizationId,
            envelopeId: envelope!.id,
            signerId: null,
            eventType: envEventType,
            actorType: "system",
            actorId: null,
            metadata: { triggeredBySignerId: signer!.id, newStatus: suggestedEnvelopeStatus },
            at: now,
          })

          await tx.esignEnvelope.update({
            where: { id: envelope!.id },
            data: { status: suggestedEnvelopeStatus },
          })

          if (envAuditBuild.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await tx.esignAuditEvent.create({ data: envAuditBuild.record as any })
          }
        }
      }
    })
  } catch (e) {
    console.error("[sign/decline POST] $transaction failed:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  if (conflict) {
    return NextResponse.json({ error: "Already processed" }, { status: 409 })
  }

  const envelopeDeclined = suggestedEnvelopeStatus === "declined"

  // Best-effort: notify the contract owner when the envelope is declined.
  // NEVER block the public decline response on a notification error.
  if (envelopeDeclined) {
    ;(async () => {
      try {
        const contractRow = await prisma.contract.findFirst({
          where: { id: envelope!.contractId },
          select: { id: true, organizationId: true, title: true, createdBy: true },
        })
        if (contractRow?.createdBy) {
          await createNotification({
            organizationId: contractRow.organizationId,
            userId: contractRow.createdBy,
            type: "error",
            title: `Contract declined: ${contractRow.title}`,
            message: `A signer (${signer!.fullName}) has declined the e-signature request for "${contractRow.title}".`,
            entityType: "contract",
            entityId: contractRow.id,
            kind: "contract.declined",
          })
        }
      } catch {
        // Best-effort: suppress all errors
      }
    })()
  }

  return NextResponse.json({
    success: true,
    data: {
      signer: {
        fullName: signer.fullName,
        email: signer.email,
        status: "declined",
        declinedAt: now,
        reason,
      },
      envelopeDeclined,
    },
  })
  })
}
