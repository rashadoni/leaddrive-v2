/**
 * Reminders before a visit: which meetings are due one, what the button a
 * client taps carries, and the window rule that decides whether an ordinary
 * message or an approved template may be sent.
 */
import { describe, expect, it } from "vitest"
import { plannedReminders, readReminderButton, reminderButtonId, reminderReply, reminderWindow } from "@/lib/booking/whatsapp-reminders"
import { readReminderSchedule, readWhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"

describe("the button a client taps", () => {
  it("carries the meeting it is about, and nothing else is accepted", () => {
    const id = reminderButtonId("confirm", "booking-1")
    expect(id.length).toBeLessThanOrEqual(256)
    expect(readReminderButton(id)).toEqual({ action: "confirm", bookingId: "booking-1" })
    expect(readReminderButton(reminderButtonId("cancel", "b2"))).toEqual({ action: "cancel", bookingId: "b2" })
    expect(readReminderButton(reminderButtonId("move", "b3"))).toEqual({ action: "move", bookingId: "b3" })
    // A booking button is not a reminder button, and neither is nonsense.
    expect(readReminderButton("bk:offer-1")).toBeNull()
    expect(readReminderButton("rm:delete:b1")).toBeNull()
    expect(readReminderButton("rm:confirm:")).toBeNull()
    expect(readReminderButton("")).toBeNull()
  })

  it("answers in the client's language", () => {
    expect(reminderReply("az", "confirm")).toBe("Gözləyirik ✅")
    expect(reminderReply("ru", "cancel")).toMatch(/^Запись отменена/)
    expect(reminderReply("en", "confirm")).toBe("See you ✅")
  })
})

describe("when a reminder is due", () => {
  const schedule = (settings: unknown) => plannedReminders(readWhatsAppBookingSetting(settings).reminders)

  it("keeps a day and two hours for an organization that never set anything", () => {
    // Every salon had exactly this before the hours became a setting, and a
    // stored setting that says nothing must not change what they get.
    expect(schedule({ bookingWhatsApp: { mode: "book" } })).toEqual([
      { kind: "day", leadMinutes: 24 * 60, openMinutes: 6 * 60 },
      { kind: "hour", leadMinutes: 2 * 60, openMinutes: 60 },
    ])
  })

  it("sends only what the salon left switched on", () => {
    expect(schedule({ bookingWhatsApp: { mode: "book", reminders: { firstHours: null, secondHours: 2 } } }))
      .toEqual([{ kind: "hour", leadMinutes: 120, openMinutes: 60 }])
    // Both off is a salon that reminds nobody: no run, so no meeting is even
    // looked at, and none is marked as reminded.
    expect(schedule({ bookingWhatsApp: { mode: "book", reminders: { firstHours: null, secondHours: null } } })).toEqual([])
  })

  it("narrows the slack with the lead, so a short reminder cannot land as the client walks in", () => {
    // Six hours of drift on a three-hour reminder would fire it at the door.
    const short = reminderWindow("day", 3)
    expect(short.leadMinutes).toBe(180)
    expect(short.openMinutes).toBe(45)
    expect(short.openMinutes).toBeLessThan(short.leadMinutes)
    // A week ahead still gets the old cap, not a day and a half of drift.
    expect(reminderWindow("day", 24 * 7).openMinutes).toBe(6 * 60)
    // The later reminder keeps its tight window at every setting.
    expect(reminderWindow("hour", 1)).toEqual({ kind: "hour", leadMinutes: 60, openMinutes: 30 })
    expect(reminderWindow("hour", 6).openMinutes).toBe(60)
    // Never narrower than the gap between scheduler ticks, or meetings fall
    // through the window unreminded.
    expect(reminderWindow("hour", 1 / 60).openMinutes).toBe(15)
  })
})

describe("the hours a salon types", () => {
  it("are put in order, because the two slots are «earlier» and «later»", () => {
    expect(readReminderSchedule({ firstHours: 2, secondHours: 24 })).toEqual({ firstHours: 24, secondHours: 2 })
    // The same hour twice is one reminder, not two messages in the same minute.
    expect(readReminderSchedule({ firstHours: 3, secondHours: 3 })).toEqual({ firstHours: 3, secondHours: null })
    // A slot switched off stays where it is: the other reminder does not slide
    // into it, or the screen would rearrange itself under the salon's hands.
    expect(readReminderSchedule({ firstHours: null, secondHours: 4 })).toEqual({ firstHours: null, secondHours: 4 })
  })

  it("refuse what cannot be a reminder", () => {
    expect(readReminderSchedule({ firstHours: 0, secondHours: -5 })).toEqual({ firstHours: null, secondHours: null })
    expect(readReminderSchedule({ firstHours: "24", secondHours: Number.NaN })).toEqual({ firstHours: null, secondHours: null })
    // Further ahead than a salon plans is capped, not refused.
    expect(readReminderSchedule({ firstHours: 10_000, secondHours: 2 })).toEqual({ firstHours: 24 * 7, secondHours: 2 })
    expect(readReminderSchedule({ firstHours: 23.6, secondHours: 1.4 })).toEqual({ firstHours: 24, secondHours: 1 })
    expect(readReminderSchedule(null)).toEqual({ firstHours: null, secondHours: null })
  })
})

describe("the template for messages outside Meta's day", () => {
  it("is read from the organization's own setting, and absent unless named", () => {
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book" } }).reminderTemplate).toBeNull()
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", reminderTemplate: "  " } }).reminderTemplate).toBeNull()
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", reminderTemplate: " salon_visit_reminder " } }).reminderTemplate).toBe("salon_visit_reminder")
  })
})
