/** The shipping sync route, actual migration and restricted PostgreSQL role. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildAttendanceTable } from "@/lib/mtm/attendance-table"
import { buildAttendanceXlsx, buildAttendancePdf } from "@/lib/mtm/attendance-export"
import { attendancePdfText } from "./helpers/attendance-pdf"
import { summarizeAttendanceBranches } from "@/lib/mtm/attendance-location-report"
import type { AttendanceMark } from "@/lib/mtm/attendance-location-contract"
const adminUrl=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if(!adminUrl&&process.env.MTM_ATTENDANCE_DB_GATE==="required")throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch=vi.hoisted(()=>{const admin=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL;if(!admin)return null;const name=`mtm_geo_${process.pid}_${Date.now()}`,role=`${name}_app`;const url=new URL(admin);url.pathname=`/${name}`;const app=new URL(url);app.username=role;app.password="geo-fixture-only";process.env.DATABASE_URL=app.toString();return{name,role,adminDb:url.toString()}})
const identity=vi.hoisted(()=>({orgId:"geo-fixture-a",agentId:"",role:"EMPLOYEE"}))
vi.mock("@/lib/mobile-auth",()=>({resolveMobileAuth:async(req:Request)=>({...identity,...(req.headers.get("x-fixture-agent")?{agentId:req.headers.get("x-fixture-agent")!}:{}),tenantCapabilities:{routeField:true,workforceHrm:false,personnel:true}})}))
vi.mock("@/lib/public-abuse-guard",async()=>{
 const actual=await vi.importActual<typeof import("@/lib/public-abuse-guard")>("@/lib/public-abuse-guard")
 return {...actual,consumePublicRateLimit:vi.fn(async()=>({allowed:true,retryAfterSeconds:0,unavailable:false}))}
})
const cli=createRequire(import.meta.url).resolve("prisma/build/index.js")
function sql(url:string,statement:string){const result=spawnSync(process.execPath,[cli,"db","execute","--url",url,"--stdin"],{input:statement,encoding:"utf8",timeout:180000,maxBuffer:1024*1024});if(result.status!==0)throw new Error(`Location fixture failed: ${String(result.stderr||result.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g,"[test database]")}`)}
const ORG="geo-fixture-a",OTHER="geo-fixture-b",ADMIN="geo-fixture-admin",INSTALLATION="rf-fictional-installation-0000001"
const admin={organizationId:ORG,userId:ADMIN,principalType:"session" as const}
const texts={az:"Fictional consent test text, not legal advice.",ru:"Fictional consent test text, not legal advice.",en:"Fictional consent test text, not legal advice."}
type Evidence={id:string;agentId:string;eventId:string;installationId:string;action:string;locationState:string;latitude:number|null;longitude:number|null;consentId:string|null;branchRevisionId:string|null;distanceMeters:number|null;claimedAt:Date;serverReceivedAt:Date;fixAgeSeconds:number|null;isMock:boolean|null}
;(adminUrl?describe:describe.skip)("MTM endpoint location and consent on PostgreSQL",()=>{
 let prisma:typeof import("@/lib/prisma").prisma,tenant:typeof import("@/lib/rls-context").runWithTenant,bypass:typeof import("@/lib/rls-context").runWithRlsBypass
 let store:typeof import("@/lib/mtm/attendance-location-store"),branches:typeof import("@/lib/mtm/attendance-branches-store"),push:typeof import("@/app/api/v1/mtm/mobile/sync/push/route")
 let createdDb=false,createdRole=false,schemaDir:string|undefined,policyId:string,branchId:string,branchRevisionId:string,acceptanceId:string|null=null
 const self=()=>({organizationId:ORG,agentId:identity.agentId,role:identity.role})
 const evidence=()=>tenant(ORG,()=>prisma.$queryRaw<Evidence[]>`SELECT * FROM mtm_attendance_mark_evidence WHERE "agentId"=${identity.agentId} ORDER BY "claimedAt"`)
 async function employee(){const id=randomUUID();await bypass(async()=>{await prisma.user.create({data:{id,organizationId:ORG,email:`${id}@example.invalid`,name:"Fictional employee",role:"sales",passwordHash:"unusable-fixture"}});await prisma.mtmAgent.create({data:{id,organizationId:ORG,userId:id,name:"Fictional employee",role:"EMPLOYEE",attendanceParticipant:true}})});identity.agentId=id;acceptanceId=null;return id}
 async function accept(){const before=await tenant(ORG,()=>store.readOwnAttendanceLocation(self()));const request={requestId:randomUUID(),policyRevisionId:policyId,expectedConsentId:before.consent?.id??null,accepted:true};const result=await tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),request));acceptanceId=result.consent.id;return result}
 function packet(at=new Date()):AttendanceMark{return{version:1,installationId:INSTALLATION,locationState:"AVAILABLE",consentRevisionId:acceptanceId??"fixture-unaccepted",location:{latitude:40.4,longitude:49.85,accuracy:5,capturedAt:at.toISOString(),provider:"GPS",isMock:false}}}
 function operation(action:string,workdayId:string,at:Date,mark?:AttendanceMark,qr?:{version:1;token:string|null}){return{operationId:randomUUID(),entity:"workdays",op:"create",clientTimestamp:Date.now(),data:{action,...(action==="START"?{id:workdayId}:{workdayId}),occurredAt:at.toISOString(),...(mark?{attendanceMark:mark}:{}),...(qr?{attendanceQr:qr}:{})}}}
 async function send(op:ReturnType<typeof operation>,device=INSTALLATION){const response=await push.POST(new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push",{method:"POST",headers:{"content-type":"application/json","x-field-device-id":device},body:JSON.stringify({operations:[op]})}));return{status:response.status,body:await response.json()}}
 beforeAll(async()=>{
  sql(adminUrl!,`CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'geo-fixture-only' NOSUPERUSER NOBYPASSRLS`);createdRole=true
  sql(adminUrl!,`CREATE DATABASE "${scratch!.name}"`);createdDb=true
  schemaDir=mkdtempSync(join(tmpdir(),"mtm-geo-schema-"));const schema=join(schemaDir,"schema.prisma");writeFileSync(schema,readFileSync("prisma/schema.prisma","utf8").split("\n").filter(line=>!/Unsupported\("vector/.test(line)).join("\n"))
  const result=spawnSync(process.execPath,[cli,"db","push","--schema",schema,"--skip-generate"],{env:{...process.env,DATABASE_URL:scratch!.adminDb},encoding:"utf8",timeout:180000,maxBuffer:1024*1024});if(result.status!==0)throw new Error("Location fixture schema push failed")
  sql(scratch!.adminDb,'DROP TABLE mtm_attendance_qr_evidence; DROP TABLE mtm_attendance_installation_revocations; DROP TABLE mtm_attendance_installation_decisions; DROP TABLE mtm_attendance_installation_requests; DROP TABLE mtm_attendance_stream_integrity; DROP TABLE mtm_attendance_risk_decisions; DROP TABLE mtm_attendance_risk_cases; DROP TABLE mtm_attendance_mark_evidence; DROP TABLE mtm_attendance_location_consents; DROP TABLE mtm_attendance_location_policies; DROP TABLE mtm_attendance_primary_branch_revisions; DROP TABLE mtm_attendance_branch_revisions; DROP TABLE mtm_attendance_branches; ALTER TABLE workforce_time_corrections DROP COLUMN "requestHash";')
  for(const migration of["20260806120000_mtm_rls_coverage_completion","20260806160000_mtm_rls_bypass_clause_normalization","20261013070000_mtm_attendance_branches","20261013090000_mtm_attendance_location_evidence","20261013120000_mtm_attendance_risks","20261013140000_mtm_attendance_stream_integrity","20261013150000_mtm_attendance_installation_approval","20261013160000_mtm_attendance_branch_qr","20261014010000_mtm_attendance_utc_guard_clocks"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${migration}/migration.sql`,"utf8"))
  const foundation=readFileSync("prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql","utf8");sql(scratch!.adminDb,foundation.slice(foundation.indexOf("-- Tenant data ships fail-closed."),foundation.indexOf("-- A migration runner may own new tables")))
  for(const migration of["20260828224500_workforce_h3_legacy_fact_guard","20260828230000_workforce_direct_correction_contract"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${migration}/migration.sql`,"utf8"))
  sql(scratch!.adminDb,readFileSync("scripts/rls/enable-batch-5.sql","utf8"));sql(scratch!.adminDb,`GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
  prisma=(await import("@/lib/prisma")).prisma;({runWithTenant:tenant,runWithRlsBypass:bypass}=await import("@/lib/rls-context"));store=await import("@/lib/mtm/attendance-location-store");branches=await import("@/lib/mtm/attendance-branches-store");push=await import("@/app/api/v1/mtm/mobile/sync/push/route")
  await bypass(async()=>{for(const id of[ORG,OTHER]){await prisma.organization.create({data:{id,slug:id,name:"Fictional attendance tenant",plan:"enterprise",modules:{mtm:true,"route-field":true},features:["mtm"]}});await prisma.mtmSetting.create({data:{organizationId:id,key:"attendanceEnabled",value:true}})}await prisma.user.create({data:{id:ADMIN,organizationId:ORG,email:"admin@example.invalid",name:"Fictional administrator",role:"admin",passwordHash:"unusable-fixture"}})})
 },240000)
 afterAll(async()=>{await prisma?.$disconnect();if(createdDb)sql(adminUrl!,`DROP DATABASE "${scratch!.name}" WITH (FORCE)`);if(createdRole)sql(adminUrl!,`DROP ROLE "${scratch!.role}"`);if(schemaDir)rmSync(schemaDir,{recursive:true,force:true})})
 it.each(["Asia/Baku","America/New_York"] as const)("non-UTC canonical NO_CONSENT START/FINISH and replay preserve exact instants in %s",async timezone=>{
  // Change only the disposable restricted role, then reopen every connection.
  // A SET on an arbitrary pool connection would not exercise the real route.
  sql(scratch!.adminDb,`ALTER ROLE "${scratch!.role}" SET timezone='${timezone}'`)
  await prisma.$disconnect()
  try {
   const [session]=await tenant(ORG,()=>prisma.$queryRaw<{timezone:string;superuser:boolean;bypassRls:boolean}[]>`SELECT current_setting('TimeZone') AS timezone,rolsuper AS superuser,rolbypassrls AS "bypassRls" FROM pg_roles WHERE rolname=current_user`)
   expect(session).toEqual({timezone,superuser:false,bypassRls:false})
   await employee()
   const device=`rf-${randomUUID()}`,day=randomUUID(),at=new Date(Date.now()-10_000)
   const [cast]=await tenant(ORG,()=>prisma.$queryRaw<{implicit:Date;utc:Date}[]>`SELECT ${at}::timestamptz::timestamp(3) AS implicit,(${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3) AS utc`)
   expect(cast.utc).toEqual(at)
   expect(Math.abs(cast.implicit.getTime()-at.getTime())).toBeGreaterThanOrEqual(3_600_000)
   const mark:AttendanceMark={version:1,installationId:device,locationState:"NO_CONSENT",consentRevisionId:null,location:null}
   const start=operation("START",day,at,mark)
   const errors=vi.spyOn(console,"error")
   try {
    const started=await send(start,device)
    if(started.body.results[0]?.status==="error"){
     // The hosted red phase must prove the actual database failure, not just
     // an arbitrary HTTP error. Never serialize a raw query, object or stack.
     const error=errors.mock.calls.flat().find(value=>value&&typeof value==="object"&&value.code==="P2010") as {code:string;meta?:{code?:string;message?:string}}|undefined
     const signature={prismaCode:error?.code==="P2010"?"P2010":null,sqlState:error?.meta?.code==="23514"?"23514":null,code:error?.meta?.message?.includes("MTM_ATTENDANCE_MARK_EVENT_MISMATCH")?"MTM_ATTENDANCE_MARK_EVENT_MISMATCH":null}
     throw new Error(`Canonical mark failure: ${JSON.stringify(signature)}`)
    }
    expect(started.body.results).toMatchObject([{status:"ok"}])
   } finally {errors.mockRestore()}
   expect((await send(start,device)).body.results).toMatchObject([{status:"ok"}])
   const finish=operation("FINISH",day,new Date(at.getTime()+1_000),mark)
   expect((await send(finish,device)).body.results).toMatchObject([{status:"ok"}])
   expect((await send(finish,device)).body.results).toMatchObject([{status:"ok"}])
   const marks=await evidence()
   expect(marks).toHaveLength(2)
   expect(marks.map(row=>[row.action,row.claimedAt.toISOString()])).toEqual([["START",at.toISOString()],["FINISH",finish.data.occurredAt]])
   expect(marks.every(row=>row.locationState==="NO_CONSENT"&&row.latitude===null&&row.longitude===null&&row.consentId===null)).toBe(true)
   const events=await tenant(ORG,()=>prisma.mtmAgentWorkdayEvent.findMany({where:{organizationId:ORG,workdayId:day},select:{id:true,occurredAt:true,serverReceivedAt:true}}))
   expect(events).toHaveLength(2)
   for(const row of marks){const event=events.find(item=>item.id===row.eventId)!;expect(row.claimedAt).toEqual(event.occurredAt);expect(row.serverReceivedAt).toEqual(event.serverReceivedAt)}
   // The database still rejects a mark claiming a different canonical instant.
   await expect(tenant(ORG,()=>prisma.$executeRaw`INSERT INTO mtm_attendance_mark_evidence
    (id,"organizationId","agentId","eventId","installationId",action,"claimedAt","serverReceivedAt","locationState","redactedRequestHash")
    VALUES (${randomUUID()},${ORG},${identity.agentId},${marks[0].eventId},${device},'START',(${new Date(at.getTime()+1)}::timestamptz AT TIME ZONE 'UTC'),(${marks[0].serverReceivedAt}::timestamptz AT TIME ZONE 'UTC'),'NO_CONSENT',${"0".repeat(64)})`)).rejects.toThrow(/MTM_ATTENDANCE_MARK_EVENT_MISMATCH/)
   expect(await evidence()).toHaveLength(2)
   expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.findUnique({where:{id:day},select:{status:true}}))).toEqual({status:"COMPLETED"})
   expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_mark_evidence WHERE "agentId"=${identity.agentId}`)).toEqual([])
  } finally {
   sql(scratch!.adminDb,`ALTER ROLE "${scratch!.role}" RESET timezone`)
   await prisma.$disconnect()
  }
 },60_000)
 it("starts empty, requires reviewed text, and publishes one immutable version for racing retries",async()=>{
  await employee();expect(await tenant(ORG,()=>store.readOwnAttendanceLocation(self()))).toEqual({policy:null,consent:null,maySendLocation:false})
  const request={requestId:randomUUID(),expectedRevisionId:null,enabled:true,texts,legalReviewConfirmed:true}
  await expect(tenant(ORG,()=>store.publishAttendanceLocationPolicy(admin,{...request,texts:{az:"",ru:"",en:""}}))).rejects.toMatchObject({status:400})
  const results=await Promise.all([0,1].map(()=>tenant(ORG,()=>store.publishAttendanceLocationPolicy(admin,request))))
  expect(results[0].policy.id).toBe(results[1].policy.id);expect(results.map(result=>result.idempotent).sort()).toEqual([false,true]);policyId=results[0].policy.id
  await expect(tenant(ORG,()=>store.publishAttendanceLocationPolicy({...admin,userId:identity.agentId},{...request,requestId:randomUUID()}))).rejects.toMatchObject({status:403})
  const branch=await tenant(ORG,()=>branches.saveAttendanceBranch(admin,{requestId:randomUUID(),branchId:null,expectedRevisionId:null,name:"Fictional branch",address:"Demo Road 12",latitude:40.4,longitude:49.85,radiusMeters:150,active:true}));branchId=branch.branch.id;branchRevisionId=branch.branch.revisionId
 })
 it("binds own consent to text, body and employee, and records a real arrival with branch revision",async()=>{
  await employee();const request={requestId:randomUUID(),policyRevisionId:policyId,expectedConsentId:null,accepted:true}
  const results=await Promise.all([0,1].map(()=>tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),request))))
  expect(results[0].consent.id).toBe(results[1].consent.id);acceptanceId=results[0].consent.id
  await expect(tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),{...request,accepted:false}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_LOCATION_REPLAY_MISMATCH"})
  const at=new Date(Date.now()+1000),ownDay=randomUUID(),op=operation("START",ownDay,at,packet(at))
  expect((await send(op)).body.results).toMatchObject([{status:"ok"}]);expect((await send(op)).body.results).toMatchObject([{status:"ok"}])
  const rows=await evidence();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({installationId:INSTALLATION,locationState:"INSIDE",latitude:40.4,longitude:49.85,distanceMeters:0,branchRevisionId,consentId:results[0].consent.id,fixAgeSeconds:0,isMock:false})
  expect(rows[0].claimedAt).toEqual(at);expect(rows[0].serverReceivedAt).toBeInstanceOf(Date)
  await tenant(ORG,async()=>{expect(await prisma.mtmAgentWorkdayEvent.findUnique({where:{id:rows[0].eventId},select:{latitude:true,longitude:true,accuracy:true}})).toEqual({latitude:null,longitude:null,accuracy:null})})
  const before=rows[0].branchRevisionId
  const edited=await tenant(ORG,()=>branches.saveAttendanceBranch(admin,{requestId:randomUUID(),branchId,expectedRevisionId:branchRevisionId,name:"Moved fictional branch",address:"Demo Road 24",latitude:41,longitude:50,radiusMeters:150,active:true}));branchRevisionId=edited.branch.revisionId
  expect((await evidence())[0].branchRevisionId).toBe(before)
  const { readOwnAttendanceMarks } = await import("@/lib/mtm/attendance-own-marks")
  const own = await tenant(ORG, () => readOwnAttendanceMarks(self(), ownDay))
  expect(own.items).toHaveLength(1)
  expect(own.items[0]).toMatchObject({ eventId: rows[0].eventId, claimedAt: at.toISOString(), serverReceivedAt: rows[0].serverReceivedAt.toISOString(),
    location: { state: "INSIDE", coordinates: { latitude: 40.4, longitude: 49.85 }, branchName: "Fictional branch", distanceMeters: 0 } })
  expect(JSON.stringify(own)).not.toMatch(/installationId|consentId|redactedRequestHash|Moved fictional/)
  await expect(tenant(OTHER, () => readOwnAttendanceMarks({ ...self(), organizationId: OTHER }, ownDay))).rejects.toMatchObject({ status: 403 })
  const owner = identity.agentId
  await employee()
  await expect(tenant(ORG, () => readOwnAttendanceMarks(self(), ownDay))).rejects.toMatchObject({ status: 404 })
  identity.agentId = owner
  const { readMtmAttendanceReport } = await import("@/lib/mtm/attendance-report-store")
  const workday = await tenant(ORG, () => prisma.mtmAgentWorkday.findFirstOrThrow({where:{agentId:identity.agentId},select:{workDate:true}}))
  const date = workday.workDate.toISOString().slice(0,10)
  const report = await tenant(ORG, () => readMtmAttendanceReport({organizationId:ORG,actor:{role:"ADMIN",agentId:null,scopedAgentIds:null},query:{from:date,to:date,form:"ALL",employeeId:identity.agentId},now:new Date(at.getTime()+10000)}))
  expect(report.rows).toHaveLength(1)
  expect(report.rows[0].locationMarks).toMatchObject([{state:"INSIDE",branch:{name:"Fictional branch",revisionId:before}}])
  expect(summarizeAttendanceBranches(report.rows).totals).toMatchObject({arrivals:1,departures:0,employees:1,outside:0})
  expect(JSON.stringify(report)).not.toMatch(/latitude|longitude|installationId|consentId|provider|fixCapturedAt/)
  const table=buildAttendanceTable(report,{version:1,mode:"BRANCH",columns:["branch","arrivals","departures","employees","outside"],filters:report.snapshot.query,showTotals:true},"en",key=>key)
  expect(table.rows[0].cells).toEqual(["Fictional branch",1,0,1,0])
  expect(JSON.stringify(buildAttendanceXlsx(table).worksheets[0].getSheetValues())+attendancePdfText(buildAttendancePdf(table))).not.toMatch(/Moved fictional branch|latitude|longitude|installationId|40\.4|49\.85/)
  await expect(tenant(ORG,()=>readMtmAttendanceReport({organizationId:ORG,actor:{role:"SUPERVISOR",agentId:null,scopedAgentIds:[]},query:{from:date,to:date,form:"ALL",employeeId:identity.agentId}}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_SCOPE_DENIED"})
  const other=await tenant(OTHER,()=>readMtmAttendanceReport({organizationId:OTHER,actor:{role:"ADMIN",agentId:null,scopedAgentIds:null},query:{from:date,to:date,form:"ALL"}}))
  expect(other.rows).toEqual([])

  const altered={...op,data:{...op.data,attendanceMark:{...packet(at),installationId:"rf-fictional-installation-0000002"}}};expect((await send(altered)).body.results).toMatchObject([{status:"conflict"}]);expect(await evidence()).toHaveLength(1)
 })
 it.each(["UNAVAILABLE","NO_CONSENT"] as const)("keeps a time mark without GPS: %s",async locationState=>{
  await employee();const at=new Date(),mark={...packet(at),locationState,location:null,consentRevisionId:null}
  expect((await send(operation("START",randomUUID(),at,mark))).body.results).toMatchObject([{status:"ok"}])
  expect((await evidence())[0]).toMatchObject({locationState,latitude:null,longitude:null,branchRevisionId:null,distanceMeters:null,consentId:null})
 })
 it("discards coordinates after an offline consent withdrawal without losing the time mark",async()=>{
  await employee();const consent=await accept(),at=new Date(),op=operation("START",randomUUID(),at,packet(at))
  await tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),{requestId:randomUUID(),policyRevisionId:policyId,expectedConsentId:consent.consent.id,accepted:false}))
  expect((await send(op)).body.results).toMatchObject([{status:"ok"}]);expect((await evidence())[0]).toMatchObject({locationState:"NO_CONSENT",latitude:null,longitude:null,consentId:null})
 })
 it("does not reactivate an old queued fix by accepting the same text again",async()=>{
  await employee();const first=await accept(),at=new Date(Date.now()+1000),op=operation("START",randomUUID(),at,packet(at))
  await tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),{requestId:randomUUID(),policyRevisionId:policyId,expectedConsentId:first.consent.id,accepted:false}))
  await accept()
  expect((await send(op)).body.results).toMatchObject([{status:"ok"}]);expect((await evidence())[0]).toMatchObject({locationState:"NO_CONSENT",latitude:null,consentId:null})
 })
 it("drops a pre-acceptance fix even when its packet names the current acceptance receipt",async()=>{
  await employee();const first=await accept(),at=new Date(Date.now()+1000),mark=packet(new Date(new Date(first.consent.createdAt).getTime()-1))
  expect((await send(operation("START",randomUUID(),at,mark))).body.results).toMatchObject([{status:"ok"}]);expect((await evidence())[0]).toMatchObject({locationState:"NO_CONSENT",latitude:null})
 })
 it("acknowledges a committed action after local location redaction without permitting time/device changes or reverse hydration",async()=>{
  await employee();const first=await accept(),at=new Date(Date.now()+1000),op=operation("START",randomUUID(),at,packet(at))
  expect((await send(op)).body.results).toMatchObject([{status:"ok"}]);const before=await evidence()
  await tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),{requestId:randomUUID(),policyRevisionId:policyId,expectedConsentId:first.consent.id,accepted:false}))
  const redacted={...op,data:{...op.data,attendanceMark:{...op.data.attendanceMark!,locationState:"NO_CONSENT" as const,location:null,consentRevisionId:null}}}
  const replay=await send(redacted);expect(replay.body.results).toMatchObject([{status:"ok"}]);expect(JSON.stringify(replay.body)).not.toContain('"latitude":40.4');expect(await evidence()).toEqual(before)
  for(const changed of [
    {...redacted,data:{...redacted.data,occurredAt:new Date(at.getTime()+1).toISOString()}},
    {...redacted,data:{...redacted.data,action:"FINISH"}},
    {...redacted,data:{...redacted.data,attendanceMark:{...redacted.data.attendanceMark,installationId:"rf-fictional-installation-0000002"}}},
  ]) expect((await send(changed)).body.results).toMatchObject([{status:"conflict"}])
  // Exercise canonical-event replay independently of the transport's expiring receipt.
  await tenant(ORG,()=>prisma.mtmSyncOperation.deleteMany({where:{agentId:identity.agentId,operationId:op.operationId}}))
  expect((await send(redacted)).body.results).toMatchObject([{status:"ok"}]);expect(await evidence()).toEqual(before)
  await employee();const empty={...packet(at),locationState:"NO_CONSENT" as const,location:null,consentRevisionId:null},emptyOp=operation("START",randomUUID(),at,empty)
  expect((await send(emptyOp)).body.results).toMatchObject([{status:"ok"}]);await accept()
  expect((await send({...emptyOp,data:{...emptyOp.data,attendanceMark:packet(at)}})).body.results).toMatchObject([{status:"conflict"}]);expect((await evidence())[0].latitude).toBeNull()
 })
 it("preserves break privacy including FINISH while paused",async()=>{
  await employee();await accept();const id=randomUUID(),start=Date.now()+1000
  for(const[index,action]of["START","PAUSE","FINISH"].entries()){
   const at=new Date(start+index*1000),op=operation(action,id,at,action==="PAUSE"?undefined:packet(at))
   expect((await send(op)).body.results).toMatchObject([{status:"ok"}])
  }
  const rows=await evidence();expect(rows).toHaveLength(2);expect(rows[1]).toMatchObject({action:"FINISH",locationState:"BREAK_PRIVACY",latitude:null,longitude:null,consentId:null,branchRevisionId:null})
  expect(await tenant(ORG,()=>prisma.mtmAgentWorkdayEvent.count({where:{agentId:identity.agentId}}))).toBe(3)
 })
 it("drops a cached break fix even when FINISH follows RESUME",async()=>{
  await employee();await accept();const id=randomUUID(),start=Date.now()+1000
  for(const[index,action]of["START","PAUSE","RESUME","FINISH"].entries()){
   const at=new Date(start+index*2000),mark=action==="FINISH"?packet(new Date(start+3000)):action==="START"?packet(at):undefined
   expect((await send(operation(action,id,at,mark))).body.results).toMatchObject([{status:"ok"}])
  }
  expect((await evidence())[1]).toMatchObject({action:"FINISH",locationState:"BREAK_PRIVACY",latitude:null,longitude:null,consentId:null})
 })
 it("rejects a cached private fix from the preceding workday on a new START",async()=>{
  await employee();await accept();const previous=randomUUID(),now=Date.now()+1000
  const events=[operation("START",previous,new Date(now-86400000)),operation("PAUSE",previous,new Date(now)),operation("FINISH",previous,new Date(now+2000))]
  for(const event of events)expect((await send(event)).body.results).toMatchObject([{status:"ok"}])
  expect((await send(operation("START",randomUUID(),new Date(now+3000),packet(new Date(now+1000))))).body.results).toMatchObject([{status:"ok"}])
  expect((await evidence())[0]).toMatchObject({action:"START",locationState:"BREAK_PRIVACY",latitude:null,longitude:null,consentId:null})
 })
 it.each([false,true])("stores a distant endpoint with honest mock state %s",async isMock=>{
  await employee();await accept();const at=new Date(Date.now()+1000),mark=packet(at);mark.location!.isMock=isMock
  expect((await send(operation("START",randomUUID(),at,mark))).body.results).toMatchObject([{status:"ok"}])
  const row=(await evidence())[0];expect(row.locationState).toBe(isMock?"UNCERTAIN":"OUTSIDE");expect(row.isMock).toBe(isMock);expect(row.distanceMeters).toBeGreaterThan(1000)
 })
 it("defaults to flagged acceptance, then atomically refuses a definitive outside mark without repinning accepted replays",async()=>{
  const {saveAttendanceOutsideRule}=await import("@/lib/mtm/attendance-outside-rule")
  await employee();await accept();const acceptedAt=new Date(Date.now()+1000),accepted=operation("START",randomUUID(),acceptedAt,packet(acceptedAt))
  expect((await send(accepted)).body.results).toMatchObject([{status:"ok"}]);expect((await evidence())[0].locationState).toBe("OUTSIDE")
  await tenant(ORG,()=>saveAttendanceOutsideRule(admin,true))
  try{
   expect((await send(accepted)).body.results).toMatchObject([{status:"ok"}])
   await employee();await accept();const at=new Date(Date.now()+1000),id=randomUUID(),refused=operation("START",id,at,packet(at))
   expect((await send(refused)).body.results).toMatchObject([{status:"conflict",serverData:{code:"MTM_ATTENDANCE_LOCATION_OUTSIDE_REJECTED",committed:false}}])
   expect(await evidence()).toEqual([])
   await tenant(ORG,async()=>{expect(await prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}})).toBe(0);expect(await prisma.mtmAgentWorkdayEvent.count({where:{agentId:identity.agentId}})).toBe(0);expect(await prisma.mtmSyncOperation.count({where:{agentId:identity.agentId}})).toBe(0)})
   const inside=packet(at);inside.location!.latitude=41;inside.location!.longitude=50
   expect((await send({...refused,data:{...refused.data,attendanceMark:inside}})).body.results).toMatchObject([{status:"ok"}])
   const finishAt=new Date(at.getTime()+1000)
   expect((await send(operation("FINISH",id,finishAt,packet(finishAt)))).body.results).toMatchObject([{status:"conflict"}])
   const day=await tenant(ORG,()=>prisma.mtmAgentWorkday.findUniqueOrThrow({where:{id},select:{status:true,completedAt:true}}))
   expect(day).toEqual({status:"STARTED",completedAt:null});expect(await evidence()).toHaveLength(1)
   // Time still works without consent/GPS, and a paused FINISH has no private place.
   expect((await send(operation("PAUSE",id,finishAt))).body.results).toMatchObject([{status:"ok"}])
   const pausedFinish=new Date(finishAt.getTime()+1000)
   expect((await send(operation("FINISH",id,pausedFinish,packet(pausedFinish)))).body.results).toMatchObject([{status:"ok"}])
   expect((await evidence())[1]).toMatchObject({locationState:"BREAK_PRIVACY",latitude:null})
   for(const state of["UNAVAILABLE","NO_CONSENT"] as const){await employee();const nextAt=new Date();expect((await send(operation("START",randomUUID(),nextAt,{...packet(nextAt),locationState:state,location:null,consentRevisionId:null}))).body.results).toMatchObject([{status:"ok"}])}
   await employee();await accept();const mockAt=new Date(Date.now()+1000),uncertain=packet(mockAt);uncertain.location!.isMock=true
   expect((await send(operation("START",randomUUID(),mockAt,uncertain))).body.results).toMatchObject([{status:"ok"}])
   expect((await evidence())[0].locationState).toBe("UNCERTAIN")
   await employee();expect((await send(operation("START",randomUUID(),new Date()))).body.results).toMatchObject([{status:"ok"}])
  }finally{await tenant(ORG,()=>saveAttendanceOutsideRule(admin,false))}
 })
 it("audits the outside rule atomically, verifies the current administrator and avoids duplicate audit on retry",async()=>{
  const {saveAttendanceOutsideRule}=await import("@/lib/mtm/attendance-outside-rule")
  await employee()
  await expect(tenant(ORG,()=>saveAttendanceOutsideRule({...admin,userId:identity.agentId},true))).rejects.toMatchObject({status:403})
  const count=()=>tenant(ORG,()=>prisma.mtmAuditLog.count({where:{action:"MTM_ATTENDANCE_OUTSIDE_RULE_CHANGED"}}))
  const before=await count()
  await tenant(ORG,()=>saveAttendanceOutsideRule(admin,true));await tenant(ORG,()=>saveAttendanceOutsideRule(admin,true))
  expect(await count()).toBe(before+1)
  sql(scratch!.adminDb,"CREATE FUNCTION fixture_outside_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MTM_ATTENDANCE_OUTSIDE_RULE_CHANGED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_outside_audit_fail BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_outside_audit_fail();")
  try{
   await expect(tenant(ORG,()=>saveAttendanceOutsideRule(admin,false))).rejects.toThrow()
   expect(await tenant(ORG,()=>prisma.mtmSetting.findUnique({where:{organizationId_key:{organizationId:ORG,key:"attendanceRejectOutsideBranch"}},select:{value:true}}))).toEqual({value:true})
   expect(await count()).toBe(before+1)
  }finally{sql(scratch!.adminDb,'DROP TRIGGER fixture_outside_audit_fail ON mtm_audit_logs; DROP FUNCTION fixture_outside_audit_fail();');await tenant(ORG,()=>saveAttendanceOutsideRule(admin,false))}
 })
 it("rejects hidden break evidence and an installation mismatch without creating a day",async()=>{
  await employee();const at=new Date()
  for(const op of[operation("PAUSE",randomUUID(),at,packet(at)),operation("START",randomUUID(),at,packet(at))])expect((await send(op,"rf-fictional-installation-0000002")).body.results[0].status).not.toBe("ok")
  expect(await evidence()).toEqual([]);expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}}))).toBe(0)
 })
 it("blocks a disabled feature and inactive employee without keeping consent or evidence",async()=>{
  await employee();await tenant(ORG,()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:false}}))
  try{await expect(accept()).rejects.toMatchObject({status:404});expect((await send(operation("START",randomUUID(),new Date(),packet()))).status).toBe(403)}finally{await tenant(ORG,()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:true}}))}
  await tenant(ORG,()=>prisma.mtmAgent.update({where:{id:identity.agentId},data:{status:"INACTIVE"}}))
  await expect(accept()).rejects.toMatchObject({status:403});expect(await evidence()).toEqual([])
 })
 it("keeps old-build and break-private endpoint cells blank in the real report",async()=>{
  await employee();const id=randomUUID(),at=new Date(),start=operation("START",id,at)
  expect((await send(start)).body.results).toMatchObject([{status:"ok"}])
  const pauseAt=new Date(at.getTime()+1000),finishAt=new Date(at.getTime()+2000)
  expect((await send(operation("PAUSE",id,pauseAt))).body.results).toMatchObject([{status:"ok"}])
  expect((await send(operation("FINISH",id,finishAt,packet(finishAt)))).body.results).toMatchObject([{status:"ok"}])
  const day=await tenant(ORG,()=>prisma.mtmAgentWorkday.findFirstOrThrow({where:{agentId:identity.agentId},select:{workDate:true}})),date=day.workDate.toISOString().slice(0,10)
  const {readMtmAttendanceReport}=await import("@/lib/mtm/attendance-report-store")
  const report=await tenant(ORG,()=>readMtmAttendanceReport({organizationId:ORG,actor:{role:"ADMIN",agentId:null,scopedAgentIds:null},query:{from:date,to:date,form:"ALL",employeeId:identity.agentId},now:new Date(finishAt.getTime()+1000)}))
  expect(report.rows[0].locationMarks).toMatchObject([{state:"NOT_RECORDED",branch:null,distanceMeters:null},{state:"NOT_RECORDED",branch:null,distanceMeters:null}])
  const table=buildAttendanceTable(report,{version:1,mode:"DAY",columns:["arrivalBranch","departureBranch","markLocation"],filters:report.snapshot.query,showTotals:false},"en",key=>key)
  expect(table.rows[0].cells).toEqual(["—","—","—"])
  const summary=summarizeAttendanceBranches(report.rows)
  expect(summary.rows[0]).toMatchObject({arrivals:null,departures:null,employees:null,outside:null})
  expect(JSON.stringify(report)).not.toMatch(/BREAK_PRIVACY|latitude|longitude|installationId/)
 })
 it("rolls back canonical time and idempotency receipt if evidence cannot be saved",async()=>{
  await employee();sql(scratch!.adminDb,"CREATE FUNCTION fixture_geo_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture evidence failure'; END $$; CREATE TRIGGER fixture_geo_fail BEFORE INSERT ON mtm_attendance_mark_evidence FOR EACH ROW EXECUTE FUNCTION fixture_geo_fail();")
  try{const at=new Date(),op=operation("START",randomUUID(),at,{...packet(at),location:null,locationState:"UNAVAILABLE",consentRevisionId:null});expect((await send(op)).body.results[0].status).not.toBe("ok");expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}}))).toBe(0);expect(await tenant(ORG,()=>prisma.mtmSyncOperation.count({where:{agentId:identity.agentId}}))).toBe(0)}finally{sql(scratch!.adminDb,'DROP TRIGGER fixture_geo_fail ON mtm_attendance_mark_evidence; DROP FUNCTION fixture_geo_fail();')}
 })
 it("requires fresh consent after text changes and keeps historical evidence immutable and tenant-scoped",async()=>{
  await employee();await accept();const at=new Date(),op=operation("START",randomUUID(),at,packet(at))
  const changed=await tenant(ORG,()=>store.publishAttendanceLocationPolicy(admin,{requestId:randomUUID(),expectedRevisionId:policyId,enabled:true,texts:{...texts,en:texts.en+" New revision."},legalReviewConfirmed:true}));policyId=changed.policy.id
  expect((await send(op)).body.results).toMatchObject([{status:"ok"}]);const row=(await evidence())[0];expect(row).toMatchObject({locationState:"NO_CONSENT",latitude:null,longitude:null})
  await tenant(ORG,async()=>{await expect(prisma.$executeRaw`UPDATE mtm_attendance_mark_evidence SET "locationState"='OUTSIDE' WHERE id=${row.id}`).rejects.toThrow(/IMMUTABLE/);await expect(prisma.$executeRaw`DELETE FROM mtm_attendance_mark_evidence WHERE id=${row.id}`).rejects.toThrow(/IMMUTABLE/);await expect(prisma.$executeRaw`UPDATE mtm_attendance_location_consents SET accepted=false WHERE "agentId"=${identity.agentId}`).rejects.toThrow(/IMMUTABLE/)})
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_mark_evidence`)).toEqual([])
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_location_consents`)).toEqual([])
  expect(()=>sql(scratch!.adminDb,`UPDATE mtm_attendance_mark_evidence SET action='START' WHERE id='${row.id}'`)).toThrow()
 })

 it("reads actual review evidence in scope and appends one immutable dismissal for concurrent retries",async()=>{
  const review=await import("@/lib/mtm/attendance-risk-review-store")
  const id=await employee(),device=`rf-${randomUUID()}`
  expect((await send(operation("START",randomUUID(),new Date(Date.now()-1800000),{version:1,installationId:device,locationState:"NO_CONSENT",location:null,consentRevisionId:null}),device)).body.results[0].status).toBe("ok")
  const [risk]=await tenant(ORG,()=>prisma.$queryRaw<{id:string;workDate:Date}[]>`SELECT id,"workDate" FROM mtm_attendance_risk_cases WHERE "agentId"=${id}`)
  const query={from:risk.workDate.toISOString().slice(0,10),to:risk.workDate.toISOString().slice(0,10),status:"ALL",employeeId:id}
  const access={organizationId:ORG,actor:{role:"ADMIN" as const,agentId:null,scopedAgentIds:null},reviewer:admin,query}
  const before=await tenant(ORG,()=>review.readAttendanceRiskReport(access));expect(before.items).toHaveLength(1)
  expect(before.items[0]).toMatchObject({kind:"DELAYED_CLAIM",canDismiss:true,dismissal:null})
  expect(JSON.stringify(before)).not.toMatch(/installationId|latitude|longitude|consentId/)
  // A fabricated broad/narrow middleware actor does not replace current DB authority.
  expect((await tenant(ORG,()=>review.readAttendanceRiskReport({...access,actor:{role:"MANAGER",agentId:null,scopedAgentIds:[]}}))).items).toHaveLength(1)
  const payload={requestId:randomUUID(),reason:"Fictional offline delivery confirmed"}
  const results=await Promise.all([tenant(ORG,()=>review.dismissAttendanceRisk(admin,risk.id,payload)),tenant(ORG,()=>review.dismissAttendanceRisk(admin,risk.id,payload))])
  expect(results[0].id).toBe(results[1].id);expect(results.filter(result=>!result.idempotent)).toHaveLength(1)
  const after=await tenant(ORG,()=>review.readAttendanceRiskReport(access));expect(after.snapshot.id).not.toBe(before.snapshot.id)
  expect(after.items[0]).toMatchObject({canDismiss:false,dismissal:{reason:payload.reason,byName:"Fictional administrator"}})
  expect(await tenant(ORG,()=>prisma.mtmAuditLog.count({where:{action:"MTM_ATTENDANCE_RISK_DISMISSED",entityId:risk.id}}))).toBe(1)
  await expect(tenant(ORG,()=>review.dismissAttendanceRisk(admin,risk.id,{...payload,reason:"Changed reason"}))).rejects.toMatchObject({status:409})
  await expect(tenant(ORG,()=>prisma.$executeRaw`UPDATE mtm_attendance_risk_decisions SET reason='rewrite' WHERE "caseId"=${risk.id}`)).rejects.toThrow(/IMMUTABLE/)
  await expect(tenant(ORG,()=>prisma.$executeRaw`DELETE FROM mtm_attendance_risk_decisions WHERE "caseId"=${risk.id}`)).rejects.toThrow(/IMMUTABLE/)
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_risk_decisions`)).toEqual([])
 })
 it("keeps HR read-only and rolls back dismissal when its audit cannot be saved",async()=>{
  const review=await import("@/lib/mtm/attendance-risk-review-store")
  const id=await employee(),device=`rf-${randomUUID()}`
  expect((await send(operation("START",randomUUID(),new Date(Date.now()-1800000),{version:1,installationId:device,locationState:"NO_CONSENT",location:null,consentRevisionId:null}),device)).body.results[0].status).toBe("ok")
  const [risk]=await tenant(ORG,()=>prisma.$queryRaw<{id:string;workDate:Date}[]>`SELECT id,"workDate" FROM mtm_attendance_risk_cases WHERE "agentId"=${id}`)
  const hrId=randomUUID();await bypass(()=>prisma.user.create({data:{id:hrId,organizationId:ORG,email:`${hrId}@example.invalid`,name:"Fictional HR reader",role:"viewer",passwordHash:"unusable-fixture",mtmAttendanceAll:true}}))
  const hr={organizationId:ORG,userId:hrId,principalType:"session" as const}
  const report=await tenant(ORG,()=>review.readAttendanceRiskReport({organizationId:ORG,actor:{role:"MANAGER",agentId:null,scopedAgentIds:null},allEmployeesGrant:true,reviewer:hr,query:{from:risk.workDate.toISOString().slice(0,10),to:risk.workDate.toISOString().slice(0,10),employeeId:id}}))
  expect(report.items[0].canDismiss).toBe(false)
  const payload={requestId:randomUUID(),reason:"Fictional review"}
  await expect(tenant(ORG,()=>review.dismissAttendanceRisk(hr,risk.id,payload))).rejects.toMatchObject({status:403})
  sql(scratch!.adminDb,`CREATE FUNCTION fixture_risk_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MTM_ATTENDANCE_RISK_DISMISSED' THEN RAISE EXCEPTION 'fixture risk audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_risk_audit_fail BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_risk_audit_fail();`)
  try{await expect(tenant(ORG,()=>review.dismissAttendanceRisk(admin,risk.id,payload))).rejects.toThrow()
   expect(await tenant(ORG,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_risk_decisions WHERE "caseId"=${risk.id}`)).toEqual([])
  }finally{sql(scratch!.adminDb,'DROP TRIGGER fixture_risk_audit_fail ON mtm_audit_logs; DROP FUNCTION fixture_risk_audit_fail();')}
 })

 const riskRows=(agentId=identity.agentId)=>tenant(ORG,()=>prisma.$queryRaw<{id:string;agentId:string;eventId:string;kind:string;details:Record<string,unknown>}[]>`SELECT id,"agentId","eventId",kind,details FROM mtm_attendance_risk_cases WHERE "agentId"=${agentId} ORDER BY kind`)
 const noLocation=(installationId:string):AttendanceMark=>({version:1,installationId,locationState:"NO_CONSENT",consentRevisionId:null,location:null})
 const setting=(key:string,value:boolean|number)=>tenant(ORG,()=>prisma.mtmSetting.upsert({where:{organizationId_key:{organizationId:ORG,key}},create:{organizationId:ORG,key,value},update:{value}}))
 it("flags both employees on one installation and keeps exact retries from duplicating cases or bell rows",async()=>{
  const device=`rf-${randomUUID()}`,a=await employee(),at=new Date(),first=operation("START",randomUUID(),at,noLocation(device))
  expect((await send(first,device)).body.results).toMatchObject([{status:"ok"}]);expect(await riskRows(a)).toEqual([])
  const b=await employee(),second=operation("START",randomUUID(),new Date(),noLocation(device))
  expect((await send(second,device)).body.results).toMatchObject([{status:"ok"}])
  const aCases=await riskRows(a),bCases=await riskRows(b)
  expect(aCases).toHaveLength(1);expect(bCases).toHaveLength(1)
  expect(aCases[0]).toMatchObject({kind:"SHARED_INSTALLATION",details:{relatedAgentIds:[b],usualAgentId:null,observedDays:0}})
  expect(bCases[0]).toMatchObject({kind:"SHARED_INSTALLATION",details:{relatedAgentIds:[a]}})
  const ids=[aCases[0].id,bCases[0].id]
  const bells=()=>tenant(ORG,()=>prisma.notification.count({where:{entityId:{in:ids}}}))
  const before=await bells();expect(before).toBeGreaterThanOrEqual(2)
  expect((await send(second,device)).body.results).toMatchObject([{status:"ok"}]);expect(await riskRows(b)).toHaveLength(1);expect(await bells()).toBe(before)
  expect(JSON.stringify([...aCases,...bCases])).not.toMatch(/installationId|latitude|longitude/)
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_risk_cases`)).toEqual([])
  await expect(tenant(ORG,()=>prisma.$executeRaw`UPDATE mtm_attendance_risk_cases SET kind='NEW_INSTALLATION' WHERE id=${ids[0]}`)).rejects.toThrow(/IMMUTABLE/)
  await expect(tenant(ORG,()=>prisma.$executeRaw`DELETE FROM mtm_attendance_risk_cases WHERE id=${ids[0]}`)).rejects.toThrow(/IMMUTABLE/)
 })
 it("does not conflate different canonical days or different installations",async()=>{
  const device=`rf-${randomUUID()}`,yesterday=new Date(Date.now()-86400000),a=await employee()
  expect((await send(operation("START",randomUUID(),yesterday,noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
  const b=await employee();expect((await send(operation("START",randomUUID(),new Date(),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
  expect((await riskRows(a)).map(row=>row.kind)).toEqual(["DELAYED_CLAIM"]);expect(await riskRows(b)).toEqual([])
  await employee();const other=`rf-${randomUUID()}`;expect((await send(operation("START",randomUUID(),new Date(),noLocation(other)),other)).body.results).toMatchObject([{status:"ok"}]);expect(await riskRows()).toEqual([])
 })
 it("allows a tenant's lawful shared installation without generating shared-phone hints",async()=>{
  const device=`rf-${randomUUID()}`;await setting("attendanceAllowSharedInstallations",true)
  try{for(let i=0;i<2;i++){await employee();expect((await send(operation("START",randomUUID(),new Date(),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}]);expect(await riskRows()).toEqual([])}}
  finally{await setting("attendanceAllowSharedInstallations",false)}
 })
 it("uses the first observed installation as an unknown baseline and flags a later new installation",async()=>{
  await employee();const first=`rf-${randomUUID()}`,second=`rf-${randomUUID()}`,day=randomUUID(),at=new Date()
  expect((await send(operation("START",day,at,noLocation(first)),first)).body.results).toMatchObject([{status:"ok"}]);expect(await riskRows()).toEqual([])
  expect((await send(operation("FINISH",day,new Date(at.getTime()+1000),noLocation(second)),second)).body.results).toMatchObject([{status:"ok"}])
  expect((await riskRows()).map(row=>row.kind)).toEqual(["NEW_INSTALLATION"])
 })
 it("freezes a neutral timing difference and labels offline delivery separately",async()=>{
  const device=`rf-${randomUUID()}`;await employee()
  expect((await send(operation("START",randomUUID(),new Date(Date.now()-600000),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
  expect((await riskRows())[0]).toMatchObject({kind:"CLOCK_DIFFERENCE",details:{thresholdSeconds:300}})
  await employee();expect((await send(operation("START",randomUUID(),new Date(Date.now()-1800000),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
  expect((await riskRows()).some(row=>row.kind==="DELAYED_CLAIM")).toBe(true);expect((await riskRows()).some(row=>row.kind==="CLOCK_DIFFERENCE")).toBe(false)
 })
 it("flags mock provenance by default and refuses it atomically only when the tenant chooses rejection",async()=>{
  await employee();await accept();let at=new Date(Date.now()+1000),mark=packet(at);mark.location!.isMock=true
  expect((await send(operation("START",randomUUID(),at,mark))).body.results).toMatchObject([{status:"ok"}]);expect((await riskRows()).some(row=>row.kind==="MOCK_LOCATION")).toBe(true)
  await employee();await accept();at=new Date(Date.now()+1000);mark=packet(at);mark.location!.isMock=true;await setting("attendanceRejectMockLocations",true)
  try{expect((await send(operation("START",randomUUID(),at,mark))).body.results[0].status).not.toBe("ok");expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}}))).toBe(0);expect(await evidence()).toEqual([]);expect(await riskRows()).toEqual([])}
  finally{await setting("attendanceRejectMockLocations",false)}
 })
 it("rolls back the mark, risk and canonical day when the durable review bell cannot be saved",async()=>{
  await employee();const device=`rf-${randomUUID()}`,notifier=await import("@/lib/mtm/attendance-risk-notify")
  const failure=vi.spyOn(notifier,"notifyAttendanceRiskReviewers").mockRejectedValueOnce(new Error("fixture risk notification failure"))
  try{expect((await send(operation("START",randomUUID(),new Date(Date.now()-1800000),noLocation(device)),device)).body.results[0].status).not.toBe("ok");expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}}))).toBe(0);expect(await riskRows()).toEqual([]);expect(await evidence()).toEqual([]);expect(await tenant(ORG,()=>prisma.mtmSyncOperation.count({where:{agentId:identity.agentId}}))).toBe(0)}finally{failure.mockRestore()}
 })
 it("serializes concurrent employees sharing an installation so neither misses the other",async()=>{
  const a=await employee(),b=await employee(),device=`rf-${randomUUID()}`
  const sends=[a,b].map(agentId=>{const op=operation("START",randomUUID(),new Date(),noLocation(device));return push.POST(new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push",{method:"POST",headers:{"content-type":"application/json","x-field-device-id":device,"x-fixture-agent":agentId},body:JSON.stringify({operations:[op]})})).then(async response=>({status:response.status,body:await response.json()}))})
  const results=await Promise.all(sends);for(const result of results)expect(result.body.results).toMatchObject([{status:"ok"}])
  expect((await riskRows(a)).filter(row=>row.kind==="SHARED_INSTALLATION")).toHaveLength(1);expect((await riskRows(b)).filter(row=>row.kind==="SHARED_INSTALLATION")).toHaveLength(1)
 })
 it("uses only earlier distinct days for the usual-user hint, not mark frequency or today's first arrival",async()=>{
  const a=await employee(),device=`rf-${randomUUID()}`
  for(const days of[4,3,2]){const start=new Date(Date.now()-days*86400000),day=randomUUID();expect((await send(operation("START",day,start,noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}]);expect((await send(operation("FINISH",day,new Date(start.getTime()+1000),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])}
  const b=await employee();expect((await send(operation("START",randomUUID(),new Date(),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
  identity.agentId=a;expect((await send(operation("START",randomUUID(),new Date(),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
  for(const agent of[a,b])expect((await riskRows(agent)).find(row=>row.kind==="SHARED_INSTALLATION")).toMatchObject({details:{usualAgentId:a,usualDays:3,observedDays:3}})
 })

 async function fieldDay() {
  // Consent exists from the card's office past; as a field agent it no longer counts.
  await employee();const consent=await accept();identity.role="AGENT"
  await tenant(ORG,()=>prisma.mtmAgent.update({where:{id:identity.agentId},data:{role:"AGENT"}}))
  const at=new Date(Date.now()+1000),dayId=randomUUID()
  expect((await send(operation("START",dayId,at))).body.results).toMatchObject([{status:"ok"}])
  return {consent:consent.consent.id,at,dayId}
 }
 const streamRows=()=>tenant(ORG,()=>prisma.$queryRaw<{locationId:string;isMock:boolean;consentId:string}[]>`SELECT * FROM mtm_attendance_stream_integrity WHERE "agentId"=${identity.agentId}`)
 async function streamPoint(at:Date,signal:Record<string,unknown>,clientLocationId=randomUUID()) {
  const {POST}=await import("@/app/api/v1/mtm/mobile/location/route")
  const response=await POST(new NextRequest("http://localhost/api/v1/mtm/mobile/location",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({latitude:40.4,longitude:49.85,accuracy:5,recordedAt:at.toISOString(),clientLocationId,...signal})}))
  return {status:response.status,body:await response.json(),clientLocationId}
 }
 it("keeps a field agent's GPS points but stores no attendance signal: the agent's day is not HR attendance",async()=>{
  // Owner, 2026-10-14: a field agent's day belongs to the field manager; HR
  // attendance (and its private integrity signal) covers office staff only.
  try {
   const f=await fieldDay(),at=new Date(f.at.getTime()+1000)
   const first=await streamPoint(at,{isMock:true,attendanceConsentId:f.consent})
   expect(first.status).toBe(200);expect(first.body).toMatchObject({success:true,data:{replayed:false}});expect(JSON.stringify(first.body)).not.toMatch(/isMock|attendanceConsentId|consentId/)
   expect(await tenant(ORG,()=>prisma.mtmAgentLocation.count({where:{organizationId:ORG,agentId:identity.agentId}}))).toBe(1)
   expect(await streamRows()).toEqual([])
   // Its START was accepted without HR mark evidence or a risk case.
   expect(await tenant(ORG,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_mark_evidence WHERE "agentId"=${identity.agentId}`)).toEqual([])
  } finally {identity.role="EMPLOYEE"}
 })
 it("keeps ordinary field points with attendance off, and refuses a field agent's own consent change",async()=>{
  try {
   const f=await fieldDay(),at=new Date(f.at.getTime()+1000)
   await tenant(ORG,()=>prisma.mtmSetting.updateMany({where:{organizationId:ORG,key:"attendanceEnabled"},data:{value:false}}))
   expect((await streamPoint(at,{isMock:true,attendanceConsentId:f.consent})).status).toBe(200)
   await tenant(ORG,()=>prisma.mtmSetting.updateMany({where:{organizationId:ORG,key:"attendanceEnabled"},data:{value:true}}))
   // Location consent is office attendance; a field agent's day is not.
   await expect(tenant(ORG,()=>store.recordOwnAttendanceLocationConsent(self(),{requestId:randomUUID(),policyRevisionId:policyId,expectedConsentId:f.consent,accepted:false}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_SELF_REQUIRED"})
   expect((await streamPoint(at,{isMock:true,attendanceConsentId:f.consent})).status).toBe(200)
   expect((await streamPoint(at,{})).status).toBe(200)
   expect(await tenant(ORG,()=>prisma.mtmAgentLocation.count({where:{organizationId:ORG,agentId:identity.agentId}}))).toBe(3)
   expect(await streamRows()).toEqual([])
  } finally {
   identity.role="EMPLOYEE"
   await tenant(ORG,()=>prisma.mtmSetting.updateMany({where:{organizationId:ORG,key:"attendanceEnabled"},data:{value:true}}))
  }
 })
 it("batch keeps a field agent's points outside a break, drops the private point, and keeps no attendance signal",async()=>{
  try {
   const f=await fieldDay(),at=(ms:number)=>new Date(f.at.getTime()+ms)
   expect((await send(operation("PAUSE",f.dayId,at(1000)))).body.results).toMatchObject([{status:"ok"}])
   expect((await send(operation("RESUME",f.dayId,at(3000)))).body.results).toMatchObject([{status:"ok"}])
   await tenant(ORG,()=>prisma.mtmMobileSyncCohort.create({data:{organizationId:ORG,agentId:identity.agentId,deviceId:INSTALLATION,stream:"gps",enabled:true}}))
   const {POST}=await import("@/app/api/v2/mtm/mobile/location/batch/route")
   const ids=[randomUUID(),randomUUID(),randomUUID()]
   const response=await POST(new NextRequest("http://localhost/api/v2/mtm/mobile/location/batch",{method:"POST",headers:{"content-type":"application/json","x-field-device-id":INSTALLATION},body:JSON.stringify({workdayId:f.dayId,points:[500,2000,4000].map((ms,i)=>({clientLocationId:ids[i],latitude:40.4,longitude:49.85,accuracy:5,recordedAt:at(ms).toISOString(),isMock:i!==2,attendanceConsentId:f.consent}))})}))
   expect(response.status).toBe(201)
   expect(await response.json()).toMatchObject({data:{appliedClientLocationIds:[ids[0],ids[2]],pausedClientLocationIds:[ids[1]]}})
   // Break privacy still applies to the agent's route; no attendance signal is kept.
   expect(await streamRows()).toEqual([])
   expect(await tenant(ORG,()=>prisma.mtmAgentLocation.count({where:{agentId:identity.agentId,clientLocationId:ids[1]}}))).toBe(0)
  } finally {identity.role="EMPLOYEE"}
 })

 it("installation requests are own, exact-idempotent, private and atomic with their bell",async()=>{
  await employee();const installations=await import("@/lib/mtm/attendance-installation-store"),requestId=randomUUID()
  const first=await tenant(ORG,()=>installations.readOwnAttendanceInstallation(self(),INSTALLATION))
  expect(first).toMatchObject({required:false,state:"NOT_REQUESTED",canRequest:true})
  const results=await Promise.all([0,1].map(()=>tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,{requestId}))))
  expect(results[0]).toEqual(results[1]);expect(results[0]).toMatchObject({state:"PENDING",requestId,canRequest:false})
  await expect(tenant(ORG,()=>installations.submitAttendanceInstallation(self(),`${INSTALLATION}-changed`,{requestId}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_INSTALLATION_IDEMPOTENCY_MISMATCH"})
  await expect(tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,{requestId:randomUUID()}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_INSTALLATION_ALREADY_REQUESTED"})
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_installation_requests WHERE "requestId"=${requestId}`)).toEqual([])
  const queue=await tenant(ORG,()=>installations.readAttendanceInstallationQueue(admin,{status:"PENDING",employeeId:identity.agentId}))
  expect(queue.items).toHaveLength(1);expect(queue.items[0]).toMatchObject({canDecide:true,canRevoke:false,installationLabel:"…0001"})
  expect(await tenant(ORG,()=>installations.readAttendanceInstallationAttention(admin,[identity.agentId]))).toMatchObject([{agentId:identity.agentId,count:queue.items.length}])
  expect(await tenant(ORG,()=>installations.readAttendanceInstallationAttention(admin,[]))).toEqual([])
  expect(JSON.stringify(queue)).not.toContain(INSTALLATION);expect(JSON.stringify(queue)).not.toMatch(/requestHash|latitude|consentId/)
  expect(await tenant(ORG,()=>prisma.notification.count({where:{organizationId:ORG,entityType:"mtm_attendance_installation",entityId:queue.items[0].id}}))).toBe(1)
  const originalNotifier=await import("@/lib/mtm/attendance-installation-notify")
  const failed=vi.spyOn(originalNotifier,"notifyAttendanceInstallationReviewers").mockRejectedValueOnce(new Error("fictional bell failure"))
  try {await expect(tenant(ORG,()=>installations.submitAttendanceInstallation(self(),`${INSTALLATION}-other`,{requestId:randomUUID()}))).rejects.toThrow("fictional bell failure")}
  finally {failed.mockRestore()}
  expect((await tenant(ORG,()=>installations.readOwnAttendanceInstallation(self(),`${INSTALLATION}-other`))).state).toBe("NOT_REQUESTED")
 })
 it("approval and revocation are immutable, scoped, reasoned and exact retries",async()=>{
  await employee();const installations=await import("@/lib/mtm/attendance-installation-store")
  const request={requestId:randomUUID()};await tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,request))
  const id=(await tenant(ORG,()=>installations.readAttendanceInstallationQueue(admin,{employeeId:identity.agentId}))).items[0].id
  const decision={requestId:randomUUID(),action:"APPROVE",reason:"Fictional installation reviewed"}
  await expect(tenant(ORG,()=>installations.decideAttendanceInstallation({...admin,userId:identity.agentId},id,decision))).rejects.toMatchObject({status:403})
  await expect(tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,{...decision,reason:" "}))).rejects.toMatchObject({status:400})
  const outcomes=await Promise.all([0,1].map(()=>tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,decision))))
  expect(outcomes.map(result=>result.idempotent).sort()).toEqual([false,true]);expect(outcomes[0].id).toBe(outcomes[1].id)
  const { readAttendanceEmployeePreparation } = await import("@/lib/mtm/attendance-employee-preparation")
  const preparation = () => tenant(ORG, () => prisma.$transaction((tx: Prisma.TransactionClient) => readAttendanceEmployeePreparation(tx,
    { organizationId: ORG, agentId: identity.agentId, date: new Date().toISOString().slice(0,10) },
    { status: "ACTIVE", phone: "+994550000000", user: { isActive: true, phone: null } }, new Date())))
  expect((await preparation()).installations).toMatchObject({ approved: 1, pending: 0 })
  const revoke={requestId:randomUUID(),action:"REVOKE",reason:"Fictional phone replaced"}
  await expect(tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,{...revoke,requestId:decision.requestId}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_INSTALLATION_IDEMPOTENCY_MISMATCH"})
  await tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,revoke));expect(await tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,revoke))).toMatchObject({idempotent:true})
  expect(await tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,request))).toMatchObject({requestId:request.requestId,state:"REVOKED",canRequest:true,revocation:{reason:revoke.reason}})
  const next={requestId:randomUUID()};expect(await tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,next))).toMatchObject({requestId:next.requestId,state:"PENDING"})
  expect((await preparation()).installations).toMatchObject({ approved: 0, pending: 1 })
  expect((await tenant(ORG,()=>installations.readOwnAttendanceInstallation(self(),INSTALLATION))).requestId).toBe(next.requestId)
  expect(await tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,request))).toMatchObject({requestId:request.requestId,state:"REVOKED"})
  expect(await tenant(ORG,()=>prisma.$executeRaw`UPDATE mtm_attendance_installation_decisions SET reason='changed' WHERE id=${outcomes[0].id}`)).toBe(0)
  expect(()=>sql(scratch!.adminDb,`UPDATE mtm_attendance_installation_decisions SET reason='changed' WHERE id='${outcomes[0].id}'`)).toThrow()
  expect(()=>sql(scratch!.adminDb,`DELETE FROM mtm_attendance_installation_requests WHERE id='${id}'`)).toThrow()
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_installation_decisions WHERE id=${outcomes[0].id}`)).toEqual([])
 })
 it("strict approval rolls back a legacy mark, allows an approved mark and preserves accepted replays after revocation",async()=>{
  await employee();const installations=await import("@/lib/mtm/attendance-installation-store"),policy=await import("@/lib/mtm/attendance-installation-policy")
  const at=new Date(),workdayId=randomUUID(),op=operation("START",workdayId,at)
  await tenant(ORG,()=>policy.saveAttendanceInstallationRule(admin,true))
  try {
   expect((await send(op)).body.results).toMatchObject([{status:"conflict",serverData:{code:"MTM_ATTENDANCE_INSTALLATION_APPROVAL_REQUIRED",committed:false}}])
   expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{organizationId:ORG,agentId:identity.agentId}}))).toBe(0)
   expect(await tenant(ORG,()=>prisma.mtmSyncOperation.count({where:{organizationId:ORG,operationId:op.operationId}}))).toBe(0)
   await tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,{requestId:randomUUID()}))
   const id=(await tenant(ORG,()=>installations.readAttendanceInstallationQueue(admin,{employeeId:identity.agentId}))).items[0].id
   await tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,{requestId:randomUUID(),action:"APPROVE",reason:"Fictional review"}))
   expect((await send(op)).body.results).toMatchObject([{status:"ok"}])
   await tenant(ORG,()=>installations.decideAttendanceInstallation(admin,id,{requestId:randomUUID(),action:"REVOKE",reason:"Fictional replacement"}))
   expect((await send(op)).body.results).toMatchObject([{status:"ok"}])
   const finish=operation("FINISH",workdayId,new Date(Date.now()+1000))
   expect((await send(finish)).body.results).toMatchObject([{status:"conflict",serverData:{committed:false}}])
   expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.findFirst({where:{organizationId:ORG,agentId:identity.agentId},select:{status:true,completedAt:true}}))).toEqual({status:"STARTED",completedAt:null})
  } finally {await tenant(ORG,()=>policy.saveAttendanceInstallationRule(admin,false))}
 })
 it("disabling attendance keeps strict approval dormant for ordinary field marks and denies new installation requests",async()=>{
  await employee();const installations=await import("@/lib/mtm/attendance-installation-store"),policy=await import("@/lib/mtm/attendance-installation-policy")
  await bypass(()=>prisma.mtmAgent.update({where:{id:identity.agentId},data:{role:"AGENT"}}));identity.role="AGENT"
  await tenant(ORG,()=>policy.saveAttendanceInstallationRule(admin,true))
  await tenant(ORG,()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:false}}))
  try {
   expect((await send(operation("START",randomUUID(),new Date()))).body.results).toMatchObject([{status:"ok"}])
   await expect(tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,{requestId:randomUUID()}))).rejects.toMatchObject({status:404})
   expect(await tenant(ORG,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_installation_requests WHERE "agentId"=${identity.agentId}`)).toEqual([])
  } finally {
   await tenant(ORG,()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:true}}))
   await tenant(ORG,()=>policy.saveAttendanceInstallationRule(admin,false));identity.role="EMPLOYEE"
  }
 })
 it("read-only HR can inspect but cannot decide; current account loss clears access",async()=>{
  await employee();const installations=await import("@/lib/mtm/attendance-installation-store")
  await tenant(ORG,()=>installations.submitAttendanceInstallation(self(),INSTALLATION,{requestId:randomUUID()}))
  const readerId=randomUUID();await bypass(()=>prisma.user.create({data:{id:readerId,organizationId:ORG,email:`${readerId}@example.invalid`,name:"Fictional read-only HR",role:"viewer",mtmAttendanceAll:true,passwordHash:"unusable-fixture"}}))
  const reader={...admin,userId:readerId},queue=await tenant(ORG,()=>installations.readAttendanceInstallationQueue(reader,{employeeId:identity.agentId}))
  expect(queue.items[0]).toMatchObject({canDecide:false,canRevoke:false});expect(queue.canConfigure).toBe(false)
  await expect(tenant(ORG,()=>installations.decideAttendanceInstallation(reader,queue.items[0].id,{requestId:randomUUID(),action:"APPROVE",reason:"Fictional reason"}))).rejects.toMatchObject({status:403})
  await bypass(()=>prisma.user.update({where:{id:readerId},data:{mtmAttendanceAll:false}}))
  await expect(tenant(ORG,()=>installations.readAttendanceInstallationQueue(reader,{}))).rejects.toMatchObject({status:403})
  await bypass(()=>prisma.mtmAgent.update({where:{id:identity.agentId},data:{attendanceParticipant:false}}))
  await expect(tenant(ORG,()=>installations.readOwnAttendanceInstallation(self(),INSTALLATION))).rejects.toMatchObject({status:403})
 })

 it("QR is opt-in, supports two employees using one code, and preserves accepted replay after expiry and disable",async()=>{
  const qr=await import("@/lib/mtm/attendance-qr-store"),policy=await import("@/lib/mtm/attendance-qr-policy"),security=await import("@/lib/mtm/attendance-qr-security")
  expect((await tenant(ORG,()=>qr.readAttendanceQrDirectory(admin))).enabled).toBe(false)
  await expect(tenant(ORG,()=>qr.issueAttendanceBranchQr(admin,{branchId}))).rejects.toMatchObject({status:404})
  await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))
  try {
   expect((await tenant(ORG,()=>qr.issueAttendanceBranchQr(admin,{branchId}))).dataUrl).toMatch(/^data:image\/png;base64,/)
   await expect(tenant(ORG,()=>qr.issueAttendanceBranchQr(admin,{branchId:randomUUID()}))).rejects.toMatchObject({status:404})
   const at=new Date(),issued=security.issueAttendanceQrToken(ORG,branchId,branchRevisionId,at)
   const owners:string[]=[]
   for(let i=0;i<2;i++){
    owners.push(await employee());const ownDay=randomUUID(),op=operation("START",ownDay,new Date(),undefined,{version:1,token:issued.token})
    const first=await send(op);expect(first.body.results).toMatchObject([{status:"ok",serverData:{attendanceQr:{state:"VERIFIED",branch:{id:branchId}}}}])
    const receipt=first.body.results[0].serverData.attendanceQr
    const { readOwnAttendanceMarks } = await import("@/lib/mtm/attendance-own-marks")
    const personal = await tenant(ORG, () => readOwnAttendanceMarks(self(), ownDay))
    expect(personal.items[0].qr).toEqual({ state: "VERIFIED", branchName: receipt.branch.name })
    expect(JSON.stringify(personal)).not.toMatch(/mtmq1\.|nonceFingerprint|installationId/)
    const {readMtmAttendanceReport}=await import("@/lib/mtm/attendance-report-store")
    const day=await tenant(ORG,()=>prisma.mtmAgentWorkday.findFirstOrThrow({where:{agentId:identity.agentId},select:{workDate:true}})),date=day.workDate.toISOString().slice(0,10)
    const report=await tenant(ORG,()=>readMtmAttendanceReport({organizationId:ORG,actor:{role:"ADMIN",agentId:null,scopedAgentIds:null},query:{from:date,to:date,form:"ALL",employeeId:identity.agentId},now:new Date()}))
    expect(report.rows[0].locationMarks?.[0]).toMatchObject({qr:{state:"VERIFIED",branch:{id:branchId,revisionId:branchRevisionId}}})
    const table=buildAttendanceTable(report,{version:1,mode:"BRANCH",columns:["branch","arrivals"],filters:report.snapshot.query,showTotals:true},"en",key=>key)
    expect(table.rows[0].cells).toEqual([receipt.branch.name,1])
    expect(JSON.stringify(report)+JSON.stringify(buildAttendanceXlsx(table).worksheets[0].getSheetValues())+attendancePdfText(buildAttendancePdf(table))).not.toMatch(/mtmq1\.|nonceFingerprint|latitude|longitude|installationId/)
    expect(await tenant(ORG,()=>prisma.$executeRaw`UPDATE mtm_attendance_qr_evidence SET state='INVALID' WHERE "eventId"=${receipt.eventId}`)).toBe(0)
    expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_qr_evidence WHERE "eventId"=${receipt.eventId}`)).toEqual([])
    if(i===1){
     await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))
     vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at.getTime()+120000))
     try {expect((await send(op)).body.results[0].serverData.attendanceQr).toEqual(receipt)} finally {vi.useRealTimers()}
    }
   }
   expect(await tenant(ORG,()=>prisma.mtmAttendanceQrEvidence.count({where:{organizationId:ORG,agentId:{in:owners},state:"VERIFIED"}}))).toBe(2)
   expect(()=>sql(scratch!.adminDb,`UPDATE mtm_attendance_qr_evidence SET state='INVALID' WHERE "agentId"='${owners[0]}'`)).toThrow()
  } finally {vi.useRealTimers();await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))}
 })
 it("missing, foreign, expired and changed-branch QR preserve time without claiming a branch",async()=>{
  const policy=await import("@/lib/mtm/attendance-qr-policy"),security=await import("@/lib/mtm/attendance-qr-security")
  await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))
  try {
   const now=new Date(),old=security.issueAttendanceQrToken(ORG,branchId,branchRevisionId,now).token
   const edited=await tenant(ORG,()=>branches.saveAttendanceBranch(admin,{requestId:randomUUID(),branchId,expectedRevisionId:branchRevisionId,name:"Fictional QR branch version",address:"Demo Road 36",latitude:41,longitude:50,radiusMeters:150,active:true}));branchRevisionId=edited.branch.revisionId
   const cases=[{token:null,state:"NOT_PROVIDED"},{token:security.issueAttendanceQrToken(OTHER,branchId,branchRevisionId,now).token,state:"INVALID"},{token:security.issueAttendanceQrToken(ORG,branchId,branchRevisionId,new Date(now.getTime()-120000)).token,state:"EXPIRED"},{token:old,state:"BRANCH_CHANGED"}]
   for(const test of cases){await employee();const result=await send(operation("START",randomUUID(),new Date(),undefined,{version:1,token:test.token}));expect(result.body.results).toMatchObject([{status:"ok",serverData:{attendanceQr:{state:test.state,branch:null}}}]);expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}}))).toBe(1)}
  } finally {await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))}
 })
 it("ending a paused day never discloses its QR branch, while OFF keeps the old response",async()=>{
  const policy=await import("@/lib/mtm/attendance-qr-policy"),security=await import("@/lib/mtm/attendance-qr-security")
  await employee();let at=new Date(),id=randomUUID()
  const off=await send(operation("START",id,at));expect(off.body.results[0].status).toBe("ok");expect(off.body.results[0].serverData).not.toHaveProperty("attendanceQr")
  await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))
  try {
   await employee();at=new Date();id=randomUUID();const token=security.issueAttendanceQrToken(ORG,branchId,branchRevisionId,at).token
   expect((await send(operation("START",id,at,undefined,{version:1,token}))).body.results[0].status).toBe("ok")
   expect((await send(operation("PAUSE",id,new Date(at.getTime()+1000)))).body.results[0].status).toBe("ok")
   const finish=await send(operation("FINISH",id,new Date(at.getTime()+2000),undefined,{version:1,token}))
   expect(finish.body.results).toMatchObject([{status:"ok",serverData:{attendanceQr:{state:"NOT_PROVIDED",branch:null}}}])
   const rows=await tenant(ORG,()=>prisma.mtmAttendanceQrEvidence.findMany({where:{agentId:identity.agentId,action:"FINISH"},select:{branchRevisionId:true,nonceFingerprint:true}}));expect(rows).toEqual([{branchRevisionId:null,nonceFingerprint:null}])
  } finally {await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))}
 })
 it("QR setting audit failure rolls back and current employee or HR role cannot issue codes",async()=>{
  await employee();const policy=await import("@/lib/mtm/attendance-qr-policy"),qr=await import("@/lib/mtm/attendance-qr-store")
  await expect(tenant(ORG,()=>qr.issueAttendanceBranchQr({...admin,userId:identity.agentId},{branchId}))).rejects.toMatchObject({status:403})
  await expect(tenant(ORG,()=>policy.saveAttendanceQrRule({...admin,userId:identity.agentId},true))).rejects.toMatchObject({status:403})
  sql(scratch!.adminDb,"CREATE FUNCTION fixture_qr_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MTM_ATTENDANCE_QR_RULE_CHANGED' THEN RAISE EXCEPTION 'fictional QR audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_qr_audit_fail BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_qr_audit_fail();")
  try {await expect(tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))).rejects.toThrow()}
  finally {sql(scratch!.adminDb,'DROP TRIGGER fixture_qr_audit_fail ON mtm_audit_logs; DROP FUNCTION fixture_qr_audit_fail();')}
  expect((await tenant(ORG,()=>qr.readAttendanceQrDirectory(admin))).enabled).toBe(false)
 })

 it("does not recycle a QR for the same employee's next workday across midnight",async()=>{
  const policy=await import("@/lib/mtm/attendance-qr-policy"),security=await import("@/lib/mtm/attendance-qr-security")
  await employee();await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))
  const at=new Date("2026-10-13T19:59:40Z"),id=randomUUID()
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(at)
  try {
   const token=security.issueAttendanceQrToken(ORG,branchId,branchRevisionId,at).token
   expect((await send(operation("START",id,at,undefined,{version:1,token}))).body.results[0].serverData.attendanceQr.state).toBe("VERIFIED")
   vi.setSystemTime(new Date(at.getTime()+1000))
   expect((await send(operation("FINISH",id,new Date(),undefined,{version:1,token}))).body.results[0].serverData.attendanceQr.state).toBe("VERIFIED")
   vi.setSystemTime(new Date(at.getTime()+30000))
   expect((await send(operation("START",randomUUID(),new Date(),undefined,{version:1,token}))).body.results).toMatchObject([{status:"ok",serverData:{attendanceQr:{state:"REUSED",branch:null}}}])
  } finally {vi.useRealTimers();await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))}
 })

 it("rolls back time and its sync receipt when the QR evidence cannot be saved",async()=>{
  const policy=await import("@/lib/mtm/attendance-qr-policy")
  await employee();await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))
  sql(scratch!.adminDb,"CREATE FUNCTION fixture_qr_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture QR evidence failure'; END $$; CREATE TRIGGER fixture_qr_fail BEFORE INSERT ON mtm_attendance_qr_evidence FOR EACH ROW EXECUTE FUNCTION fixture_qr_fail();")
  try {
   expect((await send(operation("START",randomUUID(),new Date(),undefined,{version:1,token:null}))).body.results[0].status).not.toBe("ok")
   expect(await tenant(ORG,()=>prisma.mtmAgentWorkday.count({where:{agentId:identity.agentId}}))).toBe(0)
   expect(await tenant(ORG,()=>prisma.mtmSyncOperation.count({where:{agentId:identity.agentId}}))).toBe(0)
  } finally {sql(scratch!.adminDb,'DROP TRIGGER fixture_qr_fail ON mtm_attendance_qr_evidence; DROP FUNCTION fixture_qr_fail();');await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))}
 })

 it("QR issuer uses current team assignments and never grants issuance to read-only HR",async()=>{
  const qr=await import("@/lib/mtm/attendance-qr-store"),policy=await import("@/lib/mtm/attendance-qr-policy")
  await employee();const target=identity.agentId,managerId=randomUUID(),team=randomUUID()
  await bypass(async()=>{
   await prisma.user.create({data:{id:managerId,organizationId:ORG,email:`${managerId}@example.invalid`,name:"Fictional QR manager",role:"manager",passwordHash:"unusable-fixture"}})
   await prisma.mtmTeam.create({data:{id:team,organizationId:ORG,name:"Fictional QR team"}})
   await prisma.mtmAgent.create({data:{id:managerId,organizationId:ORG,userId:managerId,name:"Fictional QR manager",role:"MANAGER",teamId:team}})
   await prisma.mtmAgent.update({where:{id:target},data:{teamId:team}})
  })
  const manager={...admin,userId:managerId}
  await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,true))
  try {
   await expect(tenant(ORG,()=>qr.issueAttendanceBranchQr(manager,{branchId}))).rejects.toMatchObject({status:404})
   await tenant(ORG,()=>branches.saveAttendancePrimaryBranch(admin,{requestId:randomUUID(),expectedRevisionId:null,agentId:target,branchId}))
   expect((await tenant(ORG,()=>qr.readAttendanceQrDirectory(manager))).branches).toMatchObject([{id:branchId}])
   expect((await tenant(ORG,()=>qr.issueAttendanceBranchQr(manager,{branchId}))).branch.id).toBe(branchId)
   await bypass(()=>prisma.mtmAgent.update({where:{id:target},data:{teamId:null}}))
   await expect(tenant(ORG,()=>qr.issueAttendanceBranchQr(manager,{branchId}))).rejects.toMatchObject({status:404})
   await bypass(()=>prisma.user.update({where:{id:managerId},data:{role:"viewer",mtmAttendanceAll:true}}))
   await expect(tenant(ORG,()=>qr.readAttendanceQrDirectory(manager))).rejects.toMatchObject({status:403})
  } finally {await tenant(ORG,()=>policy.saveAttendanceQrRule(admin,false))}
 })
 it("sets UTC only on four attendance guards and preserves their original immutable bodies",async()=>{
  const guards=[
   ["mtm_attendance_location_history_guard","20261013090000_mtm_attendance_location_evidence"],
   ["mtm_attendance_branch_history_guard","20261013070000_mtm_attendance_branches"],
   ["mtm_attendance_risk_guard","20261013120000_mtm_attendance_risks"],
   ["mtm_attendance_qr_guard","20261013160000_mtm_attendance_branch_qr"],
  ] as const
  for(const [name,migration] of guards){
   const original=readFileSync(`prisma/migrations/${migration}/migration.sql`,"utf8").split(`CREATE FUNCTION ${name}()`)[1].split("$$")[1]
   const [installed]=await tenant(ORG,()=>prisma.$queryRaw<{source:string;settings:string[];securityDefiner:boolean}[]>`SELECT p.prosrc AS source,p.proconfig AS settings,p.prosecdef AS "securityDefiner" FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=${name}`)
   expect(installed.source).toBe(original)
   expect(installed.settings.map(value=>value.toLowerCase())).toEqual(["timezone=utc"])
   expect(installed.securityDefiner).toBe(false)
  }
 })
 it.each(["Asia/Baku","America/New_York"] as const)("non-UTC guards preserve UTC consent, branch, mark and QR clocks and restore caller in %s",async timezone=>{
  sql(scratch!.adminDb,`ALTER ROLE "${scratch!.role}" SET timezone='${timezone}'`)
  await prisma.$disconnect()
  const qrPolicy=await import("@/lib/mtm/attendance-qr-policy"),security=await import("@/lib/mtm/attendance-qr-security")
  try {
   const before=Date.now()-1_000,id=await employee(),device=`rf-${randomUUID()}`
   const published=await tenant(ORG,()=>store.publishAttendanceLocationPolicy(admin,{requestId:randomUUID(),expectedRevisionId:policyId,enabled:true,texts,legalReviewConfirmed:true}))
   policyId=published.policy.id
   const consent=await accept()
   const branch=await tenant(ORG,()=>branches.saveAttendanceBranch(admin,{requestId:randomUUID(),branchId:null,expectedRevisionId:null,name:"Fictional UTC branch",address:"Demo Road UTC",latitude:40.4,longitude:49.85,radiusMeters:150,active:true}))
   const primary=await tenant(ORG,()=>branches.saveAttendancePrimaryBranch(admin,{requestId:randomUUID(),expectedRevisionId:null,agentId:id,branchId:branch.branch.id}))
   await tenant(ORG,()=>qrPolicy.saveAttendanceQrRule(admin,true))
   const at=new Date(Math.max(Date.now(),Date.parse(consent.consent.createdAt)+10,Date.parse(primary.primary.createdAt)+10))
   const qr=security.issueAttendanceQrToken(ORG,branch.branch.id,branch.branch.revisionId,at)
   const mark={...packet(at),installationId:device}
   const result=await send(operation("START",randomUUID(),at,mark,{version:1,token:qr.token}),device)
   expect(result.body.results).toMatchObject([{status:"ok",serverData:{attendanceQr:{state:"VERIFIED"}}}])
   const [saved]=await evidence()
   expect(saved).toMatchObject({locationState:"INSIDE",branchRevisionId:branch.branch.revisionId,consentId:consent.consent.id})
   expect(saved.claimedAt).toEqual(at)
   const [clocks]=await tenant(ORG,()=>prisma.$queryRaw<{branch:Date;mark:Date;qr:Date;fix:Date;caller:string}[]>`SELECT b."createdAt" AS branch,m."createdAt" AS mark,q."createdAt" AS qr,m."fixCapturedAt" AS fix,current_setting('TimeZone') AS caller FROM mtm_attendance_branches b JOIN mtm_attendance_mark_evidence m ON m."branchRevisionId"=${branch.branch.revisionId} JOIN mtm_attendance_qr_evidence q ON q."eventId"=m."eventId" WHERE b.id=${branch.branch.id} AND m.id=${saved.id}`)
   expect(clocks.caller).toBe(timezone)
   expect(clocks.fix).toEqual(at)
   const after=Date.now()+1_000
   for(const clock of [clocks.branch,clocks.mark,clocks.qr,new Date(published.policy.createdAt),new Date(consent.consent.createdAt),new Date(branch.branch.createdAt),new Date(primary.primary.createdAt)]){
    expect(clock.getTime()).toBeGreaterThanOrEqual(before)
    expect(clock.getTime()).toBeLessThanOrEqual(after)
   }
   // A trigger's local setting must also restore the SAME transaction connection.
   await tenant(ORG,()=>prisma.$transaction(async tx=>{
    const [start]=await tx.$queryRaw<{zone:string}[]>`SELECT current_setting('TimeZone') AS zone`
    expect(start.zone).toBe(timezone)
    // A no-op conflict still executes the immutable guard; no history is changed.
    await tx.$executeRaw`INSERT INTO mtm_attendance_branches (id,"organizationId") VALUES (${branch.branch.id},${ORG}) ON CONFLICT DO NOTHING`
    const [end]=await tx.$queryRaw<{zone:string}[]>`SELECT current_setting('TimeZone') AS zone`
    expect(end.zone).toBe(timezone)
   }))
   expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_mark_evidence WHERE id=${saved.id}`)).toEqual([])
  } finally {
   await tenant(ORG,()=>qrPolicy.saveAttendanceQrRule(admin,false))
   sql(scratch!.adminDb,`ALTER ROLE "${scratch!.role}" RESET timezone`)
   await prisma.$disconnect()
  }
 },90_000)
 it.each(["Asia/Baku","America/New_York"] as const)("non-UTC risk dates retain the canonical day, peers, historical cohort and exact-day filter in %s",async timezone=>{
  sql(scratch!.adminDb,`ALTER ROLE "${scratch!.role}" SET timezone='${timezone}'`)
  await prisma.$disconnect()
  try {
   const review=await import("@/lib/mtm/attendance-risk-review-store")
   const first=await employee(),device=`rf-${randomUUID()}`,at=new Date(Date.now()-1_800_000)
   await setting("attendanceAllowSharedInstallations",false)
   // Three earlier calendar days establish a real usual-user cohort. Today's
   // events must never enter the historical range through timestamptz coercion.
   for(const offset of [3,2,1]){
    const historical=new Date(at.getTime()-offset*86_400_000),day=randomUUID()
    expect((await send(operation("START",day,historical,noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
    expect((await send(operation("FINISH",day,new Date(historical.getTime()+1_000),noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
   }
   const before=Date.now()-1_000,day=randomUUID()
   expect((await send(operation("START",day,at,noLocation(device)),device)).body.results).toMatchObject([{status:"ok"}])
   const second=await employee()
   const secondStart=operation("START",randomUUID(),new Date(at.getTime()+1_000),noLocation(device))
   expect((await send(secondStart,device)).body.results).toMatchObject([{status:"ok"}])
   expect((await send(secondStart,device)).body.results).toMatchObject([{status:"ok"}])
   const canonical=await tenant(ORG,()=>prisma.mtmAgentWorkday.findUniqueOrThrow({where:{id:day},select:{workDate:true}}))
   const date=canonical.workDate.toISOString().slice(0,10)
   for(const id of [first,second]){
    const report=await tenant(ORG,()=>review.readAttendanceRiskReport({organizationId:ORG,actor:{role:"ADMIN",agentId:null,scopedAgentIds:null},reviewer:admin,query:{from:date,to:date,status:"ALL",employeeId:id}}))
    expect(report.items.map(row=>row.kind).sort()).toEqual(["DELAYED_CLAIM","SHARED_INSTALLATION"])
    expect(report.items.every(row=>row.workDate===date)).toBe(true)
    const shared=report.items.find(row=>row.kind==="SHARED_INSTALLATION")!
    const [raw]=await tenant(ORG,()=>prisma.$queryRaw<{details:{usualAgentId:string;observedDays:number};createdAt:Date;workDate:Date}[]>`SELECT details,"createdAt","workDate" FROM mtm_attendance_risk_cases WHERE id=${shared.id}`)
    expect(raw.details).toMatchObject({usualAgentId:first,observedDays:3})
    expect(raw.workDate).toEqual(canonical.workDate)
    expect(raw.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(raw.createdAt.getTime()).toBeLessThanOrEqual(Date.now()+1_000)
    const dismissed=await tenant(ORG,()=>review.dismissAttendanceRisk(admin,shared.id,{requestId:randomUUID(),reason:"Fictional timezone review"}))
    const [decision]=await tenant(ORG,()=>prisma.$queryRaw<{createdAt:Date;caller:string}[]>`SELECT "createdAt",current_setting('TimeZone') AS caller FROM mtm_attendance_risk_decisions WHERE id=${dismissed.id}`)
    expect(decision.caller).toBe(timezone)
    expect(decision.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(decision.createdAt.getTime()).toBeLessThanOrEqual(Date.now()+1_000)
   }
  } finally {
   sql(scratch!.adminDb,`ALTER ROLE "${scratch!.role}" RESET timezone`)
   await prisma.$disconnect()
  }
 },90_000)

})
