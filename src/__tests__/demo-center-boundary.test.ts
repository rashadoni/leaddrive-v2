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

const PURE_DIR = "src/lib/demo-center/journey"
const PURE_ALLOWED_EXTERNAL = new Set(["@/lib/modules"])

const PUBLIC_ROUTE_DIRS = ["src/app/api/v1/public/demo-access", "src/app/api/v1/public/demo-requests"]
const PUBLIC_ROUTE_FORBIDDEN_TOKENS = [
  "@/lib/api-auth",
  "next-auth",
  "getServerSession(",
  "requireAuth(",
  "withRlsAuth(",
  "runWithTenant(",
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

  it("the journey contract stays pure", () => {
    const files = sourceFiles(PURE_DIR)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      const where = path.relative(ROOT, file)
      for (const specifier of importSpecifiers(source)) {
        const ok = specifier.startsWith("./") || specifier.startsWith("../") || PURE_ALLOWED_EXTERNAL.has(specifier)
        expect(ok, `${where} imports ${specifier}`).toBe(true)
      }
      expect(source.includes("fetch("), `${where} performs network calls`).toBe(false)
      expect(source.includes("process.env"), `${where} reads the environment`).toBe(false)
      expect(/from ["']react["']/.test(source), `${where} imports React`).toBe(false)
    }
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
