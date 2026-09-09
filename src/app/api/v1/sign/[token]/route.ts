/**
 * CLM Slice 2b — Public e-sign portal API.
 *
 * GET  /api/v1/sign/[token]  — Load signing page data (view tracking)
 * POST /api/v1/sign/[token]  — Submit signature
 *
 * SECURITY: These routes are PUBLIC (no session auth). The HMAC token IS
 * the only authentication mechanism. Every handler re-verifies:
 *   1. HMAC signature validity (re-computed + constant-time compare)
 *   2. Token expiry
 *   3. Stored tokenHash matches the sig portion (constant-time compare)
 *   4. Envelope + signer state guards
 *
 * FIX C (Slice 4a integrity): The GET (page load) and POST (completion)
 * both read the BOUND ContractVersion's renderedBody — never the live
 * Contract.renderedBody — so a /amend that ran after send cannot change
 * what the signer is asked to sign, and the canonical ContractVersion minted
 * at completion captures the body that was actually signed.
 *
 * Backward-compat: envelopes without a bound version (legacy, contractVersionId
 * = null) fall back to Contract.renderedBody.
 *
 * NEVER return: tokenHash, other signers' data, org data, signaturePayload
 * from other signers.
 */
import { createHash, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { verifyToken } from "@/lib/esign/token-issuer"
import { canEnvelopeTransition, deriveEnvelopeStatus } from "@/lib/esign/state-machine"
import { validateSignaturePayload } from "@/lib/esign/signature-validator"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import { createNotification } from "@/lib/notifications"
import { sendContractAlert } from "@/lib/integrations/contract-alerts"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getContractSignatureEligibilityError } from "@/lib/clm/signature-eligibility"
import type { EnvelopeStatus, SignerStatus } from "@/lib/esign/types"

// ─── Token verify + DB constant-time check ───────────────────────────────────

/**
 * Verify the raw token AND constant-time compare against the stored tokenHash.
 * Returns the signer + envelope + contract rows on success; 401/403/410
 * NextResponse on any failure.
 *
 * Expiry: returns 410 (Gone — the link expired, not 401/403 which imply wrong
 * creds). Tampered/malformed/missing token → 401 (generic, no info leak).
 * tokenHash mismatch → 401.
 */
async function verifyAndLoad(rawToken: string): Promise<
  | {
      ok: true
      signer: {
        id: string
        organizationId: string
        envelopeId: string
        fullName: string
        email: string
        order: number
        role: string
        status: string
        tokenHash: string | null
        viewedAt: Date | null
        signedAt: Date | null
        declinedAt: Date | null
        declineReason: string | null
        signatureMethod: string | null
        createdAt: Date
        updatedAt: Date
      }
      envelope: {
        id: string
        organizationId: string
        contractId: string
        subject: string
        message: string | null
        status: string
        expiresAt: Date | null
        sentAt: Date | null
        completedAt: Date | null
        createdAt: Date
        updatedAt: Date
        signers: Array<{ id: string; role: string; status: string }>
        // Bound version fields (FIX C)
        contractVersionId: string | null
        boundContentHash: string | null
      }
      contract: {
        id: string
        organizationId: string
        title: string
        contractNumber: string
        renderedBody: string | null
        status: string
        createdBy: string | null
      }
      /** The body the signer should see — from the bound version, or live contract (legacy). */
      signingBody: string
    }
  | NextResponse
