import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/workforce/mobile-write-fence", () => ({ evaluateWorkforceMobileWriteAccess: vi.fn(async () => ({ allowed: true })) }))
import { POST } from "@/app/api/v1/mtm/mobile/sync/push/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { classifyMtmMobileSyncOperation, MTM_MOBILE_SYNC_MAX_BODY_BYTES as BODY, MTM_MOBILE_SYNC_MAX_OPERATION_BYTES as OP } from "@/lib/mtm/mobile-sync-push-bounds"

const healthy = { operationId: "healthy", op: "create", entity: "visits", data: { id: "existing-visit" } }
function raw(text: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push", { method: "POST", headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json", ...headers }, body: text })
}
const batch = (operations: unknown[]) => raw(JSON.stringify({ operations }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: "org-bounds", agentId: "agent-bounds", userId: "user-bounds", role: "AGENT", tenantCapabilities: { routeField: true, workforceHrm: true } } as never)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: "org-bounds", plan: "enterprise", addons: [], features: ["mtm"], modules: { mtm: true } } as never)
  vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([{ operationId: "healthy", entity: "visits", status: "ok", result: { serverId: "existing-visit" } }] as never)
  vi.mocked(prisma.mtmSetting.findMany).mockRejectedValue(new Error("PRIVATE-SETTINGS-MUST-NOT-BE-READ"))
  vi.spyOn(console, "info").mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe("F7 raw body and canonical UTF-8 operation bounds", () => {
  it("accepts the exact raw body limit and refuses the next byte before idempotency reads or writes", async () => {
    const prefix = '{"operations":[]}'
    const exact = prefix + " ".repeat(BODY - Buffer.byteLength(prefix))
    expect((await POST(raw(exact))).status).toBe(200)
    const response = await POST(raw(exact + " "))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "Sync request is too large", code: "MTM_MOBILE_SYNC_BODY_TOO_LARGE" })
    expect(prisma.mtmSyncOperation.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })
  it("counts streamed bytes even when Content-Length understates them", async () => {
    let cancelled = false
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(128 * 1024).fill(32)) }, cancel() { cancelled = true } })
    const request = new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push", { method: "POST", headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json", "Content-Length": "2" }, body, duplex: "half" } as never)
    expect((await POST(request)).status).toBe(413)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThanOrEqual(6)
    expect(prisma.mtmSyncOperation.findMany).not.toHaveBeenCalled()
  })
  it("accepts exact64KiB UTF-8, rejects over64KiB and preserves the healthy sibling order", async () => {
    const value = { ...healthy, padding: "" }
    const missing = OP - Buffer.byteLength(JSON.stringify(value), "utf8")
    value.padding = "я".repeat(Math.floor(missing / 2)) + "x".repeat(missing % 2)
    expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBe(OP)
    expect(classifyMtmMobileSyncOperation(value)).toEqual({ allowed: true })
    const exact = await POST(batch([value]))
    expect((await exact.json()).results).toEqual([{ operationId: "healthy", status: "ok", serverId: "existing-visit" }])
    const response = await POST(batch([{ ...value, padding: value.padding + "я" }, healthy]))
    expect(response.status).toBe(200)
    const result = (await response.json()).results
    expect(result[0]).toEqual({ operationId: "healthy", status: "error", error: "Sync operation is too large", serverData: { code: "MTM_MOBILE_SYNC_OPERATION_TOO_LARGE" } })
    expect(result[1]).toMatchObject({ operationId: "healthy", status: "ok", serverId: "existing-visit" })
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })
  it("a poison Workforce envelope cannot force a settings failure or block a healthy Route replay", async () => {
    const poison = { operationId: "poison", op: "create", entity: "workdays", data: { note: "PRIVATE-POISON".repeat(6000) } }
    const response = await POST(batch([poison, healthy]))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results[0]).toMatchObject({ operationId: "poison", status: "error", serverData: { code: "MTM_MOBILE_SYNC_OPERATION_TOO_LARGE" } })
    expect(body.results[1]).toMatchObject({ operationId: "healthy", status: "ok" })
    expect(JSON.stringify(body)).not.toContain("PRIVATE-POISON")
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmSyncOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ operationId: { in: ["healthy"] } }) }))
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })
  it("deeply nested valid JSON is a terminal per-operation sizing failure, not a batch crash", async () => {
    const nested = '{"operations":[{"operationId":"deep","op":"create","entity":"workdays","data":' + '['.repeat(20_000) + '0' + ']'.repeat(20_000) + '},' + JSON.stringify(healthy) + ']}'
    // Use an object envelope so the stringify depth guard, not the array-data guard, is exercised.
    const objectNested = nested.replace('"data":', '"data":{"nested":').replace('},' + JSON.stringify(healthy), '}},' + JSON.stringify(healthy))
    expect(Buffer.byteLength(objectNested)).toBeLessThan(BODY)
    const response = await POST(raw(objectNested))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results[0]).toMatchObject({ operationId: "deep", status: "error", serverData: { code: "MTM_MOBILE_SYNC_OPERATION_INVALID" } })
    expect(body.results[1]).toMatchObject({ operationId: "healthy", status: "ok" })
    expect(prisma.mtmSetting.findMany).not.toHaveBeenCalled()
  })
  it("invalid envelopes carry bounded metadata and never pin a failure", async () => {
    const response = await POST(batch([null, { operationId: "x".repeat(10000), entity: "workdays" }, healthy]))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results.slice(0, 2)).toEqual([0, 1].map(() => ({ operationId: "?", status: "error", error: "Missing or invalid required fields", serverData: { code: "MTM_MOBILE_SYNC_OPERATION_INVALID" } })))
    expect(JSON.stringify(body).length).toBeLessThan(1000)
    expect(body.results[2]).toMatchObject({ status: "ok" })
    expect(prisma.mtmSyncOperation.create).not.toHaveBeenCalled()
  })
})
