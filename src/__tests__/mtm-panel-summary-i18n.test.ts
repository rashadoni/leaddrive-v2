import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

/**
 * The summary line of the /mtm Panel rendered through next-intl, so the
 * Russian plural forms («3 смены не закрыты», «5 смен не закрыто», «Не начал
 * 21 сотрудник») are checked as sentences, not as ICU source text.
 */
const NAMESPACE = "mtmDashboardPage.operationalWeek"

function translator(locale: "ru" | "az" | "en") {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  return createTranslator({ locale, messages, namespace: NAMESPACE })
}

describe("Panel summary line in Russian", () => {
  const t = translator("ru")

  it("declines open shifts by count and carries the server's duration", () => {
    expect(t("summaryOpenShifts", { count: 3, duration: t("workdayOpenDays", { count: 19 }) })).toBe("3 смены не закрыты, самая старая 19 дней")
    expect(t("summaryOpenShifts", { count: 1, duration: t("workdayOpenDays", { count: 19 }) })).toBe("1 смена не закрыта — 19 дней")
    expect(t("summaryOpenShifts", { count: 5, duration: t("workdayOpenHours", { count: 17 }) })).toBe("5 смен не закрыто, самая старая 17 часов")
    // CLDR `one` covers 21, 31, 101…: only exactly one shift may drop «самая старая».
    expect(t("summaryOpenShifts", { count: 21, duration: t("workdayOpenDays", { count: 19 }) })).toBe("21 смена не закрыта, самая старая 19 дней")
  })

  it("folds idle agents into one declined line", () => {
    expect(t("teamIdleCollapsed", { count: 14 })).toBe("Не начали 14 сотрудников")
    expect(t("teamIdleCollapsed", { count: 21 })).toBe("Не начал 21 сотрудник")
    expect(t("teamIdleCollapsed", { count: 3 })).toBe("Не начали 3 сотрудника")
    expect(t("teamIdleNoActivity", { count: 14 })).toBe("14 сотрудников без активности")
  })

  it("declines plans, alerts and the field count", () => {
    expect(t("summaryWithoutPlan", { count: 5 })).toBe("без плана 5 сотрудников")
    expect(t("teamRowOpenAlerts", { count: 18 })).toBe("18 открытых оповещений")
    expect(t("teamRowOpenAlerts", { count: 1 })).toBe("1 открытое оповещение")
    expect(t("summaryInField", { count: 0, total: 17 })).toBe("В поле 0 из 17")
  })
})

describe("Panel summary line in Azerbaijani and English", () => {
  it("renders the open-shift sentence", () => {
    const az = translator("az")
    expect(az("summaryOpenShifts", { count: 3, duration: az("workdayOpenDays", { count: 19 }) })).toBe("3 növbə bağlanmayıb, ən köhnəsi 19 gün")
    const en = translator("en")
    expect(en("summaryOpenShifts", { count: 1, duration: en("workdayOpenDays", { count: 19 }) })).toBe("1 shift not closed — 19 days")
  })
})
