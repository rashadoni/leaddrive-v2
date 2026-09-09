import { describe, expect, it } from "vitest"
import { isMtmApiPath, isMtmMobileApiPath } from "@/lib/mtm/mobile-api-path"

describe("versioned MTM mobile API path boundary", () => {
  it("admits v1 compatibility and only reviewed v2 mobile handlers", () => {
    expect(isMtmApiPath("/api/v1/mtm/mobile/sync/pull")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/planning-targets")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/contacts/contact-1")).toBe(true)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-field/organizations/customer-1/")).toBe(true)
    expect(isMtmApiPath("/api/v2/contacts")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/unknown")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/unknown")).toBe(false)
    expect(isMtmApiPath("/api/v2/mtm/mobile/route-fieldx/planning-targets")).toBe(false)
    expect(isMtmApiPath("/api/v3/mtm/mobile/sync/routes")).toBe(false)

    expect(isMtmMobileApiPath("/api/v1/mtm/mobile/sync/pull")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/sync/routes")).toBe(true)
    expect(isMtmMobileApiPath("/api/v2/mtm/routes")).toBe(false)
    expect(isMtmMobileApiPath("/api/v2/mtm/mobile/unknown")).toBe(false)
  })
})
