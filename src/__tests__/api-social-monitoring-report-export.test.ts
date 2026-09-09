import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const findMany = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: { socialMention: { findMany } } }))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: (request: NextRequest, auth: { orgId: string }) => Promise<Response>) => (
    request: NextRequest,
  ) => handler(request, { orgId: "org-1" }),
}))

import { GET } from "@/app/api/v1/social/reports/export/route"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"
import { socialReportVisibleMentionWhere } from "@/lib/social/report-visibility"

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([{
    platform: "instagram",
    externalId: "post-1",
    postExternalId: null,
    contentKind: "POST",
    sourceProvider: "bright-data",
    authorName: "Brand",
    authorHandle: null,
    publishedAt: new Date("2026-07-14T10:00:00Z"),
    text: "Post",
    url: "https://instagram.com/p/one",
    parentPostUrl: null,
    mediaObservations: [{ sourceUrl: "https://cdn.example/video.mp4", thumbnailUrl: "https://cdn.example/cover.jpg" }],
  }])
})

describe("GET social monitoring report export", () => {
  it.each(["xlsx", "docx"])("returns tenant-scoped %s with no-store headers", async format => {
    const response = await GET(new NextRequest(`http://localhost/api/v1/social/reports/export?format=${format}&limit=20`))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toContain(`.${format}`)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        purgedAt: null,
        deletedAtSource: null,
        AND: [riskRelevantMentionWhere(), socialReportVisibleMentionWhere()],
      },
      take: 20,
    }))
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100)
  })

  it("rejects unsupported formats before querying tenant data", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/social/reports/export?format=pdf"))
    expect(response.status).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
  })
})
