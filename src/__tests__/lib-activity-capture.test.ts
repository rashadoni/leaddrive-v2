/**
 * Tests for A6 Activity Capture slice 1 — matcher + extractor + engine.
 * Pure helpers exhaustively; engine via mocked Prisma + fetchEvents.
 */
import { describe, it, expect, vi } from "vitest"
import { matchAttendees, normalizeEmail } from "@/lib/activity-capture/matcher"
import { extractActivities, buildExternalKey } from "@/lib/activity-capture/extractor"
import { syncCalendarActivities, CAPTURE_KEY_MARKER } from "@/lib/activity-capture/engine"
import type {
  CalendarEventInput,
  MatchableContact,
  MatchedAttendees,
} from "@/lib/activity-capture/types"

const contact = (overrides: Partial<MatchableContact> = {}): MatchableContact => ({
  id: "c1",
  email: "client@acme.com",
  companyId: "co1",
  ...overrides,
})

const event = (overrides: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  id: "evt_1",
  source: "google_calendar:primary",
  summary: "Acme renewal call",
  description: "Discuss Q3 renewal terms.",
  startIso: "2026-05-17T10:00:00Z",
  endIso: "2026-05-17T11:00:00Z",
  organizerEmail: "rep@leaddrive.com",
  attendeeEmails: ["client@acme.com", "rep@leaddrive.com"],
  location: "Zoom",
  cancelled: false,
  ...overrides,
})

/* ─── normalizeEmail ──────────────────────────────────────────────────── */

describe("A6 — normalizeEmail", () => {
  it("trims + lowercases", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com")
  })
  it("returns empty for null / undefined / empty", () => {
    expect(normalizeEmail(null)).toBe("")
    expect(normalizeEmail(undefined)).toBe("")
    expect(normalizeEmail("")).toBe("")
  })
})

/* ─── matchAttendees ──────────────────────────────────────────────────── */

describe("A6 — matchAttendees", () => {
  it("matches contacts by email, returns company ids, surfaces unmatched", () => {
    const contacts = [
      contact({ id: "c1", email: "alice@acme.com", companyId: "co1" }),
      contact({ id: "c2", email: "bob@beta.com", companyId: "co2" }),
    ]
    const r = matchAttendees(["alice@acme.com", "stranger@nowhere.com"], contacts)
    expect(r.contacts.map(c => c.id)).toEqual(["c1"])
    expect(r.companyIds).toEqual(["co1"])
    expect(r.unmatchedEmails).toEqual(["stranger@nowhere.com"])
  })

  it("excludes internal user emails so org members don't generate fake contacts", () => {
    const contacts = [contact({ email: "client@acme.com" })]
    const r = matchAttendees(
      ["client@acme.com", "rep@leaddrive.com"],
      contacts,
      ["rep@leaddrive.com"]
    )
    expect(r.contacts).toHaveLength(1)
    expect(r.unmatchedEmails).toEqual([]) // rep@ excluded entirely, not unmatched
  })

  it("case-insensitive", () => {
    const contacts = [contact({ email: "Alice@Acme.com" })]
    const r = matchAttendees(["ALICE@ACME.COM"], contacts)
    expect(r.contacts).toHaveLength(1)
  })

  it("dedupes repeated attendee emails", () => {
    const contacts = [contact({ email: "a@b.com" })]
    const r = matchAttendees(["a@b.com", "a@b.com", "a@b.com"], contacts)
    expect(r.contacts).toHaveLength(1)
  })

  it("dedupes company ids when multiple matched contacts share one company", () => {
    const contacts = [
      contact({ id: "c1", email: "alice@acme.com", companyId: "co1" }),
      contact({ id: "c2", email: "bob@acme.com", companyId: "co1" }),
    ]
    const r = matchAttendees(["alice@acme.com", "bob@acme.com"], contacts)
    expect(r.contacts).toHaveLength(2)
    expect(r.companyIds).toEqual(["co1"])
  })

  it("contact with null email is silently skipped", () => {
    const contacts = [contact({ id: "c1", email: null })]
    const r = matchAttendees(["nobody@nowhere.com"], contacts)
    expect(r.contacts).toEqual([])
    expect(r.unmatchedEmails).toEqual(["nobody@nowhere.com"])
  })

  it("empty attendee list → empty match", () => {
    expect(matchAttendees([], [contact()])).toEqual({
      contacts: [], companyIds: [], unmatchedEmails: [],
    })
  })

  it("blank-string attendees are filtered (not unmatched)", () => {
    const r = matchAttendees(["", "  ", "x@y.com"], [])
    expect(r.unmatchedEmails).toEqual(["x@y.com"])
  })
})

