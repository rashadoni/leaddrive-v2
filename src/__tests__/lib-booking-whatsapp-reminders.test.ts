/**
 * Reminders before a visit: which meetings are due one, what the button a
 * client taps carries, and the window rule that decides whether an ordinary
 * message or an approved template may be sent.
 */
import { describe, expect, it } from "vitest"
import { REMINDER_WINDOWS, readReminderButton, reminderButtonId, reminderReply } from "@/lib/booking/whatsapp-reminders"
import { readWhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"

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
  it("looks a day and two hours ahead, with a window wide enough to survive a late run", () => {
    expect(REMINDER_WINDOWS.day.leadMinutes).toBe(24 * 60)
    expect(REMINDER_WINDOWS.hour.leadMinutes).toBe(2 * 60)
    // Six hours of slack on the day-before one: a job that missed a few ticks
    // still reminds instead of skipping the meeting.
    expect(REMINDER_WINDOWS.day.openMinutes).toBeGreaterThanOrEqual(60)
    // The two-hour one must not drift into «half an hour before», which is a
    // nuisance rather than a reminder.
    expect(REMINDER_WINDOWS.hour.openMinutes).toBeLessThanOrEqual(REMINDER_WINDOWS.hour.leadMinutes / 2)
  })
})

describe("the template for messages outside Meta's day", () => {
  it("is read from the organization's own setting, and absent unless named", () => {
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book" } }).reminderTemplate).toBeNull()
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", reminderTemplate: "  " } }).reminderTemplate).toBeNull()
    expect(readWhatsAppBookingSetting({ bookingWhatsApp: { mode: "book", reminderTemplate: " salon_visit_reminder " } }).reminderTemplate).toBe("salon_visit_reminder")
  })
})
