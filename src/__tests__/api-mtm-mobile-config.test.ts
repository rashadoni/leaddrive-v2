import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET } from "@/app/api/v1/mtm/mobile/config/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: "org-1", agentId: "agent-1", role: "AGENT" } as any)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
    { key: "dictionary:visitOutcome", value: { ru: "Результат" }, updatedAt: new Date("2026-07-18T10:00:00Z") },
    { key: "formula:coverage", value: { expression: "visited / planned" }, updatedAt: new Date("2026-07-18T11:00:00Z") },
  ] as never)
})

const request = (query = "") => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/config" + query, {
  headers: { Authorization: "Bearer valid-token" },
})

describe("GET /api/v1/mtm/mobile/config", () => {
  it("returns tenant-scoped dictionaries and formulas", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        version: "2026-07-18T11:00:00.000Z",
        changed: true,
        dictionaries: { visitOutcome: { ru: "Результат" } },
        formulas: { coverage: { expression: "visited / planned" } },
      },
    })
  })

  it("returns changed=false for a matching version", async () => {
    const response = await GET(request("?sinceVersion=2026-07-18T11:00:00.000Z"))
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { version: "2026-07-18T11:00:00.000Z", changed: false },
    })
  })
})
