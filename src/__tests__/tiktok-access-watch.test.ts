/**
 * The watch that is supposed to notice the day TikTok starts issuing Business Messaging access.
 *
 * It exists because TikTok said it will not tell us (support, 2026-11-22), and it is only useful if
 * it stays readable: the changelog it watches changes every single week, so a watch that reports
 * every change would be muted by the third Monday and would then miss the one line that matters.
 * These are the rules that keep it quiet, checked against the page text it actually reads.
 */
import { describe, expect, it } from "vitest"

// The watcher is a standalone script: the timer runs it with node, so it has no imports from src.
import { decide, decidePage, digest, normalise, WATCHED_PAGES } from "../../scripts/tiktok/watch-business-messaging.mjs"

const product = WATCHED_PAGES.find((page: { key: string }) => page.key === "business-messaging")!
const changelog = WATCHED_PAGES.find((page: { key: string }) => page.key === "whats-new")!

/** A page as the watch remembers it: the stored hash is always the real one. */
const seen = (lines: string[], failures = 0) => ({ hash: digest(lines.join("\n")), lines, failures })

describe("the first look", () => {
  it("says nothing, because it has nothing to compare with", () => {
    const verdict = decidePage({ page: product, previous: undefined, current: ["TikTok Business Messaging API is a suite of interfaces"], failure: undefined })
    expect(verdict.alerts).toEqual([])
    expect(verdict.state.hash).toBeTruthy()
  })
})

describe("the product's own page", () => {
  const before = ["TikTok Business Messaging API is a suite of interfaces", "Contact your TikTok representative."]

  it("stays silent while the words stay the same", () => {
    const verdict = decidePage({ page: product, previous: seen(before), current: [...before], failure: undefined })
    expect(verdict.alerts).toEqual([])
  })

  it("shouts when a new line is about access or applications", () => {
    const verdict = decidePage({
      page: product,
      previous: seen(before),
      current: [...before, "You can now submit an application for Business Messaging access."],
      failure: undefined,
    })
    expect(verdict.alerts).toHaveLength(1)
    expect(verdict.alerts[0].level).toBe("open")
    // The sentence itself travels, so the owner decides without opening anything.
    expect(verdict.alerts[0].text).toContain("submit an application")
  })

  it("mentions an ordinary edit once, quietly", () => {
    const verdict = decidePage({ page: product, previous: seen(before), current: [...before, "The API supports text and media."], failure: undefined })
    expect(verdict.alerts.map((a: { level: string }) => a.level)).toEqual(["info"])
  })
})

describe("the weekly changelog", () => {
  const before = ["2026-11-20 Campaign management: a new field", "2026-11-13 Reporting: a new metric"]

  it("ignores a week that says nothing about messaging — otherwise it speaks every Monday", () => {
    const verdict = decidePage({
      page: changelog,
      previous: seen(before),
      current: ["2026-11-27 Audience management: a new endpoint", ...before],
      failure: undefined,
    })
    expect(verdict.alerts).toEqual([])
    // The new week is remembered even though it was not worth saying, so it is not weighed twice.
    expect(verdict.state.lines).toContain("2026-11-27 Audience management: a new endpoint")
  })

  it("speaks when a week names Business Messaging", () => {
    const verdict = decidePage({
      page: changelog,
      previous: seen(before),
      current: ["2026-11-27 Business Messaging API: the onboarding application form is open again", ...before],
      failure: undefined,
    })
    expect(verdict.alerts).toHaveLength(1)
    expect(verdict.alerts[0].level).toBe("open")
  })
})

describe("when the watch cannot see", () => {
  it("reports after the second failure in a row, not the first", () => {
    const first = decidePage({ page: product, previous: seen(["a"]), current: undefined, failure: "timeout" })
    expect(first.alerts).toEqual([])
    expect(first.state.failures).toBe(1)

    const second = decidePage({ page: product, previous: first.state, current: undefined, failure: "timeout" })
    expect(second.alerts).toHaveLength(1)
    expect(second.alerts[0].text).toContain("не следит")
    // The last good text is kept, so recovery compares against what was there before the outage.
    expect(second.state.lines).toEqual(["a"])
  })

  it("says it can see again", () => {
    const broken = seen(["a"], 2)
    const back = decidePage({ page: product, previous: broken, current: ["a"], failure: undefined })
    expect(back.alerts).toHaveLength(1)
    expect(back.alerts[0].text).toContain("снова читается")
    expect(back.state.failures).toBe(0)
  })
})

describe("reading a page", () => {
  it("keeps the words and drops the layout", () => {
    expect(normalise("  Business   Messaging \n\n  \n Contact   us  ")).toEqual(["Business Messaging", "Contact us"])
  })

  it("walks both pages in one pass and keeps each one's state apart", () => {
    const { state, alerts } = decide({
      previous: { "business-messaging": seen(["old"]) },
      pages: {
        "business-messaging": { lines: ["old", "Applications are open"] },
        "whats-new": { lines: ["2026-11-27 Reporting: a metric"] },
      },
    })
    expect(alerts.map((a: { level: string }) => a.level)).toEqual(["open"])
    expect(Object.keys(state).sort()).toEqual(["business-messaging", "whats-new"])
    // A page seen for the first time is only remembered.
    expect(state["whats-new"].hash).toBeTruthy()
  })
})
