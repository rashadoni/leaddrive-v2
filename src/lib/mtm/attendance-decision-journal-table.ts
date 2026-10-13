import type { AttendanceDecisionJournal, AttendanceDecisionJournalItem } from "@/lib/mtm/attendance-decision-journal-contract"
import type { AttendanceTable, AttendanceText } from "@/lib/mtm/attendance-table"
const STATUS = { PENDING: "requestsPending", APPROVED: "requestsApproved", REJECTED: "requestsRejected", CANCELLED: "requestsCancelled" } as const

/** The screen and actual files share these six cells. Only safe report data
 * is accepted here; private decision notes/documents are absent from the DTO. */
export function attendanceDecisionJournalCells(item: AttendanceDecisionJournalItem, locale: "az" | "ru" | "en", t: AttendanceText): string[] {
  const day = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`))
  const instant = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: item.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  const decision = (value: AttendanceDecisionJournalItem["decision"]) => value ? `${value.byName ?? "—"}\n${instant(value.at)}` : "—"
  return [
    `${item.employeeName}${item.teamName ? `\n${item.teamName}` : ""}`,
    `${item.requestKind === "TIME_CORRECTION" ? t("requestsTimeCorrection") : `${item.kind.code} · ${item.kind.names[locale]}`}\n${day(item.startDate)}${item.startDate === item.endDate ? "" : ` — ${day(item.endDate)}`}${item.unit === "HOURS" ? ` · ${item.startTime}–${item.endTime}` : ""}\n${item.timezone}`,
    `${instant(item.submittedAt)}\n${item.submittedByName ?? "—"} · ${t(item.source === "HR" ? "journalSourceHr" : "journalSourceEmployee")}`,
    t(STATUS[item.status]), decision(item.decision), decision(item.cancellation),
  ]
}
export function buildAttendanceDecisionJournalTable(journal: AttendanceDecisionJournal, locale: "az" | "ru" | "en", t: AttendanceText): AttendanceTable {
  const keys = ["journalEmployee", "journalPeriod", "journalSubmitted", "journalStatus", "journalDecision", "journalCancellation"]
  return { title: t("journalTitle"), columns: keys.map(key => ({ key, label: t(key) })),
    rows: journal.items.map(item => ({ key: item.id, cells: attendanceDecisionJournalCells(item, locale, t) })),
    details: [t("reportPeriod", { from: journal.snapshot.query.from, to: journal.snapshot.query.to }), t("journalPeriodHint"),
      t("journalStatus") + ": " + t(journal.snapshot.query.status === "ALL" ? "requestsAll" : STATUS[journal.snapshot.query.status]),
      t("reportSnapshot", { time: new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "medium" }).format(new Date(journal.snapshot.asOf)), timezone: "UTC" })],
    totals: [t("journalCount", { count: journal.items.length })] }
}
