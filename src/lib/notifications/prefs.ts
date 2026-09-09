/**
 * Notification preference types and the push-decision helper — pure functions,
 * no DB, no React.
 *
 * Preference storage lives in UserPreference.data (JSON column). This module
 * only defines the shape and the shouldPush predicate used by both the
 * backend push block and the toast gate in the bell component.
 */

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
 * Note: this function does NOT check access (canNotifySection). The caller is
 * responsible for ensuring the section is accessible before calling shouldPush.
 */
export function shouldPush(
  prefs: NotificationPrefs,
  section: string,
  kind?: string
): boolean {
  const onSection = prefs[section]?.push ?? DEFAULT_SECTION_PUSH[section] ?? false
  const onKind = kind ? (prefs[section]?.types?.[kind] ?? true) : true
  return onSection && onKind
}
