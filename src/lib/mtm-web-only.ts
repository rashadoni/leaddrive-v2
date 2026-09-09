/**
 * Phase E sweep [P2]: MTM routes that are WEB-ADMIN only — the field-agent app
 * never calls them (its surface is /mtm/mobile/* + a known set of data routes).
 * A mobile JWT presented on one of these prefixes must NOT authenticate (in
 * getOrgId it falls through → null orgId → the route's withRls returns 401),
 * closing the same mobile-JWT hole Phase E closed for /mtm/leaderboard. Verified
 * web-only against the MTM app repo + each route's source (no in-handler
 * getMobileAuth/resolveMobileAuth); safe to deny mobile (the app calls none).
 *
 * DELIBERATELY EXCLUDED (they have a legitimate mobile path in the route itself,
 * so denying them in getOrgId would break a real mobile feature):
 *   - /mtm/agents (+ /agents/push-token) — agents/route.ts territory-scopes
 *     MANAGER/SUPERVISOR mobile callers via getMobileAuth; push-token resolves its
 *     own mobile auth.
 *   - /mtm/onboarding — onboarding/route.ts has a mobile-auth path.
 * If a future audit confirms the prod app never calls these, gate them per-method
 * (carve out the mobile GET) rather than blanket-denying the prefix.
 *
 * Kept in this dependency-light module (no next-auth/prisma) so it's unit-testable
 * without pulling api-auth's heavy import chain.
 */
export const MTM_WEB_ONLY_PREFIXES = [
  "/api/v1/mtm/analytics",
  "/api/v1/mtm/reports",
  "/api/v1/mtm/teams",
  "/api/v1/mtm/regions",
  "/api/v1/mtm/activity",
  "/api/v1/mtm/locations",
  "/api/v1/mtm/notifications",
]

/** True when `pathname` is an MTM route the field-agent app never calls (web-only). */
export function isMtmWebOnlyPath(pathname: string): boolean {
  return MTM_WEB_ONLY_PREFIXES.some((p) => pathname.startsWith(p))
}
