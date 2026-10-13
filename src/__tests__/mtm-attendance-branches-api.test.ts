import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma",async()=>({prisma:(await import("./mocks/mtm-prisma")).makeMtmPrismaMock()}))
vi.mock("@/lib/api-auth",()=>({requireAuth:vi.fn(),getOrgId:vi.fn(),getSession:vi.fn().mockResolvedValue(null),isAuthError:(value:unknown)=>value instanceof Response}))
vi.mock("@/lib/mtm/route-permissions",async original=>({...await original<typeof import("@/lib/mtm/route-permissions")>(),resolveMtmRouteActor:vi.fn()}))
vi.mock("@/lib/tenant-capability-access",async original=>({...await original<typeof import("@/lib/tenant-capability-access")>(),requireTenantCapabilityAccessResponse:vi.fn().mockResolvedValue(null)}))
vi.mock("@/lib/mtm/attendance-branches-store",()=>({readAttendanceBranches:vi.fn(),readAttendanceBranchAssignments:vi.fn(),saveAttendanceBranch:vi.fn(),saveAttendancePrimaryBranch:vi.fn()}))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import * as store from "@/lib/mtm/attendance-branches-store"
import { GET, POST } from "@/app/api/v1/mtm/attendance/branches/route"
import { GET as assignments, POST as assign } from "@/app/api/v1/mtm/attendance/branches/assignments/route"
import { AttendanceBranchInputSchema, AttendanceBranchAssignmentInputSchema } from "@/lib/mtm/attendance-branches-contract"
const request=(method="GET",body?:string)=>new NextRequest("http://localhost/api/v1/mtm/attendance/branches",{method,...(body===undefined?{}:{body,headers:{"content-type":"application/json"}})})
const input={requestId:"b0000000-0000-4000-8000-000000000001",branchId:null,expectedRevisionId:null,name:"Demo office",address:"Demo address",latitude:40.4,longitude:49.8,radiusMeters:150,active:true}
beforeEach(()=>{
 vi.clearAllMocks()
 vi.mocked(requireAuth).mockResolvedValue({orgId:"branch-fixture",userId:"admin-fixture",role:"admin",principalType:"session"} as never)
 vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"ADMIN",agentId:null,scopedAgentIds:null})
 vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true}] as never)
 vi.mocked(store.readAttendanceBranches).mockResolvedValue({branches:[],canManageBranches:true})
 vi.mocked(store.readAttendanceBranchAssignments).mockResolvedValue({employees:[],hasMore:false})
 vi.mocked(store.saveAttendanceBranch).mockResolvedValue({branch:{revisionId:input.requestId},idempotent:false} as never)
 vi.mocked(store.saveAttendancePrimaryBranch).mockResolvedValue({primary:{revisionId:input.requestId},idempotent:false} as never)
})
describe("MTM branch HTTP and input boundaries",()=>{
 it.each([GET,assignments])("requires explicit opt-in before a read",async route=>{
   vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
   expect((await route(request(),undefined)).status).toBe(404)
   expect(store.readAttendanceBranches).not.toHaveBeenCalled();expect(store.readAttendanceBranchAssignments).not.toHaveBeenCalled()
 })
 it.each(["api_key",undefined])("refuses %s principals before registry reads/writes",async principalType=>{
   vi.mocked(requireAuth).mockResolvedValue({orgId:"branch-fixture",userId:"admin-fixture",role:"admin",principalType} as never)
   for(const route of[GET,assignments,POST,assign])expect((await route(request(route===GET||route===assignments?"GET":"POST",route===GET||route===assignments?undefined:"{}"),undefined)).status).toBe(403)
   expect(store.readAttendanceBranches).not.toHaveBeenCalled();expect(store.saveAttendancePrimaryBranch).not.toHaveBeenCalled()
 })
 it.each([POST,assign])("bounds a write body before its service",async route=>{
   expect((await route(request("POST",JSON.stringify({padding:"x".repeat(5000)})),undefined)).status).toBe(413)
   expect(store.saveAttendanceBranch).not.toHaveBeenCalled();expect(store.saveAttendancePrimaryBranch).not.toHaveBeenCalled()
 })
 it("returns private no-store reads and passes the verified scope",async()=>{
   const response=await GET(request(),undefined);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store")
   await assignments(new NextRequest("http://localhost/api/v1/mtm/attendance/branches/assignments?search=Demo"),undefined)
   expect(store.readAttendanceBranchAssignments).toHaveBeenCalledWith({organizationId:"branch-fixture",userId:"admin-fixture",principalType:"session"},{role:"ADMIN",agentId:null,scopedAgentIds:null},"Demo")
 })
 it.each([{latitude:91},{longitude:-181},{radiusMeters:24},{radiusMeters:5001},{radiusMeters:2.5},{name:" "},{address:" "},{branchId:input.requestId},{unexpected:true}])("rejects invalid branch fields %j",change=>expect(AttendanceBranchInputSchema.safeParse({...input,...change}).success).toBe(false))
 it("supports zero coordinates, archive revisions and explicit unassignment",()=>{
   expect(AttendanceBranchInputSchema.safeParse({...input,latitude:0,longitude:0,active:false}).success).toBe(true)
   expect(AttendanceBranchAssignmentInputSchema.safeParse({requestId:input.requestId,expectedRevisionId:null,agentId:"agent-1",branchId:null}).success).toBe(true)
 })
})
