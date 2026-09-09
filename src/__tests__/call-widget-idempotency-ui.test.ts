import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("src/components/call-widget.tsx", "utf8")

describe("ordinary click-to-call idempotency UI contract", () => {
  it("uses one durable browser request identity for transport retries", () => {
    expect(component).toContain("idempotencyKeyRef")
    expect(component).toContain("crypto.randomUUID()")
    expect(component).toContain('"Idempotency-Key": idempotencyKey')
    expect(component).toContain('data.error !== "call_outcome_unknown_no_redial"')
  })

  it("renders safe copy for active, indeterminate, and conflicting requests", () => {
    expect(component).toContain('t("activeVoiceCallExists")')
    expect(component).toContain('t("callOutcomeUnknownNoRedial")')
    expect(component).toContain('t("callRequestConflict")')
  })
})
