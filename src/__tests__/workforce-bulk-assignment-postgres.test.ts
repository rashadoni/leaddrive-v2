import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { publishWorkforceShiftAssignments, scheduleWorkforceShiftAssignment } from "@/lib/workforce/configuration-management"
import { publishWorkforceSiteAssignments, scheduleWorkforceSiteAssignment } from "@/lib/workforce/site-management"
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition"

const adminUrl=process.env.WF_BULK_ADMIN_TEST_URL
const appUrl=process.env.WF_BULK_APP_TEST_URL
const definition={startTime:"09:00",endTime:"18:00",timezone:"Asia/Baku",daysOfWeek:[1,2,3,4,5]}
const day=(s:string)=>new Date(`${s}T00:00:00.000Z`)
describe.skipIf(!adminUrl||!appUrl)("C7 bulk writers with real PostgreSQL, current migration triggers and FORCE RLS",()=>{
 let admin:PrismaClient;let db:PrismaClient;let peer:PrismaClient;let unscoped:PrismaClient;let org:string;let user:string;let agents:string[];let templates:string[];let sites:string[]
 const clients:PrismaClient[]=[]
 async function client(scope?:string){const u=new URL(appUrl!);u.searchParams.set("connection_limit","1");const c=new PrismaClient({datasourceUrl:u.toString()});clients.push(c);if(scope)await c.$executeRaw`SELECT set_config('app.org_id',${scope},false)`;return c}
 beforeAll(async()=>{for(const raw of [adminUrl!,appUrl!]){const u=new URL(raw);if(u.hostname!=="127.0.0.1"||u.pathname!=="/workforce_bulk_browser")throw new Error("BULK_TEST_TARGET_NOT_ISOLATED")};admin=new PrismaClient({datasourceUrl:adminUrl})})
 beforeEach(async()=>{
  org=`c7-${randomUUID()}`;user=`${org}-user`;agents=[`${org}-a`,`${org}-b`];templates=[`${org}-old`,`${org}-new`];sites=[`${org}-p0`,`${org}-p1`]
  await admin.organization.create({data:{id:org,name:"Synthetic bulk tenant",slug:org,features:["workforce-hrm"]}})
  await admin.user.create({data:{id:user,organizationId:org,name:"Synthetic admin",email:`${org}@example.invalid`,passwordHash:"not-a-login-hash",role:"admin"}})
  for(const id of agents)await admin.mtmAgent.create({data:{id,organizationId:org,name:"Synthetic employee"}})
  for(const id of templates)await admin.workforceShiftTemplate.create({data:{id,organizationId:org,code:id,name:"Synthetic shift",version:1,status:"ACTIVE",timezone:"Asia/Baku",definition,definitionHash:workforceShiftDefinitionHash(definition),createdByUserId:user}})
  for(const id of sites)await admin.workforceSite.create({data:{id,organizationId:org,code:id,name:"Synthetic site",type:"OFFICE",timezone:"Asia/Baku",createdByUserId:user}})
  db=await client(org);peer=await client(org);unscoped=await client()
 })
 afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.$disconnect()))})
 afterAll(async()=>{await admin?.$disconnect()})
 const audit=()=>({actorUserId:user})
 const base=()=>({organizationId:org,publishedByUserId:user,currentDateKey:"2027-01-01",audit:audit(),db})
 async function publish(kind:string,options:{operationId?:string;currentDateKey?:string;agentIds?:string[];actor?:string;client?:PrismaClient;target?:string}={}){
  const input={...base(),db:options.client??db,currentDateKey:options.currentDateKey??"2027-01-01",publishedByUserId:options.actor??user}
  if(kind==="shift")return publishWorkforceShiftAssignments({...input,publish:{operationId:options.operationId??randomUUID(),agentIds:options.agentIds??agents,templateId:options.target??templates[1],effectiveFrom:"2027-01-03"}})
  return publishWorkforceSiteAssignments({...input,publish:{operationId:options.operationId??randomUUID(),agentIds:options.agentIds??agents,siteId:options.target??sites[1],kind:"PRIMARY",effectiveFrom:"2027-01-03",effectiveTo:null}})
 }
 async function counts(kind:string){return {assignments:await (kind==="shift"?admin.workforceShiftAssignment.count({where:{organizationId:org}}):admin.workforceSiteAssignment.count({where:{organizationId:org}})),receipts:await (kind==="shift"?admin.workforceShiftAssignmentBulkOperation.count({where:{organizationId:org}}):admin.workforceSiteAssignmentBulkOperation.count({where:{organizationId:org}})),audits:await admin.mtmAuditLog.count({where:{organizationId:org}})}}
 async function predecessors(kind:string){for(const agentId of agents){if(kind==="shift")await admin.workforceShiftAssignment.create({data:{organizationId:org,agentId,templateId:templates[0],effectiveFrom:day("2026-12-01"),assignedByUserId:user}});else await admin.workforceSiteAssignment.create({data:{organizationId:org,agentId,siteId:sites[0],kind:"PRIMARY",effectiveFrom:day("2026-12-01"),assignedByUserId:user}})}}
 for(const kind of ["shift","site"]){
  it(`${kind}: real app role cannot bypass RLS; unscoped/other tenant see no selected employees`,async()=>{const [r]=await db.$queryRaw<{rolsuper:boolean;rolbypassrls:boolean}[]>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;expect(r).toEqual({rolsuper:false,rolbypassrls:false});expect(await db.mtmAgent.count({where:{organizationId:org}})).toBe(2);expect(await unscoped.mtmAgent.count({where:{organizationId:org}})).toBe(0);const foreign=await client(`${org}-other`);expect(await foreign.mtmAgent.count({where:{organizationId:org}})).toBe(0);await expect(publish(kind,{client:foreign})).rejects.toThrow();expect(await counts(kind)).toEqual({assignments:0,receipts:0,audits:0})})
  it(`${kind}: atomically closes both predecessors and writes one aggregate receipt/audit`,async()=>{await predecessors(kind);expect(await publish(kind)).toMatchObject({createdCount:2,unchangedCount:0,idempotent:false});expect(await counts(kind)).toEqual({assignments:4,receipts:1,audits:1});const table=kind==="shift"?'workforce_shift_assignments':'workforce_site_assignments';const rows=await admin.$queryRawUnsafe<{effectiveTo:Date|null}[]>(`SELECT "effectiveTo" FROM ${table} WHERE "organizationId"=$1 ORDER BY "effectiveFrom"`,org);expect(rows.slice(0,2).map(r=>r.effectiveTo?.toISOString().slice(0,10))).toEqual(["2027-01-02","2027-01-02"]);const auditRow=await admin.mtmAuditLog.findFirstOrThrow({where:{organizationId:org}});expect(JSON.stringify(auditRow.newData)).not.toContain(agents[0]);expect(await admin.mtmAgentWorkday.count({where:{organizationId:org}})).toBe(0);expect(await admin.mtmRoute.count({where:{organizationId:org}})).toBe(0)})
  it(`${kind}: concurrent exact keys write once and replay after effective-date rollover`,async()=>{const operationId=randomUUID();const results=await Promise.all([publish(kind,{operationId}),publish(kind,{operationId,client:peer})]);expect(results.map(r=>r.idempotent).sort()).toEqual([false,true]);expect(await publish(kind,{operationId,currentDateKey:"2027-01-04"})).toMatchObject({createdCount:2,idempotent:true});expect(await counts(kind)).toEqual({assignments:2,receipts:1,audits:1});await expect(publish(kind,{currentDateKey:"2027-01-04"})).rejects.toThrow();expect(await counts(kind)).toEqual({assignments:2,receipts:1,audits:1})})
  it(`${kind}: the full approved 200-person boundary publishes atomically`,async()=>{
   const many=Array.from({length:198},(_,i)=>`${org}-extra-${String(i).padStart(3,"0")}`);await admin.mtmAgent.createMany({data:many.map(id=>({id,organizationId:org,name:"Synthetic bulk employee"}))});agents=[...agents,...many]
   await expect(publish(kind)).resolves.toMatchObject({createdCount:200,unchangedCount:0,idempotent:false});expect(await counts(kind)).toEqual({assignments:200,receipts:1,audits:1})
  })
  it(`${kind}: changed body or actor cannot reuse an existing key`,async()=>{const operationId=randomUUID();await publish(kind,{operationId});await expect(publish(kind,{operationId,agentIds:[agents[0]]})).rejects.toThrow(/operationId/);await expect(publish(kind,{operationId,actor:`${org}-other`})).rejects.toThrow(/operationId/);expect(await counts(kind)).toEqual({assignments:2,receipts:1,audits:1})})
  it(`${kind}: unavailable employee rejects entire selection before any assignment/audit`,async()=>{await admin.mtmAgent.update({where:{id:agents[1]},data:{status:"INACTIVE"}});await expect(publish(kind)).rejects.toThrow(/reviewed again/);expect(await counts(kind)).toEqual({assignments:0,receipts:0,audits:0})})
  it(`${kind}: competing different targets serialize and one fails the refreshed conflict preview`,async()=>{const results=await Promise.allSettled([publish(kind),publish(kind,{client:peer,target:kind==="shift"?templates[0]:sites[0]})]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);expect(await counts(kind)).toEqual({assignments:2,receipts:1,audits:1})})
  it(`${kind}: audit failure rolls back all predecessor changes, assignments and receipt`,async()=>{await predecessors(kind);await admin.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION c7_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = '${org}' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$`);await admin.$executeRawUnsafe('CREATE TRIGGER c7_fail_audit BEFORE INSERT ON mtm_audit_logs FOR EACH ROW EXECUTE FUNCTION c7_fail_audit()');try{await expect(publish(kind)).rejects.toThrow();expect(await counts(kind)).toEqual({assignments:2,receipts:0,audits:0});const table=kind==="shift"?'workforce_shift_assignments':'workforce_site_assignments';const r=await admin.$queryRawUnsafe<{n:number}[]>(`SELECT count(*)::int n FROM ${table} WHERE "organizationId"=$1 AND "effectiveTo" IS NOT NULL`,org);expect(r[0].n).toBe(0)}finally{await admin.$executeRawUnsafe('DROP TRIGGER c7_fail_audit ON mtm_audit_logs')}})
  it(`${kind}: an individual write and bulk publication share employee locks`,async()=>{
   const individual=kind==="shift"?scheduleWorkforceShiftAssignment({organizationId:org,currentDateKey:"2027-01-01",audit:audit(),db:peer,assignment:{agentId:agents[0],templateId:templates[0],effectiveFrom:"2027-01-03"}}):scheduleWorkforceSiteAssignment({organizationId:org,assignedByUserId:user,currentDateKey:"2027-01-01",audit:audit(),db:peer,assignment:{agentId:agents[0],siteId:sites[0],kind:"PRIMARY",effectiveFrom:"2027-01-03",effectiveTo:null}})
   const results=await Promise.allSettled([individual,publish(kind)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1)
   const c=await counts(kind);expect([1,2]).toContain(c.assignments);expect(c.audits).toBe(1);expect(c.receipts).toBe(c.assignments===2?1:0)
  })
  it(`${kind}: receipt insert failure rolls back the entire transaction`,async()=>{
   const table=kind==="shift"?'workforce_shift_assignment_bulk_operations':'workforce_site_assignment_bulk_operations'
   await admin.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION c7_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId" = '${org}' THEN RAISE EXCEPTION 'synthetic receipt fault'; END IF; RETURN NEW; END $$`)
   await admin.$executeRawUnsafe(`CREATE TRIGGER c7_fail_receipt BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION c7_fail_receipt()`)
   try{await expect(publish(kind)).rejects.toThrow();expect(await counts(kind)).toEqual({assignments:0,receipts:0,audits:0})}finally{await admin.$executeRawUnsafe(`DROP TRIGGER c7_fail_receipt ON ${table}`)}
  })
  it(`${kind}: real receipt immutability refuses direct UPDATE`,async()=>{await publish(kind);const table=kind==="shift"?'workforce_shift_assignment_bulk_operations':'workforce_site_assignment_bulk_operations';await expect(db.$executeRawUnsafe(`UPDATE ${table} SET "createdCount"=0 WHERE "organizationId"=$1`,org)).rejects.toThrow(/append-only/);expect(await counts(kind)).toEqual({assignments:2,receipts:1,audits:1})})
 }
 async function snapshot(when="2026-12-15") {
  const assignment=await admin.workforceShiftAssignment.findFirstOrThrow({where:{organizationId:org,agentId:agents[0]}})
  const workday=await admin.mtmAgentWorkday.create({data:{organizationId:org,agentId:agents[0],workDate:day(when),startedAt:day(when)}})
  return admin.workforceShiftSnapshot.create({data:{organizationId:org,agentId:agents[0],templateId:templates[0],assignmentId:assignment.id,workdayId:workday.id,workDate:day(when),templateVersion:1,timezone:"Asia/Baku",definition,definitionHash:workforceShiftDefinitionHash(definition),plannedStartAt:day(when),plannedEndAt:new Date(day(when).getTime()+9*3600_000)}})
 }
 it("shift: a used predecessor may close after its pinned workday without rewriting the snapshot",async()=>{await predecessors("shift");const before=await snapshot();await publish("shift");expect(await admin.workforceShiftSnapshot.findUnique({where:{id:before.id}})).toEqual(before)})
 it("shift: narrowing that excludes a future snapshot rejects the entire bulk operation",async()=>{await predecessors("shift");const before=await snapshot("2027-01-04");await expect(publish("shift")).rejects.toThrow();expect(await counts("shift")).toEqual({assignments:2,receipts:0,audits:0});expect(await admin.workforceShiftSnapshot.findUnique({where:{id:before.id}})).toEqual(before)})
 it("shift: transfer to another team preserves the old pinned assignment while publishing the new team",async()=>{
  const oldTeam=await admin.mtmTeam.create({data:{organizationId:org,name:"Old synthetic team"}});const newTeam=await admin.mtmTeam.create({data:{organizationId:org,name:"New synthetic team"}})
  await admin.mtmAgent.updateMany({where:{organizationId:org},data:{teamId:oldTeam.id}});await admin.workforceShiftTemplate.update({where:{id:templates[0]},data:{teamId:oldTeam.id}});await admin.workforceShiftTemplate.update({where:{id:templates[1]},data:{teamId:newTeam.id}})
  await predecessors("shift");const before=await snapshot();await admin.mtmAgent.updateMany({where:{organizationId:org},data:{teamId:newTeam.id}})
  await expect(publish("shift")).resolves.toMatchObject({createdCount:2});expect(await admin.workforceShiftSnapshot.findUnique({where:{id:before.id}})).toEqual(before)
 })
 it("site: SECONDARY may coexist across sites; TEMPORARY remains bounded and overlaps fail closed",async()=>{
  for(const siteId of sites)await publishWorkforceSiteAssignments({...base(),publish:{operationId:randomUUID(),agentIds:agents,siteId,kind:"SECONDARY",effectiveFrom:"2027-01-03",effectiveTo:null}})
  await publishWorkforceSiteAssignments({...base(),publish:{operationId:randomUUID(),agentIds:agents,siteId:sites[0],kind:"TEMPORARY",effectiveFrom:"2027-01-03",effectiveTo:"2027-01-05"}})
  await expect(publishWorkforceSiteAssignments({...base(),publish:{operationId:randomUUID(),agentIds:agents,siteId:sites[0],kind:"TEMPORARY",effectiveFrom:"2027-01-04",effectiveTo:"2027-01-06"}})).rejects.toThrow(/reviewed again/)
  expect(await counts("site")).toEqual({assignments:6,receipts:3,audits:3})
 })

 it("shift: transferred historical narrowing does not authorize changing identity, extending or excluding captured days",async()=>{
  const oldTeam=await admin.mtmTeam.create({data:{organizationId:org,name:"Old synthetic team"}});const newTeam=await admin.mtmTeam.create({data:{organizationId:org,name:"New synthetic team"}})
  await admin.mtmAgent.updateMany({where:{organizationId:org},data:{teamId:oldTeam.id}});await admin.workforceShiftTemplate.update({where:{id:templates[0]},data:{teamId:oldTeam.id}})
  await predecessors("shift");const before=await snapshot();const where={id:before.assignmentId!}
  await admin.mtmAgent.updateMany({where:{organizationId:org},data:{teamId:newTeam.id}})
  await expect(admin.workforceShiftAssignment.update({where,data:{templateId:templates[1],effectiveTo:day("2027-01-02")}})).rejects.toThrow()
  await expect(admin.workforceShiftAssignment.update({where,data:{effectiveTo:day("2026-12-14")}})).rejects.toThrow()
  await admin.workforceShiftAssignment.update({where,data:{effectiveTo:day("2027-01-02")}})
  await expect(admin.workforceShiftAssignment.update({where,data:{effectiveTo:day("2027-01-03")}})).rejects.toThrow()
  await expect(admin.workforceShiftAssignment.update({where,data:{effectiveTo:null}})).rejects.toThrow()
  expect(await admin.workforceShiftSnapshot.findUnique({where:{id:before.id}})).toEqual(before)
 })
 for(const pinned of [false,true])it(`shift: transferred predecessor ID cannot change while narrowing (snapshot=${pinned})`,async()=>{
  const oldTeam=await admin.mtmTeam.create({data:{organizationId:org,name:"Old synthetic team"}});const newTeam=await admin.mtmTeam.create({data:{organizationId:org,name:"New synthetic team"}})
  await admin.mtmAgent.updateMany({where:{organizationId:org},data:{teamId:oldTeam.id}});await admin.workforceShiftTemplate.update({where:{id:templates[0]},data:{teamId:oldTeam.id}})
  await predecessors("shift");const before=pinned?await snapshot():null;const assignment=await admin.workforceShiftAssignment.findFirstOrThrow({where:{organizationId:org,agentId:agents[0]}})
  await admin.mtmAgent.updateMany({where:{organizationId:org},data:{teamId:newTeam.id}})
  await expect(admin.workforceShiftAssignment.update({where:{id:assignment.id},data:{id:randomUUID(),effectiveTo:day("2027-01-02")}})).rejects.toThrow(/template team must match/)
  expect(await admin.workforceShiftAssignment.findUnique({where:{id:assignment.id}})).toEqual(assignment)
  if(before)expect(await admin.workforceShiftSnapshot.findUnique({where:{id:before.id}})).toEqual(before)
 })
 it("real tenant-composite foreign keys reject cross-tenant assignment actors even via fixture owner",async()=>{
  const other=await admin.organization.create({data:{name:"Other synthetic",slug:randomUUID()}})
  const otherUser=await admin.user.create({data:{organizationId:other.id,name:"Other",email:`${randomUUID()}@example.invalid`,passwordHash:"not-a-login"}})
  await expect(admin.workforceShiftAssignment.create({data:{organizationId:org,agentId:agents[0],templateId:templates[0],effectiveFrom:day("2027-01-03"),assignedByUserId:otherUser.id}})).rejects.toThrow()
  await expect(admin.workforceSiteAssignment.create({data:{organizationId:org,agentId:agents[0],siteId:sites[0],kind:"PRIMARY",effectiveFrom:day("2027-01-03"),assignedByUserId:otherUser.id}})).rejects.toThrow()
  expect(await counts("shift")).toEqual({assignments:0,receipts:0,audits:0});expect(await counts("site")).toEqual({assignments:0,receipts:0,audits:0})
 })
})
