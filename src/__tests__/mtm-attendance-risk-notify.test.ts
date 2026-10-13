import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma",async()=>({prisma:(await import("./mocks/mtm-prisma")).makeMtmPrismaMock()}))
vi.mock("@/lib/mtm/route-permissions",async original=>({...await original<typeof import("@/lib/mtm/route-permissions")>(),resolveMtmRouteActor:vi.fn()}))
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { notifyAttendanceRiskReviewers } from "@/lib/mtm/attendance-risk-notify"
import { MTM_ATTENDANCE_RISK_NOTIFICATION_ENTITY as entity, MTM_ATTENDANCE_RISK_NOTIFICATION_KIND as kind } from "@/lib/mtm/attendance-risk-notification"
import { shouldPush } from "@/lib/notifications/prefs"
import { deriveSection } from "@/lib/notifications/taxonomy"
const input={organizationId:"fictional-risk-org",agentId:"fictional-employee",caseId:"fictional-case"}
const user={id:"fictional-reviewer",role:"manager",preferredLanguage:"ru",hiddenModules:[],mtmAttendanceAll:false}
beforeEach(()=>{
 vi.resetAllMocks();vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:true} as never)
 vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{userId:user.id}] as never)
 vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({userId:"fictional-self"} as never)
 vi.mocked(prisma.$queryRaw).mockResolvedValue([user])
 vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"MANAGER",agentId:null,scopedAgentIds:[input.agentId]})
 vi.mocked(prisma.notification.createMany).mockResolvedValue({count:1})
 vi.mocked(prisma.notification.findFirst).mockImplementation((async({where})=>({...where})) as never)
})
describe("risk bell delivery scope",()=>{
 it("commits one generic idempotent private preview and respects explicit opt-out",async()=>{
  await notifyAttendanceRiskReviewers(prisma,input);await notifyAttendanceRiskReviewers(prisma,input)
  const calls=vi.mocked(prisma.notification.createMany).mock.calls;expect(calls[0]).toEqual(calls[1])
  expect(calls[0][0]).toMatchObject({skipDuplicates:true,data:{entityType:entity,entityId:input.caseId,userId:user.id}})
  expect(JSON.stringify(calls)).not.toMatch(/fictional-employee|latitude|installationId|reason/)
  const section=deriveSection(entity)!;expect(section).toBe("Route & Field")
  expect(shouldPush({},section,kind)).toBe(true);expect(shouldPush({[section]:{push:true,types:{[kind]:false}}},section,kind)).toBe(false)
 })
 it("includes an HR reader without granting decisions",async()=>{
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{...user,role:"viewer",mtmAttendanceAll:true}])
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
  await notifyAttendanceRiskReviewers(prisma,input);expect(prisma.notification.createMany).toHaveBeenCalledTimes(1)
 })
 it.each(["off","other-team","self","hidden","no-scope"])("does not notify %s",async mode=>{
  if(mode==="off")vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({value:false} as never)
  if(mode==="other-team")vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"MANAGER",agentId:null,scopedAgentIds:["foreign"]})
  if(mode==="self")vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"MANAGER",agentId:input.agentId,scopedAgentIds:[input.agentId]})
  if(mode==="hidden")vi.mocked(prisma.$queryRaw).mockResolvedValue([{...user,hiddenModules:["mtm"]}])
  if(mode==="no-scope")vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
  await notifyAttendanceRiskReviewers(prisma,input);expect(prisma.notification.createMany).not.toHaveBeenCalled()
 })
 it("does not silently lose a durable notification on persistence failure",async()=>{
  vi.mocked(prisma.notification.createMany).mockRejectedValue(new Error("fictional DB failure"))
  await expect(notifyAttendanceRiskReviewers(prisma,input)).rejects.toThrow("MTM_ATTENDANCE_RISK_NOTIFICATION_UNAVAILABLE")
 })
})
