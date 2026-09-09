import { prisma } from "@/lib/prisma"
import {
  coerceMtmContactRequiredFields,
  MTM_CONTACT_REQUIRED_FIELD_DEFAULTS,
} from "@/lib/mtm/contact-required-fields"
import {
  coerceMtmRouteTargetTypes,
  MTM_ROUTE_TARGET_TYPE_DEFAULTS,
  type MtmRouteTargetType,
} from "@/lib/mtm/route-target-types"

// F-11: replaces scattered magic numbers in locations/route.ts and mobile/location/route.ts.
// Defaults match the historical hardcoded values so behavior is identical for orgs
// that haven't customized anything. Orgs can override per-key via /api/v1/mtm/settings.
//
// HONEST-SETTINGS contract: every key here is READ somewhere in the app — the
// settings UI renders exactly this set, and the PUT endpoint whitelists to it.
// The old decorative keys (workingHours*, alertGpsSpoofing/LateStart/MissedVisit,
// telegram*/webhook*/report*/company* from the old UI) were saved but never read;
// they were dropped, and the toggles were replaced with ones gating the alerts
// the code ACTUALLY generates (OUT_OF_ZONE, LONG_BREAK).
export const MTM_SETTING_DEFAULTS = {
  // Scheduling and date-only values across route planning and Excel reports.
  timezone: "Asia/Baku",
  // Privacy-first rollout: agents see only their own calendar unless the
  // tenant explicitly enables the separate, sanitized team-meeting feed.
  teamScheduleVisibilityEnabled: false,
  supportEmail: "",
  supportPhone: "",

  // Geofence (POST /visits)
  geofenceRadius: 100,                       // meters; per-customer override via MtmCustomer.geofenceRadius (F-22)

  // Field-status logic (/locations dashboard)
  offlineThresholdSeconds: 300,              // 5min — agent considered OFFLINE if lastSeenAt older
  locationWindowMinutes: 10,                 // window for "recent" location pick
  historyMaxAccuracyMeters: 100,             // points less accurate than this stay out of distance/stop calculations
  historyStopRadiusMeters: 50,               // max drift around the first point of a detected stop
  historyStopMinimumMinutes: 5,              // minimum dwell time before a stationary cluster becomes a stop
  lateAfterHour: 10,                         // local hour after which PLANNED routes flip to LATE
                                             // (TODO: lateAfterMinutesPastWorkingStart for finer control)

  // Route-deviation (POST /mobile/location)
  deviationThresholdMeters: 500,             // distance from polyline that triggers alert
  deviationAlertThrottleMinutes: 10,         // suppress repeated alerts within window

  // Mobile pings
  gpsInterval: 30,                           // seconds, enforced server-side (F-30)
  autoCheckoutMinutes: 120,                  // legacy key: threshold for a long-open visit alert; never auto-closes

  // Photos
  // photoRequired was `true` historically but NEVER enforced — flipping default
  // to false preserves actual behavior; orgs opt IN to enforcement explicitly.
  photoRequired: false,                      // legacy fallback when no visit policy matches
  maxPhotosPerVisit: 10,                     // photo upload rejected (422) beyond this per visit
  // Burns a visible plaque (time, agent, customer, GPS) into the bottom-right
  // corner of every field photo. Default OFF: the plaque carries a doctor's
  // name and coordinates INSIDE the image, so a photo forwarded outside the
  // CRM leaks them irreversibly. Orgs that need self-proving evidence opt in.
  // EXIF provenance is written either way and is not gated by this key.
  photoWatermarkEnabled: false,

  // Alert toggles — gate the alerts the code actually generates
  alertOutOfZone: true,                      // geofence-violation + route-deviation alerts
  alertLongBreak: true,                      // overlong-visit alerts; visits remain open until explicit completion

  // Routes Phase 1 rollout controls. These are enforced by the corresponding
  // write APIs and let a pilot organization disable a slice without a deploy.
  routeAssignmentsEnabled: true,
  // This is a tenant-wide circuit breaker. An agent additionally needs their
  // individual canSelfPublishRoutes grant before publishing their own draft.
  routeSelfPublish: false,
  // Google Maps route calculation is an explicit tenant opt-in. It still
  // fails closed unless the operator configures an allowlisted server key and
  // a finite daily cost ceiling; the setting never contains credentials.
  routeTravelEnabled: false,
  // Google Maps navigation is a separate explicit, user-triggered deeplink.
  // It does not calculate, publish, persist, or reorder a route.
  routeTravelNavigationEnabled: false,
  // Labels and catalogue filters displayed by the simple day-by-day route
  // planner. Tenants can add clinics, hospitals, stores, or other business
  // categories without changing the planner code.
  routeTargetTypes: MTM_ROUTE_TARGET_TYPE_DEFAULTS,
  // Agents may create personal follow-up tasks and recurrence definitions in
  // the field app. Server ownership checks still prevent assigning another
  // agent or editing manager-owned task content.
  taskSelfCreate: true,
  taskSelfRecurring: true,
  // Pharmacy promotion definitions, targets, and drafts remain inspectable
  // while this is false. Submit, review, and ledger posting all fail closed.
  // Enabling it is deliberately a separate tenant action after signed
  // formula/eligibility/workflow versions have been attached to the campaign.
  pharmacyPromotionPostingEnabled: false,
  // When enabled, potential/coverage is measured for doctor × agent × brand.
  // When disabled, the same workflow records a tenant-wide doctor × brand row.
  brandPotentialPerAgentEnabled: true,
  // Tenant data-quality policy for the canonical contact card. First and last
  // name remain mandatory even if an old/stale client omits them here.
  contactRequiredFields: MTM_CONTACT_REQUIRED_FIELD_DEFAULTS,
  // Additive rollout guard: existing tenants may already have weekend routes.
  // Once enabled, create/update APIs reject dates whose effective calendar day
  // does not allow route planning.
  enforceWorkCalendarForRoutes: false,
  visitPoliciesEnabled: true,
  excelImportsEnabled: true,
} as const

