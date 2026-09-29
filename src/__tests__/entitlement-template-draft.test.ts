import { describe, expect, it } from "vitest"

import {
  moveTemplateRule,
  parseStoredTemplateDraft,
  validateTemplateDraft,
  type TemplateDraft,
  type TemplateRuleDraft,
} from "@/lib/entitlement-process/template-draft"

const rule = (overrides: Partial<TemplateRuleDraft> = {}): TemplateRuleDraft => ({
  key: "rule-1",
  type: "first_response",
  name: "First response",
  severityTier: "all",
  dueValue: 4,
  dueUnit: "hours",
  isRequired: true,
  ...overrides,
})

const draft = (overrides: Partial<TemplateDraft> = {}): TemplateDraft => ({
  supportLevel: "standard",
  name: "Standard",
  description: "",
  isActive: true,
  definitions: [rule()],
  ...overrides,
})

describe("entitlement template draft", () => {
  it("returns stable validation issues for every blocked save state", () => {
    expect(validateTemplateDraft(draft({ name: " " }))).toBe("name_required")
    expect(validateTemplateDraft(draft({ definitions: [] }))).toBe("active_without_rules")
    expect(validateTemplateDraft(draft({ isActive: false, definitions: [] }))).toBeNull()
    expect(validateTemplateDraft(draft({ definitions: [rule({ name: "" })] }))).toBe("rule_name_required")
    expect(validateTemplateDraft(draft({ definitions: [rule({ dueValue: 0 })] }))).toBe("invalid_due")
    expect(validateTemplateDraft(draft({ definitions: [rule(), rule({ key: "rule-2", name: "Again" })] }))).toBe("duplicate_rule")
    expect(validateTemplateDraft(draft({ definitions: Array.from({ length: 31 }, (_, index) => rule({ key: `rule-${index}`, severityTier: index === 0 ? "all" : "high" })) }))).toBe("too_many_rules")
  })

  it("restores structurally valid drafts even when their editable values are not saveable yet", () => {
    const unfinished = draft({ name: "", definitions: [rule({ name: "", dueValue: 0 })] })
    expect(parseStoredTemplateDraft(JSON.stringify(unfinished), "standard")).toEqual(unfinished)
  })

  it("rejects malformed, oversized, or wrong-level browser drafts", () => {
    expect(parseStoredTemplateDraft("not json", "standard")).toBeNull()
    expect(parseStoredTemplateDraft(JSON.stringify(draft()), "premium")).toBeNull()
    expect(parseStoredTemplateDraft(JSON.stringify(draft({ definitions: Array.from({ length: 31 }, (_, index) => rule({ key: String(index) })) })), "standard")).toBeNull()
    expect(parseStoredTemplateDraft(JSON.stringify({ ...draft(), definitions: [{ ...rule(), type: "unknown" }] }), "standard")).toBeNull()
  })

  it("moves rules accessibly while preserving boundary order", () => {
    const rules = [rule({ key: "a" }), rule({ key: "b" }), rule({ key: "c" })]
    expect(moveTemplateRule(rules, 1, -1).map((item) => item.key)).toEqual(["b", "a", "c"])
    expect(moveTemplateRule(rules, 1, 1).map((item) => item.key)).toEqual(["a", "c", "b"])
    expect(moveTemplateRule(rules, 0, -1).map((item) => item.key)).toEqual(["a", "b", "c"])
    expect(rules.map((item) => item.key)).toEqual(["a", "b", "c"])
  })
})
