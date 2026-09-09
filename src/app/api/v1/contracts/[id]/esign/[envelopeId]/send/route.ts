/**
 * CLM Slice 2a — Send an e-sign envelope.
 * CLM Slice 7d — provider seam (native only; external sends hard-gated).
 *
 * POST /api/v1/contracts/:id/esign/:envelopeId/send
 *
 * Validates the envelope belongs to the contract + org, checks the state-
 * machine transition (created → sent), issues HMAC tokens per signer,
 * stores tokenHash in the DB, marks signers as "sent", marks the envelope
 * as "sent", appends an envelope_sent audit event, and best-effort emails
 * each signer a signing link. All multi-write ops run in a $transaction.
 *
 * FIX B (Slice 4a integrity): at send time, find-or-mint a ContractVersion
 * whose contentHash matches the contract's current renderedBody. The envelope
 * is pinned to that version (contractVersionId + boundContentHash). The sign
 * flow then reads the BOUND version's body — never the live Contract.renderedBody
 * — so a subsequent /amend cannot change what the signers are asked to sign.
 *
 * Slice 7d provider seam (Codex hardening):
 *   • Accepts an optional `provider` field in the POST body (default "native").
 *   • If provider !== "native" → HARD REJECT with 501 immediately, before
 *     touching any config, envelope, or running the native preflight.
 *     This gate is lifted once the external provider path replicates ALL
 *     native invariants — see PARITY INVARIANTS comment below.
 *   • If provider === "native" (or absent) → the EXISTING hardened native flow
 *     runs byte-for-byte unchanged.
 *
 * PARITY INVARIANTS — a real external provider MUST implement ALL of these
 * before this gate is lifted (see [P3] in memory/deferred_findings.md):
 *   1. Contract lifecycle preflight guard (only approved/live contracts can be signed).
 *   2. created → sent CAS state-machine transition (canEnvelopeTransition).
 *   3. Immutable ContractVersion binding + boundContentHash (FIX B).
 *   4. Signer HMAC token / CAS (or provider-equivalent with same guarantees).
 *   5. Transactional persistence: provider, externalEnvelopeId, providerConfigId,
 *      status='sent', sentAt — all committed atomically.
 *   6. Audit event (envelope_sent) written in the same transaction.
 *   Only after ALL six are replicated may this early-501 guard be removed.
 *
 * Returns the updated envelope + signers + signing links (so the sender
 * can copy them if email delivery isn't configured).
 *
 * Security constraints:
 *   • tokenHash stored in DB; raw token only travels over email / response.
 *   • signaturePayload NEVER returned.
 *   • Cross-tenant guard: contract and envelope both validated against orgId.
 */
import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"
import { findResidualVars } from "@/lib/clm/residual-vars"
import { canEnvelopeTransition } from "@/lib/esign/state-machine"
import { issueToken } from "@/lib/esign/token-issuer"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import { sendEmail } from "@/lib/email"
import { getContractSignatureEligibilityError } from "@/lib/clm/signature-eligibility"

// ─── Signing-link base URL ────────────────────────────────────────────────────

function getBaseUrl(req: NextRequest): string {
  // Prefer explicit env var; fall back to request origin for local dev.
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")
  const proto = req.headers.get("x-forwarded-proto") ?? "https"
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000"
  return `${proto}://${host}`
}

class SendConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SendConflictError"
  }
}

// ─── POST — send envelope ─────────────────────────────────────────────────────

