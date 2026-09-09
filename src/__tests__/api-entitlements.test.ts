import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

interface EntitlementRowMock {
  id: string
  companyId: string
  slaPolicyId: string
  supportLevel: string
  validFrom: Date
  validTo: Date | null
  status: string
  expiredAt: null
  cancelledAt: null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  company: { name: string }
  slaPolicy: { name: string }
  _count: { milestoneDefinitions: number }
  milestoneDefinitions: MilestoneDefinitionMock[]
}

interface CompanyOptionMock {
  id: string
  name: string
  status: string
  category: string
  entitlements: Array<{ id: string }>
}

interface SlaPolicyOptionMock {
  id: string
  name: string
  priority: string
  firstResponseHours: number
  resolutionHours: number
  isDefault: boolean
}

interface CreateEntitlementData {
  organizationId: string
  companyId: string
  slaPolicyId: string
  supportLevel: string
  validFrom: Date
  validTo: Date | null
  status: string
  notes: string | null
  createdBy: string | null
}

interface AuditEventData {
  organizationId: string
  entitlementId: string
  eventType: string
  actorUserId: string | null
  payload: Record<string, unknown>
}

interface MilestoneDefinitionMock {
  id: string
  organizationId: string
  entitlementId: string
  type: string
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  _count?: { ticketMilestones: number }
  entitlement?: {
    id: string
    status: string
  }
}

