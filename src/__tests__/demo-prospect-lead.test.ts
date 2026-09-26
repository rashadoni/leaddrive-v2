/**
 * A verified demo prospect becomes exactly one lead in LeadDrive's own CRM.
 *
 * Every rule in the header of src/lib/demo-center/prospect-lead.ts has a test
 * here: the organisation comes from server config only, only the verified
 * email links, a claim prevents two creates, failures are recorded and never
 * thrown, and the public verify response never carries the internal lead.
 */
import bcrypt from "bcryptjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockMatchInboundLeadId = vi.hoisted(() => vi.fn())
const mockCreateLeadCommand = vi.hoisted(() => vi.fn())
const mockRunWithTenant = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    demoRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
    demoGrant: { findUnique: vi.fn(), updateMany: vi.fn() },
    demoAccessEvent: { create: vi.fn() },
    organization: { findFirst: vi.fn() },
    activity: { create: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: mockRunWithTenant,
}))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: mockMatchInboundLeadId }))
vi.mock("@/lib/crm-commands/lead/create-lead", () => ({ createLeadCommand: mockCreateLeadCommand }))

import { prisma } from "@/lib/prisma"
import { DEMO_LEAD_CLAIM_LEASE_MS, ensureDemoProspectLead } from "@/lib/demo-center/prospect-lead"
import { demoSalesOrganizationId as demoLeadOrganizationId } from "@/lib/demo-center/sales-org"

const SALES_ORG = "org-leaddrive-inc"
const NOW = new Date("2026-09-21T12:00:00.000Z")
const VERIFIED_AT = new Date("2026-09-21T11:59:00.000Z")

function demoRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    name: "Nigar Əliyeva",
    company: "Xəzər Logistika MMC",
    jobTitle: "Satış direktoru",
    email: "Nigar@XezerLogistika.az",
    phone: "+994501234567",
    message: "Instagram müraciətlərini itiririk",
    source: "instagram",
    requestedModules: ["crm", "inbox"],
    consentAt: new Date("2026-09-20T18:58:28.000Z"),
    internalLeadId: null,
    leadLinkStatus: null,
    grants: [{ verifiedAt: VERIFIED_AT }],
    ...overrides,
  }
}

const env = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VOICE_AGENT_ORGANIZATION_ID = SALES_ORG
  delete process.env.DEMO_LEAD_ORGANIZATION_ID
  mockRunWithTenant.mockImplementation((_org: string, fn: () => unknown) => Promise.resolve().then(fn))
  vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue(demoRequest() as never)
  vi.mocked(prisma.demoRequest.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: SALES_ORG } as never)
  vi.mocked(prisma.activity.create).mockResolvedValue({ id: "activity-1" } as never)
  mockMatchInboundLeadId.mockResolvedValue(undefined)
  mockCreateLeadCommand.mockResolvedValue({ entity: { id: "lead-new" }, warnings: [], assignment: {} })
})

afterEach(() => {
  process.env = { ...env }
})

describe("which organisation", () => {
  it("is the voice agent's by default, because only that one can be called", () => {
    expect(demoLeadOrganizationId({ VOICE_AGENT_ORGANIZATION_ID: " org-a " })).toBe("org-a")
  })

  it("can be overridden explicitly", () => {
    expect(demoLeadOrganizationId({
      VOICE_AGENT_ORGANIZATION_ID: "org-a",
      DEMO_LEAD_ORGANIZATION_ID: "org-b",
    })).toBe("org-b")
  })

  it("does nothing to any tenant when none is configured", async () => {
    delete process.env.VOICE_AGENT_ORGANIZATION_ID

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({ status: "UNCONFIGURED" })
    expect(mockRunWithTenant).not.toHaveBeenCalled()
    expect(prisma.demoRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadLinkStatus: "UNCONFIGURED" }),
    }))
  })

  it("does nothing when the configured organisation is gone or inactive", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null)

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({ status: "UNCONFIGURED" })
    expect(mockRunWithTenant).not.toHaveBeenCalled()
  })

  it("writes inside that organisation and no other", async () => {
    await ensureDemoProspectLead("request-1", NOW)

    expect(mockRunWithTenant).toHaveBeenCalledTimes(1)
    expect(mockRunWithTenant.mock.calls[0][0]).toBe(SALES_ORG)
  })
})

describe("only verified identity", () => {
  it("waits until the email has been proven", async () => {
    vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue(demoRequest({ grants: [] }) as never)

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({ status: "NOT_VERIFIED" })
    expect(prisma.demoRequest.updateMany).not.toHaveBeenCalled()
    expect(mockRunWithTenant).not.toHaveBeenCalled()
  })

  it("matches an existing lead by the verified email and never by the typed phone", async () => {
    mockMatchInboundLeadId.mockResolvedValue("lead-existing")

    const result = await ensureDemoProspectLead("request-1", NOW)

    expect(result).toEqual({ status: "LINKED", leadId: "lead-existing", mode: "matched" })
    expect(mockMatchInboundLeadId).toHaveBeenCalledWith(SALES_ORG, { email: "Nigar@XezerLogistika.az" })
    expect(mockCreateLeadCommand).not.toHaveBeenCalled()
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ relatedType: "lead", relatedId: "lead-existing", type: "note" }),
    })
  })
})

