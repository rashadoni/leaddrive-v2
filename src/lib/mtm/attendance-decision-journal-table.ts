import { createDateFormatter } from "@/lib/format-date"
import type { AttendanceDecisionJournal, AttendanceDecisionJournalItem } from "@/lib/mtm/attendance-decision-journal-contract"
import type { AttendanceTable, AttendanceText } from "@/lib/mtm/attendance-table"
const STATUS = { PENDING: "requestsPending", APPROVED: "requestsApproved", REJECTED: "requestsRejected", CANCELLED: "requestsCancelled" } as const

/** The screen and actual files share these six cells. Only safe report data
 * is accepted here; private decision notes/documents are absent from the DTO. */
export function attendanceDecisionJournalCells(item: AttendanceDecisionJournalItem, locale: "az" | "ru" | "en", t: AttendanceText): string[] {
  const day = (value: string) => createDateFormatter(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`))
  const instant = (value: string) => createDateFormatter(locale, { timeZone: item.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  const decision = (value: AttendanceDecisionJournalItem["decision"]) => value ? `${value.byName ?? "—"}\n${instant(value.at)}` : "—"
  return [
    `${item.employeeName}${item.teamName ? `\n${item.teamName}` : ""}`,
    `${item.requestKind === "TIME_CORRECTION" ? t("requestsTimeCorrection") : `${item.kind.code} · ${item.kind.names[locale]}`}\n${day(item.startDate)}${item.startDate === item.endDate ? "" : ` — ${day(item.endDate)}`}${item.unit === "HOURS" ? ` · ${item.startTime}–${item.endTime}` : ""}\n${item.timezone}`,
    `${instant(item.submittedAt)}\n${item.submittedByName ?? "—"} · ${t(item.source === "HR" ? "journalSourceHr" : "journalSourceEmployee")}`,
    t(STATUS[item.status]), decision(item.decision), decision(item.cancellation),
  ]
}
export function buildAttendanceDecisionJournalTable(journal: AttendanceDecisionJournal, locale: "az" | "ru" | "en", t: AttendanceText): AttendanceTable {
  const day = (value: string) => createDateFormatter(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`))
  const zones = [...new Set(journal.items.map(item => item.timezone))], zone = zones.length === 1 ? zones[0] : "UTC"
  const keys = ["journalEmployee", "journalPeriod", "journalSubmitted", "journalStatus", "journalDecision", "journalCancellation"]
  return { title: t("journalTitle"), columns: keys.map(key => ({ key, label: t(key) })),
    rows: journal.items.map(item => ({ key: item.id, cells: attendanceDecisionJournalCells(item, locale, t) })),
    details: [t("reportPeriod", { from: day(journal.snapshot.query.from), to: day(journal.snapshot.query.to) }), t("journalPeriodHint"),
      t("journalStatus") + ": " + t(journal.snapshot.query.status === "ALL" ? "requestsAll" : STATUS[journal.snapshot.query.status]),
      // The company's own clock (owner, 2026-10-15: "UTC" next to every time read as an error).
      t("reportSnapshot", { time: createDateFormatter(locale, { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(new Date(journal.snapshot.asOf)), timezone: zone })],
    totals: [t("journalCount", { count: journal.items.length })] }
}
