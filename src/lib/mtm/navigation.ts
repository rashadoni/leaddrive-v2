import type { LucideIcon } from "lucide-react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  CheckSquare,
  ClipboardList,
  FileBarChart,
  FileBadge,
  MapPin,
  Radio,
  Route,
  Settings,
  Trophy,
  UserCog,
  Users,
} from "lucide-react"

// Each member must exist in the `mtmModuleNavigation` namespace: the pill
// renders `t(labelKey)` directly, so a key the messages do not carry shows
// up as its own identifier. "plan" was renamed to "routes" in all three
// locales (task T16) — the pill said "Plan" while the page it opened, the
// breadcrumbs and the URL all said routes.
export type MtmPrimaryLabelKey = "today" | "routes" | "map" | "visits" | "results"
export type MtmToolGroupKey = "work" | "reference" | "control" | "analytics" | "administration"

export interface MtmPrimaryNavigationItem {
  href: string
  icon: LucideIcon
  labelKey: MtmPrimaryLabelKey
}

export interface MtmToolNavigationItem {
  href: string
  icon: LucideIcon
  /** Reuses the established, fully localized label in the `nav` namespace. */
  navKey: string
}

export interface MtmToolNavigationGroup {
  key: MtmToolGroupKey
  items: readonly MtmToolNavigationItem[]
}

/**
 * The five decisions people make most often in MTM, ordered as one operational
 * flow: understand today, plan, follow the field, complete visits, review the
 * result. The destinations are existing routes; this layer never creates a
 * second source of product truth.
 */
export const MTM_PRIMARY_NAVIGATION = [
  { href: "/mtm", icon: CalendarDays, labelKey: "today" },
  { href: "/mtm/routes", icon: Route, labelKey: "routes" },
  { href: "/mtm/map", icon: MapPin, labelKey: "map" },
  { href: "/mtm/visits", icon: CheckSquare, labelKey: "visits" },
  { href: "/mtm/analytics", icon: BarChart3, labelKey: "results" },
] as const satisfies readonly MtmPrimaryNavigationItem[]

/**
 * Less frequent tools stay one explicit click away instead of competing with
 * the daily flow. Every former MTM sidebar destination remains represented.
 */
export const MTM_TOOL_GROUPS = [
  {
    key: "work",
    items: [
      { href: "/mtm/tasks", icon: ClipboardList, navKey: "mtmTasks" },
      { href: "/mtm/promotions", icon: FileBadge, navKey: "mtmPromotions" },
    ],
  },
  {
    key: "reference",
    items: [
      { href: "/mtm/customers", icon: Building2, navKey: "mtmCustomers" },
      { href: "/mtm/contacts", icon: Users, navKey: "mtmContacts" },
      { href: "/mtm/agents", icon: UserCog, navKey: "mtmAgents" },
    ],
  },
  {
    key: "control",
    items: [
      { href: "/mtm/alerts", icon: AlertTriangle, navKey: "mtmAlerts" },
      { href: "/mtm/photos", icon: Camera, navKey: "mtmPhotos" },
      { href: "/mtm/operations", icon: Radio, navKey: "mtmOperations" },
    ],
  },
  {
    key: "analytics",
    items: [
      { href: "/mtm/reports", icon: FileBarChart, navKey: "mtmReports" },
      { href: "/mtm/leaderboard", icon: Trophy, navKey: "mtmLeaderboard" },
      { href: "/mtm/activity", icon: Activity, navKey: "mtmActivity" },
    ],
  },
  {
    key: "administration",
    items: [
      { href: "/mtm/settings", icon: Settings, navKey: "mtmSettings" },
    ],
  },
] as const satisfies readonly MtmToolNavigationGroup[]

export const MTM_ALL_NAVIGATION_HREFS = [
  ...MTM_PRIMARY_NAVIGATION.map((item) => item.href),
  ...MTM_TOOL_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
]

/**
 * `/mtm` is a landing page, not a prefix tab. Keeping it exact prevents the
 * old double-active state where both “Today” and the current child page looked
 * selected. Child destinations remain active on their detail routes.
 */
export function isMtmNavigationItemActive(href: string, pathname: string): boolean {
  if (href === "/mtm") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
