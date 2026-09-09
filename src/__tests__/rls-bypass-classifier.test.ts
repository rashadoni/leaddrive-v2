// src/__tests__/rls-bypass-classifier.test.ts
// Totality guarantee for the RLS bypass inventory (spec §5/§6). Every
// cross-tenant surface must be CLASSIFIED — an unclassified surface fails CI
// with an actionable message. Mirrors the module-catalog totality discipline.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")

function walk(dir: string, filter: (f: string) => boolean, acc: string[] = []): string[] {
  if (!existsSync(join(ROOT, dir))) return acc
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name)
    if (e.isDirectory()) walk(rel, filter, acc)
    else if (filter(rel)) acc.push(rel)
  }
  return acc
}

/** Cron-shaped routes OUTSIDE /api/cron that adopt requireCronAuth. Additions require classification here. */
const EXTRA_CRON_ROUTES = [
  "src/app/api/v1/social/cron/poll-all/route.ts",
  "src/app/api/v1/journeys/process/route.ts",
]
/** Routes allowed to reference CRON_SECRET without requireCronAuth (own-secret webhooks with a CRON_SECRET env fallback). */
const CRON_SECRET_FALLBACK_ALLOWLIST = [
  "src/app/api/v1/webhooks/meeting-recap/route.ts", // x-meeting-webhook-secret primary; classified as webhook (runWithTenant)
]

describe("RLS bypass classifier (totality)", () => {
  it("every /api/cron route uses the requireCronAuth choke point", () => {
    const routes = walk("src/app/api/cron", (f) => f.endsWith("route.ts"))
    expect(routes.length).toBeGreaterThanOrEqual(30)
    const offenders = routes.filter((r) => !read(r).includes("requireCronAuth"))
    expect(offenders, `cron routes missing requireCronAuth: ${offenders.join(", ")}`).toEqual([])
  })

  it("no route outside the choke point hand-rolls CRON_SECRET", () => {
    const all = walk("src/app/api", (f) => f.endsWith("route.ts"))
    const offenders = all.filter(
      (r) =>
        !CRON_SECRET_FALLBACK_ALLOWLIST.includes(r) &&
        read(r).includes("CRON_SECRET") &&
        !read(r).includes("requireCronAuth")
    )
    expect(offenders, `routes with inline CRON_SECRET (use requireCronAuth): ${offenders.join(", ")}`).toEqual([])
  })

  it("CRON_SECRET-fallback allowlist entries exist and are webhook-classified", () => {
    for (const r of CRON_SECRET_FALLBACK_ALLOWLIST) {
      expect(existsSync(join(ROOT, r)), `${r} moved/deleted — update CRON_SECRET_FALLBACK_ALLOWLIST`).toBe(true)
      expect(read(r), `${r} must be tenant-scoped via runWithTenant`).toContain("runWithTenant")
    }
  })

  it("cron-shaped routes outside /api/cron are classified", () => {
    for (const r of EXTRA_CRON_ROUTES) {
      expect(existsSync(join(ROOT, r)), `${r} moved/deleted — update EXTRA_CRON_ROUTES`).toBe(true)
      expect(read(r), `${r} must use requireCronAuth`).toContain("requireCronAuth")
    }
  })

  it("no `new PrismaClient` under src/ outside src/lib/prisma.ts (catches future timer/route clients)", () => {
    const files = walk("src", (f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
    const offenders = files.filter((f) => f !== "src/lib/prisma.ts" && read(f).includes("new PrismaClient"))
    expect(offenders, `own PrismaClient instances bypass the RLS extension: ${offenders.join(", ")}`).toEqual([])
  })

  it("every scripts/* file with its own PrismaClient goes through scripts/_rls.mjs", () => {
    const files = walk("scripts", (f) => /\.(mjs|ts|js)$/.test(f))
    const offenders = files.filter(
      (f) => f !== "scripts/_rls.mjs" && read(f).includes("new PrismaClient") && !read(f).includes("_rls.mjs")
    )
    expect(offenders, `scripts with raw PrismaClient (import makeScriptPrisma from scripts/_rls.mjs): ${offenders.join(", ")}`).toEqual([])
  })

  it("scripts importing the app singleton wrap with runWithRlsBypass/runWithTenant", () => {
    const files = walk("scripts", (f) => /\.(mjs|ts|js)$/.test(f))
    const offenders = files.filter((f) => {
      const src = read(f)
      return /from ["'].*lib\/prisma["']/.test(src) && !/runWithRlsBypass|runWithTenant/.test(src)
    })
    expect(offenders, `singleton-importing scripts without RLS scope: ${offenders.join(", ")}`).toEqual([])
  })

  it("public surfaces that query prisma are classified (runWithTenant or runWithRlsBypass present)", () => {
    const roots = ["src/app/s", "src/app/f", "src/app/c", "src/app/embed", "src/app/(public)", "src/app/api/v1/public"]
    const files = roots.flatMap((r) => walk(r, (f) => /(page|route)\.tsx?$/.test(f)))
    const offenders = files.filter((f) => {
      const src = read(f)
      const usesPrisma = /from ["']@\/lib\/prisma["']|prisma\./.test(src)
      // The factory wrappers deliver context
      // internally — count them as classified, same as the explicit runWith* calls.
      return usesPrisma && !/runWithTenant|runWithRlsBypass|requireAuth|requireSessionAuth|getOrgId|withRls|withRlsAuth|withRlsSessionAuth|withSocialMonitoringMutationFence|withMobileRls|withMobileFieldSuiteRls|withMobileTenantCapabilityRls|withMtmRlsAuth|withRouteFieldRlsAuth|withRouteFieldWebRlsAuth|withWorkforceHrmRlsAuth/.test(src)
    })
    expect(offenders, `public surfaces querying prisma without RLS classification: ${offenders.join(", ")}`).toEqual([])
  })

  it("admin server pages with direct prisma are bypass-classified", () => {
    const files = walk("src/app/admin", (f) => f.endsWith("page.tsx"))
    const offenders = files.filter((f) => {
      const src = read(f)
      return /prisma\./.test(src) && !/runWithRlsBypass/.test(src)
    })
    expect(offenders, `admin pages with unclassified prisma: ${offenders.join(", ")}`).toEqual([])
  })

  it("webhook inbound routes are classified", () => {
    const dirs = [
      "src/app/api/v1/webhooks", "src/app/api/chat/webhook",
      "src/app/api/v1/calls/webhook", "src/app/api/v1/payment-webhooks",
    ]
    const files = dirs.flatMap((d) => walk(d, (f) => f.endsWith("route.ts")))
    const offenders = files.filter((f) => {
      const src = read(f)
      const usesPrisma = /prisma\./.test(src)
      // requireAuth/getOrgId-gated management routes are classified by the guard
      // itself (Task 6 wires enterTenantContext at every guard success path).
      // Factory-wrapped routes deliver context too.
      return usesPrisma && !/runWithTenant|runWithRlsBypass|requireAuth|requireSessionAuth|requireCronAuth|getOrgId|withRls|withRlsAuth|withRlsSessionAuth|withSocialMonitoringMutationFence|withMobileRls|withMobileFieldSuiteRls|withMobileTenantCapabilityRls|withMtmRlsAuth|withRouteFieldRlsAuth|withRouteFieldWebRlsAuth|withWorkforceHrmRlsAuth/.test(src)
    })
    expect(offenders, `webhook routes with unclassified prisma: ${offenders.join(", ")}`).toEqual([])
  })
})