interface TemplateDefinitionMock {
  id: string
  type: string
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

interface EntitlementTemplateMock {
  id: string
  supportLevel: string
  name: string
  description: string | null
  isActive: boolean
  definitions: TemplateDefinitionMock[]
  createdAt: Date
  updatedAt: Date
}

const db: {
  entitlementRows: EntitlementRowMock[]
  companies: CompanyOptionMock[]
  slaPolicies: SlaPolicyOptionMock[]
  createdEntitlement: CreateEntitlementData | null
  existingEntitlement: (CreateEntitlementData & {
    id: string
    status: string
    validFrom: Date
    validTo: Date | null
  }) | null
  duplicateActive: { id: string } | null
  milestoneDefinitions: MilestoneDefinitionMock[]
  updatedEntitlement: Record<string, unknown> | null
  updatedMilestoneDefinition: Record<string, unknown> | null
  deletedMilestoneDefinitionId: string | null
  auditEvent: AuditEventData | null
  auditEvents: AuditEventData[]
  templates: EntitlementTemplateMock[]
  companyFound: { id: string } | null
  slaPolicyFound: { id: string } | null
  authRole: string
} = {
  entitlementRows: [],
  companies: [],
  slaPolicies: [],
  createdEntitlement: null,
  existingEntitlement: null,
  duplicateActive: null,
  milestoneDefinitions: [],
  updatedEntitlement: null,
  updatedMilestoneDefinition: null,
  deletedMilestoneDefinitionId: null,
  auditEvent: null,
  auditEvents: [],
  templates: [],
  companyFound: { id: "company_1" },
  slaPolicyFound: { id: "sla_1" },
  authRole: "admin",
}

function makeTemplate(
  supportLevel: string,
  definitions: Array<Omit<TemplateDefinitionMock, "id" | "createdAt" | "updatedAt" | "sortOrder">>,
): EntitlementTemplateMock {
  return {
    id: `tpl_${supportLevel}`,
    supportLevel,
    name: supportLevel[0].toUpperCase() + supportLevel.slice(1),
    description: null,
    isActive: true,
    definitions: definitions.map((definition, index) => ({
      id: `tpl_${supportLevel}_${index}`,
      ...definition,
      sortOrder: index,
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
    })),
    createdAt: new Date("2026-07-04T00:00:00.000Z"),
    updatedAt: new Date("2026-07-04T00:00:00.000Z"),
  }
}

function defaultTemplates(): EntitlementTemplateMock[] {
  return [
    makeTemplate("basic", [
      { type: "first_response", name: "First response", severityTier: null, dueWithinSeconds: 28800, isRequired: true },
      { type: "resolution", name: "Resolution", severityTier: null, dueWithinSeconds: 432000, isRequired: true },
    ]),
    makeTemplate("standard", [
      { type: "first_response", name: "First response", severityTier: null, dueWithinSeconds: 14400, isRequired: true },
      { type: "problem_identified", name: "Problem identified", severityTier: null, dueWithinSeconds: 86400, isRequired: true },
      { type: "resolution", name: "Resolution", severityTier: null, dueWithinSeconds: 259200, isRequired: true },
    ]),
    makeTemplate("premium", [
      { type: "first_response", name: "Critical first response", severityTier: "critical", dueWithinSeconds: 1800, isRequired: true },
      { type: "first_response", name: "First response", severityTier: null, dueWithinSeconds: 7200, isRequired: true },
      { type: "resolution", name: "Resolution", severityTier: null, dueWithinSeconds: 172800, isRequired: true },
    ]),
    makeTemplate("enterprise", [
      { type: "first_response", name: "Critical first response", severityTier: "critical", dueWithinSeconds: 900, isRequired: true },
      { type: "first_response", name: "High first response", severityTier: "high", dueWithinSeconds: 1800, isRequired: true },
      { type: "first_response", name: "First response", severityTier: null, dueWithinSeconds: 3600, isRequired: true },
      { type: "problem_identified", name: "Critical problem identified", severityTier: "critical", dueWithinSeconds: 14400, isRequired: true },
      { type: "workaround_delivered", name: "Critical workaround", severityTier: "critical", dueWithinSeconds: 28800, isRequired: false },
      { type: "resolution", name: "Critical resolution", severityTier: "critical", dueWithinSeconds: 86400, isRequired: true },
    ]),
  ]
}

vi.mock("@/lib/prisma", () => {
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
    entitlement: {
      findMany: vi.fn(async () => db.entitlementRows),
      findFirst: vi.fn(async ({ where }: { where?: { status?: string; id?: { not?: string } } } = {}) => {
        if (where?.status === "active" && where.id?.not) return db.duplicateActive
        return db.existingEntitlement
      }),
      create: vi.fn(async ({ data }: { data: CreateEntitlementData }) => {
        db.createdEntitlement = data
        const row = {
          id: "ent_1",
          companyId: data.companyId,
          slaPolicyId: data.slaPolicyId,
          supportLevel: data.supportLevel,
          validFrom: data.validFrom,
          validTo: data.validTo,
          status: data.status,
          expiredAt: null,
          cancelledAt: null,
          notes: data.notes,
          createdAt: new Date("2026-07-04T00:00:00.000Z"),
          updatedAt: new Date("2026-07-04T00:00:00.000Z"),
          company: { name: "Acme" },
          slaPolicy: { name: "Gold SLA" },
          _count: { milestoneDefinitions: 0 },
          milestoneDefinitions: [],
        }
        db.entitlementRows = [row]
        return { id: row.id }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.updatedEntitlement = data
        db.existingEntitlement = db.existingEntitlement
          ? { ...db.existingEntitlement, ...data }
          : null
        return { id: "ent_existing", ...db.existingEntitlement, ...data }
      }),
    },
    company: {
      findMany: vi.fn(async () => db.companies),
      findFirst: vi.fn(async () => db.companyFound),
    },
    slaPolicy: {
      findMany: vi.fn(async () => db.slaPolicies),
      findFirst: vi.fn(async () => db.slaPolicyFound),
    },
    entitlementMilestoneDefinition: {
      findMany: vi.fn(async ({ where }: { where?: { entitlementId?: string; organizationId?: string } } = {}) => {
        return db.milestoneDefinitions.filter((definition) => {
          if (where?.organizationId && definition.organizationId !== where.organizationId) return false
          if (where?.entitlementId && definition.entitlementId !== where.entitlementId) return false
          return true
        })
      }),
      findFirst: vi.fn(async ({ where }: { where?: { id?: string; entitlementId?: string; organizationId?: string; type?: string; severityTier?: string | null } } = {}) => {
        const match = db.milestoneDefinitions.find((definition) => {
          if (where?.id && definition.id !== where.id) return false
          if (where?.organizationId && definition.organizationId !== where.organizationId) return false
          if (where?.entitlementId && definition.entitlementId !== where.entitlementId) return false
          if (where?.type && definition.type !== where.type) return false
          if ("severityTier" in (where ?? {}) && definition.severityTier !== where?.severityTier) return false
          return true
        })
        if (!match) return null
        return {
          ...match,
          entitlement: match.entitlement ?? {
            id: match.entitlementId,
            status: db.existingEntitlement?.status ?? "draft",
          },
          _count: match._count ?? { ticketMilestones: 0 },
        }
      }),
      count: vi.fn(async ({ where }: { where?: { entitlementId?: string; organizationId?: string } } = {}) => {
        return db.milestoneDefinitions.filter((definition) => {
          if (where?.organizationId && definition.organizationId !== where.organizationId) return false
          if (where?.entitlementId && definition.entitlementId !== where.entitlementId) return false
          return true
        }).length
      }),
      create: vi.fn(async ({ data }: { data: Omit<MilestoneDefinitionMock, "id" | "createdAt" | "updatedAt"> }) => {
        const row: MilestoneDefinitionMock = {
          id: `ms_${db.milestoneDefinitions.length + 1}`,
          organizationId: data.organizationId,
          entitlementId: data.entitlementId,
          type: data.type,
          name: data.name,
          severityTier: data.severityTier,
          dueWithinSeconds: data.dueWithinSeconds,
          isRequired: data.isRequired,
          metadata: data.metadata ?? {},
          createdAt: new Date("2026-07-04T00:00:00.000Z"),
          updatedAt: new Date("2026-07-04T00:00:00.000Z"),
          _count: { ticketMilestones: 0 },
          entitlement: {
            id: data.entitlementId,
            status: db.existingEntitlement?.status ?? "draft",
          },
        }
        db.milestoneDefinitions.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        db.updatedMilestoneDefinition = data
        const index = db.milestoneDefinitions.findIndex((definition) => definition.id === where.id)
        if (index >= 0) {
          db.milestoneDefinitions[index] = {
            ...db.milestoneDefinitions[index],
            ...data,
            updatedAt: new Date("2026-07-04T01:00:00.000Z"),
          } as MilestoneDefinitionMock
          return db.milestoneDefinitions[index]
        }
        return { id: where.id, ...data }
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        db.deletedMilestoneDefinitionId = where.id
        db.milestoneDefinitions = db.milestoneDefinitions.filter((definition) => definition.id !== where.id)
        return { id: where.id }
      }),
    },
    entitlementTicketMilestone: {
      findMany: vi.fn(async () => []),
    },
    entitlementAuditEvent: {
      create: vi.fn(async ({ data }: { data: AuditEventData }) => {
        db.auditEvent = data
        db.auditEvents.push(data)
        return { id: "audit_1", ...data }
      }),
    },
  }
  return { prisma }
})

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth:
    (_module: string, _action: string, handler: (
      req: NextRequest,
      auth: { orgId: string; userId: string; role: string },
      ctx?: unknown,
    ) => unknown) =>
    (req: NextRequest, ctx?: unknown) =>
      handler(req, { orgId: "org_1", userId: "user_1", role: db.authRole }, ctx),
}))

