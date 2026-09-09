// Broad RLS-context coverage gate (totality). The mtm/mobile positive-coverage
// gate in rls-withrls-no-reresolve.test.ts only covers one cluster; this one
// covers ALL of src/app/api at HANDLER granularity.
//
// Rule: every HTTP method handler that queries an ORG-SCOPED prisma model (a model
// with an `organizationId` field) MUST run inside a context-DELIVERING wrapper —
// withRls/withRlsAuth/withRlsSessionAuth/withInboxSessionWrite/
// withSocialMonitoringMutationFence/withSocialConnectAuth/withMobileRls/
// withMobileFieldSuiteRls/withMobileTenantCapabilityRls/withMtmRlsAuth/
// withRouteFieldRlsAuth/withRouteFieldWebRlsAuth/withWorkforceHrmRlsAuth
// withWorkforceRlsAuth/withWorkforceSessionAuth/withWorkforceSessionAdminAuth/
// withWorkforceCompatAuth
// (HOC factories) or an explicit runWithTenant/runWithRlsBypass.
// A bare getOrgId/getSession/requireAuth RESOLVES the org but does
// NOT deliver durable context (the 2026-06-11 incident), so those are deliberately
// NOT counted as wrappers here.
//
// This is the gate that would have caught the 83 budgeting/finance/cost-model routes
// the "exhaustive" agent audit missed, AND the payables/[id] DELETE method the
// codemod itself missed (file-level checks can't see a single un-wrapped method).
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")

/** camelCase prisma-client property names of every model with an `organizationId` FIELD. */
function orgScopedModels(): string[] {
  const schema = read("prisma/schema.prisma")
  const out: string[] = []
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(schema))) {
    const name = m[1]
    const body = m[2]
    if (/^\s+organizationId\s/m.test(body)) out.push(name[0].toLowerCase() + name.slice(1))
  }
  return out
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(join(ROOT, dir))) return out
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else if (e.name === "route.ts") out.push(rel)
  }
  return out
}

const DELIVER =
  /withRls(?:<[^>]+>)?\(|withRlsAuth(?:<[^>]+>)?\(|withRlsSessionAuth(?:<[^>]+>)?\(|withInboxSessionWrite(?:<[^>]+>)?\(|withSocialMonitoringMutationFence(?:<[^>]+>)?\(|withSocialConnectAuth\(|withMobileRls(?:<[^>]+>)?\(|withMobileFieldSuiteRls(?:<[^>]+>)?\(|withMobileTenantCapabilityRls(?:<[^>]+>)?\(|withMtmRlsAuth(?:<[^>]+>)?\(|withRouteFieldRlsAuth(?:<[^>]+>)?\(|withRouteFieldWebRlsAuth(?:<[^>]+>)?\(|withWorkforceHrmRlsAuth(?:<[^>]+>)?\(|withWorkforceRlsAuth(?:<[^>]+>)?\(|withWorkforceSessionAuth(?:<[^>]+>)?\(|withWorkforceSessionAdminAuth(?:<[^>]+>)?\(|withWorkforceCompatAuth(?:<[^>]+>)?\(|runWithTenant|runWithRlsBypass/

describe("RLS context coverage (totality, per-handler)", () => {
  const models = orgScopedModels()
  const modelRe = new RegExp(`prisma\\.(${models.join("|")})\\b`)
  const routes = walk("src/app/api")
  const offenders: string[] = []

  for (const f of routes) {
    const src = read(f)
    const starts: { pos: number; method: string }[] = []
    const hre = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
    let hm: RegExpExecArray | null
    while ((hm = hre.exec(src))) starts.push({ pos: hm.index, method: hm[1] })
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].pos : src.length
      const block = src.slice(starts[i].pos, end)
      if (modelRe.test(block) && !DELIVER.test(block)) offenders.push(`${f} :: ${starts[i].method}`)
    }
  }

  it("detects a healthy set of org-scoped models (sanity)", () => {
    expect(models.length).toBeGreaterThan(300)
  })

  it("every handler querying an org-scoped model establishes RLS context", () => {
    expect(
      offenders,
      `These route handlers query an org-scoped table with NO RLS-context wrapper ` +
        `(add an approved RLS wrapper or wrap the body in runWithTenant/runWithRlsBypass):\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  // Closes the per-handler gate's blind spot (architect Q1c): a route file whose
  // org-scoped prisma lives in a module-level HELPER (outside any handler block)
  // is invisible to the per-handler scan. If such a file establishes NO context
  // anywhere, that helper fail-closes under RLS. Flag any route.ts that references
  // an org-scoped model yet contains zero context-delivering wrappers.
  const fileLevel: string[] = []
  for (const f of routes) {
    const src = read(f)
    if (modelRe.test(src) && !DELIVER.test(src)) fileLevel.push(f)
  }
  it("every route file querying an org-scoped model establishes RLS context somewhere", () => {
    expect(
      fileLevel,
      `These route files query an org-scoped table but contain NO RLS-context wrapper at all ` +
        `(often an unwrapped module-level helper — wrap it in runWithTenant/runWithRlsBypass):\n${fileLevel.join("\n")}`,
    ).toEqual([])
  })
})
