import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET as getOrganizationDetail } from "@/app/api/v1/mtm/organizations/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const ADMIN_AUTH: AuthResult = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}
function request(section: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/organizations/customer-1?section=${section}`)
}

function detail(section: string) {
  return getOrganizationDetail(request(section), {
    params: Promise.resolve({ id: "customer-1" }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-15T08:00:00.000Z"))
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(ADMIN_AUTH)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomer.findFirst).mockResolvedValue({
    id: "customer-1",
    name: "Clinic",
  } as never)
})

describe("MTM organization detail projections", () => {
  it("loads a compact summary without eager contact or visit rows", async () => {
    const response = await detail("summary")

    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as {
      select: Record<string, unknown>
    }
    expect(args.select.contactWorkplaces).toBeUndefined()
    expect(args.select.visits).toBeUndefined()
    expect(args.select._count).toBeDefined()
    expect(args.select.agentAssignments).toBeDefined()
    expect(await response.json()).toMatchObject({
      success: true,
      data: { section: "summary" },
    })
  })

  it("loads assignment history only when the staff section is requested", async () => {
    const response = await detail("staff")

    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as {
      select: {
        agentAssignments: {
          where: unknown
          take: number
        }
        fieldPotentials: { take: number }
      }
    }
    expect(args.select.agentAssignments.where).toEqual({ deletedAt: null })
    expect(args.select.agentAssignments.take).toBe(100)
    expect(args.select.fieldPotentials.take).toBe(100)
  })

  it.each([
    ["departments", "departments"],
    ["promotions", "pharmacyPromotionTargets"],
    ["files", "documents"],
  ])("loads the %s projection without eager unrelated rows", async (section, relation) => {
    const response = await detail(section)

    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmCustomer.findFirst).mock.calls[0][0] as { select: Record<string, unknown> }
    expect(args.select[relation]).toBeDefined()
    expect(args.select.contactWorkplaces).toBeUndefined()
    expect(args.select.visits).toBeUndefined()
  })

  it("rejects unknown projections before querying organization data", async () => {
    const response = await detail("commercial-secrets")

    expect(response.status).toBe(400)
    expect(prisma.mtmCustomer.findFirst).not.toHaveBeenCalled()
  })
})
