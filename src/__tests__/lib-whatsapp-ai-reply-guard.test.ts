import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }))
const budget = vi.hoisted(() => vi.fn())
const claim = vi.hoisted(() => vi.fn())
const release = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: { socialConversation: db } }))
vi.mock("@/lib/ai/budget", () => ({ checkAiBudget: budget }))
vi.mock("@/lib/social/ai-autoreply", () => ({ claimConversationAiReply: claim, releaseConversationAiReplyClaim: release }))
import { withWhatsAppAiReplyGuard, whatsappAiHistory } from "@/lib/inbox/whatsapp-ai-reply-guard"

beforeEach(() => {
  vi.resetAllMocks()
  db.findFirst.mockResolvedValue({ assignedTo: null, status: "open" })
  db.updateMany.mockResolvedValue({ count: 1 })
  budget.mockResolvedValue({ allowed: true })
  claim.mockResolvedValue({ claimed: true, token: "owned-token" })
})

describe("native WhatsApp AI spend and ownership", () => {
  it.each(["exhausted", "unavailable"])("never generates or sends when budget is %s", async (reason) => {
    if (reason === "exhausted") budget.mockResolvedValue({ allowed: false })
    else budget.mockRejectedValue(new Error("database unavailable"))
    const generateAndSend = vi.fn()
    await withWhatsAppAiReplyGuard("org", "conversation", generateAndSend)
    expect(generateAndSend).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledWith({ organizationId: "org", conversationId: "conversation", token: "owned-token" })
  })

  it.each([null, { assignedTo: "human", status: "open" }, { assignedTo: null, status: "resolved" }])("leaves missing, assigned or closed conversations alone", async (owner) => {
    db.findFirst.mockResolvedValue(owner)
    const operation = vi.fn()
    await withWhatsAppAiReplyGuard("org", "conversation", operation)
    expect(operation).not.toHaveBeenCalled()
    expect(claim).not.toHaveBeenCalled()
  })

  it("blocks a concurrent webhook while the first owns the conversation", async () => {
    let occupied = false
    claim.mockImplementation(async () => occupied ? { claimed: false } : (occupied = true, { claimed: true, token: "one" }))
    let finish!: () => void
    const generating = new Promise<void>((resolve) => { finish = resolve })
    const operation = vi.fn(async () => generating)
    const first = withWhatsAppAiReplyGuard("org", "conversation", operation)
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
    await withWhatsAppAiReplyGuard("org", "conversation", operation)
    expect(operation).toHaveBeenCalledTimes(1)
    finish()
    await first
  })

  it("blocks send after a human takeover or lease replacement during generation", async () => {
    const send = vi.fn()
    await withWhatsAppAiReplyGuard("org", "conversation", async (stillOwned) => {
      db.updateMany.mockResolvedValue({ count: 0 })
      if (await stillOwned()) send()
    })
    expect(send).not.toHaveBeenCalled()
    expect(db.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "conversation", organizationId: "org", assignedTo: null, status: "open", aiReplyClaimToken: "owned-token" },
    }))
  })

  it("releases only its owned token when generation fails", async () => {
    await expect(withWhatsAppAiReplyGuard("org", "conversation", async () => { throw new Error("model failed") })).rejects.toThrow("model failed")
    expect(release).toHaveBeenCalledWith({ organizationId: "org", conversationId: "conversation", token: "owned-token" })
  })
})

describe("WhatsApp AI history", () => {
  it("keeps the latest consecutive user turn and drops an orphaned assistant at the window boundary", () => {
    expect(whatsappAiHistory([
      { role: "user", content: "current" }, { role: "user", content: "previous failed attempt" },
      { role: "assistant", content: "older answer" }, { role: "user", content: "older question" },
      { role: "assistant", content: "orphan" },
    ], "current")).toEqual([
      { role: "user", content: "older question" }, { role: "assistant", content: "older answer" },
      { role: "user", content: "current" },
    ])
  })

  it("always includes the current inbound, even if the latest history read is stale", () => {
    expect(whatsappAiHistory([{ role: "user", content: "old" }], "current")).toEqual([{ role: "user", content: "current" }])
  })
})