export const POST = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string; envelopeId: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id: contractId, envelopeId } = await params

  // ── Slice 7d: read optional provider from body (default "native") ─────────
  // Parse body once so the native path can re-use parsed data below.
  let bodyJson: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    if (raw) bodyJson = JSON.parse(raw)
  } catch {
    // Body may be empty (no-op for native); ignore parse errors
  }
  const requestedProvider = (typeof bodyJson.provider === "string" ? bodyJson.provider : "native") || "native"

  // ── Slice 7d (Codex hardening): hard-reject non-native sends EARLY ────────
  //
  // External provider sending is DISABLED until the provider path replicates
  // ALL native invariants (see PARITY INVARIANTS in the file header).
  // This check fires BEFORE any config resolution, envelope DB touch, or
  // native preflight — so no partial non-native send path can execute.
  //
  // The provider seam (EsignProviderConfig CRUD, resolver, UI) is KEPT —
  // operators may still store DocuSign credentials; only SENDING via an
  // external provider is gated off.
  //
  // To lift this gate: implement ALL six PARITY INVARIANTS listed in the
  // file header, then remove this block and wire the resolved provider.
  if (requestedProvider !== "native") {
    return NextResponse.json(
      {
        error:
          "External e-signature providers (e.g. DocuSign) are not yet available for sending — use the native provider.",
        hint: "Omit the `provider` field or set it to \"native\" to use the hardened native e-sign flow.",
      },
      { status: 501 }
    )
  }

  // ── Below: NATIVE PATH — byte-for-byte unchanged from Slice 2a ───────────

  const esignSecret = process.env.ESIGN_SECRET
  if (!esignSecret) {
    console.error("[esign/send] ESIGN_SECRET env var is not set")
    return NextResponse.json({ error: "E-sign is not configured (missing secret)", errorKey: "esignNotConfigured" }, { status: 500 })
  }

  try {
    // ── Load envelope + verify it belongs to this contract + org ──────────────
    const envelope = await prisma.esignEnvelope.findFirst({
      where: { id: envelopeId, contractId, organizationId: orgId },
      include: {
        signers: { orderBy: { order: "asc" } },
        contract: {
          select: {
            id: true,
            title: true,
            status: true,
            signedAt: true,
            renderedBody: true,
          },
        },
      },
    })
    if (!envelope) {
      return NextResponse.json({ error: "Envelope not found" }, { status: 404 })
    }

    const eligibilityError = getContractSignatureEligibilityError({
      status: (envelope as any).contract?.status,
      signedAt: (envelope as any).contract?.signedAt ?? null,
    })
    if (eligibilityError) {
      return NextResponse.json({ error: eligibilityError }, { status: 409 })
    }

    // ── State-machine transition guard: created → sent ────────────────────────
    const transition = canEnvelopeTransition(
      envelope.status as Parameters<typeof canEnvelopeTransition>[0],
      "sent"
    )
    if (!transition.ok) {
      return NextResponse.json({ error: transition.error }, { status: 409 })
    }

    // ── FIX B: find-or-mint the ContractVersion for the current body ──────────
    //
    // The envelope must be pinned at send time to the exact body being sent.
    // Strategy:
    //   1. Compute SHA-256 of the current Contract.renderedBody.
    //   2. Find a ContractVersion for this contract with matching contentHash.
    //   3. If none found, mint a new one (source = "draft", CAS on versionNo).
    // The envelope is then updated with contractVersionId + boundContentHash
    // inside the main $transaction below.
    const currentRenderedBody = (envelope as any).contract?.renderedBody ?? ""

    // Codex HIGH (Step 5): the AUTHORITATIVE residual-variable gate. The submit
    // route checks too, but the body stays editable in pending/approved/renewing
    // states, so a {{var}} can be (re)introduced after submit — this is the last
    // line before the body is bound to an envelope + sent for signature.
    const unresolvedVars = findResidualVars(currentRenderedBody)
    if (unresolvedVars.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot send for signature — the body has unresolved variables: ${unresolvedVars.slice(0, 10).join(", ")}`,
          code: "UNRESOLVED_VARIABLES",
          variables: unresolvedVars,
        },
        { status: 400 },
      )
    }

    const currentContentHash = createHash("sha256").update(currentRenderedBody).digest("hex")

    // Find the latest existing version with matching hash (immutable — safe to reuse)
    let boundVersion = await prisma.contractVersion.findFirst({
      where: { contractId, contentHash: currentContentHash },
      orderBy: { versionNo: "desc" },
      select: { id: true, versionNo: true, contentHash: true },
    })

    if (!boundVersion) {
      // Mint a version pinning the current body. CAS on versionNo (retry ≤3 on P2002).
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          const maxResult = await prisma.$queryRaw<Array<{ max: number | null }>>`
            SELECT MAX("versionNo") as max
            FROM contract_versions
            WHERE "contractId" = ${contractId}
          `
          const currentMax = maxResult[0]?.max ?? 0
          const nextVersionNo = (typeof currentMax === "number" ? currentMax : Number(currentMax ?? 0)) + 1

          const userId = session?.userId ?? null
          boundVersion = await prisma.contractVersion.create({
            data: {
              organizationId: orgId,
              contractId,
              versionNo: nextVersionNo,
              renderedBody: currentRenderedBody || null,
              contentHash: currentContentHash,
              source: "draft",
              isCanonicalSigned: false,
              createdBy: userId ?? "esign:send",
            },
            select: { id: true, versionNo: true, contentHash: true },
          })
          break
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2002" &&
            attempt < 3
          ) {
            continue // unique constraint on (contractId, versionNo) — retry
          }
          throw e
        }
      }
    }

    if (!boundVersion) {
      console.error("[esign/send] Failed to find or mint a ContractVersion for binding")
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    // ── Derive envelope expiry for token exp claim ────────────────────────────
    const expiryUnix = envelope.expiresAt
      ? Math.floor(envelope.expiresAt.getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30-day fallback

    // ── Issue tokens + capture DB writes ─────────────────────────────────────
    const tokenMap: Map<string, string> = new Map() // signerId → rawToken

    for (const signer of envelope.signers as Array<{ id: string }>) {
      const { token, tokenHash } = issueToken({
        claims: { eid: envelope.id, sid: signer.id, exp: expiryUnix },
        secret: esignSecret,
      })
      tokenMap.set(signer.id, token)
      // tokenHash is stored below inside the $transaction
      tokenMap.set(`${signer.id}:hash`, tokenHash)
    }

    const now = new Date()
    const ipAddress = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null
    const userAgent = req.headers.get("user-agent") ?? null
    const userId = session?.userId ?? null
    const baseUrl = getBaseUrl(req)

    // ── Build audit event record ──────────────────────────────────────────────
    const auditBuild = buildAuditEvent({
      organizationId: orgId,
      envelopeId: envelope.id,
      signerId: null, // envelope-scoped event
      eventType: "envelope_sent",
      actorType: userId ? "user" : "system",
      actorId: userId ?? undefined,
      ipAddress,
      userAgent,
      metadata: { contractId, signerCount: envelope.signers.length },
      at: now,
    })
    if (!auditBuild.ok) {
      console.error("[esign/send] buildAuditEvent failed:", auditBuild.error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }

    // ── Atomic $transaction ───────────────────────────────────────────────────
    const [updatedEnvelope, updatedSigners] = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} AND "organizationId" = ${orgId} FOR UPDATE`

        const lockedContract = await tx.contract.findFirst({
          where: { id: contractId, organizationId: orgId },
          select: { status: true, signedAt: true },
        })
        if (!lockedContract) {
          throw new SendConflictError("Contract not found")
        }

        const lockedEligibilityError = getContractSignatureEligibilityError(lockedContract)
        if (lockedEligibilityError) {
          throw new SendConflictError(lockedEligibilityError)
        }

        // 1. Mark envelope as "sent" and bind to the version snapshot. The status
        // guard is a CAS so concurrent sends cannot issue two live token batches.
        const envCas = await tx.esignEnvelope.updateMany({
          where: {
            id: envelope.id,
            contractId,
            organizationId: orgId,
            status: "created",
          },
          data: {
            status: "sent",
            sentAt: now,
            // FIX B: pin envelope to the immutable version
            contractVersionId: boundVersion!.id,
            boundContentHash: boundVersion!.contentHash,
          },
        })
        if (envCas.count !== 1) {
          throw new SendConflictError("Envelope state changed concurrently, retry")
        }

        // 2. Update each signer: tokenHash + status "sent". Each signer also
        // uses a status CAS so a partial/manual transition rolls the tx back.
        for (const signer of envelope.signers as Array<{ id: string }>) {
          const signerCas = await tx.esignSigner.updateMany({
            where: {
              id: signer.id,
              envelopeId: envelope.id,
              organizationId: orgId,
              status: "pending",
            },
            data: {
              tokenHash: tokenMap.get(`${signer.id}:hash`) ?? null,
              status: "sent",
            },
          })
          if (signerCas.count !== 1) {
            throw new SendConflictError("Signer state changed concurrently, retry")
          }
        }

        // 3. Append audit event
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.esignAuditEvent.create({ data: auditBuild.record as any })

        const env = await tx.esignEnvelope.findUniqueOrThrow({
          where: { id: envelope.id },
        })
        const signerUpdates = await tx.esignSigner.findMany({
          where: { envelopeId: envelope.id, organizationId: orgId },
          orderBy: { order: "asc" },
        })

        return [env, signerUpdates]
      }
    )

    // ── Build signing links ───────────────────────────────────────────────────
    const signingLinks = (updatedSigners as Array<{ id: string; fullName: string; email: string }>).map((signer) => ({
      signerId: signer.id,
      fullName: signer.fullName,
      email: signer.email,
      signingLink: `${baseUrl}/sign/${tokenMap.get(signer.id)}`,
    }))

    // ── Best-effort email to each signer ─────────────────────────────────────
    // Wrapped in try/catch — email failure MUST NOT fail the response.
    try {
      for (const link of signingLinks) {
        await sendEmail({
          to: link.email,
          subject: `[Action Required] Please sign: ${envelope.subject}`,
          html: buildSigningEmailHtml({
            fullName: link.fullName,
            subject: envelope.subject,
            message: envelope.message,
            signingLink: link.signingLink,
          }),
          organizationId: orgId,
          transactional: true,
        })
      }
    } catch (emailErr) {
      console.error("[esign/send] Best-effort email failed (non-fatal):", emailErr)
      // Intentionally swallowed — signing links are returned in the response.
    }

    return NextResponse.json({
      success: true,
      data: {
        envelope: {
          id: updatedEnvelope.id,
          contractId: updatedEnvelope.contractId,
          organizationId: updatedEnvelope.organizationId,
          subject: updatedEnvelope.subject,
          message: updatedEnvelope.message,
          status: updatedEnvelope.status,
          expiresAt: updatedEnvelope.expiresAt,
          sentAt: updatedEnvelope.sentAt,
          completedAt: updatedEnvelope.completedAt,
          contractVersionId: updatedEnvelope.contractVersionId,
          boundContentHash: updatedEnvelope.boundContentHash,
          createdAt: updatedEnvelope.createdAt,
          updatedAt: updatedEnvelope.updatedAt,
        },
        signers: (updatedSigners as Array<{ id: string; fullName: string; email: string; order: number; role: string; status: string; signedAt: Date | null; declinedAt: Date | null; viewedAt: Date | null; createdAt: Date }>).map((s) => ({
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
        signingLinks,
      },
    })
  } catch (e) {
    if (e instanceof SendConflictError) {
      return NextResponse.json({ error: e.message }, { status: e.message === "Contract not found" ? 404 : 409 })
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") {
        return NextResponse.json({ error: "Envelope or signer not found" }, { status: 404 })
      }
    }
    console.error("[contracts/:id/esign/:envelopeId/send POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── Email template ───────────────────────────────────────────────────────────

function buildSigningEmailHtml({
  fullName,
  subject,
  message,
  signingLink,
}: {
  fullName: string
  subject: string
  message: string | null
  signingLink: string
}): string {
  const safeFullName = htmlEscape(fullName)
  const safeSubject = htmlEscape(subject)
  const safeMessage = message ? `<p style="color:#555">${htmlEscape(message)}</p>` : ""
  const safeLink = htmlEscape(signingLink)

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Document signing request</title></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a2e">You have a document to sign</h2>
  <p>Hello ${safeFullName},</p>
  <p>You have been asked to review and sign the following document:</p>
  <p><strong>${safeSubject}</strong></p>
  ${safeMessage}
  <p style="margin:32px 0">
    <a href="${safeLink}"
       style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Review &amp; Sign Document
    </a>
  </p>
  <p style="color:#888;font-size:12px">
    Or copy this link into your browser:<br>
    <a href="${safeLink}" style="color:#4f46e5;word-break:break-all">${safeLink}</a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#aaa;font-size:11px">
    This is a transactional email. Do not forward this link — it is unique to you.
  </p>
</body>
</html>`
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
