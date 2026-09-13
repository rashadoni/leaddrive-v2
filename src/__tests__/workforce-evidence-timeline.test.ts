import { describe, expect, it } from "vitest"
import {
  parseWorkforceEvidenceAccessContext,
  safeWorkforceEvidenceReasonCodes,
} from "@/lib/workforce/evidence-timeline"

describe("Workforce derived evidence timeline contract", () => {
  it("requires bounded purpose and reason headers without accepting free text", () => {
    const headers = new Headers({
      "x-workforce-access-purpose": "SECURITY_INVESTIGATION",
      "x-workforce-access-reason-code": "SECURITY_ALERT",
      "x-workforce-case-reference": "case/2026-09-13_17",
    })
    expect(parseWorkforceEvidenceAccessContext(headers)).toEqual({
      purpose: "SECURITY_INVESTIGATION",
      reasonCode: "SECURITY_ALERT",
      caseReference: "case/2026-09-13_17",
    })
    expect(parseWorkforceEvidenceAccessContext(new Headers({
      "x-workforce-access-purpose": "routine curiosity",
      "x-workforce-access-reason-code": "SECURITY_ALERT",
    }))).toBeNull()
    expect(parseWorkforceEvidenceAccessContext(new Headers({
      "x-workforce-access-purpose": "ATTENDANCE_REVIEW",
      "x-workforce-access-reason-code": "OPEN_EXCEPTION",
      "x-workforce-case-reference": "contains employee free text",
    }))).toBeNull()
  })

  it("normalizes only bounded server reason codes", () => {
    expect(safeWorkforceEvidenceReasonCodes([
      "INSIDE_FENCE",
      " bad value ",
      17,
      "ACCURACY_LOW",
    ])).toEqual(["INSIDE_FENCE", "ACCURACY_LOW"])
    expect(safeWorkforceEvidenceReasonCodes({ raw: "private" })).toEqual(["UNAVAILABLE"])
  })
})
