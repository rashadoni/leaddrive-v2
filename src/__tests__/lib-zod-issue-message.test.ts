import { describe, expect, it } from "vitest"
import { z } from "zod"

import { firstIssueMessage } from "@/lib/zod-issue-message"

describe("firstIssueMessage", () => {
  it("prefixes the failing field so the caller knows where to look", () => {
    const schema = z.object({ primaryBrand: z.object({ website: z.string().url() }) })
    const result = schema.safeParse({ primaryBrand: { website: "not a url" } })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstIssueMessage(result.error)).toMatch(/^primaryBrand\.website: /)
  })

  it("keeps array indexes in the path", () => {
    const schema = z.object({ channels: z.array(z.enum(["email", "webchat"])) })
    const result = schema.safeParse({ channels: ["email", "sms"] })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstIssueMessage(result.error)).toMatch(/^channels\.1: /)
  })

  it("returns the bare message when the issue has no path", () => {
    const schema = z.string()
    const result = schema.safeParse(42)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(firstIssueMessage(result.error)).toBe(result.error.issues[0].message)
    expect(firstIssueMessage(result.error)).not.toMatch(/^: /)
  })

  it("falls back to a message when a caller hands over an empty issue list", () => {
    expect(firstIssueMessage({ issues: [] })).toBe("Invalid input")
  })

  // Not tested here on purpose: that zod's messages carry a reason at all. Under
  // vitest they always do — nothing is tree-shaken — so a test asserting it
  // would pass exactly when the production bundle is broken. That regression is
  // guarded where it happens, in the deploy workflow's build verification.
})
