import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

import { filterEntityFields, stripNeverReturned } from "@/lib/field-filter"

/**
 * Finding F-32 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * `filterEntityFields` is visible-unless-configured: a column nobody set a
 * permission for is returned. That default is correct for business fields — a
 * new custom field should appear without an admin ticking a box — and wrong for
 * credential columns, which nobody configures because they are not fields
 * anyone edits. So `contacts.portalPasswordHash` and
 * `contacts.portalVerificationToken` rode out with every contact read, and the
 * PUT path returned the raw row with no filtering at all.
 *
 * The verification token is the sharp one: it is the link a tenant's own
 * customer follows to set their portal password. Handing it to a CRM operator
 * hands them that customer's portal identity.
 */

const CONTACT = {
  id: "c1",
  fullName: "Test Person",
  email: "person@example.com",
  portalPasswordHash: "$2a$12$fakehashfakehashfakehashfake",
  portalVerificationToken: "a".repeat(64),
  portalAccessEnabled: true,
}

describe("stripNeverReturned", () => {
  it("removes credential columns and keeps business fields", () => {
    const safe = stripNeverReturned(CONTACT)
    expect(safe.fullName).toBe("Test Person")
    expect(safe.email).toBe("person@example.com")
    // portalAccessEnabled is a business fact, not a credential — it stays.
    expect(safe.portalAccessEnabled).toBe(true)
    expect(safe).not.toHaveProperty("portalPasswordHash")
    expect(safe).not.toHaveProperty("portalVerificationToken")
  })

  it("covers the credential columns of every entity that flows through the filter", () => {
    const everything = {
      keep: "yes",
      passwordHash: "x", totpSecret: "x", resetToken: "x", backupCodes: "x",
      twoFactorNonce: "x", calendarToken: "x", apiKey: "x", keyHash: "x",
      portalPasswordHash: "x", portalVerificationToken: "x",
    }
    const safe = stripNeverReturned(everything)
    expect(Object.keys(safe)).toEqual(["keep"])
  })
})

describe("filterEntityFields", () => {
  // The admin short-circuit returned the entity untouched. An administrator is
  // entitled to every business field, not to a customer's password hash.
  it("strips credentials for an admin too", () => {
    const out = filterEntityFields(CONTACT, {}, "admin")
    expect(out).not.toHaveProperty("portalPasswordHash")
    expect(out).not.toHaveProperty("portalVerificationToken")
    expect(out.fullName).toBe("Test Person")
  })

  it("strips credentials for a non-admin regardless of permissions", () => {
    // "visible" is the strongest thing a permission can say; it must not
    // resurrect a credential column.
    const out = filterEntityFields(CONTACT, { portalPasswordHash: "visible" }, "sales")
    expect(out).not.toHaveProperty("portalPasswordHash")
  })

  it("still honours a hidden business field", () => {
    const out = filterEntityFields(CONTACT, { email: "hidden" }, "sales")
    expect(out).not.toHaveProperty("email")
    expect(out.fullName).toBe("Test Person")
  })
})

describe("contact routes do not answer with a raw row", () => {
  it.each([
    ["src/app/api/v1/contacts/[id]/route.ts", "PUT returned the row unfiltered"],
    ["src/app/api/v1/contacts/route.ts", "POST returned the row unfiltered"],
  ])("%s passes its response through the filter", path => {
    const source = readFileSync(path, "utf8")
    expect(source).toContain("stripNeverReturned")
  })
})
