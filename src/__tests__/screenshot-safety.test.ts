import { describe, it, expect } from "vitest"
import { requireDemoTenant, assertDemoTenant } from "../../scripts/screenshot-safety.mjs"

/**
 * Guards `public/marketing/`, which Next.js serves to anonymous visitors.
 *
 * On 2026-08-31 all 29 files there turned out to be captures of the live
 * tenant, including three people's names, work e-mails and mobile numbers.
 * A denylist anonymiser already existed and did not stop it: it fails open,
 * and its `AGRARGO` rule was a typo for the real client `AGRARCO`, so that
 * rule could never fire and nothing reported it.
 *
 * These tests pin the inverted control: capture proceeds only when the demo
 * tenant is positively confirmed. Every ambiguous case must throw.
 */
describe("screenshot safety guard", () => {
  const DEMO = "Acme Corp"

  describe("requireDemoTenant", () => {
    it("refuses to run when the demo org is not configured", () => {
      expect(() => requireDemoTenant({})).toThrow(/SCREENSHOT_DEMO_ORG is required/)
    })

    it("refuses a blank demo org rather than matching everything", () => {
      expect(() => requireDemoTenant({ SCREENSHOT_DEMO_ORG: "   " })).toThrow(
        /SCREENSHOT_DEMO_ORG is required/,
      )
    })

    it("returns the configured org, trimmed", () => {
      expect(requireDemoTenant({ SCREENSHOT_DEMO_ORG: " Acme Corp " })).toBe("Acme Corp")
    })
  })

  describe("assertDemoTenant", () => {
    it("allows a page that shows the demo tenant and nothing real", () => {
      expect(() =>
        assertDemoTenant("Acme Corp — Dashboard. Revenue 847,520 USD", DEMO),
      ).not.toThrow()
    })

    it("blocks a page belonging to the live tenant", () => {
      expect(() => assertDemoTenant("Güvən Technology LLC — İdarə paneli", DEMO)).toThrow(
        /was not found on the page/,
      )
    })

    // A blank or still-loading page proves nothing about which tenant is
    // logged in, so it must fail rather than sail through the org check.
    // Spelled out rather than table-driven: a mixed string/null/undefined
    // `it.each` table infers a union element type that does not survive
    // strict-mode argument checking.
    it("blocks an empty page instead of assuming it is safe", () => {
      expect(() => assertDemoTenant("", DEMO)).toThrow(/Refusing to capture/)
    })

    it("blocks a null body instead of assuming it is safe", () => {
      expect(() => assertDemoTenant(null, DEMO)).toThrow(/Refusing to capture/)
    })

    it("blocks an undefined body instead of assuming it is safe", () => {
      expect(() => assertDemoTenant(undefined, DEMO)).toThrow(/Refusing to capture/)
    })

    // The exact string the old denylist misspelled as AGRARGO.
    it("blocks the client name the previous anonymiser typo'd past", () => {
      expect(() => assertDemoTenant(`${DEMO} "AGRARCO" MMC`, DEMO)).toThrow(
        /real-tenant data on screen/,
      )
    })

    it.each([
      ["a contact's mobile number", "+994 50 377 83 38"],
      ["a client work e-mail", "elvin.abushev@zeytunpharma.az"],
      ["a figure from the live ledger", "727,938.27 AZN"],
      ["a named individual", "Tarlan M. Mammadli"],
      ["a real corporation", "SOCAR Trading"],
    ])("blocks %s even when the demo org name is present", (_label, marker) => {
      expect(() => assertDemoTenant(`${DEMO} ${marker}`, DEMO)).toThrow(
        /real-tenant data on screen/,
      )
    })

    it("names the offending file so a failed run is actionable", () => {
      expect(() => assertDemoTenant("wrong tenant", DEMO, "companies-list.png")).toThrow(
        /companies-list\.png/,
      )
    })
  })
})
