import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolveModuleFromPath } from "@/lib/permissions"

/**
 * `withRls` now authorizes as well as authenticates (see
 * `src/lib/with-rls.ts`), which closed a gap of 144 write routes that any
 * member of the organization could call whatever their role — `viewer`
 * included, though `viewer` is defined as `{"*": ["read"]}`.
 *
 * But that check is only as wide as `resolveModuleFromPath`. When it returns
 * null the check is SKIPPED, exactly as `requireAuth` skips it
 * (`if (resolvedModule)` in `src/lib/api-auth.ts`). So a write route whose path
 * is absent from `ROUTE_MODULE_MAP` is still ungated, and it looks gated —
 * which is the more dangerous state of the two.
 *
 * This gate asserts the remaining surface is zero, apart from routes that are
 * deliberately self-scoped and are named below.
 */

const WRITE_UNDER_WITH_RLS = /export const (?:POST|PUT|PATCH|DELETE) = withRls\(/
/** Routes that do their own role check inside the handler are out of scope. */
const INLINE_AUTH = /isManagerOrAbove|isAdmin|hasPermission|requireAuth|canAccess/

/**
 * Deliberately ungated, because each writes only the CALLER'S OWN row — the
 * same reasoning `resolveModuleFromPath` already applies to `/users/me`.
 * Resolving these to an org module would 403 people out of their own settings.
 *
 * This list is asserted exactly, not as a minimum: adding to it is how a route
 * that should be gated gets quietly excused, so it has to be a visible edit.
 */
const SELF_SCOPED = [
  // filters on `{ organizationId, userId }`
  "src/app/api/v1/dashboard/layout/route.ts",
  // filters on the recipient
  "src/app/api/v1/notifications/route.ts",
  // writes `{ id: session.userId }` — the caller's own 2FA
  "src/app/api/v1/auth/sms-2fa/enable/route.ts",
].sort()

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (entry === "route.ts") out.push(full)
  }
  return out
}

/** The API path Next.js serves a route file at. */
function apiPath(file: string): string {
  return (
    "/" +
    file
      .slice("src/app/".length, -"/route.ts".length)
      .replace(/\/\([^)]*\)/g, "") // route groups
      .replace(/\[\.\.\.[^\]]+\]/g, "x") // catch-all
      .replace(/\[[^\]]+\]/g, "x") // dynamic segment
  )
}

function ungatedWriteRoutes(): string[] {
  return routeFiles("src/app/api")
    .filter(file => {
      const source = readFileSync(file, "utf8")
      if (!WRITE_UNDER_WITH_RLS.test(source) || INLINE_AUTH.test(source)) return false
      return resolveModuleFromPath(apiPath(file)) === null
    })
    .sort()
}

describe("every write route under withRls resolves to a module", () => {
  it("leaves nothing ungated except the self-scoped routes", () => {
    expect(
      ungatedWriteRoutes(),
      `These accept POST/PUT/PATCH/DELETE under withRls, but their path resolves ` +
      `to no module — so the role check in withRls is skipped and any member of ` +
      `the organization can call them, "viewer" included.\n\n` +
      `Add the path to ROUTE_MODULE_MAP in src/lib/permissions.ts, under the ` +
      `module whose feature it belongs to. Only add it to SELF_SCOPED here if ` +
      `the route writes the CALLER'S OWN row and nothing else.`,
    ).toEqual(SELF_SCOPED)
  })

  // Guards the list itself: a route that stops being self-scoped, or is deleted,
  // must not linger here as a standing excuse.
  it.each(SELF_SCOPED)("%s is still present and still ungated", file => {
    const source = readFileSync(file, "utf8")
    expect(WRITE_UNDER_WITH_RLS.test(source)).toBe(true)
    expect(resolveModuleFromPath(apiPath(file))).toBeNull()
  })
})
