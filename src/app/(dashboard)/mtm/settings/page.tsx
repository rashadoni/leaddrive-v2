"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { notifyMtmSettingsChanged, type MtmNavOrgSettings } from "@/hooks/use-mtm-org-settings"
import { NAV_ORG_SETTING_KEYS } from "@/lib/nav-items"
import { toast } from "sonner"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import {
  Settings, Save, Satellite, MapPin, Camera, BellRing, Route, Clock3, LifeBuoy, LayoutGrid, Radar, UserCog,
  AlertTriangle, RotateCcw, ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { VisitPolicySettings } from "./visit-policy-settings"
import { ScoringFormulaSettings } from "./scoring-formula-settings"
import { ContactRequiredFieldSettings } from "./contact-required-field-settings"
import { ContactDictionarySettings } from "./contact-dictionary-settings"
import { OrganizationAttributePackageSettings } from "./organization-attribute-package-settings"
import { RouteTargetTypeSettings } from "./route-target-type-settings"
import { COMMON_TIMEZONES } from "@/lib/timezone"
import type { MtmRouteTargetType } from "@/lib/mtm/route-target-types"
import { CoveragePolicyAdmin } from "@/components/mtm/coverage-policy-admin"
import { KpiPolicyAdmin } from "@/components/mtm/kpi-policy-admin"
import {
  MTM_SETTING_ERROR_CODES,
  MTM_SETTING_NUMBER_RANGES,
  changedMtmSettingKeys,
  isMtmNumericSettingKey,
  validateMtmNumericSetting,
  type MtmSettingFieldError,
} from "@/lib/mtm/settings-validation"

type SettingValue = string | number | boolean | string[] | MtmRouteTargetType[] | null | undefined
type SettingsMap = Record<string, SettingValue>
type UnitKey = "unitSeconds" | "unitMinutes" | "unitMeters" | "unitHour" | "unitPhotos"

type Threshold = { key: string; labelKey: string; hintKey?: string; unitKey: UnitKey }
type SettingItem = {
  key: string
  labelKey: string
  hintKey: string
  type: "boolean" | "number" | "timezone" | "text"
  unitKey?: UnitKey
  adminOnly?: boolean
  // Numbers that only mean something while this switch is on: rendered in
  // the switch's own row and hidden while it is off (their stored values stay).
  thresholds?: Threshold[]
  // Plain explanatory sub-blocks rendered in the switch's row.
  notes?: { titleKey: string; hintKey: string; thresholds?: Threshold[] }[]
}
type SettingGroup = { titleKey: string; icon: typeof Settings; hintKey?: string; items: SettingItem[] }

function stringSettingValue(value: SettingValue, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

type PolicySummary = { isActive?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown; actions?: unknown }

function activePolicies(policies: unknown, now = Date.now()): PolicySummary[] {
  if (!Array.isArray(policies)) return []
  return policies.filter((policy): policy is PolicySummary => {
    if (!policy || typeof policy !== "object") return false
    const row = policy as { isActive?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown }
    if (row.isActive !== true) return false
    const from = typeof row.effectiveFrom === "string" ? Date.parse(row.effectiveFrom) : Number.NaN
    const to = typeof row.effectiveTo === "string" ? Date.parse(row.effectiveTo) : Number.NaN
    if (Number.isFinite(from) && from > now) return false
    if (Number.isFinite(to) && to < now) return false
    return true
  })
}

/** Highest REQUIRED photo minimum among active rules (0 when none). */
function highestRequiredPhotoMinimum(policies: PolicySummary[]): number {
  let highest = 0
  for (const policy of policies) {
    if (!Array.isArray(policy.actions)) continue
    for (const action of policy.actions as { actionKey?: unknown; mode?: unknown; minCount?: unknown }[]) {
      if (action?.actionKey === "PHOTO" && action.mode === "REQUIRED" && typeof action.minCount === "number") {
        highest = Math.max(highest, action.minCount)
      }
    }
  }
  return highest
}

/**
 * HONEST settings page: renders exactly the keys in MTM_SETTING_DEFAULTS —
 * every option here is read and enforced somewhere in the app, and each hint
 * says what the value really does (not what it was once meant to do).
 *
 * SAFE SAVE: the page keeps the values last loaded from the server and sends
 * only the keys the user changed, then reloads. Two open tabs used to
 * overwrite each other's changes because every save wrote the whole object.
 * Numbers are validated here and again by the PUT with the same ranges
 * (src/lib/mtm/settings-validation.ts); an empty or out-of-range input keeps
 * the previous value and shows a field error instead of becoming 0.
 */
export default function MtmSettingsPage() {
  const t = useTranslations("nav")
  const ts = useTranslations("mtmSettingsPage")
  const { data: session } = useSession()
  // Mirrors the PUT guard: only an administrator changes admin-only switches.
  const viewerRole = (session?.user as { role?: string } | undefined)?.role ?? ""
  const canChangeAdminOnly = viewerRole === "admin" || viewerRole === "superadmin"
  const [loaded, setLoaded] = useState<SettingsMap>({})
  const [settings, setSettings] = useState<SettingsMap>({})
  // Raw text of number inputs being edited, so "" never turns into 0.
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, MtmSettingFieldError | { key: string; code: "required" }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeVisitPolicies, setActiveVisitPolicies] = useState(0)
  const [policyPhotoMinimum, setPolicyPhotoMinimum] = useState(0)
  // Bumped after a save that changes how visit rules apply, so the rule
  // editor below remounts and reloads (its internals stay untouched).
  const [visitPolicyEditorKey, setVisitPolicyEditorKey] = useState(0)
  // Loading and the leave warning must not re-run when the translator's
  // identity changes; they read the latest one through this ref.
  const tsRef = useRef(ts)
  tsRef.current = ts

  const loadSettings = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch("/api/v1/mtm/settings", { cache: "no-store" })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.success) {
        toast.error(tsRef.current("loadFailed"))
        return false
      }
      setLoaded(body.data)
      setSettings(body.data)
      setNumberDrafts({})
      setFieldErrors({})
      return true
    } catch {
      toast.error(tsRef.current("loadFailed"))
      return false
    }
  }, [])

  useEffect(() => {
    loadSettings().finally(() => setLoading(false))
  }, [loadSettings])

  // Active rules decide two warnings: the photo switch is only a fallback
  // when no rule matches, and a rule's photo minimum above the per-visit
  // limit is capped at that limit.
  const loadVisitPolicies = useCallback(() => {
    fetch("/api/v1/mtm/visit-policies", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.success) return
        const active = activePolicies(body.data?.policies)
        setActiveVisitPolicies(active.length)
        setPolicyPhotoMinimum(highestRequiredPhotoMinimum(active))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadVisitPolicies()
  }, [loadVisitPolicies])

  const changedKeys = useMemo(() => changedMtmSettingKeys(loaded, settings), [loaded, settings])
  const hasFieldErrors = Object.keys(fieldErrors).length > 0
  const dirty = changedKeys.length > 0 || hasFieldErrors

  // Warn before leaving with unsaved changes: reload/close, and in-app links.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    const onLinkClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      if (!window.confirm(tsRef.current("unsavedLeaveConfirm"))) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onLinkClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onLinkClick, true)
    }
  }, [])

  // Browser Back/Forward while dirty: a same-URL guard entry is pushed on top
  // of this page, so Back first lands on this very page (the router sees no
  // URL change) and we can ask. Confirm → step back once more for real;
  // cancel → re-arm the guard. Pushing an entry also drops the forward stack,
  // so Forward cannot leave unasked. When the page becomes clean again the
  // guard entry is popped. Programmatic router.push (command palette) is not
  // intercepted — beforeunload does not fire for it and Next has no hook.
  useEffect(() => {
    if (!dirty) return
    let leaving = false
    let guardOnTop = true
    const armGuard = () => {
      window.history.pushState({ ...(window.history.state ?? {}), mtmSettingsGuard: true }, "", window.location.href)
      guardOnTop = true
    }
    armGuard()
    const onPopState = () => {
      if (leaving) return
      guardOnTop = false
      if (window.confirm(tsRef.current("unsavedLeaveConfirm"))) {
        leaving = true
        window.history.back()
      } else {
        armGuard()
      }
    }
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("popstate", onPopState)
      // Saved or cancelled while still on the page: remove our extra entry.
      // On unmount after a confirmed navigation dirtyRef is still true.
      if (guardOnTop && !leaving && !dirtyRef.current && window.history.state?.mtmSettingsGuard) {
        window.history.back()
      }
    }
  }, [dirty])

  const updateSetting = (key: string, value: SettingValue) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const updateNumber = (key: string, text: string) => {
    setNumberDrafts((prev) => ({ ...prev, [key]: text }))
    const trimmed = text.trim()
    if (!trimmed) {
      // Keep the previous value; the field shows what is missing.
      setFieldErrors((prev) => ({ ...prev, [key]: { key, code: "required" } }))
      return
    }
    const parsed = Number(trimmed)
    const error = isMtmNumericSettingKey(key) ? validateMtmNumericSetting(key, parsed) : null
    if (error) {
      setFieldErrors((prev) => ({ ...prev, [key]: error }))
      return
    }
    clearFieldError(key)
    updateSetting(key, parsed)
  }

  const fieldErrorText = (key: string): string | null => {
    const error = fieldErrors[key]
    if (!error) return null
    if (error.code === "required") return ts("errRequired")
    const range = isMtmNumericSettingKey(key) ? MTM_SETTING_NUMBER_RANGES[key] : null
    if (error.code === MTM_SETTING_ERROR_CODES.outOfRange && range) return ts("errOutOfRange", { min: range.min, max: range.max })
    if (error.code === MTM_SETTING_ERROR_CODES.notInteger) return ts("errNotInteger")
    return ts("errInvalidType")
  }

  const handleCancel = () => {
    setSettings(loaded)
    setNumberDrafts({})
    setFieldErrors({})
  }

  const handleSave = async () => {
    if (hasFieldErrors) {
      toast.error(ts("saveInvalid"))
      return
    }
    if (changedKeys.length === 0) return
    // Only what this tab changed: a stale tab no longer overwrites another
    // tab's (or another administrator's) newer values for untouched keys.
    const changes = Object.fromEntries(changedKeys.map((key) => [key, settings[key]]))
    setSaving(true)
    try {
      const res = await fetch("/api/v1/mtm/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const errors = Array.isArray(body?.errors) ? body.errors as MtmSettingFieldError[] : []
        if (errors.length > 0) {
          setFieldErrors((prev) => ({ ...prev, ...Object.fromEntries(errors.map((error) => [error.key, error])) }))
          toast.error(ts("saveInvalid"))
        } else {
          toast.error(ts("saveFailed"))
        }
        return
      }
      toast.success(ts("savedToast"))
      const moduleSwitches: MtmNavOrgSettings = {}
      for (const key of NAV_ORG_SETTING_KEYS) {
        const value = changes[key]
        if (typeof value === "boolean") moduleSwitches[key] = value
      }
      if (Object.keys(moduleSwitches).length > 0) notifyMtmSettingsChanged(moduleSwitches)
      if ("visitPoliciesEnabled" in changes || "photoRequired" in changes) {
        loadVisitPolicies()
        setVisitPolicyEditorKey((value) => value + 1)
      }
      const ignoredKeys = Array.isArray(body?.data?.ignoredKeys) ? body.data.ignoredKeys as string[] : []
      if (ignoredKeys.length > 0) toast.warning(ts("ignoredAdminKeys", { count: ignoredKeys.length }))
      // Saved even if the reload below fails, so the bar stops saying "unsaved".
      setLoaded((prev) => ({ ...prev, ...changes }))
      // Show what the server now holds, including keys another tab changed.
      await loadSettings()
    } catch {
      toast.error(ts("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  // Groups carry i18n KEYS — labels/hints resolved via ts() at render time.
  // Every key maps 1:1 to MTM_SETTING_DEFAULTS (the API whitelists to it).
  const settingGroups: SettingGroup[] = [
    {
      titleKey: "groupScheduling",
      icon: Clock3,
      items: [
        { key: "timezone", labelKey: "lblTimezone", hintKey: "hintTimezone", type: "timezone" },
      ],
    },
    {
      titleKey: "groupSupport",
      icon: LifeBuoy,
      items: [
        { key: "supportEmail", labelKey: "lblSupportEmail", hintKey: "hintSupportEmail", type: "text" },
        { key: "supportPhone", labelKey: "lblSupportPhone", hintKey: "hintSupportPhone", type: "text" },
      ],
    },
    {
      // Whole-feature switches: hide a surface from menus and the agent app,
      // never delete data. Administrator-only, mirrored by the PUT guard.
      titleKey: "groupModules",
      icon: LayoutGrid,
      items: [
        { key: "fieldContactsEnabled", labelKey: "lblFieldContacts", hintKey: "hintFieldContacts", type: "boolean", adminOnly: true },
        { key: "pharmacyPromotionsEnabled", labelKey: "lblPharmacyPromotions", hintKey: "hintPharmacyPromotions", type: "boolean", adminOnly: true },
      ],
    },
    {
      titleKey: "groupVisits",
      icon: Camera,
      items: [
        { key: "photoRequired", labelKey: "lblPhotoRequired", hintKey: "hintPhotoRequired", type: "boolean" },
        { key: "visitPoliciesEnabled", labelKey: "lblVisitPolicies", hintKey: "hintVisitPolicies", type: "boolean" },
        { key: "maxPhotosPerVisit", labelKey: "lblMaxPhotosPerVisit", hintKey: "hintMaxPhotos", type: "number", unitKey: "unitPhotos" },
        { key: "photoWatermarkEnabled", labelKey: "lblPhotoWatermark", hintKey: "hintPhotoWatermark", type: "boolean" },
      ],
    },
    {
      titleKey: "groupGeofence",
      icon: MapPin,
      items: [
        { key: "geofenceRadius", labelKey: "lblGeofenceRadius", hintKey: "hintGeofenceRadius", type: "number", unitKey: "unitMeters" },
      ],
    },
    {
      // One row per alert: the switch and the numbers it uses live together.
      titleKey: "groupAlerts",
      icon: BellRing,
      items: [
        {
          key: "alertLongBreak", labelKey: "lblAlertLongBreak", hintKey: "hintAlertLongBreak", type: "boolean",
          thresholds: [{ key: "autoCheckoutMinutes", labelKey: "lblAutoCheckoutMinutes", unitKey: "unitMinutes" }],
        },
        {
          // One stored key (alertOutOfZone) controls both alerts below.
          key: "alertOutOfZone", labelKey: "lblAlertOutOfZone", hintKey: "hintAlertOutOfZone", type: "boolean",
          notes: [
            { titleKey: "subOutOfZone", hintKey: "hintSubOutOfZone" },
            {
              titleKey: "subRouteDeviation",
              hintKey: "hintSubRouteDeviation",
              thresholds: [
                { key: "deviationThresholdMeters", labelKey: "lblDeviationThreshold", unitKey: "unitMeters" },
                { key: "deviationAlertThrottleMinutes", labelKey: "lblDeviationThrottle", unitKey: "unitMinutes" },
              ],
            },
          ],
        },
      ],
    },
    {
      titleKey: "groupLiveMap",
      icon: Radar,
      items: [
        { key: "lateAfterHour", labelKey: "lblLateAfterHour", hintKey: "hintLateAfterHour", type: "number", unitKey: "unitHour" },
        { key: "offlineThresholdSeconds", labelKey: "lblOfflineThreshold", hintKey: "hintOfflineThreshold", type: "number", unitKey: "unitSeconds" },
      ],
    },
    {
      titleKey: "groupRoutePlanning",
      icon: Route,
      items: [
        { key: "routeAssignmentsEnabled", labelKey: "lblRouteAssignments", hintKey: "hintRouteAssignments", type: "boolean" },
        { key: "routeSelfPublish", labelKey: "lblRouteSelfPublish", hintKey: "hintRouteSelfPublish", type: "boolean" },
        { key: "routeTravelEnabled", labelKey: "lblRouteTravel", hintKey: "hintRouteTravel", type: "boolean" },
        { key: "routeTravelNavigationEnabled", labelKey: "lblRouteTravelNavigation", hintKey: "hintRouteTravelNavigation", type: "boolean" },
        { key: "enforceWorkCalendarForRoutes", labelKey: "lblEnforceWorkCalendar", hintKey: "hintEnforceWorkCalendar", type: "boolean" },
      ],
    },
    {
      titleKey: "groupAgentCapabilities",
      icon: UserCog,
      items: [
        { key: "taskSelfCreate", labelKey: "lblTaskSelfCreate", hintKey: "hintTaskSelfCreate", type: "boolean" },
        { key: "taskSelfRecurring", labelKey: "lblTaskSelfRecurring", hintKey: "hintTaskSelfRecurring", type: "boolean" },
        { key: "teamScheduleVisibilityEnabled", labelKey: "lblTeamScheduleVisibility", hintKey: "hintTeamScheduleVisibility", type: "boolean" },
        { key: "brandPotentialPerAgentEnabled", labelKey: "lblBrandPotentialPerAgent", hintKey: "hintBrandPotentialPerAgent", type: "boolean" },
        { key: "excelImportsEnabled", labelKey: "lblExcelImports", hintKey: "hintExcelImports", type: "boolean" },
      ],
    },
  ]

  // Technical GPS-history thresholds: collapsed, administrator-only (the PUT
  // drops them from anyone else, like the module switches).
  const advancedGroup: SettingGroup = {
    titleKey: "groupAdvanced",
    icon: Satellite,
    hintKey: "hintAdvanced",
    items: [
      { key: "gpsInterval", labelKey: "lblGpsInterval", hintKey: "hintGpsInterval", type: "number", unitKey: "unitSeconds", adminOnly: true },
      { key: "locationWindowMinutes", labelKey: "lblLocationWindow", hintKey: "hintLocationWindow", type: "number", unitKey: "unitMinutes", adminOnly: true },
      { key: "historyMaxAccuracyMeters", labelKey: "lblHistoryAccuracy", hintKey: "hintHistoryAccuracy", type: "number", unitKey: "unitMeters", adminOnly: true },
      { key: "historyStopRadiusMeters", labelKey: "lblHistoryStopRadius", hintKey: "hintHistoryStopRadius", type: "number", unitKey: "unitMeters", adminOnly: true },
      { key: "historyStopMinimumMinutes", labelKey: "lblHistoryStopMinimum", hintKey: "hintHistoryStopMinimum", type: "number", unitKey: "unitMinutes", adminOnly: true },
    ],
  }

  const renderNumber = (key: string, labelKey: string, unitKey: UnitKey, disabled = false) => {
    const error = fieldErrorText(key)
    const range = isMtmNumericSettingKey(key) ? MTM_SETTING_NUMBER_RANGES[key] : undefined
    const stored = settings[key]
    const value = key in numberDrafts ? numberDrafts[key] : (typeof stored === "number" ? String(stored) : "")
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <input
          type="number"
          inputMode="numeric"
          step={1}
          min={range?.min}
          max={range?.max}
          value={value}
          disabled={disabled}
          aria-label={ts("ariaNumber", { label: ts(labelKey), unit: ts(unitKey) })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `mtm-setting-error-${key}` : undefined}
          onChange={(e) => updateNumber(key, e.target.value)}
          className={`w-24 rounded-md border bg-background px-2 py-1 text-right text-sm disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-destructive" : "border-zinc-200 dark:border-zinc-700"}`}
        />
        {error ? <span id={`mtm-setting-error-${key}`} role="alert" className="max-w-[12rem] text-right text-xs text-destructive">{error}</span> : null}
      </div>
    )
  }

  const renderSwitch = (item: SettingItem, disabled: boolean) => (
    <button
      type="button"
      role="switch"
      aria-checked={!!settings[item.key]}
      aria-label={ts(item.labelKey)}
      disabled={disabled}
      onClick={() => updateSetting(item.key, !settings[item.key])}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${settings[item.key] ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings[item.key] ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  )

  const renderThresholds = (thresholds: Threshold[], disabled: boolean) => (
    <div className="space-y-2">
      {thresholds.map((threshold) => (
        <div key={threshold.key} className="flex items-start justify-between gap-4">
          <div className="min-w-0 pt-1 text-sm">{ts(threshold.labelKey)}</div>
          {renderNumber(threshold.key, threshold.labelKey, threshold.unitKey, disabled)}
        </div>
      ))}
    </div>
  )

  // Thresholds show while their switch is on — or while one of them still
  // carries an error, so a blocked save never points at a hidden field.
  const showThresholds = (thresholds: Threshold[] | undefined, switchOn: boolean): thresholds is Threshold[] =>
    !!thresholds && (switchOn || thresholds.some((threshold) => threshold.key in fieldErrors))

  const renderItem = (item: SettingItem) => {
    const disabled = item.adminOnly === true && !canChangeAdminOnly
    const switchOn = settings[item.key] === true
    return (
      <div key={item.key} data-setting-row={item.key} className="space-y-3">
        <div className={`flex items-start justify-between gap-4 ${item.type === "text" ? "flex-col sm:flex-row" : ""}`}>
          <div className="min-w-0">
            <div className="text-sm font-medium">{ts(item.labelKey)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{ts(item.hintKey)}</div>
          </div>
          {item.type === "boolean" ? (
            renderSwitch(item, disabled)
          ) : item.type === "timezone" ? (
            <Select
              value={stringSettingValue(settings[item.key], "Asia/Baku")}
              onChange={(event) => updateSetting(item.key, event.target.value)}
              aria-label={ts(item.labelKey)}
              className="w-52 shrink-0"
            >
              {COMMON_TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
            </Select>
          ) : item.type === "text" ? (
            <Input
              value={stringSettingValue(settings[item.key], "")}
              onChange={(event) => updateSetting(item.key, event.target.value)}
              aria-label={ts(item.labelKey)}
              className="w-full shrink-0 sm:w-64"
              maxLength={item.key === "supportPhone" ? 100 : 200}
              type={item.key === "supportEmail" ? "email" : "tel"}
              autoComplete={item.key === "supportEmail" ? "email" : "tel"}
            />
          ) : (
            renderNumber(item.key, item.labelKey, item.unitKey ?? "unitMinutes", disabled)
          )}
        </div>
        {item.key === "maxPhotosPerVisit" && typeof settings.maxPhotosPerVisit === "number" && policyPhotoMinimum > settings.maxPhotosPerVisit ? (
          <div data-testid="max-photos-policy-warning" role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{ts("maxPhotosBelowPolicyMinimum")}</span>
          </div>
        ) : null}
        {item.key === "photoRequired" && activeVisitPolicies > 0 ? (
          <div data-testid="photo-required-policy-warning" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{ts("photoPoliciesWarning")}</span>
          </div>
        ) : null}
        {showThresholds(item.thresholds, switchOn) ? (
          <div className="border-l-2 border-muted pl-3">{renderThresholds(item.thresholds, disabled)}</div>
        ) : null}
        {item.notes ? (
          <div className="space-y-3 border-l-2 border-muted pl-3">
            {item.notes.map((note) => (
              <div key={note.titleKey} className="space-y-2">
                <div>
                  <div className="text-xs font-semibold">{ts(note.titleKey)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{ts(note.hintKey)}</div>
                </div>
                {showThresholds(note.thresholds, switchOn) ? renderThresholds(note.thresholds, disabled) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const cardClass = "mb-3 break-inside-avoid rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4"

  if (loading) return (
    <div className="space-y-6">
      <PageDescription icon={Settings} title={t("mtmSettings")} description={ts("subtitle")} />
      <div className="animate-pulse grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-56 bg-muted rounded-lg" />)}</div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <PageDescription icon={Settings} title={t("mtmSettings")} description={ts("subtitle")} />
        <HelpButton slug="mtm-settings" variant="label" />
      </div>

      <RouteTargetTypeSettings
        value={settings.routeTargetTypes}
        onChange={(value) => updateSetting("routeTargetTypes", value)}
      />

      {/* Masonry via CSS columns: cards of different heights pack without the
          empty hole a two-column grid left next to the tall cards. The page
          scrolls as one; no card has its own scroll. */}
      <div className="columns-1 gap-3 lg:columns-2">
        {settingGroups.map((group) => {
          const GroupIcon = group.icon
          return (
            <section key={group.titleKey} data-settings-group={group.titleKey} className={cardClass}>
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <GroupIcon className="h-4 w-4 text-muted-foreground" /> {ts(group.titleKey)}
              </h3>
              <div className="space-y-4">{group.items.map(renderItem)}</div>
            </section>
          )
        })}
      </div>

      <details data-settings-group="groupAdvanced" className="group rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-semibold">
          <Satellite className="h-4 w-4 text-muted-foreground" /> {ts(advancedGroup.titleKey)}
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-4 px-4 pb-4">
          <p className="text-xs text-muted-foreground">{ts("hintAdvanced")}</p>
          {advancedGroup.items.map(renderItem)}
        </div>
      </details>

      {/* Hidden with field contacts; the stored value stays in `settings` and
          is never sent unless changed, so turning contacts on restores it. */}
      {settings.fieldContactsEnabled !== false ? (
        <ContactRequiredFieldSettings
          value={settings.contactRequiredFields}
          onChange={(value) => updateSetting("contactRequiredFields", value)}
        />
      ) : null}

      {/* Sticky save bar for everything above; the sections below save themselves. */}
      <div
        data-testid="mtm-settings-save-bar"
        className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-card/95 px-4 py-2 shadow-sm backdrop-blur dark:border-zinc-700"
      >
        <span role="status" aria-live="polite" className={`text-sm ${dirty ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
          {dirty ? ts("dirtyIndicator") : ts("noChanges")}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCancel} disabled={!dirty || saving}>
            <RotateCcw className="h-4 w-4 mr-1" /> {ts("cancel")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!dirty || saving} size="sm">
            <Save className="h-4 w-4 mr-1" /> {saving ? ts("saving") : ts("save")}
          </Button>
        </div>
      </div>

      <ContactDictionarySettings />
      <OrganizationAttributePackageSettings />
      <CoveragePolicyAdmin />
      <KpiPolicyAdmin />
      <ScoringFormulaSettings />
      <VisitPolicySettings key={visitPolicyEditorKey} />
    </div>
  )
}
