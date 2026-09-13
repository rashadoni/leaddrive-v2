import { describe, expect, it } from "vitest"

import {
  complaintDraftStorageKey,
  hasComplaintDraftContent,
  parseComplaintDraft,
  serializeComplaintDraft,
  type ComplaintDraftForm,
} from "@/lib/complaints/complaint-draft"

const empty: ComplaintDraftForm = {
  customerName: "", phone: "", source: "hotline", complaintType: "complaint",
  brand: "", productionArea: "", productCategory: "", complaintObject: "",
  complaintObjectDetail: "", content: "", responsibleDepartment: "", riskLevel: "medium",
}

describe("new complaint drafts", () => {
  it("is scoped to the tenant", () => {
    expect(complaintDraftStorageKey("org-1")).not.toBe(complaintDraftStorageKey("org-2"))
  })

  it("round-trips recoverable work and ignores untouched defaults", () => {
    expect(hasComplaintDraftContent(empty)).toBe(false)
    const form = { ...empty, content: "Customer reports damaged packaging" }
    expect(parseComplaintDraft(serializeComplaintDraft(form, new Date("2026-09-04T12:00:00Z")))).toEqual({
      form,
      updatedAt: "2026-09-04T12:00:00.000Z",
    })
  })

  it.each([null, "", "not-json", "{}", JSON.stringify({ form: empty, updatedAt: "now" })])(
    "rejects invalid or empty data: %s",
    raw => expect(parseComplaintDraft(raw)).toBeNull(),
  )
})
