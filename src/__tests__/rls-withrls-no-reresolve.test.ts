// Lint-gate for the RLS codemod: a route wrapped in withRls() must NOT re-call
// getOrgId(req)/getSession(req) inside its body — withRls already resolves
// {orgId, session} ONCE under bypass and passes them in. A second auth() inside
// the runWithTenant scope is the exact double-resolve that broke prod on
// 2026-06-11 (extra DB hit + empty-query risk). This test fails the build if any
// withRls route re-resolves, so the ~689-route codemod can't silently regress.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"

function walkRoutes(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkRoutes(p))
    else if (entry.name === "route.ts") out.push(p)
  }
  return out
}

describe("withRls routes must not re-resolve auth in the body (incident guard)", () => {
  const files = walkRoutes("src/app/api")
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8")
    // withRls( → getOrgId/getSession routes; withRlsAuth( → requireAuth/RBAC routes;
    // withRlsSessionAuth( → browser-session-only self-service routes;
    // withSocialMonitoringMutationFence( → withRlsAuth + clean-slate lock;
    // withMobileRls( → MTM mobile-JWT routes; withMtmRlsAuth( → explicit dual auth;
    // split-capability wrappers preserve the same one-resolve invariant.
    const usesFactory =
      src.includes("withRls(") || src.includes("withRlsAuth(") || src.includes("withRlsSessionAuth(") || src.includes("withMobileRls(") ||
      src.includes("withMobileFieldSuiteRls(") || src.includes("withMobileTenantCapabilityRls(") ||
      src.includes("withMtmRlsAuth(") || src.includes("withRouteFieldRlsAuth(") || src.includes("withRouteFieldWebRlsAuth(") ||
      src.includes("withWorkforceHrmRlsAuth(") || src.includes("withSocialMonitoringMutationFence")
    if (!usesFactory) return false
    // crude but effective: any getOrgId(req / getSession(req / requireAuth(req /
    // requireMobileAuth(req / resolveMobileAuth(req call anywhere in a factory-wrapped
    // file means the body still re-resolves auth (the import line no longer references
    // them once codemodded). The factory resolves ONCE under bypass and passes the result in.
    return /\b(getOrgId|getSession|requireAuth|requireSessionAuth|requireMobileAuth|resolveMobileAuth)\s*\(\s*req/.test(src)
  })

  it("no withRls route calls getOrgId/getSession/requireAuth(req) in its body", () => {
    expect(
      offenders,
      `these withRls routes re-resolve auth — use the passed { orgId, session } instead:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})

// Positive coverage: the re-resolve gate above only catches routes that DO use a
// factory. It can't catch a route that establishes NO context at all — which is
// exactly how mtm/mobile/auth (the login endpoint, no requireMobileAuth) slipped
// the 26-route audit. This gate fails the build if any mtm/mobile route queries
// prisma without entering an RLS scope.
describe("mtm/mobile routes must establish RLS context (positive coverage)", () => {
  const files = walkRoutes("src/app/api/v1/mtm/mobile")
  const offenders = files.filter((f) => {
    const src = readFileSync(f, "utf8")
    const usesPrisma = /from ["']@\/lib\/prisma["']|\bprisma\./.test(src)
    if (!usesPrisma) return false
    return !/withMobileRls(?:<[^>]+>)?\s*\(|withMobileFieldSuiteRls(?:<[^>]+>)?\s*\(|withMobileTenantCapabilityRls(?:<[^>]+>)?\s*\(|runWithTenant|runWithRlsBypass/.test(src)
  })
  it("every mtm/mobile route.ts using prisma wraps it (withMobileRls/runWithTenant/runWithRlsBypass)", () => {
    expect(
      offenders,
      `mtm/mobile routes querying prisma with no RLS context:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})