> {
  const esignSecret = process.env.ESIGN_SECRET
  if (!esignSecret) {
    // Misconfigured environment — don't leak any info
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Step 1: HMAC signature + expiry check (pure, no DB)
  const verification = verifyToken({ token: rawToken, secret: esignSecret })
  if (!verification.ok) {
    if (verification.reason === "expired") {
      return NextResponse.json({ error: "This signing link has expired" }, { status: 410 })
    }
    // malformed / bad_signature / invalid_payload → generic 401
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { claims, tokenHash: sigPortion } = verification

  // Step 2: Load signer + envelope + contract from DB
  // The claims.eid + claims.sid are untrusted values from the token payload,
  // but HMAC has already verified they were issued by us.
  let signer: Awaited<ReturnType<typeof prisma.esignSigner.findFirst>>
  let envelope: (Awaited<ReturnType<typeof prisma.esignEnvelope.findFirst>> & {
    signers?: Array<{ id: string; role: string; status: string }>
    contract?: { id: string; organizationId: string; title: string; contractNumber: string; renderedBody: string | null; status: string; createdBy: string | null } | null
    contractVersionId?: string | null
    boundContentHash?: string | null
  }) | null

  try {
    signer = await prisma.esignSigner.findFirst({
      where: { id: claims.sid, envelopeId: claims.eid },
    })

    if (!signer) {
      // Signer not found — return 401 (generic, no info leak about which)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Step 3: Constant-time compare tokenHash
    // The stored tokenHash is the HMAC sig portion.
    if (!signer.tokenHash) {
      // Token never issued / envelope not sent yet
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const storedBuf = Buffer.from(signer.tokenHash, "utf8")
    const claimedBuf = Buffer.from(sigPortion, "utf8")
    if (storedBuf.length !== claimedBuf.length || !timingSafeEqual(storedBuf, claimedBuf)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Step 4: Load envelope with all signers + contract + bound-version fields
    envelope = await prisma.esignEnvelope.findFirst({
      where: { id: claims.eid },
      include: {
        signers: {
          select: { id: true, role: true, status: true },
        },
        contract: {
          select: {
            id: true,
            organizationId: true,
            title: true,
            contractNumber: true,
            renderedBody: true,
            status: true,
            createdBy: true,
          },
        },
      },
    }) as typeof envelope

    if (!envelope || !envelope.contract) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  // FIX C (Codex residual): resolve the body the signer should see.
  //
  // BOUND envelope (contractVersionId IS set):
  //   The pinned ContractVersion MUST load and its contentHash MUST match
  //   boundContentHash. If either check fails → FAIL CLOSED (500). We NEVER
  //   fall back to the live Contract.renderedBody for a bound envelope — that
  //   would re-open the integrity hole that /amend-after-send is designed to
  //   prevent (signer could see/sign a body different from the pinned snapshot).
  //
  // UNBOUND envelope (contractVersionId IS NULL):
  //   Legacy / pre-bound-version envelopes. Fall back to Contract.renderedBody
  //   (existing behaviour, preserved for backward-compat).
  let signingBody: string

  if (envelope.contractVersionId) {
    // ── BOUND path: strict fail-closed ──────────────────────────────────────
    let boundVersion: { renderedBody: string | null; contentHash: string } | null = null
    try {
      boundVersion = await prisma.contractVersion.findUnique({
        where: { id: envelope.contractVersionId },
        select: { renderedBody: true, contentHash: true },
      })
    } catch (err) {
      // DB error while loading bound version — fail closed
      console.error(
        `[sign GET] DB error loading bound version ${envelope.contractVersionId} for envelope ${envelope.id}:`,
        err
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    if (!boundVersion) {
      // Bound version referenced by envelope is missing — fail closed.
      // A bound envelope must only ever display/sign its pinned snapshot.
      console.error(
        `[sign GET] Bound version ${envelope.contractVersionId} not found for envelope ${envelope.id} — failing closed`
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    // Integrity cross-check: boundContentHash must match (versions are immutable).
    if (
      envelope.boundContentHash &&
      boundVersion.contentHash !== envelope.boundContentHash
    ) {
      // Should be impossible — versions are immutable. Fail safe.
      console.error(
        `[sign GET] Bound version contentHash mismatch for envelope ${envelope.id}: ` +
        `stored=${envelope.boundContentHash} actual=${boundVersion.contentHash}`
      )
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    signingBody = boundVersion.renderedBody ?? ""
  } else {
    // ── UNBOUND path: legacy fallback to live renderedBody ───────────────────
    signingBody = (envelope as any).contract?.renderedBody ?? ""
  }

  return {
    ok: true,
    signer: signer!,
    envelope: {
      id: envelope.id,
      organizationId: envelope.organizationId,
      contractId: envelope.contractId,
      subject: envelope.subject,
      message: envelope.message,
      status: envelope.status,
      expiresAt: envelope.expiresAt,
      sentAt: envelope.sentAt,
      completedAt: envelope.completedAt,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      signers: (envelope as any).signers as Array<{ id: string; role: string; status: string }>,
      contractVersionId: (envelope as any).contractVersionId ?? null,
      boundContentHash: (envelope as any).boundContentHash ?? null,
    },
    contract: (envelope as any).contract as {
      id: string
      organizationId: string
      title: string
      contractNumber: string
      renderedBody: string | null
      status: string
      createdBy: string | null
    },
    signingBody,
  }
}

class SignConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SignConflictError"
  }
}

// ─── GET — load signing page data ────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params
  return runWithRlsBypass(async () => {
  const loaded = await verifyAndLoad(rawToken)
  if (loaded instanceof NextResponse) return loaded

  const { signer, envelope, contract, signingBody } = loaded

  // State guard: envelope must not be terminal
  const terminalEnvelopeStatuses: EnvelopeStatus[] = ["completed", "voided", "expired"]
  if (terminalEnvelopeStatuses.includes(envelope.status as EnvelopeStatus)) {
    return NextResponse.json(
      { error: `This signing session is no longer active (envelope ${envelope.status})` },
      { status: 410 }
    )
  }

  // Note: terminal signer statuses (signed/declined/expired) are NOT rejected here.
  // A returning signer who already signed/declined should see their terminal state
  // (the response carries status; we just skip view-tracking). Only the view-tracking
  // block below is gated on pending/sent — terminal signers fall through to the
  // load-data return.
  //
  // The envelope terminal check above (completed/voided/expired) still returns 410
  // because there is no meaningful signing session to display in that case.

  const now = new Date()
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null
  const ua = req.headers.get("user-agent") ?? null

  // On first successful view: CAS-transition signer pending/sent → viewed.
  //
  // SECURITY (Codex residual MED): the update MUST be conditional — scoped to
  // the verified tokenHash + status in (pending, sent) — so a concurrent POST
  // that races to signed/declined cannot be downgraded back to "viewed".
  // updateMany returns count; count===0 means the signer already advanced (race)
  // and is treated as a no-op: we still return the load payload so a returning
  // signer who already signed sees their terminal state.
  if (signer.status === "pending" || signer.status === "sent") {
    try {
      const auditBuild = buildAuditEvent({
        organizationId: signer.organizationId,
        envelopeId: signer.envelopeId,
        signerId: signer.id,
        eventType: "signer_viewed",
        actorType: "signer",
        actorId: signer.id,
        ipAddress: ip,
        userAgent: ua,
        metadata: { method: "GET" },
        at: now,
      })

      if (auditBuild.ok) {
        // Determine new envelope status if needed (sent → in_progress)
        const allSigners = envelope.signers.map((s) =>
          s.id === signer.id ? { ...s, status: "viewed" } : s
        )
        const suggestedEnvelopeStatus = deriveEnvelopeStatus(
          envelope.status as EnvelopeStatus,
          allSigners as Array<{ role: "signer" | "cc" | "copy"; status: SignerStatus }>
        )

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // CAS: only transition from pending/sent, scoped to the verified tokenHash.
          // If a concurrent POST already moved the signer to signed/declined,
          // count===0 → skip audit + envelope update (no downgrade).
          const casResult = await tx.esignSigner.updateMany({
            where: {
              id: signer.id,
              tokenHash: signer.tokenHash,
              status: { in: ["pending", "sent"] },
            },
            data: { status: "viewed", viewedAt: now },
          })

          if (casResult.count === 1) {
            // Real transition happened — emit audit and conditionally advance envelope.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await tx.esignAuditEvent.create({ data: auditBuild.record as any })

            if (suggestedEnvelopeStatus) {
              const envTransition = canEnvelopeTransition(
                envelope.status as EnvelopeStatus,
                suggestedEnvelopeStatus
              )
              if (envTransition.ok) {
                // Conditional: only advance envelope when it is STILL "sent".
                // Never downgrade a completed/declined/voided envelope.
                await tx.esignEnvelope.updateMany({
                  where: { id: envelope.id, status: "sent" },
                  data: { status: suggestedEnvelopeStatus },
                })
              }
            }
          }
          // count===0: signer already advanced past pending/sent (race) — no-op.
          // The GET still returns the load data below (terminal state visible to signer).
        })
      }
    } catch {
      // Non-fatal: view tracking failure MUST NOT block the signer seeing the doc
    }
  }

  // Determine whether this signer can sign now (sequential order enforcement).
  // A signer can sign iff they are a "signer" role AND all lower-order "signer"
  // role siblings have already reached status "signed". cc/copy roles don't block
  // and aren't required to sign, so canSignNow is always true for them.
  let canSignNow = true
  if (signer.role === "signer") {
    // The verifyAndLoad envelope.signers only has { id, role, status }.
    // We need to know if any signer with order < signer.order is not yet "signed".
    // Fetch them separately (cheap: small set, same envelope).
    try {
      const earlierUnsigned = await prisma.esignSigner.count({
        where: {
          envelopeId: signer.envelopeId,
          role: "signer",
          order: { lt: signer.order },
          status: { not: "signed" },
        },
      })
      canSignNow = earlierUnsigned === 0
    } catch {
      // Non-fatal: default to true (don't block page on a count failure)
      canSignNow = true
    }
  }

  // Return ONLY safe fields — never tokenHash, other signers' data, or org internals
  // FIX C: renderedBody comes from the bound version (or live contract for legacy)
  return NextResponse.json({
    success: true,
    data: {
      signer: {
        fullName: signer.fullName,
        email: signer.email,
        status: signer.status === "sent" || signer.status === "pending" ? "viewed" : signer.status,
      },
      envelope: {
        subject: envelope.subject,
        message: envelope.message,
        status: envelope.status,
        expiresAt: envelope.expiresAt,
      },
      contract: {
        title: contract.title,
        contractNumber: contract.contractNumber,
        renderedBody: signingBody,
      },
      canSignNow,
    },
  })
  })
}

// ─── POST — submit signature ──────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params
  return runWithRlsBypass(async () => {
  const loaded = await verifyAndLoad(rawToken)
  if (loaded instanceof NextResponse) return loaded

  const { signer, envelope, contract, signingBody } = loaded

  // FIX 3 (MED): CC/copy signers must not produce a signature. Only role="signer"
  // may submit a signature payload. CC/copy can still GET/view the document.
  if (signer.role !== "signer") {
    return NextResponse.json(
      { error: "Only signers may submit a signature" },
      { status: 403 }
    )
  }

  // State guard: signer must be sent or viewed
  const signerSignable: SignerStatus[] = ["sent", "viewed"]
  if (!signerSignable.includes(signer.status as SignerStatus)) {
    const isTerminal = ["signed", "declined", "expired"].includes(signer.status)
    return NextResponse.json(
      { error: `Cannot sign from status "${signer.status}"` },
      { status: isTerminal ? 409 : 409 }
    )
  }

  // State guard: envelope must be sent or in_progress
  const envelopeSignable: EnvelopeStatus[] = ["sent", "in_progress"]
  if (!envelopeSignable.includes(envelope.status as EnvelopeStatus)) {
    const isTerminal = ["completed", "declined", "voided", "expired"].includes(envelope.status)
    return NextResponse.json(
      { error: `Envelope is not in a signable state (${envelope.status})` },
      { status: isTerminal ? 410 : 409 }
    )
  }

  // Sequential order enforcement: only role="signer" can be blocked by order.
  // cc/copy roles never block and are never blocked. (role guard above already
  // limits this path to role="signer" — kept explicit for clarity.)
  {
    let earlierUnsigned = 0
    try {
      earlierUnsigned = await prisma.esignSigner.count({
        where: {
          envelopeId: signer.envelopeId,
          role: "signer",
          order: { lt: signer.order },
          status: { not: "signed" },
        },
      })
    } catch {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    if (earlierUnsigned > 0) {
      return NextResponse.json(
        { error: "Waiting for earlier signers", code: "OUT_OF_ORDER" },
        { status: 409 }
      )
    }
  }

  // Parse + validate body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be an object" }, { status: 400 })
  }

  const { method, payload } = body as Record<string, unknown>

  if (typeof method !== "string") {
    return NextResponse.json({ error: "method is required" }, { status: 400 })
  }

  const sigValidation = validateSignaturePayload({ method: method as "drawn" | "typed" | "uploaded", payload })
  if (!sigValidation.ok) {
    return NextResponse.json({ error: sigValidation.errors.join("; ") }, { status: 400 })
  }

  const now = new Date()
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null
  const ua = req.headers.get("user-agent") ?? null

  // Build signer_signed audit event
  const signerAuditBuild = buildAuditEvent({
    organizationId: signer.organizationId,
    envelopeId: signer.envelopeId,
    signerId: signer.id,
    eventType: "signer_signed",
    actorType: "signer",
    actorId: signer.id,
    ipAddress: ip,
    userAgent: ua,
    metadata: { method, email: signer.email },
    at: now,
  })
  if (!signerAuditBuild.ok) {
    console.error("[sign POST] buildAuditEvent signer_signed failed:", signerAuditBuild.error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  let envelopeCompleted = false

  /**
   * FIX 2 (HIGH) + FIX 5 (MED): Full-tx compare-and-swap + bounded retry.
   *
   * The CAS uses updateMany({ where: { id, tokenHash, status: {in:[…]} } }) to
   * atomically assert "nothing raced" — count 0 = already processed → 409.
   * On success, tokenHash is cleared (NULL) so the link is immediately single-use.
   * The ENTIRE completion transaction is wrapped in the retry loop (not just the
   * ContractVersion mint), so a P2002 race on versionNo can't leave the signer
   * row mutated without the version.
   *
   * FIX C (Slice 4a): the canonical ContractVersion minted at completion uses
   * the BOUND version's body (signingBody), not Contract.renderedBody.
   * If the envelope had no bound version, signingBody already fell back to
   * Contract.renderedBody — backward-compat preserved.
   */
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // ── Re-read state inside the transaction (FIX 5: fresh on each retry)
        const freshSigner = await tx.esignSigner.findFirst({
          where: { id: signer.id },
          select: { id: true, status: true, tokenHash: true },
        })
        const freshEnvelope = await tx.esignEnvelope.findFirst({
          where: { id: envelope.id },
          select: {
            id: true,
            status: true,
            contractVersionId: true,
            boundContentHash: true,
            signers: { select: { id: true, role: true, status: true } },
          },
        })

        // ── CAS: transition signer (FIX 2 — race/replay backstop)
        // The where clause includes the verified tokenHash + eligible status;
        // count 0 means someone already transitioned us → 409.
        const casResult = await tx.esignSigner.updateMany({
          where: {
            id: signer.id,
            tokenHash: signer.tokenHash, // must match the hash we verified against
            status: { in: ["sent", "viewed"] },
          },
          data: {
            status: "signed",
            signedAt: now,
            signatureMethod: method,
            signaturePayload: sigValidation.payload as unknown as Prisma.InputJsonValue,
            signedIpAddress: ip,
            signedUserAgent: ua,
            // FIX 2: Clear tokenHash on terminal transition → link is single-use
            tokenHash: null,
          },
        })

        if (casResult.count !== 1) {
          // Race: another concurrent request already processed this signer.
          return { conflict: true } as const
        }

        // ── Append signer_signed audit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.esignAuditEvent.create({ data: signerAuditBuild.record as any })

        // ── Derive new envelope status (using freshEnvelope for accuracy)
        const currentSigners = freshEnvelope?.signers ?? envelope.signers
        const updatedSigners = currentSigners.map((s) =>
          s.id === signer.id ? { ...s, status: "signed" } : s
        )
        const freshEnvelopeStatus = (freshSigner?.status === "signed"
          ? freshEnvelope?.status
          : freshEnvelope?.status) ?? envelope.status
        const effectiveEnvelopeStatus: EnvelopeStatus =
          freshEnvelopeStatus === "sent" ? "in_progress" : (freshEnvelopeStatus as EnvelopeStatus)
        const suggestedEnvelopeStatus = deriveEnvelopeStatus(
          effectiveEnvelopeStatus,
          updatedSigners as Array<{ role: "signer" | "cc" | "copy"; status: SignerStatus }>
        )

        // ── Envelope progression (sent → in_progress if not all signed yet)
        if (freshEnvelopeStatus === "sent" && !suggestedEnvelopeStatus) {
          const toInProgress = canEnvelopeTransition("sent" as EnvelopeStatus, "in_progress")
          if (toInProgress.ok) {
            await tx.esignEnvelope.update({
              where: { id: envelope.id },
              data: { status: "in_progress" },
            })
          }
        }

        if (suggestedEnvelopeStatus === "completed") {
          const freshContract = await tx.contract.findFirst({
            where: { id: contract.id, organizationId: contract.organizationId },
            select: { status: true, signedAt: true },
          })
          if (!freshContract) {
            throw new SignConflictError("Contract not found")
          }

          const eligibilityError = getContractSignatureEligibilityError(freshContract)
          if (eligibilityError) {
            throw new SignConflictError(eligibilityError)
          }

          // ── Envelope → completed
          const envCompletedAuditBuild = buildAuditEvent({
            organizationId: signer.organizationId,
            envelopeId: envelope.id,
            signerId: null,
            eventType: "envelope_completed",
            actorType: "system",
            actorId: null,
            metadata: { triggeredBySignerId: signer.id },
            at: now,
          })
          if (!envCompletedAuditBuild.ok) {
            throw new Error("buildAuditEvent envelope_completed failed: " + envCompletedAuditBuild.error)
          }

          await tx.esignEnvelope.update({
            where: { id: envelope.id },
            data: { status: "completed", completedAt: now },
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await tx.esignAuditEvent.create({ data: envCompletedAuditBuild.record as any })

          // ── Contract.signedAt + signedBy. First signature activates; re-sign keeps current live status.
          const nextContractStatus = freshContract.status === "approved" ? "active" : freshContract.status
          const contractCas = await tx.contract.updateMany({
            where: {
              id: contract.id,
              organizationId: contract.organizationId,
              status: freshContract.status,
              signedAt: freshContract.signedAt,
            },
            data: {
              signedAt: now,
              signedBy: `esign:${envelope.id}`,
              status: nextContractStatus,
            },
          })
          if (contractCas.count !== 1) {
            throw new SignConflictError("Contract state changed concurrently, retry")
          }

          // ── FIX C: Mint canonical signed ContractVersion from the BOUND body.
          //
          // signingBody is resolved in verifyAndLoad from the bound ContractVersion
          // (or falls back to Contract.renderedBody for legacy envelopes without a
          // bound version). This ensures the canonical version captures what was
          // actually displayed and signed — not a subsequent /amend body.
          //
          // Cross-check: if the fresh envelope still has a bound version, confirm
          // it hasn't been tampered (immutable by design — defense-in-depth only).
          const freshContractVersionId = (freshEnvelope as any)?.contractVersionId ?? envelope.contractVersionId
          const freshBoundContentHash = (freshEnvelope as any)?.boundContentHash ?? envelope.boundContentHash

          let canonicalBody = signingBody
          let canonicalContentHash = createHash("sha256").update(canonicalBody).digest("hex")

          if (freshContractVersionId && freshBoundContentHash) {
            // Read the bound version inside the tx to get the authoritative body
            const txBoundVersion = await tx.contractVersion.findUnique({
              where: { id: freshContractVersionId },
              select: { renderedBody: true, contentHash: true },
            })
            if (txBoundVersion) {
              if (txBoundVersion.contentHash !== freshBoundContentHash) {
                // Immutable version mutated — fail safe (should be impossible)
                throw new Error(
                  `[sign POST] Bound version integrity violation: envelope=${envelope.id} ` +
                  `stored=${freshBoundContentHash} actual=${txBoundVersion.contentHash}`
                )
              }
              canonicalBody = txBoundVersion.renderedBody ?? canonicalBody
              canonicalContentHash = txBoundVersion.contentHash
            }
          }

          const maxResult = await tx.$queryRaw<Array<{ max: number | null }>>`
            SELECT MAX("versionNo") as max
            FROM contract_versions
            WHERE "contractId" = ${contract.id}
          `
          const currentMax = maxResult[0]?.max ?? 0
          const nextVersionNo = (typeof currentMax === "number" ? currentMax : Number(currentMax ?? 0)) + 1

          // ── Slice 4a: canonical-swap — demote any prior canonical before minting
          // the new one. Without this, a signed amendment would violate the partial
          // unique index (one isCanonicalSigned=true per contract). The demote and the
          // new mint are inside the same transaction → atomic: either both land or
          // neither does. The old canonical is preserved in version history (just
          // isCanonicalSigned=false now).
          await tx.contractVersion.updateMany({
            where: { contractId: contract.id, isCanonicalSigned: true },
            data: { isCanonicalSigned: false },
          })

          await tx.contractVersion.create({
            data: {
              organizationId: contract.organizationId,
              contractId: contract.id,
              versionNo: nextVersionNo,
              renderedBody: canonicalBody || null,
              contentHash: canonicalContentHash,
              source: "signed",
              isCanonicalSigned: true,
              createdBy: `esign:${envelope.id}`,
            },
          })

          return { conflict: false, completed: true } as const
        } else if (suggestedEnvelopeStatus) {
          await tx.esignEnvelope.update({
            where: { id: envelope.id },
            data: { status: suggestedEnvelopeStatus },
          })
        }

        return { conflict: false, completed: false } as const
      })

      if (result.conflict) {
        return NextResponse.json({ error: "Already processed" }, { status: 409 })
      }

      envelopeCompleted = result.completed
      break // success — exit retry loop

    } catch (e) {
      if (e instanceof SignConflictError) {
        return NextResponse.json({ error: e.message }, { status: e.message === "Contract not found" ? 404 : 409 })
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 3) {
        // Unique constraint on (contractId, versionNo) — retry the entire tx
        continue
      }
      console.error("[sign POST] $transaction failed:", e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }

  // Best-effort: notify the contract owner on envelope completion.
  // NEVER block the public sign response on a notification error.
  if (envelopeCompleted && contract.createdBy) {
    ;(async () => {
      try {
        await createNotification({
          organizationId: contract.organizationId,
          userId: contract.createdBy!,
          type: "success",
          title: `Contract fully signed: ${contract.title}`,
          message: `All signers have completed the e-signature. Contract "${contract.title}" is now active.`,
          entityType: "contract",
          entityId: contract.id,
          kind: "contract.signed",
        })
      } catch {
        // Best-effort: suppress all errors
      }

      // Slack/Teams alert — best-effort, after in-app notification
      try {
        await sendContractAlert(contract.organizationId, "contract.signed", {
          contractNumber: contract.contractNumber,
          title: contract.title,
        })
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
        status: "signed",
        signedAt: now,
      },
      envelopeCompleted,
    },
  })
  })
}