type WidenSetting<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T extends readonly (infer U)[]
        ? U[]
      : T

type InferredMtmSettingsShape = {
  -readonly [K in keyof typeof MTM_SETTING_DEFAULTS]: WidenSetting<typeof MTM_SETTING_DEFAULTS[K]>
}

export type MtmSettingsShape = Omit<InferredMtmSettingsShape, "routeTargetTypes"> & {
  routeTargetTypes: MtmRouteTargetType[]
}

function coerce<K extends keyof MtmSettingsShape>(
  key: K,
  raw: unknown
): MtmSettingsShape[K] {
  const fallback = MTM_SETTING_DEFAULTS[key] as MtmSettingsShape[K]
  if (raw == null) return fallback
  if (typeof fallback === "number") {
    const n = typeof raw === "string" ? Number(raw) : Number(raw)
    return (Number.isFinite(n) ? n : fallback) as MtmSettingsShape[K]
  }
  if (typeof fallback === "boolean") {
    if (typeof raw === "boolean") return raw as MtmSettingsShape[K]
    if (typeof raw === "string") return (raw === "true") as MtmSettingsShape[K]
    return fallback
  }
  if (Array.isArray(fallback)) {
    if (key === "contactRequiredFields") {
      return coerceMtmContactRequiredFields(raw) as MtmSettingsShape[K]
    }
    if (key === "routeTargetTypes") {
      return coerceMtmRouteTargetTypes(raw) as MtmSettingsShape[K]
    }
    return (Array.isArray(raw) ? raw : fallback) as MtmSettingsShape[K]
  }
  return (typeof raw === "string" ? raw : fallback) as MtmSettingsShape[K]
}

function applySetting<K extends keyof MtmSettingsShape>(
  settings: MtmSettingsShape,
  key: K,
  raw: unknown,
): void {
  settings[key] = coerce(key, raw)
}

/**
 * Load org-scoped MTM settings with sane defaults.
 * One DB round-trip (findMany) — cheap; caller-cacheable.
 */
export async function getMtmSettings(orgId: string): Promise<MtmSettingsShape> {
  const rows = await prisma.mtmSetting.findMany({
    where: { organizationId: orgId },
    select: { key: true, value: true },
  })
  const merged = { ...MTM_SETTING_DEFAULTS } as MtmSettingsShape
  for (const r of rows) {
    if (r.key in merged) {
      applySetting(merged, r.key as keyof MtmSettingsShape, r.value)
    }
  }
  return merged
}
