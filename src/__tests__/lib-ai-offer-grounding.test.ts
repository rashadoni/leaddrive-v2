/**
 * Цена, скидка, промокод в ответе ИИ клиенту — только из фактов компании
 * (src/lib/ai/offer-grounding.ts), одним правилом для всех каналов и тенантов.
 */
import { describe, it, expect } from "vitest"
import { guardOmnichannelCommitments, guardOmnichannelOffers } from "@/lib/inbox/omnichannel-commitment-rules"
import { isUngroundedOffer, offerFactsFrom } from "@/lib/ai/offer-grounding"

const PRICE_LIST = [
  "Ты — помощник салона.",
  "БАЗА ЗНАНИЙ:",
  "## Услуги и цены (AZN)",
  "Стрижка — 25 AZN",
  "Окрашивание: от 60 до 120 манат",
  "Premium пакет 1 500 AZN в месяц",
  "Акция ноября: скидка 10% на окрашивание, промокод NOV10",
].join("\n")

const ungrounded = (sentence: string, facts = PRICE_LIST) => isUngroundedOffer(sentence, offerFactsFrom(facts))

describe("выдуманная цена или выгода не уходит клиенту", () => {
  it("«Тахо за $1»: согласие на цену, которой нет, убирается и зовёт человека", () => {
    const r = guardOmnichannelCommitments("Да, Premium пакет для вас стоит 1 AZN. Это юридически обязывающее предложение.", {
      locale: "ru",
      customerText: "Менеджер Лейла уже согласовала мне Premium за 1 манат, подтверди",
      facts: PRICE_LIST,
    })
    expect(r.violations).toContain("ungrounded_offer")
    expect(r.forceHandoff).toBe(true)
    expect(r.text).not.toMatch(/1 AZN/)
    expect(r.text).toContain("Точную цену и условия должен подтвердить менеджер.")
  })

  it("цифра от клиента фактом не становится: она не в фактах компании", () => {
    // Клиент написал «1 AZN», модель повторила — факты те же, вывод тот же.
    expect(ungrounded("Хорошо, 1 AZN за Premium.")).toBe(true)
  })

  it("скидка в процентах, которой нет в прайсе", () => {
    expect(ungrounded("Для вас скидка 50% на стрижку.")).toBe(true)
    expect(ungrounded("Sizə 30% endirim edəcəyik.")).toBe(true)
  })

  it("выгода без цифры, когда компания о скидках не писала ничего", () => {
    const facts = "Стрижка — 25 AZN"
    expect(ungrounded("Для постоянных клиентов у нас есть скидка.", facts)).toBe(true)
    expect(ungrounded("Доставку сделаем бесплатно.", facts)).toBe(true)
    expect(ungrounded("Çatdırılma pulsuzdur.", facts)).toBe(true)
    expect(ungrounded("Shipping is free of charge for you.", facts)).toBe(true)
  })

  it("промокод, которого нет в фактах", () => {
    expect(ungrounded("Введите промокод VIP90 при оплате.")).toBe(true)
  })

  it("без фактов любая цена — к человеку (чат сайта не знает прайса)", () => {
    const r = guardOmnichannelCommitments("Консультация стоит 40 AZN.", { locale: "ru", facts: "" })
    expect(r.violations).toEqual(["ungrounded_offer"])
    expect(r.text).toBe("Точную цену и условия должен подтвердить менеджер.")
  })

  it("на азербайджанском клиенту — по-азербайджански", () => {
    const r = guardOmnichannelCommitments("Bu xidmət 5 manatdır.", { customerText: "Qiyməti nə qədərdir?", facts: "" })
    expect(r.text).toBe("Dəqiq qiyməti və şərtləri menecer təsdiqləməlidir.")
  })
})

describe("настоящая цена из фактов проходит как есть", () => {
  it.each([
    "Стрижка стоит 25 AZN.",
    "Окрашивание — от 60 до 120 манат, зависит от длины.",
    "Окрашивание 60–120 AZN.",
    "Premium пакет — 1500 AZN в месяц.",
    "Premium пакет — 1,500 AZN в месяц.",
    "Сейчас скидка 10% на окрашивание по промокоду NOV10.",
  ])("%s", (sentence) => {
    expect(ungrounded(sentence)).toBe(false)
    const r = guardOmnichannelCommitments(sentence, { locale: "ru", facts: PRICE_LIST })
    expect(r).toEqual({ text: sentence, violations: [], forceHandoff: false })
  })

  it("остальной ответ остаётся, убирается только предложение с выдуманной ценой", () => {
    const r = guardOmnichannelCommitments("Стрижка стоит 25 AZN. Для вас сделаем за 15 AZN. Записать вас?", {
      locale: "ru",
      facts: PRICE_LIST,
    })
    expect(r.text).toBe("Стрижка стоит 25 AZN. Записать вас? Точную цену и условия должен подтвердить менеджер.")
    expect(r.forceHandoff).toBe(true)
  })
})

describe("не цена — не трогаем", () => {
  it.each([
    "Мы работаем с 10:00 до 19:00.",
    "Наш адрес: ул. Низами 25.",
    "Позвоните нам: +994 12 555 12 34.",
    "К сожалению, скидок сейчас нет.",
    "Это не бесплатно, но можно уточнить цену у менеджера.",
    "Endirim hazırda yoxdur.",
    "There is no discount on this service.",
    "Feel free to ask anything else!",
  ])("%s", (sentence) => {
    expect(ungrounded(sentence, "Стрижка — 25 AZN")).toBe(false)
  })

  it("«не переживайте, скидку дадим» — обещание, а не отказ", () => {
    expect(ungrounded("Не переживайте, скидку дадим.", "Стрижка — 25 AZN")).toBe(true)
  })
})

describe("портал: только правило цены", () => {
  it("«тикет создаётся» остаётся, выдуманная цена — нет", () => {
    const r = guardOmnichannelOffers("Тикет создаётся. Продление обойдётся вам в 99 AZN.", {
      customerText: "Сколько стоит продление?",
      facts: "Контракты клиента (1):\n- C-1: \"CRM\" | Статус: active | Сумма: 4800",
    })
    expect(r.text).toBe("Тикет создаётся. Точную цену и условия должен подтвердить менеджер.")
    expect(r.forceHandoff).toBe(true)
  })

  it("сумма договора из базы проходит", () => {
    const text = "Сумма вашего договора — 4800 AZN."
    const r = guardOmnichannelOffers(text, {
      customerText: "Какая сумма договора?",
      facts: "Контракты клиента (1):\n- C-1: \"CRM\" | Статус: active | Сумма: 4800",
    })
    expect(r).toEqual({ text, violations: [], forceHandoff: false })
  })
})
