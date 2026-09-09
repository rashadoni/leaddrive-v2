import type { HelpLocale, HelpSlug } from "@/content/help/registry"
import { HELP_VIDEO_AVAILABILITY } from "@/content/help/video-availability.generated"

export type HelpVideoLocale = Extract<HelpLocale, "az" | "en" | "ru">

export interface HelpVideoEntry {
  slug: string
  routes: readonly string[]
  helpSlugs?: readonly HelpSlug[]
}

const HELP_VIDEO_BASE_PATH = process.env.NEXT_PUBLIC_HELP_VIDEO_BASE_URL ?? "/api/help-videos"
const HELP_VIDEO_ASSET_VERSION = "20260729-boards-guide"
const HELP_VIDEO_BLOCKED_LOCAL_TTS_SLUGS = new Set<string>()

const HELP_VIDEO_ENTRIES_RAW = [
  { slug: "dashboard", routes: [], helpSlugs: ["crm-dashboard"] },
  { slug: "deals", routes: ["/deals"] },
  { slug: "deal-detail", routes: ["/deals/*"] },
  { slug: "companies", routes: ["/companies"] },
  { slug: "contacts", routes: ["/contacts", "/contacts/list"], helpSlugs: ["contacts", "contacts-list"] },
  { slug: "boards", routes: ["/boards"] },
  { slug: "products", routes: ["/products"] },
  { slug: "notifications", routes: ["/notifications"] },
  { slug: "projects", routes: ["/projects"] },
  { slug: "task-templates", routes: ["/settings/task-templates"] },
  { slug: "leads", routes: ["/leads"] },
  { slug: "web-to-lead", routes: ["/settings/web-to-lead"], helpSlugs: ["web-to-lead"] },
  { slug: "lead-rules", routes: ["/settings/lead-rules"], helpSlugs: ["lead-rules"] },
  { slug: "quotes", routes: ["/quotes"] },
  { slug: "sequences", routes: ["/sequences"] },
  { slug: "forecast", routes: ["/forecast"] },
  { slug: "sales-forecast-settings", routes: ["/settings/sales-forecast"], helpSlugs: ["sales-forecast-settings"] },
  { slug: "forecast-snapshots", routes: ["/forecast/snapshots"] },
  { slug: "forecast-waterfall", routes: ["/forecast/waterfall"] },
  { slug: "forecast-velocity", routes: ["/forecast/velocity"] },
  { slug: "pipelines", routes: ["/settings/pipelines"] },
  { slug: "quotas", routes: ["/settings/quotas"] },
  { slug: "territories", routes: ["/settings/territories"] },
  { slug: "contracts", routes: ["/contracts"] },
  { slug: "contract-lifecycle", routes: ["/contracts/lifecycle"], helpSlugs: ["contracts-lifecycle"] },
  { slug: "contract-templates", routes: ["/contracts/templates"] },
  { slug: "intake-forms", routes: ["/settings/intake-forms"] },
  { slug: "contract-request", routes: ["/contracts/request"], helpSlugs: ["contracts-request"] },
  { slug: "contract-analytics", routes: ["/contracts/analytics"], helpSlugs: ["contracts-analytics"] },
  { slug: "cdp-insights", routes: ["/cdp/insights"] },
  { slug: "cdp-merge-queue", routes: ["/cdp/merge-queue"] },
  { slug: "campaigns", routes: ["/campaigns"] },
  { slug: "segments", routes: ["/segments"] },
  { slug: "loyalty-builder", routes: ["/loyalty/builder"] },
  { slug: "loyalty-dashboard", routes: ["/loyalty/dashboard"] },
  { slug: "loyalty-tiers", routes: ["/loyalty/tiers"] },
  { slug: "loyalty-earn-rules", routes: ["/loyalty/earn-rules"] },
  { slug: "loyalty-promo-codes", routes: ["/loyalty/promo-codes"] },
  { slug: "loyalty-pos", routes: ["/loyalty/pos"] },
  { slug: "email-templates", routes: ["/email-templates"] },
  { slug: "email-log", routes: ["/email-log"] },
  { slug: "attribution-models", routes: ["/attribution/models"] },
  { slug: "campaign-roi", routes: ["/campaign-roi"] },
  { slug: "ai-scoring", routes: ["/ai-scoring"] },
  { slug: "journeys", routes: ["/journeys"] },
  { slug: "events", routes: ["/events"] },
  { slug: "surveys", routes: ["/surveys"] },
  { slug: "account-engagement", routes: ["/accounts/engagement"], helpSlugs: ["account-engagement"] },
  { slug: "ai-actions", routes: ["/ai/actions"], helpSlugs: ["ai-actions"] },
  { slug: "tickets", routes: ["/tickets"] },
  {
    slug: "inbox-automation",
    routes: ["/inbox/automation"],
    helpSlugs: ["inbox-automation"],
  },
  { slug: "escalation", routes: ["/settings/escalation"], helpSlugs: ["escalation"] },
  { slug: "complaints", routes: ["/complaints"] },
  { slug: "agent-desktop", routes: ["/support/agent-desktop"] },
  { slug: "entitlements", routes: ["/support/entitlements"] },
  { slug: "skill-routing", routes: ["/support/skill-routing"] },
  { slug: "agent-calendar", routes: ["/support/calendar"] },
  { slug: "voip", routes: ["/support/voip"] },
  { slug: "voip-insights", routes: ["/voip/insights"] },
  { slug: "knowledge-base", routes: ["/knowledge-base"] },
  { slug: "sla-policies", routes: ["/settings/sla-policies"] },
  {
    slug: "whatsapp-business-calls",
    routes: ["/settings/channels/connect/whatsapp-business-calls"],
  },
  {
    slug: "channels",
    routes: ["/settings/channels/connect", "/settings/channels"],
    helpSlugs: ["channels"],
  },
  { slug: "portal-users", routes: ["/settings/portal-users"] },
  { slug: "settings-voip", routes: ["/settings/voip"] },
  { slug: "invoices", routes: ["/invoices"] },
  { slug: "subscriptions", routes: ["/billing/subscriptions"] },
  { slug: "finance", routes: ["/finance"], helpSlugs: ["finance-overview"] },
  { slug: "profitability", routes: ["/profitability"] },
  { slug: "pricing", routes: ["/pricing"] },
  { slug: "invoice-settings", routes: ["/settings/invoice-settings"] },
  { slug: "finance-notifications", routes: ["/settings/finance-notifications"] },
  { slug: "reports", routes: ["/reports"] },
  { slug: "report-builder", routes: ["/reports/builder"] },
  { slug: "ai-command-center", routes: ["/ai-command-center"] },
  { slug: "mtm-overview", routes: ["/mtm"], helpSlugs: ["mtm-overview"] },
  { slug: "mtm-map", routes: ["/mtm/map"], helpSlugs: ["mtm-map"] },
  { slug: "mtm-routes", routes: ["/mtm/routes"], helpSlugs: ["mtm-routes"] },
  { slug: "mtm-visits", routes: ["/mtm/visits"], helpSlugs: ["mtm-visits"] },
  { slug: "mtm-tasks", routes: ["/mtm/tasks"], helpSlugs: ["mtm-tasks"] },
  { slug: "mtm-customers", routes: ["/mtm/customers"], helpSlugs: ["mtm-customers"] },
  { slug: "mtm-photos", routes: ["/mtm/photos"], helpSlugs: ["mtm-photos"] },
  { slug: "mtm-alerts", routes: ["/mtm/alerts"], helpSlugs: ["mtm-alerts"] },
  { slug: "mtm-agents", routes: ["/mtm/agents"], helpSlugs: ["mtm-agents"] },
  { slug: "mtm-analytics", routes: ["/mtm/analytics"], helpSlugs: ["mtm-analytics"] },
  { slug: "mtm-leaderboard", routes: ["/mtm/leaderboard"], helpSlugs: ["mtm-leaderboard"] },
  { slug: "mtm-activity", routes: ["/mtm/activity"], helpSlugs: ["mtm-activity"] },
  { slug: "mtm-reports", routes: ["/mtm/reports"], helpSlugs: ["mtm-reports"] },
  { slug: "mtm-settings", routes: ["/mtm/settings"], helpSlugs: ["mtm-settings"] },
] as const satisfies readonly HelpVideoEntry[]

