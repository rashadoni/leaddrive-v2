/**
 * An organization's own rights for its roles (owner, 2026-11-11: «я как админ
 * почему не могу менять роли при нажатии?» → mockup → «Да, делай»; «у админа
 * должны быть доступы»).
 *
 * The built-in rights of each role live in `ROLE_PERMISSIONS` (permissions.ts)
 * and are the same for every organization. An admin may now set, for THEIR
 * organization, another level for a role in one module scope — «Satış →
 * Kontaktlar: Tam», «Dəstək → Sövdələşmələr: Yoxdur». The setting is kept in
 * `Organization.settings.roleAccess` and only the differences are stored.
 *
 * It is enforced where every right is enforced: `checkPermission` asks
 * `currentRoleAccess()` for the organization of the request (server: the
 * tenant of the request, filled from the organization row that auth() and
 * requireAuth already read; browser: the session), so the API gate, the pages
 * and the buttons all answer the same.
 *
 * What can never be changed here:
 *  - admin / superadmin keep everything (owner: «у админа должны быть доступы»);
 *    a reviewer under NDA keeps its own read-only rules;
 *  - the scopes rights are given through — settings, users, audit — and the
 *    ones with rules of their own (meetings, the legal side of social
 *    monitoring, field MTM and HR, whose mobile tokens do not carry this).
 *
 * Edge-safe: no Node imports. The server registers its getter from
 * `role-access-server.ts`.
 */
import type { Action } from "./permissions"

export type AccessLevel = "full" | "edit" | "view" | "none"
export type RoleAccessMap = Record<string, Record<string, AccessLevel>>

export const ACCESS_LEVELS: readonly AccessLevel[] = ["full", "edit", "view", "none"]

/** Roles whose rights an organization may change. */
export const EDITABLE_ROLES = ["manager", "sales", "support", "ticketing", "viewer"] as const

/** Scopes no organization setting may touch. */
export const LOCKED_SCOPES: ReadonlySet<string> = new Set([
  "settings", "users", "audit", "bookings", "social-legal", "mtm", "workforce",
])

/** Every scope the role table shows that an organization may change. */
export const EDITABLE_SCOPES: ReadonlySet<string> = new Set([
  "companies", "contacts", "projects", "tasks", "deals", "leads", "offers", "contracts",
  "campaigns", "journeys", "segments", "events", "loyalty", "inbox", "social", "voip",
  "tickets", "kb", "invoices", "finance", "budgeting", "profitability", "pricing", "reports",
  "health", "insurance", "public-sector", "media", "energy-utilities", "ai",
])

const EDITABLE_ROLE_SET: ReadonlySet<string> = new Set(EDITABLE_ROLES)

export function isEditableCell(role: string, scope: string): boolean {
  return EDITABLE_ROLE_SET.has(role) && EDITABLE_SCOPES.has(scope) && !LOCKED_SCOPES.has(scope)
}

/**
 * The organization's setting as stored, keeping only what may be changed:
 * a known editable role, an editable scope, one of the four levels. Anything
 * else — a hand-edited row, `admin`, `settings` — is dropped, never applied.
 */
export function readRoleAccess(settings: unknown): RoleAccessMap {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).roleAccess : null
  return cleanRoleAccess(raw).map
}

/** Validation of a map an admin sends; `rejected` names what was left out. */
export function cleanRoleAccess(raw: unknown): { map: RoleAccessMap; rejected: string[] } {
  const map: RoleAccessMap = {}
  const rejected: string[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { map, rejected }
  for (const [role, scopes] of Object.entries(raw as Record<string, unknown>)) {
    if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) { rejected.push(role); continue }
    for (const [scope, level] of Object.entries(scopes as Record<string, unknown>)) {
      if (!isEditableCell(role, scope) || !ACCESS_LEVELS.includes(level as AccessLevel)) {
        rejected.push(`${role}.${scope}`)
        continue
      }
      ;(map[role] ??= {})[scope] = level as AccessLevel
    }
  }
  return { map, rejected }
}

/**
 * What a level lets a role do. Export follows the built-in rule while the role
 * may read at all: «Tam» always exports, «Redaktə» and «Baxış» export only if
 * the role exported before. `admin` (the action) is never given by a level.
 */
export function levelAllows(level: AccessLevel, action: Action, builtIn: (action: Action) => boolean): boolean {
  switch (action) {
    case "read": return level !== "none"
    case "write": return level === "full" || level === "edit"
    case "delete": return level === "full"
    case "export": return level === "full" || (level !== "none" && builtIn("export"))
    default: return builtIn(action)
  }
}

// ── where the current organization's setting comes from ───────────────────
type Getter = () => RoleAccessMap | null | undefined
const store = globalThis as unknown as { __ldRoleAccessGetter?: Getter; __ldClientRoleAccess?: RoleAccessMap | null }

/** Server: called once by role-access-server.ts. */
export function registerRoleAccessGetter(getter: Getter): void {
  store.__ldRoleAccessGetter = getter
}

/** Browser: the dashboard layout hands over the session's map before any page renders. */
export function setClientRoleAccess(map: RoleAccessMap | null | undefined): void {
  // The dashboard layout also renders on the server (SSR): a process-wide map
  // set there would leak one person's organization into another's request.
  if (typeof window === "undefined") return
  store.__ldClientRoleAccess = map ?? null
}

export function currentRoleAccess(): RoleAccessMap | null {
  const getter = store.__ldRoleAccessGetter
  if (getter) return getter() ?? null
  return store.__ldClientRoleAccess ?? null
}
