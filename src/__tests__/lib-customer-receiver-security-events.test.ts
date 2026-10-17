import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { buildSecurityExport, normalizeSecurityEvent } from "../lib/integrations/customer-receiver/security-events"

const event = () => ({
  schema_version: "1.0", event_id: "10000000-0000-4000-8000-000000000001",
  event_time: "2026-10-14T08:00:00Z", observed_at: "2026-10-14T08:00:01Z", ingested_at: null,
  environment: "TEST", organization_id: "org-1",
  source: { system: "LeadDrive", service: "receiver", instance_id: "worker-1", version: "1.0" },
  category: "integration", action: "submission_accepted", outcome: "success", severity: "info",
  actor: { type: "service", id: "sender-1" }, target: { type: "deal", id: "deal-1" },
  correlation_id: "corr-1", integration_event_id: "10000000-0000-4000-8000-000000000002",
})
const exportInput = () => ({
  organizationId: "org-1", environment: "TEST" as const,
  from: "2026-10-14T08:00:00Z", to: "2026-10-14T09:00:00Z", generatedAt: "2026-10-14T09:00:01Z",
  coverage: [{ service: "receiver", state: "collected" as const }, { service: "azure-vpn", state: "not_configured" as const }],
  events: [event()],
})

describe("security JSONL", () => {
  it("preserves event identity and unknown ingestion time, normalizes UTC milliseconds", () => {
    const result = normalizeSecurityEvent(event())
    expect(result.event_time).toBe("2026-10-14T08:00:00.000Z")
    expect(result.ingested_at).toBeNull()
    expect(result.event_id).toBe(event().event_id)
  })
  it.each(["password", "token", "authorization", "body", "message", "stack"])("refuses arbitrary sensitive field %s", (field) => {
    expect(() => normalizeSecurityEvent({ ...event(), [field]: "SECRET" })).toThrow()
  })
  it("refuses nested secrets and log injection", () => {
    expect(() => normalizeSecurityEvent({ ...event(), source: { ...event().source, token: "SECRET" } })).toThrow()
    expect(() => normalizeSecurityEvent({ ...event(), correlation_id: 'id\n{"forged":true}' })).toThrow()
  })
  it("does not attribute a failed unknown identity to a verified user", () => {
    expect(() => normalizeSecurityEvent({ ...event(), actor: { type: "unknown", id: "claimed-user" } })).toThrow()
    expect(normalizeSecurityEvent({ ...event(), actor: { type: "unknown", id: null } }).actor.id).toBeNull()
  })
  it("distinguishes audit event IDs from integration event IDs", () => {
    expect(() => normalizeSecurityEvent({ ...event(), integration_event_id: event().event_id })).toThrow()
  })
})

describe("tenant-specific incident package", () => {
  it("exports valid JSONL with a trailing LF and verifiable counts/hash", () => {
    const result = buildSecurityExport(exportInput())
    expect(result.jsonl.split("\n")).toHaveLength(2)
    expect(JSON.parse(result.jsonl).organization_id).toBe("org-1")
    expect(result.manifest.files[0]).toMatchObject({ records: 1, bytes: Buffer.byteLength(result.jsonl), sha256: createHash("sha256").update(result.jsonl).digest("hex") })
    expect(result.manifest.sources).toContainEqual({ service: "azure-vpn", state: "not_configured", exported_records: 0 })
    expect(result.manifest.completeness).toBe("not_attested")
    expect(JSON.parse(result.schema).title).toBe("LeadDrive Security Event 1.0")
    expect(result.manifest.files[1].sha256).toBe(createHash("sha256").update(result.schema).digest("hex"))
  })
  it.each([{ organization_id: "org-2" }, { organization_id: null }, { environment: "PROD" }])("rejects foreign or unassigned scope %j", (change) => {
    expect(() => buildSecurityExport({ ...exportInput(), events: [{ ...event(), ...change }] })).toThrow()
  })
  it("uses inclusive start and exclusive end timestamps", () => {
    expect(() => buildSecurityExport(exportInput())).not.toThrow()
    expect(() => buildSecurityExport({ ...exportInput(), events: [{ ...event(), event_time: exportInput().to }] })).toThrow()
  })
  it("rejects duplicated records rather than silently inflating evidence counts", () => {
    expect(() => buildSecurityExport({ ...exportInput(), events: [event(), event()] })).toThrow()
  })
  it("requires explicit source coverage and refuses contradictory source claims", () => {
    expect(() => buildSecurityExport({ ...exportInput(), coverage: [] })).toThrow()
    expect(() => buildSecurityExport({ ...exportInput(), coverage: [{ service: "receiver", state: "not_configured" }] })).toThrow()
    expect(() => buildSecurityExport({ ...exportInput(), events: [{ ...event(), source: { ...event().source, service: "unlisted" } }] })).toThrow()
  })
  it("produces stable output for different input order", () => {
    const later = { ...event(), event_id: "10000000-0000-4000-8000-000000000003", event_time: "2026-10-14T08:30:00Z" }
    expect(buildSecurityExport({ ...exportInput(), events: [event(), later] })).toEqual(buildSecurityExport({ ...exportInput(), events: [later, event()] }))
  })
  it("can describe an empty interval without claiming complete logging", () => {
    const result = buildSecurityExport({ ...exportInput(), events: [] })
    expect(result.jsonl).toBe("")
    expect(result.manifest.files[0].records).toBe(0)
    expect(result.manifest.completeness).toBe("not_attested")
  })
})
