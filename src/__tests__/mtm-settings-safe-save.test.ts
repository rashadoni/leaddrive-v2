import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((v: { status?: number } | null) => !!v && (v.status ?? 0) >= 400),
}))

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn().mockResolvedValue(undefined),
}))

import { PUT as UpdateSettings } from "@/app/api/v1/mtm/settings/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { AGENT_PERMISSION_ADMIN_ONLY_KEYS, AGENT_PERMISSION_SETTING_KEYS } from "@/lib/mtm/agent-permissions"
import { NAV_ORG_SETTING_KEYS } from "@/lib/nav-items"
import {
  MTM_SETTING_NUMBER_RANGES,
  changedMtmSettingKeys,
  mtmSettingValuesEqual,
  validateMtmSettingChanges,
} from "@/lib/mtm/settings-validation"

const ORG = "org-1"
const source = (path: string) => readFileSync(resolve(path), "utf8")
const PAGE = "src/app/(dashboard)/mtm/settings/page.tsx"

function put(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/v1/mtm/settings", "http://localhost:3000"), {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function as(role: string) {
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role, userId: `${role}-user`, principalType: "session" } as never)
  // Attendance policy writes recheck the current active administrator in DB.
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ role, hiddenModules: [] }])
}

function upsertedKeys(): string[] {
  return vi.mocked(prisma.mtmSetting.upsert).mock.calls.map((call) => (call[0] as { create: { key: string } }).create.key)
}

/** «Ссылки на местоположение» as the table holds them — as much as the save reads and writes. */
interface ShareLinkRow {
  id: string
  organizationId: string
  expiresAt: Date
  revokedAt: Date | null
  revokedBy: string | null
}
let shareLinks: ShareLinkRow[]

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  shareLinks = []
  // The statement's own filters are applied to the rows: one that forgot the
  // organization, «not revoked» or «not out of time» changes rows it must not.
  vi.mocked(prisma.mtmLocationShareLink.updateMany).mockImplementation((async (args: {
    where: { organizationId?: string; revokedAt?: null; expiresAt?: { gt: Date } }
    data: Partial<ShareLinkRow>
  }) => {
    for (const key of Object.keys(args.where)) {
      if (!["organizationId", "revokedAt", "expiresAt"].includes(key)) throw new Error(`the links were asked by an unknown filter: ${key}`)
    }
    const rows = shareLinks.filter((row) =>
      (args.where.organizationId === undefined || row.organizationId === args.where.organizationId)
      && (args.where.revokedAt !== null || row.revokedAt === null)
      && (args.where.expiresAt === undefined || row.expiresAt.getTime() > args.where.expiresAt.gt.getTime()))
    for (const row of rows) Object.assign(row, args.data)
    return { count: rows.length }
  }) as never)
  as("admin")
})

