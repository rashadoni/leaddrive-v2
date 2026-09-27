import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("support calendar UX contract", () => {
  it("defaults narrow screens to a selected-day agenda without a fixed-width canvas", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    expect(page).toContain('className="grid grid-cols-7 gap-1 xl:hidden"')
    expect(page).toContain('className="rounded-xl border bg-card xl:hidden"')
    expect(page).toContain("itemsForCalendarDay")
    expect(page).not.toContain("min-w-[800px]")
  })

  it("compresses empty hours while retaining and naming work outside 07:00–19:00", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    const presentation = source("src/lib/support-calendar/presentation.ts")
    expect(page).toContain("isOutsideBusinessHours")
    expect(page).toContain("outsideHoursDetail")
    expect(presentation).toContain("BUSINESS_DAY_START = 7")
    expect(presentation).toContain("BUSINESS_DAY_END = 19")
    expect(page).not.toContain("HOURS.map")
  })

  it("uses one selected-day agenda rather than a duplicate permanent Today schedule", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    expect(page).toContain("selectedDate")
    expect(page).toContain("selected-day-title")
    expect(page).not.toContain("todaySchedule")
    expect(page).not.toContain("ColorStatCard")
  })

  it("opens every item from a semantic button into a focus-trapped detail drawer", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    expect(page).toContain("function CalendarItemButton")
    expect(page).toContain('<button type="button"')
    expect(page).toContain("function ItemDetailSheet")
    expect(page).toContain("<SheetContent")
    expect(page).toContain("!h-[100dvh]")
    expect(page).toContain("detailTriggerRef")
    expect(page).toContain("requestAnimationFrame(() => detailTriggerRef.current?.focus())")
    expect(page).not.toContain("hoveredItem")
  })

  it("names navigation controls and keeps every primary touch target at least 44px", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    expect(page).toContain('aria-label={t("previousWeek")}')
    expect(page).toContain('aria-label={t("nextWeek")}')
    expect(page).toContain("h-11 w-11")
    expect(page).toContain("min-h-11")
  })

  it("distinguishes total fetch error, permission, empty agenda and partial sources", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    const route = source("src/app/api/v1/calendar/agent/route.ts")
    expect(page).toContain("permissionDenied")
    expect(page).toContain("loadFailedTitle")
    expect(page).toContain("noItemsSelectedDay")
    expect(page).toContain("partialTitle")
    expect(route).toContain("CALENDAR_SOURCES_FAILED")
    expect(route).toContain("sources.activities")
  })

  it("uses non-color cues, theme tokens and reduced motion without decorative stripes", () => {
    const page = source("src/app/(dashboard)/support/calendar/page.tsx")
    expect(page).toContain("itemConfig")
    expect(page).toContain("motion-reduce:animate-none")
    expect(page).toContain("motion-reduce:transition-none")
    expect(page).not.toMatch(/border-l-(?:red|orange|yellow|green|blue|indigo|violet|amber|teal)/)
    expect(page).not.toMatch(/bg-(?:red|orange|yellow|green|blue|indigo|violet|amber|teal)-/)
    expect(page).not.toContain("bg-gradient")
    expect(page).not.toMatch(/text-(?:2xl|3xl|4xl)/)
  })
})
