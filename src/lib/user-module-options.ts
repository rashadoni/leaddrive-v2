import { isCrmCapabilityAvailable } from "./crm-product-availability"
import { navItems, type NavItem } from "./nav-items"
import {
  USER_HIDEABLE_MODULE_IDS,
  hideableIdForFieldCapability,
  type UserHideableId,
} from "./user-module-access"

/**
 * The ticks an admin sees on the user card and in the reviewer dialog, with the
 * sidebar groups and pages each one covers — DERIVED from `navItems`, so a new
 * sidebar group or page shows up in both screens without anyone remembering to
 * add it there.
 *
 * Before this, each screen named a tick after the FIRST sidebar group that
 * carried its id. Personnel («Kadr uçotu») is its own sidebar group but is
 * hidden together with Route & Field (`hideableIdForFieldCapability`), so it
 * appeared on no screen at all: the admin could not tell that ticking
 * «Marşrut & Sahə» also opens it.
 *
 * Kept out of user-module-access.ts on purpose: that file is read by the Edge
 * proxy and the Auth callbacks, and navItems pulls in the icon set.
 */

const HIDEABLE = new Set<string>(USER_HIDEABLE_MODULE_IDS)

/** The tick that hides this sidebar page from a person, or null for Settings. */
export function hideableIdForNavItem(item: NavItem): UserHideableId | null {
  const capability = item.capability ?? item.tenantCapability
  if (capability) return hideableIdForFieldCapability(capability)
  return item.module && HIDEABLE.has(item.module) ? item.module as UserHideableId : null
}

function isServed(item: NavItem): boolean {
  const capability = item.capability ?? item.tenantCapability
  return !capability || isCrmCapabilityAvailable(capability)
}

export interface UserModuleCoverage {
  /** Sidebar groups (nav `groups.*` keys), in sidebar order. */
  groups: string[]
  /** Pages (nav keys), in sidebar order. */
  pages: string[]
}

/** What each tick covers, read off the live sidebar. */
export const USER_MODULE_COVERAGE: ReadonlyMap<UserHideableId, UserModuleCoverage> = (() => {
  const coverage = new Map<UserHideableId, UserModuleCoverage>()
  for (const item of navItems) {
    const id = hideableIdForNavItem(item)
    if (!id || !isServed(item)) continue
    const entry = coverage.get(id) ?? { groups: [], pages: [] }
    if (!entry.groups.includes(item.group)) entry.groups.push(item.group)
    if (!entry.pages.includes(item.tKey)) entry.pages.push(item.tKey)
    coverage.set(id, entry)
  }
  return coverage
})()

export interface UserModuleOption extends UserModuleCoverage {
  id: UserHideableId
  label: string
  /** The pages the tick opens, translated — the hover text on the tick. */
  pagesText: string
}

/**
 * Options for the given ids, labelled with every sidebar group they cover
 * («Marşrut & Sahə · Kadr uçotu»). `translate` resolves a `nav` key.
 */
export function userModuleOptions(
  ids: readonly UserHideableId[],
  translate: (navKey: string) => string,
): UserModuleOption[] {
  return ids.filter(isCrmCapabilityAvailable).map((id) => {
    const { groups, pages } = USER_MODULE_COVERAGE.get(id) ?? { groups: [], pages: [] }
    const label = groups.length > 0 ? groups.map((group) => translate(`groups.${group}`)).join(" · ") : id
    return { id, label, groups, pages, pagesText: pages.map(translate).join(", ") }
  })
}
