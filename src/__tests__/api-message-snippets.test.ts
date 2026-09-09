import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { applySnippetVariables } from "@/lib/inbox/snippet-vars"

/**
 * E3.1 — inbox snippet library API + variable substitution.
 * Covers: list (tenant + channel filter), create (201 / 400 / 409-dup-shortcut),
 * update (404 / 409), delete (404), and the {{var}} resolver.
 */
const db: {
  list: any[]
  one: any
  created: any
  updateCount: number
  deleteCount: number
  throwP2002: boolean
} = { list: [], one: null, created: null, updateCount: 1, deleteCount: 1, throwP2002: false }

function mkP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  } as any)
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    messageSnippet: {
      findMany: vi.fn(async () => db.list),
      findFirst: vi.fn(async () => db.one),
      create: vi.fn(async ({ data }: any) => {
        if (db.throwP2002) throw mkP2002()
        db.created = data
        return { id: "snip_1", ...data }
      }),
      updateMany: vi.fn(async () => {
        if (db.throwP2002) throw mkP2002()
        return { count: db.updateCount }
      }),
      deleteMany: vi.fn(async () => ({ count: db.deleteCount })),
    },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRls:
    (h: any) =>
    (req: any, ctx: any) =>
      h(req, { orgId: "org_1", session: { userId: "u1" } }, ctx),
}))

import { GET, POST } from "@/app/api/v1/message-snippets/route"
import { PUT, DELETE } from "@/app/api/v1/message-snippets/[id]/route"
import { POST as USE } from "@/app/api/v1/message-snippets/[id]/use/route"