vi.mock("@/lib/entitlement-process/template-settings", () => ({
  ensureEntitlementTemplates: vi.fn(async () => db.templates),
  getEntitlementTemplate: vi.fn(async (_orgId: string, supportLevel: string) => (
    db.templates.find((template) => template.supportLevel === supportLevel) ?? null
  )),
  replaceEntitlementTemplate: vi.fn(async (_orgId: string, input: {
    supportLevel: string
    name: string
    description?: string | null
    isActive: boolean
    definitions: Array<{
      type: string
      name: string
      severityTier: string | null
      dueWithinSeconds: number
      isRequired: boolean
    }>
  }) => {
    const template = makeTemplate(input.supportLevel, input.definitions)
    template.name = input.name.trim()
    template.description = input.description?.trim() || null
    template.isActive = input.isActive
    db.templates = [
      ...db.templates.filter((item) => item.supportLevel !== input.supportLevel),
      template,
    ]
    return template
  }),
}))

import {
  GET as GET_TEMPLATES,
  PUT as PUT_TEMPLATE,
} from "@/app/api/v1/entitlement-templates/route"
import { PATCH } from "@/app/api/v1/entitlements/[id]/route"
import {
  GET as GET_MILESTONES,
  POST as POST_MILESTONE,
} from "@/app/api/v1/entitlements/[id]/milestones/route"
import {
  DELETE as DELETE_MILESTONE,
  PATCH as PATCH_MILESTONE,
} from "@/app/api/v1/entitlements/[id]/milestones/[milestoneId]/route"
import { GET, POST } from "@/app/api/v1/entitlements/route"
import { prisma } from "@/lib/prisma"
import { replaceEntitlementTemplate } from "@/lib/entitlement-process/template-settings"

