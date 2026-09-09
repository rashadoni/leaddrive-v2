import { describe, expect, it } from "vitest"
import {
  DEFAULT_PRECHAT_FORM,
  parsePreChatForm,
  validatePreChatSubmission,
} from "@/lib/web-chat-prechat"

describe("parsePreChatForm", () => {
  it("returns the legacy default (all shown, none required) for null/garbage", () => {
    for (const raw of [null, undefined, "junk", 42, [], { name: "yes" }]) {
      const form = parsePreChatForm(raw)
      expect(form).toEqual(DEFAULT_PRECHAT_FORM)
    }
  })

  it("normalizes required ⇒ enabled (a required-but-hidden field would deadlock the form)", () => {
    const form = parsePreChatForm({ email: { enabled: false, required: true } })
    expect(form.email).toEqual({ enabled: true, required: true })
  })

  it("keeps explicit disables", () => {
    const form = parsePreChatForm({ phone: { enabled: false, required: false } })
    expect(form.phone).toEqual({ enabled: false, required: false })
    expect(form.name).toEqual(DEFAULT_PRECHAT_FORM.name)
  })
})

describe("validatePreChatSubmission", () => {
  it("legacy default accepts a fully empty submission", () => {
    const result = validatePreChatSubmission(DEFAULT_PRECHAT_FORM, {})
    expect(result).toEqual({ ok: true, values: { visitorName: null, visitorEmail: null, visitorPhone: null } })
  })

  it("reports missing required fields", () => {
    const form = parsePreChatForm({ email: { enabled: true, required: true }, phone: { enabled: true, required: true } })
    const result = validatePreChatSubmission(form, { visitorName: "A" })
    expect(result).toEqual({ ok: false, missing: ["email", "phone"] })
  })

  it("whitespace does not satisfy a required field", () => {
    const form = parsePreChatForm({ name: { enabled: true, required: true } })
    expect(validatePreChatSubmission(form, { visitorName: "   " })).toEqual({ ok: false, missing: ["name"] })
  })

  it("strips values of DISABLED fields — never store data the org turned off", () => {
    const form = parsePreChatForm({ phone: { enabled: false, required: false } })
    const result = validatePreChatSubmission(form, { visitorName: "A", visitorPhone: "+994501112233" })
    expect(result).toEqual({ ok: true, values: { visitorName: "A", visitorEmail: null, visitorPhone: null } })
  })
})