export const HELP_VIDEO_ENTRIES: readonly HelpVideoEntry[] = HELP_VIDEO_ENTRIES_RAW

const HELP_VIDEO_ENTRIES_BY_ROUTE = [...HELP_VIDEO_ENTRIES].sort((a, b) => {
  const longestA = Math.max(0, ...a.routes.map((route) => route.length))
  const longestB = Math.max(0, ...b.routes.map((route) => route.length))
  return longestB - longestA
})

const HELP_VIDEO_TITLE_OVERRIDES: Record<string, string> = {
  "account-engagement": "Account Engagement",
  "ai-command-center": "AI Command Center",
  "ai-actions": "AI Advisor",
  "ai-scoring": "AI Scoring",
  "attribution-models": "Attribution Models",
  "budget-config": "Budget Config",
  "campaign-roi": "Campaign ROI",
  "cdp-insights": "CDP Insights",
  "cdp-merge-queue": "CDP Merge Queue",
  "deal-detail": "Deal Page",
  "contract-analytics": "Contract Analytics",
  "contract-lifecycle": "Contract Lifecycle",
  "contract-request": "Contract Request",
  "contract-templates": "Contract Templates",
  "email-log": "Email Log",
  "email-templates": "Email Templates",
  "finance-notifications": "Finance Notifications",
  "forecast-snapshots": "Forecast Snapshots",
  "forecast-velocity": "Forecast Velocity",
  "forecast-waterfall": "Forecast Waterfall",
  "invoice-settings": "Invoice Settings",
  "inbox-automation": "Inbox Automation",
  "lead-rules": "Lead Rules",
  "loyalty-builder": "Loyalty Builder",
  "loyalty-dashboard": "Loyalty Dashboard",
  "loyalty-earn-rules": "Loyalty Earn Rules",
  "loyalty-pos": "Loyalty POS",
  "loyalty-promo-codes": "Loyalty Promo Codes",
  "loyalty-tiers": "Loyalty Tiers",
  "mtm-activity": "MTM Activity",
  "mtm-agents": "MTM Agents",
  "mtm-alerts": "MTM Alerts",
  "mtm-analytics": "MTM Analytics",
  "mtm-customers": "MTM Customers",
  "mtm-leaderboard": "MTM Leaderboard",
  "mtm-map": "MTM Map",
  "mtm-overview": "MTM Overview",
  "mtm-photos": "MTM Photos",
  "mtm-reports": "MTM Reports",
  "mtm-routes": "MTM Routes",
  "mtm-settings": "MTM Settings",
  "mtm-tasks": "MTM Tasks",
  "mtm-visits": "MTM Visits",
  "sales-forecast-settings": "Sales Forecast Settings",
  "settings-voip": "Settings VoIP",
  "skill-routing": "Skill Routing",
  "sla-policies": "SLA Policies",
  "voip-insights": "VoIP Insights",
  "web-to-lead": "Web to Lead",
  "whatsapp-business-calls": "WhatsApp Business Calling",
}

