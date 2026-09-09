/**
 * Tests for L1/L2 App marketplace slice 1 — manifest parser + install planner + catalog seed.
 * No DB. Pure helpers.
 */
import { describe, expect, it } from "vitest"
import {
  FIRST_PARTY_CATALOG,
  FIRST_PARTY_CATALOG_BY_SLUG,
} from "@/lib/apps/first-party-catalog"
import { buildInstallPlan } from "@/lib/apps/install-planner"
import { parseManifest } from "@/lib/apps/manifest-parser"
import type { AppManifest } from "@/lib/apps/types"

/* ─── parseManifest ───────────────────────────────────────────────────── */

describe("L1 — parseManifest", () => {
  it("accepts a minimal valid manifest (single customField)", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "extra",
            fieldLabel: "Extra",
            fieldType: "string",
            required: false,
          },
        ],
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.manifest.capabilities.customFields).toHaveLength(1)
  })

  it("rejects non-object manifest", () => {
    expect(parseManifest(null).ok).toBe(false)
    expect(parseManifest([]).ok).toBe(false)
    expect(parseManifest("string").ok).toBe(false)
  })

  it("rejects unsupported schemaVersion", () => {
    const r = parseManifest({
      schemaVersion: 99,
      capabilities: { settingsKeys: [{ key: "k", label: "K", type: "string", required: false }] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/schemaVersion must be 1/)
  })

  it("rejects empty capabilities (manifest must declare at least one)", () => {
    const r = parseManifest({ schemaVersion: 1, capabilities: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/at least one capability/)
  })

  it("rejects customField with unknown fieldType", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "x",
            fieldLabel: "X",
            fieldType: "blob",
            required: false,
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /fieldType/.test(e))).toBe(true)
  })

  it("requires select fields to declare a non-empty options array", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "x",
            fieldLabel: "X",
            fieldType: "select",
            required: false,
            options: [],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /options/.test(e))).toBe(true)
  })

  it("rejects options on a non-select field", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "x",
            fieldLabel: "X",
            fieldType: "string",
            required: false,
            options: ["a"],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /only valid for select/.test(e))).toBe(true)
  })

  it("rejects webhookSubscription with http:// (non-https targetUrl)", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        webhookSubscriptions: [
          {
            ref: "w1",
            eventNames: ["foo"],
            targetUrl: "http://insecure.example.com",
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /https:\/\//.test(e))).toBe(true)
  })

  it("rejects webhookSubscription with empty eventNames", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        webhookSubscriptions: [
          {
            ref: "w1",
            eventNames: [],
            targetUrl: "https://api.example.com/hook",
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /eventNames/.test(e))).toBe(true)
  })

  it("rejects duplicate subscription refs across webhook + event", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        webhookSubscriptions: [
          { ref: "x", eventNames: ["a"], targetUrl: "https://a.example.com" },
        ],
        eventSubscriptions: [{ ref: "x", eventName: "a" }],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /duplicate subscription ref/.test(e))).toBe(true)
  })

  it("rejects settingKey with unknown type", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        settingsKeys: [{ key: "k", label: "K", type: "binary", required: false }],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects fieldName / settingsKey with invalid identifier", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "1invalid",
            fieldLabel: "X",
            fieldType: "string",
            required: false,
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("rejects required:true + defaultValue combo (contradictory)", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        settingsKeys: [
          {
            key: "k",
            label: "K",
            type: "string",
            required: true,
            defaultValue: "x",
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.errors.some(e => /required:true is incompatible with defaultValue/.test(e))).toBe(true)
  })

  it("rejects empty-string select option", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "tier",
            fieldLabel: "Tier",
            fieldType: "select",
            required: false,
            options: ["red", "", "green"],
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /non-empty strings/.test(e))).toBe(true)
  })

  it("rejects mixed-case fieldName (DB unique index is case-sensitive)", () => {
    // Previously /i flag accepted "Stripe_Customer_Id" + "stripe_customer_id"
    // as both valid, but DB unique index treats them as distinct rows —
    // would silently fork. Now lowercase-only.
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "company",
            fieldName: "Stripe_Customer_Id",
            fieldLabel: "Stripe Customer Id",
            fieldType: "string",
            required: false,
          },
        ],
      },
    })
    expect(r.ok).toBe(false)
  })

  it("collects multiple errors (not just first)", () => {
    const r = parseManifest({
      schemaVersion: 99,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "x",
            fieldLabel: "X",
            fieldType: "blob",
            required: false,
          },
        ],
        webhookSubscriptions: [
          { ref: "w1", eventNames: [], targetUrl: "http://bad.example.com" },
        ],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })

  it("requirements.modules + namedCredentialNames parse correctly", () => {
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        settingsKeys: [{ key: "k", label: "K", type: "string", required: false }],
      },
      requirements: {
        namedCredentialNames: ["stripe_api"],
        // Use a real ModuleId (group vocab) — parser validates against the registry.
        modules: ["finance"],
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.manifest.requirements?.namedCredentialNames).toEqual(["stripe_api"])
      expect(r.manifest.requirements?.modules).toEqual(["finance"])
    }
  })

  it("rejects requirements.modules with unknown module id (fail-fast UX)", () => {
    // Previously a typo'd module name slipped through the parser and
    // only surfaced as "missing" at install time. Now caught at the
    // manifest boundary with the offending names enumerated.
    const r = parseManifest({
      schemaVersion: 1,
      capabilities: {
        settingsKeys: [{ key: "k", label: "K", type: "string", required: false }],
      },
      requirements: { modules: ["nonexistent_module"] },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /unknown module id/.test(e))).toBe(true)
  })
})

