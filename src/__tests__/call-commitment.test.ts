import { describe, expect, it } from "vitest"
import {
  buildCommitmentTask,
  ourCommitments,
  resolveCommitmentDue,
  DEFAULT_COMMITMENT_WINDOW_HOURS,
} from "@/lib/commitments/call-commitment"
import { nextEscalationStep, MANAGER_GRACE_MINUTES } from "@/lib/commitments/escalation"

const CALL_AT = new Date("2026-08-13T09:00:00.000Z")

function item(text: string, owner: "agent" | "customer" | null = "agent", dueDateHint: string | null = null) {
  return { text, owner, dueDateHint }
}

describe("commitments captured on a call", () => {
  it("takes the time the customer named, on the customer's clock", () => {
    // The box runs UTC; the customers are four hours ahead of it. 18:00 in Baku
    // is 14:00 UTC, and a commitment filed at 18:00 UTC would be reported late
    // for four hours it was never late for.
    const due = resolveCommitmentDue("bu gün saat 18:00-da", CALL_AT, "Asia/Baku")
    expect(due.statedByCustomer).toBe(true)
    expect(due.dueDate.toISOString()).toBe("2026-08-13T14:00:00.000Z")

    const inUtc = resolveCommitmentDue("bu gün saat 18:00-da", CALL_AT, "UTC")
    expect(inUtc.dueDate.toISOString()).toBe("2026-08-13T18:00:00.000Z")
  })

  it("reads the day on the customer's clock too", () => {
    // 22:30 UTC is already tomorrow in Baku, so "tomorrow at 10:00" is the day
    // after the local date, not after the server's.
    const lateNight = new Date("2026-08-13T22:30:00.000Z")
    const due = resolveCommitmentDue("sabah saat 10:00", lateNight, "Asia/Baku")
    expect(due.statedByCustomer).toBe(true)
    expect(due.dueDate.toISOString()).toBe("2026-08-15T06:00:00.000Z")
  })

  it("hears the language the customer actually spoke", () => {
    // `\b` is defined on ASCII word characters, so the old rules never matched
    // beside a Cyrillic letter: every commitment agreed in Russian lost its
    // time and silently got our 24-hour default.
    const due = resolveCommitmentDue("завтра в 10", CALL_AT, "Asia/Baku")
    expect(due.precision).toBe("exact")
    expect(due.dueDate.toISOString()).toBe("2026-08-14T06:00:00.000Z")
  })

  it("understands 'in an hour', which is what people actually say", () => {
    // Three of the five real promises on production read "bir saat sonra", and
    // every one of them was landing on the 24-hour default.
    for (const phrase of ["bir saat sonra", "через час", "in an hour"]) {
      const due = resolveCommitmentDue(phrase, CALL_AT, "Asia/Baku")
      expect(due.precision, phrase).toBe("exact")
      expect(due.dueDate.getTime() - CALL_AT.getTime(), phrase).toBe(3600_000)
    }
    expect(resolveCommitmentDue("через 30 минут", CALL_AT).dueDate.getTime() - CALL_AT.getTime())
      .toBe(30 * 60_000)
  })

  it("does not read 'at ten o'clock' as 'in ten hours'", () => {
    // Russian uses one noun for both readings, and the difference is a marker
    // word. Without it, a morning appointment becomes a deadline ten hours
    // after the call.
    const atTen = resolveCommitmentDue("в 10 часов", CALL_AT, "Asia/Baku")
    // 09:00 UTC is 13:00 in Baku, so ten o'clock means tomorrow's.
    expect(atTen.dueDate.toISOString()).toBe("2026-08-14T06:00:00.000Z")
  })

  it("does not put a minute in the customer's mouth when they named a part of the day", () => {
    const morning = resolveCommitmentDue("sabah günün birinci yarısında", CALL_AT, "Asia/Baku")
    expect(morning.precision).toBe("approximate")
    expect(morning.statedByCustomer).toBe(true)
    // The call is at 13:00 Baku, so "tomorrow morning" is the 14th at 10:00
    // local — morning, not the 18:00 the old rule invented. The task will also
    // say the hour is ours, because a lateness report must not hold somebody to
    // a minute nobody agreed.
    expect(morning.dueDate.toISOString()).toBe("2026-08-14T06:00:00.000Z")

    const draft = buildCommitmentTask({
      insight: { summary: "", actionItems: [item("Zəng et", "agent", "sabah günün birinci yarısında")] },
      callAt: CALL_AT,
      timeZone: "Asia/Baku",
    })
    expect(draft!.description).toContain("dəqiq saatı biz qoyduq")
    expect(draft!.priority).toBe("high")
  })

  it("refuses to invent a deadline from a vague phrase", () => {
    // "Next week" is not a time. Converting it produces an overdue alarm the
    // customer never agreed to, and the first false accusation of lateness is
    // where a salesperson stops believing the whole mechanism.
    for (const vague of ["next week", "на следующей неделе", "yaxın günlərdə", "", null]) {
      const due = resolveCommitmentDue(vague, CALL_AT)
      expect(due.statedByCustomer, String(vague)).toBe(false)
      expect(due.dueDate.getTime()).toBe(CALL_AT.getTime() + DEFAULT_COMMITMENT_WINDOW_HOURS * 3600_000)
    }
  })

  it("does not write down a promise that is already late", () => {
    const evening = new Date("2026-08-13T19:30:00.000Z")
    const due = resolveCommitmentDue("saat 18:00", evening)
    expect(due.dueDate.getTime()).toBeGreaterThan(evening.getTime())
  })

  it("keeps a stated 'today' honest rather than silently moving it to tomorrow", () => {
    const evening = new Date("2026-08-13T19:30:00.000Z")
    const due = resolveCommitmentDue("bu gün saat 18:00", evening)
    // The customer said today and today's slot has passed: we do not pretend
    // they agreed to tomorrow.
    expect(due.statedByCustomer).toBe(false)
  })

  it("is not accountable for what the customer promised", () => {
    const items = ourCommitments({
      actionItems: [
        item("Satış meneceri saat 18:00-da zəng etməlidir", "agent"),
        item("Müştəri ölçüləri göndərəcək", "customer"),
        item("Qiymət təklifi hazırlanmalıdır", null),
      ],
    })
    expect(items.map((i) => i.owner)).toEqual(["agent", null])
  })

  it("makes one task per call, and carries the rest as text", () => {
    const draft = buildCommitmentTask({
      insight: {
        summary: "",
        actionItems: [
          item("Saat 18:00-da zəng et", "agent", "bu gün saat 18:00"),
          item("200 kvadrat üçün təklif hazırla", "agent"),
          item("Çatdırılma şərtlərini dəqiqləşdir", "agent"),
        ],
      },
      callAt: CALL_AT,
    })
    expect(draft).not.toBeNull()
    expect(draft!.title).toBe("Saat 18:00-da zəng et")
    // Four tasks for one call teaches the salesperson to close them unread.
    expect(draft!.description).toContain("200 kvadrat üçün təklif hazırla")
    expect(draft!.description).toContain("Çatdırılma şərtlərini dəqiqləşdir")
    expect(draft!.priority).toBe("high")
  })

  it("says plainly when the deadline is ours and not the customer's", () => {
    const draft = buildCommitmentTask({
      insight: { summary: "", actionItems: [item("Təklif göndər", "agent")] },
      callAt: CALL_AT,
    })
    expect(draft!.statedByCustomer).toBe(false)
    expect(draft!.priority).toBe("medium")
    expect(draft!.description).toContain("standart")
  })

  it("produces nothing when the call contained no commitment of ours", () => {
    expect(buildCommitmentTask({ insight: { summary: "", actionItems: [] }, callAt: CALL_AT })).toBeNull()
    expect(buildCommitmentTask({ insight: null, callAt: CALL_AT })).toBeNull()
    expect(buildCommitmentTask({
      insight: { summary: "", actionItems: [item("Müştəri özü zəng edəcək", "customer")] },
      callAt: CALL_AT,
    })).toBeNull()
  })
})

