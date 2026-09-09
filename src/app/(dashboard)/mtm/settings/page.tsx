"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { Settings, Save, Satellite, MapPin, Camera, BellRing, Flag, Clock3, LifeBuoy } from "lucide-react"
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

type SettingValue = string | number | boolean | string[] | MtmRouteTargetType[] | null | undefined

function numericSettingValue(value: SettingValue): string | number {
  return typeof value === "number" || typeof value === "string" ? value : ""
}

function stringSettingValue(value: SettingValue, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

/**
 * HONEST settings page: renders exactly the keys in MTM_SETTING_DEFAULTS —
 * every option here is read and enforced somewhere in the app. The old page
 * showed ~26 options across 7 cards (Telegram bot, webhooks, report emails,
 * company branding…) of which only 3 did anything; the rest were saved to the
 * DB and never read. Those cards are gone. Each remaining item carries a hint
 * explaining exactly what it controls.
 */
export default function MtmSettingsPage() {
  const t = useTranslations("nav")
  const ts = useTranslations("mtmSettingsPage")
  const [settings, setSettings] = useState<Record<string, SettingValue>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/v1/mtm/settings")
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.success) {
          toast.error(`Failed to load settings: ${body?.error || r.statusText}`)
          return
        }
        setSettings(body.data)
      })
      .catch((e) => toast.error(`Failed to load settings: ${e instanceof Error ? e.message : "Network error"}`))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/v1/mtm/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(`Failed to save settings: ${body?.error || res.statusText}`)
      } else {
        toast.success(ts("savedToast"))
      }
    } catch (e) {
      toast.error(`Failed to save settings: ${e instanceof Error ? e.message : "Network error"}`)
    }
    setSaving(false)
  }

  const updateSetting = (key: string, value: SettingValue) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  // Groups carry i18n KEYS — labels/hints resolved via ts() at render time.
  // Every key maps 1:1 to MTM_SETTING_DEFAULTS (the API whitelists to it).
  const settingGroups = [
    {
      titleKey: "groupScheduling",
      icon: Clock3,
      items: [
        { key: "timezone", labelKey: "lblTimezone", hintKey: "hintTimezone", type: "timezone" },
        { key: "teamScheduleVisibilityEnabled", labelKey: "lblTeamScheduleVisibility", hintKey: "hintTeamScheduleVisibility", type: "boolean" },
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
      titleKey: "groupGps",
      icon: Satellite,
      items: [
        { key: "gpsInterval", labelKey: "lblGpsInterval", hintKey: "hintGpsInterval", type: "number" },
        { key: "offlineThresholdSeconds", labelKey: "lblOfflineThreshold", hintKey: "hintOfflineThreshold", type: "number" },
        { key: "locationWindowMinutes", labelKey: "lblLocationWindow", hintKey: "hintLocationWindow", type: "number" },
        { key: "historyMaxAccuracyMeters", labelKey: "lblHistoryAccuracy", hintKey: "hintHistoryAccuracy", type: "number" },
        { key: "historyStopRadiusMeters", labelKey: "lblHistoryStopRadius", hintKey: "hintHistoryStopRadius", type: "number" },
        { key: "historyStopMinimumMinutes", labelKey: "lblHistoryStopMinimum", hintKey: "hintHistoryStopMinimum", type: "number" },
      ],
    },
    {
      titleKey: "groupGeofence",
      icon: MapPin,
      items: [
        { key: "geofenceRadius", labelKey: "lblGeofenceRadius", hintKey: "hintGeofenceRadius", type: "number" },
        { key: "deviationThresholdMeters", labelKey: "lblDeviationThreshold", hintKey: "hintDeviationThreshold", type: "number" },
        { key: "deviationAlertThrottleMinutes", labelKey: "lblDeviationThrottle", hintKey: "hintDeviationThrottle", type: "number" },
      ],
    },
    {
      titleKey: "groupVisits",
      icon: Camera,
      items: [
        { key: "photoRequired", labelKey: "lblPhotoRequired", hintKey: "hintPhotoRequired", type: "boolean" },
        { key: "maxPhotosPerVisit", labelKey: "lblMaxPhotosPerVisit", hintKey: "hintMaxPhotos", type: "number" },
        { key: "photoWatermarkEnabled", labelKey: "lblPhotoWatermark", hintKey: "hintPhotoWatermark", type: "boolean" },
        { key: "autoCheckoutMinutes", labelKey: "lblAutoCheckoutMinutes", hintKey: "hintAutoCheckout", type: "number" },
      ],
    },
    {
      titleKey: "groupAlerts",
      icon: BellRing,
      items: [
        { key: "alertOutOfZone", labelKey: "lblAlertOutOfZone", hintKey: "hintAlertOutOfZone", type: "boolean" },
        { key: "alertLongBreak", labelKey: "lblAlertLongBreak", hintKey: "hintAlertLongBreak", type: "boolean" },
        { key: "lateAfterHour", labelKey: "lblLateAfterHour", hintKey: "hintLateAfterHour", type: "number" },
      ],
    },
    {
      titleKey: "groupRollout",
      icon: Flag,
      items: [
        { key: "routeAssignmentsEnabled", labelKey: "lblRouteAssignments", hintKey: "hintRouteAssignments", type: "boolean" },
        { key: "routeSelfPublish", labelKey: "lblRouteSelfPublish", hintKey: "hintRouteSelfPublish", type: "boolean" },
        { key: "routeTravelEnabled", labelKey: "lblRouteTravel", hintKey: "hintRouteTravel", type: "boolean" },
        { key: "routeTravelNavigationEnabled", labelKey: "lblRouteTravelNavigation", hintKey: "hintRouteTravelNavigation", type: "boolean" },
        { key: "taskSelfCreate", labelKey: "lblTaskSelfCreate", hintKey: "hintTaskSelfCreate", type: "boolean" },
        { key: "taskSelfRecurring", labelKey: "lblTaskSelfRecurring", hintKey: "hintTaskSelfRecurring", type: "boolean" },
        { key: "brandPotentialPerAgentEnabled", labelKey: "lblBrandPotentialPerAgent", hintKey: "hintBrandPotentialPerAgent", type: "boolean" },
        { key: "enforceWorkCalendarForRoutes", labelKey: "lblEnforceWorkCalendar", hintKey: "hintEnforceWorkCalendar", type: "boolean" },
        { key: "visitPoliciesEnabled", labelKey: "lblVisitPolicies", hintKey: "hintVisitPolicies", type: "boolean" },
        { key: "excelImportsEnabled", labelKey: "lblExcelImports", hintKey: "hintExcelImports", type: "boolean" },
      ],
    },
  ]

  if (loading) return (
    <div className="space-y-6">
      <PageDescription icon={Settings} title={t("mtmSettings")} description={ts("subtitle")} />
      <div className="animate-pulse grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-56 bg-muted rounded-lg" />)}</div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={Settings} title={t("mtmSettings")} description={ts("subtitle")} />
          <HelpButton slug="mtm-settings" variant="label" />
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm">
          <Save className="h-4 w-4 mr-1" /> {saving ? ts("saving") : ts("save")}
        </Button>
      </div>

      <RouteTargetTypeSettings
        value={settings.routeTargetTypes}
        onChange={(value) => updateSetting("routeTargetTypes", value)}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {settingGroups.map((group) => {
          const GroupIcon = group.icon
          return (
            <div key={group.titleKey} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <GroupIcon className="h-4 w-4 text-muted-foreground" /> {ts(group.titleKey)}
              </h3>
              <div className="space-y-4">
                {group.items.map((item) => (
                  <div key={item.key} className={`flex items-start justify-between gap-4 ${item.type === "text" ? "flex-col sm:flex-row" : ""}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{ts(item.labelKey)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{ts(item.hintKey)}</div>
                    </div>
                    {item.type === "boolean" ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!settings[item.key]}
                        onClick={() => updateSetting(item.key, !settings[item.key])}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${settings[item.key] ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings[item.key] ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    ) : item.type === "timezone" ? (
                      <Select
                        value={stringSettingValue(settings[item.key], "Asia/Baku")}
                        onChange={(event) => updateSetting(item.key, event.target.value)}
                        className="w-52 shrink-0"
                      >
                        {COMMON_TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
                      </Select>
                    ) : item.type === "text" ? (
                      <Input
                        value={stringSettingValue(settings[item.key], "")}
                        onChange={(event) => updateSetting(item.key, event.target.value)}
                        className="w-full shrink-0 sm:w-64"
                        maxLength={item.key === "supportPhone" ? 100 : 200}
                        type={item.key === "supportEmail" ? "email" : "tel"}
                        autoComplete={item.key === "supportEmail" ? "email" : "tel"}
                      />
                    ) : (
                      <input
                        type="number"
                        value={numericSettingValue(settings[item.key])}
                        onChange={(e) => updateSetting(item.key, parseInt(e.target.value) || 0)}
                        className="w-24 shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 py-1 text-sm text-right"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <ContactRequiredFieldSettings
        value={settings.contactRequiredFields}
        onChange={(value) => updateSetting("contactRequiredFields", value)}
      />
      <ContactDictionarySettings />
      <OrganizationAttributePackageSettings />
      <CoveragePolicyAdmin />
      <KpiPolicyAdmin />
      <ScoringFormulaSettings />
      <VisitPolicySettings />
    </div>
  )
}
