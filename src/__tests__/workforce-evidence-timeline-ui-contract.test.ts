import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { navItems } from "@/lib/nav-items"

const component = readFileSync("src/components/workforce/workforce-evidence-timeline.tsx", "utf8")
const page = readFileSync("src/app/(dashboard)/workforce/evidence/page.tsx", "utf8")

function messages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).workforceEvidenceTimeline as Record<string, unknown>
}

function keyPaths(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return nested != null && typeof nested === "object" && !Array.isArray(nested)
      ? keyPaths(nested as Record<string, unknown>, path)
      : [path]
  }).sort()
}

describe("Workforce derived-evidence timeline UI contract", () => {
  it("mounts a capability-gated nav surface without broad CRM role assumptions", () => {
    expect(page).toContain("<WorkforceEvidenceTimeline />")
    const item = navItems.find((candidate) => candidate.href === "/workforce/evidence")
    expect(item).toMatchObject({
      capability: "workforce-hrm",
      permissionScope: "workforce",
      tKey: "workforceEvidence",
    })
    expect(item?.allowedRoles).toBeUndefined()
  })

  it("sends an explicit purpose/reason context to separate target and timeline reads", () => {
    expect(component).toContain("/api/v1/workforce/evidence/targets?q=")
    expect(component).toContain("/api/v1/workforce/evidence/timeline?")
    expect(component).toContain('"x-workforce-access-purpose": purpose')
    expect(component).toContain('"x-workforce-access-reason-code": reasonCode')
    expect(component).toContain('"x-workforce-case-reference": caseReference.trim()')
    expect(component).toContain("searchController.current?.abort()")
    expect(component).toContain("timelineController.current?.abort()")
  })

  it("renders only the strict ID-free derived view model and preserves the warning", () => {
    expect(component).toContain("parseWorkforceEvidenceTimeline")
    expect(component).toContain('t("boundary")')
    expect(component).not.toMatch(/latitude|longitude|distanceMeters|accuracyMeters|rawEnvelopeCiphertext|redactedReceipt|payloadHash|nonceFingerprint|deviceEnrollmentId/)
    expect(component).not.toContain("selectedTarget.id}</")
  })

  it("keeps every evidence-screen message in AZ, RU and EN", () => {
    const en = messages("en")
    const expected = keyPaths(en)
    expect(expected.length).toBeGreaterThan(50)
    for (const locale of ["az", "ru"]) {
      expect(keyPaths(messages(locale)), locale).toEqual(expected)
    }
  })

  it("keeps responsive controls, visible focus and 48px touch targets in source", () => {
    expect(component).toContain("min-h-12")
    expect(component).toContain("focus-visible:ring-2")
    expect(component).toContain("sm:grid-cols-2")
    expect(component).toContain("lg:grid-cols-3")
    expect(component).toContain("motion-reduce:animate-none")
  })
})
