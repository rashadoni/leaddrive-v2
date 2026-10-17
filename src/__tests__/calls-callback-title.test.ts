import { describe, expect, it } from "vitest"
import { callbackTaskTitle, isCallbackPlaceholderTitle } from "@/lib/calls/callback-title"
import { callStatusLabelKey } from "@/lib/calls/status-label"

describe("the callback task speaks its owner's language", () => {
  it("uses the employee's own language first", () => {
    expect(callbackTaskTitle({ preferredLanguage: "az", organizationSettings: { language: "ru" } })).toBe("Geri zəng")
    expect(callbackTaskTitle({ preferredLanguage: "ru", organizationSettings: { language: "az" } })).toBe("Перезвонить")
  })

  it("falls back to the organization's language, then the product's default", () => {
    expect(callbackTaskTitle({ preferredLanguage: null, organizationSettings: { language: "az" } })).toBe("Geri zəng")
    expect(callbackTaskTitle({ preferredLanguage: "xx", organizationSettings: { language: "en" } })).toBe("Call back")
    expect(callbackTaskTitle({})).toBe("Перезвонить")
  })

  it("recognises every untouched title, the old English one included, and nothing a person wrote", () => {
    for (const title of ["Callback", "Geri zəng", "Перезвонить", "Call back"]) expect(isCallbackPlaceholderTitle(title)).toBe(true)
    expect(isCallbackPlaceholderTitle("VIP qiymət zəngi")).toBe(false)
  })
})

describe("a call's status has words in every language", () => {
  it("maps each status the widget can show to a label key", () => {
    for (const status of ["initiated", "ringing", "in-progress", "completed", "no-answer", "busy", "failed", "canceled"]) {
      expect(callStatusLabelKey(status), status).not.toBe("unknown")
    }
    expect(callStatusLabelKey("something-new")).toBe("unknown")
  })
})
