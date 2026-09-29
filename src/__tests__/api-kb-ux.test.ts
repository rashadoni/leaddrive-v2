/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: any) => (request: NextRequest, context?: unknown) =>
    handler(request, { orgId: "org-1", session: null }, context),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    kbArticle: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    kbCategory: { findFirst: vi.fn() },
  },
}))

import { GET as listArticles, POST as createArticle } from "@/app/api/v1/kb/route"
import { DELETE as deleteArticle, GET as getArticle, PUT as updateArticle } from "@/app/api/v1/kb/[id]/route"
import { prisma } from "@/lib/prisma"

const request = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(new URL(path, "http://localhost:3000"), init)

const context = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.kbArticle.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.kbArticle.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.kbArticle.aggregate).mockResolvedValue({ _sum: { viewCount: null } } as never)
})

describe("knowledge base API UX contract", () => {
  it("returns exact tenant summary and applies category filters to the same list", async () => {
    vi.mocked(prisma.kbArticle.count).mockResolvedValue(5 as never)
    vi.mocked(prisma.kbArticle.groupBy)
      .mockResolvedValueOnce([
        { status: "published", _count: { _all: 3 } },
        { status: "draft", _count: { _all: 2 } },
      ] as never)
      .mockResolvedValueOnce([
        { categoryId: "cat-1", status: "published", _count: { _all: 2 } },
        { categoryId: "cat-1", status: "draft", _count: { _all: 1 } },
      ] as never)
    vi.mocked(prisma.kbArticle.aggregate).mockResolvedValue({ _sum: { viewCount: 42 } } as never)

    const response = await listArticles(request("/api/v1/kb?categoryId=cat-1&summary=1&limit=9999"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.summary).toEqual(expect.objectContaining({ total: 5, published: 3, draft: 2, views: 42 }))
    expect(prisma.kbArticle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", categoryId: "cat-1" }),
      take: 500,
    }))
  })

  it("rejects an article category owned by another tenant", async () => {
    vi.mocked(prisma.kbCategory.findFirst).mockResolvedValue(null)

    const response = await createArticle(request("/api/v1/kb", {
      method: "POST",
      body: JSON.stringify({ title: "Guide", categoryId: "foreign-category" }),
    }))

    expect(response.status).toBe(400)
    expect(prisma.kbCategory.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-category", organizationId: "org-1" },
      select: { id: true },
    })
    expect(prisma.kbArticle.create).not.toHaveBeenCalled()
  })

  it("returns tenant-scoped related content for the article detail", async () => {
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue({
      id: "article-1",
      organizationId: "org-1",
      categoryId: "cat-1",
      title: "Guide",
      status: "draft",
    } as never)
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([{ id: "article-2", title: "Related" }] as never)

    const response = await getArticle(request("/api/v1/kb/article-1"), context("article-1"))
    const body = await response.json()

    expect(body.data.relatedArticles).toHaveLength(1)
    expect(prisma.kbArticle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", id: { not: "article-1" }, categoryId: "cat-1" },
      take: 4,
    }))
  })

  it("supports clearing a category without validating an absent reference", async () => {
    vi.mocked(prisma.kbArticle.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue({ id: "article-1", categoryId: null, status: "draft" } as never)

    const response = await updateArticle(request("/api/v1/kb/article-1", {
      method: "PUT",
      body: JSON.stringify({ categoryId: null }),
    }), context("article-1"))

    expect(response.status).toBe(200)
    expect(prisma.kbCategory.findFirst).not.toHaveBeenCalled()
    expect(prisma.kbArticle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { categoryId: null } }))
  })

  it("returns a restorable snapshot before deleting an article", async () => {
    const snapshot = {
      id: "article-1",
      title: "Guide",
      content: "Steps",
      categoryId: "cat-1",
      status: "published",
      tags: ["setup"],
    }
    vi.mocked(prisma.kbArticle.findFirst).mockResolvedValue(snapshot as never)
    vi.mocked(prisma.kbArticle.deleteMany).mockResolvedValue({ count: 1 } as never)

    const response = await deleteArticle(request("/api/v1/kb/article-1", { method: "DELETE" }), context("article-1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.deleted).toEqual(snapshot)
    expect(prisma.kbArticle.deleteMany).toHaveBeenCalledWith({ where: { id: "article-1", organizationId: "org-1" } })
  })
})
