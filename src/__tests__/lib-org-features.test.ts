import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * setOrgFeatureFlag — atomic flag toggle on Organization.features (jsonb), no read-modify-write.
 * We mock $executeRaw and assert the right branch (atomic append-guarded-by-containment for add,
 * jsonb-minus for remove) + that the flag/org are bound as parameters (not string-interpolated).
 */
// Typed with rest args so `.mock.calls[0]` is `unknown[]` (a tagged-template call: strings + values),
// not the empty tuple a zero-arg signature would infer.
const { executeRaw } = vi.hoisted(() => ({ executeRaw: vi.fn(async (..._args: unknown[]) => 1) }))
vi.mock("@/lib/prisma", () => ({ prisma: { $executeRaw: executeRaw } }))

import { setOrgFeatureFlag } from "@/lib/org-features"

beforeEach(() => executeRaw.mockClear())

function captured() {
  const call = executeRaw.mock.calls[0]
  const strings = call[0] as unknown as string[] // TemplateStringsArray
  const values = call.slice(1)
  // A nested Prisma.sql fragment (the features normalisation) is inlined as its SQL text;
  // a bound parameter shows as "?".
  const fragment = (value: unknown) =>
    value && typeof value === "object" && typeof (value as { sql?: unknown }).sql === "string" ? (value as { sql: string }).sql : "?"
  const sql = strings.map((part, i) => (i < values.length ? part + fragment(values[i]) : part)).join("")
  return { sql, values }
}

describe("setOrgFeatureFlag", () => {
  it("ADD: atomic append guarded by NOT-contains (idempotent), flag + org bound as params", async () => {
    await setOrgFeatureFlag("org_1", "inboxFollowUp", true)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const { sql, values } = captured()
    expect(sql).toContain("||") // jsonb concat
    expect(sql).toContain("@>") // containment guard → idempotent, no dup
    expect(sql).not.toContain("END) - ") // not the remove branch
    expect(values).toContain("inboxFollowUp")
    expect(values).toContain("org_1")
  })

  it("REMOVE: jsonb minus, no read; flag + org bound as params", async () => {
    await setOrgFeatureFlag("org_1", "inboxFollowUp", false)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const { sql, values } = captured()
    expect(sql).toContain("END) - ") // jsonb array (normalized) minus a text element
    expect(sql).not.toContain("||")
    expect(values).toContain("inboxFollowUp")
    expect(values).toContain("org_1")
  })

  // Zeytun, 2026-11-26: features stored as a jsonb STRING of JSON text; `string || [flag]` wrapped the
  // whole old list into one element and every module vanished. Each statement must read the column
  // through the string-to-array normalisation, for add, remove and value-flag replacement alike.
  it("reads a jsonb-string features column as the array it holds, in every statement", async () => {
    for (const enabled of [true, false]) {
      executeRaw.mockClear()
      await setOrgFeatureFlag("org_1", "ai_semantic_search", enabled)
      const { sql } = captured()
      expect(sql).toContain("jsonb_typeof(features) = 'string'")
      expect(sql).toContain("(features #>> '{}')::jsonb")
    }
  })
})
