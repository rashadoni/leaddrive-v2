import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(
  "src/app/(dashboard)/leads/[id]/page.tsx",
  "utf8",
)

describe("lead detail responsive layout", () => {
  it("uses two columns and keeps AI context in the left overview rail", () => {
    expect(source).toContain(
      "lg:grid-cols-[290px_minmax(0,1fr)] lg:[grid-template-areas:'overview_main']",
    )
    expect(source).not.toContain("grid-area:ai")
    expect(source).not.toContain(
      "xl:grid-cols-[290px_minmax(0,1fr)_340px]",
    )

    const overviewStart = source.indexOf(
      'className="space-y-4 [grid-area:overview] min-w-0"',
    )
    const advisor = source.indexOf("<AdvisorRecordWidget", overviewStart)
    const mainStart = source.indexOf(
      'className="space-y-6 [grid-area:main] min-w-0"',
      overviewStart,
    )

    expect(overviewStart).toBeGreaterThan(-1)
    expect(advisor).toBeGreaterThan(overviewStart)
    expect(mainStart).toBeGreaterThan(advisor)
  })

  it("wraps lead tabs instead of requiring horizontal scrolling", () => {
    expect(source).toContain(
      '<div className="flex flex-wrap gap-x-1 border-b">',
    )
  })

  it("never lets the action buttons squeeze the lead's name", () => {
    // The title and the row of actions used to share a line on lg. The title
    // carried `flex-1 min-w-0`, so it was allowed to shrink to nothing while
    // the buttons were not — seven of them with Azerbaijani labels took the
    // whole width and "Azar Aliyev" rendered as "Aliyev", the first name
    // hidden behind the buttons.
    //
    // Asserted as "they do not share a line" rather than "the title has a
    // minimum width": a minimum only moves the failure to the next label that
    // grows, and labels grow every time a feature adds a button.
    const header = source.slice(
      source.indexOf("{/* Title on its own line"),
      source.indexOf("{/* Wraps within its own line"),
    )
    expect(header).toBeTruthy()
    expect(header).toContain('<div className="flex flex-col gap-4">')
    expect(header).not.toContain("lg:flex-row")
    // The title block must not be a shrink-to-zero flex child any more.
    expect(header).not.toContain("flex min-w-0 flex-1 items-start gap-3")
    expect(header).toContain('<div className="flex min-w-0 items-start gap-3">')
    // And the actions take a full line of their own to wrap inside.
    expect(source).toContain(
      '<div className="flex w-full flex-wrap items-center gap-2">',
    )
  })
})
