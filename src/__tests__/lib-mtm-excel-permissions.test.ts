import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mtm/route-permissions", () => ({
  resolveMtmRouteActor: vi.fn(),
}))

import { canImportMtmExcelType, importableMtmExcelTypes, resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"
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

  it("lets a manager load clients without the opt-in the other files need, as the «add client» form does", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "MANAGER" } as never)
    vi.mocked(db.mtmSetting.findUnique).mockResolvedValue(null)

    const access = await resolveMtmExcelAccess(db as never, auth)

    expect(access).toMatchObject({ canImport: false, canImportContacts: true })
    expect(canImportMtmExcelType(access, "CONTACTS")).toBe(true)
    expect(canImportMtmExcelType(access, "CUSTOMERS")).toBe(false)
    expect(importableMtmExcelTypes(access, ["CUSTOMERS", "CONTACTS", "ROUTES"])).toEqual(["CONTACTS"])
  })

  it("does not let a field agent load clients: an agent's new client goes through approval", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "AGENT" } as never)
    vi.mocked(db.mtmSetting.findUnique).mockResolvedValue(null)

    const access = await resolveMtmExcelAccess(db as never, auth)

    expect(importableMtmExcelTypes(access, ["CUSTOMERS", "CONTACTS"])).toEqual([])
  })

  it("stops client files too when Excel imports are switched off for the tenant", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ role: "ADMIN" } as never)
    vi.mocked(db.mtmSetting.findUnique).mockResolvedValue({ value: false })

    const access = await resolveMtmExcelAccess(db as never, auth)

    expect(canImportMtmExcelType(access, "CONTACTS")).toBe(false)
  })

  it("answers no for someone with no employee card at all", async () => {
    const db = makeMtmPrismaMock()
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)

    const access = await resolveMtmExcelAccess(db as never, auth)

    expect(importableMtmExcelTypes(access, ["CUSTOMERS", "CONTACTS"])).toEqual([])
  })
})
