import { describe, expect, it, vi } from "vitest"
import { loadBuilderSnapshot, type BuilderSourceReader } from "../lib/integrations/customer-receiver/constructor/source"
import { parseMappedAcceptance } from "../lib/integrations/customer-receiver/constructor/receipts"
import { defaultBuilderProfile } from "../lib/integrations/customer-receiver/constructor/profile"

describe("tenant-scoped CRM source preparation", () => {
  const reader = (): BuilderSourceReader => ({
    find: vi.fn(async (entity, input) => entity === "company" ? { organizationId: input.organizationId, id: input.id, name: "DEMO", portalPasswordHash: "PRIVATE" } : { organizationId: input.organizationId, id: input.id, companyId: "company-1", name: "DEMO DEAL", valueAmount: { toFixed: vi.fn().mockReturnValue("1234.5678") } }),
    customValues: vi.fn().mockResolvedValue([]),
  })
  it("selects and copies only catalogue fields, preserves four-place Decimal strings", async () => {
    const source = reader()
    const result = await loadBuilderSnapshot({ reader: source, organizationId: "org-1", resource: "deals", externalId: "deal-1" })
    expect(result.entities.deal!.fields.valueAmount).toBe("1234.5678")
    expect(result.entities.company!.fields).not.toHaveProperty("portalPasswordHash")
    expect(source.find).toHaveBeenNthCalledWith(1, "deal", expect.objectContaining({ id: "deal-1", organizationId: "org-1" }))
    expect(source.find).toHaveBeenNthCalledWith(2, "company", expect.objectContaining({ id: "company-1", organizationId: "org-1" }))
    expect(vi.mocked(source.find).mock.calls[0][1].fields).not.toContain("metadata")
  })
  it("rejects a foreign row even if a reader adapter supplied one", async () => {
    const source = reader(); vi.mocked(source.find).mockResolvedValue({ id: "company-1", organizationId: "org-2" })
    await expect(loadBuilderSnapshot({ reader: source, organizationId: "org-1", resource: "customers", externalId: "company-1" })).rejects.toThrow("source_scope_mismatch")
  })
  it("refuses a missing relationship and never invents a customer ID", async () => {
    const source = reader(); vi.mocked(source.find).mockResolvedValue({ id: "deal-1", organizationId: "org-1", companyId: null, valueAmount: "1.0000" })
    await expect(loadBuilderSnapshot({ reader: source, organizationId: "org-1", resource: "deals", externalId: "deal-1" })).rejects.toThrow("customer_reference_missing")
  })
  it("refuses an unsafe extra catalogue field before querying", async () => {
    const source = reader()
    await expect(loadBuilderSnapshot({ reader: source, organizationId: "org-1", resource: "customers", externalId: "company-1", catalogue: [{ key: "company.portalPasswordHash", entity: "company", kind: "text", label: { en: "secret", ru: "secret", az: "secret" } }] })).rejects.toThrow("unregistered_source_field")
    expect(source.find).not.toHaveBeenCalled()
  })
})

describe("mapped customer receipt", () => {
  const expected = { eventId: "10000000-0000-4000-8000-000000000001", externalId: "record-1", entityVersion: 2 }
  const body = () => ({ status: "accepted", eventId: expected.eventId, externalId: expected.externalId, acceptedVersion: 2, receiptId: "receipt-1", operationId: "operation-1", acceptedAt: "2026-10-14T08:00:00Z" })
  it("supports aliases inside a response wrapper", () => {
    const receipt = defaultBuilderProfile().receipt
    for (const key of Object.keys(receipt) as (keyof typeof receipt)[]) if (key.endsWith("Path")) receipt[key] = "result." + receipt[key]
    expect(parseMappedAcceptance({ receipt, expected, body: { result: body() } })).toMatchObject({ status: "accepted", acceptedVersion: 2 })
  })
  it("rejects success codes without exact event/version identity", () => {
    const receipt = defaultBuilderProfile().receipt
    expect(() => parseMappedAcceptance({ receipt, expected, body: { ...body(), acceptedVersion: 1 } })).toThrow("receipt_identity_mismatch")
    expect(() => parseMappedAcceptance({ receipt, expected, body: { status: "accepted" } })).toThrow("missing_receipt_field")
    expect(() => parseMappedAcceptance({ receipt, expected, body: { ...body(), error: "PRIVATE_ERROR" } })).toThrow("receiver_reported_error")
  })
})
