/** The shipping sync route, actual migration and restricted PostgreSQL role. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { AttendanceMark } from "@/lib/mtm/attendance-location-contract"
const adminUrl=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if(!adminUrl&&process.env.MTM_ATTENDANCE_DB_GATE==="required")throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch=vi.hoisted(()=>{const admin=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL;if(!admin)return null;const name=`mtm_geo_${process.pid}_${Date.now()}`,role=`${name}_app`;const url=new URL(admin);url.pathname=`/${name}`;const app=new URL(url);app.username=role;app.password="geo-fixture-only";process.env.DATABASE_URL=app.toString();return{name,role,adminDb:url.toString()}})
const identity=vi.hoisted(()=>({orgId:"geo-fixture-a",agentId:"",role:"EMPLOYEE"}))
vi.mock("@/lib/mobile-auth",()=>({resolveMobileAuth:async()=>({...identity,tenantCapabilities:{routeField:true,workforceHrm:false}})}))
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
 function operation(action:string,workdayId:string,at:Date,mark?:AttendanceMark){return{operationId:randomUUID(),entity:"workdays",op:"create",clientTimestamp:Date.now(),data:{action,...(action==="START"?{id:workdayId}:{workdayId}),occurredAt:at.toISOString(),...(mark?{attendanceMark:mark}:{})}}}
 async function send(op:ReturnType<typeof operation>,device=INSTALLATION){const response=await push.POST(new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push",{method:"POST",headers:{"content-type":"application/json","x-field-device-id":device},body:JSON.stringify({operations:[op]})}));return{status:response.status,body:await response.json()}}
 beforeAll(async()=>{
  sql(adminUrl!,`CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'geo-fixture-only' NOSUPERUSER NOBYPASSRLS`);createdRole=true
  sql(adminUrl!,`CREATE DATABASE "${scratch!.name}"`);createdDb=true
  schemaDir=mkdtempSync(join(tmpdir(),"mtm-geo-schema-"));const schema=join(schemaDir,"schema.prisma");writeFileSync(schema,readFileSync("prisma/schema.prisma","utf8").split("\n").filter(line=>!/Unsupported\("vector/.test(line)).join("\n"))
  const result=spawnSync(process.execPath,[cli,"db","push","--schema",schema,"--skip-generate"],{env:{...process.env,DATABASE_URL:scratch!.adminDb},encoding:"utf8",timeout:180000,maxBuffer:1024*1024});if(result.status!==0)throw new Error("Location fixture schema push failed")
  sql(scratch!.adminDb,'DROP TABLE mtm_attendance_mark_evidence; DROP TABLE mtm_attendance_location_consents; DROP TABLE mtm_attendance_location_policies; DROP TABLE mtm_attendance_primary_branch_revisions; DROP TABLE mtm_attendance_branch_revisions; DROP TABLE mtm_attendance_branches; ALTER TABLE workforce_time_corrections DROP COLUMN "requestHash";')
  for(const migration of["20260806120000_mtm_rls_coverage_completion","20260806160000_mtm_rls_bypass_clause_normalization","20261013070000_mtm_attendance_branches","20261013090000_mtm_attendance_location_evidence"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${migration}/migration.sql`,"utf8"))
  const foundation=readFileSync("prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql","utf8");sql(scratch!.adminDb,foundation.slice(foundation.indexOf("-- Tenant data ships fail-closed."),foundation.indexOf("-- A migration runner may own new tables")))
  for(const migration of["20260828224500_workforce_h3_legacy_fact_guard","20260828230000_workforce_direct_correction_contract"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${migration}/migration.sql`,"utf8"))
  sql(scratch!.adminDb,readFileSync("scripts/rls/enable-batch-5.sql","utf8"));sql(scratch!.adminDb,`GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
  prisma=(await import("@/lib/prisma")).prisma;({runWithTenant:tenant,runWithRlsBypass:bypass}=await import("@/lib/rls-context"));store=await import("@/lib/mtm/attendance-location-store");branches=await import("@/lib/mtm/attendance-branches-store");push=await import("@/app/api/v1/mtm/mobile/sync/push/route")
  await bypass(async()=>{for(const id of[ORG,OTHER]){await prisma.organization.create({data:{id,slug:id,name:"Fictional attendance tenant",plan:"enterprise",modules:{mtm:true,"route-field":true},features:["mtm"]}});await prisma.mtmSetting.create({data:{organizationId:id,key:"attendanceEnabled",value:true}})}await prisma.user.create({data:{id:ADMIN,organizationId:ORG,email:"admin@example.invalid",name:"Fictional administrator",role:"admin",passwordHash:"unusable-fixture"}})})
 },240000)
 afterAll(async()=>{await prisma?.$disconnect();if(createdDb)sql(adminUrl!,`DROP DATABASE "${scratch!.name}" WITH (FORCE)`);if(createdRole)sql(adminUrl!,`DROP ROLE "${scratch!.role}"`);if(schemaDir)rmSync(schemaDir,{recursive:true,force:true})})
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
  const at=new Date(Date.now()+1000),op=operation("START",randomUUID(),at,packet(at))
  expect((await send(op)).body.results).toMatchObject([{status:"ok"}]);expect((await send(op)).body.results).toMatchObject([{status:"ok"}])
  const rows=await evidence();expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({installationId:INSTALLATION,locationState:"INSIDE",latitude:40.4,longitude:49.85,distanceMeters:0,branchRevisionId,consentId:results[0].consent.id,fixAgeSeconds:0,isMock:false})
  expect(rows[0].claimedAt).toEqual(at);expect(rows[0].serverReceivedAt).toBeInstanceOf(Date)
  await tenant(ORG,async()=>{expect(await prisma.mtmAgentWorkdayEvent.findUnique({where:{id:rows[0].eventId},select:{latitude:true,longitude:true,accuracy:true}})).toEqual({latitude:null,longitude:null,accuracy:null})})
  const before=rows[0].branchRevisionId
  const edited=await tenant(ORG,()=>branches.saveAttendanceBranch(admin,{requestId:randomUUID(),branchId,expectedRevisionId:branchRevisionId,name:"Moved fictional branch",address:"Demo Road 24",latitude:41,longitude:50,radiusMeters:150,active:true}));branchRevisionId=edited.branch.revisionId
  expect((await evidence())[0].branchRevisionId).toBe(before)
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
})
