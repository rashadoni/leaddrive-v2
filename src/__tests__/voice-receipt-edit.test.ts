import { describe, expect, it } from "vitest"

import {
  buildEditedReceiptPayload,
  editableFieldValue,
} from "@/components/ai/voice-receipt-fields"
import { AI_VOICE_ACTION_REGISTRY, AI_VOICE_ACTION_TYPES } from "@/lib/ai/voice/action-registry"
import type { VoiceReceiptField } from "@/lib/ai/voice/receipt-store"

/**
 * Roadmap U1.9a — correcting one wrong word without re-dictating the action.
 *
 * `PATCH /actions/:id` REPLACES the payload rather than merging it, so the
 * form has to hand back a whole payload rebuilt from the receipt on screen.
 * That is lossless only while the receipt previews every field a voice caller
 * may send — the tests below make that an assertion rather than an assumption.
 */

/** Re-derived from the live record by `bindTarget` on every draft write. */
const SERVER_DERIVED = new Set(["expectedUpdatedAt"])

describe("rebuilding a payload is lossless", () => {
  it("previews every field a voice caller may send, bar the server-derived one", () => {
    for (const actionType of AI_VOICE_ACTION_TYPES) {
      const entry = AI_VOICE_ACTION_REGISTRY[actionType]
      const previewed = new Set<string>(entry.previewFields)
      const missing = entry.allowedFields.filter(
        (fieldName) => !previewed.has(fieldName) && !SERVER_DERIVED.has(fieldName),
      )
      expect(missing, `${actionType} has fields no receipt can show`).toEqual([])
    }
  })

  it("never previews a field a voice caller may not send", () => {
    for (const actionType of AI_VOICE_ACTION_TYPES) {
      const entry = AI_VOICE_ACTION_REGISTRY[actionType]
      const allowed = new Set<string>(entry.allowedFields)
      const extra = entry.previewFields.filter((fieldName) => !allowed.has(fieldName))
      expect(extra, `${actionType} previews a field the payload cannot carry`).toEqual([])
    }
  })

  // No action previews it, on purpose: `bindTarget` re-derives the token from
  // the live record on every draft write, so an edit revalidates against the
  // record as it is NOW rather than as it was when the draft was made.
  it("never previews the optimistic-lock token", () => {
    for (const actionType of AI_VOICE_ACTION_TYPES) {
      expect([...AI_VOICE_ACTION_REGISTRY[actionType].previewFields], actionType)
        .not.toContain("expectedUpdatedAt")
    }
    // And the two actions that need one still declare it as sendable, which is
    // why the exception above exists rather than being dropped from both lists.
    expect([...AI_VOICE_ACTION_REGISTRY.update_lead.allowedFields])
      .toContain("expectedUpdatedAt")
    expect([...AI_VOICE_ACTION_REGISTRY.convert_lead_to_deal.allowedFields])
      .toContain("expectedUpdatedAt")
  })
})

function field(key: string, after: unknown, before?: unknown): VoiceReceiptField {
  return before === undefined ? { key, labelKey: key, after } : { key, labelKey: key, before, after }
}

describe("the payload a save sends", () => {
  it("keeps every field when nothing was edited", () => {
    const fields = [field("title", "Call Ali"), field("priority", "high")]
    expect(buildEditedReceiptPayload(fields, {})).toEqual({
      title: "Call Ali",
      priority: "high",
    })
  })

  it("applies only what the user changed", () => {
    const fields = [field("title", "Call Ali"), field("priority", "high")]
    expect(buildEditedReceiptPayload(fields, { title: "Call Ali back" })).toEqual({
      title: "Call Ali back",
      priority: "high",
    })
  })

  // Hiding a field from the reader must never drop it from the payload. No
  // action currently previews a hidden field, and this is what keeps that a
  // presentation choice rather than a data loss waiting to happen.
  it("carries a hidden field through unchanged", () => {
    const fields = [
      field("phone", "+994501234567", "+994501111111"),
      field("expectedUpdatedAt", "2026-09-20T11:00:00.000Z", null),
    ]
    expect(buildEditedReceiptPayload(fields, { phone: "+994509999999" })).toEqual({
      phone: "+994509999999",
      expectedUpdatedAt: "2026-09-20T11:00:00.000Z",
    })
  })

  it("restores the number type a text input flattened", () => {
    const fields = [field("estimatedValue", 1200)]
    expect(buildEditedReceiptPayload(fields, { estimatedValue: "1500" }))
      .toEqual({ estimatedValue: 1500 })
  })

  it("keeps a boolean a checkbox produced", () => {
    const fields = [field("createCompany", false)]
    expect(buildEditedReceiptPayload(fields, { createCompany: true }))
      .toEqual({ createCompany: true })
  })

  // Omission means "do not set this" on a create — several create schemas
  // reject null outright — and "do not change this" on an update. Clearing a
  // saved value is a separate gesture this form does not pretend to offer.
  it("omits a field the user cleared rather than sending null or empty", () => {
    const fields = [field("title", "Call Ali"), field("description", "Ask about tyres")]
    expect(buildEditedReceiptPayload(fields, { description: "" })).toEqual({ title: "Call Ali" })
    expect(buildEditedReceiptPayload(fields, { description: "   " })).toEqual({ title: "Call Ali" })
  })

  it("omits a field that was already empty", () => {
    const fields = [field("title", "Call Ali"), field("notes", null)]
    expect(buildEditedReceiptPayload(fields, {})).toEqual({ title: "Call Ali" })
  })
})

describe("what an input starts from", () => {
  it("shows the value the server normalized, as text", () => {
    expect(editableFieldValue(field("title", "Call Ali"))).toBe("Call Ali")
    expect(editableFieldValue(field("estimatedValue", 1200))).toBe("1200")
    expect(editableFieldValue(field("notes", null))).toBe("")
  })

  it("keeps a boolean a boolean, so it renders as a checkbox", () => {
    expect(editableFieldValue(field("createCompany", true))).toBe(true)
    expect(editableFieldValue(field("createCompany", false))).toBe(false)
  })
})
