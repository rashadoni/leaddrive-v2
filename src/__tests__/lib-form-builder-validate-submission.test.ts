/**
 * P8 No-Code Form Builder — submission validator tests.
 *
 * The validator gates persistence: a row in `form_submissions`
 * implies all required fields were present + every value passed its
 * per-type checks. Slice-2 routes call `validateSubmission(fields,
 * payload)` before persisting + triggering Lead-creation /
 * notification emails.
 */
import { describe, it, expect } from "vitest"
import { validateSubmission } from "@/lib/form-builder/validate-submission"
import type { FormFieldSchema } from "@/lib/form-builder/types"

function fields(...f: FormFieldSchema[]) {
  return f
}

describe("validateSubmission — shape", () => {
  it("rejects non-object payloads", () => {
    const r = validateSubmission([], null)
    expect(r.ok).toBe(false)
  })

  it("returns ok + empty object for no fields, empty submission", () => {
    const r = validateSubmission([], {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedData).toEqual({})
  })
})

describe("validateSubmission — required gate", () => {
  it("rejects missing required text", () => {
    const r = validateSubmission(
      fields({ key: "name", type: "text", label: "Name", required: true }),
      {},
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe("required")
  })

  it("missing optional text is allowed", () => {
    const r = validateSubmission(
      fields({ key: "name", type: "text", label: "Name" }),
      {},
    )
    expect(r.ok).toBe(true)
  })

  it("empty-string required value counts as missing", () => {
    const r = validateSubmission(
      fields({ key: "name", type: "text", label: "Name", required: true }),
      { name: "" },
    )
    expect(r.ok).toBe(false)
  })

  it("empty-array required checkbox counts as missing", () => {
    const r = validateSubmission(
      fields({
        key: "topics",
        type: "checkbox",
        label: "Topics",
        required: true,
        options: [{ label: "A", value: "a" }],
      }),
      { topics: [] },
    )
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — text + textarea + hidden", () => {
  it("trims text/textarea but preserves hidden as-is", () => {
    const r = validateSubmission(
      fields(
        { key: "a", type: "text", label: "A" },
        { key: "b", type: "textarea", label: "B" },
        { key: "c", type: "hidden", label: "C" },
      ),
      { a: "  hi  ", b: "  multi\nline  ", c: "  raw  " },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.normalizedData.a).toBe("hi")
      expect(r.normalizedData.b).toBe("multi\nline")
      expect(r.normalizedData.c).toBe("  raw  ") // hidden NOT trimmed
    }
  })

  it("respects maxLength", () => {
    const r = validateSubmission(
      fields({ key: "a", type: "text", label: "A", validation: { maxLength: 5 } }),
      { a: "abcdef" },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].code).toBe("maxLength")
  })

  it("respects minLength", () => {
    const r = validateSubmission(
      fields({ key: "a", type: "text", label: "A", validation: { minLength: 3 } }),
      { a: "ab" },
    )
    expect(r.ok).toBe(false)
  })

  it("respects pattern", () => {
    const r = validateSubmission(
      fields({ key: "a", type: "text", label: "A", validation: { pattern: "^[A-Z]+$" } }),
      { a: "abc" },
    )
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — email", () => {
  it("accepts valid email + lowercases", () => {
    const r = validateSubmission(
      fields({ key: "email", type: "email", label: "Email" }),
      { email: "Foo@Example.COM" },
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedData.email).toBe("foo@example.com")
  })

  it("rejects malformed email", () => {
    const r = validateSubmission(
      fields({ key: "email", type: "email", label: "Email" }),
      { email: "not-an-email" },
    )
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — phone", () => {
  it("accepts +1 555-123-4567", () => {
    const r = validateSubmission(
      fields({ key: "phone", type: "phone", label: "Phone" }),
      { phone: "+1 555-123-4567" },
    )
    expect(r.ok).toBe(true)
  })

  it("rejects pure-text phone", () => {
    const r = validateSubmission(
      fields({ key: "phone", type: "phone", label: "Phone" }),
      { phone: "not a phone" },
    )
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — url", () => {
  it("accepts https URL", () => {
    const r = validateSubmission(
      fields({ key: "site", type: "url", label: "Site" }),
      { site: "https://example.com/path" },
    )
    expect(r.ok).toBe(true)
  })

  it("rejects bare-word", () => {
    const r = validateSubmission(
      fields({ key: "site", type: "url", label: "Site" }),
      { site: "notaurl" },
    )
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — number", () => {
  it("accepts number-as-string + preserves numeric type", () => {
    const r = validateSubmission(
      fields({ key: "qty", type: "number", label: "Qty" }),
      { qty: "42" },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Slice-2 Lead-creation + F4 Report Builder rely on numeric
      // type — String("42") would defeat aggregation downstream.
      expect(r.normalizedData.qty).toBe(42)
      expect(typeof r.normalizedData.qty).toBe("number")
    }
  })

  it("accepts native-number input", () => {
    const r = validateSubmission(
      fields({ key: "qty", type: "number", label: "Qty" }),
      { qty: 7 },
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedData.qty).toBe(7)
  })

  it("enforces min/max", () => {
    const r1 = validateSubmission(
      fields({ key: "qty", type: "number", label: "Qty", validation: { min: 1, max: 10 } }),
      { qty: "0" },
    )
    const r2 = validateSubmission(
      fields({ key: "qty", type: "number", label: "Qty", validation: { min: 1, max: 10 } }),
      { qty: "11" },
    )
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
  })
})

describe("validateSubmission — date", () => {
  it("accepts ISO date", () => {
    const r = validateSubmission(
      fields({ key: "d", type: "date", label: "D" }),
      { d: "2026-05-29" },
    )
    expect(r.ok).toBe(true)
  })

  it("strips time portion when present", () => {
    const r = validateSubmission(
      fields({ key: "d", type: "date", label: "D" }),
      { d: "2026-05-29T10:30:00Z" },
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedData.d).toBe("2026-05-29")
  })

  it("rejects yyyy/mm/dd", () => {
    const r = validateSubmission(
      fields({ key: "d", type: "date", label: "D" }),
      { d: "2026/05/29" },
    )
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — select / radio", () => {
  const f: FormFieldSchema[] = [
    {
      key: "color",
      type: "select",
      label: "Color",
      options: [{ label: "Red", value: "r" }, { label: "Blue", value: "b" }],
    },
  ]
  it("accepts a listed option", () => {
    const r = validateSubmission(f, { color: "b" })
    expect(r.ok).toBe(true)
  })
  it("rejects an unlisted option", () => {
    const r = validateSubmission(f, { color: "g" })
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — checkbox", () => {
  const f: FormFieldSchema[] = [
    {
      key: "topics",
      type: "checkbox",
      label: "Topics",
      options: [
        { label: "Sales", value: "sales" },
        { label: "Support", value: "support" },
      ],
    },
  ]
  it("accepts a string array", () => {
    const r = validateSubmission(f, { topics: ["sales", "support"] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedData.topics).toEqual(["sales", "support"])
  })

  it("accepts a CSV string", () => {
    const r = validateSubmission(f, { topics: "sales, support" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.normalizedData.topics).toEqual(["sales", "support"])
  })

  it("rejects an invalid choice", () => {
    const r = validateSubmission(f, { topics: ["sales", "espionage"] })
    expect(r.ok).toBe(false)
  })
})

describe("validateSubmission — composite", () => {
  it("collects multiple errors across fields", () => {
    const r = validateSubmission(
      fields(
        { key: "name", type: "text", label: "Name", required: true },
        { key: "email", type: "email", label: "Email", required: true },
        { key: "age", type: "number", label: "Age", validation: { min: 18 } },
      ),
      { age: "12" },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const codes = r.errors.map((e) => e.code).sort()
      expect(codes).toContain("required") // name
      expect(codes).toContain("min") // age
    }
  })
})
