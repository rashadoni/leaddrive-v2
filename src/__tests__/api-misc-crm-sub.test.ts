import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/* ── mocks ──────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(),
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
    channelConfig: { findMany: vi.fn().mockResolvedValue([]) },
    company: { create: vi.fn() },
    kbArticle: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue({}),
  // Strict loader used by the command layer; same fixture, it only
  // differs when the table cannot be read.
  requireFieldPermissions: vi.fn().mockResolvedValue({}),
  filterWritableFields: vi.fn().mockImplementation((data) => data),
  filterEntityFields: vi.fn().mockImplementation((data) => data),
}))

vi.mock("@/lib/slack", () => ({
  formatDealNotification: vi.fn().mockReturnValue("deal-created"),
  sendSlackNotification: vi.fn().mockResolvedValue(undefined),
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

import { prisma, logAudit } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth } from "@/lib/api-auth"
import { getFieldPermissions, filterWritableFields } from "@/lib/field-filter"
import { convertLeadToDealCommand } from "@/lib/crm-commands/lead/convert-lead-to-deal"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { trackContactEvent } from "@/lib/contact-events"
import { triggerSurveysOnLeadConverted } from "@/lib/survey-triggers"
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
  const sourceUpdatedAt = new Date("2026-09-19T10:00:00.000Z")
  const defaultPipeline = {
    id: "pipe-default",
    name: "Default Sales",
    stages: [
      { id: "stage-lead", name: "LEAD", probability: 10 },
      { id: "stage-qualified", name: "QUALIFIED", probability: 25 },
    ],
  }

  function lead(overrides: Record<string, unknown> = {}) {
    return {
      id: "l1",
      organizationId: "org-1",
      contactName: "John",
      companyName: null,
      email: null,
      phone: null,
      source: "web",
      interest: null,
      notes: null,
      estimatedValue: 5000,
      status: "new",
      assignedTo: null,
      pipelineId: null,
      convertedAt: null,
      updatedAt: sourceUpdatedAt,
      ...overrides,
    }
  }

  function setupConvertTransaction(options: {
    lead?: ReturnType<typeof lead> | null
    pipeline?: typeof defaultPipeline | null
    linkedInbox?: boolean
    claimCount?: number
    currentStatus?: string
    assigneeValid?: boolean
    existingContact?: Record<string, unknown> | null
  } = {}) {
    const sourceLead = options.lead === undefined ? lead() : options.lead
    const convertedLead = sourceLead
      ? { ...sourceLead, status: options.currentStatus ?? "converted", convertedAt: new Date() }
      : null
    const leadFindFirst = vi.fn()
    if (sourceLead) {
      leadFindFirst.mockResolvedValueOnce(sourceLead).mockResolvedValueOnce(convertedLead)
    } else {
      leadFindFirst.mockResolvedValue(null)
    }

    const dealCreate = vi.fn().mockImplementation(async ({ data }) => ({
      id: "d1",
      ...data,
      valueAmount: data.valueAmount ?? 0,
      currency: "AZN",
    }))
    const tx = {
      lead: {
        findFirst: leadFindFirst,
        updateMany: vi.fn().mockResolvedValue({ count: options.claimCount ?? 1 }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue(options.assigneeValid === false ? null : { id: sourceLead?.assignedTo }),
      },
      channelMessage: {
        findFirst: vi.fn().mockResolvedValue(options.linkedInbox ? { id: "message-1" } : null),
      },
      pipeline: {
        findFirst: vi.fn().mockResolvedValue(options.pipeline === undefined ? defaultPipeline : options.pipeline),
      },
      company: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "co1" }),
      },
      contact: {
        findFirst: vi.fn().mockResolvedValue(options.existingContact ?? null),
        create: vi.fn().mockResolvedValue({
          id: "c1",
          companyId: null,
          fullName: sourceLead?.contactName ?? "John",
        }),
        update: vi.fn(),
      },
      deal: { create: dealCreate },
    }
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => fn(tx))
    return { tx, dealCreate }
  }

  it("POST converts lead to deal+contact", async () => {
    setupConvertTransaction({
      lead: lead({ companyName: "Acme", email: "j@a.com" }),
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

  it("dispatches canonical lead and deal effects after a successful conversion", async () => {
    setupConvertTransaction({ lead: lead({ contactName: "Effect Lead" }) })

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Effect Deal" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(201)
    expect(logAudit).toHaveBeenCalledWith("org-1", "create", "deal", "d1", "Effect Deal")
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "convert",
      "lead",
      "l1",
      "Effect Lead",
      expect.objectContaining({
        newValue: expect.objectContaining({ status: "converted", dealId: "d1", contactId: "c1" }),
      }),
    )
    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "deal",
      "created",
      expect.objectContaining({ id: "d1" }),
    )
    expect(executeWorkflows).toHaveBeenCalledWith(
      "org-1",
      "lead",
      "status_changed",
      expect.objectContaining({ id: "l1", status: "converted" }),
    )
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      entityType: "lead",
      entityId: "l1",
    }))
    expect(fireWebhooks).toHaveBeenCalledWith(
      "org-1",
      "deal.created",
      expect.objectContaining({ id: "d1" }),
    )
    expect(fireWebhooks).toHaveBeenCalledWith(
      "org-1",
      "lead.converted",
      expect.objectContaining({ id: "l1", dealId: "d1", contactId: "c1" }),
    )
    expect(trackContactEvent).toHaveBeenCalledWith(
      "org-1",
      "c1",
      "deal_created",
      expect.objectContaining({ dealId: "d1" }),
    )
    expect(triggerSurveysOnLeadConverted).toHaveBeenCalledWith("org-1", "c1")
  })

  it("writes the submitted deal title to the required Deal.name field", async () => {
    const { dealCreate } = setupConvertTransaction({
      lead: lead({
        contactName: "Vahid",
        companyName: "Memarlıq şirkəti",
        estimatedValue: 20000,
      }),
    })

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
    const smmPipeline = {
      id: "pipe-smm",
      name: "SMM",
      stages: [
        { id: "smm-lead", name: "LEAD", probability: 15 },
        { id: "smm-qualified", name: "QUALIFIED", probability: 35 },
      ],
    }
    const { tx, dealCreate } = setupConvertTransaction({
      linkedInbox: true,
      pipeline: smmPipeline,
      lead: lead({
      contactName: "TikTok buyer",
      source: "tiktok",
      interest: "Asked for price",
      estimatedValue: 1200,
      assignedTo: "sales-1",
      }),
    })

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
    expect(tx.pipeline.findFirst).toHaveBeenCalledWith(expect.objectContaining({
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
    const architectsPipeline = {
      id: "pipe-architects",
      name: "Memarlar",
      stages: [
        { id: "architect-lead", name: "LEAD", probability: 10 },
        { id: "architect-qualified", name: "QUALIFIED", probability: 30 },
      ],
    }
    const { dealCreate } = setupConvertTransaction({
      pipeline: architectsPipeline,
      lead: lead({
      contactName: "Architect buyer",
      source: "referral",
      pipelineId: "pipe-architects",
      }),
    })

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
    setupConvertTransaction({ lead: null })

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
    setupConvertTransaction({ lead: lead({ status: "converted" }) })

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "X" }),
      }),
      params("l1")
    )
    expect(res.status).toBe(400)
  })

  it("rejects unknown fields before opening a transaction", async () => {
    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Deal", organizationId: "foreign-org" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("fails closed when deal field permissions reject the title", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...AUTH, role: "sales" } as any)
    vi.mocked(getFieldPermissions).mockResolvedValueOnce({ name: "visible" })
    vi.mocked(filterWritableFields).mockImplementationOnce((data) => {
      const allowed = { ...data }
      delete allowed.name
      return allowed
    })

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Forbidden title" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden", code: "FORBIDDEN_FIELD" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("requires an expected version for voice conversion", async () => {
    await expect(convertLeadToDealCommand({
      organizationId: "org-1",
      userId: "user-1",
      role: "admin",
      source: "voice",
      voiceSessionId: "voice-1",
    }, "l1", { dealTitle: "Voice deal" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects a stale voice confirmation before claiming the lead", async () => {
    const { tx, dealCreate } = setupConvertTransaction()

    await expect(convertLeadToDealCommand({
      organizationId: "org-1",
      userId: "user-1",
      role: "admin",
      source: "voice",
      voiceSessionId: "voice-1",
    }, "l1", {
      dealTitle: "Voice deal",
      expectedUpdatedAt: "2026-09-19T09:00:00.000Z",
    })).rejects.toMatchObject({ code: "STALE_WRITE", status: 409 })

    expect(tx.lead.updateMany).not.toHaveBeenCalled()
    expect(dealCreate).not.toHaveBeenCalled()
  })

  it("claims the lead before creating records so a concurrent conversion cannot duplicate the deal", async () => {
    const { dealCreate } = setupConvertTransaction({ claimCount: 0, currentStatus: "converted" })

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Competing deal" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "Lead already converted" })
    expect(dealCreate).not.toHaveBeenCalled()
  })

  it("rejects a requested stage that is not in the resolved pipeline", async () => {
    const { dealCreate } = setupConvertTransaction()

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Deal", dealStage: "FOREIGN_STAGE" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "Invalid dealStage for pipeline" })
    expect(dealCreate).not.toHaveBeenCalled()
  })

  it("rejects a lead assignee that is not an active member of the tenant", async () => {
    const { dealCreate } = setupConvertTransaction({
      lead: lead({ assignedTo: "foreign-user" }),
      assigneeValid: false,
    })

    const res = await leadConvertPOST(
      req("/api/v1/leads/l1/convert", {
        method: "POST",
        body: JSON.stringify({ dealTitle: "Deal" }),
      }),
      params("l1"),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: "Lead assignee must be an active member of this organization",
    })
    expect(dealCreate).not.toHaveBeenCalled()
  })
})
