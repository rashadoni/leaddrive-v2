import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const form = readFileSync("src/components/ticket-form.tsx", "utf8")

describe("Ticket form accessibility contract", () => {
  it("programmatically associates every visible field label", () => {
    expect(form).toContain("const fieldPrefix = useId()")
    expect(form.match(/<Label(?![^>]*htmlFor)/g) || []).toHaveLength(0)
    for (const field of [
      "subject", "priority", "category", "complaint-type", "risk-level",
      "complaint-brand", "product-category", "complaint-object",
      "responsible-department", "status", "company", "contact", "assigned",
      "description",
    ]) {
      expect(form).toContain(`htmlFor={\`${"${fieldPrefix}"}-${field}\`}`)
      expect(form).toContain(`id={\`${"${fieldPrefix}"}-${field}\`}`)
    }
  })

  it("reflows field pairs and keeps primary touch controls reachable", () => {
    expect(form.match(/grid grid-cols-1 gap-3 sm:grid-cols-2/g)?.length).toBeGreaterThanOrEqual(3)
    expect(form).toContain('className="h-11 sm:h-9"')
    expect(form).toContain('role="alert"')
    expect(form).toContain("motion-reduce:animate-none")
  })

  it("uses localized business labels instead of English fallbacks", () => {
    expect(form).toContain('tc("contact")')
    expect(form).toContain('tc("none")')
    expect(form).toContain('tc("unassigned")')
    expect(form).not.toContain("<Label>Contact</Label>")
    expect(form).not.toContain("— None —")
    expect(form).not.toContain("— Unassigned —")
    expect(form).not.toContain('|| "Failed"')
    expect(form).toContain('tc("errorUpdateFailed")')
    expect(form).toContain('tc("errorCreateFailed")')
  })

  it("loads the ticket-safe assignee projection and exposes stable workflow controls", () => {
    expect(form).toContain('fetch("/api/v1/skill-routing/agents"')
    expect(form).not.toContain('fetch("/api/v1/users"')
    expect(form).toContain('data-testid="ticket-form-priority"')
    expect(form).toContain('data-testid="ticket-form-submit"')
  })
})