function req(path = "http://localhost/api/v1/entitlements") {
  return new NextRequest(path)
}

function jsonReq(body: unknown) {
  return new NextRequest("http://localhost/api/v1/entitlements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.entitlementRows = []
  db.companies = [
    {
      id: "company_1",
      name: "Acme",
      status: "active",
      category: "client",
      entitlements: [{ id: "ent_active" }],
    },
  ]
  db.slaPolicies = [
    {
      id: "sla_1",
      name: "Gold SLA",
      priority: "high",
      firstResponseHours: 1,
      resolutionHours: 8,
      isDefault: true,
    },
  ]
  db.createdEntitlement = null
  db.existingEntitlement = {
    id: "ent_existing",
    organizationId: "org_1",
    companyId: "company_1",
    slaPolicyId: "sla_1",
    supportLevel: "standard",
    validFrom: new Date("2026-07-04T00:00:00.000Z"),
    validTo: null,
    status: "draft",
    notes: null,
    createdBy: "user_1",
  }
  db.duplicateActive = null
  db.milestoneDefinitions = []
  db.updatedEntitlement = null
  db.updatedMilestoneDefinition = null
  db.deletedMilestoneDefinitionId = null
  db.auditEvent = null
  db.auditEvents = []
  db.templates = defaultTemplates()
  db.companyFound = { id: "company_1" }
  db.slaPolicyFound = { id: "sla_1" }
  db.authRole = "admin"
})

describe("GET /api/v1/entitlements", () => {
  it("returns entitlements plus company and SLA options for setup", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.companies).toEqual([
      {
        id: "company_1",
        name: "Acme",
        status: "active",
        category: "client",
        hasActiveEntitlement: true,
      },
    ])
    expect(json.slaPolicies).toHaveLength(1)
    expect(json.totalEntitlements).toBe(0)
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org_1" } }),
    )
  })

  it("returns entitlement capabilities for read-only ticketing roles", async () => {
    db.authRole = "ticketing"

    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.permissions).toMatchObject({
      canRead: true,
      canWrite: false,
      canActivate: false,
      canCancel: false,
      canWaiveMilestone: false,
    })
  })

  it("blocks non-support read roles from customer support terms", async () => {
    db.authRole = "sales"

    const res = await GET(req())

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden" })
    expect(prisma.entitlement.findMany).not.toHaveBeenCalled()
  })
})

