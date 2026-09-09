/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    app: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    appInstallation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    namedCredential: {
      findMany: vi.fn(),
    },
    customField: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    platformEventDefinition: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/superadmin-guard", () => ({
  requireSuperAdmin: vi.fn(),
}))

vi.mock("@/lib/workforce/default-configuration-provisioning", () => ({
  ensureWorkforceDefaultProfile: vi.fn(),
}))

import { GET, PATCH } from "@/app/api/v1/admin/tenants/[id]/capabilities/route"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { ensureWorkforceDefaultProfile } from "@/lib/workforce/default-configuration-provisioning"

const AUTH = {
  orgId: "admin-org",
  userId: "super-1",
  role: "superadmin" as const,
  email: "admin@test.com",
  name: "Admin",
}

function makeReq(method = "GET", body?: unknown) {
  return new NextRequest(new URL("/api/v1/admin/tenants/t1/capabilities", "http://localhost:3000"), {
    method,
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  })
}

function makeParams(id = "t1") {
  return { params: Promise.resolve({ id }) }
}

const tenant = {
  id: "t1",
  name: "Mars Overseas",
  slug: "mars-overseas",
  plan: "enterprise",
  addons: [],
  features: ["crm", "sales", "settings", "mtm"],
  modules: { crm: true, sales: true, settings: true, mtm: true },
  settings: {
    marketplaceCapabilities: {
      requested: {
        "ai-security-monitoring": true,
        "slack-deal-notifier": true,
        "lead-scoring-template": true,
      },
    },
  },
}

const leadScoringApp = {
  id: "app-lead",
  slug: "lead-scoring-rules",
  version: "1.0.0",
  manifest: {
    schemaVersion: 1,
    capabilities: {
      customFields: [
        {
          entityType: "lead",
          fieldName: "ai_score",
          fieldLabel: "AI Score",
          fieldType: "number",
          required: false,
        },
      ],
      eventSubscriptions: [
        {
          ref: "lead_score_recompute",
          eventName: "lead_updated",
          codeModuleSlug: "lead_scoring",
        },
      ],
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSuperAdmin).mockResolvedValue(AUTH as any)
  vi.mocked(ensureWorkforceDefaultProfile).mockResolvedValue({
    state: "provisioned",
    profileVersion: "baku-standard-v1",
    effectiveFrom: "2026-08-30",
    policyId: "default-policy",
    shiftTemplateId: "default-shift",
  } as never)
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma))
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(tenant as any)
  vi.mocked(prisma.organization.update).mockResolvedValue({ id: "t1" } as any)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any)
  vi.mocked(prisma.app.findMany).mockResolvedValue([
    { id: "app-slack", slug: "slack-deal-notifier" },
    { id: "app-lead", slug: "lead-scoring-rules" },
  ] as any)
  vi.mocked(prisma.app.findFirst).mockResolvedValue(leadScoringApp as any)
  vi.mocked(prisma.appInstallation.findMany).mockResolvedValue([])
  vi.mocked(prisma.appInstallation.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.appInstallation.create).mockResolvedValue({
    id: "install-lead",
    appId: "app-lead",
    installedVersion: "1.0.0",
    config: {},
    status: "active",
    installedAt: new Date("2026-06-27T00:00:00.000Z"),
    updatedAt: new Date("2026-06-27T00:00:00.000Z"),
  } as any)
  vi.mocked(prisma.appInstallation.update).mockResolvedValue({
    id: "install-lead",
    appId: "app-lead",
    installedVersion: "1.0.0",
    config: {},
    status: "active",
    installedAt: new Date("2026-06-27T00:00:00.000Z"),
    updatedAt: new Date("2026-06-27T00:00:00.000Z"),
  } as any)
  vi.mocked(prisma.namedCredential.findMany).mockResolvedValue([])
  vi.mocked(prisma.customField.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.customField.create).mockResolvedValue({ id: "cf-ai-score" } as any)
  vi.mocked(prisma.customField.update).mockResolvedValue({ id: "cf-ai-score" } as any)
  vi.mocked(prisma.platformEventDefinition.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.platformEventDefinition.create).mockResolvedValue({ id: "event-lead-updated" } as any)
  vi.mocked(prisma.platformEventDefinition.update).mockResolvedValue({ id: "event-lead-updated" } as any)
})

