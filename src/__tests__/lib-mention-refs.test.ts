import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}))

import { clearDeletedMentionRefs } from "@/lib/social/mention-refs"
import { prisma } from "@/lib/prisma"

const updateMany = prisma.socialMention.updateMany as any

beforeEach(() => vi.clearAllMocks())

describe("clearDeletedMentionRefs", () => {
  it("no-ops on an empty id list (no DB writes)", async () => {
    await clearDeletedMentionRefs("org-1", "leadId", [])
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("reverts converted_to_lead status, then nulls leadId, scoped by org", async () => {
    await clearDeletedMentionRefs("org-1", "leadId", ["lead-1", "lead-2"])

    expect(updateMany).toHaveBeenCalledTimes(2)
    // step 1: revert status only for rows still marked as this conversion
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { organizationId: "org-1", leadId: { in: ["lead-1", "lead-2"] }, status: "converted_to_lead" },
      data: { status: "reviewed" },
    })
    // step 2: null the ref on every matching row
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { organizationId: "org-1", leadId: { in: ["lead-1", "lead-2"] } },
      data: { leadId: null },
    })
  })

  it("uses the matching converted status for tickets", async () => {
    await clearDeletedMentionRefs("org-1", "ticketId", ["t-1"])
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ ticketId: { in: ["t-1"] }, status: "converted_to_ticket" }),
      data: { status: "reviewed" },
    }))
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { ticketId: null } }))
  })

  it("uses the matching converted status for tasks", async () => {
    await clearDeletedMentionRefs("org-1", "taskId", ["task-1"])
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ taskId: { in: ["task-1"] }, status: "converted_to_task" }),
      data: { status: "reviewed" },
    }))
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { taskId: null } }))
  })
})
