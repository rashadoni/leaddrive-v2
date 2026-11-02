import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/mtm/attendance-month-store", () => ({ readAttendanceMonthDirectory:vi.fn(),closeAttendanceMonth:vi.fn(),previewAttendanceMonth:vi.fn(),readAttendanceMonth:vi.fn(),readAttendanceMonthTable:vi.fn(),readAttendanceMonthN1t:vi.fn(),readAttendanceMonthN1tForm:vi.fn() }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getRlsContext } from "@/lib/rls-context"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import * as store from "@/lib/mtm/attendance-month-store"
import { GET, POST } from "@/app/api/v1/mtm/attendance/months/route"
import { POST as PREVIEW } from "@/app/api/v1/mtm/attendance/months/preview/route"
import { GET as DETAIL } from "@/app/api/v1/mtm/attendance/months/[id]/route"
import { GET as EXPORT } from "@/app/api/v1/mtm/attendance/months/[id]/export/route"
import { GET as N1T } from "@/app/api/v1/mtm/attendance/months/n1t/route"
import { GET as N1T_EXPORT } from "@/app/api/v1/mtm/attendance/months/n1t/export/route"
const id="00000000-0000-4000-8000-000000000001",ctx={params:Promise.resolve({id})}
const request=(body?:string,query="month=2026-09")=>new NextRequest(`http://localhost/api/v1/mtm/attendance/months?${query}`,body===undefined?{}:{method:"POST",body,headers:{"content-type":"application/json"}})
beforeEach(()=>{
 vi.clearAllMocks()
 vi.mocked(requireAuth).mockResolvedValue({orgId:"month-fixture",userId:"month-admin",role:"admin",principalType:"session"} as never)
 vi.mocked(resolveMtmRouteActor).mockResolvedValue({role:"ADMIN",agentId:null,scopedAgentIds:null})
 vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{key:"attendanceEnabled",value:true}] as never)
 vi.mocked(store.readAttendanceMonthDirectory).mockResolvedValue({} as never)
 vi.mocked(store.closeAttendanceMonth).mockResolvedValue({id,idempotent:false} as never)
 vi.mocked(store.readAttendanceMonthTable).mockResolvedValue({month:"2026-09",form:"MONTH",table:{title:"Fictional frozen month",columns:[{key:"employee",label:"Employee"}],rows:[{key:"a",cells:["Fictional employee"]}],details:[],totals:[]}})
})
describe("month close HTTP boundaries",()=>{
 it("runs the authenticated directory under tenant RLS and marks it private",async()=>{
  vi.mocked(store.readAttendanceMonthDirectory).mockImplementationOnce(async reviewer=>{expect(reviewer).toEqual({organizationId:"month-fixture",userId:"month-admin",principalType:"session"});expect(getRlsContext()).toMatchObject({orgId:"month-fixture"});return {} as never})
  const response=await GET(request(),undefined);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store")
 })
 it("hides all surfaces while attendance is disabled",async()=>{
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  for(const response of [await GET(request(),undefined),await POST(request("{}"),undefined),await PREVIEW(request("{}"),undefined),await DETAIL(request(),ctx),await EXPORT(request(undefined,"locale=en&format=pdf"),ctx),await N1T(request(undefined,"month=2026-09&locale=az"),undefined),await N1T_EXPORT(request(undefined,"month=2026-09&locale=az&format=xlsx"),undefined)])expect(response.status).toBe(404)
  for(const fn of Object.values(store))expect(fn).not.toHaveBeenCalled()
 })
 it.each(["api_key",undefined])("refuses %s before reaching a snapshot",async principalType=>{
  vi.mocked(requireAuth).mockResolvedValue({orgId:"month-fixture",userId:"month-admin",role:"admin",principalType} as never)
  expect((await GET(request(),undefined)).status).toBe(403);expect((await POST(request("{}"),undefined)).status).toBe(403);expect(store.closeAttendanceMonth).not.toHaveBeenCalled()
 })
 it("requires write permission for both preview and close",async()=>{
  vi.mocked(requireAuth).mockResolvedValue(new NextResponse(null,{status:403}))
  expect((await PREVIEW(request("{}"),undefined)).status).toBe(403);expect((await POST(request("{}"),undefined)).status).toBe(403)
  expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest),"mtm","write",{deferLegacyModuleGate:"mtm"});expect(store.closeAttendanceMonth).not.toHaveBeenCalled()
 })
 it.each([["{",400],[JSON.stringify({padding:"x".repeat(32769)}),413]] as const)("refuses malformed or oversized input before a write",async(body,status)=>{
  expect((await POST(request(body),undefined)).status).toBe(status);expect((await PREVIEW(request(body),undefined)).status).toBe(status);expect(store.closeAttendanceMonth).not.toHaveBeenCalled();expect(store.previewAttendanceMonth).not.toHaveBeenCalled()
 })
 it("returns a fresh denial and conceals unexpected private error details",async()=>{
  vi.mocked(store.closeAttendanceMonth).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_MONTH_FORBIDDEN",403))
  expect((await POST(request("{}"),undefined)).status).toBe(403)
  vi.mocked(store.closeAttendanceMonth).mockRejectedValueOnce(new Error("PRIVATE employee payload"))
  const response=await POST(request("{}"),undefined);expect(response.status).toBe(500);expect(await response.text()).not.toContain("PRIVATE")
 })
 it("exports only the authorized stored table, with private download headers",async()=>{
  const response=await EXPORT(request(undefined,"locale=en&format=pdf"),ctx)
  expect(response.status).toBe(200);expect(response.headers.get("content-type")).toBe("application/pdf");expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString()).toBe("%PDF")
  expect(store.readAttendanceMonthTable).toHaveBeenCalledWith({organizationId:"month-fixture",userId:"month-admin",principalType:"session"},id,"en")
  expect(store.readAttendanceMonthDirectory).not.toHaveBeenCalled()
 })
 // Personnel → Reports → N-1t reads the month (frozen N-1t or what a press freezes) under the same boundary.
 it("reads the N-1t month for a signed-in person under tenant RLS, privately",async()=>{
  vi.mocked(store.readAttendanceMonthN1t).mockImplementationOnce(async(reviewer,query)=>{expect(reviewer).toEqual({organizationId:"month-fixture",userId:"month-admin",principalType:"session"});expect(query).toEqual({month:"2026-09",locale:"az"});expect(getRlsContext()).toMatchObject({orgId:"month-fixture"});return {} as never})
  const response=await N1T(request(undefined,"month=2026-09&locale=az"),undefined);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store")
  vi.mocked(requireAuth).mockResolvedValue({orgId:"month-fixture",userId:"month-admin",role:"admin",principalType:"api_key"} as never)
  expect((await N1T(request(undefined,"month=2026-09&locale=az"),undefined)).status).toBe(403);expect(store.readAttendanceMonthN1t).toHaveBeenCalledTimes(1)
 })
 it("names the closed month's file after its N-1t form",async()=>{
  vi.mocked(store.readAttendanceMonthTable).mockResolvedValueOnce({month:"2026-09",form:"N1T",table:{title:"Fictional N-1t",columns:[{key:"index",label:"№"}],rows:[{key:"a",cells:[1]}],details:[],totals:[]}})
  const response=await EXPORT(request(undefined,"locale=az&format=xlsx"),ctx);expect(response.status).toBe(200);expect(response.headers.get("content-disposition")).toContain("N-1t-2026-09.xlsx")
 })
 // One file for the month's one N-1t, however many closes of 100 it was frozen in (owner, 2026-10-20).
 it("exports the month's one N-1t for a signed-in person under tenant RLS, named after the month",async()=>{
  vi.mocked(store.readAttendanceMonthN1tForm).mockImplementation(async(reviewer,query)=>{expect(reviewer).toEqual({organizationId:"month-fixture",userId:"month-admin",principalType:"session"});expect(query).toEqual({month:"2026-09",locale:"ru"});expect(getRlsContext()).toMatchObject({orgId:"month-fixture"})
   return {month:"2026-09",table:{title:"Fictional N-1t",columns:[{key:"index",label:"№"},{key:"employee",label:"Employee"}],rows:Array.from({length:105},(_,i)=>({key:`a${i}`,cells:[i+1,`Fictional employee ${i+1}`]})),details:[],totals:["Totals"]}}})
  const pdf=await N1T_EXPORT(request(undefined,"month=2026-09&locale=ru&format=pdf"),undefined)
  expect(pdf.status).toBe(200);expect(pdf.headers.get("content-type")).toBe("application/pdf");expect(pdf.headers.get("cache-control")).toBe("private, no-store");expect(pdf.headers.get("content-disposition")).toContain("N-1t-2026-09.pdf")
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString()).toBe("%PDF")
  const xlsx=await N1T_EXPORT(request(undefined,"month=2026-09&locale=ru&format=xlsx"),undefined);expect(xlsx.status).toBe(200);expect(xlsx.headers.get("content-disposition")).toContain("N-1t-2026-09.xlsx")
  vi.mocked(requireAuth).mockResolvedValue({orgId:"month-fixture",userId:"month-admin",role:"admin",principalType:"api_key"} as never)
  expect((await N1T_EXPORT(request(undefined,"month=2026-09&locale=ru&format=xlsx"),undefined)).status).toBe(403);expect(store.readAttendanceMonthN1tForm).toHaveBeenCalledTimes(2)
 })
 it("validates the month's N-1t file request before reading stored cells, and passes on a month with no frozen N-1t",async()=>{
  for(const query of ["month=2026-13&locale=az&format=pdf","month=2026-09&locale=xx&format=pdf","month=2026-09&locale=az&format=csv","month=2026-09&format=pdf","month=2026-09&locale=az&format=pdf&id=x"])expect((await N1T_EXPORT(request(undefined,query),undefined)).status).toBe(400)
  expect(store.readAttendanceMonthN1tForm).not.toHaveBeenCalled()
  vi.mocked(store.readAttendanceMonthN1tForm).mockRejectedValueOnce(new AttendanceRequestError("MTM_ATTENDANCE_MONTH_NOT_FOUND",404))
  const missing=await N1T_EXPORT(request(undefined,"month=2026-09&locale=az&format=pdf"),undefined);expect(missing.status).toBe(404);expect((await missing.json()).code).toBe("MTM_ATTENDANCE_MONTH_NOT_FOUND")
 })
 it("validates export locale and format before reading stored employee cells",async()=>{
  expect((await EXPORT(request(undefined,"locale=xx&format=pdf"),ctx)).status).toBe(400)
  expect((await EXPORT(request(undefined,"locale=en&format=csv"),ctx)).status).toBe(400)
  expect(store.readAttendanceMonthTable).not.toHaveBeenCalled()
 })
})
