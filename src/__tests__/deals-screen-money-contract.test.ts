import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Экран сделок на app.leaddrivecrm.org показывал одни и те же деньги тремя
 * способами: карточка «1 735 782 ₼», шапки колонок канбана в «$» и сами
 * карточки сделок в «USD» и «AZN» вперемешку. Ни одно из этих чисел не
 * сходилось с другим, потому что каждое место складывало разные валюты и
 * подписывало сумму своим символом.
 *
 * Тест сторожит не вёрстку, а решения, которые легко потерять при следующей
 * правке: символ валюты берётся из данных, суммы не складываются между
 * валютами, а рядом с настоящими числами не стоят выдуманные.
 */
const page = readFileSync("src/app/(dashboard)/deals/page.tsx", "utf8")
const kanban = readFileSync("src/components/deals/kanban-board.tsx", "utf8")
const card = readFileSync("src/components/deals/deal-card.tsx", "utf8")
const analytics = readFileSync("src/components/deals/deals-analytics.tsx", "utf8")
const route = readFileSync("src/app/api/v1/deals/route.ts", "utf8")

describe("currency symbols come from the data, not from a literal", () => {
  it("has no hardcoded manat sign left on the deals screen", () => {
    // Именно этот литерал подписывал манатом сумму, в которой лежали доллары.
    expect(page).not.toContain("₼")
    expect(analytics).not.toContain("₼")
    expect(analytics).not.toMatch(/\\u20BC/)
  })

  it("formats every board total through the shared bucket formatter", () => {
    expect(page).toContain('from "@/lib/deal-money"')
    expect(kanban).toContain('from "@/lib/deal-money"')
    expect(card).toContain('from "@/lib/deal-money"')
  })

  it("stops the kanban column header from defaulting the symbol", () => {
    // `fmtAmount(total)` без второго аргумента берёт NEXT_PUBLIC_DEFAULT_CURRENCY
    // (в проде — USD), поэтому колонки писали «$» над манатными карточками.
    expect(kanban).not.toMatch(/fmtAmount\(\s*total\s*\)/)
    expect(kanban).toContain("bucketByCurrency(stageDeals)")
  })

  it("prints a symbol on the deal card instead of the raw ISO code", () => {
    expect(card).not.toMatch(/\$\{deal\.currency\}/)
    expect(card).toContain("formatAmount(deal.valueAmount || 0, deal.currency)")
  })
})

describe("nothing on the screen is labelled with a currency it is not in", () => {
  it("gives every legend chip the currency of its own stage", () => {
    // Закрытые стадии сервер не считает: их суммы берутся из загруженных
    // сделок. Подписать выигранный доллар манатом главной воронки — это тот
    // же дефект, только на 300 пикселей правее.
    expect(page).toContain("{formatBucket({ currency: stage.currency, value: stage.value, count: stage.count })}")
    expect(page).toContain("showMoney: stageBuckets.length <= 1")
  })

  it("says out loud when Won hides money in another currency", () => {
    expect(page).toContain("wonExtrasLabel")
  })

  it("hands the analytics tab one currency, not a mix", () => {
    // Все графики там строятся из одного массива; смесь валют снова дала бы
    // сумму, которой нет — только под уверенным символом.
    expect(page).toContain("deals={analyticsDeals.map(")
    expect(page).toContain("pipelineValue={pipelinePrimary.value}")
    expect(page).toContain("excludedNote={analyticsExcluded > 0")
    // Старые кросс-валютные суммы удалены, а не оставлены под рукой.
    expect(page).not.toMatch(/const totalValue = deals\.reduce/)
    expect(page).not.toMatch(/const wonValue = wonDeals\.reduce/)
  })

  it("counts the reset chip from the same numbers as the stage chips", () => {
    // «Все 200» рядом со стадиями, суммирующимися в 340, — это две разные
    // выборки в одной строке.
    expect(page).toContain("{legendTotalCount}")
    expect(page).toContain("const legendTotalCount = legendStages.reduce(")
  })

  it("keeps the stage filter on screen when the open pipeline is empty", () => {
    // Полоса живёт из серверной сводки по открытым сделкам. Если фильтр
    // рисовать вместе с ней, при пустой открытой воронке сбросить стадию,
    // восстановленную из сохранённого представления, будет нечем.
    expect(page).toContain("{legendStages.length > 0 && (")
  })
})

