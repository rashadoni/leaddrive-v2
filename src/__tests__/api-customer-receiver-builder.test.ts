import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { defaultBuilderProfile } from "../lib/integrations/customer-receiver/constructor/profile"

const mocks = vi.hoisted(() => ({
  session: { orgId: "org-1", userId: "user-1", role: "admin" },
  channelConfig: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  customField: { findMany: vi.fn() }, auditLog: { create: vi.fn() }, transaction: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: mocks.channelConfig, customField: mocks.customField, auditLog: mocks.auditLog, $transaction: mocks.transaction } }))
vi.mock("@/lib/with-rls", () => ({ withRlsSessionAuth: (handler: (request: NextRequest, session: typeof mocks.session) => Promise<Response>) => (request: NextRequest) => handler(request, mocks.session) }))
import { GET, POST } from "../app/api/v1/integrations/customer-receiver/route"

const row = (revision = 1) => ({ id: "draft-1", organizationId: "org-1", channelType: "customer-receiver-draft", isActive: false, settings: { builderVersion: "1.0", revision, profile: defaultBuilderProfile() }, updatedAt: new Date("2026-10-14T08:00:00Z"), botToken: "PRIVATE_TOKEN" })
const request = (body?: unknown) => new NextRequest("https://crm.example.invalid/api/v1/integrations/customer-receiver", { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "x-organization-id": "attacker-org" }, ...(body ? { body: JSON.stringify(body) } : {}) })
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.role = "admin"
  mocks.channelConfig.findMany.mockResolvedValue([]); mocks.customField.findMany.mockResolvedValue([])
  mocks.channelConfig.findFirst.mockResolvedValue(null); mocks.channelConfig.create.mockResolvedValue(row())
  mocks.channelConfig.updateMany.mockResolvedValue({ count: 1 }); mocks.auditLog.create.mockResolvedValue({})
  mocks.transaction.mockImplementation(async (work) => work({ channelConfig: mocks.channelConfig, auditLog: mocks.auditLog }))
})

describe("organization-scoped draft builder API", () => {
  it("lists only authenticated organization's disabled drafts and never returns channel secrets", async () => {
    mocks.channelConfig.findMany.mockResolvedValue([row()])
    const response = await GET(request()), result = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.channelConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-1", channelType: "customer-receiver-draft", isActive: false } }))
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN")
    expect(result.data.externalSendingAvailable).toBe(false)
  })
  it.each(["viewer", "manager", "sales", "employee"])("denies %s before reading configuration or writing audit", async (role) => {
    mocks.session.role = role
    expect((await GET(request())).status).toBe(403)
    expect((await POST(request({ expectedRevision: 0, profile: defaultBuilderProfile() }))).status).toBe(403)
    expect(mocks.channelConfig.findMany).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("persists a draft and audit together with forced isActive false", async () => {
    const response = await POST(request({ expectedRevision: 0, profile: defaultBuilderProfile() }))
    expect(response.status).toBe(201)
    expect(mocks.channelConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", isActive: false, channelType: "customer-receiver-draft", createdBy: "user-1" }) }))
    expect(mocks.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", action: "receiver_draft_created" }) }))
  })
  it.each([{ organizationId: "attacker-org" }, { enabled: true }, { accessToken: "PRIVATE" }])("rejects ownership/activation/secret injection %j", async (change) => {
    expect((await POST(request({ expectedRevision: 0, profile: defaultBuilderProfile(), ...change }))).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("checks revision in the actual compare-and-update predicate", async () => {
    mocks.channelConfig.findFirst.mockResolvedValueOnce(row(1)).mockResolvedValueOnce(row(2))
    const response = await POST(request({ id: "draft-1", expectedRevision: 1, profile: defaultBuilderProfile() }))
    expect(response.status).toBe(200)
    expect(mocks.channelConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", isActive: false, settings: { path: ["revision"], equals: 1 } }) }))
  })
  it("does not update an ID outside the authenticated organization", async () => {
    expect((await POST(request({ id: "foreign-id", expectedRevision: 1, profile: defaultBuilderProfile() }))).status).toBe(404)
    expect(mocks.channelConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "foreign-id", organizationId: "org-1" }) }))
    expect(mocks.channelConfig.updateMany).not.toHaveBeenCalled()
  })
  it("previews only synthetic data and audits it without a queue write", async () => {
    const response = await POST(request({ action: "preview", profile: defaultBuilderProfile(), resource: "deals", sample: "typical" }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(JSON.parse(result.data.body).deal.amount).toBe("1500.00")
    expect(result.data.externalSendingAvailable).toBe(false)
    expect(mocks.channelConfig.create).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain("DEMO DEAL")
  })
  it("rejects injected live record lookup and precision loss", async () => {
    expect((await POST(request({ action: "preview", profile: defaultBuilderProfile(), resource: "deals", sample: "typical", recordId: "real-deal" }))).status).toBe(400)
    expect((await POST(request({ action: "preview", profile: defaultBuilderProfile(), resource: "deals", sample: "precision" }))).status).toBe(422)
  })
  it("withholds preview results when audit storage fails", async () => {
    mocks.auditLog.create.mockRejectedValue(new Error("PRIVATE_CONNECTION"))
    const response = await POST(request({ action: "preview", profile: defaultBuilderProfile(), resource: "customers", sample: "typical" }))
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_CONNECTION")
  })
  it("withholds configuration reads if their audit cannot be written", async () => {
    mocks.auditLog.create.mockRejectedValue(new Error("audit_unavailable"))
    expect((await GET(request())).status).toBe(503)
  })
})
