import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.mock("@/lib/prisma",async()=>({prisma:(await import("./mocks/mtm-prisma")).makeMtmPrismaMock()}))
vi.mock("@/lib/api-auth",()=>({getOrgId:vi.fn(),getSession:vi.fn().mockResolvedValue(null),requireAuth:vi.fn(),isAuthError:(v:unknown)=>v instanceof Response}))
vi.mock("@/lib/mtm-audit",()=>({writeMtmAudit:vi.fn()}))
vi.mock("@/lib/mtm/attendance-risk-notify",()=>({notifyAttendanceRiskReviewers:vi.fn()}))
import { prisma } from "@/lib/prisma"
import { requireAuth, getOrgId } from "@/lib/api-auth"
import { PUT } from "@/app/api/v1/mtm/settings/route"
import { attendanceTimingRisk, usualAttendanceInstallationUser, enforceAttendanceMockRule, recordAttendanceRisks } from "@/lib/mtm/attendance-risk-detection"
import { DEFAULT_ATTENDANCE_RISK_POLICY, saveAttendanceRiskPolicy, ATTENDANCE_RISK_SETTING_KEYS } from "@/lib/mtm/attendance-risk-policy"
import { notifyAttendanceRiskReviewers } from "@/lib/mtm/attendance-risk-notify"
const ORG="fictional-risk",ADMIN="fictional-admin",reviewer={organizationId:ORG,userId:ADMIN,principalType:"session" as const}
const put=(body:unknown)=>new NextRequest("http://localhost/api/v1/mtm/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();vi.mocked(prisma.$queryRaw).mockResolvedValue([{role:"admin",hiddenModules:[]}]);vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([]);vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null);vi.mocked(requireAuth).mockResolvedValue({orgId:ORG,userId:ADMIN,role:"admin",principalType:"session"} as never);vi.mocked(getOrgId).mockResolvedValue(ORG)})
describe("MTM review hints without automatic fraud conclusions",()=>{
 it("distinguishes a delivery delay from clock difference without double-counting",()=>{const time=new Date("2026-10-13T08:00:00Z");const at=(seconds:number)=>new Date(time.getTime()+seconds*1000)
  expect(attendanceTimingRisk(time,at(300),300)).toBeNull();expect(attendanceTimingRisk(time,at(301),300)).toMatchObject({kind:"CLOCK_DIFFERENCE",details:{deltaSeconds:301}})
  expect(attendanceTimingRisk(time,at(901),300)).toMatchObject({kind:"DELAYED_CLAIM",details:{deltaSeconds:901,thresholdSeconds:900}})
  expect(attendanceTimingRisk(at(121),time,120)).toMatchObject({kind:"CLOCK_DIFFERENCE",details:{deltaSeconds:-121}})
 })
 it("does not call a first observation, a tie, or sparse history the usual user",()=>{const a=(agentId:string,date:number)=>({agentId,workDate:new Date(`2026-10-0${date}T00:00:00Z`)})
  expect(usualAttendanceInstallationUser([a("a",1)])).toMatchObject({usualAgentId:null,observedDays:1})
  expect(usualAttendanceInstallationUser([a("a",1),a("b",2)])).toMatchObject({usualAgentId:null})
  expect(usualAttendanceInstallationUser([a("a",1),a("a",2),a("a",3),a("b",1),a("b",2),a("b",3)])).toMatchObject({usualAgentId:null})
  expect(usualAttendanceInstallationUser([a("a",1),a("a",1),a("a",2),a("a",3),a("b",1)])).toEqual({usualAgentId:"a",usualDays:3,observedDays:3})
 })
 it.each([null,false])("does not reject absent or non-mock provenance: %s",async value=>{vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceRejectMockLocations",value:true}] as never);await expect(enforceAttendanceMockRule(prisma,ORG,value)).resolves.toMatchObject({rejectMockLocations:true})})
 it("accepts flagged mock locations by default and rejects only an exact enabled rule",async()=>{await expect(enforceAttendanceMockRule(prisma,ORG,true)).resolves.toMatchObject({rejectMockLocations:false});vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceRejectMockLocations",value:true}] as never);await expect(enforceAttendanceMockRule(prisma,ORG,true)).rejects.toMatchObject({code:"MTM_ATTENDANCE_LOCATION_MOCK_REJECTED"})})
 it.each(ATTENDANCE_RISK_SETTING_KEYS)("refuses a manager's mixed write of %s before any setting",async key=>{vi.mocked(requireAuth).mockResolvedValue({orgId:ORG,userId:ADMIN,role:"manager",principalType:"session"} as never);expect((await PUT(put({[key]:key.includes("Seconds")?60:true,maxPhotosPerVisit:12}))).status).toBe(403);expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()})
 it("refuses a stale administrator claim or API key before writing",async()=>{vi.mocked(prisma.$queryRaw).mockResolvedValue([{role:"manager",hiddenModules:[]}]);await expect(saveAttendanceRiskPolicy(reviewer,{attendanceRejectMockLocations:true})).rejects.toMatchObject({status:403});await expect(saveAttendanceRiskPolicy({...reviewer,principalType:"api_key"},{attendanceRejectMockLocations:true})).rejects.toMatchObject({status:403});expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()})
 it.each([29,86401,1.5,"300"])("rejects an invalid clock threshold %s",async value=>{expect((await PUT(put({attendanceClockDifferenceSeconds:value,maxPhotosPerVisit:12}))).status).toBe(400);expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()})
 it("does nothing when attendance was disabled",async()=>{await recordAttendanceRisks(prisma,{organizationId:ORG,eventId:"event",policy:DEFAULT_ATTENDANCE_RISK_POLICY});expect(prisma.$queryRaw).not.toHaveBeenCalled();expect(notifyAttendanceRiskReviewers).not.toHaveBeenCalled()})
 it("adds one case for each employee already seen on the same installation and only notifies new cases",async()=>{
  vi.mocked(prisma.mtmSetting.findUnique).mockImplementation((async({where}:{where:{organizationId_key:{key:string}}})=>({value:where.organizationId_key.key==="attendanceEnabled"?true:"Asia/Baku"})) as never)
  const day=new Date("2026-10-13T00:00:00Z"),fact={agentId:"b",eventId:"eb",installationId:"private-installation",workDate:day,claimedAt:day,serverReceivedAt:day,isMock:null,locationState:"NO_CONSENT",distanceMeters:null,branchRevisionId:null}
  let replay=false;const written:Array<Record<string,unknown>>=[]
  vi.mocked(prisma.$queryRaw).mockImplementation((async(parts:TemplateStringsArray,...values:unknown[])=>{const sql=parts.join("?")
    if(sql.includes('SELECT m."agentId",m."eventId",m."installationId"'))return[fact]
    if(sql.includes('AS "anySeen"'))return[{anySeen:false,sameSeen:false}]
    if(sql.includes('SELECT DISTINCT'))return[]
    if(sql.includes('ORDER BY m."agentId"'))return[{agentId:"a",eventId:"ea",workDate:day},{agentId:"b",eventId:"eb",workDate:day}]
    if(sql.includes('INSERT INTO mtm_attendance_risk_cases')){written.push({agent:values[2],event:values[3],kind:values[4],details:JSON.parse(String(values[9]))});return replay?[]:[{id:String(values[0])}]}
    throw new Error("Unexpected query")
  }) as never)
  await recordAttendanceRisks(prisma,{organizationId:ORG,eventId:"eb",policy:DEFAULT_ATTENDANCE_RISK_POLICY})
  expect(written).toMatchObject([{agent:"a",event:"ea",kind:"SHARED_INSTALLATION",details:{relatedAgentIds:["b"],usualAgentId:null}},{agent:"b",event:"eb",kind:"SHARED_INSTALLATION",details:{relatedAgentIds:["a"]}}]);expect(JSON.stringify(written)).not.toContain("private-installation")
  expect(notifyAttendanceRiskReviewers).toHaveBeenCalledTimes(2);replay=true;await recordAttendanceRisks(prisma,{organizationId:ORG,eventId:"eb",policy:DEFAULT_ATTENDANCE_RISK_POLICY});expect(notifyAttendanceRiskReviewers).toHaveBeenCalledTimes(2)
 })
})