function versionHelpVideoAsset(src: string) {
  return `${src}?v=${HELP_VIDEO_ASSET_VERSION}`
}

export function normalizeHelpVideoLocale(raw: string): HelpVideoLocale {
  return raw === "az" || raw === "en" || raw === "ru" ? raw : "en"
}

export function getHelpVideoForPath(
  pathname: string | null,
  locale: HelpVideoLocale
): HelpVideoEntry | null {
  return resolveHelpVideoRouteEntry(pathname, (entry) => isHelpVideoAvailable(entry, locale))
}

/**
 * Route → registry entry, ignoring whether the asset was recorded. Only the
 * registry-coverage tests want this; product code must go through
 * getHelpVideoForPath so an unrecorded section never advertises a card.
 */
export function resolveHelpVideoRouteEntry(
  pathname: string | null,
  isEligible: (entry: HelpVideoEntry) => boolean = () => true
): HelpVideoEntry | null {
  if (!pathname) return null
  const cleanPath = pathname.split("?")[0]?.replace(/\/$/, "") || "/"
  if (isHelpVideoPathBlocked(cleanPath)) return null

  return (
    // Eligibility is filtered BEFORE the longest-route match so a section
    // without its own recording does not silently fall back to the broader
    // guide of a parent route (e.g. a deal page showing the deals-list video).
    HELP_VIDEO_ENTRIES_BY_ROUTE.filter(isEligible).find((entry) =>
      entry.routes.some((route) =>
        // "/base/*" matches only SUB-paths of /base (e.g. a detail page
        // /deals/<id>) but NOT /base itself — so a detail guide can differ from
        // the list guide. Longest-route-first sort makes "/deals/*" win over
        // "/deals" for /deals/<id>, while "/deals" still wins for /deals.
        route.endsWith("/*")
          ? cleanPath.startsWith(`${route.slice(0, -2)}/`)
          : cleanPath === route || cleanPath.startsWith(`${route}/`)
      )
    ) ?? null
  )
}

