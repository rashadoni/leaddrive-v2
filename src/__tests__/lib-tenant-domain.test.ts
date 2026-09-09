/**
 * tenant-domain helper — F-36 regression net.
 *
 * The login form and middleware both call `getOrgSubdomain(hostname)` to
 * decide whether the current URL targets a tenant. If those two diverge
 * (one accepts a subdomain the other rejects), credentials lookup and
 * route binding silently disagree — bug discovered by architect review.
 *
 * Coverage:
 *   • Plain tenant subdomain → returns slug
 *   • Reserved subdomains (api / cdn / admin / ...) → null
 *   • Base domain itself → null
 *   • Localhost / IPs → null
 *   • Custom NEXT_PUBLIC_BASE_DOMAIN override
 *   • Uppercase / mixed-case hosts (Hostname headers can arrive uppercased)
 */

import { describe, it, expect } from "vitest"
import { getOrgSubdomain, RESERVED_SUBDOMAINS } from "@/lib/tenant-domain"

describe("getOrgSubdomain", () => {
  it("returns slug for plain tenant subdomain", () => {
    expect(getOrgSubdomain("acme.leaddrivecrm.org")).toBe("acme")
    expect(getOrgSubdomain("afigroup.leaddrivecrm.org")).toBe("afigroup")
    expect(getOrgSubdomain("leaddrive.leaddrivecrm.org")).toBe("leaddrive")
  })

  it("accepts hyphenated slugs", () => {
    expect(getOrgSubdomain("acme-corp.leaddrivecrm.org")).toBe("acme-corp")
    expect(getOrgSubdomain("foo-bar-baz.leaddrivecrm.org")).toBe("foo-bar-baz")
  })

  it("rejects all reserved subdomains", () => {
    // Lock the set — if a future PR adds api/cdn to one place and forgets
    // the other, this catches the drift.
    expect(RESERVED_SUBDOMAINS.has("app")).toBe(true)
    expect(RESERVED_SUBDOMAINS.has("admin")).toBe(true)
    expect(RESERVED_SUBDOMAINS.has("api")).toBe(true)
    expect(RESERVED_SUBDOMAINS.has("www")).toBe(true)
    expect(RESERVED_SUBDOMAINS.has("cdn")).toBe(true)

    for (const reserved of RESERVED_SUBDOMAINS) {
      expect(getOrgSubdomain(`${reserved}.leaddrivecrm.org`)).toBe(null)
    }
  })

  it("returns null for the base domain itself", () => {
    expect(getOrgSubdomain("leaddrivecrm.org")).toBe(null)
  })

  it("returns null for localhost / IPs / multi-label slugs", () => {
    expect(getOrgSubdomain("localhost")).toBe(null)
    expect(getOrgSubdomain("127.0.0.1")).toBe(null)
    expect(getOrgSubdomain("192.168.1.10")).toBe(null)
    // Multi-label subdomain ("foo.bar.leaddrivecrm.org") isn't a tenant —
    // tenant pattern is exactly one label.
    expect(getOrgSubdomain("foo.bar.leaddrivecrm.org")).toBe(null)
  })

  it("respects custom NEXT_PUBLIC_BASE_DOMAIN override", () => {
    expect(getOrgSubdomain("client.example.com", "example.com")).toBe("client")
    // Same host parsed against a different base = no match
    expect(getOrgSubdomain("client.example.com", "leaddrivecrm.org")).toBe(null)
  })

  it("rejects slugs that don't match the [a-z0-9][a-z0-9-]* pattern", () => {
    // Capital letters → no match (DNS is case-insensitive on the wire but
    // the regex is anchored to lowercase; if a hostname arrives uppercased
    // we expect the caller to lowercase first).
    expect(getOrgSubdomain("ACME.leaddrivecrm.org")).toBe(null)
    // Slug starting with hyphen
    expect(getOrgSubdomain("-acme.leaddrivecrm.org")).toBe(null)
    // Numeric-only slugs are technically allowed by the regex per RFC 1035
    // (DNS resolvers accept all-digit labels) and we keep them. If we ever
    // sell purely numeric subdomains we need a separate product-level
    // uniqueness check against IP-looking strings; for now this is fine.
    expect(getOrgSubdomain("123.leaddrivecrm.org")).toBe("123")
  })

  it("strips leading dot in baseDomain config", () => {
    // Some operators write `.leaddrivecrm.org` in env; the helper should
    // normalize so both spellings work.
    expect(getOrgSubdomain("acme.leaddrivecrm.org", ".leaddrivecrm.org")).toBe("acme")
  })
})