function getReq(path = "http://localhost/api/v1/message-snippets") {
  return new NextRequest(path) as any
}
function jsonReq(method: string, body: any) {
  return new NextRequest("http://localhost/api/v1/message-snippets", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any
}
const idCtx = (id = "snip_1") => ({ params: Promise.resolve({ id }) }) as any

beforeEach(() => {
  db.list = []
  db.one = null
  db.created = null
  db.updateCount = 1
  db.deleteCount = 1
  db.throwP2002 = false
  vi.clearAllMocks()
})

describe("GET /message-snippets", () => {
  it("returns the org's snippets", async () => {
    db.list = [{ id: "s1", shortcut: "greet", title: "Greeting", body: "Hi" }]
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    const { prisma } = await import("@/lib/prisma")
    expect((prisma.messageSnippet.findMany as any).mock.calls[0][0].where.organizationId).toBe("org_1")
  })

  it("applies a channel filter (empty channelTypes OR has channel)", async () => {
    await GET(getReq("http://localhost/api/v1/message-snippets?channel=whatsapp"))
    const { prisma } = await import("@/lib/prisma")
    const where = (prisma.messageSnippet.findMany as any).mock.calls[0][0].where
    expect(where.OR).toEqual([
      { channelTypes: { isEmpty: true } },
      { channelTypes: { has: "whatsapp" } },
    ])
  })

  it("filters to active snippets by default; includeInactive=1 returns all", async () => {
    const { prisma } = await import("@/lib/prisma")
    await GET(getReq())
    expect((prisma.messageSnippet.findMany as any).mock.calls.at(-1)[0].where.isActive).toBe(true)
    await GET(getReq("http://localhost/api/v1/message-snippets?includeInactive=1"))
    expect((prisma.messageSnippet.findMany as any).mock.calls.at(-1)[0].where.isActive).toBeUndefined()
  })
})

describe("POST /message-snippets", () => {
  it("creates a snippet (201) scoped to the org + createdBy from session", async () => {
    const res = await POST(jsonReq("POST", { shortcut: "greet", title: "Greeting", body: "Hi {{contact.name}}" }))
    expect(res.status).toBe(201)
    expect(db.created).toMatchObject({ organizationId: "org_1", createdBy: "u1", shortcut: "greet" })
  })

  it("rejects a shortcut containing a space or slash (400)", async () => {
    const res = await POST(jsonReq("POST", { shortcut: "bad shortcut", title: "X", body: "Y" }))
    expect(res.status).toBe(400)
    const res2 = await POST(jsonReq("POST", { shortcut: "/slash", title: "X", body: "Y" }))
    expect(res2.status).toBe(400)
  })

  it("rejects empty body (400)", async () => {
    const res = await POST(jsonReq("POST", { shortcut: "greet", title: "X", body: "" }))
    expect(res.status).toBe(400)
  })

  it("returns 409 on a duplicate shortcut (P2002)", async () => {
    db.throwP2002 = true
    const res = await POST(jsonReq("POST", { shortcut: "greet", title: "X", body: "Y" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists/i)
  })
})

describe("PUT /message-snippets/[id]", () => {
  it("updates an existing snippet", async () => {
    db.updateCount = 1
    db.one = { id: "snip_1", title: "New" }
    const res = await PUT(jsonReq("PUT", { title: "New" }), idCtx())
    expect(res.status).toBe(200)
    expect((await res.json()).data.title).toBe("New")
  })

  it("returns 404 when the id is not in this org", async () => {
    db.updateCount = 0
    const res = await PUT(jsonReq("PUT", { title: "New" }), idCtx("missing"))
    expect(res.status).toBe(404)
  })

  it("returns 409 when renaming to a taken shortcut (P2002)", async () => {
    db.throwP2002 = true
    const res = await PUT(jsonReq("PUT", { shortcut: "taken" }), idCtx())
    expect(res.status).toBe(409)
  })
})

describe("DELETE /message-snippets/[id]", () => {
  it("deletes (200)", async () => {
    db.deleteCount = 1
    const res = await DELETE(getReq(), idCtx())
    expect(res.status).toBe(200)
    expect((await res.json()).data.deleted).toBe("snip_1")
  })

  it("returns 404 when nothing was deleted", async () => {
    db.deleteCount = 0
    const res = await DELETE(getReq(), idCtx("missing"))
    expect(res.status).toBe(404)
  })
})

describe("POST /message-snippets/[id]/use", () => {
  it("increments usageCount atomically (200)", async () => {
    db.updateCount = 1
    const res = await USE(getReq(), idCtx())
    expect(res.status).toBe(200)
    const { prisma } = await import("@/lib/prisma")
    const call = (prisma.messageSnippet.updateMany as any).mock.calls.at(-1)[0]
    expect(call.where).toEqual({ id: "snip_1", organizationId: "org_1" })
    expect(call.data).toEqual({ usageCount: { increment: 1 } })
  })
  it("returns 404 when the snippet is not in this org", async () => {
    db.updateCount = 0
    const res = await USE(getReq(), idCtx("missing"))
    expect(res.status).toBe(404)
  })
})

describe("applySnippetVariables", () => {
  it("substitutes a known variable", () => {
    expect(applySnippetVariables("Hi {{contact.name}}", { contact: { name: "Anna" } })).toBe("Hi Anna")
  })
  it("blanks a known variable whose value is null", () => {
    expect(applySnippetVariables("Hi {{contact.name}}!", { contact: { name: null } })).toBe("Hi !")
  })
  it("leaves an unknown token literal so a typo is visible", () => {
    expect(applySnippetVariables("X {{foo.bar}}", {})).toBe("X {{foo.bar}}")
  })
  it("derives first_name from a full name when firstName is absent", () => {
    expect(applySnippetVariables("{{contact.first_name}}", { contact: { name: "Anna DiLaurentis" } })).toBe("Anna")
  })
  it("prefers an explicit firstName", () => {
    expect(applySnippetVariables("{{contact.first_name}}", { contact: { firstName: "Bob", name: "Robert X" } })).toBe("Bob")
  })
  it("tolerates whitespace inside braces and resolves agent.name", () => {
    expect(applySnippetVariables("— {{ agent.name }}", { agent: { name: "Sam" } })).toBe("— Sam")
  })
  it("returns an empty string unchanged", () => {
    expect(applySnippetVariables("", { contact: { name: "Anna" } })).toBe("")
  })
})
