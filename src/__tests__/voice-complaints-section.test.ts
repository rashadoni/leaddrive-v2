import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  count: vi.fn(async () => 2),
  groupBy: vi.fn(async () => []),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: {
      count: db.count,
      groupBy: db.groupBy,
      findMany: vi.fn(async () => []),
    },
    user: { findMany: vi.fn(async () => []) },
  },
}))

import { readSection } from "@/lib/ai/voice/section-reader"

describe("complaints voice section", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reads Ticket rows carrying ComplaintMeta instead of a nonexistent model", async () => {
    const report = await readSection("org-1", "complaints", new Date("2026-08-11T12:00:00Z"), "status")

    expect(report?.section).toBe("complaints")
    expect(db.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: "org-1",
        complaintMeta: { isNot: null },
      }),
    })
    expect(db.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        complaintMeta: { isNot: null },
      }),
    }))
  })
})
