import { beforeEach,describe,expect,it,vi } from "vitest"
import type { Prisma } from "@prisma/client"
vi.mock("@/lib/mtm/attendance-location-store",()=>({currentAttendanceStreamConsent:vi.fn()}))
import { currentAttendanceStreamConsent } from "@/lib/mtm/attendance-location-store"
import {parseAttendanceStreamSignal,prepareAttendanceStreamIntegrity,recordAttendanceStreamIntegrity} from "@/lib/mtm/attendance-stream-integrity"
const execute=vi.fn(),tx={$executeRaw:execute} as unknown as Prisma.TransactionClient
const self={organizationId:"fictional-org",agentId:"fictional-agent"}
const consent={id:"consent-a",createdAt:new Date("2026-10-13T05:00:00Z")}
const input={...self,locationId:"point-a",recordedAt:new Date("2026-10-13T05:10:00Z"),isMock:true,attendanceConsentId:consent.id}
beforeEach(()=>vi.clearAllMocks())
describe("optional consent-bound background signal",()=>{
  it("leaves legacy and unknown flags absent and preserves an explicit false",()=>{
    expect(parseAttendanceStreamSignal({latitude:40})).toEqual({})
    expect(parseAttendanceStreamSignal({isMock:false,attendanceConsentId:"a"})).toEqual({isMock:false,attendanceConsentId:"a"})
  })
  it.each([{isMock:"false"},{isMock:1},{isMock:null},{attendanceConsentId:1},{attendanceConsentId:""}])("rejects ambiguous metadata %j",value=>expect(parseAttendanceStreamSignal(value)).toBeNull())
  it("does not consult attendance policy or acquire new locks for a legacy point",async()=>{
    expect(await prepareAttendanceStreamIntegrity(tx,self,[{}, {isMock:true}])).toBeNull()
    expect(currentAttendanceStreamConsent).not.toHaveBeenCalled()
  })
  it("resolves the current consent once before writing a batch",async()=>{
    vi.mocked(currentAttendanceStreamConsent).mockResolvedValue(consent)
    expect(await prepareAttendanceStreamIntegrity(tx,self,[input,{...input,isMock:false}])).toEqual(consent)
    expect(currentAttendanceStreamConsent).toHaveBeenCalledTimes(1)
  })
  it.each([true,false])("keeps the actual boolean %s in its private source row",async isMock=>{
    await recordAttendanceStreamIntegrity(tx,{...input,isMock},consent)
    expect(execute.mock.calls[0].slice(1)).toEqual([input.locationId,self.organizationId,self.agentId,consent.id,isMock])
  })
  it.each(["withdrawn","replacement","before-acceptance","unknown"])("does not retain signal: %s",async reason=>{
    await recordAttendanceStreamIntegrity(tx,{...input,...(reason==="replacement"?{attendanceConsentId:"old-consent"}:{}),...(reason==="before-acceptance"?{recordedAt:new Date("2026-10-13T04:00:00Z")}:{}),...(reason==="unknown"?{isMock:undefined}:{})},reason==="withdrawn"?null:consent)
    expect(execute).not.toHaveBeenCalled()
  })
})
