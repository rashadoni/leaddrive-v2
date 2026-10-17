import { describe, expect, it, vi } from "vitest"
import { BUILDER_FIELDS, type BuilderField } from "../lib/integrations/customer-receiver/constructor/catalog"
import { builderProfileSchema, defaultBuilderProfile, validateProfileCatalogue } from "../lib/integrations/customer-receiver/constructor/profile"
import { previewBuilderResource, syntheticBuilderInput, transformBuilderValue } from "../lib/integrations/customer-receiver/constructor/engine"
import { BUILDER_CHANNEL_TYPE, publicBuilderDraft, saveBuilderDraft, type BuilderRow, type BuilderStore, type BuilderTransaction } from "../lib/integrations/customer-receiver/constructor/store"

const profile = () => defaultBuilderProfile()
const preview = (resource: "customers" | "contacts" | "deals" = "customers") => ({ profile: profile(), resource, ...syntheticBuilderInput("org-1", resource) })

describe("configurable receiving profile", () => {
  it("validates the baseline and includes no endpoint or raw credentials", () => {
    expect(builderProfileSchema.safeParse(profile()).success).toBe(true)
    for (const key of ["organizationId", "enabled", "accessToken", "endpoint", "script"]) expect(builderProfileSchema.safeParse({ ...profile(), [key]: "PRIVATE" }).success).toBe(false)
    expect(builderProfileSchema.safeParse({ ...profile(), lifecycle: "active" }).success).toBe(false)
  })
  it.each(["__proto__.polluted", "payload.constructor.token", "a.prototype.b", "a..b"])("rejects unsafe destination path %s", (target) => {
    const input = profile(); input.resources[0].mappings[0].target = target
    expect(builderProfileSchema.safeParse(input).success).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it("rejects collisions between object and nested target paths", () => {
    const input = profile(); input.resources[0].mappings[0].target = "customer"
    expect(builderProfileSchema.safeParse(input).success).toBe(false)
  })
  it("requires untransformed event identity for enabled resources", () => {
    const input = profile(); input.resources[0].mappings = input.resources[0].mappings.filter((entry) => entry.target !== "eventId")
    expect(builderProfileSchema.safeParse(input).success).toBe(false)
  })
  it("rejects conflicting duplicate lookup codes", () => {
    const input = profile(); input.resources[0].mappings.find((entry) => entry.id === "country")!.transforms = [{ type: "lookup", entries: [{ from: "A", to: "B" }, { from: "A", to: "C" }], fallback: "reject" }]
    expect(builderProfileSchema.safeParse(input).success).toBe(false)
  })
  it("rejects non-catalogue fields and a field from an unrelated entity", () => {
    for (const field of ["company.password", "contact.portalPasswordHash", "deal.name"]) {
      const input = profile(); input.resources[0].mappings[0].source = { type: "field", field }
      expect(builderProfileSchema.safeParse(input).success).toBe(false)
    }
  })
  it("rejects empty filters, duplicate resources, hostile paths and limits beyond the safety budget", () => {
    const empty = profile(); empty.resources[0].selection.mode = "filtered"
    expect(builderProfileSchema.safeParse(empty).success).toBe(false)
    const duplicate = profile(); duplicate.resources.push(duplicate.resources[0])
    expect(builderProfileSchema.safeParse(duplicate).success).toBe(false)
    for (const path of ["https://attacker.invalid", "//attacker.invalid", "/a/../b", "/path?token=private", "/a#fragment", "/a/{untrusted}"]) {
      const input = profile(); input.resources[0].path = path
      expect(builderProfileSchema.safeParse(input).success).toBe(false)
    }
    expect(builderProfileSchema.safeParse({ ...profile(), limits: { ...profile().limits, concurrency: 20 } }).success).toBe(false)
  })
  it("accepts a custom field only when registered in the tenant catalogue", () => {
    const input = profile(); input.resources[0].mappings.push({ id: "custom", target: "customer.code", source: { type: "field", field: "custom.company.field1" }, missing: "omit", transforms: [] })
    expect(() => validateProfileCatalogue(input, BUILDER_FIELDS)).toThrow("unregistered_source_field")
    const field: BuilderField = { key: "custom.company.field1", entity: "company", kind: "text", label: { ru: "Код", en: "Code", az: "Kod" } }
    expect(() => validateProfileCatalogue(input, [...BUILDER_FIELDS, field])).not.toThrow()
  })
})

describe("data preparation without external sending", () => {
  it("builds the baseline packet and does not mutate source snapshots", () => {
    const input = preview(); const before = structuredClone(input)
    const result = previewBuilderResource(input)
    expect(JSON.parse(result.body)).toMatchObject({ customer: { name: "DEMO CUSTOMER", countryCode: "AZ" }, entityVersion: 1 })
    expect(result.externalSendingAvailable).toBe(false)
    expect(input).toEqual(before)
    expect(result.bytes).toBe(Buffer.byteLength(result.body))
  })
  it("supports nested destination aliases and stable event keys across mapping edits", () => {
    const input = preview(); const original = previewBuilderResource(input)
    input.profile.resources[0].mappings.find((entry) => entry.id === "name")!.target = "payload.client.displayName"
    const result = previewBuilderResource(input)
    expect(JSON.parse(result.body).payload.client.displayName).toBe("DEMO CUSTOMER")
    expect(result.idempotencyKey).toBe(original.idempotencyKey)
    expect(result.payloadHash).not.toBe(original.payloadHash)
  })
  it("distinguishes omitted fields, explicit null and required fields", () => {
    const input = { profile: profile(), resource: "customers" as const, ...syntheticBuilderInput("org-1", "customers", "missing_optional") }
    const email = input.profile.resources[0].mappings.find((entry) => entry.id === "email")!
    expect(previewBuilderResource(input).omitted).toContain("customer.email")
    email.missing = "null"
    expect(JSON.parse(previewBuilderResource(input).body).customer.email).toBeNull()
    email.missing = "reject"
    expect(() => previewBuilderResource(input)).toThrow("required_value_missing")
  })
  it("revalidates values made empty by transformations", () => {
    const input = preview(); input.snapshot.entities.company!.fields.name = "  "
    expect(() => previewBuilderResource(input)).toThrow("required_value_missing")
  })
  it("prevents mixing another tenant's related customer data", () => {
    const input = preview("deals"); input.snapshot.entities.company!.organizationId = "org-2"
    expect(() => previewBuilderResource(input)).toThrow("foreign_organization")
  })
  it("requires the exact customer relationship and primary record identity", () => {
    const input = preview("deals"); input.snapshot.entities.deal!.fields.companyId = "other-customer"
    expect(() => previewBuilderResource(input)).toThrow("customer_reference_mismatch")
    const second = preview(); second.context.externalId = "other-record"
    expect(() => previewBuilderResource(second)).toThrow("identity_mismatch")
  })
  it("prepares contacts only with an explicit selected resource", () => {
    const input = preview("contacts")
    expect(previewBuilderResource(input).selected).toBe(false)
    input.profile.resources[1].enabled = true
    expect(JSON.parse(previewBuilderResource(input).body).contact.name).toBe("DEMO CONTACT")
    expect(previewBuilderResource(input).selected).toBe(true)
  })
  it("matches all/any conditions and does not coerce tax codes into numbers", () => {
    const input = preview("deals"), selection = input.profile.resources[2].selection
    selection.mode = "filtered"; selection.conditions = [{ field: "deal.stage", operator: "eq", value: "QUALIFIED" }, { field: "deal.pipelineId", operator: "eq", value: "other-pipeline" }]
    expect(previewBuilderResource(input).selected).toBe(false)
    selection.match = "any"
    expect(previewBuilderResource(input).selected).toBe(true)
    const customer = preview(); customer.snapshot.entities.company!.fields.voen = "12345"
    customer.profile.resources[0].selection = { mode: "filtered", match: "all", conditions: [{ field: "company.voen", operator: "eq", value: 12345 }] }
    expect(previewBuilderResource(customer).selected).toBe(false)
  })
  it("compares large amounts without Number precision loss", () => {
    const input = preview("deals")
    input.snapshot.entities.deal!.fields.valueAmount = "99999999999999.9900"
    input.profile.resources[2].selection = { mode: "filtered", match: "all", conditions: [{ field: "deal.valueAmount", operator: "gte", value: "99999999999999.98" }] }
    expect(previewBuilderResource(input).selected).toBe(true)
    expect(JSON.parse(previewBuilderResource(input).body).deal.amount).toBe("99999999999999.99")
  })
  it("refuses implicit rounding but allows a selected four-place profile", () => {
    const input = { profile: profile(), resource: "deals" as const, ...syntheticBuilderInput("org-1", "deals", "precision") }
    expect(() => previewBuilderResource(input)).toThrow("precision_loss")
    input.profile.resources[2].mappings.find((entry) => entry.id === "amount")!.transforms = [{ type: "decimal", scale: 4, rounding: "reject" }]
    expect(JSON.parse(previewBuilderResource(input).body).deal.amount).toBe("1500.1234")
  })
  it("enforces the configured body limit", () => {
    const input = preview(); input.profile.limits.maxBodyKiB = 1
    input.profile.resources[0].mappings.push({ id: "large", target: "extra", source: { type: "constant", value: "x".repeat(1500) }, missing: "reject", transforms: [] })
    expect(() => previewBuilderResource(input)).toThrow("payload_limit_exceeded")
  })
})

describe("declarative transformations", () => {
  it.each([["1.235", "1.24"], ["-1.235", "-1.24"], ["9.995", "10.00"], ["-0.004", "0.00"]])("rounds %s only by an explicit half-up policy", (value, result) => {
    expect(transformBuilderValue(value, { type: "decimal", scale: 2, rounding: "half_up" })).toBe(result)
  })
  it("maps codes with explicit fallback policy", () => {
    expect(transformBuilderValue("Qualified", { type: "lookup", entries: [{ from: "Qualified", to: "QUALIFIED" }], fallback: "reject" })).toBe("QUALIFIED")
    expect(() => transformBuilderValue("Unknown", { type: "lookup", entries: [], fallback: "reject" })).toThrow("unmapped_value")
  })
  it("rejects impossible dates and ambiguous floating-point money", () => {
    expect(() => transformBuilderValue("2026-02-30", { type: "date", format: "utc_date" })).toThrow("invalid_date")
    expect(() => transformBuilderValue(0.1, { type: "decimal", scale: 2, rounding: "reject" })).toThrow("decimal_requires_lossless_string")
  })
})

describe("draft persistence and audit boundary", () => {
  const row = (revision = 1): BuilderRow => ({ id: "draft-1", organizationId: "org-1", channelType: BUILDER_CHANNEL_TYPE, isActive: false, settings: { builderVersion: "1.0", revision, profile: profile() }, updatedAt: new Date("2026-10-14T08:00:00Z") })
  const fixture = () => {
    const tx: BuilderTransaction = { find: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(row()), compareAndUpdate: vi.fn().mockResolvedValue(1), audit: vi.fn().mockResolvedValue(undefined) }
    const store: BuilderStore = { transaction: vi.fn(async (work) => work(tx)) }
    return { tx, store }
  }
  const input = () => ({ organizationId: "org-1", userId: "user-1", expectedRevision: 0, profile: profile() })
  it("creates a disabled draft and metadata-only audit in the supplied transaction", async () => {
    const { tx, store } = fixture(); const result = await saveBuilderDraft(store, input())
    expect(result.externalSendingAvailable).toBe(false)
    expect(tx.audit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", evidence: expect.objectContaining({ revision: 1, profileHash: expect.stringMatching(/^[0-9a-f]{64}$/) }) }))
    expect(JSON.stringify(vi.mocked(tx.audit).mock.calls)).not.toContain("customer.name")
  })
  it("rejects a stale revision before updating", async () => {
    const { tx, store } = fixture(); vi.mocked(tx.find).mockResolvedValue(row(2))
    await expect(saveBuilderDraft(store, { ...input(), id: "draft-1", expectedRevision: 1 })).rejects.toThrow("revision_conflict")
    expect(tx.compareAndUpdate).not.toHaveBeenCalled(); expect(tx.audit).not.toHaveBeenCalled()
  })
  it("rejects a concurrent compare-and-update failure without committing audit", async () => {
    const { tx, store } = fixture(); vi.mocked(tx.find).mockResolvedValue(row()); vi.mocked(tx.compareAndUpdate).mockResolvedValue(0)
    await expect(saveBuilderDraft(store, { ...input(), id: "draft-1", expectedRevision: 1 })).rejects.toThrow("revision_conflict")
    expect(tx.audit).not.toHaveBeenCalled()
  })
  it("propagates audit failure so the owning database transaction must roll back", async () => {
    const { tx, store } = fixture(); vi.mocked(tx.audit).mockRejectedValue(new Error("audit_unavailable"))
    await expect(saveBuilderDraft(store, input())).rejects.toThrow("audit_unavailable")
  })
  it("preserves earlier profile content and restores it as a new revision", async () => {
    const { tx, store } = fixture(), current = row(2), old = profile()
    const settings = current.settings as { profile: ReturnType<typeof profile>; history?: unknown[] }
    settings.profile.label = "New settings"
    settings.history = [{ revision: 1, profile: old, recordedAt: "2026-10-14T07:00:00Z" }]
    const updated = row(3)
    vi.mocked(tx.find).mockResolvedValueOnce(current).mockResolvedValueOnce(updated)
    await saveBuilderDraft(store, { ...input(), id: "draft-1", expectedRevision: 2, profile: old })
    const saved = vi.mocked(tx.compareAndUpdate).mock.calls[0][1]
    expect(saved.revision).toBe(3)
    expect(saved.history[0].profile.label).toBe("New settings")
    expect(saved.history[1].revision).toBe(1)
  })
  it("does not expose another tenant, a different channel or an active record", () => {
    for (const change of [{ organizationId: "org-2" }, { channelType: "whatsapp" }, { isActive: true }]) expect(() => publicBuilderDraft({ ...row(), ...change }, "org-1")).toThrow("not_found")
  })
})
