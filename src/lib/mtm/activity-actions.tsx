/**
 * Registry for the MTM Activity Journal (/mtm/activity).
 *
 * Maps each raw audit-log `action` code to a human presentation: a lucide icon,
 * a dark-safe colour tone, and the i18n key under `mtmActivity.action.*`. The
 * page renders localized labels + icons instead of the raw ENUM codes the audit
 * log stores. Unknown/new codes fall back to a neutral "Action" so a newly added
 * writer never crashes or shows a blank badge.
 */
import {
  Activity, AlertTriangle, Camera, CheckCircle2, Eye, Link2, ListPlus, LogIn, LogOut,
  PencilLine, RotateCcw, Route, Settings, ShieldAlert, ShieldCheck, ShoppingCart, Store,
  Trash2, UserCog, UserMinus, UserPlus, type LucideIcon,
} from "lucide-react"

import { formatDate } from "@/lib/format-date"

export type Tone =
  | "slate" | "red" | "green" | "blue" | "sky" | "purple" | "emerald" | "teal" | "amber" | "violet"

/** Badge classes per tone — light + explicit dark variants (the journal card is
 *  themeable, so `bg-*-100` alone reads wrong on dark). */
export const TONE_CLASSES: Record<Tone, string> = {
  slate:   "bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
  red:     "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  green:   "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  blue:    "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  sky:     "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  purple:  "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  teal:    "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  amber:   "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  violet:  "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
}

export interface ActionMeta { icon: LucideIcon; tone: Tone }

const META: Record<string, ActionMeta> = {
  MOBILE_LOGIN:        { icon: LogIn,         tone: "slate" },
  MOBILE_LOGIN_FAILED: { icon: ShieldAlert,   tone: "red" },
  AUTO_LINK:           { icon: Link2,         tone: "violet" },
  CHECK_IN:            { icon: LogIn,         tone: "green" },
  CHECK_IN_FORCED:     { icon: AlertTriangle, tone: "red" },
  CHECK_OUT:           { icon: LogOut,        tone: "blue" },
  VISIT_UPDATE:        { icon: PencilLine,    tone: "sky" },
  VISIT_DELETE:        { icon: Trash2,        tone: "red" },
  PHOTO_UPLOAD:        { icon: Camera,        tone: "purple" },
  PHOTO_REVIEW:        { icon: Eye,           tone: "sky" },
  PHOTO_DELETE:        { icon: Trash2,        tone: "red" },
  TASK_CREATE:         { icon: ListPlus,      tone: "emerald" },
  TASK_UPDATE:         { icon: PencilLine,    tone: "sky" },
  TASK_COMPLETE:       { icon: CheckCircle2,  tone: "teal" },
  TASK_DELETE:         { icon: Trash2,        tone: "red" },
  ROUTE_CREATE:        { icon: Route,         tone: "emerald" },
  ROUTE_UPDATE:        { icon: PencilLine,    tone: "sky" },
  ROUTE_DELETE:        { icon: Trash2,        tone: "red" },
  AGENT_CREATE:        { icon: UserPlus,      tone: "emerald" },
  AGENT_UPDATE:        { icon: UserCog,       tone: "sky" },
  AGENT_DELETE:        { icon: UserMinus,     tone: "red" },
  CUSTOMER_CREATE:     { icon: Store,         tone: "emerald" },
  CUSTOMER_UPDATE:     { icon: PencilLine,    tone: "sky" },
  CUSTOMER_DELETE:     { icon: Trash2,        tone: "red" },
  ALERT_RESOLVE:       { icon: ShieldCheck,   tone: "teal" },
  ALERT_REOPEN:        { icon: RotateCcw,     tone: "amber" },
  ALERT_DELETE:        { icon: Trash2,        tone: "red" },
  SETTINGS_UPDATE:     { icon: Settings,      tone: "slate" },
}

const FALLBACK: ActionMeta = { icon: Activity, tone: "slate" }

export function actionMeta(action: string): ActionMeta {
  return META[action] ?? FALLBACK
}

/** i18n key under `mtmActivity.action.*`; unknown codes → `action.unknown`. */
export function actionLabelKey(action: string): string {
  return `action.${action in META ? action : "unknown"}`
}

/** Compliance codes a supervisor should be able to isolate in one click:
 *  geofence bypasses and failed mobile logins. */
export const VIOLATION_ACTIONS = ["CHECK_IN_FORCED", "MOBILE_LOGIN_FAILED"] as const

/** Deep-link an audit event to its source section. Only stable, kept sections
 *  are linked (distribution sub-sections are being retired, so linking to a
 *  removed page would 404). Unknown entity → null → the row is not clickable. */
const ENTITY_ROUTES: Record<string, string> = {
  visit: "/mtm/visits",
  photo: "/mtm/photos",
  agent: "/mtm/agents",
  alert: "/mtm/alerts",
}

export function entityHref(entity: string | null | undefined): string | null {
  if (!entity) return null
  return ENTITY_ROUTES[entity.toLowerCase()] ?? null
}

/** metadataKind → i18n key for a short human note in the Details cell. */
const KIND_KEY: Record<string, string> = {
  force_checkin: "kindForceCheckin",
  login_failed: "kindLoginFailed",
  auto_link: "kindAutoLink",
  settings_change: "kindSettingsChange",
}

export function kindKey(metadataKind: string | null | undefined): string | null {
  if (!metadataKind) return null
  return KIND_KEY[metadataKind] ?? null
}

/** Relative time using the mtmActivity translator (t). */
export function relativeTime(iso: string, t: (k: string, v?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return t("relNow")
  if (min < 60) return t("relMin", { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return t("relHour", { n: h })
  const d = Math.floor(h / 24)
  return t("relDay", { n: d })
}

/** Local YYYY-MM-DD key for day grouping (viewer's timezone). */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Human day-header label: Today / Yesterday / locale date. */
export function dayLabel(iso: string, t: (k: string) => string, locale: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  if (dayKeyOf(iso) === dayKeyOf(today.toISOString())) return t("dayToday")
  if (dayKeyOf(iso) === dayKeyOf(yest.toISOString())) return t("dayYesterday")
  // Not toLocaleDateString: an ICU build without Azerbaijani data renders the
  // journal headers as "2026 M09 5" (field UX audit W-02, task C2).
  return formatDate(iso, locale, { day: "numeric", month: "long", year: "numeric" })
}
