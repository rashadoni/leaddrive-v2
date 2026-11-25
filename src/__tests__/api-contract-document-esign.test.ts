/**
 * Signing a price protocol or an acceptance act through the contract's e-sign
 * flow (owner 2026-11-25, mock «Протокол цены и акт»).
 *
 * The danger: a document envelope that signs the wrong thing — the contract's
 * body, an edited document, or the contract itself. So, on the real token,
 * state-machine and audit helpers with Prisma stood in:
 *   - sending freezes the document's text and hash, and binds the envelope to it;
 *   - the signing page shows only that frozen text and fails closed on any mismatch;
 *   - completion marks the document signed and never touches the contract;
 *   - a decline or a recall makes the document a draft again and kills the links.
 */
import { createHash } from "crypto"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { issueToken } from "@/lib/esign/token-issuer"

const db = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    esignSigner: { findFirst: fn(), create: fn(), updateMany: fn(), count: fn(), findMany: fn() },
    esignEnvelope: { findFirst: fn(), findMany: fn(), create: fn(), update: fn(), updateMany: fn() },
    esignAuditEvent: { create: fn() },
    contractDocument: { findFirst: fn(), updateMany: fn() },
    contract: { findFirst: fn(), updateMany: fn() },
    contractVersion: { create: fn(), findUnique: fn(), updateMany: fn() },
    organization: { findUnique: fn() },
    $transaction: fn(),
    $queryRaw: fn(),
  }
})
vi.mock("@/lib/prisma", () => ({ prisma: db, logAudit: vi.fn() }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => ({})) }))
vi.mock("@/lib/integrations/contract-alerts", () => ({ sendContractAlert: vi.fn(async () => undefined) }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }))
vi.mock("@/lib/ticketing/customer-locale", () => ({ loadOrganizationLocale: vi.fn(async () => "az") }))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(async () => ({ orgId: "org-1", userId: "user-1", role: "manager", email: "m@x.az", name: "M" })),
  isAuthError: vi.fn((v: unknown) => v instanceof NextResponse),
}))

import { POST as sendDoc, DELETE as recallDoc } from "@/app/api/v1/contracts/[id]/documents/[docId]/esign/route"
import { GET as signGet, POST as signPost } from "@/app/api/v1/sign/[token]/route"
import { POST as decline } from "@/app/api/v1/sign/[token]/decline/route"
import { sendEmail } from "@/lib/email"

const SECRET = "test-secret-that-is-at-least-32-chars!!"
const ORG = "org-1"
const C = "ctr-1"
const DOC = "doc-1"
const ENV = "env-doc-1"
const SIGNER = "signer-1"
const FROZEN = "QİYMƏT RAZILAŞDIRMA PROTOKOLU\n…\n1. Taxta palet × 96,00 AZN"
const HASH = createHash("sha256").update(FROZEN).digest("hex")
const { token: TOKEN, tokenHash: TOKEN_HASH } = issueToken({ claims: { eid: ENV, sid: SIGNER, exp: Math.floor(Date.now() / 1000) + 86_400 }, secret: SECRET })

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })

const draftDoc = {
  id: DOC, contractId: C, kind: "price_protocol", number: 1, status: "draft", documentDate: new Date("2026-11-25T00:00:00Z"),
  validFrom: new Date("2026-11-25T00:00:00Z"), validTo: null, invoiceId: null, currency: "AZN", vatRate: "0.18",
  subtotal: "0", vatAmount: "0", totalAmount: "0", note: null, signedAt: null, createdAt: new Date(), updatedAt: new Date("2026-11-25T10:00:00Z"),
  invoice: null,
  lines: [{ id: "l1", position: 0, productId: null, name: "Taxta palet", unit: "ədəd", quantity: null, unitPrice: "96", amount: "0" }],
}
const contract = {
  id: C, contractNumber: "AS/2026-0775", title: "Alğı-satqı", status: "active", currency: "AZN", dealId: null, companyId: "co-1",
  endDate: null, signedAt: new Date("2026-11-25T09:00:00Z"), createdAt: new Date("2026-11-20T00:00:00Z"), company: { name: "Kaspi MMC", director: "F. Q." },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ESIGN_SECRET = SECRET
  process.env.NEXT_PUBLIC_BASE_URL = "https://app.example.com"
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => unknown) => cb(db))
  db.$queryRaw.mockResolvedValue([])
  db.organization.findUnique.mockResolvedValue({ name: "Org", settings: { invoice: { companyName: "Nümunə MMC" } } })
  db.contract.findFirst.mockResolvedValue(contract)
})
afterEach(() => {
  delete process.env.ESIGN_SECRET
  delete process.env.NEXT_PUBLIC_BASE_URL
})

