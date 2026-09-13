import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-07 / two items of the C8 tail — both measured
 * on production 2026-09-10 in the planner opened through the owner's browser,
 * and both still reproducing at the time.
 *
 *   1. "карточки каталога кеглем 10–11 с обрезанным текстом" — the category
 *      badge rendered at 10 px and the last-visit line at 11. The last visit
 *      is not decoration: it is what a supervisor reads to decide whom to add
 *      to the route, and 11 px is below the floor this plan set for itself
 *      when it raised the app's tab captions to 12 (B18, RUX-703).
 *
 *   2. "«Ləğv et» закрывает окно с выбранными точками без подтверждения" —
 *      one customer chosen, Cancel pressed, planner gone, no dialog.
 *
 * Numeric badges — the step digit, the active-filter count — stay small on
 * purpose: a digit in a pill is a marker, not copy.
 */
const BUILDER = "src/components/mtm/route-builder.tsx"
const builder = readFileSync(BUILDER, "utf8")

describe("C8: the catalogue is readable and cancel asks first", () => {
  it("stops setting candidate-card copy below 12 px", () => {
    const card = builder.slice(builder.indexOf('data-testid="mtm-route-candidate"'), builder.indexOf('data-testid="mtm-route-candidate-availability"') + 2000)
    expect(card).not.toContain("text-[10px]")
    expect(card).not.toContain("text-[11px]")
    expect(builder).toContain('<span className="shrink-0 border border-zinc-200 px-1.5 py-0.5 text-xs font-medium text-muted-foreground dark:border-zinc-700">')
    expect(builder).toContain('<span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">')
  })

  it("asks before throwing a non-empty selection away", () => {
    expect(builder).toContain("const requestClose = () => {")
    expect(builder).toContain("if (stops.length > 0) {")
    expect(builder).toContain("setDiscardOpen(true)")
    // Both ways out of the planner go through the guard, not just the footer.
    expect(builder).toContain('data-testid="mtm-route-builder-cancel" onClick={requestClose}')
    expect(builder).toContain('data-testid="mtm-route-builder-close" onClick={requestClose}')
    expect(builder).not.toContain('data-testid="mtm-route-builder-cancel" onClick={onClose}')
  })

  it("still closes an empty planner on one press", () => {
    // A confirmation on an empty form is a second click for nothing.
    const guard = builder.slice(builder.indexOf("const requestClose = () => {"), builder.indexOf("const requestClose = () => {") + 220)
    expect(guard).toContain("onClose()")
  })

  it("names how much is at stake in all three languages", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const page = messages.mtmRoutesPage ?? {}
      for (const key of ["discardBuilderTitle", "discardBuilderBody", "discardBuilderConfirm"]) {
        if (typeof page[key] !== "string" || !page[key].trim()) missing.push(`${locale}.${key}`)
      }
      if (typeof page.discardBuilderBody === "string" && !page.discardBuilderBody.includes("{count}")) {
        missing.push(`${locale}.discardBuilderBody has no {count}`)
      }
    }
    expect(missing).toEqual([])
  })
})

/**
 * The last item of the C8 tail: "шаг 3 — публикация без времён требует явного
 * подтверждения". Read from production code 2026-09-13: step 3's primary
 * button went straight to `save("publish")`, and the publish route accepts a
 * null `plannedTime` — so one press sent untimed meetings to the employee's
 * app. The step already showed "Fill empty times from 09:00" and nothing
 * stopped anyone from walking past it.
 */
describe("C8: publishing untimed meetings asks first", () => {
  const runner = builder.slice(builder.indexOf("function runPrimaryAction() {"), builder.indexOf("const primaryActionLabel ="))

  it("stops the primary action before publish while any meeting has no time", () => {
    const guard = runner.indexOf("if (canPublishFromBuilder && unscheduledStopCount > 0) {")
    const publish = runner.indexOf('void save(canPublishFromBuilder ? "publish" : "draft")')
    expect(guard).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(guard)
    expect(runner.slice(guard, publish)).toContain("setUntimedPublishOpen(true)")
    expect(runner.slice(guard, publish)).toContain("return")
  })

  it("publishes only from the confirmation, and a draft is not asked about", () => {
    const dialog = builder.slice(builder.indexOf("open={untimedPublishOpen}"), builder.indexOf("open={untimedPublishOpen}") + 600)
    expect(dialog).toContain('save("publish")')
    expect(dialog).toContain("count: unscheduledStopCount")
    // Nobody but the planner sees a draft, so saving one stays a single press.
    expect(builder).toContain('onClick={() => void save("draft")}')
  })

  it("says how many meetings are untimed in all three languages", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const page = messages.mtmRoutesPage ?? {}
      for (const key of ["untimedPublishTitle", "untimedPublishBody", "untimedPublishConfirm"]) {
        if (typeof page[key] !== "string" || !page[key].trim()) missing.push(`${locale}.${key}`)
      }
      const body = typeof page.untimedPublishBody === "string" ? page.untimedPublishBody : ""
      if (!body.includes("{total}")) missing.push(`${locale}.untimedPublishBody has no {total}`)
      if (!/\{count[,}]/.test(body) && !body.includes("# ")) missing.push(`${locale}.untimedPublishBody has no count`)
    }
    expect(missing).toEqual([])
  })
})
