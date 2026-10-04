import { readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { isMtmApiPath, isMtmMobileApiPath } from "@/lib/mtm/mobile-api-path"

describe("versioned MTM mobile API path boundary", () => {
  it("admits v1 compatibility and only reviewed v2 mobile handlers", () => {
    expect(isMtmApiPath("/api/v1/mtm/mobile/sync/pull")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contact-create-requests")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contact-create-requests/")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/planning-targets")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contacts/contact-1")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/organizations/customer-1/")).toBe(true)
    expect(isMtmApiPath("/api/v2/contacts")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/unknown")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/unknown")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-fieldx/planning-targets")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contact-create-requests/request-1")).toBe(false)
    expect(isMtmApiPath("/api/v3/mtm/mobile/sync/routes")).toBe(false)

    expect(isMtmMobileApiPath("/api/v1/mtm/mobile/sync/pull")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/route-field/contact-create-requests")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/sync/routes")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/routes")).toBe(false)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/unknown")).toBe(false)
  })
})

describe("push registration is a mobile path", () => {
  it("lets a mobile token reach the device registry", () => {
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/device-tokens")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/route-field/device-tokens")).toBe(true)
  })

  it("keeps the allowlist exact", () => {
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/device-tokens/device-1")).toBe(false)
  })
})

describe("a client change request is a mobile path", () => {
  it("lets a mobile token reach the request on one client", () => {
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contacts/contact-1/change-requests")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/route-field/contacts/contact-1/change-requests/")).toBe(true)
  })

  it("keeps the allowlist exact", () => {
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contacts/contact-1/change-requests/request-1")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contacts/contact-1/workplaces")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/organizations/customer-1/change-requests")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contacts/a/b/change-requests")).toBe(false)
  })
})

/**
 * 2026-10-04: a new v2 mobile handler shipped with every check green and was
 * unreachable on production — the proxy admits a mobile token only on the
 * exact paths above and redirected the app's POST to /login. Nothing tied the
 * handlers on disk to that list. This does: a v2 mobile route file whose path
 * the proxy would not admit fails here, before it is deployed.
 */
describe("every v2 mobile handler is reachable through the proxy", () => {
  const root = path.resolve(process.cwd(), "src/app/api/v2/mtm/mobile")
  const routeDirs = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return routeDirs(path.join(dir, entry.name))
    return entry.name === "route.ts" ? [dir] : []
  })
  const urls = routeDirs(root).map((dir) => (
    `/api/v2/mtm/mobile/${path.relative(root, dir).split(path.sep).join("/")}`.replace(/\[[^\]]+\]/g, "sample-id")
  ))

  it("finds the handlers", () => {
    expect(urls.length).toBeGreaterThan(10)
    expect(urls).toContain("/api/v2/mtm/mobile/route-field/contacts/sample-id/change-requests")
  })

  it("admits each of them", () => {
    expect(urls.filter((url) => !isMtmMobileApiPath(url) || !isMtmApiPath(url))).toEqual([])
  })
})
