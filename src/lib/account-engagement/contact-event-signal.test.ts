import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mapEventTypeToSignalKind,
  recordAccountIntentSignal,
} from "./contact-event-signal"

describe("mapEventTypeToSignalKind", () => {
  it("maps the marketing-relevant CRM event types", () => {
    expect(mapEventTypeToSignalKind("email_opened")).toBe("email_engagement")
    expect(mapEventTypeToSignalKind("email_clicked")).toBe("email_engagement")
    expect(mapEventTypeToSignalKind("email_replied")).toBe("email_engagement")
    expect(mapEventTypeToSignalKind("form_submitted")).toBe("form_submission")
    expect(mapEventTypeToSignalKind("page_visited")).toBe("page_view_research")
    expect(mapEventTypeToSignalKind("meeting_scheduled")).toBe("event_attendance")
  })

  it("returns null for non-intent / billing / e-sign / outbound events", () => {
    expect(mapEventTypeToSignalKind("email_sent")).toBeNull()
    expect(mapEventTypeToSignalKind("deal_created")).toBeNull()
    expect(mapEventTypeToSignalKind("ticket_created")).toBeNull()
    expect(mapEventTypeToSignalKind("note_added")).toBeNull()
    expect(mapEventTypeToSignalKind("envelope_created")).toBeNull()
    expect(mapEventTypeToSignalKind("payment_intent.succeeded")).toBeNull()
    expect(mapEventTypeToSignalKind("x")).toBeNull()
  })
})

function makeClient() {
  return {
    contact: { findFirst: vi.fn() },
    marketingAccount: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    accountIntentSignal: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "sig-1" }),
    },
  }
}

const OCCURRED = new Date("2026-06-20T10:00:00.000Z")
const baseInput = {
  organizationId: "org-1",
  contactId: "c-1",
  occurredAt: OCCURRED,
}

describe("recordAccountIntentSignal", () => {
  let client: ReturnType<typeof makeClient>
  beforeEach(() => {
    client = makeClient()
  })

  it("skips non-intent events before touching the DB", async () => {
    const res = await recordAccountIntentSignal(
      { ...baseInput, eventType: "deal_created" },
      client as any,
    )
    expect(res).toEqual({ recorded: false, reason: "not_intent" })
    expect(client.contact.findFirst).not.toHaveBeenCalled()
    expect(client.accountIntentSignal.create).not.toHaveBeenCalled()
  })

  it("skips when the contact has no company", async () => {
    client.contact.findFirst.mockResolvedValue({ companyId: null })
    const res = await recordAccountIntentSignal(
      { ...baseInput, eventType: "form_submitted" },
      client as any,
    )
    expect(res).toEqual({ recorded: false, reason: "no_company" })
    expect(client.accountIntentSignal.create).not.toHaveBeenCalled()
  })

  it("skips when the company is not a tracked marketing account", async () => {
    client.contact.findFirst.mockResolvedValue({ companyId: "co-1" })
    client.marketingAccount.findFirst.mockResolvedValue(null)
    const res = await recordAccountIntentSignal(
      { ...baseInput, eventType: "form_submitted" },
      client as any,
    )
    expect(res).toEqual({ recorded: false, reason: "not_tracked" })
    expect(client.accountIntentSignal.create).not.toHaveBeenCalled()
  })

  it("is idempotent — skips an already-recorded signal", async () => {
    client.contact.findFirst.mockResolvedValue({ companyId: "co-1" })
    client.marketingAccount.findFirst.mockResolvedValue({ id: "acc-1" })
    client.accountIntentSignal.findFirst.mockResolvedValue({ id: "existing" })
    const res = await recordAccountIntentSignal(
      { ...baseInput, eventType: "form_submitted" },
      client as any,
    )
    expect(res).toEqual({ recorded: false, reason: "duplicate" })
    expect(client.accountIntentSignal.create).not.toHaveBeenCalled()
  })

  it("records a signal and bumps the account's lastSignalAt", async () => {
    client.contact.findFirst.mockResolvedValue({ companyId: "co-1" })
    client.marketingAccount.findFirst.mockResolvedValue({ id: "acc-1" })
    const res = await recordAccountIntentSignal(
      { ...baseInput, eventType: "form_submitted", resourceRef: "/pricing" },
      client as any,
    )
    expect(res).toMatchObject({
      recorded: true,
      signalKind: "form_submission",
      marketingAccountId: "acc-1",
    })
    const { data } = client.accountIntentSignal.create.mock.calls[0][0]
    expect(data.marketingAccountId).toBe("acc-1")
    expect(data.signalKind).toBe("form_submission")
    expect(data.contactId).toBe("c-1")
    expect(data.resourceRef).toBe("/pricing")
    expect(typeof data.weight).toBe("number")
    expect(data.weight).toBeGreaterThan(0)
    expect(client.marketingAccount.update).toHaveBeenCalledWith({
      where: { id: "acc-1" },
      data: { lastSignalAt: OCCURRED },
    })
  })
})
