/**
 * Signing a price protocol or an acceptance act (owner 2026-11-25, mock
 * «Протокол цены и акт») — the contract's own e-sign flow, pointed at a document.
 *
 * POST   { signers, subject?, message?, expiresInDays?, lang? }
 *        — freezes the document's text (signedBody + its SHA-256), makes an
 *          envelope of the contract that names the document and carries that
 *          hash as boundContentHash, issues each signer's HMAC token and sends
 *          the links. The document becomes «in_signing» and can no longer be
 *          edited: what is signed is what was sent. All of it in one
 *          transaction, under a lock on the contract row.
 * GET    — this document's envelopes with their signers (never tokens or payloads).
 * DELETE — recalls the document from signing: the open envelope is voided,
 *          the unsigned links die, and the document is a draft again.
 *
 * The public signing route (src/app/api/v1/sign/[token]) shows the frozen
 * text, checks its hash and, when everyone signed, marks the document signed —
 * the contract itself is never touched by a document's envelope.
 */
import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { issueToken } from "@/lib/esign/token-issuer"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import { canEnvelopeTransition } from "@/lib/esign/state-machine"
import { sendEmail } from "@/lib/email"
import { signingEmail } from "@/lib/contract-lifecycle/notification-text"
import { loadOrganizationLocale } from "@/lib/ticketing/customer-locale"
import { documentSigningText, documentWords } from "@/lib/clm/contract-documents"
import { DOCUMENT_SELECT, LINE_SELECT, documentFacts, lineRow, loadContractForDocuments, loadInvoiceSettings } from "@/lib/clm/contract-documents-server"
import type { EnvelopeStatus } from "@/lib/esign/types"

type Params = { params: Promise<{ id: string; docId: string }> }

function baseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")
  const proto = req.headers.get("x-forwarded-proto") ?? "https"
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000"
  return `${proto}://${host}`
}

class Conflict extends Error {}

const SIGNER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  order: true,
  role: true,
  status: true,
  viewedAt: true,
  signedAt: true,
  declinedAt: true,
  signatureMethod: true,
  signedIpAddress: true,
} as const

