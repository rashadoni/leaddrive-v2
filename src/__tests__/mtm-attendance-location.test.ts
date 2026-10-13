import { describe, expect, it } from "vitest"
import { AttendanceMarkSchema, AttendanceLocationPolicyInputSchema, evaluateAttendanceLocation, attendanceDistanceMeters, type AttendanceMark } from "@/lib/mtm/attendance-location-contract"
import { parseMtmWorkdayEvent, mtmWorkdayRequestHash } from "@/lib/mtm/workday"

const now = new Date("2026-10-13T05:00:00.000Z")
const mark = (): AttendanceMark => ({version:1,installationId:"rf-fictional-installation-0000001",locationState:"AVAILABLE",consentRevisionId:"approved-fixture-text",
  location:{latitude:0,longitude:0,accuracy:5,capturedAt:now.toISOString(),provider:"GPS",isMock:false}})
const branch = {id:"revision-1",branchId:"branch-1",name:"Fictional branch",latitude:0,longitude:0,radiusMeters:150}
const input = (attendanceMark?: unknown) => ({action:"START",id:"fixture-workday",occurredAt:now.toISOString(),...(attendanceMark===undefined?{}:{attendanceMark})})
const parse = (value: unknown) => parseMtmWorkdayEvent(value,"fixture-event","Asia/Baku",now)
describe("action-only attendance packet and location assessment",() => {
  it("keeps old client packets and their hash compatible, while binding the new packet to retries",() => {
    const legacy=parse(input()).input!, modern=parse(input(mark())).input!
    expect(legacy).not.toHaveProperty("attendanceMark")
    expect(modern).toMatchObject({latitude:null,longitude:null,accuracy:null,attendanceMark:mark()})
    const scope={organizationId:"org",agentId:"agent"}
    expect(mtmWorkdayRequestHash(scope,legacy)).toBe(mtmWorkdayRequestHash(scope,{...legacy,attendanceMark:undefined}))
    expect(mtmWorkdayRequestHash(scope,modern)).not.toBe(mtmWorkdayRequestHash(scope,legacy))
    expect(mtmWorkdayRequestHash(scope,{...modern,attendanceMark:{...mark(),installationId:"rf-fictional-installation-0000002"}})).not.toBe(mtmWorkdayRequestHash(scope,modern))
    expect(mtmWorkdayRequestHash(scope,{...modern,attendanceMark:{...mark(),location:{...mark().location!,isMock:true}}})).not.toBe(mtmWorkdayRequestHash(scope,modern))
  })
  it.each(["PAUSE","RESUME"])("refuses %s endpoint evidence",action => {
    expect(parse({...input(mark()),action,workdayId:"fixture-workday"})).toMatchObject({input:null,code:"MTM_ATTENDANCE_MARK_INVALID"})
  })
  it("does not permit a second location/trust channel beside the new evidence",() => {
    expect(parse({...input(mark()),latitude:0,longitude:0})).toMatchObject({input:null})
    expect(parse({...input(mark()),attendance:{qrToken:"old-proof"}})).toMatchObject({input:null})
  })
  it.each(["UNAVAILABLE","NO_CONSENT"] as const)("accepts a time mark with %s",locationState => {
    const packet={...mark(),locationState,location:null,consentRevisionId:null}
    expect(parse(input(packet)).input?.attendanceMark).toEqual(packet)
    expect(evaluateAttendanceLocation(packet,now,[branch],null)).toEqual({finding:locationState,branch:null,distanceMeters:null,fixAgeSeconds:null})
  })
  it("rejects malformed or hidden location and identifying extras",() => {
    for (const packet of [{...mark(),locationState:"NO_CONSENT"},{...mark(),consentRevisionId:null},
      {...mark(),installationId:"hardware-id"},{...mark(),phone:"private"},{...mark(),location:{...mark().location!,accuracy:-1}},
      {...mark(),location:{...mark().location!,latitude:91}},{...mark(),location:{...mark().location!,capturedAt:"invalid"}}]) {
      expect(AttendanceMarkSchema.safeParse(packet).success).toBe(false)
    }
  })
  it("uses the complete accuracy circle and stable primary preference for overlapping branches",() => {
    const other={...branch,id:"revision-2",branchId:"branch-2"}
    expect(evaluateAttendanceLocation(mark(),now,[branch,other],other.branchId)).toMatchObject({finding:"INSIDE",branch:other,distanceMeters:0,fixAgeSeconds:0})
    const outside={...mark(),location:{...mark().location!,latitude:0.002}}
    expect(evaluateAttendanceLocation(outside,now,[branch],null)).toMatchObject({finding:"OUTSIDE",distanceMeters:222})
    expect(evaluateAttendanceLocation({...outside,location:{...outside.location,accuracy:80}},now,[branch],null).finding).toBe("UNCERTAIN")
  })
  it.each([{isMock:true},{accuracy:101},{capturedAt:"2026-10-13T04:57:59.000Z"},{capturedAt:"2026-10-13T05:00:31.000Z"}])("does not assert inside or outside for weak evidence %j",override => {
    expect(evaluateAttendanceLocation({...mark(),location:{...mark().location!,...override}},now,[branch],null).finding).toBe("UNCERTAIN")
  })
  it("distinguishes an unconfigured tenant from an outside mark",() => {
    expect(evaluateAttendanceLocation(mark(),now,[],null)).toMatchObject({finding:"UNCONFIGURED",branch:null,distanceMeters:null})
    expect(attendanceDistanceMeters({latitude:0,longitude:179.999},{latitude:0,longitude:-179.999})).toBeCloseTo(222.39,1)
  })
  it("never enables collection without client text and an explicit legal-review attestation",() => {
    const value={requestId:"62d370ad-4187-4f7c-bc7d-c8bb3843a477",expectedRevisionId:null,enabled:false,texts:{az:"",ru:"",en:""},legalReviewConfirmed:false}
    expect(AttendanceLocationPolicyInputSchema.safeParse(value).success).toBe(true)
    expect(AttendanceLocationPolicyInputSchema.safeParse({...value,enabled:true}).success).toBe(false)
    const texts={az:"Fictional test text, not legal advice.",ru:"Fictional test text, not legal advice.",en:"Fictional test text, not legal advice."}
    expect(AttendanceLocationPolicyInputSchema.safeParse({...value,enabled:true,texts}).success).toBe(false)
    expect(AttendanceLocationPolicyInputSchema.safeParse({...value,enabled:true,texts,legalReviewConfirmed:true}).success).toBe(true)
  })
})
