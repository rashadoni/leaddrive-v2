import { createHash } from "node:crypto"
import { createTranslator } from "next-intl"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import type { MtmAttendanceReport, MtmAttendanceReportRow } from "@/lib/mtm/attendance-report"
import { DEFAULT_ATTENDANCE_VIEW_COLUMNS } from "@/lib/mtm/attendance-view-contract"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceMonthPayloadSchema, type AttendanceMonthPayload, type AttendanceMonthSelection } from "@/lib/mtm/attendance-month-contract"
export function attendanceMonthRange(month: string) {
  const [year, number] = month.split("-").map(Number)
  return { from: `${month}-01`, to: new Date(Date.UTC(year,number,0,12)).toISOString().slice(0,10) }
}
function ordered(value: unknown): unknown { return Array.isArray(value) ? value.map(ordered) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)])) : value }
export const attendanceMonthHash = (value: unknown) => createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex")
/** Safe source identities only: no request reasons, attachments, location,
 * device values or pause intervals enter the frozen payload. */
export function buildAttendanceMonthSnapshot(report: MtmAttendanceReport, selection: AttendanceMonthSelection, now: Date) {
  const {from,to}=attendanceMonthRange(selection.month), ids=[...selection.agentIds].sort()
  const accounting = (report as MtmAttendanceReport & { accountingRows?: (MtmAttendanceReportRow & { sourceDate: string })[] }).accountingRows
  const rows = (accounting ?? report.rows.map(row=>({...row,sourceDate:row.date}))).filter(row=>row.date>=from && row.date<=to && ids.includes(row.employeeId))
  const blockers=rows.filter(row=>["OPEN","MISSING_FINISH","INVALID_FACTS","UPCOMING"].includes(row.kind) || currentDateKey(now,row.timezone)<=to)
    .map(row=>({employeeId:row.employeeId,date:row.sourceDate,kind:row.kind}))
  const tables={} as AttendanceMonthPayload["tables"]
  const catalogues = {az:az.mtmAttendance,ru:ru.mtmAttendance,en:en.mtmAttendance}
  for(const locale of ["az","ru","en"] as const) {
    const tableMessages: { mtmAttendance: Record<string,string> } = {mtmAttendance:catalogues[locale]}
    const t=createTranslator({locale,messages:tableMessages,namespace:"mtmAttendance"})
    tables[locale]=buildAttendanceTable(report,{version:1,mode:"MONTH",columns:[...DEFAULT_ATTENDANCE_VIEW_COLUMNS.MONTH],showTotals:true,filters:{from,to,form:"ALL"}},locale,t)
  }
  const payload=AttendanceMonthPayloadSchema.parse({version:1,month:selection.month,from,to,asOf:report.asOf,agentIds:ids,tables,
    coverage:rows.map(row=>({agentId:row.employeeId,sourceDate:row.sourceDate,accountingDate:row.date,workdayId:row.workdayId,correctionIds:(row.corrections??[]).map(entry=>entry.id).sort()}))})
  if(new Set(payload.coverage.map(row=>row.agentId)).size!==ids.length || ids.some(id=>!payload.coverage.some(row=>row.agentId===id))) throw new Error("MTM_ATTENDANCE_MONTH_SCOPE_CHANGED")
  if(Buffer.byteLength(JSON.stringify(payload),"utf8")>2_000_000) throw new Error("MTM_ATTENDANCE_MONTH_TOO_LARGE")
  return {payload,hash:attendanceMonthHash(payload),blockers}
}
export function verifiedAttendanceMonthSnapshot(value: unknown, hash: string) {
  const payload=AttendanceMonthPayloadSchema.parse(value)
  if(attendanceMonthHash(payload)!==hash) throw new Error("MTM_ATTENDANCE_MONTH_DAMAGED")
  return payload
}