describe("settings validation ranges", () => {
  it("accepts every shipped default, so no untouched tenant is refused", () => {
    const numeric = Object.fromEntries(
      Object.keys(MTM_SETTING_NUMBER_RANGES).map((key) => [key, MTM_SETTING_DEFAULTS[key as keyof typeof MTM_SETTING_DEFAULTS]]),
    )
    expect(validateMtmSettingChanges(numeric, MTM_SETTING_DEFAULTS)).toEqual([])
  })

  it("covers every numeric setting the page renders", () => {
    const numericDefaults = Object.entries(MTM_SETTING_DEFAULTS).filter(([, value]) => typeof value === "number").map(([key]) => key)
    expect(Object.keys(MTM_SETTING_NUMBER_RANGES).sort()).toEqual(numericDefaults.sort())
  })

  it("pins the agreed bounds", () => {
    expect(MTM_SETTING_NUMBER_RANGES.geofenceRadius).toEqual({ min: 25, max: 10_000 })
    expect(MTM_SETTING_NUMBER_RANGES.lateAfterHour).toEqual({ min: 0, max: 23 })
    expect(MTM_SETTING_NUMBER_RANGES.autoCheckoutMinutes).toEqual({ min: 5, max: 1_440 })
    expect(MTM_SETTING_NUMBER_RANGES.maxPhotosPerVisit).toEqual({ min: 1, max: 50 })
    for (const range of Object.values(MTM_SETTING_NUMBER_RANGES)) expect(range.min).toBeGreaterThanOrEqual(0)
    expect(MTM_SETTING_NUMBER_RANGES.deviationAlertThrottleMinutes.min).toBeGreaterThanOrEqual(1)
    expect(MTM_SETTING_NUMBER_RANGES.historyStopMinimumMinutes.min).toBeGreaterThanOrEqual(1)
  })

  it("diffs structurally against the loaded values", () => {
    const loaded = { a: 1, b: true, c: [{ id: "x" }] }
    expect(changedMtmSettingKeys(loaded, { a: 1, b: true, c: [{ id: "x" }] })).toEqual([])
    expect(changedMtmSettingKeys(loaded, { a: 2, b: true, c: [{ id: "y" }] })).toEqual(["a", "c"])
  })

  it("ignores key order inside objects but not array order", () => {
    const loaded = { targets: [{ id: "x", label: { az: "A", en: "B" } }, { id: "y" }] }
    expect(changedMtmSettingKeys(loaded, { targets: [{ label: { en: "B", az: "A" }, id: "x" }, { id: "y" }] })).toEqual([])
    expect(changedMtmSettingKeys(loaded, { targets: [{ id: "y" }, { id: "x", label: { az: "A", en: "B" } }] })).toEqual(["targets"])
    expect(mtmSettingValuesEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(mtmSettingValuesEqual([1], { 0: 1 })).toBe(false)
  })
})

describe("PUT /api/v1/mtm/settings — client fields and specialties", () => {
  const stored = (key: string) => vi.mocked(prisma.mtmSetting.upsert).mock.calls
    .map((call) => call[0] as { create: { key: string; value: unknown } })
    .find((call) => call.create.key === key)?.create.value

  it("stores the fields a tenant switches off, in one order whatever order they came in", async () => {
    const res = await UpdateSettings(put({ contactHiddenFields: ["coverage", "specialtyName", "coverage"] }))
    expect(res.status).toBe(200)
    expect(stored("contactHiddenFields")).toEqual(["specialtyName", "coverage"])
  })

  it("refuses to hide the name or an unknown field, and writes nothing", async () => {
    for (const bad of [["firstName"], ["lastName"], ["nope"], "specialtyName"]) {
      const res = await UpdateSettings(put({ contactHiddenFields: bad }))
      expect(res.status).toBe(400)
    }
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("stores the specialty list trimmed and without repeats; an emptied list stays empty", async () => {
    expect((await UpdateSettings(put({ contactSpecialties: [" Pediatr ", "pediatr", "Cərrah ümumi"] }))).status).toBe(200)
    expect(stored("contactSpecialties")).toEqual(["Pediatr", "Cərrah ümumi"])

    vi.mocked(prisma.mtmSetting.upsert).mockClear()
    expect((await UpdateSettings(put({ contactSpecialties: [] }))).status).toBe(200)
    expect(stored("contactSpecialties")).toEqual([])
  })

  it("refuses a specialty list that is not a list of names", async () => {
    for (const bad of ["Pediatr", [7], ["x".repeat(81)]]) {
      expect((await UpdateSettings(put({ contactSpecialties: bad }))).status).toBe(400)
    }
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })
})

describe("PUT /api/v1/mtm/settings — safe save", () => {
  it("writes only the keys it receives", async () => {
    const res = await UpdateSettings(put({ geofenceRadius: 150 }))
    expect(res.status).toBe(200)
    expect(upsertedKeys()).toEqual(["geofenceRadius"])
  })

  it.each([
    ["geofenceRadius", 24, 25, 10_000],
    ["geofenceRadius", 10_001, 25, 10_000],
    ["lateAfterHour", 24, 0, 23],
    ["lateAfterHour", -1, 0, 23],
    ["autoCheckoutMinutes", 4, 5, 1_440],
    ["maxPhotosPerVisit", 0, 1, 50],
    ["maxPhotosPerVisit", 51, 1, 50],
    ["deviationAlertThrottleMinutes", 0, 1, 1_440],
    ["historyStopMinimumMinutes", 0, 1, 240],
  ])("refuses %s = %s with MTM_SETTING_OUT_OF_RANGE", async (key, value, min, max) => {
    const res = await UpdateSettings(put({ [key]: value }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("MTM_SETTING_OUT_OF_RANGE")
    expect(body.key).toBe(key)
    expect(body.errors).toEqual([{ key, code: "MTM_SETTING_OUT_OF_RANGE", min, max }])
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("refuses a fractional hour and an empty value instead of storing 0", async () => {
    const fractional = await (await UpdateSettings(put({ lateAfterHour: 9.5 }))).json()
    expect(fractional.code).toBe("MTM_SETTING_NOT_INTEGER")
    const empty = await UpdateSettings(put({ geofenceRadius: "" }))
    expect(empty.status).toBe(400)
    expect((await empty.json()).code).toBe("MTM_SETTING_INVALID_TYPE")
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("reports every invalid field at once", async () => {
    const body = await (await UpdateSettings(put({ geofenceRadius: 1, maxPhotosPerVisit: 99, photoRequired: "yes" }))).json()
    expect(body.errors.map((error: { key: string }) => error.key)).toEqual(["geofenceRadius", "maxPhotosPerVisit", "photoRequired"])
  })

  it("does not let a stored out-of-range value block saving another key", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "geofenceRadius", value: 5 }] as never)
    const res = await UpdateSettings(put({ maxPhotosPerVisit: 12 }))
    expect(res.status).toBe(200)
    expect(upsertedKeys()).toEqual(["maxPhotosPerVisit"])
  })

  it("accepts an old page's whole-object save that carries a stored out-of-range value unchanged", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "geofenceRadius", value: 5 },
      { key: "lateAfterHour", value: 30 },
    ] as never)
    const res = await UpdateSettings(put({ ...MTM_SETTING_DEFAULTS, geofenceRadius: 5, lateAfterHour: 30, maxPhotosPerVisit: 12 }))
    expect(res.status).toBe(200)
    // Audit names only the real change, not ~40 untouched keys.
    expect(writeMtmAudit).toHaveBeenCalledTimes(1)
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      oldData: { maxPhotosPerVisit: 10 },
      newData: expect.objectContaining({ keys: ["maxPhotosPerVisit"], maxPhotosPerVisit: 12 }),
    }))
    // Changing that stored value to another out-of-range value is still refused.
    const refused = await UpdateSettings(put({ geofenceRadius: 6 }))
    expect(refused.status).toBe(400)
  })

  it("writes no audit entry when nothing really changed", async () => {
    const res = await UpdateSettings(put({ geofenceRadius: 100, alertLongBreak: true }))
    expect(res.status).toBe(200)
    expect(writeMtmAudit).not.toHaveBeenCalled()
  })

  it("audits old and new values for each changed key", async () => {
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "geofenceRadius", value: 120 }] as never)
    await UpdateSettings(put({ geofenceRadius: 150, alertLongBreak: false }))
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "SETTINGS_UPDATE",
      oldData: { geofenceRadius: 120, alertLongBreak: true },
      newData: expect.objectContaining({
        keys: ["geofenceRadius", "alertLongBreak"],
        geofenceRadius: 150,
        alertLongBreak: false,
        actor: { userId: "admin-user", role: "admin" },
      }),
    }))
  })

  it.each([false, true])("still drops module switches (%s) from a manager", async (value) => {
    as("manager")
    const res = await UpdateSettings(put({ maxPhotosPerVisit: 12, fieldContactsEnabled: value, pharmacyPromotionsEnabled: value }))
    expect(res.status).toBe(200)
    expect(upsertedKeys()).toEqual(["maxPhotosPerVisit"])
    expect((await res.json()).data.ignoredKeys).toEqual(["fieldContactsEnabled", "pharmacyPromotionsEnabled"])
  })

  it("lets only an administrator change what an agent may ask for", async () => {
    const switches = {
      agentContactCreateRequests: false,
      agentContactChangeRequests: false,
      agentCustomerCreateRequests: false,
    }
    as("manager")
    const res = await UpdateSettings(put({ ...switches, taskSelfCreate: false }))
    expect(res.status).toBe(200)
    // The older agent switches keep their rule: a manager may change them.
    expect(upsertedKeys()).toEqual(["taskSelfCreate"])
    expect((await res.json()).data.ignoredKeys).toEqual(Object.keys(switches))

    vi.mocked(prisma.mtmSetting.upsert).mockClear()
    as("admin")
    const adminRes = await UpdateSettings(put(switches))
    expect(upsertedKeys()).toEqual(Object.keys(switches))
    expect((await adminRes.json()).data.ignoredKeys).toEqual([])
  })

  // «Allow check-in outside the zone» stands beside the zone radius on the
  // settings page. The radius is a manager's to set, and set wide enough it
  // lifts the zone just as well — so the switch is not an administrator-only
  // one. On «Access & permissions» alone it was out of reach of the account
  // that runs the field module for the client (owner, 2026-10-08).
  it("lets whoever may set the zone radius allow a check-in outside the zone", async () => {
    as("manager")
    const res = await UpdateSettings(put({ geofenceRadius: 250, agentCheckInOutsideZone: true, agentContactCreateRequests: false }))
    expect(res.status).toBe(200)
    expect(upsertedKeys().sort()).toEqual(["agentCheckInOutsideZone", "geofenceRadius"])
    expect((await res.json()).data.ignoredKeys).toEqual(["agentContactCreateRequests"])
  })

  // «Ссылка на местоположение» (2026-10-10): a manager makes a link by which
  // somebody outside the organization sees where an employee is. Off for
  // every organization until somebody switches it on — and switched by
  // whoever runs the field module, the people who change the rest of «Карта
  // агентов», not by an administrator alone: the account that runs it for a
  // client is a CRM manager, and a switch only an administrator reaches was
  // already moved once for that reason (the case above).
  it("ships the location links switched off, and takes the switch from a manager as from an administrator", async () => {
    expect(MTM_SETTING_DEFAULTS.locationShareLinksEnabled).toBe(false)
    for (const role of ["manager", "admin", "superadmin"]) {
      vi.mocked(prisma.mtmSetting.upsert).mockClear()
      vi.mocked(writeMtmAudit).mockClear()
      as(role)
      const res = await UpdateSettings(put({ locationShareLinksEnabled: true }))
      expect(res.status, role).toBe(200)
      expect(await res.json(), role).toEqual({ success: true, data: { ignoredKeys: [] } })
      expect(vi.mocked(prisma.mtmSetting.upsert).mock.calls.map((call) => (call[0] as { create: unknown }).create), role)
        .toEqual([{ organizationId: ORG, key: "locationShareLinksEnabled", value: true }])
      // Who opened employees' positions to outsiders is on the record.
      expect(writeMtmAudit, role).toHaveBeenCalledWith(expect.objectContaining({
        action: "SETTINGS_UPDATE",
        oldData: { locationShareLinksEnabled: false },
        newData: expect.objectContaining({ keys: ["locationShareLinksEnabled"], locationShareLinksEnabled: true, actor: { userId: `${role}-user`, role } }),
      }))
    }
    // Switching it back off is the same person's to do.
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "locationShareLinksEnabled", value: true }] as never)
    vi.mocked(prisma.mtmSetting.upsert).mockClear()
    as("manager")
    expect((await UpdateSettings(put({ locationShareLinksEnabled: false }))).status).toBe(200)
    expect(upsertedKeys()).toEqual(["locationShareLinksEnabled"])
  })

  // Decision of 2026-10-11. An administrator who switches the links off to
  // stop a leak expects the leak to stay stopped. Before this, switching them
  // back on an hour later — to hand out a proper link — brought every link
  // whose time was not up back to life, the wrong one included.
  describe("switching the location links off ends every link already handed out, for good", () => {
    const NOW = new Date("2026-10-10T08:00:00.000Z")
    const LATER = new Date("2026-10-10T20:00:00.000Z")
    const switchedOn = () => vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "locationShareLinksEnabled", value: true }] as never)
    const row = (id: string, over: Partial<ShareLinkRow> = {}): ShareLinkRow => {
      const made = { id, organizationId: ORG, expiresAt: LATER, revokedAt: null, revokedBy: null, ...over }
      shareLinks.push(made)
      return made
    }
    const kept = () => JSON.stringify(shareLinks)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(NOW)
      row("working-1")
      row("working-2", { expiresAt: new Date(NOW.getTime() + 1) })
      row("ran-out", { expiresAt: NOW })
      row("revoked-earlier", { revokedAt: new Date("2026-10-10T07:00:00.000Z"), revokedBy: "somebody-else" })
      row("another-organization", { organizationId: "org-2" })
    })

    it("ends the working links of THIS organization in the same save: when, and by whom", async () => {
      switchedOn()
      as("admin")
      const res = await UpdateSettings(put({ locationShareLinksEnabled: false }))
      expect(res.status).toBe(200)
      expect(Object.fromEntries(shareLinks.map((link) => [link.id, [link.revokedAt?.toISOString() ?? null, link.revokedBy]]))).toEqual({
        "working-1": [NOW.toISOString(), "admin-user"],
        "working-2": [NOW.toISOString(), "admin-user"],
        // Out of time already: it is not «revoked by» anybody.
        "ran-out": [null, null],
        // Whoever revoked it first stays on the record.
        "revoked-earlier": ["2026-10-10T07:00:00.000Z", "somebody-else"],
        // Not this organization's to end.
        "another-organization": [null, null],
      })
      // The switch itself is stored, once.
      expect(vi.mocked(prisma.mtmSetting.upsert).mock.calls.map((call: unknown[]) => (call[0] as { create: unknown }).create))
        .toEqual([{ organizationId: ORG, key: "locationShareLinksEnabled", value: false }])
    })

    it("a manager's save does it too — the switch is not an administrator's alone", async () => {
      switchedOn()
      as("manager")
      expect((await UpdateSettings(put({ locationShareLinksEnabled: false }))).status).toBe(200)
      expect(shareLinks.filter((link) => link.revokedBy === "manager-user").map((link) => link.id)).toEqual(["working-1", "working-2"])
    })

    it("stores the switch and ends the links as ONE transaction — there is no «off, but the links were not ended»", async () => {
      switchedOn()
      expect((await UpdateSettings(put({ locationShareLinksEnabled: false, geofenceRadius: 150 }))).status).toBe(200)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      const [together] = vi.mocked(prisma.$transaction).mock.calls[0] as unknown as [unknown[]]
      expect(together).toHaveLength(2)
      // Everything else in the same save is stored as before, and the switch is not stored a second time.
      expect(upsertedKeys().sort()).toEqual(["geofenceRadius", "locationShareLinksEnabled"])
      expect(prisma.mtmLocationShareLink.updateMany).toHaveBeenCalledTimes(1)
    })

    it("when ending the links fails the save says so, and nothing else of it is stored — it can be pressed again", async () => {
      switchedOn()
      vi.mocked(prisma.mtmLocationShareLink.updateMany).mockRejectedValueOnce(new Error("connection lost") as never)
      const before = kept()
      const res = await UpdateSettings(put({ locationShareLinksEnabled: false, geofenceRadius: 150 }))
      expect(res.status).toBe(400)
      expect(kept()).toBe(before)
      expect(upsertedKeys()).not.toContain("geofenceRadius")
      expect(writeMtmAudit).not.toHaveBeenCalled()
      // Pressed again, with the switch still read as on (the database undid the first attempt): done.
      expect((await UpdateSettings(put({ locationShareLinksEnabled: false, geofenceRadius: 150 }))).status).toBe(200)
      expect(shareLinks.filter((link) => link.revokedAt?.getTime() === NOW.getTime()).map((link) => link.id)).toEqual(["working-1", "working-2"])
    })

    it("says on the journal's one row how many links the save ended — and writes no row per link", async () => {
      switchedOn()
      as("manager")
      await UpdateSettings(put({ locationShareLinksEnabled: false }))
      expect(writeMtmAudit).toHaveBeenCalledTimes(1)
      expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: "SETTINGS_UPDATE",
        agentId: null,
        oldData: { locationShareLinksEnabled: true },
        newData: {
          locationShareLinksEnabled: false,
          keys: ["locationShareLinksEnabled"],
          actor: { userId: "manager-user", role: "manager" },
          locationShareLinksEnded: 2,
        },
      }))
    })

    it.each([
      ["off stays off", false, false],
      ["on stays on", true, true],
      ["never touched, saved as off", undefined, false],
      ["switched ON", false, true],
      ["switched on for the first time", undefined, true],
    ])("touches no link when %s", async (_what, stored, sent) => {
      vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue((stored === undefined ? [] : [{ key: "locationShareLinksEnabled", value: stored }]) as never)
      const before = kept()
      const res = await UpdateSettings(put({ locationShareLinksEnabled: sent, geofenceRadius: 150 }))
      expect(res.status).toBe(200)
      expect(prisma.mtmLocationShareLink.updateMany).not.toHaveBeenCalled()
      expect(kept()).toBe(before)
      // And the journal claims no links ended.
      for (const [entry] of vi.mocked(writeMtmAudit).mock.calls) expect(entry.newData).not.toHaveProperty("locationShareLinksEnded")
    })

    it("touches no link when another setting is saved while the links are on, nor when the page sends the switch unchanged with it", async () => {
      switchedOn()
      const before = kept()
      expect((await UpdateSettings(put({ geofenceRadius: 150 }))).status).toBe(200)
      // A page opened before a deploy sends the whole object back.
      expect((await UpdateSettings(put({ ...MTM_SETTING_DEFAULTS, locationShareLinksEnabled: true, geofenceRadius: 200 }))).status).toBe(200)
      expect(prisma.mtmLocationShareLink.updateMany).not.toHaveBeenCalled()
      expect(kept()).toBe(before)
    })

    it("ends nothing for a role that may not save, or for a value that is not a yes or a no", async () => {
      switchedOn()
      const before = kept()
      as("viewer")
      expect((await UpdateSettings(put({ locationShareLinksEnabled: false }))).status).toBe(403)
      as("admin")
      for (const bad of ["false", 0, null]) expect((await UpdateSettings(put({ locationShareLinksEnabled: bad }))).status).toBe(400)
      expect(prisma.mtmLocationShareLink.updateMany).not.toHaveBeenCalled()
      expect(kept()).toBe(before)
    })
  })

  it("takes only a yes or a no for the location links, and nothing from a role that changes no setting", async () => {
    for (const bad of ["true", 1, null, ["on"]]) {
      const res = await UpdateSettings(put({ locationShareLinksEnabled: bad }))
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect(await res.json()).toMatchObject({ key: "locationShareLinksEnabled", code: "MTM_SETTING_INVALID_TYPE" })
    }
    for (const role of ["sales", "support", "viewer"]) {
      as(role)
      expect((await UpdateSettings(put({ locationShareLinksEnabled: true }))).status, role).toBe(403)
    }
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("keeps the location-link switch out of what an agent may do, out of the menu and off the phone", () => {
    const key = "locationShareLinksEnabled"
    // It is not a permission of the employee: he is the one being shown.
    expect([...AGENT_PERMISSION_SETTING_KEYS, ...AGENT_PERMISSION_ADMIN_ONLY_KEYS] as string[]).not.toContain(key)
    expect(NAV_ORG_SETTING_KEYS as readonly string[]).not.toContain(key)
    // The field app is told its policies key by key; this one is not among them.
    expect(source("src/app/api/v1/mtm/mobile/bootstrap/route.ts")).not.toContain("ocationShareLink")
  })

  it("refuses a non-boolean value for an agent switch", async () => {
    const res = await UpdateSettings(put({ agentContactCreateRequests: "no" }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ key: "agentContactCreateRequests", code: "MTM_SETTING_INVALID_TYPE" })
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("drops advanced GPS thresholds from a manager and writes them for an administrator", async () => {
    as("manager")
    const res = await UpdateSettings(put({ gpsInterval: 60, historyStopRadiusMeters: 80 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { ignoredKeys: ["gpsInterval", "historyStopRadiusMeters"] } })
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
    expect(writeMtmAudit).not.toHaveBeenCalled()

    as("admin")
    const adminRes = await UpdateSettings(put({ gpsInterval: 60, historyStopRadiusMeters: 80 }))
    expect(upsertedKeys()).toEqual(["gpsInterval", "historyStopRadiusMeters"])
    expect((await adminRes.json()).data.ignoredKeys).toEqual([])
  })
})

describe("settings page contract", () => {
  const page = source(PAGE)
  const group = (titleKey: string) => {
    const start = page.indexOf(`titleKey: "${titleKey}"`)
    expect(start, titleKey).toBeGreaterThan(-1)
    const next = page.indexOf("titleKey: \"group", start + 1)
    return page.slice(start, next === -1 ? undefined : next)
  }

  it("sends only changed keys and reloads after saving", () => {
    expect(page).toContain("changedMtmSettingKeys(loaded, settings)")
    expect(page).toContain("body: JSON.stringify(changes)")
    expect(page).not.toContain("body: JSON.stringify(settings)")
    const save = page.slice(page.indexOf("const handleSave"), page.indexOf("const settingGroups"))
    expect(save).toContain("await loadSettings()")
  })

  it("never turns an empty number input into 0", () => {
    expect(page).not.toContain("parseInt(e.target.value) || 0")
    expect(page).toContain('setFieldErrors((prev) => ({ ...prev, [key]: { key, code: "required" } }))')
  })

  it("puts the long-open visit switch and its minutes on one row in Xəbərdarlıqlar", () => {
    const alerts = group("groupAlerts")
    expect(alerts).toMatch(/key: "alertLongBreak"[\s\S]*thresholds: \[\{ key: "autoCheckoutMinutes"/)
    expect(alerts).toMatch(/key: "alertOutOfZone"[\s\S]*key: "deviationThresholdMeters"[\s\S]*key: "deviationAlertThrottleMinutes"/)
    expect(group("groupVisits")).not.toContain("autoCheckoutMinutes")
    expect(group("groupGeofence")).not.toContain("deviationThresholdMeters")
    // Thresholds render only while their switch is on.
    expect(page).toContain("showThresholds(item.thresholds, switchOn) ?")
    expect(page).toContain("showThresholds(note.thresholds, switchOn) ?")
    expect(page).toContain("!!thresholds && (switchOn || thresholds.some((threshold) => threshold.key in fieldErrors))")
  })

  it("moves the late hour out of alerts into the live map card", () => {
    expect(group("groupAlerts")).not.toContain("lateAfterHour")
    const liveMap = group("groupLiveMap")
    expect(liveMap).toContain('key: "lateAfterHour"')
    expect(liveMap).toContain('key: "offlineThresholdSeconds"')
  })

  it("puts the location-link switch in the live map card, for whoever changes that card, and says in every language what it opens", () => {
    const liveMap = group("groupLiveMap")
    const row = liveMap.split("\n").find((line) => line.includes('key: "locationShareLinksEnabled"')) ?? ""
    expect(row).toContain('labelKey: "lblLocationShareLinks", hintKey: "hintLocationShareLinks", type: "boolean"')
    // Not an administrator-only switch (see the PUT cases above).
    expect(row).not.toContain("adminOnly")
    // Once on the page: a second row elsewhere would be a second place to switch it.
    expect(page.match(/key: "locationShareLinksEnabled"/g)).toHaveLength(1)

    // What the person switching it on is told — in a few short sentences
    // since 2026-10-12 (the owner: «его описание облегчи»; his own words for
    // the thing are «как в такси»): that an outsider needs no sign-in and sees
    // where the agent is now, that it is only during the workday and without
    // history or route, that the agent himself is not told, and that
    // switching it off stops the links already handed out for good.
    const said: Record<string, RegExp[]> = {
      ru: [
        /^Как в такси:/, /человек без входа видит, где агент сейчас/, /Только во время рабочего дня, без истории и маршрута/,
        /Агенту уведомление не приходит/, /Если выключить, все выданные ссылки перестанут работать насовсем/,
      ],
      en: [
        /^Like a taxi app:/, /the person sees where the agent is now, without signing in/, /Only during the workday, with no history and no route/,
        /The agent is not notified/, /If you switch it off, every link handed out stops working for good/,
      ],
      az: [
        /^Taksi kimi:/, /açan şəxs sistemə daxil olmadan agentin indi harada olduğunu görür/, /Yalnız iş günü ərzində, tarixçə və marşrut olmadan/,
        /Agentə bildiriş getmir/, /Söndürsəniz, verilmiş bütün linklər həmişəlik işləməyəcək/,
      ],
    }
    for (const [locale, sentences] of Object.entries(said)) {
      const messages = JSON.parse(source(`messages/${locale}.json`)).mtmSettingsPage
      expect(messages.lblLocationShareLinks, locale).toEqual(expect.any(String))
      for (const sentence of sentences) expect(messages.hintLocationShareLinks, `${locale}: ${sentence}`).toMatch(sentence)
      // Short enough to be read: the hint it replaced ran to seven sentences.
      expect(messages.hintLocationShareLinks.split(/(?<=[.!?])\s+/).length, locale).toBeLessThanOrEqual(4)
    }
  })

  it("keeps technical GPS history thresholds in a collapsed admin-only section", () => {
    const advanced = group("groupAdvanced")
    for (const key of ["gpsInterval", "locationWindowMinutes", "historyMaxAccuracyMeters", "historyStopRadiusMeters", "historyStopMinimumMinutes"]) {
      expect(advanced).toMatch(new RegExp(`key: "${key}".*adminOnly: true`))
    }
    expect(page).toMatch(/<details data-settings-group="groupAdvanced"/)
    expect(page).not.toMatch(/<details[^>]*\sopen/)
    const route = source("src/app/api/v1/mtm/settings/route.ts")
    expect(route).toMatch(/const ADVANCED_KEYS = \[[\s\S]*"gpsInterval"[\s\S]*"historyStopMinimumMinutes"[\s\S]*\] as const/)
  })

  it("splits route planning from agent capabilities", () => {
    const routes = group("groupRoutePlanning")
    const agent = group("groupAgentCapabilities")
    for (const key of ["taskSelfCreate", "taskSelfRecurring", "teamScheduleVisibilityEnabled"]) {
      expect(agent).toContain(`key: "${key}"`)
      expect(routes).not.toContain(`key: "${key}"`)
    }
    expect(page).not.toContain("groupRollout")
  })

  // «Agent capabilities» held two switches no agent ever uses, and the daily
  // visit card held the kill switch of the visit rules. They are set once at
  // rollout: they live in the last tab, away from what a manager changes.
  it("keeps what is set once at rollout in the administrator tab", () => {
    const rare = group("groupRare")
    expect(rare).toContain('tab: "admin"')
    for (const key of ["visitPoliciesEnabled", "brandPotentialPerAgentEnabled", "excelImportsEnabled"]) {
      expect(rare).toContain(`key: "${key}"`)
      for (const daily of ["groupVisits", "groupGeofence", "groupAgentCapabilities", "groupRoutePlanning"]) {
        expect(group(daily), `${key} in ${daily}`).not.toContain(`key: "${key}"`)
      }
    }
    // The notice that replaces the visit switches while the rules are off
    // names the switch by the words on it, in every language.
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(source(`messages/${locale}.json`))
      expect(messages.mtmVisitPolicies.featureDisabledAdminHint, locale).toContain(messages.mtmSettingsPage.lblVisitPolicies)
      expect(messages.mtmVisitPolicies.featureDisabledAdminHint, locale).toContain(messages.mtmSettingsPage.tabAdmin)
    }
  })

  it("has a sticky save bar with a dirty indicator, cancel and leave warnings", () => {
    expect(page).toContain('data-testid="mtm-settings-save-bar"')
    expect(page).toMatch(/className="sticky bottom-0/)
    expect(page).toContain('ts("dirtyIndicator")')
    expect(page).toContain('ts("cancel")')
    expect(page).toContain('window.addEventListener("beforeunload", onBeforeUnload)')
    expect(page).toContain('document.addEventListener("click", onLinkClick, true)')
    expect(page).toContain('window.confirm(tsRef.current("unsavedLeaveConfirm"))')
  })

  it("guards browser Back/Forward with a same-URL history entry", () => {
    const guard = page.slice(page.indexOf("// Browser Back/Forward while dirty"))
    expect(guard).toContain('window.addEventListener("popstate", onPopState)')
    expect(guard).toContain("mtmSettingsGuard: true")
    expect(guard).toMatch(/if \(window\.confirm\(tsRef\.current\("unsavedLeaveConfirm"\)\)\) \{\s*leaving = true\s*window\.history\.back\(\)\s*\} else \{\s*armGuard\(\)/)
    expect(guard).toContain("}, [dirty])")
  })

  it("tells a non-administrator which keys were not saved", () => {
    expect(page).toContain('toast.warning(ts("ignoredAdminKeys", { count: ignoredKeys.length }))')
  })

  it("refreshes visit-rule warnings and the rule editor after rule-related saves", () => {
    const save = page.slice(page.indexOf("const handleSave"), page.indexOf("const settingGroups"))
    expect(save).toMatch(/if \("visitPoliciesEnabled" in changes \|\| "photoRequired" in changes\) \{\s*loadVisitPolicies\(\)\s*setVisitPolicyEditorKey/)
    expect(page).toMatch(/<VisitPolicySettings\s+key=\{visitPolicyEditorKey\}\s+legacyPhotoRequired=\{loaded\.photoRequired === true\}/)
  })

  it("warns when the photo limit drops below a rule's required photo minimum", () => {
    expect(page).toContain('action?.actionKey === "PHOTO" && action.mode === "REQUIRED"')
    expect(page).toMatch(/item\.key === "maxPhotosPerVisit" && typeof settings\.maxPhotosPerVisit === "number" && policyPhotoMinimum > settings\.maxPhotosPerVisit \?/)
    const az = JSON.parse(source("messages/az.json"))
    expect(az.mtmSettingsPage.maxPhotosBelowPolicyMinimum)
      .toBe("Bəzi qaydalarda minimum foto sayı bu limitdən yüksəkdir — tətbiqdə limitlə məhdudlaşdırılacaq")
  })

  it("labels switches and number inputs for assistive technology", () => {
    expect(page).toContain('role="switch"')
    expect(page).toContain("aria-checked={!!settings[item.key]}")
    expect(page).toContain('aria-label={ts("ariaNumber", { label: ts(labelKey), unit: ts(unitKey) })}')
  })

  // The «photo required on every visit» switch applied only while no visit
  // rule matched, and warned about that under itself. 2026-10-08 it left the
  // page: «Что агент делает в визите» shows that setting on the photo row and
  // carries it into the rule its first press creates, so there is one place
  // to require a photo and nothing to warn about.
  it("has no second place to require a photo, and hands the old setting to the visit switches", () => {
    expect(page).toContain('fetch("/api/v1/mtm/visit-policies", { cache: "no-store" })')
    expect(page).not.toContain('key: "photoRequired"')
    expect(page).not.toContain("photoPoliciesWarning")
    expect(page).toContain("legacyPhotoRequired={loaded.photoRequired === true}")
    // The server still reads the stored value while an organization has no rule.
    expect(source("src/lib/mtm/visit-policies.ts")).toContain('key: "photoRequired"')
  })

  it("shows localized toasts, never the English fallbacks", () => {
    expect(page).not.toContain("Failed to load settings")
    expect(page).not.toContain("Failed to save settings")
  })

  it("uses no jargon in the Azerbaijani strings the page shows", () => {
    const az = JSON.parse(source("messages/az.json"))
    const keys = new Set([
      ...[...page.matchAll(/(?:labelKey|hintKey|titleKey|unitKey): "(\w+)"/g)].map((m) => m[1]),
      ...[...page.matchAll(/ts\("(\w+)"/g)].map((m) => m[1]),
    ])
    expect(keys.size).toBeGreaterThan(40)
    const offenders = [...keys].filter((key) => {
      const text = az.mtmSettingsPage[key]
      return typeof text !== "string" || /tenant|pilot|birinci mərhələ|server tərəfdən/i.test(text)
    })
    expect(offenders).toEqual([])
    expect(az.mtmSettingsPage.lblGpsInterval).toBe("GPS tarixçəsində gözlənilən interval (san)")
    // Neither text may send the reader to a switch that is no longer on the
    // page («Hər vizit üçün foto tələb olunur» left it on 2026-10-08): with no
    // special rule, the switches of «Agent ziyarətdə nə edir» are what applies.
    for (const key of ["empty", "previewDefault"]) {
      expect(az.mtmVisitPolicies[key]).not.toContain("məcburi deyil")
      expect(az.mtmVisitPolicies[key]).not.toContain("Hər vizit üçün foto")
      expect(az.mtmVisitPolicies[key]).toMatch(/açar/)
    }
    expect(az.mtmSettingsPage.photoPoliciesWarning).toBeUndefined()
  })
})

describe("protected attendance reminders", () => {
  it.each(["attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled"])("rejects a non-admin mixed write to %s before any writes", async key => {
    as("manager")
    expect((await UpdateSettings(put({ [key]: true, supportPhone: "123" }))).status).toBe(403)
    expect(upsertedKeys()).toEqual([])
  })
  it("records the reminder policy in its own atomic audit", async () => {
    as("admin")
    expect((await UpdateSettings(put({ attendanceEmployeeRemindersEnabled: true, attendanceManagerAlertsEnabled: true }))).status).toBe(200)
    expect(upsertedKeys().sort()).toEqual(["attendanceEmployeeRemindersEnabled", "attendanceManagerAlertsEnabled"])
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "MTM_ATTENDANCE_REMINDER_POLICY_CHANGED" }) }))
  })
})
