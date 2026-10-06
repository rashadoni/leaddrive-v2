/**
 * The Service Desk queue and its search, counted over every ticket.
 *
 * Why this exists: until 2026-10-06 the page loaded the 200 newest tickets and
 * searched, filtered and counted inside that window in the browser. On the
 * tenant used for demos (1150 tickets, 101 of them active) the search covered
 * 17% of the data and the oldest open tickets — the overdue ones — were simply
 * not in the queue. The list API now filters and counts itself.
 *
 * These tests run the produced filters over a small table of tickets, so they
 * assert which tickets are found and counted rather than how the filter is
 * spelled.
 */
import { describe, expect, it } from "vitest"
import {
  TICKET_LIST_MAX_LIMIT,
  TICKET_LIST_SEARCH_MAX_LENGTH,
  parseTicketListParams,
  ticketQueueCountWheres,
  ticketScopeWhere,
  ticketSearchWhere,
} from "@/lib/ticketing/ticket-list-query"

type Row = Record<string, unknown>

// The subset of Prisma's filter language these helpers emit.
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return (condition as Record<string, unknown>[]).every((part) => matches(row, part))
    if (key === "OR") return (condition as Record<string, unknown>[]).some((part) => matches(row, part))
    const value = row[key]
    if (condition === null || typeof condition !== "object") return value === condition
    const filter = condition as Record<string, unknown>
    if ("is" in filter) return value != null && matches(value as Row, filter.is as Record<string, unknown>)
    if ("contains" in filter) {
      return typeof value === "string" && value.toLowerCase().includes(String(filter.contains).toLowerCase())
    }
    if ("in" in filter) return (filter.in as unknown[]).includes(value)
    if ("notIn" in filter) return !(filter.notIn as unknown[]).includes(value)
    if ("lt" in filter) return value != null && (value as Date | number) < (filter.lt as Date | number)
    if ("gt" in filter) return value != null && (value as Date | number) > (filter.gt as Date | number)
    throw new Error(`unsupported filter on ${key}: ${JSON.stringify(filter)}`)
  })
}

const now = new Date("2026-10-06T12:00:00.000Z")
const earlier = new Date("2026-10-01T12:00:00.000Z")
const later = new Date("2026-10-09T12:00:00.000Z")

const tickets: Row[] = [
  { id: "t1", ticketNumber: "SUP-0007", subject: "Не открывается портал", status: "new", assignedTo: null, slaDueAt: earlier, escalationLevel: 0, requesterName: "Jamie Parker", requesterEmail: "jamie@northstar.example", requesterPhone: "+994501112233", companyId: "c-north", contact: null },
  { id: "t2", ticketNumber: "SUP-0450", subject: "Счёт выставлен дважды", status: "in_progress", assignedTo: "u-ayla", slaDueAt: later, escalationLevel: 2, requesterName: null, requesterEmail: null, requesterPhone: null, companyId: "c-zeta", contact: { fullName: "Leyla Aliyeva", email: "leyla@zeta.example", phone: "+994552223344" } },
  { id: "t3", ticketNumber: "SUP-0900", subject: "Password reset", status: "waiting", assignedTo: "", slaDueAt: null, escalationLevel: 0, requesterName: "Omar", requesterEmail: null, requesterPhone: null, companyId: null, contact: null },
  { id: "t4", ticketNumber: "SUP-1001", subject: "Портал: доступ восстановлен", status: "resolved", assignedTo: "u-ayla", slaDueAt: earlier, escalationLevel: 1, requesterName: "Jamie Parker", requesterEmail: "jamie@northstar.example", requesterPhone: null, companyId: "c-north", contact: null },
  { id: "t5", ticketNumber: "SUP-1002", subject: "Old closed request", status: "closed", assignedTo: null, slaDueAt: earlier, escalationLevel: 0, requesterName: null, requesterEmail: null, requesterPhone: null, companyId: null, contact: null },
]

const found = (where: Record<string, unknown>) => tickets.filter((row) => matches(row, where)).map((row) => row.id)
const search = (query: string, companyIds: string[] = [], assigneeIds: string[] = []) =>
  found(ticketSearchWhere(query, { companyIds, assigneeIds }) as Record<string, unknown>)

