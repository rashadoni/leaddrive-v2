"use client"

import { useEffect, useMemo, useState } from "react"
import {
  isNavItemEnabled,
  isNavOrgSettingOn,
  matchNavItem,
  NAV_ORG_SETTING_KEYS,
  orgFromSession,
  type NavOrgSettingKey,
  type OrgNavContext,
} from "@/lib/nav-items"

/**
 * Organization switches from MTM settings that change what the menus show.
 * Absent = unknown (loading, no MTM, no read permission). Legacy surfaces stay
 * on; new attendance stays hidden unless its value is explicitly true.
 */
export type MtmNavOrgSettings = Partial<Record<NavOrgSettingKey, boolean>>

export const MTM_SETTINGS_CHANGED_EVENT = "leaddrive:mtm-settings-changed"

// One request per organization per page load, shared by the sidebar, the App
// Launcher, Cmd+K, Quick Access and the MTM module navigation.
const cache = new Map<string, Promise<MtmNavOrgSettings>>()

/**
 * For someone with Personnel but not Route & Field (HR): the MTM settings route
 * refuses them, and the attendance entry point answers the one switch they need.
 * 404 is «the section is off»; a refusal leaves it unknown, so the menu stays hidden.
 */
async function readPersonnelSwitch(): Promise<MtmNavOrgSettings> {
  const response = await fetch("/api/v1/mtm/attendance")
  if (response.ok) return { attendanceEnabled: true }
  return response.status === 404 ? { attendanceEnabled: false } : {}
}

function loadMtmNavOrgSettings(orgKey: string, fieldSurface: boolean): Promise<MtmNavOrgSettings> {
  const cached = cache.get(orgKey)
  if (cached) return cached
  const read = fieldSurface ? fetch("/api/v1/mtm/settings").then(async (response) => {
      if (!response.ok) return {}
      const body = await response.json().catch(() => null)
      const settings: MtmNavOrgSettings = {}
      for (const key of NAV_ORG_SETTING_KEYS) {
        const value = body?.data?.[key]
        if (typeof value === "boolean") settings[key] = value
      }
      return settings
    }) : readPersonnelSwitch()
  const request = read
    .catch(() => {
      // A network failure must not stick for the whole page lifetime.
      cache.delete(orgKey)
      return {}
    })
  cache.set(orgKey, request)
  return request
}

/** Called by the settings page after a successful save so menus update at once. */
export function notifyMtmSettingsChanged(next: MtmNavOrgSettings): void {
  cache.clear()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<MtmNavOrgSettings>(MTM_SETTINGS_CHANGED_EVENT, { detail: next }))
  }
}

function useMtmOrgSettingsState(user: unknown): { settings: MtmNavOrgSettings; ready: boolean } {
  const sessionUser = user as { organizationId?: string; role?: string } | undefined
  const orgId = sessionUser?.organizationId ?? ""
  const org = useMemo(() => orgFromSession(user), [user])
  // Only a tenant that can see a switchable MTM surface pays for the request.
  // Promotions need MTM but not Route & Field, so either item qualifies.
  const surfaceOpen = (href: string) => {
    const item = matchNavItem(href)
    return Boolean(item && isNavItemEnabled(org, item, { ignoreModuleGate: org.role === "superadmin" }))
  }
  const fieldSurface = Boolean(orgId) && ["/mtm/contacts", "/mtm/promotions"].some(surfaceOpen)
  const eligible = fieldSurface || (Boolean(orgId) && surfaceOpen("/mtm/attendance"))
  const [state, setState] = useState<{ orgId: string; settings: MtmNavOrgSettings }>({ orgId: "", settings: {} })

  useEffect(() => {
    if (!eligible) return
    let alive = true
    void loadMtmNavOrgSettings(orgId, fieldSurface).then((settings) => {
      if (alive) setState({ orgId, settings })
    })
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<MtmNavOrgSettings>).detail ?? {}
      setState((previous) => ({ orgId, settings: { ...(previous.orgId === orgId ? previous.settings : {}), ...detail } }))
    }
    window.addEventListener(MTM_SETTINGS_CHANGED_EVENT, onChanged)
    return () => {
      alive = false
      window.removeEventListener(MTM_SETTINGS_CHANGED_EVENT, onChanged)
    }
  }, [eligible, fieldSurface, orgId])

  const loaded = eligible && state.orgId === orgId
  return {
    settings: loaded ? state.settings : {},
    // Nothing to load (no organization, no Route & Field) is also a decision:
    // the dashboard shell renders pages only after the session is known.
    ready: loaded || !eligible,
  }
}

export function useMtmOrgSettings(user: unknown): MtmNavOrgSettings {
  return useMtmOrgSettingsState(user).settings
}

/**
 * Visibility of one switchable MTM feature for a page that shows its data.
 * `ready` is false until the organization switch is known, so a page can hold
 * a neutral placeholder instead of flashing the feature at a tenant that
 * turned it off. A failed read resolves to enabled — the historical behaviour.
 */
export function useMtmFeature(user: unknown, feature: NavOrgSettingKey): { enabled: boolean; ready: boolean } {
  const { settings, ready } = useMtmOrgSettingsState(user)
  return { enabled: isNavOrgSettingOn(feature, settings[feature]), ready }
}

/** Field contacts visibility — see useMtmFeature. */
export function useMtmFieldContacts(user: unknown): { enabled: boolean; ready: boolean } {
  return useMtmFeature(user, "fieldContactsEnabled")
}

/** Pharmacy promotions visibility — see useMtmFeature. */
export function useMtmPharmacyPromotions(user: unknown): { enabled: boolean; ready: boolean } {
  return useMtmFeature(user, "pharmacyPromotionsEnabled")
}

/** The nav gate context from the session plus the organization switches above. */
export function useNavOrgContext(user: unknown): OrgNavContext {
  const base = useMemo(() => orgFromSession(user), [user])
  const { fieldContactsEnabled, pharmacyPromotionsEnabled, attendanceEnabled } = useMtmOrgSettings(user)
  return useMemo(() => {
    const orgSettings: MtmNavOrgSettings = {}
    if (fieldContactsEnabled !== undefined) orgSettings.fieldContactsEnabled = fieldContactsEnabled
    if (pharmacyPromotionsEnabled !== undefined) orgSettings.pharmacyPromotionsEnabled = pharmacyPromotionsEnabled
    if (attendanceEnabled !== undefined) orgSettings.attendanceEnabled = attendanceEnabled
    return Object.keys(orgSettings).length === 0 ? base : { ...base, orgSettings }
  }, [base, fieldContactsEnabled, pharmacyPromotionsEnabled, attendanceEnabled])
}