export function getHelpVideoForSlug(
  slug: HelpSlug | string,
  locale: HelpVideoLocale
): HelpVideoEntry | null {
  const entry =
    HELP_VIDEO_ENTRIES.find(
      (entry) => entry.slug === slug || entry.helpSlugs?.includes(slug as HelpSlug)
    ) ?? null

  return entry && isHelpVideoAvailable(entry, locale) ? entry : null
}

export function getHelpVideoAsset(entry: HelpVideoEntry, locale: HelpVideoLocale) {
  if (!isHelpVideoAvailable(entry, locale)) {
    throw new Error(`Help video ${entry.slug}.${locale} has no recorded asset`)
  }

  const encodedName = encodeURIComponent(`${entry.slug}.${locale}`)

  return {
    videoSrc: versionHelpVideoAsset(`${HELP_VIDEO_BASE_PATH}/${encodedName}.VOICE.mp4`),
    posterSrc: versionHelpVideoAsset(`${HELP_VIDEO_BASE_PATH}/${encodedName}.poster.jpg`),
  }
}

export function isHelpVideoBlockedByVoiceover(slug: string) {
  return HELP_VIDEO_BLOCKED_LOCAL_TTS_SLUGS.has(slug)
}

/**
 * A section offers a video only when the recorded asset for THIS locale really
 * ships (see video-availability.generated.ts). The registry above lists every
 * CRM section so a future recording is a drop-in, but advertising a card for a
 * slug with no file just 404s the <video> and shows "not uploaded yet" — the
 * bug this gate exists to prevent.
 */
export function isHelpVideoAvailable(entry: HelpVideoEntry, locale: HelpVideoLocale) {
  if (isHelpVideoBlockedByVoiceover(entry.slug)) return false
  return HELP_VIDEO_AVAILABILITY[entry.slug]?.includes(locale) ?? false
}

function isHelpVideoPathBlocked(pathname: string) {
  return HELP_VIDEO_ENTRIES.some(
    (entry) =>
      isHelpVideoBlockedByVoiceover(entry.slug) &&
      entry.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  )
}

export function formatHelpVideoTitle(slug: string) {
  const override = HELP_VIDEO_TITLE_OVERRIDES[slug]
  if (override) return override

  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
