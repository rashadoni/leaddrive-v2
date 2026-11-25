/**
 * The counterparty's cabinet in the client portal — «Sənədlər» (owner
 * 2026-11-25, mock «Кабинет контрагента»; rules in src/lib/portal-documents.ts).
 *
 * What a portal contact may see and do, with Prisma and the portal session
 * stood in and the real token, audit and visibility rules:
 *   - nothing without the «Sənədlər» switch, a company and the Contracts module;
 *   - only the company's agreed contracts, sent or signed documents, issued invoices;
 *   - no PDF of a contract that is not theirs, nor of a draft document;
 *   - «İmzala» only for the signer they are, by e-mail, on a live envelope — a fresh
 *     token replaces the stored one;
 *   - the switch in «Settings → Portal users» needs portal access and a company.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/esign/token-issuer"

const db = vi.hoisted(() => {
  const fn = () => vi.fn()
  return {
    contact: { findFirst: fn(), updateMany: fn() },
    contract: { findFirst: fn(), findMany: fn() },
    contractDocument: { findMany: fn() },
    invoice: { findMany: fn() },
    esignEnvelope: { findMany: fn() },
    esignSigner: { findFirst: fn(), updateMany: fn() },
    esignAuditEvent: { create: fn() },
    contractVersion: { findFirst: fn() },
    auditLog: { create: fn() },
    $transaction: fn(),
  }
})
const portal = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }))
vi.mock("@/lib/prisma", () => ({ prisma: db, logAudit: vi.fn() }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: vi.fn(async () => portal.user) }))
vi.mock("@/lib/api-auth", () => ({
  orgHasModule: vi.fn(async () => true),
  requireAuth: vi.fn(async () => ({ orgId: "org-1", userId: "admin-1", role: "admin", email: "a@x.az", name: "A" })),
  isAuthError: (v: unknown) => v instanceof NextResponse,
  getSession: vi.fn(async () => ({ userId: "admin-1", orgId: "org-1", role: "admin" })),
}))
vi.mock("@/lib/clm/contract-pdf-files", () => ({
  buildContractPdfFile: vi.fn(async () => ({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]), filename: "c.pdf" })),
  buildDocumentPdfFile: vi.fn(async () => ({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]), filename: "d.pdf" })),
  pdfResponseHeaders: () => ({ "Content-Type": "application/pdf" }),
}))

import { GET as listDocs } from "@/app/api/v1/public/portal-documents/route"
import { GET as contractView } from "@/app/api/v1/public/portal-documents/[contractId]/route"
import { GET as portalPdf } from "@/app/api/v1/public/portal-documents/[contractId]/pdf/route"
import { POST as portalSign } from "@/app/api/v1/public/portal-documents/sign/route"
import { orgHasModule } from "@/lib/api-auth"
import { buildDocumentPdfFile, buildContractPdfFile } from "@/lib/clm/contract-pdf-files"

const SECRET = "test-secret-that-is-at-least-32-chars!!"
const ORG = "org-1"
const CO = "co-kaspi"
const user = { contactId: "ct-1", organizationId: ORG, companyId: CO, fullName: "Fərid", email: "f@kaspi.az" }
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ESIGN_SECRET = SECRET
  portal.user = user
  db.contact.findFirst.mockResolvedValue({ portalDocumentsEnabled: true, companyId: CO, email: "f@kaspi.az" })
  vi.mocked(orgHasModule).mockResolvedValue(true)
  db.$transaction.mockImplementation(async (cb: (tx: typeof db) => unknown) => cb(db))
})
afterEach(() => {
  delete process.env.ESIGN_SECRET
})

describe("who may open «Sənədlər»", () => {
  it("nobody without a portal session, the switch, a company or the Contracts module", async () => {
    portal.user = null
    expect((await listDocs()).status).toBe(401)
    portal.user = user
    db.contact.findFirst.mockResolvedValue({ portalDocumentsEnabled: false, companyId: CO, email: "f@kaspi.az" })
    expect((await listDocs()).status).toBe(403)
    db.contact.findFirst.mockResolvedValue({ portalDocumentsEnabled: true, companyId: null, email: "f@kaspi.az" })
    expect((await listDocs()).status).toBe(403)
    db.contact.findFirst.mockResolvedValue({ portalDocumentsEnabled: true, companyId: CO, email: "f@kaspi.az" })
    vi.mocked(orgHasModule).mockResolvedValue(false)
    expect((await listDocs()).status).toBe(403)
    expect(db.contract.findMany).not.toHaveBeenCalled()
  })
})

describe("what the cabinet lists", () => {
  it("only the company's agreed contracts, and what waits for this person's signature", async () => {
    db.contract.findMany.mockResolvedValue([{ id: "c1", contractNumber: "AS/1", title: "Alğı-satqı", status: "active", startDate: null, endDate: null, signedAt: new Date() }])
    db.esignEnvelope.findMany.mockResolvedValue([
      {
        id: "env-1", status: "sent", subject: "QİYMƏT RAZILAŞDIRMA PROTOKOLU — AS/1", sentAt: new Date("2026-12-01"), expiresAt: null, documentId: "pp-2",
        contract: { id: "c1", contractNumber: "AS/1", title: "Alğı-satqı" }, document: { kind: "price_protocol", number: 2 },
        signers: [
          { id: "s-ours", email: "r@nümunə.az", role: "signer", status: "signed", order: 1 },
          { id: "s-farid", email: "F@Kaspi.az", role: "signer", status: "sent", order: 2 },
          { id: "s-cc", email: "f@kaspi.az", role: "cc", status: "sent", order: 3 },
        ],
      },
    ])
    const res = await listDocs()
    const { data } = await res.json()
    const where = db.contract.findMany.mock.calls[0][0].where
    expect(where).toEqual({ organizationId: ORG, companyId: CO, status: { in: ["approved", "active", "renewing", "renewed", "expired", "terminated"] } })
    expect(db.esignEnvelope.findMany.mock.calls[0][0].where.contract).toEqual(where)
    expect(data.contracts[0]).toMatchObject({ id: "c1", signed: true })
    // the signer by e-mail, any case; never a copy recipient
    expect(data.waiting).toEqual([
      expect.objectContaining({ signerId: "s-farid", kind: "price_protocol", number: 2, title: "QİYMƏT RAZILAŞDIRMA PROTOKOLU — AS/1", canSignNow: true }),
    ])
  })

  it("a contract shows only sent or signed documents and issued invoices, opened by their view link", async () => {
    db.contract.findFirst.mockResolvedValue({ id: "c1", contractNumber: "AS/1", title: "T", status: "active", startDate: null, endDate: null, signedAt: null, currency: "AZN", valueAmount: null })
    db.contractDocument.findMany.mockResolvedValue([])
    db.invoice.findMany.mockResolvedValue([{ id: "inv-1", invoiceNumber: "INV-1", status: "sent", totalAmount: "100", currency: "AZN", issueDate: new Date(), viewToken: "tok 1" }])
    db.esignEnvelope.findMany.mockResolvedValue([])
    db.contractVersion.findFirst.mockResolvedValue(null)
    const res = await contractView(req("/api/v1/public/portal-documents/c1"), { params: Promise.resolve({ contractId: "c1" }) })
    const { data } = await res.json()
    expect(db.contract.findFirst.mock.calls[0][0].where).toMatchObject({ id: "c1", companyId: CO, organizationId: ORG })
    expect(db.contractDocument.findMany.mock.calls[0][0].where.status).toEqual({ in: ["in_signing", "signed"] })
    expect(db.invoice.findMany.mock.calls[0][0].where.status).toEqual({ in: ["sent", "viewed", "partially_paid", "paid", "overdue"] })
    expect(data.invoices[0]).toEqual(expect.objectContaining({ url: "/portal/invoice/tok%201" }))
    expect(JSON.stringify(data.invoices[0])).not.toContain("viewToken")
    expect(data.contract.hasSignedCopy).toBe(false)
  })

  it("another company's contract is simply not found", async () => {
    db.contract.findFirst.mockResolvedValue(null)
    const res = await contractView(req("/api/v1/public/portal-documents/c-other"), { params: Promise.resolve({ contractId: "c-other" }) })
    expect(res.status).toBe(404)
  })
})

describe("PDFs from the cabinet", () => {
  it("prints nothing of a contract that is not theirs", async () => {
    db.contract.findFirst.mockResolvedValue(null)
    const res = await portalPdf(req("/api/v1/public/portal-documents/c-other/pdf?doc=pp-1"), { params: Promise.resolve({ contractId: "c-other" }) })
    expect(res.status).toBe(404)
    expect(buildDocumentPdfFile).not.toHaveBeenCalled()
  })

  it("a document only if it went for signing or is signed; the contract as the CRM prints it", async () => {
    db.contract.findFirst.mockResolvedValue({ id: "c1" })
    await portalPdf(req("/api/v1/public/portal-documents/c1/pdf?doc=pp-1&signed=1&lang=ru&tz=Asia/Baku"), { params: Promise.resolve({ contractId: "c1" }) })
    expect(vi.mocked(buildDocumentPdfFile).mock.calls[0]).toEqual([ORG, "c1", "pp-1", { lang: "ru", tz: "Asia/Baku", signed: true, visibleStatuses: ["in_signing", "signed"] }])
    await portalPdf(req("/api/v1/public/portal-documents/c1/pdf"), { params: Promise.resolve({ contractId: "c1" }) })
    expect(vi.mocked(buildContractPdfFile).mock.calls[0]).toEqual([ORG, "c1", { lang: null, tz: null, signed: false }])
  })
})

describe("«İmzala» from the cabinet", () => {
  const sign = (signerId = "s-farid") => portalSign(req("/api/v1/public/portal-documents/sign", "POST", { signerId }))

  it("only the signer this person is, on a live envelope of their company's agreed contract — with a fresh token", async () => {
    db.esignSigner.findFirst.mockResolvedValue({ id: "s-farid", status: "sent", envelopeId: "env-1", envelope: { expiresAt: new Date(Date.now() + 86_400_000) } })
    db.esignSigner.updateMany.mockResolvedValue({ count: 1 })
    const res = await sign()
    expect(res.status).toBe(200)
    const where = db.esignSigner.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({
      id: "s-farid",
      organizationId: ORG,
      role: "signer",
      status: { in: ["sent", "viewed"] },
      email: { equals: "f@kaspi.az", mode: "insensitive" },
      envelope: { status: { in: ["sent", "in_progress"] }, contract: { organizationId: ORG, companyId: CO } },
    })
    const { data } = await res.json()
    const token = data.url.replace("/sign/", "")
    const verified = verifyToken({ token, secret: SECRET })
    expect(verified.ok).toBe(true)
    // the stored hash is replaced, only while the signer has not signed
    const cas = db.esignSigner.updateMany.mock.calls[0][0]
    expect(cas.where).toEqual({ id: "s-farid", status: { in: ["sent", "viewed"] } })
    expect(verified.ok && cas.data.tokenHash).toBe(verified.ok ? verified.tokenHash : null)
    expect(db.esignAuditEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "token_issued", signerId: "s-farid" })
  })

  it("refuses someone else's signature, an expired one, and one signed meanwhile", async () => {
    db.esignSigner.findFirst.mockResolvedValue(null)
    expect((await sign("s-ours")).status).toBe(404)
    db.esignSigner.findFirst.mockResolvedValue({ id: "s-farid", status: "sent", envelopeId: "env-1", envelope: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await sign()).status).toBe(410)
    db.esignSigner.findFirst.mockResolvedValue({ id: "s-farid", status: "sent", envelopeId: "env-1", envelope: { expiresAt: null } })
    db.esignSigner.updateMany.mockResolvedValue({ count: 0 })
    expect((await sign()).status).toBe(409)
  })
})
