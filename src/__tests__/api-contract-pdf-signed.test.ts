/**
 * GET /api/v1/contracts/:id/pdf?signed=1 — the signed copy.
 *
 * The danger it guards: a signature sheet printed under text nobody signed.
 * The contract's live body may have been amended after signing, so the signed
 * copy must take the text of the immutable version the envelope minted
 * (`createdBy: esign:<envelopeId>`), and refuse when there is none.
 *
 * The PDF renderer is the real one, wrapped so the test can read what it was
 * given; only Prisma and the session are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    contractVersion: { findFirst: vi.fn(), findMany: vi.fn() },
    esignEnvelope: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(
    (moduleId: string) => new NextResponse(JSON.stringify({ error: `Module ${moduleId} is not enabled` }), { status: 403 }),
  ),
}))

vi.mock("@/lib/clm/contract-pdf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clm/contract-pdf")>()
  return { ...real, generateContractPdf: vi.fn(real.generateContractPdf) }
})

import { GET as getPdf } from "@/app/api/v1/contracts/[id]/pdf/route"
import { GET as listEnvelopes } from "@/app/api/v1/contracts/[id]/esign/route"
import { generateContractPdf } from "@/lib/clm/contract-pdf"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule } from "@/lib/api-auth"

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const ENVELOPE_ID = "env-7"
const SIGNED_HASH = "ab".repeat(32)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const contract = {
  id: CONTRACT_ID,
  organizationId: ORG_ID,
  contractNumber: "AS/2026-0774",
  title: "Alğı-satqı müqaviləsi",
  type: "service_agreement",
  status: "active",
  startDate: null,
  endDate: null,
  currency: "AZN",
  valueAmount: null,
  // amended after signing: this is NOT what the signers saw
  renderedBody: "1. Predmet\nAMENDED TEXT AFTER SIGNING",
  company: { name: "«Kaspi Logistika» MMC" },
}

const signedVersion = {
  versionNo: 3,
  contentHash: SIGNED_HASH,
  renderedBody: "1. Predmet\nThe text both parties signed.",
  createdBy: `esign:${ENVELOPE_ID}`,
}

const completedEnvelope = {
  sentAt: new Date("2026-11-25T06:30:00Z"),
  completedAt: new Date("2026-11-25T10:05:09Z"),
  signers: [
    {
      order: 1,
      fullName: "Fərid Qəhrəmanov",
      email: "farid@kaspi.az",
      role: "signer",
      status: "signed",
      signatureMethod: "typed",
      signaturePayload: { typedName: "Fərid Qəhrəmanov", font: "dancing-script" },
      viewedAt: new Date("2026-11-25T09:58:00Z"),
      signedAt: new Date("2026-11-25T10:05:09Z"),
      signedIpAddress: "185.81.80.12",
    },
  ],
}

function pdfReq(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/pdf?${query}`)
}
const params = { params: Promise.resolve({ id: CONTRACT_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
  vi.mocked(getSession).mockResolvedValue({ userId: "user-1", orgId: ORG_ID, role: "admin" } as never)
  vi.mocked(orgHasModule).mockResolvedValue(true)
  db.contract.findFirst.mockResolvedValue(contract)
  db.organization.findUnique.mockResolvedValue({ name: "«Nümunə» MMC", logo: null, branding: null })
  db.contractVersion.findFirst.mockResolvedValue(signedVersion)
  db.esignEnvelope.findFirst.mockResolvedValue(completedEnvelope)
})

describe("GET /api/v1/contracts/:id/pdf?signed=1", () => {
  it("prints the text the envelope's signers signed, not the amended live body, with their sheet", async () => {
    const res = await getPdf(pdfReq(`signed=1&envelope=${ENVELOPE_ID}&lang=az&tz=Asia/Baku&download=1`), params)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="AS_2026-0774-signed.pdf"')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF")

    // the version is looked up by the envelope's own mark, inside this org and contract
    expect(db.contractVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, contractId: CONTRACT_ID, source: "signed", createdBy: `esign:${ENVELOPE_ID}` },
      }),
    )
    // and the envelope must be this org's, this contract's, and completed
    expect(db.esignEnvelope.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ENVELOPE_ID, organizationId: ORG_ID, contractId: CONTRACT_ID, status: "completed" },
      }),
    )

    const input = vi.mocked(generateContractPdf).mock.calls[0][0]
    expect(input.contract.renderedBody).toBe("1. Predmet\nThe text both parties signed.")
    expect(input.signatureSheet).toEqual({
      sentAt: completedEnvelope.sentAt,
      completedAt: completedEnvelope.completedAt,
      versionNo: 3,
      contentHash: SIGNED_HASH,
      signers: completedEnvelope.signers,
    })
    expect(input.lang).toBe("az")
    expect(input.timeZone).toBe("Asia/Baku")
  })

  it("without an envelope, takes the contract's canonical signed version and its envelope", async () => {
    const res = await getPdf(pdfReq("signed=1"), params)
    expect(res.status).toBe(200)
    expect(db.contractVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, contractId: CONTRACT_ID, source: "signed", isCanonicalSigned: true },
      }),
    )
    expect(db.esignEnvelope.findFirst.mock.calls[0][0].where.id).toBe(ENVELOPE_ID)
  })

  it("refuses rather than print a sheet when the envelope minted no signed version", async () => {
    db.contractVersion.findFirst.mockResolvedValue(null)
    const res = await getPdf(pdfReq(`signed=1&envelope=${ENVELOPE_ID}`), params)
    expect(res.status).toBe(404)
    expect(generateContractPdf).not.toHaveBeenCalled()
  })

  it("refuses when the signed version was not made by an e-sign envelope (an import, a manual mark)", async () => {
    db.contractVersion.findFirst.mockResolvedValue({ ...signedVersion, createdBy: "user-1" })
    const res = await getPdf(pdfReq("signed=1"), params)
    expect(res.status).toBe(404)
    expect(db.esignEnvelope.findFirst).not.toHaveBeenCalled()
  })

  it("refuses when the envelope is not a completed one of this org and contract", async () => {
    db.esignEnvelope.findFirst.mockResolvedValue(null)
    const res = await getPdf(pdfReq(`signed=1&envelope=${ENVELOPE_ID}`), params)
    expect(res.status).toBe(404)
    expect(generateContractPdf).not.toHaveBeenCalled()
  })

  it("the plain PDF still prints the live body and no sheet", async () => {
    const res = await getPdf(pdfReq("lang=ru"), params)
    expect(res.status).toBe(200)
    expect(db.contractVersion.findFirst).not.toHaveBeenCalled()
    const input = vi.mocked(generateContractPdf).mock.calls[0][0]
    expect(input.contract.renderedBody).toBe(contract.renderedBody)
    expect(input.signatureSheet).toBeNull()
    expect(input.lang).toBe("ru")
  })
})

describe("GET /api/v1/contracts/:id/esign — what the card's signature sheet reads", () => {
  it("gives a completed envelope its signed version and each signer's method and address, never the payload", async () => {
    db.contract.findFirst.mockResolvedValue({ id: CONTRACT_ID })
    db.esignEnvelope.findMany.mockResolvedValue([
      {
        id: ENVELOPE_ID,
        contractId: CONTRACT_ID,
        organizationId: ORG_ID,
        subject: "İmzalayın",
        message: null,
        status: "completed",
        expiresAt: null,
        sentAt: completedEnvelope.sentAt,
        completedAt: completedEnvelope.completedAt,
        createdAt: completedEnvelope.sentAt,
        updatedAt: completedEnvelope.completedAt,
        signers: [
          {
            id: "s-1",
            fullName: "Fərid Qəhrəmanov",
            email: "farid@kaspi.az",
            order: 1,
            role: "signer",
            status: "signed",
            signedAt: completedEnvelope.completedAt,
            declinedAt: null,
            viewedAt: null,
            createdAt: completedEnvelope.sentAt,
            signatureMethod: "drawn",
            signedIpAddress: "185.81.80.12",
          },
        ],
      },
      {
        id: "env-open",
        contractId: CONTRACT_ID,
        organizationId: ORG_ID,
        subject: "Old",
        message: null,
        status: "sent",
        expiresAt: null,
        sentAt: null,
        completedAt: null,
        createdAt: completedEnvelope.sentAt,
        updatedAt: completedEnvelope.sentAt,
        signers: [],
      },
    ])
    db.contractVersion.findMany.mockResolvedValue([{ versionNo: 3, contentHash: SIGNED_HASH, createdBy: `esign:${ENVELOPE_ID}` }])

    const res = await listEnvelopes(new NextRequest(`http://localhost:3000/api/v1/contracts/${CONTRACT_ID}/esign`), params)
    expect(res.status).toBe(200)
    const { data } = await res.json()

    // only completed envelopes are looked up, by their mark, in this org and contract
    expect(db.contractVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, contractId: CONTRACT_ID, source: "signed", createdBy: { in: [`esign:${ENVELOPE_ID}`] } },
      }),
    )
    // the select must not ask for what the list never shows
    const signerSelect = db.esignEnvelope.findMany.mock.calls[0][0].include.signers.select
    expect(signerSelect.signaturePayload).toBeUndefined()
    expect(signerSelect.tokenHash).toBeUndefined()

    expect(data[0].signedVersion).toEqual({ versionNo: 3, contentHash: SIGNED_HASH })
    expect(data[0].signers[0]).toMatchObject({ signatureMethod: "drawn", signedIpAddress: "185.81.80.12" })
    expect(data[0].signers[0].signaturePayload).toBeUndefined()
    expect(data[1].signedVersion).toBeNull()
  })
})