describe("exactly one lead", () => {
  it("creates it as the demo centre, with the demo as its source", async () => {
    const result = await ensureDemoProspectLead("request-1", NOW)

    expect(result).toEqual({ status: "LINKED", leadId: "lead-new", mode: "created" })
    const [actor, input] = mockCreateLeadCommand.mock.calls[0]
    expect(actor).toEqual({
      organizationId: SALES_ORG,
      userId: null,
      role: "admin",
      source: "demo",
      requestId: "demo-request:request-1",
    })
    expect(input).toMatchObject({
      contactName: "Nigar Əliyeva",
      companyName: "Xəzər Logistika MMC",
      email: "Nigar@XezerLogistika.az",
      phone: "+994501234567",
      source: "demo",
      sourceDetail: "demo:instagram",
      interest: "crm, inbox",
    })
    expect(input.notes).toContain("Razılıq: 2026-09-20 18:58 UTC")
    expect(input.notes).toContain("E-poçt təsdiqlənib: 2026-09-21 11:59 UTC")
  })

  it("keeps a phone the lead card would refuse out of the card, and in the notes", async () => {
    vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue(demoRequest({ phone: "12345" }) as never)

    await ensureDemoProspectLead("request-1", NOW)

    const [, input] = mockCreateLeadCommand.mock.calls[0]
    expect(input).not.toHaveProperty("phone")
    expect(input.notes).toContain("Telefon (yoxlanılmayıb): 12345")
  })

  it("records the link, with the lead and the organisation", async () => {
    await ensureDemoProspectLead("request-1", NOW)

    expect(prisma.demoRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: "request-1", leadLinkStatus: "PENDING", leadLinkUpdatedAt: NOW },
      data: expect.objectContaining({
        leadLinkStatus: "LINKED",
        internalLeadId: "lead-new",
        internalLeadOrganizationId: SALES_ORG,
      }),
    })
  })

  it("claims before writing, so a concurrent call cannot create a second lead", async () => {
    vi.mocked(prisma.demoRequest.updateMany).mockResolvedValueOnce({ count: 0 })

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({ status: "PENDING" })
    expect(mockRunWithTenant).not.toHaveBeenCalled()
    expect(mockCreateLeadCommand).not.toHaveBeenCalled()
  })

  it("lets a stale claim be taken over once the lease has run out", async () => {
    await ensureDemoProspectLead("request-1", NOW)

    const claim = vi.mocked(prisma.demoRequest.updateMany).mock.calls[0][0]
    expect(claim.where).toMatchObject({ id: "request-1" })
    expect(claim.where?.OR).toContainEqual({
      leadLinkStatus: "PENDING",
      leadLinkUpdatedAt: { lt: new Date(NOW.getTime() - DEMO_LEAD_CLAIM_LEASE_MS) },
    })
    expect(claim.data).toMatchObject({ leadLinkStatus: "PENDING", leadLinkUpdatedAt: NOW })
  })

  it("does nothing more once linked", async () => {
    vi.mocked(prisma.demoRequest.findUnique).mockResolvedValue(
      demoRequest({ leadLinkStatus: "LINKED", internalLeadId: "lead-new" }) as never,
    )

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({
      status: "LINKED",
      leadId: "lead-new",
      mode: "already",
    })
    expect(prisma.demoRequest.updateMany).not.toHaveBeenCalled()
    expect(mockRunWithTenant).not.toHaveBeenCalled()
  })
})

describe("failure", () => {
  it("is recorded for the admin and never thrown at the prospect's flow", async () => {
    mockCreateLeadCommand.mockRejectedValue(new Error("pipeline lookup failed"))

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({ status: "FAILED" })
    expect(prisma.demoRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: "request-1", leadLinkStatus: { not: "LINKED" } },
      data: expect.objectContaining({ leadLinkStatus: "FAILED", leadLinkError: "Error: pipeline lookup failed" }),
    })
  })

  it("survives even when recording the failure fails too", async () => {
    vi.mocked(prisma.demoRequest.findUnique).mockRejectedValue(new Error("database down"))
    vi.mocked(prisma.demoRequest.updateMany).mockRejectedValue(new Error("database down"))

    await expect(ensureDemoProspectLead("request-1", NOW)).resolves.toEqual({ status: "FAILED" })
  })
})

describe("the public verify route", () => {
  const TOKEN = "b".repeat(64)
  const CODE = "123456"

  async function verify() {
    const { POST } = await import("@/app/api/v1/public/demo-access/[token]/verify/route")
    return POST(
      new NextRequest(new URL(`/api/v1/public/demo-access/${TOKEN}/verify`, "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: CODE }),
      }),
      { params: Promise.resolve({ token: TOKEN }) },
    )
  }

  function sentGrant(otpHash: string) {
    return {
      id: "grant-1",
      requestId: "request-1",
      status: "OTP_SENT",
      otpHash,
      otpExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      otpAttempts: 0,
      linkExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      sessionStartedAt: null,
      sessionLastSeenAt: null,
      sessionExpiresAt: null,
      inactivityMinutes: 30,
    }
  }

  it("turns the proven email into a lead, and says nothing about it", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(sentGrant(bcrypt.hashSync(CODE, 4)) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)

    const response = await verify()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, state: "verified" })
    expect(mockCreateLeadCommand).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(body)).not.toMatch(/lead|org-/i)
  })

  it("still verifies the prospect when the lead cannot be created", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(sentGrant(bcrypt.hashSync(CODE, 4)) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)
    mockCreateLeadCommand.mockRejectedValue(new Error("CRM unavailable"))

    const response = await verify()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, state: "verified" })
  })

  it("creates nothing for a wrong code", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(sentGrant(bcrypt.hashSync("654321", 4)) as never)
    vi.mocked(prisma.demoGrant.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)

    const response = await verify()

    expect(response.status).toBe(401)
    expect(prisma.demoRequest.findUnique).not.toHaveBeenCalled()
    expect(mockCreateLeadCommand).not.toHaveBeenCalled()
  })
})
