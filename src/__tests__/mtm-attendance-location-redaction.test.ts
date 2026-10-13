import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/prisma",async()=>({prisma:(await import("./mocks/mtm-prisma")).makeMtmPrismaMock()}))
import { prisma } from "@/lib/prisma"
import { attendanceMarkRedactedHash, currentAttendanceStreamConsent, recordAttendanceMarkEvidence, isAttendanceMarkRedactedReplay } from "@/lib/mtm/attendance-location-store"
import { recordAttendanceQr } from "@/lib/mtm/attendance-qr-store"
import { mtmWorkdayRequestHash, parseMtmWorkdayEvent } from "@/lib/mtm/workday"
const scope={organizationId:"fictional-org",agentId:"fictional-agent"}
const now=new Date("2026-10-13T05:00:00Z")
const input=()=>parseMtmWorkdayEvent({action:"START",id:"fictional-day",occurredAt:now.toISOString(),attendanceMark:{version:1,installationId:"rf-fictional-installation-0000001",locationState:"AVAILABLE",consentRevisionId:"fictional-acceptance",location:{latitude:40.4,longitude:49.85,accuracy:5,capturedAt:now.toISOString(),isMock:false,provider:"GPS"}}},"fictional-event","Asia/Baku",now).input!
const redacted=()=>({...input(),attendanceMark:{...input().attendanceMark!,locationState:"NO_CONSENT" as const,location:null,consentRevisionId:null}})
beforeEach(()=>{vi.resetAllMocks();vi.mocked(prisma.$queryRaw).mockResolvedValue([])})
describe("one-way attendance location redaction",()=>{
 it("binds the stripped action to the same canonical digest without its coordinates or consent",()=>{
  expect(attendanceMarkRedactedHash(scope,input())).toBe(mtmWorkdayRequestHash(scope,redacted()))
  expect(attendanceMarkRedactedHash(scope,input())).not.toBe(mtmWorkdayRequestHash(scope,input()))
  expect(attendanceMarkRedactedHash(scope,{...input(),attendanceMark:undefined})).toBeNull()
 })
 it("does not turn altered action, time, installation or employee into the original redaction",()=>{
  const original=attendanceMarkRedactedHash(scope,input()),value=redacted()
  for(const changed of[{...value,action:"FINISH" as const},{...value,claimedAt:new Date(now.getTime()+1)},{...value,attendanceMark:{...value.attendanceMark,installationId:"rf-fictional-installation-0000002"}},{...value,clientEventId:"different-event"}])expect(mtmWorkdayRequestHash(scope,changed)).not.toBe(original)
  expect(mtmWorkdayRequestHash({...scope,agentId:"other"},value)).not.toBe(original)
 })
 it("never queries for a replay that carries new coordinates or a lingering consent identifier",async()=>{
  const hash=mtmWorkdayRequestHash(scope,input())
  for(const value of[input(),{...redacted(),attendanceMark:{...redacted().attendanceMark,consentRevisionId:"old-receipt"}},{...input(),attendanceMark:undefined}])expect(await isAttendanceMarkRedactedReplay(prisma,scope,value,hash)).toBe(false)
  expect(await isAttendanceMarkRedactedReplay(prisma,scope,redacted(),null)).toBe(false)
  expect(prisma.$queryRaw).not.toHaveBeenCalled()
 })
 it("requires stored evidence for the original event and scoped hash; a missing receipt is not proof",async()=>{
  const hash=mtmWorkdayRequestHash(scope,input())
  expect(await isAttendanceMarkRedactedReplay(prisma,scope,redacted(),hash)).toBe(false)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{id:"fixture-evidence"}])
  expect(await isAttendanceMarkRedactedReplay(prisma,scope,redacted(),hash)).toBe(true)
  // The real migration/RLS/concurrency behavior is covered by the PG suite.
  const values=vi.mocked(prisma.$queryRaw).mock.calls.at(-1)!.slice(1)
  expect(values).toEqual([scope.organizationId,scope.agentId,input().clientEventId,hash,mtmWorkdayRequestHash(scope,redacted())])
 })
})


describe("excluded employee attendance evidence", () => {
 it("discards stale queued attendance marks and QR without applying attendance restrictions to the field day", async () => {
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ attendanceExcluded: true } as never)
  vi.mocked(prisma.mtmSetting.findUnique).mockResolvedValue({ value: true } as never)
  const parsed = input()
  await recordAttendanceQr(prisma, scope, parsed, "fictional-event")
  await recordAttendanceMarkEvidence(prisma, { scope, input: parsed, workday: { id: "fictional-day" }, event: { id: "fictional-event" } } as Parameters<typeof recordAttendanceMarkEvidence>[1], { ...scope, role: "AGENT" })
  expect(prisma.$executeRaw).not.toHaveBeenCalled(); expect(prisma.$queryRaw).not.toHaveBeenCalled()
 })
 it("does not append attendance stream metadata for an excluded field employee", async () => {
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ attendanceExcluded: true } as never)
  vi.mocked(prisma.mtmSetting.findFirst).mockResolvedValue({ value: true } as never)
  expect(await currentAttendanceStreamConsent(prisma, scope)).toBeNull()
  expect(vi.mocked(prisma.$queryRaw).mock.calls.some(call => Array.isArray(call[0]) && call[0].join(" ").includes("mtm_attendance_location_consents"))).toBe(false)
 })
})
