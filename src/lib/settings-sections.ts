/**
 * Sections of Settings an admin can hand to one person without making them an
 * admin (owner, 2026-11-11: «в разделе пользователи я не могу дать отдельно
 * доступ к параметрам. специально меняю роль на админа… сделать так, чтоб видел
 * конкретные разделы и конкретные разделы параметров»; mock-up approved with
 * «Давай»; the same day: «параметры ты не все добавил… хочу кому-то дать доступ,
 * чтоб мог подключаться к каналам, а кому-то — статистику ИИ по расходам»).
 *
 * An ALLOW list on the user row (`User.settingsSections`): empty = what the role
 * gives, which for every non-admin role is their own notifications only. One
 * tick per section; a ticked section is the person's to open and to change
 * exactly as an admin would — nothing finer, by the owner's «одна галочка».
 *
 * NOT on the list, ever: Users, Roles, Security, Billing, API keys and Field
 * permissions. Each of them hands out access itself — a person holding one could
 * make themselves an admin or read past every other rule — so a tick there would
 * be the admin role under another name.
 *
 * The catalog is the whole rule. A section names the API paths its pages call
 * (and everything under them) and the permission scopes those routes ask; a
 * request is let through for a non-admin only when its path belongs to a
 * section ticked for them AND it asks one of that section's scopes. That check
 * runs where every route's role check runs (`requireAuth`, `withRls`); routes
 * that check the admin role themselves ask `holdsSettingsSectionForPath`. The
 * page guard and the menu ask the same catalog by page path. Edge-safe: no
 * imports.
 */

export const SETTINGS_SECTION_IDS = [
  "organization",
  "workflows",
  "custom-fields",
  "dashboard-widgets",
  "channels",
  "smtp",
  "integrations",
  "custom-domains",
  "voip",
  "leaderboard",
  "call-tasks",
  "ai-automation",
  "ai-spend",
] as const
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export interface SettingsSection {
  id: SettingsSectionId
  /** `nav` message key of the section's menu entry — the label the tick shows. */
  tKey: string
  /** Page paths (and everything under them) the section opens. */
  pages: readonly string[]
  /** API paths (and everything under them) the section's pages call. */
  apis: readonly string[]
  /** Permission scopes those routes ask; a tick opens these and no other. */
  scopes: readonly string[]
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // The organization's name, logo, address (slug) and the customers' language.
  { id: "organization", tKey: "organizationSettings", pages: ["/settings/organization"], apis: ["/api/v1/settings/organization"], scopes: ["settings"] },
  // Workflows and their templates (/settings/workflows/templates is under the page path).
  { id: "workflows", tKey: "workflows", pages: ["/settings/workflows"], apis: ["/api/v1/workflows"], scopes: ["settings"] },
  { id: "custom-fields", tKey: "customFieldsSettings", pages: ["/settings/custom-fields"], apis: ["/api/v1/custom-fields"], scopes: ["settings"] },
  { id: "dashboard-widgets", tKey: "dashboardSettings", pages: ["/settings/dashboard"], apis: ["/api/v1/dashboard/widget-config"], scopes: ["settings"] },
  // Connecting WhatsApp, Telegram, e-mail, Facebook/Instagram, TikTok and SMS.
  // Not the customer-phone privacy switch on the same page: that one decides
  // what operators see of customers and stays with the admin.
  {
    id: "channels",
    tKey: "channelsNav",
    pages: ["/settings/channels"],
    apis: [
      "/api/v1/channels",
      "/api/v1/settings/telegram-bot",
      "/api/v1/whatsapp/channels",
      "/api/v1/whatsapp/notification-settings",
      "/api/v1/whatsapp/readiness",
      "/api/v1/whatsapp/templates",
      "/api/v1/whatsapp/validate",
      "/api/v1/calls/whatsapp/smoke",
      "/api/v1/social/oauth/facebook/start",
      "/api/v1/social/oauth/instagram/start",
      "/api/v1/social/oauth/tiktok/start",
      "/api/v1/social/oauth/tiktok-business/start",
      "/api/v1/social/oauth/subscribe",
      "/api/v1/social/oauth/preflight",
      "/api/v1/social/oauth/providers",
    ],
    scopes: ["settings", "inbox", "voip", "social"],
  },
  { id: "smtp", tKey: "smtp", pages: ["/settings/smtp-settings"], apis: ["/api/v1/settings/smtp"], scopes: ["settings"] },
  {
    id: "integrations",
    tKey: "integrations",
    pages: ["/settings/integrations"],
    apis: [
      "/api/v1/integrations/esign-provider",
      "/api/v1/integrations/slack",
      "/api/v1/integrations/teams",
      "/api/v1/integrations/google-calendar",
      "/api/v1/integrations/outlook-calendar",
      "/api/v1/webhooks/manage",
    ],
    scopes: ["settings", "contracts"],
  },
  { id: "custom-domains", tKey: "customDomainsSettings", pages: ["/settings/custom-domains"], apis: ["/api/v1/custom-domains"], scopes: ["settings"] },
  {
    id: "voip",
    tKey: "voip",
    pages: ["/settings/voip"],
    apis: ["/api/v1/voip/config", "/api/v1/calls/test", "/api/v1/calls/threecx/setup", "/api/v1/calls/threecx/template"],
    scopes: ["voip", "settings"],
  },
  { id: "leaderboard", tKey: "kpiArenaConfig", pages: ["/settings/leaderboard"], apis: ["/api/v1/leaderboard/config"], scopes: ["settings"] },
  { id: "call-tasks", tKey: "callTaskSettings", pages: ["/settings/call-tasks"], apis: ["/api/v1/settings/call-tasks"], scopes: ["settings"] },
  // The AI spend limits live on both AI pages, so /settings/ai-budget belongs to both sections.
  {
    id: "ai-automation",
    tKey: "aiAutomation",
    pages: ["/settings/ai-automation"],
    apis: ["/api/v1/settings/ai-advisor", "/api/v1/settings/ai-delivery", "/api/v1/settings/ai-features", "/api/v1/settings/ai-stats", "/api/v1/settings/ai-budget"],
    scopes: ["settings"],
  },
  {
    id: "ai-spend",
    tKey: "aiSpend",
    pages: ["/settings/ai-spend"],
    apis: ["/api/v1/settings/ai-spend", "/api/v1/settings/ai-keys", "/api/v1/settings/ai-budget"],
    scopes: ["settings"],
  },
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

/** Every section that owns this API path (the AI spend limits belong to two). */
export function settingsSectionsForApiPath(pathname: string): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => section.apis.some((prefix) => under(prefix, pathname)))
}

