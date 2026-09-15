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
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, role, userId: `${role}-user` } as never)
}

function upsertedKeys(): string[] {
  return vi.mocked(prisma.mtmSetting.upsert).mock.calls.map((call) => (call[0] as { create: { key: string } }).create.key)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
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
    for (const key of ["taskSelfCreate", "taskSelfRecurring", "brandPotentialPerAgentEnabled", "teamScheduleVisibilityEnabled", "excelImportsEnabled"]) {
      expect(agent).toContain(`key: "${key}"`)
      expect(routes).not.toContain(`key: "${key}"`)
    }
    expect(page).not.toContain("groupRollout")
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
    expect(page).toContain("<VisitPolicySettings key={visitPolicyEditorKey} />")
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

  it("warns under the photo switch when visit rules exist", () => {
    expect(page).toContain('fetch("/api/v1/mtm/visit-policies", { cache: "no-store" })')
    expect(page).toMatch(/item\.key === "photoRequired" && activeVisitPolicies > 0 \?/)
    expect(page).toContain('ts("photoPoliciesWarning")')
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
    expect(az.mtmSettingsPage.photoPoliciesWarning).toBe("Ziyarət qaydaları mövcuddur — bu açar yalnız heç bir qayda uyğun gəlmədikdə işləyir.")
    for (const key of ["empty", "previewDefault"]) {
      expect(az.mtmVisitPolicies[key]).not.toContain("məcburi deyil")
      expect(az.mtmVisitPolicies[key]).toContain("Hər vizit üçün foto")
    }
  })
})