describe("GET /api/v1/admin/tenants/[id]/capabilities", () => {
  it("returns resolved capabilities for a superadmin tenant view", async () => {
    const res = await GET(makeReq(), makeParams())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.tenant.slug).toBe("mars-overseas")
    expect(body.data.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "route-field", status: "enabled", entitlementKeys: ["route-field"] }),
        expect.objectContaining({ id: "ai-security-monitoring", status: "requested", entitlementKeys: ["ai_security_monitoring"] }),
      ]),
    )
  })
})

describe("PATCH /api/v1/admin/tenants/[id]/capabilities", () => {
  it("approves a requested feature capability by updating features, modules, and request state", async () => {
    // ai-security-monitoring is layered on the `ai` owner module — grant it via addons.
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      ...tenant,
      addons: ["ai"],
    } as any)

    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "ai-security-monitoring", action: "approve" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        features: ["crm", "sales", "settings", "mtm", "ai_security_monitoring"],
        modules: { crm: true, sales: true, settings: true, mtm: true, ai_security_monitoring: true },
        settings: {
          marketplaceCapabilities: {
            requested: { "slack-deal-notifier": true, "lead-scoring-template": true },
          },
        },
      },
      select: { id: true },
    })
    expect(logAudit).toHaveBeenCalledWith(
      "admin-org",
      "approve",
      "tenant_capability",
      "t1:ai-security-monitoring",
      "Mars Overseas",
      expect.objectContaining({ newValue: expect.objectContaining({ entitlementKeys: ["ai_security_monitoring"] }) }),
    )
  })

  it("approves route-field without silently granting workforce-hrm or legacy mtm", async () => {
    const routesOnlyTenant = {
      ...tenant,
      features: ["crm", "sales", "settings"],
      modules: { crm: true, sales: true, settings: true },
      settings: {
        marketplaceCapabilities: {
          requested: { "route-field": true },
        },
      },
    }
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(routesOnlyTenant as any)

    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "route-field", action: "approve" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        features: ["crm", "sales", "settings", "route-field"],
        modules: { crm: true, sales: true, settings: true, "route-field": true },
        settings: { marketplaceCapabilities: { requested: {} } },
      },
      select: { id: true },
    })
  })

  it("atomically provisions the audited default only after explicit Workforce approval", async () => {
    const workforceOnlyTenant = {
      ...tenant,
      features: ["crm", "sales", "settings"],
      modules: { crm: true, sales: true, settings: true },
      settings: { marketplaceCapabilities: { requested: { "workforce-hrm": true } } },
    }
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(workforceOnlyTenant as any)

    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "workforce-hrm", action: "approve" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(ensureWorkforceDefaultProfile).toHaveBeenCalledWith({
      db: prisma,
      organizationId: "t1",
      initiatedByUserId: AUTH.userId,
    })
    expect(logAudit).toHaveBeenCalledWith(
      "admin-org",
      "approve",
      "tenant_capability",
      "t1:workforce-hrm",
      "Mars Overseas",
      expect.objectContaining({
        newValue: expect.objectContaining({
          workforceDefaultProfile: expect.objectContaining({
            state: "provisioned",
            profileVersion: "baku-standard-v1",
          }),
        }),
      }),
    )
  })

  it("enables the full Advisor Suite without seed data", async () => {
    const res = await PATCH(
      makeReq("PATCH", { action: "enable_advisor_suite" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        addons: ["ai", "finance", "mtm"],
        features: [
          "crm",
          "sales",
          "settings",
          "mtm",
          "contracts",
          "marketing",
          "support",
          "finance",
          "analytics",
        ],
        modules: {
          crm: true,
          sales: true,
          settings: true,
          mtm: true,
          contracts: true,
          marketing: true,
          support: true,
          finance: true,
          analytics: true,
        },
        settings: {
          marketplaceCapabilities: {
            requested: {
              "ai-security-monitoring": true,
              "slack-deal-notifier": true,
              "lead-scoring-template": true,
            },
          },
          aiDailyBudgetUsd: 10,
          aiAdvisorDailyRequestLimit: 300,
          aiAdvisorExecutionEnabled: true,
          aiAdvisorExecutionDisabled: false,
          aiAdvisorExecutionDailyLimit: 100,
          aiAdvisorActionTypeDailyLimit: 25,
          aiAdvisorMaxAutonomyLevel: "L2",
        },
      },
      select: { id: true },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "t1",
        userId: "super-1",
        action: "enable_advisor_suite",
        entityType: "tenant_capability",
        entityId: "t1:advisor-suite",
        entityName: "Mars Overseas",
        newValue: expect.objectContaining({
          advisorAddons: ["ai", "finance", "mtm"],
          modules: ["crm", "sales", "contracts", "marketing", "support", "finance", "analytics", "mtm", "settings"],
        }),
      }),
    })
  })

  it("repairs disabled Advisor limits when enabling the Advisor Suite", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValueOnce({
      ...tenant,
      addons: ["ai"],
      settings: {
        ...tenant.settings,
        aiDailyBudgetUsd: 0,
        aiAdvisorDailyRequestLimit: 0,
        aiAdvisorExecutionEnabled: false,
        aiAdvisorExecutionDisabled: true,
        aiAdvisorExecutionDailyLimit: 0,
        aiAdvisorActionTypeDailyLimit: 0,
      },
    } as any)

    const res = await PATCH(
      makeReq("PATCH", { action: "enable_advisor_suite" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.organization.update).mock.calls[0]?.[0] as any
    expect(updateCall.data.addons).toEqual(["ai", "finance", "mtm"])
    expect(updateCall.data.settings).toEqual(expect.objectContaining({
      aiDailyBudgetUsd: 10,
      aiAdvisorDailyRequestLimit: 300,
      aiAdvisorExecutionEnabled: true,
      aiAdvisorExecutionDisabled: false,
      aiAdvisorExecutionDailyLimit: 100,
      aiAdvisorActionTypeDailyLimit: 25,
      aiAdvisorMaxAutonomyLevel: "L2",
    }))
  })

  it("rejects a request without changing features or modules", async () => {
    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "ai-security-monitoring", action: "reject_request" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        settings: {
          marketplaceCapabilities: {
            requested: { "slack-deal-notifier": true, "lead-scoring-template": true },
          },
        },
      },
      select: { id: true },
    })
  })

  it("soft-disables Workforce with an explicit false marker while preserving legacy MTM data", async () => {
    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "workforce-hrm", action: "disable" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        features: ["crm", "sales", "settings", "mtm"],
        modules: {
          crm: true,
          sales: true,
          settings: true,
          mtm: true,
          "workforce-hrm": false,
        },
        settings: {
          marketplaceCapabilities: {
            requested: {
              "ai-security-monitoring": true,
              "slack-deal-notifier": true,
              "lead-scoring-template": true,
            },
          },
        },
      },
      select: { id: true },
    })
    expect(logAudit).toHaveBeenCalledWith(
      "admin-org",
      "disable",
      "tenant_capability",
      "t1:workforce-hrm",
      "Mars Overseas",
      expect.objectContaining({ newValue: expect.objectContaining({ enabled: false }) }),
    )
  })

  it("approves an app-only capability by installing the marketplace app", async () => {
    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "lead-scoring-template", action: "approve" }),
      makeParams(),
    )

    expect(res.status).toBe(200)
    expect(prisma.app.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: "lead-scoring-rules", isPublic: true },
    }))
    expect(prisma.customField.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "t1",
        entityType: "lead",
        fieldName: "ai_score",
      }),
    }))
    expect(prisma.platformEventDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "t1",
        name: "lead_updated",
      }),
    }))
    expect(prisma.appInstallation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "t1",
        appId: "app-lead",
        status: "active",
      }),
    }))
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: {
        settings: {
          marketplaceCapabilities: {
            requested: { "ai-security-monitoring": true, "slack-deal-notifier": true },
          },
        },
      },
      select: { id: true },
    })
    expect(logAudit).toHaveBeenCalledWith(
      "admin-org",
      "approve",
      "tenant_capability",
      "t1:lead-scoring-template",
      "Mars Overseas",
      expect.objectContaining({
        newValue: expect.objectContaining({
          appSlug: "lead-scoring-rules",
          installationId: "install-lead",
        }),
      }),
    )
  })

  it("requires the owner module before approving a layered feature capability", async () => {
    // Default tenant fixture has no `ai` addon/module, so the layered
    // ai-security-monitoring capability must not be approvable.
    const res = await PATCH(
      makeReq("PATCH", { capabilityId: "ai-security-monitoring", action: "approve" }),
      makeParams(),
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.missingOwnerModule).toBe("ai")
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })
})
