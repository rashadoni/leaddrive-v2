import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { describe, expect, it } from "vitest"

/**
 * Counted sentences of the /mtm Panel rendered through next-intl, so the
 * Russian plural forms («19 дней», «1 открытое оповещение») are checked as
 * sentences, not as ICU source text.
 *
 * Until 2026-10-11 this file rendered the Panel's one-line team summary
 * («3 смены не закрыты, самая старая 19 дней», «Не начали 14 сотрудников»).
 * The home screen replaced that line and its texts left the catalogue, so
 * what is rendered here is what a screen still draws: the shift an agent left
 * open (`leftOpenLabel` in operational-week-home.tsx) and the alert count of
 * a row of the team card (home-team-card.tsx).
 */
const NAMESPACE = "mtmDashboardPage.operationalWeek"

function translator(locale: "ru" | "az" | "en") {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  return createTranslator({ locale, messages, namespace: NAMESPACE })
}

describe("Panel counted sentences in Russian", () => {
  const t = translator("ru")

  it("carries the declined duration of a shift the agent left open", () => {
    expect(t("workdayLeftOpen", { date: "14 сент.", time: "09:12", duration: t("workdayOpenDays", { count: 19 }) })).toBe("Смена открыта с 14 сент. 09:12 (19 дней) — агент не закрыл")
    expect(t("workdayLeftOpen", { date: "14 сент.", time: "09:12", duration: t("workdayOpenHours", { count: 17 }) })).toBe("Смена открыта с 14 сент. 09:12 (17 часов) — агент не закрыл")
  })

  it("declines the open alerts of a team card row", () => {
    expect(t("teamRowOpenAlerts", { count: 18 })).toBe("18 открытых оповещений")
    expect(t("teamRowOpenAlerts", { count: 1 })).toBe("1 открытое оповещение")
  })
})

describe("Panel counted sentences in Azerbaijani and English", () => {
  it("renders the left-open shift sentence", () => {
    const az = translator("az")
    expect(az("workdayLeftOpen", { date: "14 sen", time: "09:12", duration: az("workdayOpenDays", { count: 19 }) })).toBe("Növbə 14 sen 09:12-dən açıqdır (19 gün) — agent bağlamayıb")
    const en = translator("en")
    expect(en("workdayLeftOpen", { date: "Sep 14", time: "09:12", duration: en("workdayOpenDays", { count: 1 }) })).toBe("Shift open since Sep 14 09:12 (1 day) — not closed by the agent")
  })
})
