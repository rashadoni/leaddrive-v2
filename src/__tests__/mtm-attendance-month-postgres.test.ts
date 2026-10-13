/** Immutable month closes over real canonical facts, RLS and the shipped SQL. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest"
const adminUrl=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if(!adminUrl&&process.env.MTM_ATTENDANCE_DB_GATE==="required")throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch=vi.hoisted(()=>{const admin=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL;if(!admin)return null;const name=`mtm_month_${process.pid}_${Date.now()}`,role=`${name}_app`,url=new URL(admin);url.pathname=`/${name}`;const app=new URL(url);app.username=role;app.password="month-fixture-only";process.env.DATABASE_URL=app.toString();return{name,role,adminDb:url.toString()}})
const cli=createRequire(import.meta.url).resolve("prisma/build/index.js")
function sql(url:string,statement:string){const r=spawnSync(process.execPath,[cli,"db","execute","--url",url,"--stdin"],{input:statement,encoding:"utf8",timeout:180000,maxBuffer:1024*1024});if(r.status!==0)throw new Error(`Month fixture SQL failed: ${String(r.stderr||r.stdout).replace(/postgres(?:ql)?:\/\/[^\s]+/g,"[test database]")}`)}
const ORG="month-fixture-a",OTHER="month-fixture-b",ADMIN="month-fixture-admin",HR="month-fixture-hr",MANAGER="month-fixture-manager",TEAM="month-fixture-team"
const reviewer={organizationId:ORG,userId:ADMIN,principalType:"session" as const},month="2026-09"
const at=(date:string,time:string)=>new Date(`${date}T${time}:00+04:00`)
;(adminUrl?describe:describe.skip)("closed month on restricted PostgreSQL",()=>{
 let prisma:typeof import("@/lib/prisma").prisma,tenant:typeof import("@/lib/rls-context").runWithTenant,bypass:typeof import("@/lib/rls-context").runWithRlsBypass
 let store:typeof import("@/lib/mtm/attendance-month-store"),requests:typeof import("@/lib/mtm/attendance-request-store"),decisions:typeof import("@/lib/mtm/attendance-request-decision"),workday:typeof import("@/lib/mtm/workday")
 let createdDb=false,createdRole=false,directory:string|undefined
 const run=<T,>(fn:()=>Promise<T>)=>tenant(ORG,fn)
 async function employee(){return run(()=>prisma.mtmAgent.create({data:{organizationId:ORG,name:"Fictional month employee",role:"AGENT",teamId:TEAM}})).then(row=>row.id)}
 async function preview(ids:string[]){return run(()=>store.previewAttendanceMonth(reviewer,{month,agentIds:ids},"ru"))}
 async function command(ids:string[]){const p=await preview(ids);return{month,agentIds:ids,requestId:randomUUID(),preview:{hash:p.hash,asOf:p.asOf}}}
 const count=()=>run(()=>prisma.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM mtm_attendance_month_closes`).then(rows=>rows[0].count)
 async function seed(id:string,date="2026-09-28"){return run(async()=>{const day=await prisma.mtmAgentWorkday.create({data:{organizationId:ORG,agentId:id,workDate:new Date(`${date}T00:00:00Z`),status:"COMPLETED",startedAt:at(date,"09:10"),completedAt:at(date,"18:00"),totalPausedSeconds:0}});await prisma.mtmAgentWorkdayEvent.createMany({data:(["START","FINISH"] as const).map(type=>({organizationId:ORG,agentId:id,workdayId:day.id,clientEventId:randomUUID(),type,occurredAt:type==="START"?day.startedAt:day.completedAt!,appliedAt:type==="START"?day.startedAt:day.completedAt!,claimedAt:type==="START"?day.startedAt:day.completedAt!,serverReceivedAt:type==="START"?day.startedAt:day.completedAt!}))});return day})}
 async function correction(id:string,date="2026-09-28"){const {request}=await run(()=>requests.submitAttendanceRequest({organizationId:ORG,agentId:id,role:"AGENT"},{clientRequestId:randomUUID(),kind:"TIME_CORRECTION",unit:"HOURS",startDate:date,endDate:date,startTime:"09:00",endTime:"18:00",reason:"PRIVATE_MONTH_REASON"}));return run(()=>decisions.decideAttendanceRequest(reviewer,request.id,{decision:"APPROVED",version:request.version,note:"PRIVATE_DECISION_REASON"}))}
 async function waitForLock(fragment:string){for(let i=0;i<40;i++){const rows=await run(()=>prisma.$queryRaw<{waiting:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=current_user AND wait_event_type='Lock' AND query LIKE ${`%${fragment}%`}) AS waiting`);if(rows[0].waiting)return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error("Expected actual database lock wait was not observed")}
 beforeAll(async()=>{
  sql(adminUrl!,`CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'month-fixture-only' NOSUPERUSER NOBYPASSRLS`);createdRole=true;sql(adminUrl!,`CREATE DATABASE "${scratch!.name}"`);createdDb=true
  directory=mkdtempSync(join(tmpdir(),"mtm-month-schema-"));const schema=join(directory,"schema.prisma");writeFileSync(schema,readFileSync("prisma/schema.prisma","utf8").split("\n").filter(line=>!/Unsupported\("vector/.test(line)).join("\n"))
  const pushed=spawnSync(process.execPath,[cli,"db","push","--schema",schema,"--skip-generate"],{env:{...process.env,DATABASE_URL:scratch!.adminDb},encoding:"utf8",timeout:180000,maxBuffer:1024*1024});if(pushed.status!==0)throw new Error("Month fixture schema push failed")
  sql(scratch!.adminDb,'DROP TABLE mtm_attendance_month_days; DROP TABLE mtm_attendance_month_members; DROP TABLE mtm_attendance_month_closes; DROP TABLE mtm_attendance_shift_members; DROP TABLE mtm_attendance_shift_plans; DROP TABLE mtm_attendance_attachments; ALTER TABLE mtm_hrm_requests DROP COLUMN "attendanceDetails"; ALTER TABLE workforce_time_corrections DROP COLUMN "requestHash";')
  for(const name of ["20260806120000_mtm_rls_coverage_completion","20260806160000_mtm_rls_bypass_clause_normalization","20261013040000_mtm_attendance_requests"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${name}/migration.sql`,"utf8"))
  const foundation=readFileSync("prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql","utf8");sql(scratch!.adminDb,foundation.slice(foundation.indexOf("-- Tenant data ships fail-closed."),foundation.indexOf("-- A migration runner may own new tables")))
  for(const name of ["20260828224500_workforce_h3_legacy_fact_guard","20260828230000_workforce_direct_correction_contract","20261013050000_mtm_attendance_corrections","20261013190000_mtm_attendance_month_close","20261013200000_mtm_attendance_shift_plans","20261013201000_mtm_attendance_month_shift_fence"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${name}/migration.sql`,"utf8"))
  sql(scratch!.adminDb,readFileSync("scripts/rls/enable-batch-5.sql","utf8"));sql(scratch!.adminDb,`GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
  prisma=(await import("@/lib/prisma")).prisma;({runWithTenant:tenant,runWithRlsBypass:bypass}=await import("@/lib/rls-context"));store=await import("@/lib/mtm/attendance-month-store");requests=await import("@/lib/mtm/attendance-request-store");decisions=await import("@/lib/mtm/attendance-request-decision");workday=await import("@/lib/mtm/workday")
  await bypass(async()=>{for(const id of [ORG,OTHER]){await prisma.organization.create({data:{id,slug:id,name:"Fictional month company",plan:"enterprise",modules:{mtm:true,"route-field":true},features:["mtm"]}});await prisma.mtmSetting.create({data:{organizationId:id,key:"attendanceEnabled",value:true}})}
   for(const [id,role] of [[ADMIN,"admin"],[HR,"manager"],[MANAGER,"manager"]])await prisma.user.create({data:{id,organizationId:ORG,name:"Fictional month reviewer",email:`${id}@example.invalid`,role,passwordHash:"unusable",mtmAttendanceAll:id===HR}})
   await prisma.mtmTeam.create({data:{id:TEAM,organizationId:ORG,name:"Fictional month team"}});await prisma.mtmAgent.create({data:{organizationId:ORG,name:"Fictional supervisor",role:"SUPERVISOR",userId:MANAGER,teamId:TEAM}})
  })
 },240000)
 afterAll(async()=>{await prisma?.$disconnect();if(createdDb)sql(adminUrl!,`DROP DATABASE "${scratch!.name}" WITH(FORCE)`);if(createdRole)sql(adminUrl!,`DROP ROLE "${scratch!.role}"`);if(directory)rmSync(directory,{recursive:true,force:true})})
 it("closes the exact preview once and exports unchanged stored cells after ledger corrections and renaming",async()=>{
  const id=await employee();await seed(id);const input=await command([id]),p=await preview([id]),closed=await run(()=>store.closeAttendanceMonth(reviewer,input));expect(closed.idempotent).toBe(false)
  expect(await run(()=>store.closeAttendanceMonth(reviewer,input))).toMatchObject({id:closed.id,idempotent:true})
  await expect(run(()=>store.closeAttendanceMonth(reviewer,{...input,preview:{...input.preview,hash:"b".repeat(64)}}))).rejects.toMatchObject({code:"MTM_ATTENDANCE_MONTH_REPLAY_MISMATCH"})
  const before=await run(()=>store.readAttendanceMonthTable(reviewer,closed.id,"ru"));expect(before.table.rows).toEqual(p.table.rows)
  const {returnOwnMtmWorkday}=await import("@/lib/mtm/workday-return")
  const day=await run(()=>prisma.mtmAgentWorkday.findFirstOrThrow({where:{organizationId:ORG,agentId:id}}))
  expect(await run(()=>returnOwnMtmWorkday({organizationId:ORG,agentId:id,workdayId:day.id,operationId:randomUUID(),now:at("2026-09-28","18:10")}))).toMatchObject({kind:"conflict",code:"MTM_WORKDAY_RETURN_LOCKED"})
  await correction(id);await run(()=>prisma.mtmAgent.update({where:{id},data:{name:"Renamed after closure"}}))
  expect(await run(()=>store.readAttendanceMonthTable(reviewer,closed.id,"ru"))).toEqual(before)
  const detail=await run(()=>store.readAttendanceMonth(reviewer,closed.id,"ru"));expect(detail.corrections).toHaveLength(1);expect(JSON.stringify(detail)).not.toMatch(/PRIVATE_|latitude|longitude|pauseIntervals/)
  expect(detail.corrections[0].before?.startedAt).toBe(at("2026-09-28","09:10").toISOString());expect(detail.corrections[0].after.startedAt).toBe(at("2026-09-28","09:00").toISOString())
  const {buildAttendanceXlsx,buildAttendancePdf}=await import("@/lib/mtm/attendance-export");expect(buildAttendanceXlsx(before.table).worksheets[0].getRow(2).getCell(1).value).toBe("Fictional month employee");expect(buildAttendancePdf(before.table).subarray(0,4).toString()).toBe("%PDF")
 })
 it("refuses raw missing-day insertion/events but permits the existing approved genesis correction",async()=>{
  const id=await employee(),closed=await command([id]).then(input=>run(()=>store.closeAttendanceMonth(reviewer,input)))
  await expect(run(()=>prisma.mtmAgentWorkday.create({data:{organizationId:ORG,agentId:id,workDate:new Date("2026-09-28"),status:"STARTED",startedAt:at("2026-09-28","09:00")}}))).rejects.toThrow(/MTM_ATTENDANCE_MONTH_CLOSED/)
  const result=await correction(id);expect(result.request.status).toBe("APPROVED")
  const day=await run(()=>prisma.mtmAgentWorkday.findFirstOrThrow({where:{organizationId:ORG,agentId:id,workDate:new Date("2026-09-28")}}))
  await expect(run(()=>prisma.mtmAgentWorkdayEvent.create({data:{organizationId:ORG,agentId:id,workdayId:day.id,clientEventId:randomUUID(),type:"START",occurredAt:day.startedAt}}))).rejects.toThrow(/MTM_ATTENDANCE_MONTH_CLOSED/)
  expect((await run(()=>store.readAttendanceMonth(reviewer,closed.id,"en"))).corrections).toHaveLength(1)
 })
 it("keeps the snapshot tenant isolated/append only and refreshes HR, manager and feature authority",async()=>{
  const id=await employee(),input=await command([id]),closed=await run(()=>store.closeAttendanceMonth(reviewer,input))
  expect(await tenant(OTHER,()=>prisma.$queryRaw`SELECT id FROM mtm_attendance_month_closes WHERE id=${closed.id}`)).toEqual([])
  expect(await run(()=>prisma.$executeRaw`UPDATE mtm_attendance_month_closes SET "createdByName"='altered' WHERE id=${closed.id}`)).toBe(0)
  expect(()=>sql(scratch!.adminDb,`UPDATE mtm_attendance_month_closes SET "createdByName"='altered' WHERE id='${closed.id}'`)).toThrow(/IMMUTABLE/)
  await expect(run(()=>store.readAttendanceMonthTable({...reviewer,userId:HR},closed.id,"en"))).resolves.toHaveProperty("table")
  await expect(run(()=>store.previewAttendanceMonth({...reviewer,userId:HR},{month,agentIds:[id]},"en"))).rejects.toMatchObject({status:403})
  await expect(run(()=>store.readAttendanceMonthTable({...reviewer,principalType:"api_key"},closed.id,"en"))).rejects.toMatchObject({status:403})
  await expect(run(()=>store.readAttendanceMonthTable({...reviewer,userId:MANAGER},closed.id,"en"))).resolves.toHaveProperty("table")
  await run(()=>prisma.mtmAgent.update({where:{id},data:{teamId:null}}));await expect(run(()=>store.readAttendanceMonthTable({...reviewer,userId:MANAGER},closed.id,"en"))).rejects.toMatchObject({status:403})
  await run(()=>prisma.user.update({where:{id:HR},data:{mtmAttendanceAll:false}}));await expect(run(()=>store.readAttendanceMonthTable({...reviewer,userId:HR},closed.id,"en"))).rejects.toMatchObject({status:403})
  await run(()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:false}}));await expect(run(()=>store.readAttendanceMonthTable(reviewer,closed.id,"en"))).rejects.toMatchObject({status:404});await run(()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:true}}))
 })
 it("does not leave a snapshot or coverage rows behind if atomic audit fails",async()=>{
  const id=await employee(),input=await command([id]),before=await count()
  sql(scratch!.adminDb,"CREATE FUNCTION month_fixture_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MTM_ATTENDANCE_MONTH_CLOSED' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER month_fixture_audit_fail BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION month_fixture_audit_fail()")
  await expect(run(()=>store.closeAttendanceMonth(reviewer,input))).rejects.toThrow();expect(await count()).toBe(before)
  sql(scratch!.adminDb,"DROP TRIGGER month_fixture_audit_fail ON mtm_audit_logs; DROP FUNCTION month_fixture_audit_fail()")
  expect((await run(()=>store.closeAttendanceMonth(reviewer,input))).idempotent).toBe(false)
 })
 it("deduplicates competing closes and rejects a preview changed while waiting for a canonical writer",async()=>{
  const id=await employee(),input=await command([id]),results=await Promise.all([0,1].map(()=>run(()=>store.closeAttendanceMonth(reviewer,input))));expect(results.map(r=>r.idempotent).sort()).toEqual([false,true])
  const next=await employee(),stale=await command([next]);let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r)
  const writer=run(()=>prisma.$transaction(async tx=>{await workday.lockMtmWorkdayTransitions(tx,{organizationId:ORG,agentId:next});await tx.mtmAgentWorkday.create({data:{organizationId:ORG,agentId:next,workDate:new Date("2026-09-27"),status:"STARTED",startedAt:at("2026-09-27","09:00")}});entered();await hold},{timeout:15000}));await ready
  const closing=run(()=>store.closeAttendanceMonth(reviewer,stale));const rejected=expect(closing).rejects.toMatchObject({code:"MTM_ATTENDANCE_MONTH_CHANGED"});try{await waitForLock("pg_advisory_xact_lock")}finally{release()}await writer;await rejected
 })
 it("protects the previous month source day included by an overnight END_DAY shift",async()=>{
  const id=await employee(),planId=randomUUID(),date="2026-08-31",value={from:date,to:"2026-09-30",timezone:"Asia/Baku",attribution:"END_DAY",preHolidayMinutes:null,preHolidayConfirmed:false,overtimeThresholdMinutes:null,cycle:[{kind:"WORK",startTime:"22:00",endTime:"06:00",nextDay:true,lunchMinutes:0,lateGraceMinutes:0}]}
  await run(()=>prisma.$transaction(async tx=>{
   await tx.$executeRaw`INSERT INTO mtm_attendance_shift_plans(id,"organizationId",version,"requestId","requestHash",value,reason,"createdBy") VALUES(${planId},${ORG},1,${randomUUID()},${"a".repeat(64)},${JSON.stringify(value)}::jsonb,'Fictional historical fixture',${ADMIN})`
   await tx.$executeRaw`INSERT INTO mtm_attendance_shift_members(id,"organizationId","planId","agentId") VALUES(${randomUUID()},${ORG},${planId},${id})`
  }))
  const day=await run(async()=>{const day=await prisma.mtmAgentWorkday.create({data:{organizationId:ORG,agentId:id,workDate:new Date(date),status:"COMPLETED",startedAt:at(date,"22:00"),completedAt:at("2026-09-01","06:00"),totalPausedSeconds:0}});await prisma.mtmAgentWorkdayEvent.createMany({data:(["START","FINISH"] as const).map(type=>({organizationId:ORG,agentId:id,workdayId:day.id,type,clientEventId:randomUUID(),occurredAt:type==="START"?day.startedAt:day.completedAt!,appliedAt:type==="START"?day.startedAt:day.completedAt!,claimedAt:type==="START"?day.startedAt:day.completedAt!,serverReceivedAt:type==="START"?day.startedAt:day.completedAt!}))});return day})
  const input=await command([id]),closed=await run(()=>store.closeAttendanceMonth(reviewer,input))
  const covered=await run(()=>prisma.$queryRaw<{sourceDate:Date}[]>`SELECT "sourceDate" FROM mtm_attendance_month_days WHERE "organizationId"=${ORG} AND "closeId"=${closed.id} ORDER BY "sourceDate"`)
  expect(covered[0].sourceDate.toISOString().slice(0,10)).toBe(date)
  const saved=await run(()=>store.readAttendanceMonthTable(reviewer,closed.id,"en"));expect(JSON.stringify(saved.table.rows)).toContain("8:00")
  await expect(run(()=>prisma.mtmAgentWorkdayEvent.create({data:{organizationId:ORG,agentId:id,workdayId:day.id,type:"FINISH",clientEventId:randomUUID(),occurredAt:day.completedAt!}}))).rejects.toThrow(/MTM_ATTENDANCE_MONTH_CLOSED/)
 })
 it("waits for an approved correction and rejects the stale preview without deadlock",async()=>{
  const id=await employee();await seed(id)
  const {request}=await run(()=>requests.submitAttendanceRequest({organizationId:ORG,agentId:id,role:"AGENT"},{clientRequestId:randomUUID(),kind:"TIME_CORRECTION",unit:"HOURS",startDate:"2026-09-28",endDate:"2026-09-28",startTime:"09:00",endTime:"18:00",reason:"Fictional concurrent correction"})),input=await command([id])
  let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r)
  const writer=run(()=>prisma.$transaction(async tx=>{await decisions.decideAttendanceRequestInTransaction(tx,reviewer,request.id,{decision:"APPROVED",version:request.version,note:null});entered();await hold},{timeout:15000}));await ready
  const closing=run(()=>store.closeAttendanceMonth(reviewer,input)),rejected=expect(closing).rejects.toMatchObject({code:"MTM_ATTENDANCE_MONTH_CHANGED"});try{await waitForLock("pg_advisory_xact_lock")}finally{release()}await writer;await rejected
 })
 it.each(["feature","agent"])("waits for a concurrent %s update without reversing fence/row lock order",async target=>{
  const id=await employee(),input=await command([id]);let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r)
  const writer=run(()=>prisma.$transaction(async tx=>{if(target==="feature")await tx.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:false}});else await tx.mtmAgent.update({where:{id},data:{name:"Changed before close"}});entered();await hold},{timeout:15000}));await ready
  const closing=run(()=>store.closeAttendanceMonth(reviewer,input));const rejection=expect(closing).rejects.toMatchObject(target==="feature"?{status:404}:{code:"MTM_ATTENDANCE_MONTH_CHANGED"});try{await waitForLock(target==="feature"?"mtm_settings":"mtm_agents")}finally{release()}await writer;await rejection
  if(target==="feature")await run(()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:true}}))
 })
})