describe("sending a protocol for signing", () => {
  beforeEach(() => {
    db.contractDocument.findFirst.mockResolvedValue(draftDoc)
    db.esignEnvelope.create.mockResolvedValue({ id: ENV })
    db.esignSigner.create.mockImplementation(async ({ data }: { data: { fullName: string; email: string } }) => ({ id: `s-${data.fullName}`, ...data }))
    db.esignSigner.updateMany.mockResolvedValue({ count: 1 })
    db.esignEnvelope.updateMany.mockResolvedValue({ count: 1 })
    db.contractDocument.updateMany.mockResolvedValue({ count: 1 })
  })
  const send = () => sendDoc(req(`/api/v1/contracts/${C}/documents/${DOC}/esign`, "POST", { signers: [{ fullName: "Rəşad", email: "r@x.az" }, { fullName: "Fərid", email: "f@kaspi.az" }] }), { params: Promise.resolve({ id: C, docId: DOC }) })

  it("freezes the document's text and binds the envelope to its hash, in one transaction", async () => {
    const res = await send()
    expect(res.status).toBe(201)
    // the envelope belongs to the contract and names the document
    expect(db.esignEnvelope.create.mock.calls[0][0].data).toMatchObject({ organizationId: ORG, contractId: C, documentId: DOC, status: "created" })
    const sent = db.esignEnvelope.updateMany.mock.calls[0][0]
    expect(sent.where).toEqual({ id: ENV, status: "created" })
    const frozen = db.contractDocument.updateMany.mock.calls[0][0]
    // only the very draft that was read — an edit in between refuses the send
    expect(frozen.where).toEqual({ id: DOC, contractId: C, organizationId: ORG, status: "draft", updatedAt: draftDoc.updatedAt })
    expect(frozen.data.status).toBe("in_signing")
    expect(frozen.data.signedBody).toContain("Taxta palet")
    expect(frozen.data.contentHash).toBe(createHash("sha256").update(frozen.data.signedBody).digest("hex"))
    expect(sent.data.boundContentHash).toBe(frozen.data.contentHash)
    // every signer got a token, and a link went out
    expect(db.esignSigner.updateMany).toHaveBeenCalledTimes(2)
    const json = await res.json()
    expect(json.data.signingLinks.map((l: { signingLink: string }) => l.signingLink.startsWith("https://app.example.com/sign/"))).toEqual([true, true])
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it("refuses when the document changed between reading and freezing", async () => {
    db.contractDocument.updateMany.mockResolvedValue({ count: 0 })
    const res = await send()
    expect(res.status).toBe(409)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("refuses a document that is not a draft, or has no lines", async () => {
    db.contractDocument.findFirst.mockResolvedValue({ ...draftDoc, status: "in_signing" })
    expect((await send()).status).toBe(409)
    db.contractDocument.findFirst.mockResolvedValue({ ...draftDoc, lines: [] })
    expect((await send()).status).toBe(400)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe("recalling a document from signing", () => {
  it("voids the open envelope, kills the unsigned links and makes the document a draft", async () => {
    db.contractDocument.findFirst.mockResolvedValue({ id: DOC, status: "in_signing" })
    db.esignEnvelope.findMany.mockResolvedValue([{ id: ENV, status: "in_progress" }])
    db.esignEnvelope.updateMany.mockResolvedValue({ count: 1 })
    db.esignSigner.updateMany.mockResolvedValue({ count: 1 })
    db.contractDocument.updateMany.mockResolvedValue({ count: 1 })
    const res = await recallDoc(req(`/api/v1/contracts/${C}/documents/${DOC}/esign`, "DELETE"), { params: Promise.resolve({ id: C, docId: DOC }) })
    expect(res.status).toBe(200)
    expect(db.esignEnvelope.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: ENV, status: "in_progress" }, data: { status: "voided", voidedBy: "user-1" } })
    expect(db.esignSigner.updateMany).toHaveBeenCalledWith({ where: { envelopeId: ENV, status: { in: ["pending", "sent", "viewed"] } }, data: { tokenHash: null } })
    expect(db.contractDocument.updateMany).toHaveBeenCalledWith({
      where: { id: DOC, contractId: C, organizationId: ORG, status: "in_signing" },
      data: { status: "draft", signedBody: null, contentHash: null },
    })
  })
})

const signer = {
  id: SIGNER, organizationId: ORG, envelopeId: ENV, fullName: "Fərid", email: "f@kaspi.az", order: 1, role: "signer", status: "sent",
  tokenHash: TOKEN_HASH, viewedAt: null, signedAt: null, declinedAt: null, declineReason: null, signatureMethod: null, createdAt: new Date(), updatedAt: new Date(),
}
const docEnvelope = (over: Record<string, unknown> = {}) => ({
  id: ENV, organizationId: ORG, contractId: C, subject: "QİYMƏT RAZILAŞDIRMA PROTOKOLU — AS/2026-0775", message: null, status: "sent",
  expiresAt: null, sentAt: new Date(), completedAt: null, createdAt: new Date(), updatedAt: new Date(),
  contractVersionId: null, boundContentHash: HASH, documentId: DOC,
  signers: [{ id: SIGNER, role: "signer", status: "sent" }],
  contract: { id: C, organizationId: ORG, title: "Alğı-satqı", contractNumber: "AS/2026-0775", renderedBody: "THE CONTRACT'S OWN BODY", status: "active", createdBy: "user-1" },
  document: { id: DOC, kind: "price_protocol", number: 1, status: "in_signing", signedBody: FROZEN, contentHash: HASH },
  ...over,
})

describe("the public signing page of a document envelope", () => {
  beforeEach(() => {
    db.esignSigner.findFirst.mockResolvedValue(signer)
    db.esignSigner.count.mockResolvedValue(0)
    db.esignSigner.updateMany.mockResolvedValue({ count: 1 })
  })

  it("shows the frozen document, never the contract's body", async () => {
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope())
    const res = await signGet(req(`/api/v1/sign/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.contract.renderedBody).toBe(FROZEN)
    expect(data.contract.title).toBe("QİYMƏT RAZILAŞDIRMA PROTOKOLU — AS/2026-0775")
    expect(JSON.stringify(data)).not.toContain("THE CONTRACT'S OWN BODY")
  })

  it("fails closed when the frozen text no longer matches its hash or the envelope's", async () => {
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope({ document: { id: DOC, kind: "price_protocol", number: 1, status: "in_signing", signedBody: `${FROZEN} (edited)`, contentHash: HASH } }))
    expect((await signGet(req(`/api/v1/sign/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) })).status).toBe(500)
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope({ boundContentHash: "f".repeat(64) }))
    expect((await signGet(req(`/api/v1/sign/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) })).status).toBe(500)
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope({ document: null }))
    expect((await signGet(req(`/api/v1/sign/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) })).status).toBe(500)
  })

  it("the last signature marks the document signed and leaves the contract alone", async () => {
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope())
    db.esignSigner.findFirst.mockResolvedValue(signer)
    db.esignEnvelope.update.mockResolvedValue({})
    db.contractDocument.updateMany.mockResolvedValue({ count: 1 })
    const res = await signPost(req(`/api/v1/sign/${TOKEN}`, "POST", { method: "typed", payload: { typedName: "Fərid", font: "dancing-script" } }), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(200)
    expect((await res.json()).data.envelopeCompleted).toBe(true)
    expect(db.esignEnvelope.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ENV }, data: expect.objectContaining({ status: "completed" }) }))
    expect(db.contractDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DOC, status: "in_signing", contentHash: HASH }, data: expect.objectContaining({ status: "signed" }) }),
    )
    expect(db.contract.updateMany).not.toHaveBeenCalled()
    expect(db.contractVersion.create).not.toHaveBeenCalled()
  })

  it("refuses the completion when the document is no longer the one bound", async () => {
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope())
    db.contractDocument.updateMany.mockResolvedValue({ count: 0 })
    const res = await signPost(req(`/api/v1/sign/${TOKEN}`, "POST", { method: "typed", payload: { typedName: "Fərid", font: "dancing-script" } }), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(409)
  })

  it("a decline sends the document back to a draft", async () => {
    db.esignEnvelope.findFirst.mockResolvedValue(docEnvelope())
    db.esignEnvelope.update.mockResolvedValue({})
    db.contractDocument.updateMany.mockResolvedValue({ count: 1 })
    const res = await decline(req(`/api/v1/sign/${TOKEN}/decline`, "POST", { reason: "Qiymət səhvdir" }), { params: Promise.resolve({ token: TOKEN }) })
    expect(res.status).toBe(200)
    expect(db.contractDocument.updateMany).toHaveBeenCalledWith({ where: { id: DOC, status: "in_signing" }, data: { status: "draft", signedBody: null, contentHash: null } })
  })
})
