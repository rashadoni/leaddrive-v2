/**
 * A demo request from biznesdoktoru.az reaches the site's partner at once
 * (owner, 2026-11-25), to the address typed in Demo Center; any other origin,
 * a missing address or a mail failure leaves the request and its answer as before.
 */
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findOrganization: vi.fn(),
  sendOwner: vi.fn(),
  sendPartner: vi.fn(),
  autoIssue: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { demoRequest: { create: mocks.create }, organization: { findFirst: mocks.findOrganization } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (operation: () => unknown) => Promise.resolve().then(operation),
}))
vi.mock("@/lib/demo-center/email", () => ({
  sendDemoRequestNotification: mocks.sendOwner,
  sendDemoRequestPartnerNotification: mocks.sendPartner,
}))
vi.mock("@/lib/demo-center/auto-issue", () => ({ autoIssueDemoGrant: mocks.autoIssue }))
vi.mock("@/lib/constants", () => ({ COMPANY_EMAIL: "owner@example.test" }))

import { POST } from "@/app/api/v1/public/demo-requests/route"
import { issueDemoFormChallenge } from "@/lib/demo-center/form-challenge"

function solvedChallenge() {
  const challenge = issueDemoFormChallenge(Date.now() - 30_000)
  for (let number = 0; number <= challenge.maxNumber; number += 1) {
    if (createHash("sha256").update(`${challenge.salt}${number}`).digest("hex") === challenge.challenge) return { ...challenge, number }
  }
  throw new Error("unsolvable challenge")
}

const API_URL = "https://app.leaddrivecrm.org/api/v1/public/demo-requests"
const SALES_ORG = "org-sales"
const PARTNER = "partner@agency.example"

const created = {
  id: "demo-request-7",
  name: "Leyla Həsənova",
  company: "Nar Klinika",
  jobTitle: "Direktor",
  email: "leyla@narklinika.example",
  emailNormalized: "leyla@narklinika.example",
  locale: "az",
  phone: "+994501112233",
  message: "biznesdoktoru.az saytından. Maraqlanır: Satış modulu",
  requestedModules: ["crm"],
}

function payload(extra: Record<string, unknown> = {}) {
  return {
    name: created.name,
    company: created.company,
    jobTitle: created.jobTitle,
    email: created.email,
    phone: created.phone,
    message: created.message,
    requestedModules: created.requestedModules,
    locale: "az",
    consent: true,
    challenge: solvedChallenge(),
    ...extra,
  }
}

function post(origin: string | null, body: unknown = payload()) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (origin) headers.Origin = origin
  return POST(new Request(API_URL, { method: "POST", headers, body: JSON.stringify(body) }))
}

function partnerIs(email: string | null) {
  mocks.findOrganization.mockResolvedValue({ settings: { theme: "x", demoCenter: { sitePartnerEmails: email ? { "biznesdoktoru.az": email } : {} } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("DEMO_LEAD_ORGANIZATION_ID", SALES_ORG)
  vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "")
  mocks.create.mockResolvedValue(created)
  mocks.sendPartner.mockResolvedValue({ success: true })
  mocks.sendOwner.mockResolvedValue(undefined)
  mocks.autoIssue.mockResolvedValue("issued")
  partnerIs(PARTNER)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("demo request from a partner site", () => {
  it.each(["https://biznesdoktoru.az", "https://www.biznesdoktoru.az"])("emails the partner once, at once, from %s", async (origin) => {
    const response = await post(origin)

    expect(response.status).toBe(201)
    expect(mocks.sendPartner).toHaveBeenCalledTimes(1)
    expect(mocks.sendPartner).toHaveBeenCalledWith({
      to: PARTNER,
      site: "biznesdoktoru.az",
      name: created.name,
      company: created.company,
      email: created.email,
      phone: created.phone,
      jobTitle: created.jobTitle,
      message: created.message,
      requestedModuleNames: expect.any(Array),
    })
    // the address is read from the sales organisation, nowhere else
    expect(mocks.findOrganization).toHaveBeenCalledWith(expect.objectContaining({ where: { id: SALES_ORG, isActive: true } }))
    // the prospect's own link goes out as before
    expect(mocks.autoIssue).toHaveBeenCalledTimes(1)
  })

  it("does not email the partner for requests from other sites or without an Origin", async () => {
    for (const origin of ["https://leaddrivecrm.org", "https://attacker.example", "http://biznesdoktoru.az", null]) {
      const response = await post(origin)
      expect(response.status).toBe(201)
    }
    expect(mocks.sendPartner).not.toHaveBeenCalled()
    expect(mocks.findOrganization).not.toHaveBeenCalled()
  })

  it("emails nobody when no address is set", async () => {
    partnerIs(null)
    const response = await post("https://biznesdoktoru.az")

    expect(response.status).toBe(201)
    expect(mocks.sendPartner).not.toHaveBeenCalled()
  })

  it("emails nobody when the stored value is not an address", async () => {
    mocks.findOrganization.mockResolvedValue({ settings: { demoCenter: { sitePartnerEmails: { "biznesdoktoru.az": "not an email" } } } })
    await post("https://biznesdoktoru.az")
    expect(mocks.sendPartner).not.toHaveBeenCalled()
  })

  it("emails nobody when Demo Center has no sales organisation", async () => {
    vi.stubEnv("DEMO_LEAD_ORGANIZATION_ID", "")
    const response = await post("https://biznesdoktoru.az")

    expect(response.status).toBe(201)
    expect(mocks.findOrganization).not.toHaveBeenCalled()
    expect(mocks.sendPartner).not.toHaveBeenCalled()
  })

  it.each([
    ["the mail provider throws", () => mocks.sendPartner.mockRejectedValue(new Error("smtp down"))],
    ["the mail provider refuses", () => mocks.sendPartner.mockResolvedValue({ success: false, error: "SMTP not configured" })],
    ["the settings cannot be read", () => mocks.findOrganization.mockRejectedValue(new Error("db down"))],
  ])("keeps the request and its answer when %s", async (_label, arrange) => {
    arrange()
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const response = await post("https://biznesdoktoru.az")

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ success: true, requestId: created.id, invitation: "issued" })
    expect(mocks.autoIssue).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it("does not email the partner about a request the bot checks dropped", async () => {
    const response = await post("https://biznesdoktoru.az", payload({ website: "https://spam.example" }))

    expect(response.status).toBe(201)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.sendPartner).not.toHaveBeenCalled()
  })
})
