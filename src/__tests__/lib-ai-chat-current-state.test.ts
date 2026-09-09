/**
 * The question that broke in production, and the boundaries around its fix.
 *
 * "yeni neçə lid var" was routed to the period report, which refuses any
 * message without a parsable window — so the most ordinary question a manager
 * asks returned "I could not verify the CRM data". These cases pin the state
 * questions onto snapshot tools and, just as importantly, pin the questions
 * that must NOT be reinterpreted: rankings, real periods, and past events.
 */
import { describe, expect, it } from "vitest"
import { currentStateGrounding, currentStateInputMatches } from "@/lib/ai/chat-current-state"

describe("currentStateGrounding", () => {
  it.each([
    // The exact production message, and its plainer siblings.
    ["yeni neçə lid var", "get_leads_summary"],
    ["neçə lid var", "get_leads_summary"],
    ["сколько у нас лидов", "get_leads_summary"],
    ["сколько новых лидов", "get_leads_summary"],
    ["how many leads do we have", "get_leads_summary"],
    ["сколько сделок в работе", "get_pipeline_by_stage"],
    ["neçə sövdələşmə var", "get_pipeline_by_stage"],
    ["how many deals are there", "get_pipeline_by_stage"],
    ["сколько задач", "get_boards_summary"],
    ["дай отчёт по доске", "get_boards_summary"],
    ["lövhə üzrə hesabat ver", "get_boards_summary"],
    ["сколько коммерческих предложений", "get_quotes_summary"],
    ["сколько тикетов", "describe_section"],
    // Overdue cuts across entities and has its own verified snapshot.
    ["сколько просроченных задач", "get_overdue"],
    ["how many overdue tasks", "get_overdue"],
  ])("grounds %s on %s", (message, tool) => {
    expect(currentStateGrounding(message)?.tool).toBe(tool)
  })

  it.each([
    // A real period belongs to the deterministic period report.
    "сколько лидов в августе",
    "сколько сделок сегодня",
    "how many leads this month",
    "neçə lid bu gün",
    "сколько сделок с 1 по 15 августа",
    // A ranking has its own verified path.
    "кто больше всех продал",
    "у кого больше лидов",
    "who has the most deals",
    // Past events genuinely need a window; answering with a current total
    // would answer a different question than the one asked.
    "сколько лидов создали",
    "сколько сделок выиграли",
    "how many deals did we win",
    "neçə lid yaradılıb",
    // No entity this CRM can snapshot.
    "сколько стоит подписка",
    "привет, что ты умеешь?",
  ])("stays out of the way for %s", (message) => {
    expect(currentStateGrounding(message)).toBeNull()
  })

  it("keeps a board question on the board snapshot even when it says tasks", () => {
    expect(currentStateGrounding("сколько задач на доске")?.tool).toBe("get_boards_summary")
  })
})

describe("currentStateInputMatches", () => {
  const tickets = currentStateGrounding("сколько тикетов")!

  it("accepts the arguments the question fixed", () => {
    expect(currentStateInputMatches(tickets, { section: "tickets" })).toBe(true)
    expect(currentStateInputMatches(tickets, { section: "tickets", facet: "status" })).toBe(true)
  })

  it("rejects a different section, or a period that changes the question", () => {
    expect(currentStateInputMatches(tickets, { section: "deals" })).toBe(false)
    expect(currentStateInputMatches(tickets, { section: "tickets", period: "month" })).toBe(false)
    expect(currentStateInputMatches(tickets, {})).toBe(false)
  })

  it("accepts anything for a snapshot tool that takes no arguments", () => {
    const leads = currentStateGrounding("сколько у нас лидов")!
    expect(currentStateInputMatches(leads, {})).toBe(true)
  })
})
