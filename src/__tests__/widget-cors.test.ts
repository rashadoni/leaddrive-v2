import { describe, it, expect, vi } from "vitest"

// isOriginAllowed is pure (config + args), but the module imports prisma / rls
// helpers at the top level for buildWidgetCorsHeaders. Stub them so importing the
// module never touches the DB client.
vi.mock("@/lib/prisma", () => ({ prisma: { webChatWidget: {}, webChatSession: {} } }))
vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => fn() }))

import { isOriginAllowed } from "@/lib/widget-cors"

const WHITELIST = ["https://allowed.test"]

describe("isOriginAllowed", () => {
  it("allows a request with no Origin header (non-CORS / server-to-server)", () => {
    expect(isOriginAllowed(null, WHITELIST)).toBe(true)
  })

  it("allows the app's own domains regardless of the whitelist", () => {
    for (const origin of [
      "https://app.leaddrivecrm.org",
      "https://leaddrivecrm.org",
      "https://www.leaddrivecrm.org",
      "https://acme.leaddrivecrm.org", // tenant subdomain
    ]) {
      expect(isOriginAllowed(origin, WHITELIST)).toBe(true)
    }
  })

  it("does NOT trust a look-alike host that only ends in the brand name", () => {
    // evil-leaddrivecrm.org and leaddrivecrm.org.evil.test must not be treated as own.
    expect(isOriginAllowed("https://evilleaddrivecrm.org", WHITELIST)).toBe(false)
    expect(isOriginAllowed("https://leaddrivecrm.org.evil.test", WHITELIST)).toBe(false)
  })

  it("rejects a third-party origin absent from a non-empty whitelist", () => {
    expect(isOriginAllowed("https://evil.test", WHITELIST)).toBe(false)
  })

  it("accepts a third-party origin present in the whitelist", () => {
    expect(isOriginAllowed("https://allowed.test", WHITELIST)).toBe(true)
  })

  it("accepts any origin when the whitelist is empty (open ingest)", () => {
    expect(isOriginAllowed("https://anything.test", [])).toBe(true)
  })

  it("falls through to the whitelist for a malformed Origin (no header trust to lean on)", () => {
    expect(isOriginAllowed("not-a-url", [])).toBe(true) // empty whitelist → open
    expect(isOriginAllowed("not-a-url", WHITELIST)).toBe(false) // not in whitelist → blocked
  })
})