/* ─── buildInstallPlan ────────────────────────────────────────────────── */

const minimalManifest: AppManifest = {
  schemaVersion: 1,
  capabilities: {
    customFields: [
      {
        entityType: "deal",
        fieldName: "extra",
        fieldLabel: "Extra",
        fieldType: "string",
        required: false,
      },
    ],
    settingsKeys: [
      { key: "name", label: "Name", type: "string", required: true },
      { key: "max_items", label: "Max items", type: "number", required: false, defaultValue: 10 },
    ],
  },
}

describe("L1 — buildInstallPlan", () => {
  it("produces an InstallPlan with one action per capability + setting", () => {
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: minimalManifest,
      userConfig: { name: "MyApp" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 1 create_custom_field + 1 set_setting (name) + 1 set_setting (max_items default).
      expect(r.plan.actions).toHaveLength(3)
      const kinds = r.plan.actions.map(a => a.kind).sort()
      expect(kinds).toEqual([
        "create_custom_field",
        "set_setting",
        "set_setting",
      ])
      expect(r.plan.config).toEqual({ name: "MyApp", max_items: 10 })
    }
  })

  it("rejects missing required setting", () => {
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: minimalManifest,
      userConfig: {},
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /missing required setting "name"/.test(e))).toBe(true)
  })

  it("rejects unknown user-supplied setting", () => {
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: minimalManifest,
      userConfig: { name: "x", evil: true },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some(e => /unknown setting "evil"/.test(e))).toBe(true)
  })

  it("coerces numeric strings into numbers for `number` settings", () => {
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: minimalManifest,
      userConfig: { name: "x", max_items: "42" },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.config.max_items).toBe(42)
  })

  it("applies defaultValue when user omits the setting", () => {
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: minimalManifest,
      userConfig: { name: "x" }, // max_items omitted
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.config.max_items).toBe(10)
  })

  it("emits register_webhook_subscription + register_event_subscription actions", () => {
    const m: AppManifest = {
      schemaVersion: 1,
      capabilities: {
        webhookSubscriptions: [
          { ref: "w1", eventNames: ["deal_won"], targetUrl: "https://a.example.com" },
        ],
        eventSubscriptions: [{ ref: "e1", eventName: "deal_won" }],
      },
    }
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: m,
      userConfig: {},
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const kinds = r.plan.actions.map(a => a.kind)
      expect(kinds).toContain("register_webhook_subscription")
      expect(kinds).toContain("register_event_subscription")
    }
  })

  it("rejects non-numeric value on number setting", () => {
    const m: AppManifest = {
      schemaVersion: 1,
      capabilities: {
        settingsKeys: [{ key: "n", label: "N", type: "number", required: true }],
      },
    }
    const r = buildInstallPlan({
      appId: "app_1",
      appSlug: "test-app",
      installedVersion: "1.0.0",
      manifest: m,
      userConfig: { n: "not a number" },
    })
    expect(r.ok).toBe(false)
  })
})

/* ─── First-party catalog seed ────────────────────────────────────────── */

describe("L1 — first-party catalog seed", () => {
  it("includes at least the 3 documented apps", () => {
    expect(FIRST_PARTY_CATALOG.length).toBeGreaterThanOrEqual(3)
  })

  it("every seed app's manifest passes parseManifest", () => {
    for (const app of FIRST_PARTY_CATALOG) {
      const r = parseManifest(app.manifest)
      expect(r.ok, `${app.slug}: ${r.ok ? "" : r.errors.join(", ")}`).toBe(true)
    }
  })

  it("every seed app's manifest builds an install plan with empty user config when no required settings", () => {
    for (const app of FIRST_PARTY_CATALOG) {
      const required = (app.manifest.capabilities.settingsKeys ?? []).filter(
        s => s.required && s.defaultValue === undefined
      )
      if (required.length > 0) continue // skip ones requiring user input
      const r = buildInstallPlan({
        appId: "stub",
        appSlug: app.slug,
        installedVersion: app.version,
        manifest: app.manifest,
        userConfig: {},
      })
      expect(r.ok, `${app.slug}: ${r.ok ? "" : r.errors.join(", ")}`).toBe(true)
    }
  })

  it("BY_SLUG lookup table mirrors the catalog", () => {
    expect(FIRST_PARTY_CATALOG_BY_SLUG.size).toBe(FIRST_PARTY_CATALOG.length)
    for (const app of FIRST_PARTY_CATALOG) {
      expect(FIRST_PARTY_CATALOG_BY_SLUG.get(app.slug)?.name).toBe(app.name)
    }
  })

  it("at least one seed app exercises every capability kind", () => {
    const kinds = new Set<string>()
    for (const app of FIRST_PARTY_CATALOG) {
      const c = app.manifest.capabilities
      if ((c.customFields?.length ?? 0) > 0) kinds.add("customFields")
      if ((c.webhookSubscriptions?.length ?? 0) > 0) kinds.add("webhookSubscriptions")
      if ((c.eventSubscriptions?.length ?? 0) > 0) kinds.add("eventSubscriptions")
      if ((c.settingsKeys?.length ?? 0) > 0) kinds.add("settingsKeys")
    }
    expect(kinds.has("customFields")).toBe(true)
    expect(kinds.has("webhookSubscriptions")).toBe(true)
    expect(kinds.has("eventSubscriptions")).toBe(true)
    expect(kinds.has("settingsKeys")).toBe(true)
  })
})
