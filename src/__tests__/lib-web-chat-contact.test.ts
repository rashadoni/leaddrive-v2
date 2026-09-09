import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"
import { matchOrCreateWebChatContact } from "@/lib/web-chat-contact"

const findFirst = vi.mocked(prisma.contact.findFirst)
const create = vi.mocked(prisma.contact.create)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("matchOrCreateWebChatContact", () => {
  it("returns null when neither email nor phone is provided", async () => {
    expect(await matchOrCreateWebChatContact("org-1", { name: "A" })).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("matches an existing contact by email/phone, org-scoped", async () => {
    findFirst.mockResolvedValue({ id: "ct-1", companyId: "co-1" } as never)
    const result = await matchOrCreateWebChatContact("org-1", { email: "a@b.c", phone: "+99450" })

    expect(result).toEqual({ contactId: "ct-1", companyId: "co-1", created: false })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        OR: [{ email: "a@b.c" }, { phone: "+99450" }],
      }),
    }))
    expect(create).not.toHaveBeenCalled()
  })

  it("matches legacy rows stored with untrimmed values: OR includes raw AND trimmed", async () => {
    findFirst.mockResolvedValue({ id: "ct-legacy", companyId: null } as never)
    const result = await matchOrCreateWebChatContact("org-1", { phone: " +99450111 " })

    expect(result).toEqual({ contactId: "ct-legacy", companyId: null, created: false })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ phone: "+99450111" }, { phone: " +99450111 " }],
      }),
    }))
  })

  it("createIfMissing:false → matches but never creates", async () => {
    findFirst.mockResolvedValue(null as never)
    const result = await matchOrCreateWebChatContact("org-1", { email: "a@b.co" }, { createIfMissing: false })

    expect(result).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it("creates a contact with source web_chat when nothing matches", async () => {
    findFirst.mockResolvedValue(null as never)
    create.mockResolvedValue({ id: "ct-new" } as never)
    const result = await matchOrCreateWebChatContact("org-1", { name: "Guest", email: "new@b.c" })

    expect(result).toEqual({ contactId: "ct-new", companyId: null, created: true })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        fullName: "Guest",
        email: "new@b.c",
        phone: null,
        source: "web_chat",
      }),
    })
  })
})
