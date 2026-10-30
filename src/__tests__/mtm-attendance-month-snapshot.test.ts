import { describe,expect,it } from "vitest"
import { buildMtmAttendanceReport, type MtmAttendanceReport } from "@/lib/mtm/attendance-report"
import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { attendanceMonthHash,attendanceN1tConfig,buildAttendanceMonthSnapshot,frozenAttendanceMonthTable,frozenAttendanceN1tBlock,verifiedAttendanceMonthSnapshot } from "@/lib/mtm/attendance-month-snapshot"
import { attendanceN1tParts } from "@/lib/mtm/attendance-n1t-form"
import { AttendanceMonthCloseSchema,AttendanceMonthTableSchema } from "@/lib/mtm/attendance-month-contract"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
const selection={month:"2026-09",agentIds:["fictional-a"]},now=new Date("2026-10-03T08:00:00Z")
const report=(): MtmAttendanceReport=>buildMtmAttendanceReport({employees:[{id:"fictional-a",name:"Demo employee 01",teamId:null,teamName:null}],workdays:[],calendar:[],rules:[],from:"2026-09-01",to:"2026-09-30",now})
describe("closed month payload uses frozen content",()=>{
 it("preserves absences/weekends and all three export languages without fabricating time",()=>{
  const built=buildAttendanceMonthSnapshot(report(),selection,now);expect(built.blockers).toEqual([]);expect(built.payload.coverage).toHaveLength(30)
  for(const locale of ["az","ru","en"] as const){expect(built.payload.tables[locale].rows).toHaveLength(1);expect(built.payload.tables[locale].columns.some(c=>c.key==="2026-09-30")).toBe(true)}
  expect(verifiedAttendanceMonthSnapshot(JSON.parse(JSON.stringify(built.payload)),built.hash)).toEqual(built.payload)
 })
 // Owner, 2026-10-20: the closed month is the accounting N-1t, frozen as the N-1t report computes it.
 it("freezes the N-1t in all three languages exactly as the N-1t report builds it",()=>{
  const input=report(),built=buildAttendanceMonthSnapshot(input,selection,now)
  for(const locale of ["az","ru","en"] as const){
   const t=createTranslator({locale,messages:{mtmAttendance:JSON.parse(readFileSync(`messages/${locale}.json`,"utf8")).mtmAttendance},namespace:"mtmAttendance"})
   expect(built.payload.n1t![locale]).toEqual(buildAttendanceTable(input,attendanceN1tConfig("2026-09-01","2026-09-30"),locale,t))
  }
  expect(built.payload.n1t!.az.columns.slice(0,4).map(c=>c.key)).toEqual(["index","employee","position","team"])
  expect(frozenAttendanceMonthTable(built.payload,"ru")).toEqual({form:"N1T",table:built.payload.n1t!.ru})
  expect(built.ongoing).toBe(false)
  // With its figures and layout, so that the blocks of a month over 100 people read back as one form.
  expect(built.payload.n1tParts).toEqual(attendanceN1tParts(input,attendanceN1tConfig("2026-09-01","2026-09-30")))
  expect(frozenAttendanceN1tBlock(built.payload,"az")).toEqual({table:built.payload.n1t!.az,parts:built.payload.n1tParts,asOf:built.payload.asOf})
 })
 it("never keeps N-1t cells without the parts that join them, or parts without cells",()=>{
  const built=buildAttendanceMonthSnapshot(report(),selection,now)
  for(const drop of ["n1t","n1tParts"]){const damaged:Record<string,unknown>={...built.payload};delete damaged[drop];expect(()=>verifiedAttendanceMonthSnapshot(damaged,attendanceMonthHash(damaged))).toThrow()}
 })
 it("still opens a month closed before the N-1t was frozen, with its month grid and its old hash",()=>{
  const built=buildAttendanceMonthSnapshot(report(),selection,now),legacy:Record<string,unknown>={...built.payload};delete legacy.n1t;delete legacy.n1tParts
  const payload=verifiedAttendanceMonthSnapshot(JSON.parse(JSON.stringify(legacy)),attendanceMonthHash(legacy))
  expect(payload).not.toHaveProperty("n1t");expect(frozenAttendanceMonthTable(payload,"en")).toEqual({form:"MONTH",table:built.payload.tables.en})
 })
 it("keeps a month of many approved days closable: a frozen table may carry hundreds of note lines",()=>{
  const table=buildAttendanceMonthSnapshot(report(),selection,now).payload.n1t!.az
  expect(AttendanceMonthTableSchema.safeParse({...table,details:Array.from({length:600},(_,i)=>`Fictional approved day ${i}`)}).success).toBe(true)
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
  expect(buildAttendanceMonthSnapshot(report(),selection,new Date("2026-09-30T10:00:00Z")).ongoing).toBe(true)
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
