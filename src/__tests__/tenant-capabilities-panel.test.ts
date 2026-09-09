import { describe, expect, it } from "vitest"
import {
  capabilityHasApprovalPath,
  isAdvisorSuiteActive,
  isCapabilityGrantable,
} from "@/app/admin/tenants/[id]/tenant-capabilities-panel"

describe("TenantCapabilitiesPanel approval helpers", () => {
  it("allows app-backed capabilities to be approved even without entitlement keys", () => {
    expect(capabilityHasApprovalPath({
      entitlementKeys: [],
      appSlug: "lead-scoring-rules",
    })).toBe(true)

    expect(isCapabilityGrantable({
      status: "demo",
      entitlementKeys: [],
      appSlug: "lead-scoring-rules",
    })).toBe(true)
  })

  it("keeps unavailable capabilities non-grantable when there is no entitlement or app binding", () => {
    expect(capabilityHasApprovalPath({
      entitlementKeys: [],
      appSlug: null,
    })).toBe(false)

    expect(isCapabilityGrantable({
      status: "demo",
      entitlementKeys: [],
      appSlug: null,
    })).toBe(false)
  })

  it("does not show active or pending-request capabilities in the available-to-grant bucket", () => {
    expect(isCapabilityGrantable({
      status: "enabled",
      entitlementKeys: ["mtm"],
      appSlug: null,
    })).toBe(false)

    expect(isCapabilityGrantable({
      status: "requested",
      entitlementKeys: [],
      appSlug: "lead-scoring-rules",
    })).toBe(false)
  })

  it("requires AI and route-field coverage before showing Advisor Suite as active", () => {
    expect(isAdvisorSuiteActive([
      { id: "crm-core", enabled: true },
      { id: "sales-core", enabled: true },
      { id: "settings-core", enabled: true },
      { id: "da-vinci-ai", enabled: true },
      { id: "route-field", enabled: false },
    ])).toBe(false)

    expect(isAdvisorSuiteActive([
      { id: "crm-core", enabled: true },
      { id: "sales-core", enabled: true },
      { id: "settings-core", enabled: true },
      { id: "da-vinci-ai", enabled: true },
      { id: "route-field", enabled: true },
    ])).toBe(true)
  })
})