describe("ticket list request parameters", () => {
  const parse = (query: string) => parseTicketListParams(new URLSearchParams(query))

  it("keeps the page size bounded whatever the caller asks for", () => {
    expect(parse("").limit).toBe(50)
    expect(parse("limit=200").limit).toBe(200)
    expect(parse("limit=1000000").limit).toBe(TICKET_LIST_MAX_LIMIT)
    expect([parse("limit=0").limit, parse("limit=-5").limit, parse("limit=abc").limit, parse("limit=1e9").limit]).toEqual([50, 50, 50, 50])
    expect([parse("page=0").page, parse("page=x").page, parse("page=3").page]).toEqual([1, 1, 3])
  })

  it("reads the search text from `q` and from the `search` name the task picker sends", () => {
    expect(parse("q=%20portal%20").query).toBe("portal")
    expect(parse("search=SUP-0007").query).toBe("SUP-0007")
    expect(parse(`q=${"x".repeat(500)}`).query).toHaveLength(TICKET_LIST_SEARCH_MAX_LENGTH)
  })

  it("accepts only the two known scopes", () => {
    expect([parse("scope=active").scope, parse("scope=done").scope, parse("scope=all").scope, parse("").scope]).toEqual(["active", "done", null, null])
    expect([parse("counts=1").withCounts, parse("counts=true").withCounts, parse("").withCounts]).toEqual([true, false, false])
  })
})

describe("ticket search", () => {
  it("finds a ticket by number, by subject and by requester, in any letter case", () => {
    expect(search("sup-0450")).toEqual(["t2"])
    expect(search("ПОРТАЛ")).toEqual(["t1", "t4"])
    expect(search("jamie@northstar")).toEqual(["t1", "t4"])
    expect(search("+99450111")).toEqual(["t1"])
  })

  it("finds a ticket through the linked contact when the ticket carries no requester snapshot", () => {
    expect(search("aliyeva")).toEqual(["t2"])
    expect(search("leyla@zeta")).toEqual(["t2"])
    expect(search("+99455222")).toEqual(["t2"])
  })

  it("finds tickets by company and assignee once their names are resolved to ids", () => {
    expect(search("zeta holding", ["c-zeta"])).toEqual(["t2"])
    expect(search("ayla morgan", [], ["u-ayla"])).toEqual(["t2", "t4"])
  })

  it("returns nothing for text no ticket contains, and adds no filter for an empty query", () => {
    expect(search("DOT-UX-NORESULT-20261004")).toEqual([])
    expect(ticketSearchWhere("", { companyIds: [], assigneeIds: [] })).toEqual({})
  })
})

describe("queue scope and counters", () => {
  it("splits tickets into the active queue and the finished ones", () => {
    expect(found(ticketScopeWhere("active") as Record<string, unknown>)).toEqual(["t1", "t2", "t3"])
    expect(found(ticketScopeWhere("done") as Record<string, unknown>)).toEqual(["t4", "t5"])
    expect(ticketScopeWhere(null)).toEqual({})
  })

  it("counts the queue the way the cards describe it", () => {
    const wheres = ticketQueueCountWheres({}, now)
    const count = (key: keyof typeof wheres) => found(wheres[key] as Record<string, unknown>)

    expect(count("open")).toEqual(["t1", "t2", "t3"])
    expect(count("new")).toEqual(["t1"])
    // An empty assignee is unassigned too; a finished ticket never is.
    expect(count("unassigned")).toEqual(["t1", "t3"])
    // Overdue means the deadline has passed on a ticket that is still open.
    expect(count("slaBreached")).toEqual(["t1"])
    expect(count("escalated")).toEqual(["t2"])
  })

  it("counts only what the caller is allowed to see", () => {
    const wheres = ticketQueueCountWheres({ assignedTo: "u-ayla" }, now)

    expect(found(wheres.open as Record<string, unknown>)).toEqual(["t2"])
    expect(found(wheres.unassigned as Record<string, unknown>)).toEqual([])
  })
})
