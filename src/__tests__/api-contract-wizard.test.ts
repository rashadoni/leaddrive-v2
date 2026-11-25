/**
 * /api/v1/contracts/wizard — the route around the wizard's decisions
 * (src/lib/clm/contract-wizard.ts, tested on its own in lib-contract-wizard).
 *
 * What is checked here is what the route writes and refuses: a preview writes
 * nothing; a contract is never made with an empty required field; a company
 * card gains only what it lacked, in the same transaction as the contract; a
 * person without the right to change companies cannot make one through the
 * wizard; a company or deal of another tenant is not found. Prisma and the
 * session are stand-ins, the substituter and the wizard's logic are real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    bankAccount: { findMany: vi.fn() },
    contractTemplate: { findFirst: vi.fn(), findMany: vi.fn() },
    deal: { findFirst: vi.fn() },
    company: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    contract: { create: vi.fn() },
    contractVersion: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v: unknown) => v instanceof NextResponse),
}))
vi.mock("@/lib/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permissions")>()
  return { ...real, checkPermission: vi.fn(() => true) }
})
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn(async () => ({})),
  filterWritableFields: (data: Record<string, unknown>) => data,
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/territory-routing", () => ({ routeNewCompanyToTerritories: vi.fn(async () => 0) }))
vi.mock("@/lib/prisma-decimal", () => ({ normalizeContractRow: (c: unknown) => c }))

import { GET, POST } from "@/app/api/v1/contracts/wizard/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { checkPermission } from "@/lib/permissions"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any
const ORG = "org-1"

const settings = {
  invoice: {
    companyName: "«Nümunə» MMC",
    companyVoen: "1402578361",
    companyAddress: "Bakı, Nəsimi r.",
    directorName: "Rəşad Rəhimov",
    bankName: "Kapital Bank",
    bankAccount: "AZ21AIIB38000000001944",
  },
}

const template = {
  id: "tpl-1",
  organizationId: ORG,
  name: "Alğı-satqı müqaviləsi",
  version: 4,
  isActive: true,
  defaultContractType: "service_agreement",
  defaultDurationMonths: 12,
  clauses: [
    { id: "c1", title: "1. Predmet", body: "{{counterparty_name}} alır: {{predmet}}." },
    { id: "c2", title: "2. Məbləğ", body: "{{contract_amount}} {{contract_currency}}" },
  ],
  variables: [
    { name: "counterparty_name", type: "string", required: true },
    { name: "predmet", type: "string", required: true, label: "Müqavilənin predmeti" },
    { name: "contract_amount", type: "string", required: true },
    { name: "contract_currency", type: "string", required: true },
  ],
}

const deal = {
  id: "deal-1",
  name: "Kaspi — 400 palet",
  valueAmount: { toString: () => "48000" },
  currency: "AZN",
  company: null,
}

const existingCompany = {
  id: "co-kaspi",
  name: "Kaspi",
  voen: "1307137771",
  address: null,
  director: null,
  externalSource: null,
  bankName: null,
  bankCode: null,
  bankSwift: null,
  bankAccount: null,
  bankVoen: null,
  bankCorrAccount: null,
}

const counterparty = {
  voen: "1307137771",
  name: "«Kaspi Logistika» MMC",
  address: "Bakı, Xətai r., Babək pr. 12",
  director: "Fərid Qəhrəmanov",
  bank: { bankName: "ABB", bankAccount: "AZ77IBAZ38010019441234567890", bankSwift: "IBAZAZ2X" },
  saveBank: true,
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/contracts/wizard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

let tx: { company: { updateMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }; contract: { create: ReturnType<typeof vi.fn> }; contractVersion: { create: ReturnType<typeof vi.fn> } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "user-1", role: "manager", email: "m@x.az", name: "M" } as never)
  vi.mocked(checkPermission).mockReturnValue(true)
  db.organization.findUnique.mockResolvedValue({ name: "Org", settings })
  db.bankAccount.findMany.mockResolvedValue([])
  db.contractTemplate.findFirst.mockResolvedValue(template)
  db.deal.findFirst.mockResolvedValue(deal)
  db.company.findFirst.mockImplementation(async ({ where }: { where: { id?: string; voen?: string } }) =>
    where.voen === "1307137771" || where.id === "co-kaspi" ? existingCompany : null,
  )
  tx = {
    company: { updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async ({ data }: { data: { name: string } }) => ({ id: "co-new", name: data.name })) },
    contract: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ctr-1", ...data })) },
    contractVersion: { create: vi.fn(async () => ({ id: "cv-1" })) },
  }
  db.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
})

describe("POST /api/v1/contracts/wizard", () => {
  it("preview: the document with the deal's money and the requisites, and nothing written", async () => {
    const res = await POST(req({ preview: true, templateId: "tpl-1", dealId: "deal-1", counterparty, ourBank: "settings", typed: {} }))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.renderedBody).toContain("«Kaspi Logistika» MMC alır: ________.")
    expect(data.renderedBody).toContain("48 000,00 AZN")
    expect(data.renderedBody).toContain("Kapital Bank")
    expect(data.missing).toEqual(["predmet"])
    expect(data.asked).toEqual([{ name: "predmet", type: "string", required: true, label: "Müqavilənin predmeti" }])
    // the VÖEN found the existing card; what it would gain is named, not written
    expect(data.company).toEqual({ action: "update", id: "co-kaspi", name: "Kaspi", fields: ["director", "address", "bankName", "bankSwift", "bankAccount"] })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("refuses to make a contract while a required field is empty", async () => {
    const res = await POST(req({ preview: false, templateId: "tpl-1", dealId: "deal-1", counterparty, ourBank: "settings", typed: {} }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "MISSING_FIELDS", missing: ["predmet"] })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("makes the draft and completes the existing card in one transaction, never renaming it", async () => {
    const res = await POST(req({ preview: false, templateId: "tpl-1", dealId: "deal-1", counterparty, ourBank: "settings", typed: { predmet: "Taxta palet" } }))
    expect(res.status).toBe(201)

    expect(tx.company.create).not.toHaveBeenCalled()
    expect(tx.company.updateMany).toHaveBeenCalledWith({
      where: { id: "co-kaspi", organizationId: ORG },
      data: {
        director: "Fərid Qəhrəmanov",
        address: "Bakı, Xətai r., Babək pr. 12",
        bankName: "ABB",
        bankSwift: "IBAZAZ2X",
        bankAccount: "AZ77IBAZ38010019441234567890",
      },
    })
    const contract = tx.contract.create.mock.calls[0][0].data
    expect(contract).toMatchObject({
      organizationId: ORG,
      status: "draft",
      title: "Alğı-satqı müqaviləsi — «Kaspi Logistika» MMC",
      type: "service_agreement",
      templateId: "tpl-1",
      templateVersion: 4,
      companyId: "co-kaspi",
      dealId: "deal-1",
      valueAmount: 48000,
      currency: "AZN",
    })
    expect(contract.renderedBody).toContain("alır: Taxta palet.")
    expect(contract.renderedBody).not.toMatch(/\{\{|________/)
    expect(contract.endDate.getTime() - contract.startDate.getTime()).toBeGreaterThan(360 * 86400_000)
    // version 1 pins the same text
    expect(tx.contractVersion.create.mock.calls[0][0].data).toMatchObject({ versionNo: 1, renderedBody: contract.renderedBody, source: "draft" })
    expect(vi.mocked(logAudit).mock.calls.map((c) => [c[1], c[2]])).toEqual([["create", "contract"], ["update", "company"]])
  })

  it("makes a new company card when the CRM has none, with the bank when asked", async () => {
    db.company.findFirst.mockResolvedValue(null)
    const res = await POST(req({ preview: false, templateId: "tpl-1", dealId: "deal-1", counterparty: { ...counterparty, voen: "1700000001" }, typed: { predmet: "x" } }))
    expect(res.status).toBe(201)
    expect(tx.company.create.mock.calls[0][0].data).toMatchObject({
      organizationId: ORG,
      name: "«Kaspi Logistika» MMC",
      voen: "1700000001",
      bankAccount: "AZ77IBAZ38010019441234567890",
    })
    expect(tx.contract.create.mock.calls[0][0].data.companyId).toBe("co-new")
  })

  it("without a deal the amount and currency are the person's to fill, and named as such", async () => {
    const res = await POST(req({ preview: false, templateId: "tpl-1", counterparty, typed: { predmet: "x" } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "MISSING_FIELDS", missing: ["contract_amount", "contract_currency"] })
  })

  it("someone without the right to change companies cannot change one through the wizard", async () => {
    vi.mocked(checkPermission).mockReturnValue(false)
    const res = await POST(req({ preview: false, templateId: "tpl-1", dealId: "deal-1", counterparty, typed: { predmet: "x" } }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: "COMPANY_WRITE_DENIED" })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("…but may still make a contract for a card that needs no change", async () => {
    vi.mocked(checkPermission).mockReturnValue(false)
    const full = { ...existingCompany, address: counterparty.address, director: counterparty.director }
    db.company.findFirst.mockResolvedValue(full)
    const res = await POST(req({ preview: false, templateId: "tpl-1", dealId: "deal-1", counterparty: { ...counterparty, saveBank: false }, typed: { predmet: "x" } }))
    expect(res.status).toBe(201)
    expect(tx.company.updateMany).not.toHaveBeenCalled()
  })

  it("does not find another tenant's company, deal or template", async () => {
    db.company.findFirst.mockResolvedValue(null)
    let res = await POST(req({ preview: true, templateId: "tpl-1", companyId: "co-other-org", counterparty }))
    expect(res.status).toBe(404)
    expect(db.company.findFirst.mock.calls.at(-1)[0].where).toMatchObject({ id: "co-other-org", organizationId: ORG })

    db.deal.findFirst.mockResolvedValue(null)
    res = await POST(req({ preview: true, templateId: "tpl-1", dealId: "deal-other", counterparty }))
    expect(res.status).toBe(404)

    db.contractTemplate.findFirst.mockResolvedValue(null)
    res = await POST(req({ preview: true, templateId: "tpl-other", counterparty }))
    expect(res.status).toBe(404)
  })

  it("refuses a bank account that is not this organisation's, and a malformed VÖEN", async () => {
    let res = await POST(req({ preview: true, templateId: "tpl-1", counterparty, ourBank: "ba-foreign" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_OUR_BANK" })
    res = await POST(req({ preview: true, templateId: "tpl-1", counterparty: { ...counterparty, voen: "12345" } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: "INVALID_VOEN" })
  })

  it("a blank contract is the requisites alone, typed as «other»", async () => {
    const res = await POST(req({ preview: false, templateId: null, counterparty, typed: {} }))
    expect(res.status).toBe(201)
    const contract = tx.contract.create.mock.calls[0][0].data
    expect(contract.type).toBe("other")
    expect(contract.renderedBody.startsWith("TƏRƏFLƏRİN REKVİZİTLƏRİ")).toBe(true)
  })
})

describe("GET /api/v1/contracts/wizard", () => {
  it("counts only a template's own fields — the standard ones fill themselves", async () => {
    db.contractTemplate.findMany.mockResolvedValue([template])
    const res = await GET(new NextRequest("http://localhost:3000/api/v1/contracts/wizard?deal=deal-1"))
    const { data } = await res.json()
    expect(data.templates).toEqual([
      { id: "tpl-1", name: "Alğı-satqı müqaviləsi", description: undefined, defaultContractType: "service_agreement", clauseCount: 2, ownFieldCount: 1 },
    ])
    expect(data.our).toEqual({ name: "«Nümunə» MMC", voen: "1402578361", address: "Bakı, Nəsimi r.", director: "Rəşad Rəhimov" })
    expect(data.ourBanks.map((b: { id: string }) => b.id)).toEqual(["settings"])
    expect(data.deal).toMatchObject({ id: "deal-1", valueAmount: 48000, currency: "AZN", company: null })
  })
})
