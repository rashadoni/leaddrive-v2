import { describe, expect, it } from "vitest"
import { isAutoLeadConfigured } from "@/components/settings/inbox-agent-editor"
import {
  INBOX_QUALIFICATION_BOARD_PREFIX,
  INBOX_QUALIFICATION_FLAG,
} from "@/lib/chatbot-engine"

describe("InboxAgentEditor autonomous lead configuration", () => {
  it("stays disabled when no destination board was configured", () => {
    expect(isAutoLeadConfigured(true, [])).toBe(false)
    expect(isAutoLeadConfigured(true, [INBOX_QUALIFICATION_FLAG])).toBe(false)
  })

  it("stays disabled when only a board flag exists", () => {
    expect(isAutoLeadConfigured(true, [
      `${INBOX_QUALIFICATION_BOARD_PREFIX}marketing`,
    ])).toBe(false)
  })

  it("is enabled only when the config, feature, and board agree", () => {
    expect(isAutoLeadConfigured(true, [
      INBOX_QUALIFICATION_FLAG,
      `${INBOX_QUALIFICATION_BOARD_PREFIX}marketing`,
    ])).toBe(true)
  })
})
