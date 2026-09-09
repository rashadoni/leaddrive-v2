import { describe, it, expect } from "vitest"
import { aiReplyEnabled } from "@/lib/inbox/reply-mode"

describe("aiReplyEnabled", () => {
  describe("opt-in channels (default — TikTok/FB/IG/Telegram/VK)", () => {
    it("runs ONLY on explicit 'ai'; unset/agent/blank → no AI", () => {
      expect(aiReplyEnabled("ai")).toBe(true)
      expect(aiReplyEnabled("agent")).toBe(false)
      expect(aiReplyEnabled(undefined)).toBe(false)
      expect(aiReplyEnabled(null)).toBe(false)
      expect(aiReplyEnabled("")).toBe(false)
    })
  })

  describe("default-on channels (WhatsApp Da Vinci)", () => {
    it("runs UNLESS explicitly 'agent' — preserves the live default-on behavior (no regression)", () => {
      expect(aiReplyEnabled(undefined, true)).toBe(true) // unset → still ON (the 4 live tenants)
      expect(aiReplyEnabled(null, true)).toBe(true)
      expect(aiReplyEnabled("ai", true)).toBe(true)
      expect(aiReplyEnabled("agent", true)).toBe(false) // the only off-switch
    })
  })
})