/* ─── extractActivities ───────────────────────────────────────────────── */

describe("A6 — extractActivities", () => {
  const noMatch: MatchedAttendees = { contacts: [], companyIds: [], unmatchedEmails: [] }
  const oneMatch: MatchedAttendees = {
    contacts: [contact()],
    companyIds: ["co1"],
    unmatchedEmails: [],
  }

  it("cancelled event → no activities (engine still records key elsewhere)", () => {
    expect(extractActivities(event({ cancelled: true }), oneMatch)).toEqual([])
  })

  it("no matched contacts → single orphan activity bound to no contact", () => {
    const r = extractActivities(event(), noMatch)
    expect(r).toHaveLength(1)
    expect(r[0].contactId).toBeNull()
    expect(r[0].externalKey).toBe("google_calendar:primary:evt_1:none")
  })

  it("orphan activity always has null companyId — matcher invariant says contacts=[] ⇒ companyIds=[]", () => {
    const r = extractActivities(event(), noMatch)
    expect(r).toHaveLength(1)
    expect(r[0].contactId).toBeNull()
    expect(r[0].companyId).toBeNull()
  })

  it("fans out one activity per matched contact", () => {
    const r = extractActivities(event(), {
      contacts: [contact({ id: "c1", companyId: "co1" }), contact({ id: "c2", companyId: "co2" })],
      companyIds: ["co1", "co2"],
      unmatchedEmails: [],
    })
    expect(r).toHaveLength(2)
    expect(r[0].contactId).toBe("c1")
    expect(r[0].companyId).toBe("co1")
    expect(r[1].contactId).toBe("c2")
    expect(r[1].companyId).toBe("co2")
    // each gets a distinct dedup key
    expect(new Set(r.map(a => a.externalKey)).size).toBe(2)
  })

  it("includes location + organizer + attendees in description", () => {
    const r = extractActivities(event(), oneMatch)
    expect(r[0].description).toContain("Location: Zoom")
    expect(r[0].description).toContain("Organizer: rep@leaddrive.com")
    expect(r[0].description).toContain("Attendees: client@acme.com, rep@leaddrive.com")
  })

  it("subject defaults to '(no subject)' when summary missing", () => {
    const r = extractActivities(event({ summary: null }), oneMatch)
    expect(r[0].subject).toBe("(no subject)")
  })

  it("subject truncated to 240 chars", () => {
    const r = extractActivities(event({ summary: "x".repeat(500) }), oneMatch)
    expect(r[0].subject.length).toBe(240)
  })

  it("past-end event marked completed; future event left scheduled-only", () => {
    const past = event({
      startIso: "2025-01-01T10:00:00Z",
      endIso: "2025-01-01T11:00:00Z",
    })
    expect(extractActivities(past, oneMatch)[0].completedAt).not.toBeNull()

    const future = event({
      startIso: "2099-01-01T10:00:00Z",
      endIso: "2099-01-01T11:00:00Z",
    })
    expect(extractActivities(future, oneMatch)[0].completedAt).toBeNull()
    expect(extractActivities(future, oneMatch)[0].scheduledAt).not.toBeNull()
  })

  it("null start/end iso resolved as null Date", () => {
    const r = extractActivities(event({ startIso: null, endIso: null }), oneMatch)
    expect(r[0].scheduledAt).toBeNull()
    expect(r[0].completedAt).toBeNull()
  })

  it("buildExternalKey is stable across sync passes for same (event, contact) pair", () => {
    const k1 = buildExternalKey(event(), "c1")
    const k2 = buildExternalKey(event(), "c1")
    expect(k1).toBe(k2)
  })

  it("buildExternalKey differs across contacts on same event", () => {
    expect(buildExternalKey(event(), "c1")).not.toBe(buildExternalKey(event(), "c2"))
  })
})

