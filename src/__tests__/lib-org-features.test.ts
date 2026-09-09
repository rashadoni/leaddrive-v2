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
  return { sql: strings.join(" ? "), values: call.slice(1) }
}

describe("setOrgFeatureFlag", () => {
  it("ADD: atomic append guarded by NOT-contains (idempotent), flag + org bound as params", async () => {
    await setOrgFeatureFlag("org_1", "inboxFollowUp", true)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const { sql, values } = captured()
    expect(sql).toContain("||") // jsonb concat
    expect(sql).toContain("@>") // containment guard → idempotent, no dup
    expect(sql).not.toContain("features - ") // not the remove branch
    expect(values).toContain("inboxFollowUp")
    expect(values).toContain("org_1")
  })

  it("REMOVE: jsonb minus, no read; flag + org bound as params", async () => {
    await setOrgFeatureFlag("org_1", "inboxFollowUp", false)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const { sql, values } = captured()
    expect(sql).toContain("features - ") // jsonb array minus a text element
    expect(sql).not.toContain("||")
    expect(values).toContain("inboxFollowUp")
    expect(values).toContain("org_1")
  })
})