describe("Entitlement templates API", () => {
  it("returns tenant support-level templates", async () => {
    const res = await GET_TEMPLATES(req("http://localhost/api/v1/entitlement-templates"))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.templates).toHaveLength(4)
    expect(json.templates.find((template: EntitlementTemplateMock) => template.supportLevel === "enterprise"))
      .toMatchObject({ name: "Enterprise", isActive: true })
  })

  it("blocks template reads for non-support roles", async () => {
    db.authRole = "sales"

    const res = await GET_TEMPLATES(req("http://localhost/api/v1/entitlement-templates"))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden" })
  })

  it("saves a support-level template and converts due windows", async () => {
    const res = await PUT_TEMPLATE(jsonReq({
      supportLevel: "premium",
      name: "Premium plus",
      description: "Priority support",
      isActive: true,
      definitions: [
        {
          type: "first_response",
          name: "Priority first response",
          severityTier: "critical",
          dueValue: 45,
          dueUnit: "minutes",
          isRequired: true,
        },
      ],
    }))

    expect(res.status).toBe(200)
    expect(replaceEntitlementTemplate).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({
        supportLevel: "premium",
        name: "Premium plus",
        definitions: [
          expect.objectContaining({
            type: "first_response",
            severityTier: "critical",
            dueWithinSeconds: 2700,
          }),
        ],
      }),
    )
    expect((await res.json()).template).toMatchObject({
      supportLevel: "premium",
      name: "Premium plus",
    })
  })

  it("rejects an active template with no rules", async () => {
    const res = await PUT_TEMPLATE(jsonReq({
      supportLevel: "standard",
      name: "Standard",
      description: null,
      isActive: true,
      definitions: [],
    }))

    expect(res.status).toBe(422)
    expect(replaceEntitlementTemplate).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/v1/entitlements/:id", () => {
  it("blocks agent-level roles from editing support terms", async () => {
    db.authRole = "ticketing"

    const res = await PATCH(
      jsonReq({ supportLevel: "premium" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden" })
    expect(prisma.entitlement.update).not.toHaveBeenCalled()
  })

  it("keeps lifecycle actions admin-only even for support managers", async () => {
    db.authRole = "manager"

    const res = await PATCH(
      jsonReq({ action: "activate" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden" })
    expect(prisma.entitlement.update).not.toHaveBeenCalled()
  })

  it("updates editable fields on a suspended support term and writes audit", async () => {
    db.existingEntitlement = {
      ...db.existingEntitlement!,
      status: "suspended",
    }

    const res = await PATCH(
      jsonReq({
        supportLevel: "enterprise",
        validFrom: "2026-07-05",
        validTo: "2026-12-31",
        notes: "Updated terms",
      }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(200)
    expect(db.updatedEntitlement).toMatchObject({
      supportLevel: "enterprise",
      notes: "Updated terms",
    })
    expect(db.updatedEntitlement?.validFrom).toBeInstanceOf(Date)
    expect(db.updatedEntitlement?.validTo).toBeInstanceOf(Date)
    expect(db.auditEvents.at(-1)).toMatchObject({
      eventType: "entitlement_updated",
      entitlementId: "ent_existing",
      actorUserId: "user_1",
    })
  })

  it("activates a draft support term and blocks duplicate active terms", async () => {
    db.duplicateActive = { id: "ent_active" }

    const duplicate = await PATCH(
      jsonReq({ action: "activate" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({
      error: "This company already has an active support term.",
    })

    db.duplicateActive = null
    db.milestoneDefinitions = [{
      id: "ms_ready",
      organizationId: "org_1",
      entitlementId: "ent_existing",
      type: "first_response",
      name: "First response",
      severityTier: null,
      dueWithinSeconds: 3600,
      isRequired: true,
      metadata: {},
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      _count: { ticketMilestones: 0 },
      entitlement: { id: "ent_existing", status: "draft" },
    }]
    const activated = await PATCH(
      jsonReq({ action: "activate" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )
    expect(activated.status).toBe(200)
    expect(db.updatedEntitlement).toMatchObject({ status: "active" })
    expect(db.auditEvents.at(-1)).toMatchObject({
      eventType: "entitlement_activated",
      entitlementId: "ent_existing",
    })
  })

  it("requires milestone rules before activation", async () => {
    const res = await PATCH(
      jsonReq({ action: "activate" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/milestone rule/)
    expect(prisma.entitlement.update).not.toHaveBeenCalled()
  })

  it("requires a cancellation reason", async () => {
    const res = await PATCH(
      jsonReq({ action: "cancel" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Cancellation reason/)
    expect(prisma.entitlement.update).not.toHaveBeenCalled()
  })
})

describe("Milestone definitions", () => {
  it("lets support managers create milestone definitions on editable terms", async () => {
    db.authRole = "manager"

    const res = await POST_MILESTONE(
      jsonReq({
        mode: "definition",
        type: "workaround_delivered",
        severityTier: "high",
        dueValue: 2,
        dueUnit: "hours",
        isRequired: false,
      }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(201)
    expect(db.milestoneDefinitions[0]).toMatchObject({
      type: "workaround_delivered",
      severityTier: "high",
      dueWithinSeconds: 7200,
    })
  })

  it("blocks agent-level roles from changing milestone definitions", async () => {
    db.authRole = "support"

    const res = await POST_MILESTONE(
      jsonReq({
        mode: "definition",
        type: "first_response",
        severityTier: "critical",
        dueValue: 30,
        dueUnit: "minutes",
        isRequired: true,
      }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(403)
    expect(db.milestoneDefinitions).toHaveLength(0)
  })

  it("lists milestone definitions for a support term", async () => {
    db.milestoneDefinitions = [{
      id: "ms_1",
      organizationId: "org_1",
      entitlementId: "ent_existing",
      type: "first_response",
      name: "First response",
      severityTier: null,
      dueWithinSeconds: 3600,
      isRequired: true,
      metadata: {},
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      _count: { ticketMilestones: 0 },
    }]

    const res = await GET_MILESTONES(
      req("http://localhost/api/v1/entitlements/ent_existing/milestones"),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.definitions).toHaveLength(1)
    expect(json.definitions[0]).toMatchObject({
      id: "ms_1",
      type: "first_response",
      dueWithinSeconds: 3600,
    })
    expect(json.entitlement.canEditMilestones).toBe(true)
  })

  it("creates a manual milestone definition and blocks duplicate type/severity", async () => {
    const created = await POST_MILESTONE(
      jsonReq({
        mode: "definition",
        type: "first_response",
        severityTier: "critical",
        dueValue: 30,
        dueUnit: "minutes",
        isRequired: true,
      }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(created.status).toBe(201)
    expect(db.milestoneDefinitions[0]).toMatchObject({
      type: "first_response",
      severityTier: "critical",
      dueWithinSeconds: 1800,
      isRequired: true,
    })
    expect(db.auditEvents.at(-1)).toMatchObject({
      eventType: "entitlement_updated",
      payload: expect.objectContaining({
        action: "milestone_definition_created",
      }),
    })

    const duplicate = await POST_MILESTONE(
      jsonReq({
        mode: "definition",
        type: "first_response",
        severityTier: "critical",
        dueValue: 1,
        dueUnit: "hours",
        isRequired: false,
      }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(duplicate.status).toBe(409)
    expect((await duplicate.json()).error).toMatch(/already exists/)
  })

  it("applies a template to an editable support term", async () => {
    const res = await POST_MILESTONE(
      jsonReq({ mode: "template", template: "enterprise" }),
      { params: Promise.resolve({ id: "ent_existing" }) },
    )

    expect(res.status).toBe(200)
    expect(db.milestoneDefinitions.length).toBeGreaterThan(5)
    expect(db.milestoneDefinitions.some((definition) => definition.severityTier === "critical")).toBe(true)
    expect(db.auditEvents.at(-1)).toMatchObject({
      eventType: "entitlement_updated",
      payload: expect.objectContaining({
        action: "milestone_template_applied",
        template: "enterprise",
      }),
    })
  })

  it("updates due window and required flag without changing the natural key", async () => {
    db.milestoneDefinitions = [{
      id: "ms_1",
      organizationId: "org_1",
      entitlementId: "ent_existing",
      type: "resolution",
      name: "Resolution",
      severityTier: null,
      dueWithinSeconds: 86400,
      isRequired: true,
      metadata: {},
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      _count: { ticketMilestones: 0 },
    }]

    const res = await PATCH_MILESTONE(
      jsonReq({
        name: "Resolution target",
        dueValue: 2,
        dueUnit: "days",
        isRequired: false,
      }),
      { params: Promise.resolve({ id: "ent_existing", milestoneId: "ms_1" }) },
    )

    expect(res.status).toBe(200)
    expect(db.updatedMilestoneDefinition).toMatchObject({
      name: "Resolution target",
      dueWithinSeconds: 172800,
      isRequired: false,
    })
    expect(db.updatedMilestoneDefinition).not.toHaveProperty("type")
    expect(db.updatedMilestoneDefinition).not.toHaveProperty("severityTier")
    expect(db.auditEvents.at(-1)).toMatchObject({
      payload: expect.objectContaining({
        action: "milestone_definition_updated",
      }),
    })
  })

  it("does not delete a milestone definition already used by tickets", async () => {
    db.milestoneDefinitions = [{
      id: "ms_used",
      organizationId: "org_1",
      entitlementId: "ent_existing",
      type: "resolution",
      name: "Resolution",
      severityTier: null,
      dueWithinSeconds: 86400,
      isRequired: true,
      metadata: {},
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
      _count: { ticketMilestones: 2 },
    }]

    const res = await DELETE_MILESTONE(
      req("http://localhost/api/v1/entitlements/ent_existing/milestones/ms_used"),
      { params: Promise.resolve({ id: "ent_existing", milestoneId: "ms_used" }) },
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already used/)
    expect(db.deletedMilestoneDefinitionId).toBeNull()
  })
})

describe("POST /api/v1/entitlements", () => {
  it("blocks ticketing agents from creating support terms", async () => {
    db.authRole = "ticketing"

    const res = await POST(jsonReq({
      companyId: "company_1",
      slaPolicyId: "sla_1",
      supportLevel: "premium",
      validFrom: "2026-07-04",
      validTo: null,
    }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden" })
    expect(prisma.entitlement.create).not.toHaveBeenCalled()
  })

  it("creates a draft support term and audit event", async () => {
    const res = await POST(jsonReq({
      companyId: "company_1",
      slaPolicyId: "sla_1",
      supportLevel: "premium",
      validFrom: "2026-07-04",
      validTo: "2026-12-31",
      notes: "Priority customer",
    }))

    expect(res.status).toBe(201)
    expect(db.createdEntitlement).not.toBeNull()
    const createdEntitlement = db.createdEntitlement!
    expect(createdEntitlement).toMatchObject({
      organizationId: "org_1",
      companyId: "company_1",
      slaPolicyId: "sla_1",
      supportLevel: "premium",
      status: "draft",
      notes: "Priority customer",
      createdBy: "user_1",
    })
    expect(createdEntitlement.validFrom).toBeInstanceOf(Date)
    expect(createdEntitlement.validTo).toBeInstanceOf(Date)
    expect(db.auditEvent).toMatchObject({
      organizationId: "org_1",
      entitlementId: "ent_1",
      eventType: "entitlement_created",
      actorUserId: "user_1",
    })

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.createdEntitlementId).toBe("ent_1")
    expect(json.entitlements).toHaveLength(1)
  })

  it("rejects an end date before the start date", async () => {
    const res = await POST(jsonReq({
      companyId: "company_1",
      slaPolicyId: "sla_1",
      supportLevel: "standard",
      validFrom: "2026-12-31",
      validTo: "2026-07-04",
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/validTo/)
    expect(prisma.entitlement.create).not.toHaveBeenCalled()
  })
})
