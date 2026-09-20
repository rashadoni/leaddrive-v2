import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { PUSH_BODY_LIMIT, notifyAgents, pushBody } from "@/lib/mtm/push-notify"

function client(tokens: string[]) {
  return {
    mtmDeviceToken: {
      findMany: vi.fn(async () => tokens.map((token) => ({ token }))),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  }
}

describe("delivering to the agents' phones", () => {
  it("sends one message per live address and counts what went out", async () => {
    const send = vi.fn(async ({ messages }: { messages: Array<{ token: string }> }) =>
      messages.map((message) => ({ token: message.token, ok: true as const })))
    const db = client(["t1", "t2"])

    const result = await notifyAgents({
      client: db,
      organizationId: "org-1",
      agentIds: ["agent-1", "agent-1", "agent-2"],
      title: "Проверка",
      body: "Текст объявления",
      configured: true,
      send: send as never,
    })

    expect(result).toEqual({ sent: 2, failed: 0, retired: 0 })
    expect(db.mtmDeviceToken.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", agentId: { in: ["agent-1", "agent-2"] }, disabledAt: null },
    }))
  })

  /**
   * Push off means nothing is loaded at all: no query, no addresses in memory
   * for a delivery that cannot happen.
   */
  it("touches nothing when push is not configured", async () => {
    const db = client(["t1"])
    const send = vi.fn()
    const result = await notifyAgents({
      client: db, organizationId: "org-1", agentIds: ["agent-1"],
      title: "x", body: "y", configured: false, send: send as never,
    })
    expect(result).toEqual({ sent: 0, failed: 0, retired: 0 })
    expect(db.mtmDeviceToken.findMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("retires the addresses Firebase says are gone, and only those", async () => {
    const db = client(["dead", "alive", "flaky"])
    const send = vi.fn(async () => [
      { token: "dead", ok: false as const, retire: true, error: "HTTP_404" },
      { token: "alive", ok: true as const },
      { token: "flaky", ok: false as const, retire: false, error: "NETWORK" },
    ])

    const result = await notifyAgents({
      client: db, organizationId: "org-1", agentIds: ["agent-1"],
      title: "x", body: "y", configured: true, send: send as never,
    })

    expect(result).toEqual({ sent: 1, failed: 2, retired: 1 })
    expect(db.mtmDeviceToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", token: { in: ["dead"] } },
    }))
  })

  it("says nothing when the agent has no phone registered", async () => {
    const db = client([])
    const send = vi.fn()
    const result = await notifyAgents({
      client: db, organizationId: "org-1", agentIds: ["agent-1"],
      title: "x", body: "y", configured: true, send: send as never,
    })
    expect(result).toEqual({ sent: 0, failed: 0, retired: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it("keeps the lock-screen line short and on one line", () => {
    expect(pushBody("  два   пробела\nи перенос  ")).toBe("два пробела и перенос")
    const long = pushBody("я".repeat(400))
    expect(long.length).toBe(PUSH_BODY_LIMIT)
    expect(long.endsWith("…")).toBe(true)
  })
})

describe("a manager's message reaches the phone", () => {
  const route = readFileSync("src/app/api/v1/mtm/operations/messages/route.ts", "utf8")

  it("pushes after the message is stored, without blocking the reply", () => {
    expect(route).toContain("void notifyAgents({")
    expect(route).toContain('data: { target: "Messages", threadId: result.threadId }')
    expect(route).toContain('.catch((error) => console.warn("[MTM/operations/messages POST] push failed", error))')
  })

  it("sends the recipients it just validated, not everyone in the tenant", () => {
    const call = route.slice(route.indexOf("void notifyAgents({"), route.indexOf("await writeMtmAudit"))
    expect(call).toContain("agentIds: uniqueAgentIds")
    expect(call).toContain("organizationId: auth.orgId")
  })
})
