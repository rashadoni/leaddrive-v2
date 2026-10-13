import { MTM_ATTENDANCE_INSTALLATION_NOTIFICATION_KIND } from "@/lib/mtm/attendance-installation-notification"
import { MTM_ATTENDANCE_RISK_NOTIFICATION_KIND } from "@/lib/mtm/attendance-risk-notification"
import { MTM_ATTENDANCE_REQUEST_NOTIFICATION_KIND } from "@/lib/mtm/attendance-request-notification"
/**
 * Notification preference types and the push-decision helper — pure functions,
 * no DB, no React.
 *
 * Preference storage lives in UserPreference.data (JSON column). This module
 * only defines the shape and the shouldPush predicate used by both the
 * backend push block and the toast gate in the bell component.
 */
import { MTM_LOCATION_REQUEST_NOTIFICATION_KIND } from "@/lib/mtm/customer-location-request-notification"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-user notification preferences keyed by section name.
 *
 * { [section]: { push: boolean; types?: Record<kind, boolean> } }
 *
 * Missing section → DEFAULT_SECTION_PUSH applies.
 * Missing kind override → defaults to true (all kinds on within the section).
 */
export type NotificationPrefs = Record<
  string,
  { push: boolean; types?: Record<string, boolean> }
>

// ---------------------------------------------------------------------------
// DEFAULT_SECTION_PUSH
// ---------------------------------------------------------------------------

/**
 * Default push setting per section when the user has no stored preference.
 *
 * true  → CRM, Support (high-signal sections; users expect immediate alerts)
 * false → everything else (lower-signal; users typically opt-in consciously)
 *
 * Sections not listed here default to false (handled in shouldPush).
 */
export const DEFAULT_SECTION_PUSH: Record<string, boolean> = {
  CRM: true,
  "Contracts Control": true,
  Support: true,
  Marketing: false,
  Finance: false,
  Analytics: false,
  Communication: false,
  VoIP: false,
  "Route & Field": false,
  "Health Cloud": false,
  "Insurance Cloud": false,
  "Public Sector": false,
  "Media Cloud": false,
  "Energy & Utilities": false,
  Settings: false,
}

// ---------------------------------------------------------------------------
// KINDS_ON_UNLESS_SWITCHED_OFF
// ---------------------------------------------------------------------------

/**
 * Kinds that do not follow their section's switch: each is on until the person
 * switches off that very kind.
 *
 * «Route & Field» is off by default — it carries order notices a manager opts
 * into. A field agent's request to move a customer's pin is not such a notice:
 * he may be standing at the customer's door, and a section nobody ever opened
 * the settings of would have swallowed it (owner, 2026-10-12: «оно должно быть
 * заметным… агент может быть рядом с клиентом, и чтоб долго не ждать»).
 */
export const KINDS_ON_UNLESS_SWITCHED_OFF: ReadonlySet<string> = new Set([
  "mtm.attendanceReminder.detected",
  MTM_LOCATION_REQUEST_NOTIFICATION_KIND,
  MTM_ATTENDANCE_REQUEST_NOTIFICATION_KIND,
  MTM_ATTENDANCE_RISK_NOTIFICATION_KIND,
  MTM_ATTENDANCE_INSTALLATION_NOTIFICATION_KIND,
])

// ---------------------------------------------------------------------------
// shouldPush
// ---------------------------------------------------------------------------

/**
 * Decides whether a notification for (section, kind?) should produce an active
 * push (browser push + in-app toast) for the given prefs.
 *
 * Logic:
 *   onSection = prefs[section]?.push ?? DEFAULT_SECTION_PUSH[section] ?? false
 *   onKind    = kind ? (prefs[section]?.types?.[kind] ?? true) : true
 *   return onSection && onKind
 *
 * A kind in KINDS_ON_UNLESS_SWITCHED_OFF answers with onKind alone.
 *
 * Note: this function does NOT check access (canNotifySection). The caller is
 * responsible for ensuring the section is accessible before calling shouldPush.
 */
export function shouldPush(
  prefs: NotificationPrefs,
  section: string,
  kind?: string
): boolean {
  const onKind = kind ? (prefs[section]?.types?.[kind] ?? true) : true
  if (kind && KINDS_ON_UNLESS_SWITCHED_OFF.has(kind)) return onKind
  const onSection = prefs[section]?.push ?? DEFAULT_SECTION_PUSH[section] ?? false
  return onSection && onKind
}
