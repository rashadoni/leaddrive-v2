import { createTranslator } from "next-intl"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { AttendanceDecisionJournalExportSchema } from "@/lib/mtm/attendance-decision-journal-contract"
import { readAttendanceDecisionJournal } from "@/lib/mtm/attendance-decision-journal-store"
import { buildAttendanceDecisionJournalTable } from "@/lib/mtm/attendance-decision-journal-table"
import { buildAttendancePdf, buildAttendanceXlsx } from "@/lib/mtm/attendance-export"
import { contentDispositionAttachment } from "@/lib/export/tabular"

export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    let query = Object.fromEntries(req.nextUrl.searchParams)
    if (Object.keys(query).length === 0) {
      const today = currentDateKey(new Date(), auth.settings.timezone)
      query = { from: `${today.slice(0, 7)}-01`, to: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10), status: "ALL" }
    }
    return attendanceRequestResponse(await readAttendanceDecisionJournal({ organizationId: auth.orgId, actor: auth.actor, allEmployeesGrant: "allEmployeesGrant" in auth && auth.allEmployeesGrant === true, query }))
  }
  catch (error) { return attendanceRequestFailure(error) }
})
export const POST = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    const body = await readJsonRequestWithinLimit(req, 4096)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_EXPORT_INVALID", body.reason === "too_large" ? 413 : 400)
    const parsed = AttendanceDecisionJournalExportSchema.safeParse(body.value)
    if (!parsed.success || Date.parse(parsed.data.snapshot.asOf) > Date.now() + 60_000) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_EXPORT_INVALID", 400)
    const { snapshot, format, locale } = parsed.data
    const journal = await readAttendanceDecisionJournal({ organizationId: auth.orgId, actor: auth.actor, allEmployeesGrant: "allEmployeesGrant" in auth && auth.allEmployeesGrant === true, query: snapshot.query, now: new Date(snapshot.asOf) })
    if (journal.snapshot.id !== snapshot.id) throw new AttendanceRequestError("MTM_ATTENDANCE_JOURNAL_CHANGED")
    const messages = (await import(`../../../../../../../messages/${locale}.json`)).default
    const table = buildAttendanceDecisionJournalTable(journal, locale, createTranslator({ locale, messages, namespace: "mtmAttendance" }))
    const bytes = format === "pdf" ? buildAttendancePdf(table) : Buffer.from(await buildAttendanceXlsx(table).xlsx.writeBuffer())
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDispositionAttachment(`attendance-decisions-${snapshot.query.from}-${snapshot.query.to}.${format}`),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } })
  } catch (error) { return attendanceRequestFailure(error) }
})