describe("what an AI call actually hands over", () => {
  it("carries the customer's stated time out of the call analysis", () => {
    // The phone contour's analyser returns one next step plus the customer's
    // own words about when. Without the second half every promise from a call
    // would land on our default 24-hour window, which is precisely the case the
    // owner asked about: "the customer asked to be called at 18:00".
    const draft = buildCommitmentTask({
      insight: {
        summary: "",
        actionItems: [item("Saat 18:00-da müştəriyə zəng et", "agent", "bu gün saat 18:00")],
      },
      callAt: new Date("2026-08-13T09:00:00.000Z"),
      timeZone: "Asia/Baku",
    })
    expect(draft!.statedByCustomer).toBe(true)
    expect(draft!.dueDate.toISOString()).toBe("2026-08-13T14:00:00.000Z")
    expect(draft!.priority).toBe("high")
  })
})

describe("who hears about a missed promise, and when", () => {
  const DUE = new Date("2026-08-13T14:00:00.000Z")
  const base = { dueDate: DUE, overdueNotifiedAt: null, escalatedAt: null, completedAt: null }

  it("says nothing before the deadline", () => {
    expect(nextEscalationStep(base, new Date(DUE.getTime() - 60_000))).toBe("none")
  })

  it("tells the salesperson first, and alone", () => {
    expect(nextEscalationStep(base, new Date(DUE.getTime() + 60_000))).toBe("notify-assignee")
  })

  it("gives them the grace period before management hears", () => {
    const told = { ...base, overdueNotifiedAt: new Date(DUE.getTime() + 60_000) }
    // A manager who learns of a slip in the same second the salesperson does
    // teaches the team to stop recording promises at all.
    expect(nextEscalationStep(told, new Date(DUE.getTime() + 20 * 60_000))).toBe("none")
    expect(nextEscalationStep(told, new Date(DUE.getTime() + MANAGER_GRACE_MINUTES * 60_000))).toBe("escalate-manager")
  })

  it("measures the grace period from the deadline, not from our own late cron", () => {
    // A cron that ran twenty minutes late must not hand this salesperson a
    // shorter grace period than the next one gets.
    const toldLate = { ...base, overdueNotifiedAt: new Date(DUE.getTime() + 20 * 60_000) }
    expect(nextEscalationStep(toldLate, new Date(DUE.getTime() + MANAGER_GRACE_MINUTES * 60_000))).toBe("escalate-manager")
  })

  it("never escalates twice, and never escalates finished work", () => {
    const escalated = { ...base, overdueNotifiedAt: DUE, escalatedAt: DUE }
    expect(nextEscalationStep(escalated, new Date(DUE.getTime() + 10 * 3600_000))).toBe("none")
    expect(nextEscalationStep({ ...base, completedAt: DUE }, new Date(DUE.getTime() + 10 * 3600_000))).toBe("none")
  })
})
