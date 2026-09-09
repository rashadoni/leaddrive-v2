import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string) {
  return readFileSync(path, "utf8")
}

describe("MTM Route & Field compatibility gates", () => {
  it("keeps web-only reporting surfaces on the Route & Field web boundary", () => {
    for (const [path, methods] of [
      ["src/app/api/v1/mtm/kpi/route.ts", ["GET", "POST"]],
      ["src/app/api/v1/mtm/management-reports/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/reports/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/leaderboard/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/activity/route.ts", ["GET"]],
    ] as const) {
      const route = source(path)
      expect(route).toContain('import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"')
      for (const method of methods) {
        expect(route).toContain(`export const ${method} = withRouteFieldWebRlsAuth(`)
      }
    }
  })

  it("keeps direct field execution compatibility APIs on the dual-principal Route & Field boundary", () => {
    for (const [path, methods] of [
      ["src/app/api/v1/mtm/tasks/[id]/documents/[documentId]/download/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/contacts/[id]/brand-potentials/route.ts", ["GET", "POST"]],
      ["src/app/api/v1/mtm/organizations/[id]/documents/route.ts", ["POST"]],
      ["src/app/api/v1/mtm/organizations/[id]/documents/[documentId]/download/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/photos/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/alerts/route.ts", ["GET"]],
      ["src/app/api/v1/mtm/alerts/[id]/route.ts", ["PATCH", "DELETE"]],
    ] as const) {
      const route = source(path)
      expect(route).toContain('import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"')
      for (const method of methods) {
        expect(route).toMatch(new RegExp(`export const ${method} = withRouteFieldRlsAuth(?:<[^>]+>)?\\(`))
      }
    }
  })
})
