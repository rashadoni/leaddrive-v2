import { describe, it, expect } from "vitest"
import {
  conversationChannelOR, conversationChannelSql, RESOLVED_CHANNEL_SQL,
} from "@/lib/inbox-analytics-filters"

/**
 * Locks the tenant-/channel-sensitive filter contract shared by /analytics, /frt, /team.
 * The point: a conversation's REAL channel is `platform` for social channels but lives in
 * `metadata.channel` for email/sms/web-chat (bucketed under platform "inbox"). A filter must
 * match BOTH arms — never a bare `platform = channel` (which never exists for email/sms).
 */
describe("conversationChannelOR (typed Prisma filter)", () => {
  it("matches the platform arm OR the inbox-bucket metadata.channel arm", () => {
    expect(conversationChannelOR("email")).toEqual([
      { platform: "email" },
      { platform: "inbox", metadata: { path: ["channel"], equals: "email" } },
    ])
  })
})

describe("conversationChannelSql (raw filter)", () => {
  it("binds the channel as a parameter twice (no string interpolation → no injection)", () => {
    const sql = conversationChannelSql("sms")
    expect(sql.values).toEqual(["sms", "sms"]) // platform = $ OR metadata->>'channel' = $
  })
})

describe("RESOLVED_CHANNEL_SQL", () => {
  it("resolves via COALESCE(NULLIF(platform,'inbox'), metadata->>'channel', 'unknown')", () => {
    const text = RESOLVED_CHANNEL_SQL.strings.join("")
    expect(text).toContain("COALESCE")
    expect(text).toContain("NULLIF(platform, 'inbox')")
    expect(text).toContain("metadata->>'channel'")
  })
})
