import { describe, expect, it } from "vitest"
import { escalationNotificationLocale, escalationNotificationText } from "@/lib/escalation-rules/notification-text"

const input = { level: 2, ticketNumber: "SUP-1042", subject: "Не открывается портал", triggerType: "resolution_breach", ruleName: "Срок решения" }

describe("escalation notification text", () => {
  it("is written in the recipient's language", () => {
    expect(escalationNotificationText("ru", input)).toEqual({
      title: "Эскалация SLA, уровень 2: SUP-1042",
      message: "«Не открывается портал» — нарушен срок решения. Правило: Срок решения",
    })
    expect(escalationNotificationText("en", input).title).toBe("SLA escalation, level 2: SUP-1042")
    expect(escalationNotificationText("az", input).message).toBe("«Не открывается портал» — həll müddəti pozulub. Qayda: Срок решения")
  })

  it("falls back to the app default language when the user has not chosen one", () => {
    expect([escalationNotificationLocale(null), escalationNotificationLocale(undefined), escalationNotificationLocale("de")]).toEqual(["ru", "ru", "ru"])
    expect(escalationNotificationText(null, input).title).toBe("Эскалация SLA, уровень 2: SUP-1042")
  })

  it("names every trigger a rule can have and never prints the raw code", () => {
    const messages = ["first_response_breach", "resolution_breach", "resolution_warning", "something_new"]
      .map((triggerType) => escalationNotificationText("ru", { ...input, triggerType }).message)

    expect(messages.filter((message) => /[a-z]_[a-z]/.test(message))).toEqual([])
    expect(new Set(messages).size).toBe(4)
  })
})