/* ─── Engine ──────────────────────────────────────────────────────────── */

describe("A6 — syncCalendarActivities", () => {
  // Narrow shape mirroring engine's `PrismaSubset` so tsc can resolve
  // .activity.create assertions in tests without `as never` erasure.
  interface MockPrisma {
    contact: { findMany: ReturnType<typeof vi.fn> }
    activity: {
      findMany: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
    }
  }
  function mockPrisma(opts: {
    contacts?: MatchableContact[]
    existingDescriptions?: string[]
  } = {}): MockPrisma {
    return {
      contact: {
        findMany: vi.fn().mockResolvedValue(opts.contacts ?? []),
      },
      activity: {
        findMany: vi.fn().mockResolvedValue(
          (opts.existingDescriptions ?? []).map(d => ({ description: d }))
        ),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: "act_" + Math.random(), ...data })),
      },
    }
  }

  it("zero events → zero work", async () => {
    const prisma = mockPrisma()
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: [],
      fetchEvents: async () => [],
    })
    expect(r.eventsScanned).toBe(0)
    expect(r.activitiesCreated).toBe(0)
  })

  it("matches event + creates Activity per matched contact", async () => {
    const prisma = mockPrisma({ contacts: [contact({ id: "c1", email: "client@acme.com" })] })
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: ["rep@leaddrive.com"],
      fetchEvents: async () => [event()],
    })
    expect(r.eventsScanned).toBe(1)
    expect(r.activitiesCreated).toBe(1)
    expect(prisma.activity.create).toHaveBeenCalledTimes(1)
    const call = (prisma.activity.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.contactId).toBe("c1")
    expect(call.data.description).toContain(CAPTURE_KEY_MARKER)
    expect(call.data.description).toContain("google_calendar:primary:evt_1:c1")
  })

  it("dedups against existing activities marked with the same capture key", async () => {
    const existingDesc = `Some prior activity\n\n${CAPTURE_KEY_MARKER}google_calendar:primary:evt_1:c1`
    const prisma = mockPrisma({
      contacts: [contact({ id: "c1", email: "client@acme.com" })],
      existingDescriptions: [existingDesc],
    })
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: [],
      fetchEvents: async () => [event()],
    })
    expect(r.activitiesCreated).toBe(0)
    expect(r.activitiesSkipped).toBe(1)
    expect(prisma.activity.create).not.toHaveBeenCalled()
  })

  it("orphan activity (no matched contacts) still records the event once", async () => {
    const prisma = mockPrisma({ contacts: [] })
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: [],
      fetchEvents: async () => [event({ attendeeEmails: ["stranger@nowhere.com"] })],
    })
    expect(r.activitiesCreated).toBe(1)
    expect(r.attendeesUnmatched).toBe(1)
  })

  it("counts errors per-event without aborting the whole sync", async () => {
    const prisma = mockPrisma({ contacts: [contact({ id: "c1", email: "client@acme.com" })] })
    let callCount = 0
    ;(prisma.activity.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new Error("temp failure")
      return { id: "ok" }
    })
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: [],
      fetchEvents: async () => [event({ id: "evt_a" }), event({ id: "evt_b" })],
    })
    expect(r.errors).toBe(1)
    expect(r.activitiesCreated).toBe(1)
  })

  it("within-pass dedup: same event seen twice in one fetchEvents result is created once", async () => {
    const prisma = mockPrisma({ contacts: [contact({ id: "c1", email: "client@acme.com" })] })
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: [],
      fetchEvents: async () => [event({ id: "dup" }), event({ id: "dup" })],
    })
    expect(r.activitiesCreated).toBe(1)
    expect(r.activitiesSkipped).toBe(1)
  })

  it("cancelled events produce nothing", async () => {
    const prisma = mockPrisma({ contacts: [contact({ id: "c1", email: "client@acme.com" })] })
    const r = await syncCalendarActivities(prisma as unknown as Parameters<typeof syncCalendarActivities>[0], {
      organizationId: "org1",
      excludeEmails: [],
      fetchEvents: async () => [event({ cancelled: true })],
    })
    expect(r.eventsScanned).toBe(1)
    expect(r.activitiesCreated).toBe(0)
  })
})
