import { describe, expect, it, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fs from "node:fs"
import { DIAGNOSTIC_LOG, DIAGNOSTIC_OPERATIONS, DIAGNOSTIC_BYTES, summarizePhoneSyncLog, diagnosticFailure, validatePhoneSyncDiagnostic, readDiagnosticCatalog, readDiagnosticTail } from "../../scripts/mtm-attendance-phone-sync-diagnostic"
const sha = "a".repeat(40)
const header = (id: string) => `[MTM/sync/push] op=create entity=workdays operationId=${id}`
const safe = () => ({ version:1,status:"PASS",tenant:"mtm-attendance-phone",artifactSha:sha,readOnly:true,catalog:null,operations:summarizePhoneSyncLog("") })
describe("bounded phone sync diagnostic", () => {
  it("only selects the two fixed operation identities and bounds errors before other operations", () => {
    const log=`${header('someone-else')} Error { code:'P2003',meta:{code:'23503'} }\n${header(DIAGNOSTIC_OPERATIONS[0])} Prisma error {\n code:'P2010',\n meta:{ code:'42703', message:'record "canonical_event" has no field "serverReceivedAt"' },\n secret:'PASSWORD_CANARY', query:'SELECT private_salary FROM real_client'\n}\n${header('other-company')} error {code:'P2025'}\n`
    const rows=summarizePhoneSyncLog(log)
    expect(rows[0]).toMatchObject({found:true,sampledErrors:1,prismaCodes:['P2010'],sqlStates:['42703'],missingRecordFields:[{record:'canonical_event',column:'serverReceivedAt'}]})
    expect(rows[1].found).toBe(false)
    expect(JSON.stringify(rows)).not.toMatch(/PASSWORD_CANARY|private_salary|real_client|P2003|P2025|23503/)
  })
  it("requires an exact operation token and ignores arbitrary secrets dressed as error details", () => {
    const rows=summarizePhoneSyncLog(`${header(DIAGNOSTIC_OPERATIONS[0]+'-foreign')} P2010\n${header(DIAGNOSTIC_OPERATIONS[1])} Error {\nconstraint "secret_constraint", column "SECRET_COLUMN" does not exist, MTM_PRIVATE_SECRET\n}`)
    expect(rows[0].found).toBe(false)
    expect(rows[1]).toMatchObject({found:true,prismaCodes:[],constraints:[],missingColumns:[],mtmCodes:[]})
    expect(JSON.stringify(rows)).not.toMatch(/secret_constraint|SECRET_COLUMN|MTM_PRIVATE_SECRET/)
  })
  it("recognizes only fixed safe constraint, relation and column signatures", () => {
    const row=summarizePhoneSyncLog(`${header(DIAGNOSTIC_OPERATIONS[0])} Error {\nCode: \`23514\`; constraint "mtm_attendance_mark_evidence_check1"\ncolumn "redactedRequestHash" does not exist\nrelation "mtm_attendance_mark_evidence" does not exist\nMTM_ATTENDANCE_MARK_EVENT_MISMATCH\n}`)[0]
    expect(row).toMatchObject({sqlStates:['23514'],constraints:['mtm_attendance_mark_evidence_check1'],missingColumns:['redactedRequestHash'],missingRelations:['mtm_attendance_mark_evidence'],mtmCodes:['MTM_ATTENDANCE_MARK_EVENT_MISMATCH']})
  })
  it("does not retain unbounded errors or read beyond the fixed tail budget", () => {
    const log=Array.from({length:9},()=>`${header(DIAGNOSTIC_OPERATIONS[0])} Error {\ncode:'P2010'\n}`).join('\n')
    expect(summarizePhoneSyncLog(log)[0].sampledErrors).toBe(4)
    expect(()=>summarizePhoneSyncLog('x'.repeat(DIAGNOSTIC_BYTES+1))).toThrow('PHONE_SYNC_DIAGNOSTIC_FAILED')
  })
  it("reads only the bounded tail with O_NOFOLLOW and always closes its file descriptor", () => {
    const open=vi.spyOn(fs,'openSync').mockReturnValue(77)
    vi.spyOn(fs,'fstatSync').mockReturnValue({isFile:()=>true,uid:0,mode:0o100644,nlink:1,size:DIAGNOSTIC_BYTES+1024} as never)
    const read=vi.spyOn(fs,'readSync').mockImplementation((...args:unknown[])=>{(args[1] as Buffer).write('safe');return 4})
    const close=vi.spyOn(fs,'closeSync').mockImplementation(()=>{})
    try {
      expect(readDiagnosticTail()).toBe('safe')
      expect(open).toHaveBeenCalledWith(DIAGNOSTIC_LOG,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW)
      expect(read.mock.calls[0].slice(2)).toEqual([0,DIAGNOSTIC_BYTES,1024])
      expect(close).toHaveBeenCalledWith(77)
    } finally {vi.restoreAllMocks()}
  })
  it("refuses unsafe or replaced log files without reading their bytes", () => {
    vi.spyOn(fs,'openSync').mockReturnValue(78)
    const stat=vi.spyOn(fs,'fstatSync')
    const read=vi.spyOn(fs,'readSync'),close=vi.spyOn(fs,'closeSync').mockImplementation(()=>{})
    try {
      for(const patch of [{uid:1000},{mode:0o100666},{nlink:2},{isFile:()=>false}]) {
        stat.mockReturnValue({isFile:()=>true,uid:0,mode:0o100644,nlink:1,size:100,...patch} as never)
        expect(()=>readDiagnosticTail()).toThrow('PHONE_SYNC_DIAGNOSTIC_FAILED')
      }
      expect(read).not.toHaveBeenCalled();expect(close).toHaveBeenCalledTimes(4)
    } finally {vi.restoreAllMocks()}
  })
  it("requires exactly the sanitized schema and deployed revision on the receiver", () => {
    expect(validatePhoneSyncDiagnostic(safe(),sha)).toEqual(safe())
    expect(validatePhoneSyncDiagnostic(diagnosticFailure(),sha)).toEqual(diagnosticFailure())
    for(const row of [{...safe(),password:'SECRET'}, {...safe(),artifactSha:'b'.repeat(40)}, {...safe(),readOnly:false}, {...safe(),operations:[...safe().operations,{}]}, {...safe(),catalog:{secret:'SECRET'}}])expect(()=>validatePhoneSyncDiagnostic(row,sha)).toThrow()
    const leaked=safe();Object.assign(leaked.operations[0],{stack:'SECRET'});expect(()=>validatePhoneSyncDiagnostic(leaked,sha)).toThrow()
    expect(()=>validatePhoneSyncDiagnostic({version:1,status:'FAIL',code:'private DB failure'},sha)).toThrow()
  })
  it("opens the catalog transaction as read-only before any query and emits finite fields only", async () => {
    const order:string[]=[]
    const tx={$executeRawUnsafe:vi.fn(async(sql:string)=>{order.push(sql)}),$queryRaw:vi.fn()
      .mockImplementationOnce(async()=>{order.push('query');return [{name:'id'},{name:'redactedRequestHash'},{name:'SECRET_COLUMN'}]})
      .mockResolvedValueOnce([{definition:'private trigger body'}]).mockResolvedValueOnce([{name:'SECRET_CONSTRAINT'}])
      .mockResolvedValueOnce([{utc:true,selectAllowed:true,insertAllowed:true}])
      .mockResolvedValueOnce([{name:'20261013090000_mtm_attendance_location_evidence',applied:true}])}
    const db={$transaction:vi.fn(async(fn: (t:typeof tx)=>Promise<unknown>)=>fn(tx))}
    const catalog=await readDiagnosticCatalog(db as never)
    expect(order).toEqual(['SET TRANSACTION READ ONLY','query','SET TRANSACTION READ ONLY'])
    expect(catalog.columnsPresent).toEqual(['id','redactedRequestHash'])
    expect(catalog.triggerFunctionSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(catalog)).not.toMatch(/private trigger body|SECRET_COLUMN|SECRET_CONSTRAINT/)
    expect(validatePhoneSyncDiagnostic({...safe(),catalog},sha)).toEqual({...safe(),catalog})
  })
  it("recognizes trigger-only NEW fields without accepting arbitrary identifiers", () => {
    const rows=summarizePhoneSyncLog(`${header(DIAGNOSTIC_OPERATIONS[0])} Error {\nrecord "new" has no field "version"\nrecord "NEW" has no field "accepted"\nrecord "new" has no field "SECRET_FIELD"\n}`)
    expect(rows[0].missingRecordFields).toEqual([{record:'new',column:'version'},{record:'new',column:'accepted'}])
    expect(rows[0].missingColumns).toEqual([])
    expect(JSON.stringify(rows)).not.toContain('SECRET_FIELD')
    expect(validatePhoneSyncDiagnostic({...safe(),operations:rows},sha)).toEqual({...safe(),operations:rows})
  })
  it("retains core catalog facts when the deployment migration ledger is denied", async () => {
    const order:string[]=[]
    const tx={$executeRawUnsafe:vi.fn(async(sql:string)=>{order.push(sql)}),$queryRaw:vi.fn()
      .mockResolvedValueOnce([{name:'redactedRequestHash'}]).mockResolvedValueOnce([{definition:'known trigger'}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{utc:false,selectAllowed:true,insertAllowed:true}])
      .mockRejectedValueOnce(new Error('permission denied SECRET_LEDGER_DETAIL'))}
    const db={$transaction:vi.fn(async(fn: (t:typeof tx)=>Promise<unknown>)=>fn(tx))}
    const catalog=await readDiagnosticCatalog(db as never)
    expect(order).toEqual(['SET TRANSACTION READ ONLY','SET TRANSACTION READ ONLY'])
    expect(catalog).toMatchObject({columnsPresent:['redactedRequestHash'],migrations:null,migrationRead:'UNAVAILABLE',insertAllowed:true})
    expect(catalog.triggerFunctionSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(catalog)).not.toContain('SECRET_LEDGER_DETAIL')
    expect(validatePhoneSyncDiagnostic({...safe(),catalog},sha)).toEqual({...safe(),catalog})
  })
  it("bundles the reviewed controller and never exposes unsupported mode or raw receiver input", () => {
    const file=join(mkdtempSync(join(tmpdir(),'phone-sync-diagnostic-test-')),'controller.cjs')
    const built=spawnSync(process.execPath,['scripts/build-mtm-attendance-phone-sync-diagnostic.mjs',file],{encoding:'utf8'})
    expect(built.status).toBe(0)
    expect(readFileSync(file,'utf8')).not.toContain('require("./mtm-attendance-phone-fixture")')
    const run=spawnSync(process.execPath,[file,'--validate-phone-sync-diagnostic',sha],{input:JSON.stringify(safe()),encoding:'utf8'})
    expect(run.status).toBe(0);expect(JSON.parse(run.stdout)).toEqual(safe())
    const bad=spawnSync(process.execPath,[file,'--validate-phone-sync-diagnostic',sha],{input:JSON.stringify({...safe(),secret:'SECRET_CANARY'}),encoding:'utf8'})
    expect(bad.status).not.toBe(0);expect(bad.stdout+bad.stderr).not.toContain('SECRET_CANARY')
    const mutation=spawnSync(process.execPath,[file,'--prepare-phone',sha],{encoding:'utf8'})
    expect(mutation.status).not.toBe(0);expect(mutation.stdout).toBe('')
  })
})