export function settingsSectionForPagePath(pathname: string): SettingsSectionId | null {
  return SETTINGS_SECTIONS.find((section) => section.pages.some((prefix) => under(prefix, pathname)))?.id ?? null
}

type Person = { role?: string | null; settingsSections?: readonly string[] | null }

/** The sections ticked for this person that own this API path (none for an admin: they hold no ticks). */
export function heldSectionsForPath(person: Person, pathname: string): SettingsSection[] {
  const held = effectiveSettingsSections(person.role, person.settingsSections)
  if (held.length === 0) return []
  return settingsSectionsForApiPath(pathname).filter((section) => held.includes(section.id))
}

/**
 * Whether a tick lets this request through where the role alone would not:
 * a path of a section the person holds, asking one of that section's scopes.
 * `export` is never opened by a tick.
 */
export function settingsGrantAllows(person: Person, pathname: string, module: string | null | undefined, action: string): boolean {
  if (!module || action === "export") return false
  return heldSectionsForPath(person, pathname).some((section) => section.scopes.includes(module))
}

/**
 * For routes that check the admin role themselves: an admin, or a person holding
 * a section this path belongs to. Never true for a reviewer.
 */
export function holdsSettingsSectionForPath(person: Person, pathname: string): boolean {
  if (person.role === "admin" || person.role === "superadmin") return true
  return heldSectionsForPath(person, pathname).length > 0
}

/** The same question from a request: its own path decides the section. */
export function holdsSettingsSectionForRequest(person: Person, req: { url: string }): boolean {
  let pathname: string
  try {
    pathname = new URL(req.url).pathname
  } catch {
    return person.role === "admin" || person.role === "superadmin"
  }
  return holdsSettingsSectionForPath(person, pathname)
}

/** Whether a tick opens this Settings page for the person. */
export function settingsGrantOpensPage(person: Person, pathname: string): boolean {
  const section = settingsSectionForPagePath(pathname)
  return !!section && effectiveSettingsSections(person.role, person.settingsSections).includes(section)
}
