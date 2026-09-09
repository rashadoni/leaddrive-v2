import { Plus, type ElementType } from "lucide-react"
import { accessibleNavItems, type NavItem, type OrgNavContext } from "@/lib/nav-items"

/**
 * The three buttons under the dashboard greeting.
 *
 * They shipped hardcoded — new lead, pipeline, tasks — which is a reasonable
 * guess for a sales team and wrong for anyone else: a support-led tenant got
 * three links it never presses and no way to say so. So the set is
 * configurable, stored per organisation next to the widget config.
 *
 * A choice is a plain href. Everything else (label, icon, whether the user may
 * see it at all) is resolved from the navigation at render time, so an action
 * pointing at a module a tenant later loses simply disappears instead of
 * rendering a dead button.
 */
export const MAX_DASHBOARD_QUICK_ACTIONS = 4

/**
 * Creating a lead is not a navigation destination — it is the list plus a
 * query the leads page reads to open its form. It is offered alongside the
 * nav items because "add the thing" is the most common first action, and
 * because it is what the hardcoded set led with.
 */
export const NEW_LEAD_QUICK_ACTION = {
  href: "/leads?new=1",
  /** Key under the `dashboard` namespace, not `nav`. */
  labelKey: "welcome.newLead",
  icon: Plus as ElementType,
  /** Requires the module the leads page belongs to. */
  navHref: "/leads",
} as const

export const DEFAULT_DASHBOARD_QUICK_ACTIONS: readonly string[] = [
  NEW_LEAD_QUICK_ACTION.href,
  "/deals",
  "/boards",
]

/**
 * What a stored setting means. `null`/`undefined` in the organisation's
 * settings is "this tenant never chose", which takes the defaults; a stored
 * list — including an empty one — is the tenant's choice and is honoured.
 */
export function storedQuickActionHrefs(stored: unknown): string[] {
  if (stored == null) return [...DEFAULT_DASHBOARD_QUICK_ACTIONS]
  return normalizeQuickActionHrefs(stored)
}

export type ResolvedQuickAction = {
  href: string
  icon: ElementType
  /** Which next-intl namespace `labelKey` belongs to. */
  labelNamespace: "dashboard" | "nav"
  labelKey: string
  /**
   * The navigation group this destination belongs to — "Sales", "Support" and
   * so on. The picker groups by it, so choosing an action means finding the
   * module first and the section inside it, the same shape as the sidebar.
   * Translated through `nav.groups.<group>`.
   */
  group: string
  /** The first action is the page's one filled button. */
  primary: boolean
}

/**
 * Keep only well-formed, in-app, non-duplicated hrefs, capped at the maximum.
 *
 * A sanitiser and nothing more: anything that is not a list of usable paths
 * sanitises to the empty list. Deciding that an absent setting means "use the
 * defaults" is policy, and it belongs at the call site that knows whether it
 * is reading storage, a request body, or a render.
 *
 * It used to fold that policy in — non-array input returned the defaults —
 * which made a save carrying `quickActions: null` overwrite a deliberately
 * empty selection with the three defaults, silently undoing the choice. That
 * is the same bug this feature exists to avoid, one trigger over.
 */
export function normalizeQuickActionHrefs(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== "string") continue
    const href = raw.trim()
    // In-app paths only: an absolute URL here would turn a dashboard button
    // into an off-site link chosen through a settings form.
    if (!href.startsWith("/") || href.startsWith("//")) continue
    if (href.length > 200) continue
    if (seen.has(href)) continue
    seen.add(href)
    out.push(href)
    if (out.length >= MAX_DASHBOARD_QUICK_ACTIONS) break
  }
  return out
}

/** Every action a given organisation and role may choose from. */
export function availableQuickActions(org: OrgNavContext): ResolvedQuickAction[] {
  const nav = accessibleNavItems(org)
  const navByHref = new Map(nav.map((item) => [item.href, item]))
  const actions: ResolvedQuickAction[] = []

  const leads = navByHref.get(NEW_LEAD_QUICK_ACTION.navHref)
  if (leads) {
    actions.push({
      href: NEW_LEAD_QUICK_ACTION.href,
      icon: NEW_LEAD_QUICK_ACTION.icon,
      labelNamespace: "dashboard",
      labelKey: NEW_LEAD_QUICK_ACTION.labelKey,
      // Sits with the leads list it creates into, so the picker keeps it where
      // someone would look for it.
      group: leads.group,
      primary: false,
    })
  }

  for (const item of nav) {
    actions.push({
      href: item.href,
      icon: item.icon,
      labelNamespace: "nav",
      labelKey: item.tKey,
      group: item.group,
      primary: false,
    })
  }

  return actions
}

/**
 * The actions to draw, in the configured order. Unknown or now-inaccessible
 * hrefs drop out silently — a tenant losing a module should lose the button,
 * not get a link into a 403.
 */
export function resolveQuickActions(
  configured: readonly string[] | null | undefined,
  org: OrgNavContext,
): ResolvedQuickAction[] {
  // `null`/`undefined` is "never configured" and takes the defaults. An empty
  // array is a decision — the settings page says so in as many words — and
  // must render no buttons rather than quietly restoring the defaults the
  // tenant just cleared.
  const hrefs = configured == null
    ? [...DEFAULT_DASHBOARD_QUICK_ACTIONS]
    : normalizeQuickActionHrefs([...configured])
  const available = new Map(availableQuickActions(org).map((action) => [action.href, action]))

  return hrefs
    .flatMap((href) => {
      const action = available.get(href)
      return action ? [action] : []
    })
    .map((action, index) => ({ ...action, primary: index === 0 }))
}

export type { NavItem, OrgNavContext }
