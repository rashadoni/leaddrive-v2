import { navItemPathname, navItems, type NavItem } from "@/lib/nav-items"

/**
 * Sections the voice assistant may navigate to.
 *
 * DERIVED FROM THE MENU, not hand-listed. The first version enumerated eleven
 * destinations by hand and shipped with `leads` missing — the owner asked for
 * it in Azerbaijani, got nothing, and reasonably suspected speech recognition.
 * The audit that followed found 142 of 152 menu entries unreachable: quotes,
 * cadences, forecast, contracts, campaigns, journeys, loyalty, complaints,
 * knowledge base, finance, projects, every field sub-page, every industry
 * module. A hand-maintained list is a list that silently rots as the app grows,
 * and the failure is invisible — the assistant simply appears not to
 * understand.
 *
 * So the allowlist is now a DENY list over the real menu. Adding a page to the
 * sidebar makes it reachable by voice; forgetting is no longer possible.
 *
 * What stays denied, and why it is a deny list rather than "everything":
 *  - /settings/**, /admin/** — these display API keys, SMTP credentials, user
 *    administration and permission grants. A voice assistant must never be the
 *    thing that puts a secret on screen, and the agent reads out text written
 *    by the outside world, so what it can be talked into is attacker-adjacent;
 *  - /billing/**, /marketplace — payment surfaces;
 *  - /loyalty/pos — the point-of-sale till, the one screen with a camera grant.
 *
 * The agent still names a KEY, never a path: the mapping lives here, so a
 * message body saying "open /settings/api-keys" has nothing to bind to.
 */
const DENY_PREFIXES = ["/admin", "/billing", "/loyalty/pos"]
const DENY_GROUP = "Settings"

const SAFE_SOCIAL_MONITORING_VIEWS = new Set([
  "overview",
  "monitors",
  "mentions",
  "replies",
  "sources",
  "scenarios",
  "subjects",
  "media",
  "reports",
  "agent",
  "legal",
])

/**
 * Denied by the MENU GROUP, not by the URL.
 *
 * The first attempt denied everything under `/settings/` and was wrong: the
 * owner counted the launcher and found CRM short by one and Sales short by six.
 * Sales pipelines, quotas, territories, lead rules, web-to-lead, task templates,
 * ticket categories, SLA policies, macros — all live under `/settings/` and all
 * are ordinary work pages the app itself files under Sales, CRM or Support. The
 * URL prefix was never the thing that made a page sensitive.
 *
 * The app already classifies these: a page in the Settings group is where
 * users, SMTP credentials, integrations, VoIP and API keys live. Using that
 * classification means the line moves with the product instead of with my guess
 * about what a path implies.
 */
function isDenied(href: string, group: string): boolean {
  if (group === DENY_GROUP) return true
  // This tab manages collection/provider behaviour. It is intentionally not a
  // spoken destination: opening configuration by voice is both surprising and
  // materially riskier than opening the read/review surfaces beside it.
  if (navItemPathname(href) === "/social-monitoring") {
    const view = new URL(href, "https://voice.invalid").searchParams.get("view")
    if (!view || !SAFE_SOCIAL_MONITORING_VIEWS.has(view)) return true
  }
  return DENY_PREFIXES.some((p) => href === p || href.startsWith(p + "/"))
}

/** `/mtm/routes` → `mtm_routes`; safe query-backed views keep their identity. */
function sectionKey(href: string): string {
  const url = new URL(href, "https://voice.invalid")
  if (url.pathname === "/social-monitoring") {
    return `social_monitoring_${url.searchParams.get("view")}`
  }
  return url.pathname.replace(/^\//, "").replace(/\//g, "_") || "dashboard"
}

function buildSections(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of navItems) {
    const href = item.href
    if (!href.startsWith("/") || isDenied(href, item.group)) continue
    const key = sectionKey(href)
    // First wins only for true duplicate destinations. Query-backed Social
    // Monitoring views have distinct keys above and therefore never collapse.
    if (!(key in out)) out[key] = href
  }
  return out
}

export const VOICE_SECTIONS: Record<string, string> = buildSections()

export const VOICE_SECTION_KEYS = Object.keys(VOICE_SECTIONS)

const NAV_ITEM_BY_SECTION = new Map<string, NavItem>()
for (const item of navItems) {
  const match = Object.entries(VOICE_SECTIONS).find(([, href]) => href === item.href)
  if (match) NAV_ITEM_BY_SECTION.set(match[0], item)
}

export function voiceSectionNavItem(section: string): NavItem | undefined {
  return NAV_ITEM_BY_SECTION.get(section)
}

export function isVoiceSection(value: unknown): value is string {
  return typeof value === "string" && value in VOICE_SECTIONS
}

export function voiceSectionPath(section: string): string {
  return VOICE_SECTIONS[section]
}

function queryMatches(destination: string, search: string): boolean {
  const expected = new URL(destination, "https://voice.invalid")
  if (!expected.search) return true
  const actual = new URLSearchParams(search)
  // Social Monitoring has two canonical workspace shapes. The all-tenant
  // menu includes scope=all, while a brand workspace intentionally replaces
  // that scope with monitoringId/subjectId. View identity is still exact and
  // must not become invisible to get_current_screen in that normal workspace.
  const brandWorkspace = expected.pathname === "/social-monitoring" && actual.has("monitoringId")
  for (const [key, value] of expected.searchParams.entries()) {
    if (brandWorkspace && key === "scope" && value === "all") continue
    if (actual.get(key) !== value) return false
  }
  return true
}

/** Resolve the current browser location, including safe query-backed views. */
export function voiceSectionFromLocation(pathname: string, search = ""): string | null {
  const actual = new URLSearchParams(search)
  // A selected-brand Social Monitoring home intentionally omits view=monitors
  // while displaying that exact workspace. Preserve its identity before the
  // normal query-backed matcher evaluates the global directory destination.
  if (pathname === "/social-monitoring" && actual.has("monitoringId") && !actual.has("view")) {
    return "social_monitoring_monitors"
  }
  let best: { section: string; length: number } | null = null
  for (const [section, destination] of Object.entries(VOICE_SECTIONS)) {
    const base = navItemPathname(destination)
    const pathMatches = pathname === base || (base !== "/" && pathname.startsWith(base + "/"))
    if (!pathMatches || !queryMatches(destination, search)) continue
    const specificity = base.length + new URL(destination, "https://voice.invalid").search.length
    if (!best || specificity > best.length) best = { section, length: specificity }
  }
  return best?.section ?? null
}

/**
 * Path for a section, narrowed to what was just said out loud.
 *
 * The filter is appended only when the section actually declares one. An
 * unknown filter is dropped rather than guessed: a query parameter the page
 * ignores yields a screen that looks filtered and is not, which is the one
 * outcome worse than opening the unfiltered list.
 */
export function voiceSectionPathFiltered(section: string, filter?: string): string {
  const base = VOICE_SECTIONS[section]
  if (!base || !filter) return base
  return base.includes("?") ? `${base}&${filter}` : `${base}?${filter}`
}
