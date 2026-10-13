import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
vi.mock("@/lib/prisma",async()=>({prisma:(await import("./mocks/mtm-prisma")).makeMtmPrismaMock()}))
vi.mock("@/lib/api-auth",()=>({getOrgId:vi.fn(),getSession:vi.fn().mockResolvedValue(null),requireAuth:vi.fn(),isAuthError:(v:unknown)=>v instanceof Response}))
vi.mock("@/lib/mtm-audit",()=>({writeMtmAudit:vi.fn()}))
import { prisma } from "@/lib/prisma"
import { requireAuth, getOrgId } from "@/lib/api-auth"
import { PUT } from "@/app/api/v1/mtm/settings/route"
import { enforceAttendanceOutsideRule, saveAttendanceOutsideRule, ATTENDANCE_OUTSIDE_RULE_KEY as KEY } from "@/lib/mtm/attendance-outside-rule"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
const ORG="fictional-outside-rule",ADMIN="fictional-policy-admin"
const reviewer={organizationId:ORG,userId:ADMIN,principalType:"session" as const}
const put=(value:unknown)=>new NextRequest("http://localhost/api/v1/mtm/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(value)})
beforeEach(()=>{
 vi.clearAllMocks()
 vi.mocked(prisma.$queryRaw).mockResolvedValue([{role:"admin",hiddenModules:[]}])
 vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
 vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue(null)
 vi.mocked(prisma.mtmSetting.upsert).mockResolvedValue({} as never)
 vi.mocked(requireAuth).mockResolvedValue({orgId:ORG,userId:ADMIN,role:"admin",principalType:"session"} as never)
 vi.mocked(getOrgId).mockResolvedValue(ORG)
})
describe("one attendance outside rule",()=>{
 it("defaults to acceptance without creating a setting or audit",async()=>{
  expect(MTM_SETTING_DEFAULTS[KEY]).toBe(false)
  await expect(enforceAttendanceOutsideRule(prisma,ORG,"OUTSIDE")).resolves.toBeUndefined()
  expect(await saveAttendanceOutsideRule(reviewer,false)).toEqual({changed:false})
  expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled();expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
 })
 it.each(["INSIDE","UNCERTAIN","UNCONFIGURED","UNAVAILABLE","NO_CONSENT","BREAK_PRIVACY"] as const)("does not reject %s even under a restrictive setting",async finding=>{
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:true} as never)
  await expect(enforceAttendanceOutsideRule(prisma,ORG,finding)).resolves.toBeUndefined()
  expect(prisma.mtmSetting.findUnique).not.toHaveBeenCalled()
 })
 it("rejects only a fresh exact true setting",async()=>{
  for(const value of[false,"true",null,0]){vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value} as never);await expect(enforceAttendanceOutsideRule(prisma,ORG,"OUTSIDE")).resolves.toBeUndefined()}
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:true} as never)
  await expect(enforceAttendanceOutsideRule(prisma,ORG,"OUTSIDE")).rejects.toMatchObject({code:"MTM_ATTENDANCE_LOCATION_OUTSIDE_REJECTED",status:422})
 })
 it.each(["manager","sales","viewer"])("denies %s before writing any submitted setting",async role=>{
  vi.mocked(requireAuth).mockResolvedValue({orgId:ORG,userId:ADMIN,role,principalType:"session"} as never)
  expect((await PUT(put({[KEY]:true,maxPhotosPerVisit:12}))).status).toBe(403)
  expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled();expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
 })
 it("checks current administrator status, not just the authentication claim",async()=>{
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{role:"manager",hiddenModules:[]}])
  expect((await PUT(put({[KEY]:true,maxPhotosPerVisit:12}))).status).toBe(403)
  expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
 })
 it("rejects nonboolean and API-key writes",async()=>{
  expect((await PUT(put({[KEY]:"true"}))).status).toBe(400)
  vi.mocked(requireAuth).mockResolvedValue({orgId:ORG,userId:ADMIN,role:"admin",principalType:"api_key"} as never)
  expect((await PUT(put({[KEY]:true}))).status).toBe(403)
  expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
 })
 it("saves the sole rule with actor audit and does not write it again through the generic path",async()=>{
  expect((await PUT(put({[KEY]:true}))).status).toBe(200)
  expect(prisma.mtmSetting.upsert).toHaveBeenCalledTimes(1)
  expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({data:expect.objectContaining({organizationId:ORG,actorUserId:ADMIN,oldData:{rejectOutside:false},newData:{rejectOutside:true}})})
  vi.clearAllMocks();vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:true} as never)
  expect(await saveAttendanceOutsideRule(reviewer,true)).toEqual({changed:false})
  expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled();expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled()
 })
})
