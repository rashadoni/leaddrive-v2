import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { exportBuilderAudit } from "../lib/integrations/customer-receiver/constructor/audit-export"
import { dedicatedChannelTypeError } from "../lib/channels/dedicated-channel-types"

const mocks = vi.hoisted(() => ({ session: { orgId: "org-1", userId: "user-1", role: "admin" }, findMany: vi.fn(), create: vi.fn(), runtime: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { findMany: mocks.findMany, create: mocks.create } } }))
vi.mock("@/lib/integrations/customer-receiver/runtime/app-runtime", () => ({ readRuntimeEventsForExport: mocks.runtime }))
vi.mock("@/lib/with-rls", () => ({ withRlsSessionAuth: (handler: (request: NextRequest, session: typeof mocks.session) => Promise<Response>) => (request: NextRequest) => handler(request, mocks.session) }))
import { GET } from "../app/api/v1/integrations/customer-receiver/logs/route"

const row = () => ({ id: "audit-1", organizationId: "org-1", userId: "user-1", action: "receiver_draft_created", entityType: "receiver_draft", entityId: "draft-1", createdAt: new Date("2026-10-14T08:30:00Z"), newValue: { environment: "TEST", profileHash: "DEMO", unrelatedSecret: "PRIVATE" } })
const input = () => ({ organizationId: "org-1", environment: "TEST" as const, from: "2026-10-14T08:00:00Z", to: "2026-10-14T09:00:00Z", generatedAt: "2026-10-14T09:01:00Z", rows: [row()] })
const request = (changes: Record<string, string> = {}) => new NextRequest("https://crm.example.invalid/api/v1/integrations/customer-receiver/logs?" + new URLSearchParams({ from: input().from, to: input().to, environment: "TEST", ...changes }))
const runtimeEvent = () => ({ schema_version: "1.0", event_id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", event_time: "2026-10-14T08:40:00.000Z", observed_at: "2026-10-14T08:40:00.000Z", ingested_at: "2026-10-14T08:40:01.000Z", environment: "TEST", organization_id: "org-1", source: { system: "LeadDrive", service: "receiver-runtime", instance_id: "app-1", version: "1.0" }, category: "integration", action: "submission_accepted", outcome: "success", severity: "info", actor: { type: "service", id: "receiver-worker" }, target: { type: "customers", id: "cmp-1" }, correlation_id: "corr-1", integration_event_id: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" })
beforeEach(() => { vi.clearAllMocks(); mocks.session.role = "admin"; mocks.findMany.mockResolvedValue([row()]); mocks.create.mockResolvedValue({}); mocks.runtime.mockResolvedValue({ truncated: false, events: [runtimeEvent()] }) })

describe("constructor security log package", () => {
  it("keeps a stable event UUID and exports no arbitrary evidence or business values", () => {
    const first = exportBuilderAudit(input()), again = exportBuilderAudit({ ...input(), generatedAt: "2026-10-14T09:02:00Z" })
    expect(JSON.parse(first.jsonl).event_id).toBe(JSON.parse(again.jsonl).event_id)
    expect(first.jsonl).toBe(again.jsonl)
    expect(first.jsonl).not.toContain("PRIVATE")
    expect(first.manifest.scope).toBe("constructor_configuration_and_preview_only")
    expect(first.manifest.excluded_sources).toContain("erp")
  })
  it("does not assign another tenant or an unknown environment to the recipient", () => {
    expect(() => exportBuilderAudit({ ...input(), rows: [{ ...row(), organizationId: "org-2" }] })).toThrow("audit_scope_mismatch")
    expect(() => exportBuilderAudit({ ...input(), rows: [{ ...row(), newValue: {} }] })).toThrow("audit_environment_unknown_or_mismatched")
  })
  it("cannot be edited or activated using the generic channels API", () => {
    expect(dedicatedChannelTypeError("customer-receiver-draft")).toContain("dedicated")
    expect(dedicatedChannelTypeError("telegram", "customer-receiver-draft")).not.toBeNull()
  })
})

describe("protected audit export route", () => {
  it("queries only this organization, time interval, source and environment, then audits export", async () => {
    const response = await GET(request({ organizationId: "attacker-org" }))
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", entityType: "receiver_draft", newValue: { path: ["environment"], equals: "TEST" } }) }))
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", action: "receiver_draft_logs_exported" }) }))
    expect(mocks.runtime).toHaveBeenCalledWith({ organizationId: "org-1", environment: "TEST", from: input().from, to: input().to, limit: 4999 })
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain("PRIVATE")
    expect(body.data.jsonl.trim().split("\n").map((line: string) => JSON.parse(line).source.service)).toEqual(["receiver-builder", "receiver-runtime"])
    expect(body.data.manifest.completeness).toBe("not_attested")
    expect(body.data.manifest.excluded_sources).toEqual(expect.arrayContaining(["crm-authentication", "vpn", "customer-receiving-api", "erp"]))
    expect(body.data.manifest.sources).toEqual(expect.arrayContaining([{ service: "receiver-runtime", state: "collected", exported_records: 1 }, { service: "vpn", state: "not_configured", exported_records: 0 }]))
  })
  it("refuses a runtime log that would exceed the package bound", async () => {
    mocks.runtime.mockResolvedValue({ truncated: true, events: [] })
    expect((await GET(request())).status).toBe(413); expect(mocks.create).not.toHaveBeenCalled()
  })
  it("denies non-admin before a journal query", async () => {
    mocks.session.role = "manager"
    expect((await GET(request())).status).toBe(403); expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it.each<Record<string, string>>([{ from: "2026-09-01T00:00:00Z" }, { to: "2026-10-14T07:00:00Z" }, { environment: "UNKNOWN" }, { from: "2026-10-14T08:00:00+04:00" }])("rejects invalid interval/environment %j", async (change) => {
    expect((await GET(request(change))).status).toBe(400); expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it("never silently truncates an oversized package", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 5001 }, row))
    expect((await GET(request())).status).toBe(413); expect(mocks.create).not.toHaveBeenCalled()
  })
  it("does not release evidence if its export audit fails", async () => {
    mocks.create.mockRejectedValue(new Error("PRIVATE"))
    const response = await GET(request()); expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE")
  })
})
