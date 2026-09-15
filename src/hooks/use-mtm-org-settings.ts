"use client"

import { useEffect, useMemo, useState } from "react"
import {
  isNavItemEnabled,
  matchNavItem,
  orgFromSession,
  type OrgNavContext,
} from "@/lib/nav-items"

/**
 * Organization switches from MTM settings that change what the menus show.
 * Absent = unknown (loading, no MTM, no read permission) and is treated as ON
 * by every consumer, so a failed read can only ever show the historical menu.
 */
export type MtmNavOrgSettings = { fieldContactsEnabled?: boolean }

export const MTM_SETTINGS_CHANGED_EVENT = "leaddrive:mtm-settings-changed"

// One request per organization per page load, shared by the sidebar, the App
// Launcher, Cmd+K, Quick Access and the MTM module navigation.
const cache = new Map<string, Promise<MtmNavOrgSettings>>()

function loadMtmNavOrgSettings(orgKey: string): Promise<MtmNavOrgSettings> {
  const cached = cache.get(orgKey)
  if (cached) return cached
  const request = fetch("/api/v1/mtm/settings")
    .then(async (response) => {
      if (!response.ok) return {}
      const body = await response.json().catch(() => null)
      const value = body?.data?.fieldContactsEnabled
      return typeof value === "boolean" ? { fieldContactsEnabled: value } : {}
    })
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
  // Only a tenant that can see Route & Field at all pays for the request.
  const contactsItem = matchNavItem("/mtm/contacts")
  const eligible = Boolean(
    orgId && contactsItem && isNavItemEnabled(org, contactsItem, { ignoreModuleGate: org.role === "superadmin" }),
  )
  const [state, setState] = useState<{ orgId: string; settings: MtmNavOrgSettings }>({ orgId: "", settings: {} })

  useEffect(() => {
    if (!eligible) return
    let alive = true
    void loadMtmNavOrgSettings(orgId).then((settings) => {
      if (alive) setState({ orgId, settings })
    })
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<MtmNavOrgSettings>).detail ?? {}
      setState({ orgId, settings: detail })
    }
    window.addEventListener(MTM_SETTINGS_CHANGED_EVENT, onChanged)
    return () => {
      alive = false
      window.removeEventListener(MTM_SETTINGS_CHANGED_EVENT, onChanged)
    }
  }, [eligible, orgId])

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
 * Field contacts visibility for a page that shows contact data. `ready` is
 * false until the organization switch is known, so a page can hold a neutral
 * placeholder instead of flashing contacts at a tenant that turned them off.
 * A failed read resolves to enabled — the historical behaviour.
 */
export function useMtmFieldContacts(user: unknown): { enabled: boolean; ready: boolean } {
  const { settings, ready } = useMtmOrgSettingsState(user)
  return { enabled: settings.fieldContactsEnabled !== false, ready }
}

/** The nav gate context from the session plus the organization switches above. */
export function useNavOrgContext(user: unknown): OrgNavContext {
  const base = useMemo(() => orgFromSession(user), [user])
  const { fieldContactsEnabled } = useMtmOrgSettings(user)
  return useMemo(
    () => (fieldContactsEnabled === undefined ? base : { ...base, orgSettings: { fieldContactsEnabled } }),
    [base, fieldContactsEnabled],
  )
}
