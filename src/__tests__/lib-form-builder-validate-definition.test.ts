/**
 * P8 No-Code Form Builder — definition validator tests.
 *
 * Slice-2 routes accept a `fields: Json` blob from the builder UI;
 * the validator is the only gate that prevents a malformed schema
 * from reaching the renderer + downstream submission validation.
 * A definition that parses-but-renders-broken is the worst
 * failure mode (silent 500s for end users).
 */
import { describe, it, expect } from "vitest"
import { validateFormDefinition } from "@/lib/form-builder/validate-definition"

describe("validateFormDefinition — shape", () => {
  it("rejects non-arrays", () => {
    const r = validateFormDefinition({})
    expect(r.ok).toBe(false)
  })

  it("rejects empty arrays", () => {
    const r = validateFormDefinition([])
    expect(r.ok).toBe(false)
  })

  it("rejects 201+ fields (sanity cap)", () => {
    const fields = Array.from({ length: 201 }, (_, i) => ({
      key: `f${i}`,
      type: "text",
      label: `Field ${i}`,
    }))
    const r = validateFormDefinition(fields)
    expect(r.ok).toBe(false)
  })

  it("accepts a minimal valid field array", () => {
    const r = validateFormDefinition([
      { key: "name", type: "text", label: "Your name", required: true },
    ])
    expect(r.ok).toBe(true)
    expect(r.cleanFields).toHaveLength(1)
    expect(r.cleanFields![0].key).toBe("name")
  })
})

describe("validateFormDefinition — key", () => {
  it("rejects keys not matching the regex pattern", () => {
    const r = validateFormDefinition([
      { key: "1starts_with_digit", type: "text", label: "X" },
    ])
    expect(r.ok).toBe(false)
  })

  it("rejects keys with spaces", () => {
    const r = validateFormDefinition([
      { key: "has space", type: "text", label: "X" },
    ])
    expect(r.ok).toBe(false)
  })

  it("rejects duplicate keys", () => {
    const r = validateFormDefinition([
      { key: "name", type: "text", label: "First" },
      { key: "name", type: "text", label: "Duplicate" },
    ])
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("duplicated")
  })

  it("rejects keys longer than 64 chars", () => {
    const r = validateFormDefinition([
      { key: "a".repeat(65), type: "text", label: "X" },
    ])
    expect(r.ok).toBe(false)
  })
})

describe("validateFormDefinition — type", () => {
  it("rejects unknown field types", () => {
    const r = validateFormDefinition([
      { key: "x", type: "fingerprint", label: "X" },
    ])
    expect(r.ok).toBe(false)
  })

  it("requires options on select/radio/checkbox", () => {
    for (const type of ["select", "radio", "checkbox"]) {
      const r = validateFormDefinition([{ key: "x", type, label: "X" }])
      expect(r.ok).toBe(false)
    }
  })

  it("accepts well-formed select with options", () => {
    const r = validateFormDefinition([
      {
        key: "country",
        type: "select",
        label: "Country",
        options: [{ label: "USA", value: "us" }, { label: "Mexico", value: "mx" }],
      },
    ])
    expect(r.ok).toBe(true)
  })

  it("rejects options on text fields (stale builder state)", () => {
    const r = validateFormDefinition([
      { key: "name", type: "text", label: "X", options: [{ label: "a", value: "a" }] },
    ])
    expect(r.ok).toBe(false)
  })
})

describe("validateFormDefinition — label", () => {
  it("rejects empty label", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "" },
    ])
    expect(r.ok).toBe(false)
  })

  it("rejects label over 255 chars", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "x".repeat(256) },
    ])
    expect(r.ok).toBe(false)
  })
})

describe("validateFormDefinition — validation block", () => {
  it("rejects negative minLength", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "X", validation: { minLength: -1 } },
    ])
    expect(r.ok).toBe(false)
  })

  it("rejects minLength > maxLength", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "X", validation: { minLength: 10, maxLength: 5 } },
    ])
    expect(r.ok).toBe(false)
  })

  it("rejects invalid regex pattern", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "X", validation: { pattern: "[unclosed" } },
    ])
    expect(r.ok).toBe(false)
  })

  it("accepts valid regex pattern", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "X", validation: { pattern: "^[A-Z]{3}$" } },
    ])
    expect(r.ok).toBe(true)
  })
})

describe("validateFormDefinition — cleanFields output", () => {
  it("strips undefined optional fields", () => {
    const r = validateFormDefinition([
      { key: "x", type: "text", label: "X" },
    ])
    expect(r.ok).toBe(true)
    expect(r.cleanFields![0].placeholder).toBeUndefined()
    expect(r.cleanFields![0].validation).toBeUndefined()
  })

  it("preserves required: true but not false", () => {
    const r = validateFormDefinition([
      { key: "a", type: "text", label: "A", required: true },
      { key: "b", type: "text", label: "B", required: false },
    ])
    expect(r.ok).toBe(true)
    expect(r.cleanFields![0].required).toBe(true)
    expect(r.cleanFields![1].required).toBeUndefined()
  })
})
