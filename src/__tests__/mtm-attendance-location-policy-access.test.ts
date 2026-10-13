import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
const caller=vi.hoisted(()=>({orgId:"fictional-policy-org",userId:"fictional-policy-admin",principalType:"session" as "session"|"api_key"|undefined}))
vi.mock("@/lib/mtm/with-attendance-auth",()=>({withMtmAttendanceAuth:(_action:unknown,handler:(req:NextRequest,auth:typeof caller)=>Promise<Response>)=>(req:NextRequest)=>handler(req,caller)}))
vi.mock("@/lib/mtm/attendance-location-store",()=>({readAttendanceLocationPolicy:vi.fn().mockResolvedValue({policy:null}),publishAttendanceLocationPolicy:vi.fn().mockResolvedValue({policy:null,idempotent:false})}))
import { GET,POST } from "@/app/api/v1/mtm/attendance/location-policy/route"
import { readAttendanceLocationPolicy, publishAttendanceLocationPolicy } from "@/lib/mtm/attendance-location-store"
const request=()=>new NextRequest("http://localhost/api/v1/mtm/attendance/location-policy",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})
beforeEach(()=>{vi.clearAllMocks();caller.principalType="session"})
describe("geo policy requires a positively identified web session",()=>{
 it.each([undefined,"api_key"] as const)("denies %s before reading or publishing",async principal=>{
  caller.principalType=principal
  expect((await GET(request())).status).toBe(403);expect((await POST(request())).status).toBe(403)
  expect(readAttendanceLocationPolicy).not.toHaveBeenCalled();expect(publishAttendanceLocationPolicy).not.toHaveBeenCalled()
 })
 it("passes the verified session to the store's current-admin and feature guard",async()=>{
  expect((await GET(request())).status).toBe(200);expect((await POST(request())).status).toBe(200)
  expect(readAttendanceLocationPolicy).toHaveBeenCalledWith({organizationId:caller.orgId,userId:caller.userId,principalType:"session"})
 })
})
