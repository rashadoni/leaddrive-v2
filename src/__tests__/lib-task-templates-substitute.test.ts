import { describe, it, expect } from "vitest"
import { substituteTemplateVars } from "@/lib/task-templates/substitute"

describe("substituteTemplateVars", () => {
  const ctx = {
    userName: "Alice",
    locale: "en-US",
    now: new Date(Date.UTC(2026, 4, 28, 12, 0, 0)), // 2026-05-28
  }

  it("substitutes {{user}}", () => {
    expect(substituteTemplateVars("Hello {{user}}", ctx)).toBe("Hello Alice")
  })

  it("substitutes {{month}} in locale", () => {
    expect(substituteTemplateVars("Report — {{month}}", ctx)).toBe("Report — May")
  })

  it("substitutes {{date}} in locale", () => {
    // Format varies by Node ICU version but should contain 2026
    const result = substituteTemplateVars("Due {{date}}", ctx)
    expect(result).toMatch(/2026/)
  })

  it("substitutes {{week}} with ISO week number", () => {
    // 2026-05-28 is week 22 (Thursday)
    expect(substituteTemplateVars("Week {{week}}", ctx)).toBe("Week 22")
  })

  it("leaves unknown variables intact", () => {
    expect(substituteTemplateVars("Hello {{xyz}} {{user}}", ctx)).toBe("Hello {{xyz}} Alice")
  })

  it("handles multiple substitutions in one string", () => {
    expect(substituteTemplateVars("{{user}} — {{month}} status", ctx)).toBe("Alice — May status")
  })

  it("returns input unchanged when there are no placeholders", () => {
    expect(substituteTemplateVars("Plain text here", ctx)).toBe("Plain text here")
  })

  it("falls back gracefully when userName missing", () => {
    expect(substituteTemplateVars("Hello {{user}}", { now: ctx.now, locale: "en-US" })).toBe("Hello ")
  })

  it("handles ISO week boundary (week 1 of new year)", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026
    const earlyJan = new Date(Date.UTC(2026, 0, 1, 12, 0, 0))
    expect(substituteTemplateVars("W{{week}}", { now: earlyJan })).toBe("W1")
  })
})
