import { NextRequest } from "next/server"
import { beforeEach,describe,expect,it,vi } from "vitest"
vi.mock("@/lib/prisma",async()=>({prisma:(await import("./mocks/mtm-prisma")).makeMtmPrismaMock()}))
vi.mock("@/lib/mobile-auth",()=>({resolveMobileAuth:vi.fn()}))
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { GET,POST } from "@/app/api/v2/mtm/mobile/route-field/attendance/location-consent/route"
import { getRlsContext } from "@/lib/rls-context"
import { officeAttendanceMobilePath } from "@/lib/mtm/attendance-employee-contract"
const request=(body?:unknown)=>new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/attendance/location-consent",body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
const consent={requestId:"ec2f6acb-f55f-4717-ae23-bec9790ebc14",policyRevisionId:"fictional-policy",expectedConsentId:null,accepted:true}
beforeEach(()=>{
 vi.resetAllMocks()
 vi.mocked(resolveMobileAuth).mockResolvedValue({orgId:"fictional-org",agentId:"fictional-office",role:"EMPLOYEE",tenantCapabilities:{routeField:true,workforceHrm:false}} as never)
 vi.mocked(prisma.$transaction).mockImplementation((async(callback:(tx:typeof prisma)=>unknown)=>callback(prisma)) as never)
 vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true}] as never)
 vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({id:"fictional-office",role:"EMPLOYEE",attendanceParticipant:true} as never)
 vi.mocked(prisma.$queryRaw).mockResolvedValue([])
})
describe("own attendance location consent transport",()=>{
 it("returns empty legal text and no consent by default, under the authenticated tenant",async()=>{
  vi.mocked(prisma.$queryRaw).mockImplementation((async()=>{expect(getRlsContext()).toMatchObject({orgId:"fictional-org"});return []}) as never)
  const response=await GET(request());expect(response.status).toBe(200)
  expect(await response.json()).toEqual({success:true,data:{policy:null,consent:null,maySendLocation:false}})
  expect(response.headers.get("cache-control")).toBe("private, no-store")
 })
 it("allows only the two reviewed office methods at the exact own endpoint",()=>{
  for(const method of["GET","POST"])expect(officeAttendanceMobilePath(method,"/api/v2/mtm/mobile/route-field/attendance/location-consent")).toBe(true)
  for(const method of["PUT","DELETE","PATCH"])expect(officeAttendanceMobilePath(method,"/api/v2/mtm/mobile/route-field/attendance/location-consent")).toBe(false)
  expect(officeAttendanceMobilePath("POST","/api/v1/mtm/attendance/location-policy")).toBe(false)
 })
 it("refuses collection while the whole feature is disabled and writes no consent",async()=>{
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:false}] as never)
  expect((await GET(request())).status).toBe(404);expect((await POST(request(consent))).status).toBe(404)
  expect(vi.mocked(prisma.$queryRaw).mock.calls.some(call=>String(call[0]).includes("INSERT"))).toBe(false)
 })
 it("refuses an unenrolled or inactive employee before returning the legal text",async()=>{
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null)
  expect((await GET(request())).status).toBe(403);expect((await POST(request(consent))).status).toBe(403)
  expect(vi.mocked(prisma.$queryRaw).mock.calls.some(call=>String(call[0]).includes("mtm_attendance_location_"))).toBe(false)
 })
 it("rejects another employee or tenant supplied by the client",async()=>{
  for(const extra of[{agentId:"foreign"},{organizationId:"foreign"}])expect((await POST(request({...consent,...extra}))).status).toBe(400)
  expect(prisma.$transaction).not.toHaveBeenCalled()
 })
 it("cannot invent consent to an unpublished text",async()=>{
  const response=await POST(request(consent));expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({code:"MTM_ATTENDANCE_LOCATION_POLICY_CHANGED"})
  expect(vi.mocked(prisma.$queryRaw).mock.calls.some(call=>String(call[0]).includes("INSERT"))).toBe(false)
 })
 it("caps request bodies before any consent write",async()=>{
  expect((await POST(request({...consent,extra:"x".repeat(5000)}))).status).toBe(413)
  expect(prisma.$transaction).not.toHaveBeenCalled()
 })
})
