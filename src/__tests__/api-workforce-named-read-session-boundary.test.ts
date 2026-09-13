import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const namedReadRoutes = [
  "src/app/api/v1/workforce/today/route.ts",
  "src/app/api/v1/workforce/timesheet/route.ts",
]

describe("Workforce named-read session boundary", () => {
  it.each(namedReadRoutes)("keeps %s session-only", (relativePath) => {
    const source = readFileSync(resolve(relativePath), "utf8")

    expect(source).toContain('import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"')
    expect(source).toContain('export const GET = withWorkforceSessionAuth("read",')
    expect(source).not.toContain("withWorkforceRlsAuth")
  })
})
