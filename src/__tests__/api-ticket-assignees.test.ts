import { beforeEach, describe, expect, it, vi } from "vitest"

type TestAuth = { orgId: string; userId: string; role: string }
let auth: TestAuth = { orgId: "org-1", userId: "support-1", role: "support" }

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (request: Request, actor: TestAuth) => Promise<Response>) =>
    (request: Request) => handler(request, auth),
}))

import { GET } from "@/app/api/v1/skill-routing/agents/route"
import { checkPermission } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"

const request = () => new Request("http://localhost/api/v1/skill-routing/agents") as never

describe("GET /api/v1/skill-routing/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth = { orgId: "org-1", userId: "support-1", role: "support" }
    vi.mocked(checkPermission).mockReturnValue(true)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
  })

  it("returns a minimal tenant-scoped list of active ticket assignees", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "agent-1", name: "Agent One", email: "agent@example.test" },
    ] as never)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: [{ id: "agent-1", name: "Agent One", email: "agent@example.test" }],
    })
    expect(checkPermission).toHaveBeenCalledWith("support", "tickets", "read")
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        role: { in: ["admin", "manager", "agent", "support", "ticketing"] },
        isActive: true,
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    })
  })

  it("denies principals without ticket read permission before querying users", async () => {
    auth = { orgId: "org-1", userId: "sales-1", role: "sales" }
    vi.mocked(checkPermission).mockReturnValue(false)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "TICKET_ASSIGNEES_READ_FORBIDDEN" })
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("does not leak database failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(prisma.user.findMany).mockRejectedValue(new Error("database details"))

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "Failed to load ticket assignees.",
      code: "TICKET_ASSIGNEES_LOAD_FAILED",
    })
    consoleError.mockRestore()
  })
})
