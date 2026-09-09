import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const leadCallAction = readFileSync(
  "src/components/leads/lead-browser-call-action.tsx",
  "utf8",
)
const ordinaryCallWidget = readFileSync("src/components/call-widget.tsx", "utf8")
const leadDetailPage = readFileSync("src/app/(dashboard)/leads/[id]/page.tsx", "utf8")

describe("exact callback promise time", () => {
  it("asks for a date and time before a lead callback outcome can be saved", () => {
    expect(leadCallAction).toContain('type="datetime-local"')
    expect(leadCallAction).toMatch(/outcome === "callback"[\s\S]{0,240}setCallbackAt/)
  })

  it("sends the browser-local promise as an offset-bearing ISO timestamp", () => {
    const save = leadCallAction.slice(
      leadCallAction.indexOf("const saveOutcome"),
      leadCallAction.indexOf("const start = useCallback"),
    )
    expect(save).toContain("callbackAt")
    expect(save).toContain("toISOString()")
    expect(save).toMatch(/JSON\.stringify\(\{\s*disposition: outcome,\s*callbackAt/)
  })

  it("gives the callback time input an explicit accessible label and error description", () => {
    expect(leadCallAction).toMatch(/<label[^>]*htmlFor=[\s\S]{0,500}type="datetime-local"/)
    expect(leadCallAction).toMatch(/type="datetime-local"[\s\S]{0,300}aria-describedby=/)
  })

  it("keeps the ordinary call widget compatible with the strict callback contract", () => {
    expect(ordinaryCallWidget).toContain('type="datetime-local"')
    expect(ordinaryCallWidget).toContain("callbackAt")
    expect(ordinaryCallWidget).toContain("toISOString()")
  })

  it("surfaces the exact scheduled hour in the lead activity timeline", () => {
    expect(leadDetailPage).toContain("formatDateTime")
    expect(leadDetailPage).toContain("activity.scheduledAt")
    expect(leadDetailPage).toMatch(/formatDateTime\(activity\.scheduledAt, locale\)/)
  })
})
