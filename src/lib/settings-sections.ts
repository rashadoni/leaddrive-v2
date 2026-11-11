/**
 * Sections of Settings an admin can hand to one person without making them an
 * admin (owner, 2026-11-11: «в разделе пользователи я не могу дать отдельно
 * доступ к параметрам. специально меняю роль на админа… сделать так, чтоб видел
 * конкретные разделы и конкретные разделы параметров»; mock-up approved with
 * «Давай»).
 *
 * An ALLOW list on the user row (`User.settingsSections`): empty = what the role
 * gives, which for every non-admin role is their own notifications only. One
 * tick per section; a ticked section is the person's to open and to change
 * (read, write, delete) — nothing finer, by the owner's «одна галочка».
 *
 * The catalog is the whole rule, and it is deliberately short. A section is on
 * it only when everything its page sends goes to the routes listed here and
 * none of it hands out access, secrets or money: users, roles, security,
 * billing, API keys, channels (provider tokens), SMTP (a password),
 * integrations, domains, field permissions, AI keys and spend, and the
 * organization page (it renames the tenant's address) stay with the admin role.
 * AI automation is NOT here either: the same page sets the AI spend limits.
 *
 * Enforcement is by request path, at the two places every route's role check
 * runs (`requireAuth` and `withRls`): a `settings`-scoped request is let
 * through for a non-admin only when its path belongs to a section ticked for
 * them. A route under a section path that asks a different scope, or that
 * checks the admin role itself, is untouched by a tick. The page guard and the
 * menu ask the same catalog by page path. Edge-safe: no imports.
 */

export const SETTINGS_SECTION_IDS = ["workflows", "custom-fields", "dashboard-widgets", "leaderboard", "call-tasks"] as const
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export interface SettingsSection {
  id: SettingsSectionId
  /** `nav` message key of the section's menu entry — the label the tick shows. */
  tKey: string
  /** Page paths (and everything under them) the section opens. */
  pages: readonly string[]
  /** API paths (and everything under them) the section's pages call. */
  apis: readonly string[]
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // Workflows and their templates (/settings/workflows/templates is under the page path).
  { id: "workflows", tKey: "workflows", pages: ["/settings/workflows"], apis: ["/api/v1/workflows"] },
  { id: "custom-fields", tKey: "customFieldsSettings", pages: ["/settings/custom-fields"], apis: ["/api/v1/custom-fields"] },
  { id: "dashboard-widgets", tKey: "dashboardSettings", pages: ["/settings/dashboard"], apis: ["/api/v1/dashboard/widget-config"] },
  { id: "leaderboard", tKey: "kpiArenaConfig", pages: ["/settings/leaderboard"], apis: ["/api/v1/leaderboard/config"] },
  { id: "call-tasks", tKey: "callTaskSettings", pages: ["/settings/call-tasks"], apis: ["/api/v1/settings/call-tasks"] },
]

const SECTION_IDS: ReadonlySet<string> = new Set(SETTINGS_SECTION_IDS)

/**
 * Roles a tick means nothing to: the admins already have every section, and an
 * outside reviewer is refused every settings page and every write by the proxy
 * (src/lib/reviewer-access.ts) — a tick must not be a way around that.
 */
function roleTakesSettingsGrants(role: string | null | undefined): boolean {
  return !!role && role !== "admin" && role !== "superadmin" && role !== "reviewer"
}

/** Anything that is not a known section id is dropped; catalog order, no repeats. */
export function normalizeSettingsSections(value: unknown): SettingsSectionId[] {
  if (!Array.isArray(value)) return []
  const given = new Set(value.filter((id): id is string => typeof id === "string"))
  return SETTINGS_SECTION_IDS.filter((id) => given.has(id) && SECTION_IDS.has(id))
}

/** The sections this person holds by tick — none for a role a tick means nothing to. */
export function effectiveSettingsSections(role: string | null | undefined, value: unknown): SettingsSectionId[] {
  return roleTakesSettingsGrants(role) ? normalizeSettingsSections(value) : []
}

function under(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(prefix + "/")
}

export function settingsSectionForApiPath(pathname: string): SettingsSectionId | null {
  return SETTINGS_SECTIONS.find((section) => section.apis.some((prefix) => under(prefix, pathname)))?.id ?? null
}

export function settingsSectionForPagePath(pathname: string): SettingsSectionId | null {
  return SETTINGS_SECTIONS.find((section) => section.pages.some((prefix) => under(prefix, pathname)))?.id ?? null
}

/**
 * Whether a tick lets this request through where the role alone would not:
 * a `settings`-scoped read/write/delete on a path of a section the person
 * holds. Never anything else — not another scope, not export, not admin.
 */
export function settingsGrantAllows(
  person: { role?: string | null; settingsSections?: readonly string[] | null },
  pathname: string,
  module: string | null | undefined,
  action: string,
): boolean {
  if (module !== "settings") return false
  if (action !== "read" && action !== "write" && action !== "delete") return false
  const section = settingsSectionForApiPath(pathname)
  if (!section) return false
  return effectiveSettingsSections(person.role, person.settingsSections).includes(section)
}

/** Whether a tick opens this Settings page for the person. */
export function settingsGrantOpensPage(
  person: { role?: string | null; settingsSections?: readonly string[] | null },
  pathname: string,
): boolean {
  const section = settingsSectionForPagePath(pathname)
  return !!section && effectiveSettingsSections(person.role, person.settingsSections).includes(section)
}
