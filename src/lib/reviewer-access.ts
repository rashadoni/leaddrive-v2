import { REVIEWER_CLOSED_SCOPES, resolveModuleFromPath, type Module } from "./permissions"

/**
 * Temporary read-only access for an outside reviewer under NDA (owner,
 * 2026-10-23: «Давай, делай доступ проверяющего по этому плану»).
 *
 * A reviewer is a person, not an API key: role `reviewer`, one
 * `ReviewerAccessGrant` row, and an end date at most 30 days out. They read
 * the sections the admin ticked and nothing else; they never write, never
 * export, and never see settings, users or the audit journal. Every API read
 * they make is written to `compliance_audit_log`, which nobody can edit.
 *
 * Pure data and functions: the Edge proxy, the Auth callbacks, the API layer
 * and client components all read this file.
 */

export { REVIEWER_ROLE, reviewerAccessOpen } from "./reviewer-grant"
export const REVIEWER_MAX_DAYS = 30

export { REVIEWER_CLOSED_SCOPES }

/**
 * API prefixes outside the module map that carry tenant administration or bulk
 * data. Unmapped paths are not role-checked by the route wrappers, so the
 * reviewer gate names them here.
 */
const CLOSED_API_PREFIXES = [
  "/api/v1/settings",
  "/api/v1/users",
  "/api/v1/audit-log",
  "/api/v1/admin",
  "/api/v1/api-keys",
  "/api/v1/reviewer-access",
  "/api/v1/integrations",
  "/api/v1/billing",
]

/** A reviewer may still read their own profile and the people pickers. */
const OPEN_API_PATHS = new Set(["/api/v1/users/me", "/api/v1/users/assignable"])

/** Any download of data in bulk: the first version has no export for a reviewer. */
const EXPORT_PATH = /(^|\/)(export|exports|export-[a-z0-9-]+|[a-z0-9-]+-export)(\/|$)/

/** Pages a reviewer never opens. */
const CLOSED_PAGE_PREFIXES = ["/settings", "/admin"]

export type ReviewerDenial = "expired" | "forbidden"

/** A page a reviewer never opens; the menu hides it, the proxy refuses it. */
export function reviewerPageClosed(pathname: string): boolean {
  return CLOSED_PAGE_PREFIXES.some((prefix) => underPrefix(pathname, prefix))
}

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * What the proxy does with one reviewer request. `null` lets it through to the
 * usual module and role checks, which still apply.
 */
export function reviewerRequestDenial(input: {
  pathname: string
  method: string
  accessUntil: string | null | undefined
  now?: number
}): ReviewerDenial | null {
  const until = input.accessUntil ? Date.parse(input.accessUntil) : Number.NaN
  if (!Number.isFinite(until) || until <= (input.now ?? Date.now())) return "expired"

  const { pathname } = input
  const method = input.method.toUpperCase()
  // Signing out must keep working; everything else is read-only.
  if (pathname.startsWith("/api/auth/")) return null
  if (method !== "GET" && method !== "HEAD") return "forbidden"

  if (pathname.startsWith("/api/")) {
    if (OPEN_API_PATHS.has(pathname)) return null
    if (CLOSED_API_PREFIXES.some((prefix) => underPrefix(pathname, prefix))) return "forbidden"
    if (EXPORT_PATH.test(pathname)) return "forbidden"
    const scope = resolveModuleFromPath(pathname)
    if (scope && REVIEWER_CLOSED_SCOPES.has(scope)) return "forbidden"
    return null
  }

  if (reviewerPageClosed(pathname)) return "forbidden"
  return null
}

/**
 * The permission scope behind an `/uploads/<subdir>/…` file, so the proxy can
 * refuse files of a section the reviewer was not given. Mirrors the upload
 * proxy's own SUBDIR_READ_MODULE; `logos` and `avatars` belong to no section.
 */
const UPLOAD_SUBDIR_SCOPE: Record<string, Module> = {
  "mtm-photos": "mtm",
  "mtm-invoices": "mtm",
  contracts: "contracts",
  "contract-images": "contracts",
  tasks: "tasks",
  tickets: "tickets",
  "email-images": "campaigns",
  "web-chat": "inbox",
  whatsapp: "inbox",
  telegram: "inbox",
  inbox: "inbox",
  "social-logos": "social",
}

export function reviewerUploadScope(pathname: string): Module | null {
  const match = /^\/uploads\/([^/]+)\//.exec(pathname)
  return match ? UPLOAD_SUBDIR_SCOPE[match[1]] ?? null : null
}

/**
 * Group-modules to hide from a reviewer: every hideable one the admin did not
 * tick. The tenant's own toggles remain the ceiling, as for any user.
 */
export function reviewerHiddenModules(allHideable: readonly string[], granted: readonly string[]): string[] {
  const keep = new Set(granted)
  return allHideable.filter((id) => !keep.has(id))
}

export type ReviewerReadKind = "list" | "record" | "file"

/** How one journal line reads: which section, and a list, a record or a file. */
export function describeReviewerRead(path: string): { scope: string | null; kind: ReviewerReadKind; recordId: string | null } {
  if (path.startsWith("/uploads/") || path.startsWith("/api/v1/uploads/")) {
    return { scope: reviewerUploadScope(path.replace(/^\/api\/v1/, "")), kind: "file", recordId: path.split("/").at(-1) ?? null }
  }
  const scope = resolveModuleFromPath(path)
  const segments = path.split("/").filter(Boolean)
  // /api/v1/<collection>/<id>[/…]: an id-like second segment is one record.
  const candidate = segments[3]
  const recordId = candidate && /^[A-Za-z0-9_-]{8,}$/.test(candidate) && !/^[a-z-]+$/.test(candidate) ? candidate : null
  return { scope, kind: recordId ? "record" : "list", recordId }
}

/** Latest allowed end date for a grant made at `now` (end of the 30th day). */
export function reviewerMaxExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REVIEWER_MAX_DAYS * 24 * 60 * 60 * 1000)
}