export const GET = withRlsAuth("contracts", "read", async (_req, { orgId }, { params }: Params) => {
  const { id: contractId, docId } = await params
  try {
    const doc = await prisma.contractDocument.findFirst({ where: { id: docId, contractId, organizationId: orgId }, select: { id: true, contentHash: true } })
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const envelopes = await prisma.esignEnvelope.findMany({
      where: { organizationId: orgId, contractId, documentId: docId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        subject: true,
        status: true,
        sentAt: true,
        completedAt: true,
        expiresAt: true,
        voidedAt: true,
        boundContentHash: true,
        signers: { orderBy: { order: "asc" }, select: SIGNER_SELECT },
      },
    })
    return NextResponse.json({ success: true, data: { envelopes } })
  } catch (e) {
    console.error("[documents/:docId/esign GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const signerSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  email: z.string().trim().email(),
  order: z.number().int().positive().optional(),
  role: z.enum(["signer", "cc", "copy"]).optional().default("signer"),
})

const postSchema = z.object({
  signers: z.array(signerSchema).min(1).max(10),
  subject: z.string().trim().min(1).max(500).optional(),
  message: z.string().max(2000).optional(),
  expiresInDays: z.number().int().positive().max(365).optional().default(30),
  lang: z.enum(["az", "ru", "en"]).optional().default("az"),
})

export const POST = withRlsAuth("contracts", "write", async (req, { orgId, userId }, { params }: Params) => {
  const { id: contractId, docId } = await params
  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const input = parsed.data
  if (!input.signers.some((s) => s.role === "signer")) {
    return NextResponse.json({ error: "At least one signer is required", code: "NO_SIGNER" }, { status: 400 })
  }
  const secret = process.env.ESIGN_SECRET
  if (!secret) return NextResponse.json({ error: "E-sign is not configured (missing secret)", errorKey: "esignNotConfigured" }, { status: 500 })

  try {
    const [doc, contract, settings] = await Promise.all([
      prisma.contractDocument.findFirst({
        where: { id: docId, contractId, organizationId: orgId },
        select: { ...DOCUMENT_SELECT, lines: { orderBy: { position: "asc" }, select: LINE_SELECT } },
      }),
      loadContractForDocuments(orgId, contractId),
      loadInvoiceSettings(orgId),
    ])
    if (!doc || !contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (doc.status !== "draft") return NextResponse.json({ error: "Only a draft goes for signing", code: "NOT_DRAFT", status: doc.status }, { status: 409 })
    if (doc.lines.length === 0) return NextResponse.json({ error: "The document has no lines", code: "NO_LINES" }, { status: 400 })

    const facts = documentFacts(doc, contract, settings)
    const lines = doc.lines.map(lineRow)
    const body = documentSigningText(facts, lines, doc.currency, input.lang)
    const contentHash = createHash("sha256").update(body).digest("hex")
    const words = documentWords(facts, input.lang)
    const subject = input.subject ?? `${words.title} — ${contract.contractNumber}`
    const now = new Date()
    const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000)
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null
    const ua = req.headers.get("user-agent") ?? null
    const tokens = new Map<string, string>()

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} AND "organizationId" = ${orgId} FOR UPDATE`
      const envelope = await tx.esignEnvelope.create({
        data: { organizationId: orgId, contractId, documentId: docId, subject, message: input.message ?? null, status: "created", expiresAt, createdBy: userId },
      })
      const signers = []
      for (const [index, s] of input.signers.entries()) {
        signers.push(
          await tx.esignSigner.create({
            data: { organizationId: orgId, envelopeId: envelope.id, fullName: s.fullName, email: s.email, order: s.order ?? index + 1, role: s.role, status: "pending" },
          }),
        )
      }
      const exp = Math.floor(expiresAt.getTime() / 1000)
      for (const signer of signers) {
        const { token, tokenHash } = issueToken({ claims: { eid: envelope.id, sid: signer.id, exp }, secret })
        tokens.set(signer.id, token)
        const cas = await tx.esignSigner.updateMany({ where: { id: signer.id, status: "pending" }, data: { tokenHash, status: "sent" } })
        if (cas.count !== 1) throw new Conflict("Signer state changed concurrently")
      }
      if (!canEnvelopeTransition("created", "sent").ok) throw new Conflict("Envelope cannot be sent")
      const sent = await tx.esignEnvelope.updateMany({
        where: { id: envelope.id, status: "created" },
        data: { status: "sent", sentAt: now, boundContentHash: contentHash },
      })
      if (sent.count !== 1) throw new Conflict("Envelope state changed concurrently")
      // The document freezes only if it is still the draft we read: an edit in between refuses the send.
      const frozen = await tx.contractDocument.updateMany({
        where: { id: docId, contractId, organizationId: orgId, status: "draft", updatedAt: doc.updatedAt },
        data: { status: "in_signing", signedBody: body, contentHash },
      })
      if (frozen.count !== 1) throw new Conflict("The document changed while it was being sent — open it again")
      for (const [eventType, meta] of [
        ["envelope_created", { contractId, documentId: docId }],
        ["envelope_sent", { contractId, documentId: docId, signerCount: signers.length }],
      ] as const) {
        const audit = buildAuditEvent({
          organizationId: orgId,
          envelopeId: envelope.id,
          signerId: null,
          eventType,
          actorType: userId ? "user" : "system",
          actorId: userId ?? undefined,
          ipAddress: ip,
          userAgent: ua,
          metadata: meta,
          at: now,
        })
        if (!audit.ok) throw new Error(`buildAuditEvent ${eventType} failed: ${audit.error}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.esignAuditEvent.create({ data: audit.record as any })
      }
      return { envelope: { id: envelope.id, subject, status: "sent", sentAt: now, expiresAt }, signers }
    })

    const links = result.signers.map((s: { id: string; fullName: string; email: string }) => ({
      signerId: s.id,
      fullName: s.fullName,
      email: s.email,
      signingLink: `${baseUrl(req)}/sign/${tokens.get(s.id)}`,
    }))
    try {
      const locale = await loadOrganizationLocale(orgId)
      for (const link of links) {
        const email = signingEmail(locale, { kind: "invitation", fullName: link.fullName, subject, message: input.message ?? null, signingLink: link.signingLink })
        await sendEmail({ to: link.email, subject: email.subject, html: email.html, organizationId: orgId, transactional: true })
      }
    } catch (err) {
      console.error("[documents/:docId/esign POST] best-effort email failed (non-fatal):", err)
    }
    logAudit(orgId, "send_for_signature", "contract_document", docId, subject, { newValue: { envelopeId: result.envelope.id, contentHash }, ...(userId ? { userId } : {}) })
    return NextResponse.json({ success: true, data: { envelope: result.envelope, signingLinks: links } }, { status: 201 })
  } catch (e) {
    if (e instanceof Conflict) return NextResponse.json({ error: e.message, code: "CONFLICT" }, { status: 409 })
    console.error("[documents/:docId/esign POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "write", async (req, { orgId, userId }, { params }: Params) => {
  const { id: contractId, docId } = await params
  try {
    const doc = await prisma.contractDocument.findFirst({ where: { id: docId, contractId, organizationId: orgId }, select: { id: true, status: true } })
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (doc.status !== "in_signing") return NextResponse.json({ error: "The document is not in signing", code: "NOT_IN_SIGNING", status: doc.status }, { status: 409 })
    const now = new Date()
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} AND "organizationId" = ${orgId} FOR UPDATE`
      const open = await tx.esignEnvelope.findMany({
        where: { organizationId: orgId, contractId, documentId: docId, status: { in: ["created", "sent", "in_progress"] } },
        select: { id: true, status: true },
      })
      for (const env of open) {
        if (!canEnvelopeTransition(env.status as EnvelopeStatus, "voided").ok) continue
        const voided = await tx.esignEnvelope.updateMany({
          where: { id: env.id, status: env.status },
          data: { status: "voided", voidedAt: now, voidedBy: userId ?? "system", voidReason: "recalled" },
        })
        if (voided.count !== 1) throw new Conflict("The envelope changed concurrently")
        // Every unsigned link dies with the envelope.
        await tx.esignSigner.updateMany({ where: { envelopeId: env.id, status: { in: ["pending", "sent", "viewed"] } }, data: { tokenHash: null } })
        const audit = buildAuditEvent({
          organizationId: orgId,
          envelopeId: env.id,
          signerId: null,
          eventType: "envelope_voided",
          actorType: userId ? "user" : "system",
          actorId: userId ?? undefined,
          ipAddress: req.headers.get("x-forwarded-for") ?? null,
          userAgent: req.headers.get("user-agent") ?? null,
          metadata: { documentId: docId, reason: "recalled" },
          at: now,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (audit.ok) await tx.esignAuditEvent.create({ data: audit.record as any })
      }
      const back = await tx.contractDocument.updateMany({
        where: { id: docId, contractId, organizationId: orgId, status: "in_signing" },
        data: { status: "draft", signedBody: null, contentHash: null },
      })
      if (back.count !== 1) throw new Conflict("The document changed concurrently")
    })
    logAudit(orgId, "recall_signature", "contract_document", docId, docId, userId ? { userId } : undefined)
    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof Conflict) return NextResponse.json({ error: e.message, code: "CONFLICT" }, { status: 409 })
    console.error("[documents/:docId/esign DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
