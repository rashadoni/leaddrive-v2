/**
 * Demo Center trust boundary — architectural test.
 *
 * The private demo must never receive a tenant session or call tenant data
 * routes (docs/demo-guided-journey.md, «Граница безопасности»). This test
 * reads the source files and refuses:
 *   - client demo code that imports Prisma / auth / RLS context, or that
 *     references any `/api/v1/` path other than the public demo routes;
 *   - the pure journey contract importing anything but itself and the
 *     module catalog;
 *   - public demo API routes resolving a tenant session or entering a
 *     tenant RLS context.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()

function sourceFiles(relativeDir: string): string[] {
  const dir = path.join(ROOT, relativeDir)
  const out: string[] = []
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(full)
    }
  }
  walk(dir)
  return out
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) specifiers.push(match[1] ?? match[2])
  return specifiers
}

function apiPaths(source: string): string[] {
  return Array.from(source.matchAll(/\/api\/v1\/[A-Za-z0-9/_\-$\[\]{}.]*/g), (match) => match[0])
}

const CLIENT_DIRS = ["src/components/demo-center", "src/app/demo-access"]
const CLIENT_FORBIDDEN = ["@/lib/prisma", "@/lib/api-auth", "@/lib/rls-context", "@/lib/auth", "next-auth", "@/lib/session"]
const PUBLIC_DEMO_API_PREFIX = "/api/v1/public/demo-"

/** Directories that must stay pure, with what each may import besides its
 *  own relative files. The assistant's policy and grounding are pure so they
 *  can be reasoned about and tested without a database or a model call. */
const PURE_DIRS: ReadonlyArray<{ dir: string; allowed: ReadonlySet<string> }> = [
  { dir: "src/lib/demo-center/journey", allowed: new Set(["@/lib/modules"]) },
  { dir: "src/lib/demo-center/assistant", allowed: new Set(["@/lib/demo-center/journey"]) },
]

const PUBLIC_ROUTE_DIRS = ["src/app/api/v1/public/demo-access", "src/app/api/v1/public/demo-requests"]
const PUBLIC_ROUTE_FORBIDDEN_TOKENS = [
  "@/lib/api-auth",
  "next-auth",
  "getServerSession(",
  "requireAuth(",
  "withRlsAuth(",
  "runWithTenant(",
  // Tenant CRM writes go through @/lib/demo-center/prospect-lead and nowhere
  // else, so a route cannot pick an organisation or a lead on its own.
  "@/lib/crm-commands",
  "@/lib/inbound-lead-match",
  "@/lib/sms",
  "@/lib/voice-agent",
  // The link to the internal lead is control-plane data: no public route
  // may even name it, let alone put it in a response.
  "internalLeadId",
  "internalLeadOrganizationId",
  "leadLink",
]

describe("Demo Center trust boundary", () => {
  it("client demo code never imports tenant data or auth helpers", () => {
    for (const dir of CLIENT_DIRS) {
      for (const file of sourceFiles(dir)) {
        const source = readFileSync(file, "utf8")
        for (const specifier of importSpecifiers(source)) {
          for (const forbidden of CLIENT_FORBIDDEN) {
            expect(specifier.startsWith(forbidden), `${path.relative(ROOT, file)} imports ${specifier}`).toBe(false)
          }
        }
      }
    }
  })

  it("client demo code only talks to the public demo routes", () => {
    for (const dir of CLIENT_DIRS) {
      for (const file of sourceFiles(dir)) {
        const source = readFileSync(file, "utf8")
        for (const apiPath of apiPaths(source)) {
          expect(apiPath.startsWith(PUBLIC_DEMO_API_PREFIX), `${path.relative(ROOT, file)} references ${apiPath}`).toBe(true)
        }
      }
    }
  })

  it("the journey contract and the assistant policy stay pure", () => {
    for (const { dir, allowed } of PURE_DIRS) {
      const files = sourceFiles(dir)
      expect(files.length, dir).toBeGreaterThan(0)
      for (const file of files) {
        const source = readFileSync(file, "utf8")
        const where = path.relative(ROOT, file)
        for (const specifier of importSpecifiers(source)) {
          const ok = specifier.startsWith("./") || specifier.startsWith("../") || allowed.has(specifier)
          expect(ok, `${where} imports ${specifier}`).toBe(true)
        }
        expect(source.includes("fetch("), `${where} performs network calls`).toBe(false)
        expect(source.includes("process.env"), `${where} reads the environment`).toBe(false)
        expect(/from ["']react["']/.test(source), `${where} imports React`).toBe(false)
        expect(source.includes("@/lib/prisma"), `${where} touches the database`).toBe(false)
      }
    }
  })

  it("demo code enters a tenant through one door, and the door picks the tenant itself", () => {
    // A public demo request reaches somebody's real CRM in a few places: the
    // prospect's lead, the phone code SMS, the call permission. None of them
    // may choose the organisation. There is exactly one tenant scope in all of
    // src/lib/demo-center, in sales-org.ts, and its organisation comes from
    // server configuration and nowhere else.
    // Code, not prose: the door's own comment names the call it guards.
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    const scopes = sourceFiles("src/lib/demo-center").flatMap((file) =>
      Array.from(code(readFileSync(file, "utf8")).matchAll(/runWithTenant\(/g), () => path.relative(ROOT, file)),
    )
    expect(scopes).toEqual(["src/lib/demo-center/sales-org.ts"])

    const door = code(readFileSync(path.join(ROOT, "src/lib/demo-center/sales-org.ts"), "utf8"))
    expect(door).toContain("const organizationId = await resolveDemoSalesOrganization()")
    expect(door).toContain("runWithTenant(organizationId,")
    expect(door.match(/\borganizationId\s*=(?!=)/g) ?? []).toHaveLength(1)
  })

  it("public demo routes never resolve a tenant session or enter a tenant RLS context", () => {
    for (const dir of PUBLIC_ROUTE_DIRS) {
      const files = sourceFiles(dir)
      expect(files.length, dir).toBeGreaterThan(0)
      for (const file of files) {
        const source = readFileSync(file, "utf8")
        for (const token of PUBLIC_ROUTE_FORBIDDEN_TOKENS) {
          expect(source.includes(token), `${path.relative(ROOT, file)} contains ${token}`).toBe(false)
        }
      }
    }
  })
})
