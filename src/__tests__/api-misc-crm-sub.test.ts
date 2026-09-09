import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ── mocks ──────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: { findMany: vi.fn() },
    deal: { findMany: vi.fn(), create: vi.fn() },
    ticket: { findMany: vi.fn() },
    callLog: { findMany: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    channelMessage: { findMany: vi.fn(), findFirst: vi.fn() },
    emailLog: { findMany: vi.fn() },
    contract: { findFirst: vi.fn() },
    contractFile: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    customDomain: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), update: vi.fn() },
    customField: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    escalationRule: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    lead: { findFirst: vi.fn(), update: vi.fn() },
    pipeline: { findFirst: vi.fn() },
    company: { create: vi.fn() },
    kbArticle: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: any) => v instanceof Response),
}))

vi.mock("@/lib/contact-events", () => ({
  trackContactEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn().mockImplementation((_o, _u, _r, _e, where) => where),
}))

vi.mock("@/lib/survey-triggers", () => ({
  triggerSurveysOnLeadConverted: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("dns", () => ({
  default: { promises: { resolveCname: vi.fn() } },
  promises: { resolveCname: vi.fn() },
}))

/* ── imports ─────────────────────────────────────────────── */

import { GET as timelineGET } from "@/app/api/v1/companies/[id]/timeline/route"
import { GET as engagementGET } from "@/app/api/v1/contacts/[id]/engagement/route"
import { GET as contractFilesGET } from "@/app/api/v1/contracts/[id]/files/route"
import { DELETE as contractFileDelete } from "@/app/api/v1/contracts/[id]/files/[fileId]/route"
import { GET as domainsGET, POST as domainsPOST } from "@/app/api/v1/custom-domains/route"
import { DELETE as domainsDELETE } from "@/app/api/v1/custom-domains/[id]/route"
import { POST as domainVerifyPOST } from "@/app/api/v1/custom-domains/[id]/verify/route"
import { PUT as customFieldPUT, DELETE as customFieldDELETE } from "@/app/api/v1/custom-fields/[id]/route"
import { GET as escalationGET, POST as escalationPOST } from "@/app/api/v1/escalation-rules/route"
import { PATCH as escalationPATCH, DELETE as escalationDELETE } from "@/app/api/v1/escalation-rules/[id]/route"
import { POST as leadConvertPOST } from "@/app/api/v1/leads/[id]/convert/route"

import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"
import dns from "dns"

/* ── helpers ─────────────────────────────────────────────── */

const AUTH = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function params2(id: string, fileId: string) {
  return { params: Promise.resolve({ id, fileId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue(AUTH as any)
  vi.mocked(requireAuth).mockImplementation(async (request) => {
    const session = await getSession(request)
    if (session) return session as any
    const orgId = await getOrgId(request)
    return orgId
      ? ({ ...AUTH, orgId } as any)
      : (new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as any)
  })
  vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({
    id: "pipe-default",
    name: "Default Sales",
    stages: [
      { name: "LEAD", probability: 10 },
      { name: "QUALIFIED", probability: 25 },
    ],
  } as any)
})

/* ── Company Timeline ────────────────────────────────────── */

describe("Company Timeline", () => {
  it("GET returns merged timeline entries", async () => {
    const now = new Date()
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "a1", type: "call", subject: "Call", description: null, createdAt: now, createdBy: "u1" },
    ] as any)
    vi.mocked(prisma.deal.findMany).mockResolvedValue([
      { id: "d1", name: "Deal A", stage: "QUALIFIED", valueAmount: 1000, currency: "USD", createdAt: now },
    ] as any)
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([])
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([])
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]) // no contacts → email/msg aggregation skipped

    const res = await timelineGET(req("/api/v1/companies/co1/timeline"), params("co1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.timeline).toHaveLength(2)
  })

  it("GET returns 401 without org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)
    const res = await timelineGET(req("/api/v1/companies/co1/timeline"), params("co1"))
    expect(res.status).toBe(401)
  })
})

/* ── Contact Engagement ──────────────────────────────────── */

describe("Contact Engagement", () => {
  it("GET returns engagement data", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c1", email: "j@t.com", companyId: null } as any)
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "a1", type: "call", subject: "Hi", createdAt: new Date() },
      { id: "a2", type: "email", subject: "Re:", createdAt: new Date() },
    ] as any)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([])

    const res = await engagementGET(req("/api/v1/contacts/c1/engagement"), params("c1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.activities.total).toBe(2)
    expect(json.data.activities.calls).toBe(1)
  })

  it("GET returns 404 for missing contact", async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue(null)

    const res = await engagementGET(req("/api/v1/contacts/bad/engagement"), params("bad"))
    expect(res.status).toBe(404)
  })
})

/* ── Contract Files ──────────────────────────────────────── */