describe("the server hands the client a per-currency breakdown", () => {
  it("groups the open pipeline by currency", () => {
    expect(route).toContain("byCurrency:")
    expect(route).toMatch(/select: \{[^}]*currency: true/)
  })

  it("carries weighted per currency, so the secondary metric matches the lead one", () => {
    // Без этого «Çəkili» пришлось бы брать из общей суммы всех валют —
    // то есть снова из числа, которого нет.
    expect(route).toMatch(/currencyMap\[code\]\.weighted \+=/)
  })
})

describe("no invented numbers stand next to measured ones", () => {
  it("drops the hardcoded KPI deltas from the analytics tab", () => {
    // Четыре зелёные стрелки роста были литералами: они не считались ни из
    // чего и не менялись ни от каких данных.
    for (const invented of ['"+22%"', '"+5.1%"', '"+8%"', "`-3 ${t(\"days\")}`"]) {
      expect(analytics).not.toContain(invented)
    }
  })
})

describe("the screen shows data before it shows controls", () => {
  it("keeps a single summary card instead of four equal stat cards", () => {
    // «İtirildi 1» весило столько же, сколько вся воронка на 1.7 млн.
    expect(page).not.toContain("ColorStatCard")
    expect(page).toContain('data-tour-id="deals-summary"')
    // Тур целится в этот блок — идентификатор обязан пережить перекладку.
    expect(page.match(/data-tour-id="deals-summary"/g)).toHaveLength(1)
  })

  it("names every stage once — the legend under the bar IS the stage filter", () => {
    // Раньше стадии перечислялись трижды: полоса чипов над доской, сама полоса
    // воронки и подпись под ней. Осталось одно место.
    expect(page).toContain('setStageFilter(active ? "all" : stage.name)')
    // Негативный якорь: разметка прежней полосы чипов. Без него тест выше
    // пройдёт и в тот день, когда чипы вернут обратно рядом с легендой.
    expect(page).not.toContain('"rounded-full border border-zinc-200 dark:border-zinc-700 text-sm px-3 py-1 transition-all"')
    expect(page).not.toContain("{tc(\"all\")} ({deals.length})")
  })

  it("keeps the stage filter available in list view, not only on the board", () => {
    // Фильтр по стадиям уехал внутрь карточки сводки; если карточку вернут в
    // ветку канбана, список останется вообще без фильтра по стадиям.
    const summaryAt = page.indexOf('data-tour-id="deals-summary"')
    const kanbanBranchAt = page.indexOf("── KANBAN VIEW ──")
    expect(summaryAt).toBeGreaterThan(0)
    expect(kanbanBranchAt).toBeGreaterThan(0)
    expect(summaryAt).toBeLessThan(kanbanBranchAt)
    expect(page).toContain('{(tab === "kanban" || tab === "list") && (')
  })

  it("shows the AI button only on the tab it leads to", () => {
    expect(page).toMatch(/\{tab === "analytics" && \(\s*\n\s*<div className="flex flex-wrap gap-2">/)
    expect(page).toContain('{aiOpen && tab === "analytics" && (')
  })
})

describe("Azerbaijani wording matches the page title", () => {
  it("calls the pipeline бору xətti, the way the page heading does", () => {
    const az = JSON.parse(readFileSync("messages/az.json", "utf8"))
    expect(az.deals.title).toBe("Satış boru xətti")
    expect(az.deals.statPipelineValue).not.toContain("Huni")
    // Тот же показатель на вкладке «Аналитика» — того же экрана.
    expect(az.dealsAnalytics.pipelineValue).not.toContain("Huni")
    // Ключи, осиротевшие вместе с удалёнными карточками метрик и полосой
    // чипов: мёртвая строка переживает любую смену терминологии молча.
    expect(az.deals.pipelineBar).toBeUndefined()
    expect(az.deals.statTotal).toBeUndefined()
    expect(az.deals.hintTotalDeals).toBeUndefined()
  })

  it("explains a mixed-currency board in every language", () => {
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.deals.mixedCurrencyHint).toBeTruthy()
    }
  })
})
