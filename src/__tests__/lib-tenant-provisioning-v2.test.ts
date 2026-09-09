import { describe, expect, it } from "vitest"
import {
  TENANT_CHANNEL_BLUEPRINT,
  TENANT_PROVIDER_BLUEPRINT,
  buildBrandAgentPrompt,
  buildProviderSpendPolicy,
  buildSocialMonitoringFoundationSettings,
  selectedChannelBlueprint,
  shouldProvisionWorkforceDefaultProfile,
} from "@/lib/tenant-provisioning-v2"
import { DEFAULT_REPORT_WINDOW_DAYS, DEFAULT_SCHEDULE_CADENCE_MINUTES } from "@/lib/social/monitoring-settings"

describe("tenant provisioning v2", () => {
  it("provisions the Baku baseline only for a newly stamped explicit Workforce entitlement", () => {
    expect(shouldProvisionWorkforceDefaultProfile({
      features: ["workforce-hrm"],
      workforceDefaultProfileVersion: "baku-standard-v1",
    })).toBe(true)
    expect(shouldProvisionWorkforceDefaultProfile({
      features: ["mtm"],
      workforceDefaultProfileVersion: "baku-standard-v1",
    })).toBe(false)
    expect(shouldProvisionWorkforceDefaultProfile({
      features: ["workforce-hrm"],
    })).toBe(false)
  })

  it("builds a subject-specific AI prompt without leaking another tenant's brand", () => {
    const prompt = buildBrandAgentPrompt({
      tenantName: "Northwind Workspace",
      brand: {
        name: "Northwind",
        legalName: "Northwind LLC",
        languages: ["az", "ru"],
        supportEmail: "care@northwind.example",
      },
    })

    expect(prompt).toContain("Northwind (legal entity: Northwind LLC)")
    expect(prompt).toContain("care@northwind.example")
    expect(prompt).toContain("Never claim to represent another brand")
    expect(prompt).not.toMatch(/Zeytun|PharmaStore|PharmOnline|Baku Electronics|Oba Market/i)
  })

  it("initializes only the selected platform surfaces and never enables capabilities", () => {
    const selected = selectedChannelBlueprint(["facebook", "instagram"])

    expect(selected).toHaveLength(4)
    expect(new Set(selected.map((item) => item.platform))).toEqual(new Set(["facebook", "instagram"]))
    expect(selected.every((item) => Object.values(item.capabilities).every((value) => value === false))).toBe(true)

    const compositeKeys = TENANT_CHANNEL_BLUEPRINT.map(
      (item) => `${item.platform}:${item.surface}:${item.provider}`,
    )
    expect(new Set(compositeKeys).size).toBe(compositeKeys.length)
  })

  it("keeps provider provisioning configuration-only for platform and BYOK billing", () => {
    const platformPolicy = buildProviderSpendPolicy({
      providerKey: "bright_data",
      billingMode: "platform",
      enabled: true,
      spendPolicy: { monthlyBudgetUsd: 250 },
    }, "platform")
    const byokPolicy = buildProviderSpendPolicy({
      providerKey: "apify",
      billingMode: "byok",
      enabled: true,
    }, "byok")

    expect(platformPolicy).toMatchObject({
      sourceOfTruth: "provider_account",
      monthlyBudgetUsd: null,
      provisioningMayDispatch: false,
    })
    expect(byokPolicy).toMatchObject({
      sourceOfTruth: "provider_account",
      provisioningMayDispatch: false,
    })
    expect(TENANT_PROVIDER_BLUEPRINT.map((item) => item.providerKey)).toEqual([
      "serpapi",
      "bright_data",
      "apify",
    ])
  })

  it("uses provider-account budgets for Bright Data and SerpApi without creating a local cap", () => {
    for (const providerKey of ["bright_data", "serpapi"] as const) {
      expect(buildProviderSpendPolicy({
        providerKey,
        billingMode: "platform",
        enabled: true,
        spendPolicy: {
          sourceOfTruth: "tenant_policy",
          maxPerRunUsd: 1,
          dailyBudgetUsd: 2,
          monthlyBudgetUsd: 3,
        },
      }, "platform")).toEqual({
        sourceOfTruth: "provider_account",
        maxPerRunUsd: null,
        dailyBudgetUsd: null,
        monthlyBudgetUsd: null,
        provisioningMayDispatch: false,
      })
    }
  })

  it("creates an explicit weekly incremental monitoring baseline without dispatching a provider", () => {
    const configured = buildSocialMonitoringFoundationSettings({
      providers: [{ providerKey: "apify", billingMode: "platform", enabled: true }],
    }, true)
    const missingCredential = buildSocialMonitoringFoundationSettings({
      providers: [{ providerKey: "apify", billingMode: "platform", enabled: true }],
    }, false)
    const byok = buildSocialMonitoringFoundationSettings({
      providers: [{ providerKey: "apify", billingMode: "byok", enabled: true }],
    }, true)

    expect(configured).toEqual({
      schedule: {
        enabled: true,
        cadenceMinutes: DEFAULT_SCHEDULE_CADENCE_MINUTES,
        reportWindowDays: DEFAULT_REPORT_WINDOW_DAYS,
        timeZone: "Asia/Baku",
      },
      searchIndex: {
        enabled: true,
        provider: "apify",
        limit: null,
        includeComments: true,
      },
    })
    expect(missingCredential.searchIndex?.enabled).toBe(false)
    expect(byok.searchIndex?.enabled).toBe(false)
  })

  it("builds the complete synthetic SaaS tenant contract without activating external access", () => {
    const channels = selectedChannelBlueprint(undefined)
    const platformProviders = TENANT_PROVIDER_BLUEPRINT.map((provider) => ({
      providerKey: provider.providerKey,
      billingMode: "platform" as const,
      enabled: true,
      spendPolicy: buildProviderSpendPolicy(undefined, "platform"),
    }))

    expect(new Set(channels.map((item) => item.platform))).toEqual(new Set([
      "email",
      "webchat",
      "whatsapp",
      "facebook",
      "instagram",
      "tiktok",
      "telegram",
    ]))
    expect(channels).toHaveLength(TENANT_CHANNEL_BLUEPRINT.length)
    expect(channels.every((item) => Object.values(item.capabilities).every((value) => value === false))).toBe(true)
    expect(channels).toContainEqual(expect.objectContaining({
      platform: "tiktok",
      surface: "dm",
      provider: "chatwoot",
    }))
    expect(platformProviders.every((provider) => provider.spendPolicy.provisioningMayDispatch === false)).toBe(true)
    expect(platformProviders.every((provider) => provider.spendPolicy.maxPerRunUsd === null)).toBe(true)
    expect(platformProviders.every((provider) => provider.spendPolicy.dailyBudgetUsd === null)).toBe(true)
    expect(platformProviders.every((provider) => provider.spendPolicy.monthlyBudgetUsd === null)).toBe(true)
  })
})
