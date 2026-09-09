import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: vi.fn(),
}))

import { resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { makeMtmPrismaMock } from "./mocks/mtm-prisma"

const auth = { orgId: "org-1", userId: "user-1", role: "manager" }

beforeEach(() => vi.clearAllMocks())

describe("resolveMtmExcelAccess", () => {
  it("blocks imports for every role when the rollout flag is disabled", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN" } as never)
    vi.mocked(db.mtmSetting.findUnique).mockResolvedValue({ value: false })

    await expect(resolveMtmExcelAccess(db as never, auth)).resolves.toMatchObject({ canImport: false })
  })

  it("requires an explicit manager-import setting", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER" } as never)
    vi.mocked(db.mtmSetting.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ value: { enabled: true } })

    await expect(resolveMtmExcelAccess(db as never, auth)).resolves.toMatchObject({ canImport: true })
  })
})
