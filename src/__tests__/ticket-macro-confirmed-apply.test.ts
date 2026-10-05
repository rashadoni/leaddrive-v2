import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  macro: { findFirst: vi.fn(), update: vi.fn() },
  ticket: { findFirst: vi.fn(), update: vi.fn() },
  comment: { create: vi.fn() },
  audit: { findFirst: vi.fn(), create: vi.fn() },
  user: { findFirst: vi.fn() },
  lock: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: {
  ticketMacro: mocks.macro,
  $transaction: mocks.transaction,
} }))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_resource: string, _action: string, handler: (req: NextRequest, auth: { orgId: string; userId: string }, ctx: { params: Promise<{ id: string }> }) => Promise<Response>) =>
    (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => handler(req, { orgId: "org-confirmed", userId: "actor-confirmed" }, ctx),
}))
import { POST } from "@/app/api/v1/ticket-macros/[id]/apply/route"

const actions = [
  { type: "add_comment", value: "Synthetic public reply" },
  { type: "add_internal_note", value: "Synthetic private note" },
  { type: "set_priority", value: "high" },
]
const requestId = "36dc3b39-2df6-4184-859f-e489785afeb3"
const invoke = (body: unknown, id = "macro-1") => POST(new NextRequest("http://localhost/api/v1/ticket-macros/" + id + "/apply", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
}), { params: Promise.resolve({ id }) })
const confirmed = () => ({ ticketId: "ticket-1", requestId, expectedActions: actions })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.macro.findFirst.mockResolvedValue({ id: "macro-1", isActive: true, actions })
  mocks.ticket.findFirst.mockResolvedValue({ id: "ticket-1", tags: [], comments: [] })
  mocks.audit.findFirst.mockResolvedValue(null)
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
    ticketMacro: mocks.macro, ticket: mocks.ticket, ticketComment: mocks.comment,
    auditLog: mocks.audit, user: mocks.user, $queryRaw: mocks.lock,
  }))
})

describe("confirmed macro application", () => {
  it("executes the previewed audience and order, and writes a content-free receipt inside the transaction", async () => {
    expect((await invoke(confirmed())).status).toBe(200)
    expect(mocks.comment.create.mock.calls.map(call => call[0].data.isInternal)).toEqual([false, true])
    expect(mocks.comment.create.mock.invocationCallOrder[1]).toBeLessThan(mocks.ticket.update.mock.invocationCallOrder[0])
    expect(mocks.audit.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: "org-confirmed", userId: "actor-confirmed", entityId: "ticket-1",
      entityType: "ticket_macro_application", action: "ticket_macro_applied",
    }) })
    expect(JSON.stringify(mocks.audit.create.mock.calls)).not.toContain("Synthetic")
    expect(mocks.lock).toHaveBeenCalledTimes(1)
    expect(mocks.lock.mock.calls[0].slice(1)).toEqual(["ticket-1", "org-confirmed"])
  })

  it("replays a committed request without duplicate comments, mutations, receipts or usage increments", async () => {
    expect((await invoke(confirmed())).status).toBe(200)
    const receipt = mocks.audit.create.mock.calls[0][0].data
    mocks.audit.findFirst.mockResolvedValue(receipt)
    expect((await invoke(confirmed())).status).toBe(200)
    expect(mocks.comment.create).toHaveBeenCalledTimes(2)
    expect(mocks.ticket.update).toHaveBeenCalledTimes(1)
    expect(mocks.audit.create).toHaveBeenCalledTimes(1)
    expect(mocks.macro.update).toHaveBeenCalledTimes(1)
  })

  it("rejects changed macro actions before any mutation", async () => {
    mocks.macro.findFirst.mockResolvedValue({ isActive: true, actions: [{ type: "set_priority", value: "critical" }] })
    const response = await invoke(confirmed())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MACRO_PREVIEW_STALE")
    expect(mocks.comment.create).not.toHaveBeenCalled()
    expect(mocks.ticket.update).not.toHaveBeenCalled()
    expect(mocks.audit.create).not.toHaveBeenCalled()
  })

  it("rejects reuse of a receipt for another confirmed macro", async () => {
    await invoke(confirmed())
    mocks.audit.findFirst.mockResolvedValue(mocks.audit.create.mock.calls[0][0].data)
    const response = await invoke(confirmed(), "macro-2")
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe("MACRO_REQUEST_CONFLICT")
    expect(mocks.comment.create).toHaveBeenCalledTimes(2)
  })

  it("requires preview and request ID together", async () => {
    expect((await invoke({ ticketId: "ticket-1", requestId })).status).toBe(400)
    expect((await invoke({ ticketId: "ticket-1", expectedActions: actions })).status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("propagates receipt failure out of the transaction rather than returning success", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    mocks.audit.create.mockRejectedValue(new Error("Synthetic audit failure"))
    const response = await invoke(confirmed())
    expect(response.status).toBe(500)
    expect(mocks.macro.update).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it("does not act on a ticket outside the tenant", async () => {
    mocks.ticket.findFirst.mockResolvedValue(null)
    expect((await invoke(confirmed())).status).toBe(404)
    expect(mocks.ticket.findFirst).toHaveBeenCalledWith({ where: { id: "ticket-1", organizationId: "org-confirmed" } })
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.comment.create).not.toHaveBeenCalled()
  })
})
