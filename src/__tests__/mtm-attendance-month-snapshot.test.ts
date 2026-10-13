import { describe,expect,it } from "vitest"
import { buildMtmAttendanceReport, type MtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { attendanceMonthHash,buildAttendanceMonthSnapshot,verifiedAttendanceMonthSnapshot } from "@/lib/mtm/attendance-month-snapshot"
import { AttendanceMonthCloseSchema } from "@/lib/mtm/attendance-month-contract"
const selection={month:"2026-09",agentIds:["fictional-a"]},now=new Date("2026-10-03T08:00:00Z")
const report=(): MtmAttendanceReport=>buildMtmAttendanceReport({employees:[{id:"fictional-a",name:"Demo employee 01",teamId:null,teamName:null}],workdays:[],calendar:[],rules:[],from:"2026-09-01",to:"2026-09-30",now})
describe("closed month payload uses frozen content",()=>{
 it("preserves absences/weekends and all three export languages without fabricating time",()=>{
  const built=buildAttendanceMonthSnapshot(report(),selection,now);expect(built.blockers).toEqual([]);expect(built.payload.coverage).toHaveLength(30)
  for(const locale of ["az","ru","en"] as const){expect(built.payload.tables[locale].rows).toHaveLength(1);expect(built.payload.tables[locale].columns.some(c=>c.key==="2026-09-30")).toBe(true)}
  expect(verifiedAttendanceMonthSnapshot(JSON.parse(JSON.stringify(built.payload)),built.hash)).toEqual(built.payload)
 })
 it("rejects altered frozen cells and does not depend on object key ordering",()=>{
  const built=buildAttendanceMonthSnapshot(report(),selection,now),changed=structuredClone(built.payload);changed.tables.ru.rows[0].cells[0]="ALTERED"
  expect(()=>verifiedAttendanceMonthSnapshot(changed,built.hash)).toThrow("DAMAGED");expect(attendanceMonthHash({a:1,b:2})).toBe(attendanceMonthHash({b:2,a:1}))
 })
 it("never copies free-form request reasons, locations or pause intervals into the snapshot",()=>{
  const input=report();Object.assign(input.rows[0],{reason:"PRIVATE_REQUEST_REASON",latitude:12.34567,pauseIntervals:[{latitude:45.67891}],locationMarks:[{secret:"PRIVATE_DEVICE"}]})
  const built=buildAttendanceMonthSnapshot(input,selection,now);expect(JSON.stringify(built)).not.toMatch(/PRIVATE_|latitude|pauseIntervals|locationMarks/)
 })
 it("blocks an ongoing month and unfinished/invalid canonical days without auto-closing them",()=>{
  const input=report();input.rows[0]={...input.rows[0],kind:"MISSING_FINISH",factsState:"INVALID"}
  expect(buildAttendanceMonthSnapshot(input,selection,now).blockers).toContainEqual({employeeId:"fictional-a",date:"2026-09-01",kind:"MISSING_FINISH"})
  expect(buildAttendanceMonthSnapshot(report(),selection,new Date("2026-09-30T10:00:00Z")).blockers).toHaveLength(30)
 })
 it("protects source dates across the month boundary when accounting uses the finish day",()=>{
  const input=report();input.accountingRows=[{...input.rows[0],date:"2026-09-01",sourceDate:"2026-08-31"},...input.rows.slice(1).map(row=>({...row,sourceDate:row.date}))]
  const built=buildAttendanceMonthSnapshot(input,selection,now);expect(built.payload.coverage[0]).toMatchObject({sourceDate:"2026-08-31",accountingDate:"2026-09-01"})
  expect(built.payload.coverage.some(c=>c.sourceDate==="2026-09-01")).toBe(false)
 })
 it("requires explicit unique employees, real UUID and strict preview receipt",()=>{
  const built=buildAttendanceMonthSnapshot(report(),selection,now),body={...selection,requestId:"00000000-0000-4000-8000-000000000001",preview:{hash:built.hash,asOf:now.toISOString()}}
  expect(AttendanceMonthCloseSchema.safeParse(body).success).toBe(true);expect(AttendanceMonthCloseSchema.safeParse({...body,agentIds:[]}).success).toBe(false);expect(AttendanceMonthCloseSchema.safeParse({...body,agentIds:["a","a"]}).success).toBe(false)
  expect(()=>buildAttendanceMonthSnapshot(report(),{...selection,agentIds:["foreign"]},now)).toThrow()
 })
})
