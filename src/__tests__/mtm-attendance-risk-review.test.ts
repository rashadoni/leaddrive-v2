import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ExcelJS from "exceljs"
import { createTranslator } from "next-intl"
import { attendancePdfText } from "./helpers/attendance-pdf"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (v: unknown) => v instanceof Response }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/mtm/attendance-request-decision", async original => ({ ...await original<typeof import("@/lib/mtm/attendance-request-decision")>(), resolveAttendanceReviewerScope: vi.fn(), requireAttendanceReviewer: vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireAttendanceReviewer, resolveAttendanceReviewerScope } from "@/lib/mtm/attendance-request-decision"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { GET, POST } from "@/app/api/v1/mtm/attendance/review/route"
import { POST as DISMISS } from "@/app/api/v1/mtm/attendance/review/[id]/route"
import { readAttendanceRiskReport, dismissAttendanceRiskInTransaction } from "@/lib/mtm/attendance-risk-review-store"
import { AttendanceRiskQuerySchema } from "@/lib/mtm/attendance-risk-contract"
import { buildAttendanceRiskTable } from "@/lib/mtm/attendance-risk-table"
import az from "../../messages/az.json"
import ru from "../../messages/ru.json"
import en from "../../messages/en.json"
const org="fictional-risk-org", employee="fictional-risk-employee", caseId=randomUUID(), userId="fictional-reviewer"
const reviewer={organizationId:org,userId,principalType:"session" as const}
const actor={role:"ADMIN" as const,agentId:null,scopedAgentIds:null},query={from:"2026-10-01",to:"2026-10-31",status:"ALL" as const}
const fixture=()=>({id:caseId,agentId:employee,employeeName:"=Fictional employee",teamId:"fictional-team",teamName:"Fictional team",userId:"fictional-employee-user",kind:"SHARED_INSTALLATION",workDate:new Date("2026-10-13"),timezone:"Asia/Baku",claimedAt:new Date("2026-10-13T05:00:00Z"),serverReceivedAt:new Date("2026-10-13T05:00:02Z"),action:"START",createdAt:new Date("2026-10-13T05:01:00Z"),details:{version:1,relatedAgentIds:["related","outside-scope"],usualAgentId:"outside-scope",usualDays:8,observedDays:10,latitude:PRIVATE,installationId:PRIVATE},dismissedAt:null as Date|null,dismissedBy:null as string|null,reason:null as string|null,branchName:null})
const PRIVATE="PRIVATE_FORBIDDEN_FIXTURE"
let rows:ReturnType<typeof fixture>[],existing:object[],currentUser:{role:string;hiddenModules:string[];mtmAttendanceAll:boolean}
const request=(data:unknown)=>new NextRequest("http://localhost/api/v1/mtm/attendance/review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})
const read=()=>GET(new NextRequest(`http://localhost/api/v1/mtm/attendance/review?${new URLSearchParams(query)}`))
beforeEach(()=>{
 vi.resetAllMocks();rows=[fixture()];existing=[];currentUser={role:"admin",hiddenModules:[],mtmAttendanceAll:false}
 vi.mocked(requireAuth).mockResolvedValue({orgId:org,userId,role:"admin",principalType:"session"} as never)
 vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor);vi.mocked(resolveAttendanceReviewerScope).mockResolvedValue(actor)
 vi.mocked(requireAttendanceReviewer).mockResolvedValue({actor,locale:"en"})
 vi.mocked(prisma.$transaction).mockImplementation((async callback=>callback(prisma)) as never)
 vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true},{key:"timezone",value:"Asia/Baku"}] as never)
 vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:true} as never)
 vi.mocked(prisma.organization.findUnique).mockResolvedValue({plan:"enterprise",addons:[],features:["mtm"],modules:{mtm:true,"route-field":true},settings:{}} as never)
 vi.mocked(prisma.mtmAgent.findMany).mockImplementation((async args=>args.select.team ? [{id:employee,name:"=Fictional employee",teamId:"fictional-team",team:{name:"Fictional team"}}] : [{id:"related",name:"Fictional colleague"}]) as never)
 vi.mocked(prisma.$queryRaw).mockImplementation((async sql=>{
  const s=sql.join(" ");if(s.includes("FROM users"))return [currentUser];if(s.includes('SELECT c.id'))return rows
  if(s.includes('SELECT "agentId" FROM mtm_attendance_risk_cases'))return [{agentId:employee}]
  if(s.includes('FROM mtm_attendance_risk_decisions'))return existing
  return []
 }) as never)
})
describe("attendance risk reports and reason ledger",()=>{
 it("uses a strict endpoint allowlist and masks related employees outside current scope",async()=>{
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"MANAGER",agentId:null,scopedAgentIds:[employee,"related"]})
  const data=await readAttendanceRiskReport({organizationId:org,actor:{role:"MANAGER",agentId:null,scopedAgentIds:[employee,"related"]},reviewer,query})
  expect(data.items[0]).toMatchObject({relatedNames:["Fictional colleague"],relatedNamesRestricted:true,usualName:null,usualDays:null})
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE_FORBIDDEN|latitude|installationId|outside-scope/)
  expect(prisma.mtmAgent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({where:{organizationId:org,id:{in:["related"]}}}))
  const call=vi.mocked(prisma.$queryRaw).mock.calls.find(([sql])=>sql.join(" ").includes("SELECT c.id"))!
  expect(call).toContain(org);expect(call).toContainEqual([employee,"related"])
 })
 it("does not promote a report-wide HR grant into dismissal permission",async()=>{
  currentUser={role:"viewer",hiddenModules:[],mtmAttendanceAll:true}
  vi.mocked(resolveAttendanceReviewerScope).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN",403))
  const data=await readAttendanceRiskReport({organizationId:org,actor:{role:"MANAGER",agentId:null,scopedAgentIds:null},allEmployeesGrant:true,reviewer,query})
  expect(data.items[0].canDismiss).toBe(false)
 })
 it("denies unscoped manager and foreign employee filter before reading cases",async()=>{
  for(const item of[{role:"MANAGER" as const,agentId:null,scopedAgentIds:null},{role:"AGENT" as const,agentId:employee,scopedAgentIds:[employee]}]){vi.mocked(resolveMtmRouteActor).mockResolvedValue(item);await expect(readAttendanceRiskReport({organizationId:org,actor:item,reviewer,query})).rejects.toMatchObject({status:403})}
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"MANAGER",agentId:null,scopedAgentIds:[employee]})
  await expect(readAttendanceRiskReport({organizationId:org,actor:{role:"MANAGER",agentId:null,scopedAgentIds:[employee]},reviewer,query:{...query,employeeId:"foreign"}})).rejects.toMatchObject({status:403})
  expect(vi.mocked(prisma.$queryRaw).mock.calls.some(([sql])=>sql.join(" ").includes("SELECT c.id"))).toBe(false)
 })
 it.each(["grant","hidden","disabled","scope"])("rechecks a stale middleware actor after %s changes",async mode=>{
  if(mode==="grant"){currentUser={role:"viewer",hiddenModules:[],mtmAttendanceAll:false};vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)}
  if(mode==="hidden")currentUser={role:"manager",hiddenModules:["mtm"],mtmAttendanceAll:true}
  if(mode==="disabled")vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:false} as never)
  if(mode==="scope")vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"MANAGER",agentId:null,scopedAgentIds:[]})
  await expect(readAttendanceRiskReport({organizationId:org,actor,allEmployeesGrant:true,reviewer,query:{...query,employeeId:employee}})).rejects.toMatchObject({status:mode==="disabled"?404:403})
  expect(vi.mocked(prisma.$queryRaw).mock.calls.some(([sql])=>sql.join(" ").includes("SELECT c.id"))).toBe(false)
 })
 it("hides access when disabled and refuses non-session principals",async()=>{
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:false}] as never)
  expect((await read()).status).toBe(404)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true}] as never)
  for(const principalType of[undefined,"api_key"]){vi.mocked(requireAuth).mockResolvedValue({orgId:org,userId,role:"admin",principalType} as never);expect((await read()).status).toBe(403)}
 })
 it("refuses silent truncation or an invalid evidence kind",async()=>{
  rows=Array.from({length:10001},fixture);expect((await read()).status).toBe(422)
  rows=[{...fixture(),kind:"UNSUPPORTED_PRIVATE_KIND"}];const response=await read();expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain("UNSUPPORTED_PRIVATE_KIND")
 })
 it.each(["az","ru","en"] as const)("uses the same safe table in actual Excel/PDF in %s",async locale=>{
  rows[0].dismissedAt=new Date("2026-10-13T06:00:00Z");rows[0].dismissedBy="Fictional reviewer";rows[0].reason="=Demonstration shared device confirmed"
  const response=await read();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store")
  const report=(await response.json()).data
  const messages:{mtmAttendance:Record<string,string>}=({az,ru,en})[locale]
  const table=buildAttendanceRiskTable(report,locale,createTranslator({locale,messages,namespace:"mtmAttendance"}))
  const xlsx=await POST(request({snapshot:report.snapshot,locale,format:"xlsx"}));expect(xlsx.status).toBe(200)
  const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as never)
  expect(book.worksheets[0].getRow(2).values).toEqual([undefined,...table.rows[0].cells.map(cell=>cell.startsWith("=")?`'${cell}`:cell)])
  const pdf=await POST(request({snapshot:report.snapshot,locale,format:"pdf"}));expect(pdf.status).toBe(200)
  const text=attendancePdfText(Buffer.from(await pdf.arrayBuffer())).replace(/\s+/g," ")
  expect(text).toContain("Fictional reviewer");expect(text).toContain("shared device confirmed");expect(text).toContain(messages.mtmAttendance.riskDismissed)
  expect(text+JSON.stringify(book.worksheets[0].getSheetValues())).not.toMatch(/PRIVATE_FORBIDDEN|latitude|installationId|outside-scope/)
 })
 it("rejects export after a concurrent decision changes the displayed facts",async()=>{
  const snapshot=(await (await read()).json()).data.snapshot;rows[0].dismissedAt=new Date();rows[0].reason="Fictional decision"
  expect((await POST(request({snapshot,locale:"en",format:"pdf"}))).status).toBe(409)
 })
 it("requires a reason and checks the current reviewer before any decision write",async()=>{
  expect((await DISMISS(request({requestId:randomUUID(),reason:" "}),{params:Promise.resolve({id:caseId})})).status).toBe(400)
  vi.mocked(requireAttendanceReviewer).mockRejectedValue(new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN",403))
  expect((await DISMISS(request({requestId:randomUUID(),reason:"Fictional explanation"}),{params:Promise.resolve({id:caseId})})).status).toBe(403)
  expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled();expect(vi.mocked(prisma.$executeRaw).mock.calls.some(([sql])=>sql.join(" ").includes("INSERT INTO"))).toBe(false)
 })
 it("records a stable decision and audit, then permits only the exact retry",async()=>{
  const payload={requestId:randomUUID(),reason:"  Fictional shared phone confirmed  "}
  const first=await dismissAttendanceRiskInTransaction(prisma,reviewer,caseId,payload);expect(first.idempotent).toBe(false)
  const call=vi.mocked(prisma.$executeRaw).mock.calls.find(([sql])=>sql.join(" ").includes("INSERT INTO mtm_attendance_risk_decisions"))!
  existing=[{id:first.id,requestId:payload.requestId,requestHash:call[5],caseId}]
  expect(await dismissAttendanceRiskInTransaction(prisma,reviewer,caseId,payload)).toEqual({id:first.id,idempotent:true})
  expect(prisma.mtmAuditLog.create).toHaveBeenCalledTimes(1)
  await expect(dismissAttendanceRiskInTransaction(prisma,reviewer,caseId,{...payload,reason:"Different explanation"})).rejects.toMatchObject({status:409})
  expect(JSON.stringify(vi.mocked(prisma.mtmAuditLog.create).mock.calls)).not.toContain("Fictional shared phone")
 })
 it.each([{...query,from:"2026-02-30"},{...query,organizationId:"foreign"},{...query,to:"2028-01-01"}])("rejects malformed filters",value=>expect(AttendanceRiskQuerySchema.safeParse(value).success).toBe(false))
})
