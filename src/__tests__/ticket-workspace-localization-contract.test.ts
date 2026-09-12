import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const queueSource = readFileSync("src/app/(dashboard)/tickets/page.tsx", "utf8")
const detailSource = readFileSync("src/app/(dashboard)/tickets/[id]/page.tsx", "utf8")
const reportSource = readFileSync("src/components/tickets/ticketing-report.tsx", "utf8")
const chatHistorySource = readFileSync("src/components/tickets/chat-history-view.tsx", "utf8")
const dictionaries = ["az", "ru", "en"].map((locale) => ({
  locale,
  messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")),
}))

describe("ticket workspace localization contract", () => {
  it("labels every supported ticket priority, including legacy urgent values", () => {
    expect(queueSource).toContain('urgent: "bg-red-100')
    expect(detailSource).toContain('urgent: tc("priorityUrgent")')

    for (const { locale, messages } of dictionaries) {
      expect(messages.common.priorityUrgent, `${locale} urgent priority`).toBeTruthy()
    }
  })

  it("never exposes the raw category slug in the ticket header", () => {
    expect(detailSource).toContain("categoryLabel(ticket.category)")
    expect(detailSource).toContain('CATEGORY_LABELS[value] || t("unknownCategory")')
    expect(detailSource).not.toContain("CATEGORY_LABELS[ticket.category] || ticket.category")
    expect(detailSource).not.toContain('className="text-xs">{ticket.category}</Badge>')
  })

  it("uses localized safe fallbacks for unknown case metadata", () => {
    for (const key of [
      "unknownCompany",
      "unknownStatus",
      "unknownPriority",
      "unknownCategory",
      "unknownChannel",
      "unknownMilestoneType",
      "unknownMilestoneStatus",
      "unknownClosureStatus",
    ]) {
      expect(detailSource).toContain(`t("${key}")`)
      for (const { locale, messages } of dictionaries) {
        expect(messages.tickets[key], `${locale} tickets.${key}`).toBeTruthy()
      }
    }
    expect(detailSource).not.toContain("ticket.companyName || ticket.companyId")
    expect(detailSource).not.toMatch(/\|\| "(?:Macros|Calls|Recording|No calls yet)"/)
    expect(detailSource).toContain("callStatusLabel(call.status)")
    expect(detailSource).toContain('MILESTONE_TYPE_LABELS[milestone.type] || milestone.definitionName || t("unknownMilestoneType")')
    expect(detailSource).not.toContain("|| milestone.type}")
    expect(detailSource).not.toContain(">{call.status}</Badge>")
    expect(reportSource).toContain("priorityLabel(row.priority, t)")
    expect(reportSource).toContain("priorityLabel(ticket.priority, t)")
    expect(reportSource).not.toContain("return priority\n")
    expect(reportSource).not.toMatch(/return (?:status|priority|state|level|type|source)(?:\.replace[^\n]*)?\n/)
    expect(reportSource).toContain('whatsapp: "sourceWhatsapp"')
    expect(reportSource).toContain('return key ? t(key) : t("unknownLabel")')
  })

  it("keeps Russian ticket actions translated", () => {
    const ru = dictionaries.find(({ locale }) => locale === "ru")?.messages
    expect(ru.tickets.assignToMe).toBe("Назначить на себя")
    expect(ru.tickets.escalate).toBe("Эскалировать")
  })

  it("localizes transcript roles, empty copy and channel fallbacks without a rainbow palette", () => {
    for (const key of ["chatHistoryAssistant", "chatHistoryCustomer", "chatHistoryOperator", "chatHistoryWebChat", "chatHistoryChat", "chatHistoryEmpty", "chatHistoryEscalationReason", "chatHistorySessionLinked"]) {
      expect(chatHistorySource + detailSource).toContain(`t("${key}")`)
      for (const { locale, messages } of dictionaries) {
        expect(messages.tickets[key], `${locale} tickets.${key}`).toBeTruthy()
      }
    }
    expect(chatHistorySource).not.toContain('label: "Веб-чат"')
    expect(chatHistorySource).not.toContain('label: platform || "Чат"')
    expect(chatHistorySource).not.toContain("{parsed.category}")
    expect(chatHistorySource).not.toContain("{parsed.urgency}")
    expect(chatHistorySource).not.toContain("{parsed.triggers}")
    expect(chatHistorySource).not.toContain("parsed.session.slice")
    expect(chatHistorySource).not.toMatch(/border-(?:emerald|sky|violet|zinc)-|bg-(?:emerald|sky|violet|zinc)-/)
  })

  it("localizes entitlement levels and parsed chat enums", () => {
    for (const key of [
      "categorySales", "categoryAiEscalation", "categoryOther",
      "priorityNormal", "priorityUnknown", "supportLevelBasic",
      "supportLevelStandard", "supportLevelPremium", "supportLevelEnterprise",
      "supportLevelUnknown",
    ]) {
      expect(chatHistorySource + detailSource).toContain(`t("${key}")`)
      for (const { locale, messages } of dictionaries) {
        expect(messages.tickets[key], `${locale} tickets.${key}`).toBeTruthy()
      }
    }
    expect(detailSource).toContain("supportLevelLabel(ticket.entitlement.supportLevel)")
    expect(detailSource).not.toContain("{ticket.entitlement.supportLevel}")
  })

  it("uses the shared brand token for non-state report distributions and primary queue actions", () => {
    expect(reportSource.match(/bg-primary\/70/g)?.length).toBeGreaterThanOrEqual(4)
    expect(reportSource).not.toMatch(/bg-indigo-500\/70|bg-blue-500\/70|bg-green-500\/70/)
    expect(queueSource).not.toMatch(/tickets-(?:new|take-next)[\s\S]{0,180}bg-orange-/)
  })

  it("keeps ordinary ticket-detail actions on shared button tokens", () => {
    for (const testId of ["ticket-context-toggle", "ticket-send-message"]) {
      const start = detailSource.indexOf(`data-testid="${testId}"`)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(detailSource.slice(start, start + 500)).not.toContain("bg-orange-")
    }
    expect(detailSource).not.toContain('className="h-11 w-full bg-orange-700')
    expect(detailSource).not.toContain('className="h-11 bg-orange-500')
  })

  it("defaults AI assistance to the UI locale and then the customer's language", () => {
    expect(detailSource).toContain('useState(() => ["az", "ru", "en"].includes(locale) ? locale : "az")')
    expect(detailSource).toContain("setAiLang(json.data.contactPreferredLanguage)")
  })

  it("localizes Customer 360 ticket, deal and activity vocabulary", () => {
    expect(detailSource).toContain('STATUS_LABELS[rt.status] || t360("statusOther")')
    expect(detailSource).toContain("dealStageLabel(d.stage)")
    expect(detailSource).toContain('ACTIVITY_TYPE_LABELS[act.type.toLowerCase()] || t360("activityOther")')

    for (const { locale, messages } of dictionaries) {
      for (const key of ["activityCall", "activityEmail", "activityMeeting", "activityNote", "activityTask", "activityMessage", "activityOther", "statusOther", "stageOther"]) {
        expect(messages.customer360[key], `${locale} customer360.${key}`).toBeTruthy()
      }
    }
  })
})