describe("Contract Files", () => {
  it("GET returns files for contract", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue({ id: "ct1" } as any)
    vi.mocked(prisma.contractFile.findMany).mockResolvedValue([{ id: "f1", fileName: "doc.pdf" }] as any)

    const res = await contractFilesGET(req("/api/v1/contracts/ct1/files"), params("ct1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })

  it("GET returns 404 if contract missing", async () => {
    vi.mocked(prisma.contract.findFirst).mockResolvedValue(null)

    const res = await contractFilesGET(req("/api/v1/contracts/bad/files"), params("bad"))
    expect(res.status).toBe(404)
  })

  it("DELETE removes contract file", async () => {
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValue({
      id: "f1", contractId: "ct1", organizationId: "org-1", fileName: "abc123.pdf",
    } as any)
    vi.mocked(prisma.contractFile.delete).mockResolvedValue({} as any)

    const res = await contractFileDelete(
      req("/api/v1/contracts/ct1/files/f1", { method: "DELETE" }),
      params2("ct1", "f1")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("f1")
  })

  it("DELETE returns 404 for missing file", async () => {
    vi.mocked(prisma.contractFile.findFirst).mockResolvedValue(null)

    const res = await contractFileDelete(
      req("/api/v1/contracts/ct1/files/bad", { method: "DELETE" }),
      params2("ct1", "bad")
    )
    expect(res.status).toBe(404)
  })
})

/* ── Custom Domains ──────────────────────────────────────── */

describe("Custom Domains", () => {
  it("GET lists domains", async () => {
    vi.mocked(prisma.customDomain.findMany).mockResolvedValue([{ id: "d1", domain: "crm.acme.com" }] as any)

    const res = await domainsGET(req("/api/v1/custom-domains"))
    const json = await res.json()
    expect(json.domains).toHaveLength(1)
  })

  it("POST creates domain", async () => {
    vi.mocked(prisma.customDomain.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customDomain.create).mockResolvedValue({ id: "d2", domain: "portal.acme.com", status: "pending" } as any)

    const res = await domainsPOST(
      req("/api/v1/custom-domains", {
        method: "POST",
        body: JSON.stringify({ domain: "portal.acme.com" }),
      })
    )
    expect(res.status).toBe(201)
  })

  it("POST rejects duplicate domain", async () => {
    vi.mocked(prisma.customDomain.findUnique).mockResolvedValue({ id: "d1" } as any)

    const res = await domainsPOST(
      req("/api/v1/custom-domains", {
        method: "POST",
        body: JSON.stringify({ domain: "portal.acme.com" }),
      })
    )
    expect(res.status).toBe(409)
  })

  it("DELETE removes domain", async () => {
    vi.mocked(prisma.customDomain.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.customDomain.delete).mockResolvedValue({} as any)

    const res = await domainsDELETE(req("/api/v1/custom-domains/d1", { method: "DELETE" }), params("d1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("Verify POST returns verified on correct CNAME", async () => {
    vi.mocked(prisma.customDomain.findFirst).mockResolvedValue({ id: "d1", domain: "crm.acme.com" } as any)
    vi.mocked(prisma.customDomain.update).mockResolvedValue({} as any)
    vi.mocked(dns.promises.resolveCname).mockResolvedValue(["pages.leaddrivecrm.org"] as any)

    const res = await domainVerifyPOST(
      req("/api/v1/custom-domains/d1/verify", { method: "POST" }),
      params("d1")
    )
    const json = await res.json()
    expect(json.verified).toBe(true)
  })
})

/* ── Custom Fields ───────────────────────────────────────── */

describe("Custom Fields", () => {
  it("PUT updates field", async () => {
    vi.mocked(prisma.customField.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.customField.findFirst).mockResolvedValue({ id: "cf1", fieldLabel: "Updated" } as any)

    const res = await customFieldPUT(
      req("/api/v1/custom-fields/cf1", { method: "PUT", body: JSON.stringify({ fieldLabel: "Updated" }) }),
      params("cf1")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("DELETE removes field", async () => {
    vi.mocked(prisma.customField.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await customFieldDELETE(req("/api/v1/custom-fields/cf1", { method: "DELETE" }), params("cf1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("DELETE returns 404 for missing field", async () => {
    vi.mocked(prisma.customField.deleteMany).mockResolvedValue({ count: 0 } as any)

    const res = await customFieldDELETE(req("/api/v1/custom-fields/bad", { method: "DELETE" }), params("bad"))
    expect(res.status).toBe(404)
  })
})

/* ── Escalation Rules ────────────────────────────────────── */

describe("Escalation Rules", () => {
  it("GET lists rules", async () => {
    vi.mocked(prisma.escalationRule.findMany).mockResolvedValue([{ id: "r1", name: "SLA Breach" }] as any)

    const res = await escalationGET(req("/api/v1/escalation-rules"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })

  it("POST creates rule", async () => {
    vi.mocked(prisma.escalationRule.create).mockResolvedValue({ id: "r2", name: "New Rule" } as any)

    const res = await escalationPOST(
      req("/api/v1/escalation-rules", {
        method: "POST",
        body: JSON.stringify({
          name: "New Rule",
          triggerType: "first_response_breach",
          actions: [{ type: "notify" }],
        }),
      })
    )
    expect(res.status).toBe(201)
  })

  it("PATCH updates rule", async () => {
    vi.mocked(prisma.escalationRule.findFirst).mockResolvedValue({ id: "r1" } as any)
    vi.mocked(prisma.escalationRule.update).mockResolvedValue({ id: "r1", name: "Updated" } as any)

    const res = await escalationPATCH(
      req("/api/v1/escalation-rules/r1", { method: "PATCH", body: JSON.stringify({ name: "Updated" }) }),
      params("r1")
    )
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("DELETE removes rule", async () => {
    vi.mocked(prisma.escalationRule.findFirst).mockResolvedValue({ id: "r1" } as any)
    vi.mocked(prisma.escalationRule.delete).mockResolvedValue({} as any)

    const res = await escalationDELETE(req("/api/v1/escalation-rules/r1", { method: "DELETE" }), params("r1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("DELETE returns 404 for missing rule", async () => {
    vi.mocked(prisma.escalationRule.findFirst).mockResolvedValue(null)

    const res = await escalationDELETE(req("/api/v1/escalation-rules/bad", { method: "DELETE" }), params("bad"))
    expect(res.status).toBe(404)
  })
})

/* ── Lead Convert ────────────────────────────────────────── */

describe("Lead Convert", () => {
  it("POST converts lead to deal+contact", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "l1", contactName: "John", companyName: "Acme", email: "j@a.com",
      phone: null, source: "web", estimatedValue: 5000, status: "new",
    } as any)

    const txResult = { company: { id: "co1" }, contact: { id: "c1" }, deal: { id: "d1" } }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      return txResult
    })

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "New Deal" }),
      }),
      params("l1")
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it("writes the submitted deal title to the required Deal.name field", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "l1", contactName: "Vahid", companyName: "Memarlıq şirkəti",
      email: null, phone: null, source: "web", estimatedValue: 20000, status: "new",
    } as any)
    const dealCreate = vi.fn().mockResolvedValue({ id: "d1", name: "Vahid deal" })
    const tx = {
      company: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "co1" }),
      },
      contact: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "c1" }),
        update: vi.fn(),
      },
      deal: { create: dealCreate },
      lead: { update: vi.fn().mockResolvedValue({ id: "l1", status: "converted" }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx))

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Vahid deal", dealValue: 20000 }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(201)
    expect(dealCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Vahid deal",
        valueAmount: 20000,
        customerNeed: null,
      }),
    })
    expect(dealCreate.mock.calls[0][0].data).not.toHaveProperty("title")
  })

  it("routes an Inbox lead deal to SMM with an SMM stage and probability", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "l1",
      contactName: "TikTok buyer",
      companyName: null,
      email: null,
      phone: null,
      source: "tiktok",
      interest: "Asked for price",
      estimatedValue: 1200,
      status: "new",
      assignedTo: "sales-1",
    } as any)
    vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue({ id: "message-1" } as any)
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({
      id: "pipe-smm",
      name: "SMM",
      stages: [
        { name: "LEAD", probability: 15 },
        { name: "QUALIFIED", probability: 35 },
      ],
    } as any)

    const dealCreate = vi.fn().mockResolvedValue({ id: "d1", name: "TikTok deal" })
    const tx = {
      contact: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "c1" }),
        update: vi.fn(),
      },
      deal: { create: dealCreate },
      lead: { update: vi.fn().mockResolvedValue({ id: "l1", status: "converted" }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx))

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({
          dealTitle: "TikTok deal",
          dealStage: "QUALIFIED",
          pipelineId: "pipe-default",
        }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(201)
    expect(prisma.pipeline.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        name: { equals: "SMM", mode: "insensitive" },
      }),
    }))
    expect(dealCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pipelineId: "pipe-smm",
        stage: "QUALIFIED",
        probability: 35,
        assignedTo: "sales-1",
      }),
    })
  })

  it("inherits a manually selected lead pipeline when creating the deal", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({
      id: "l1",
      contactName: "Architect buyer",
      companyName: null,
      email: null,
      phone: null,
      source: "referral",
      pipelineId: "pipe-architects",
      status: "new",
    } as any)
    vi.mocked(prisma.pipeline.findFirst).mockResolvedValue({
      id: "pipe-architects",
      name: "Memarlar",
      stages: [
        { name: "LEAD", probability: 10 },
        { name: "QUALIFIED", probability: 30 },
      ],
    } as any)
    const dealCreate = vi.fn().mockResolvedValue({ id: "d1", name: "Architect deal" })
    const tx = {
      contact: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "c1" }),
        update: vi.fn(),
      },
      deal: { create: dealCreate },
      lead: { update: vi.fn().mockResolvedValue({ id: "l1", status: "converted" }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx))

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Architect deal" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(201)
    expect(dealCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pipelineId: "pipe-architects",
        stage: "QUALIFIED",
        probability: 30,
      }),
    })
  })

  it("POST returns 404 for missing lead", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null)

    const res = await leadConvertPOST(
      req("/api/v1/leads/bad/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "X" }),
      }),
      params("bad")
    )
    expect(res.status).toBe(404)
  })

  it("POST rejects already converted lead", async () => {
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "l1", status: "converted" } as any)

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "X" }),
      }),
      params("l1")
    )
    expect(res.status).toBe(400)
  })
})
