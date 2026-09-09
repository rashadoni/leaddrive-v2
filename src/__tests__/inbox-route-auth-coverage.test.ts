import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROUTE_ROOT = join(process.cwd(), "src/app/api/v1/inbox")
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(absolute)
    return entry.name === "route.ts" ? [absolute] : []
  })
}

describe("inbox API authorization coverage", () => {
  const files = routeFiles(ROUTE_ROOT)

  it("keeps every GET on the explicit inbox/read RBAC guard", () => {
    let getCount = 0
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      if (!/export const GET\s*=/.test(source)) continue
      getCount += 1
      expect(source, file).toMatch(
        /export const GET\s*=\s*withRlsAuth\(\s*["']inbox["']\s*,\s*["']read["']\s*,/,
      )
    }
    expect(getCount).toBeGreaterThan(0)
  })

  it("keeps every inbox mutation browser-session-only with inbox/write RBAC", () => {
    let mutationCount = 0
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const method of HTTP_METHODS.filter((candidate) => candidate !== "GET")) {
        if (!new RegExp(`export const ${method}\\s*=`).test(source)) continue
        mutationCount += 1
        expect(source, `${file} ${method}`).toMatch(
          new RegExp(`export const ${method}\\s*=\\s*withInboxSessionWrite\\s*\\(`),
        )
      }
    }
    expect(mutationCount).toBeGreaterThan(0)
  })

  it("does not allow an unpermissioned tenant-only wrapper or inline auth escape hatch", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      expect(source, file).not.toMatch(/\bwithRls\s*\(/)
      expect(source, file).not.toMatch(/\b(getOrgId|getSession|requireAuth|requireSessionAuth)\s*\(/)
      expect(source, file).not.toMatch(/export async function (GET|POST|PUT|PATCH|DELETE)\b/)
    }
  })

  it("defines the shared mutation guard as session-only plus an independent inbox write check", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/inbox/route-auth.ts"), "utf8")
    expect(source).toContain("withRlsSessionAuth<C>")
    expect(source).toMatch(/checkPermission\(auth\.role,\s*["']inbox["'],\s*["']write["']\)/)
  })
})
