import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"

/**
 * Deleting a conversation moves it to the trash.
 *
 * Destroying it was never an option: the messages, the lead the conversation
 * produced and the audit trail all reference the row, so a hard delete leaves a
 * lead whose origin cannot be read. And the reason people delete a thread is
 * that it is spam or a misfire — not that the evidence has to go.
 */

const updateMany = vi.fn(async () => ({ count: 1 }))
const findFirst = vi.fn(async () => null as unknown)
const update = vi.fn(async () => ({}))
vi.mock("@/lib/prisma", () => ({
  prisma: { socialConversation: { updateMany, findFirst, update } },
  logAudit: vi.fn(),
}))

let role = "manager"
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_m: string, _a: string, handler: Function) =>
    (req: unknown, ctx: unknown) =>
      handler(req, { orgId: "org_1", userId: "u_1", role, email: "a@b.c", name: "A" }, ctx),
  withRlsSessionAuth: (handler: Function) =>
    (req: unknown, ctx: unknown) =>
      handler(req, { orgId: "org_1", userId: "u_1", role, email: "a@b.c", name: "A" }, ctx),
}))

const ctx = { params: Promise.resolve({ id: "conv_1" }) }

describe("moving a conversation to the trash", () => {
  beforeEach(() => { updateMany.mockClear(); updateMany.mockResolvedValue({ count: 1 }) })

  it("stamps deletedAt instead of removing anything", async () => {
    role = "manager"
    findFirst.mockResolvedValue({ id: "conv_1", metadata: {} } as never)
    const { DELETE } = await import("@/app/api/v1/inbox/conversations/[id]/route")
    const res = await DELETE({} as never, ctx as never)
    expect(res.status).toBe(200)
    // The tenant filter on the read is what makes a wrong id a 404 rather than
    // a cross-tenant write.
    const read = findFirst.mock.calls[0][0]
    expect(read.where.organizationId).toBe("org_1")
    expect(read.where.deletedAt).toBeNull()
    const written = update.mock.calls[0][0].data
    expect(written.deletedAt).toBeInstanceOf(Date)
    expect(written.deletedBy).toBe("u_1")
  })

  it("refuses an agent", async () => {
    role = "sales"
    const { DELETE } = await import("@/app/api/v1/inbox/conversations/[id]/route")
    const res = await DELETE({} as never, ctx as never)
    expect(res.status).toBe(403)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("is a 404 when the id belongs to nobody", async () => {
    role = "manager"
    findFirst.mockResolvedValue(null)
    const { DELETE } = await import("@/app/api/v1/inbox/conversations/[id]/route")
    expect((await DELETE({} as never, ctx as never)).status).toBe(404)
  })

  it("restores by clearing the stamp, and only for a manager", async () => {
    role = "manager"
    const { POST } = await import("@/app/api/v1/inbox/conversations/[id]/route")
    const res = await POST({} as never, ctx as never)
    expect(res.status).toBe(200)
    const args = updateMany.mock.calls[0][0]
    expect(args.data.deletedAt).toBeNull()
    expect(args.data.deletedBy).toBeNull()
    // Only a row that is actually in the trash can be restored.
    expect(args.where.deletedAt).toEqual({ not: null })

    role = "support"
    updateMany.mockClear()
    expect((await POST({} as never, ctx as never)).status).toBe(403)
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe("the listing", () => {
  // The inbox list is built from MESSAGES and only enriched from the
  // conversation row, so a soft delete does not hide anything by itself — the
  // messages keep producing a row and the delete looks like it did nothing.
  // This is the single most breakable link in the feature, so it is pinned.
  const listing = readFileSync("src/app/api/v1/inbox/route.ts", "utf8")

  it("filters the trash out, and the trash view filters the other way", () => {
    expect(listing).toContain('searchParams.get("view") === "trash"')
    expect(listing).toContain("deletedAt: { not: null }")
    expect(listing).toContain("conversations.filter(isDeleted)")
    expect(listing).toContain("conversations.filter((c) => !isDeleted(c))")
  })

  it("scopes that lookup to the tenant", () => {
    // The listing already runs under RLS; the explicit filter is belt and
    // braces on a query that decides what a user sees.
    const window = listing.slice(listing.indexOf("const deletedIds"), listing.indexOf("const isDeleted"))
    expect(window).toContain("organizationId: orgId")
  })
})

describe("deleting starts the thread over", () => {
  // The qualification markers say "a lead was already made from this thread".
  // They outlive the lead: delete the lead, delete the thread, write again from
  // the same account, and no new lead is ever created — the thread is silently
  // unable to produce one, forever.
  beforeEach(() => { role = "manager"; findFirst.mockClear(); update.mockClear() })

  it("clears the markers that would block a second lead", async () => {
    findFirst.mockResolvedValue({
      id: "conv_1",
      metadata: {
        qualificationTaskId: "task_1",
        qualificationLeadId: "lead_1",
        qualifiedAt: "2026-08-12T10:00:00.000Z",
        salesAssigneeId: "u_9",
        // Anything else on the conversation is not ours to touch.
        sourceProfile: "tiktok:aysel",
      },
    })
    const { DELETE } = await import("@/app/api/v1/inbox/conversations/[id]/route")
    const res = await DELETE({} as never, ctx as never)
    expect(res.status).toBe(200)
    const data = update.mock.calls[0][0].data
    expect(data.deletedAt).toBeInstanceOf(Date)
    for (const gone of ["qualificationTaskId", "qualificationLeadId", "qualifiedAt", "salesAssigneeId"]) {
      expect(data.metadata, `${gone} must be cleared`).not.toHaveProperty(gone)
    }
    expect(data.metadata.sourceProfile).toBe("tiktok:aysel")
  })

  it("is still a 404 for an id that is not this tenant's", async () => {
    findFirst.mockResolvedValue(null)
    const { DELETE } = await import("@/app/api/v1/inbox/conversations/[id]/route")
    expect((await DELETE({} as never, ctx as never)).status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })
})

describe("a customer who writes again undoes the delete", () => {
  // Otherwise their new message is invisible in the inbox AND in the trash, so
  // the business stops answering them and nothing says why.
  const sources = [
    ["src/lib/social/import-conversations.ts", "lastMessageAt: lastAt"],
    ["src/lib/inbox-ensure-conversation.ts", "reopenOnInbound"],
  ] as const

  it.each(sources)("%s clears deletedAt on inbound", (file) => {
    const source = readFileSync(file, "utf8")
    const window = source.slice(source.indexOf("deletedAt: null") - 600, source.indexOf("deletedAt: null") + 60)
    expect(window).toContain("deletedAt: null")
    expect(window).toContain("deletedBy: null")
  })
})
