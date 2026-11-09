/**
 * Da Vinci picks the answering agent by the question's words (2026-11-09,
 * owner: "по словам"), not by a model call the first word waited 1.1–1.6 s
 * for. Real staff questions in the three languages of the product.
 */
import { describe, it, expect } from "vitest"
import { classifyIntent, type Intent } from "@/lib/ai/intent-classifier"

const CASES: Array<[string, Intent]> = [
  // ru
  ["Покажи сделки на этапе переговоров", "sales_inquiry"],
  ["Какие лиды пришли сегодня?", "sales_inquiry"],
  ["Сделай скидку 10% для этого клиента", "sales_inquiry"],
  ["Какие тикеты просрочены?", "support_request"],
  ["У клиента ошибка при входе, не работает приложение", "support_request"],
  ["Выстави счёт на оплату для ATS Food", "billing_question"],
  ["Кто не оплатил подписку?", "billing_question"],
  ["Запусти email-рассылку по сегменту VIP", "marketing_info"],
  ["Какой прогноз на следующий квартал?", "data_analysis"],
  ["Привет! Ты на связи?", "general"],
  ["Создай задачу позвонить Айсель завтра", "general"],
  // az
  ["Bu ay neçə sövdələşmə bağlanıb?", "sales_inquiry"],
  ["Açıq tiketləri göstər", "support_request"],
  ["Hansı fakturalar ödənilməyib?", "billing_question"],
  ["Yeni reklam kampaniyası hazırla", "marketing_info"],
  ["Satış üzrə proqnoz və hesabat", "data_analysis"],
  ["İş günün necə keçir?", "general"],
  // en
  ["What is your pricing for 50 users?", "sales_inquiry"],
  ["The export is broken again", "support_request"],
  ["Send the overdue invoice to Acme", "billing_question"],
  ["How did the newsletter campaign perform?", "marketing_info"],
  ["Build me a dashboard of KPIs", "data_analysis"],
  ["Hello there", "general"],
]

describe("classifyIntent — by the question's words", () => {
  it.each(CASES)("%s → %s", (message, intent) => {
    expect(classifyIntent(message).intent).toBe(intent)
  })

  it("does not match a word inside another word", () => {
    // "лидер" is not "лид", "оценка" is not "цена", "salesforce" is not "sales".
    expect(classifyIntent("Кто лидер команды?").intent).toBe("general")
    expect(classifyIntent("Дай оценка работе").intent).toBe("general")
    expect(classifyIntent("Import from Salesforce").intent).toBe("general")
  })

  it("is sure only when the words say so", () => {
    expect(classifyIntent("Hello").confidence).toBe(0.5)
    expect(classifyIntent("Покажи сделки в воронке").confidence).toBeGreaterThan(0.5)
  })
})
