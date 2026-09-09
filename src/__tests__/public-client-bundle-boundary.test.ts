import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8")

const PUBLIC_CLIENT_ENTRIES = [
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/forgot-password/page.tsx",
  "src/app/(auth)/reset-password/page.tsx",
  "src/app/(auth)/login/setup-2fa/page.tsx",
  "src/app/(auth)/login/verify-2fa/page.tsx",
  "src/app/portal/login/page.tsx",
  "src/app/portal/register/page.tsx",
  "src/app/portal/set-password/page.tsx",
  "src/app/portal/layout.tsx",
]

function resolveLocalImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(path.join(root, from)), specifier)
      : null
  if (!base) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(root, candidate)
    }
  }
  return null
}

function publicClientGraph(): Set<string> {
  const visited = new Set<string>()
  const pending = [...PUBLIC_CLIENT_ENTRIES]
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g
  while (pending.length > 0) {
    const file = pending.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    const source = read(file)
    for (const match of source.matchAll(importPattern)) {
      const imported = resolveLocalImport(file, match[1])
      if (imported && !visited.has(imported)) pending.push(imported)
    }
  }
  return visited
}

describe("public auth/portal client disclosure boundary", () => {
  it("keeps the shared UI utility graph independent from internal role constants", () => {
    const utils = read("src/lib/utils.ts")
    const currency = read("src/lib/currency.ts")

    expect(utils).toContain('from "@/lib/currency"')
    expect(utils).not.toContain('from "@/lib/constants"')
    expect(currency).not.toMatch(/\bROLES\b|superadmin|info@leaddrivecrm\.org/i)
  })

  it("has no internal RBAC module in the unauthenticated client import graph", () => {
    const graph = publicClientGraph()
    expect([...graph]).not.toContain("src/lib/constants.ts")
    expect([...graph]).not.toContain("src/lib/permissions.ts")
    expect([...graph]).not.toContain("src/lib/org-roles.ts")
    expect([...graph].map(read).join("\n")).not.toMatch(/\bSUPERADMIN\b|["']superadmin["']/)
  })

  it("scopes public auth and portal hydration messages instead of serializing the full catalog", () => {
    const layout = read("src/app/layout.tsx")
    const proxy = read("src/proxy.ts")

    expect(layout).toContain("PUBLIC_AUTH_PATHS")
    expect(layout).toContain("PUBLIC_PORTAL_PATHS")
    expect(layout).toContain('hdrs.get("x-request-pathname")')
    expect(layout).toContain("auth: messages.auth")
    expect(layout).toContain("portal: messages.portal")
    expect(layout).not.toContain("marketing: messages.marketing")
    expect(proxy).toContain('headers.set("x-request-pathname", req.nextUrl.pathname)')
    expect(proxy).toContain('"x-request-pathname"')
  })

  it("keeps the public auth/portal message subsets free of internal role identifiers", () => {
    for (const locale of ["en", "ru", "az"]) {
      const catalog = JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>
      const publicMessages = JSON.stringify({ auth: catalog.auth, portal: catalog.portal })
      expect(publicMessages).not.toMatch(/\bSUPERADMIN\b|["']superadmin["']/i)
      expect(publicMessages).not.toMatch(/"role_(?:admin|manager|sales|support|viewer|marketing|finance|hr|ticketing)"/i)
    }
  })
})
