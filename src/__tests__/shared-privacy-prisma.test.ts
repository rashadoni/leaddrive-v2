import { afterEach, describe, expect, it, vi } from "vitest"
import { __rlsPerOpWrap, logAudit, prisma } from "@/lib/prisma"
import { getRlsContext, rlsStorage } from "@/lib/rls-context"
const CANARY = "PRIVATE_SYNTHETIC_person@example.invalid_Bearer_secret"
afterEach(() => vi.restoreAllMocks())
describe("shared Prisma audit fallback and RLS diagnostics", () => {
  it("preserves the full audit write under tenant context while projecting only the failure event", async () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => {})
    const persist = vi.spyOn(prisma.auditLog, "create").mockImplementation(async () => {
      expect(getRlsContext()).toEqual({ orgId: CANARY })
      throw new Error(CANARY, { cause: { query: CANARY } })
    })
    await expect(logAudit(CANARY, CANARY, CANARY, CANARY, CANARY, { userId: CANARY, ipAddress: CANARY, userAgent: CANARY, oldValue: { secret: CANARY }, newValue: { secret: CANARY } })).resolves.toBeUndefined()
    expect(persist).toHaveBeenCalledWith({ data: { organizationId: CANARY, action: CANARY, entityType: CANARY, entityId: CANARY, entityName: CANARY, userId: CANARY, ipAddress: CANARY, userAgent: CANARY, oldValue: { secret: CANARY }, newValue: { secret: CANARY } } })
    expect(sink.mock.calls).toEqual([["[application] operation failed", { operation: "audit-persist" }]])
  })
  it("does not replace existing best-effort resolution when both persistence and destination fail", async () => {
    vi.spyOn(prisma.auditLog, "create").mockRejectedValue(new Error(CANARY))
    vi.spyOn(console, "error").mockImplementation(() => { throw new Error(CANARY) })
    await expect(logAudit(CANARY, CANARY, CANARY, CANARY)).resolves.toBeUndefined()
  })
  it("retains fail-closed org-model test behavior without query arguments or a captured caller stack", async () => {
    const query = vi.fn()
    const wrap = __rlsPerOpWrap({} as never)
    await rlsStorage.run(undefined as never, async () => {
      await expect(wrap({ model: "Deal", operation: CANARY, args: { where: CANARY }, query })).rejects.toThrow("org-scoped Deal.unknown ran with NO RLS context")
    })
    expect(query).not.toHaveBeenCalled()
  })
  it("keeps raw-query warn-only behavior and unchanged arguments even when the sink throws", async () => {
    const sink = vi.spyOn(console, "warn").mockImplementation(() => { throw new Error(CANARY) })
    const args = { query: CANARY }
    const query = vi.fn(async () => "result")
    await expect(rlsStorage.run(undefined as never, () => __rlsPerOpWrap({} as never)({ operation: "$queryRawUnsafe", args, query }))).resolves.toBe("result")
    expect(query).toHaveBeenCalledWith(args)
    expect(sink).toHaveBeenCalledOnce()
    expect(sink.mock.calls[0]).toHaveLength(1)
    expect(JSON.stringify(sink.mock.calls)).not.toContain(CANARY)
    expect(JSON.stringify(sink.mock.calls)).not.toContain("shared-privacy-prisma")
  })
})
