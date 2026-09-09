import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { tenantProvisioningRun: { upsert: mocks.upsert } },
}))

vi.mock("@/lib/modules", () => ({
  ADDON_MODULES: {},
  GROUP_MODULE_IDS: [],
  moduleRecordFromOrgFields: vi.fn(),
}))

vi.mock("@/lib/workforce/default-profile", () => ({
  WORKFORCE_DEFAULT_PROFILE_VERSION: 1,
}))

vi.mock("@/lib/workforce/default-configuration-provisioning", () => ({
  ensureWorkforceDefaultProfile: vi.fn(),
}))

vi.mock("@/lib/social/monitoring-subjects", () => ({
  defaultAliasAmbiguity: vi.fn(),
}))

vi.mock("@/lib/ai/social-agent", () => ({
  SOCIAL_AGENT_DEFAULTS: {},
  SOCIAL_AGENT_TYPE: "social",
}))

vi.mock("@/lib/social/monitoring-settings", () => ({
  DEFAULT_REPORT_WINDOW_DAYS: 7,
  DEFAULT_SCHEDULE_CADENCE_MINUTES: 60,
  getSocialMonitoringSettings: vi.fn(),
  platformApifyTokenAvailable: vi.fn(),
  saveSocialMonitoringSettings: vi.fn(),
}))

import {
  createTenantProvisioningRun,
  TENANT_PROVISIONING_STEPS,
} from "@/lib/tenant-provisioning-v2"

describe("createTenantProvisioningRun", () => {
  beforeEach(() => {
    mocks.upsert.mockReset()
    mocks.upsert.mockResolvedValue({ id: "run-1" })
  })

  it("lets the nested run relation supply the composite organization key", async () => {
    await createTenantProvisioningRun({
      organizationId: "org-1",
      idempotencyKey: "provisioning-1",
      provisioning: {
        companyName: "Service Desk",
        features: ["support"],
        addons: [],
        createdBy: "admin-1",
      },
    })

    const call = mocks.upsert.mock.calls[0][0]
    expect(call.create.steps.create).toEqual(
      TENANT_PROVISIONING_STEPS.map((stepKey) => ({ stepKey })),
    )
    expect(call.create.steps.create).not.toContainEqual(
      expect.objectContaining({ organizationId: "org-1" }),
    )
  })
})
