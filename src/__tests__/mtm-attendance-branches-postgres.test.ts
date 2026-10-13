/** Real migration, RLS and immutable history through the production MTM APIs. */
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterAll,beforeAll,describe,expect,it,vi } from "vitest"
const adminUrl=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL
if(!adminUrl&&process.env.MTM_ATTENDANCE_DB_GATE==="required")throw new Error("MTM_ATTENDANCE_TEST_DATABASE_URL is required")
const scratch=vi.hoisted(()=>{const admin=process.env.MTM_ATTENDANCE_TEST_DATABASE_URL;if(!admin)return null;const name=`mtm_branches_${process.pid}_${Date.now()}`,role=`${name}_app`;const db=new URL(admin);db.pathname=`/${name}`;const app=new URL(db);app.username=role;app.password="branch-fixture-only";process.env.DATABASE_URL=app.toString();return{name,role,adminDb:db.toString()}})
const caller=vi.hoisted(()=>({orgId:"branch-org-a",userId:"branch-admin",role:"admin",principalType:"session" as "session"|"api_key"}))
vi.mock("@/lib/api-auth",()=>({getOrgId:vi.fn(),getSession:vi.fn(),requireSessionAuth:vi.fn(),requireAuth:async()=>({...caller,email:"admin@example.test",name:"Fictional administrator"}),isAuthError:(value:unknown)=>value instanceof Response}))
vi.mock("@/lib/tenant-capability-access",async original=>({...await original<typeof import("@/lib/tenant-capability-access")>(),requireTenantCapabilityAccessResponse:async()=>null}))
function cli(args:string[],statement?:string){const result=spawnSync(process.execPath,[createRequire(import.meta.url).resolve("prisma/build/index.js"),...args],{input:statement,encoding:"utf8",timeout:180000,maxBuffer:1024*1024});if(result.status!==0)throw new Error(`Branch fixture failed: ${String(result.stderr||result.stdout||result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g,"[test database]")}`)}
const sql=(url:string,statement:string)=>cli(["db","execute","--url",url,"--stdin"],statement)
const ORG="branch-org-a",OTHER="branch-org-b"
const branchInput=()=>({requestId:randomUUID(),branchId:null as string|null,expectedRevisionId:null as string|null,name:"Fictional centre",address:"Demo Street 12",latitude:40.4,longitude:49.85,radiusMeters:150,active:true})
;(adminUrl?describe:describe.skip)("MTM branch history on PostgreSQL",()=>{
 let prisma:typeof import("@/lib/prisma").prisma,tenant:typeof import("@/lib/rls-context").runWithTenant,bypass:typeof import("@/lib/rls-context").runWithRlsBypass
 let branch:typeof import("@/app/api/v1/mtm/attendance/branches/route"),assignment:typeof import("@/app/api/v1/mtm/attendance/branches/assignments/route")
 let store:typeof import("@/lib/mtm/attendance-branches-store")
 let createdDb=false,createdRole=false
 const admin={organizationId:ORG,userId:"branch-admin",principalType:"session" as const}
 const post=(route:typeof branch.POST,body:unknown)=>route(new NextRequest("http://localhost/api/v1/mtm/attendance/branches",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),undefined)
 beforeAll(async()=>{
   sql(adminUrl!,`CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'branch-fixture-only' NOSUPERUSER NOBYPASSRLS`);createdRole=true
   sql(adminUrl!,`CREATE DATABASE "${scratch!.name}"`);createdDb=true
   const file=join(mkdtempSync(join(tmpdir(),"mtm-branches-schema-")),"schema.prisma");writeFileSync(file,readFileSync("prisma/schema.prisma","utf8").split("\n").filter(line=>!/Unsupported\("vector/.test(line)).join("\n"))
   const appUrl=process.env.DATABASE_URL!;try{process.env.DATABASE_URL=scratch!.adminDb;cli(["db","push","--schema",file,"--skip-generate"])}finally{process.env.DATABASE_URL=appUrl}
   sql(scratch!.adminDb,'DROP TABLE mtm_attendance_qr_evidence; DROP TABLE mtm_attendance_mark_evidence; DROP TABLE mtm_attendance_primary_branch_revisions; DROP TABLE mtm_attendance_branch_revisions; DROP TABLE mtm_attendance_branches;')
   for(const migration of["20260806120000_mtm_rls_coverage_completion","20260806160000_mtm_rls_bypass_clause_normalization","20261013070000_mtm_attendance_branches"])sql(scratch!.adminDb,readFileSync(`prisma/migrations/${migration}/migration.sql`,"utf8"))
   sql(scratch!.adminDb,readFileSync("scripts/rls/enable-batch-5.sql","utf8"));sql(scratch!.adminDb,`GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
   prisma=(await import("@/lib/prisma")).prisma;({runWithTenant:tenant,runWithRlsBypass:bypass}=await import("@/lib/rls-context"))
   branch=await import("@/app/api/v1/mtm/attendance/branches/route");assignment=await import("@/app/api/v1/mtm/attendance/branches/assignments/route");store=await import("@/lib/mtm/attendance-branches-store")
   await bypass(async()=>{
     for(const id of[ORG,OTHER]){await prisma.organization.create({data:{id,slug:id,name:`Fictional ${id}`,plan:"enterprise",modules:{mtm:true,"route-field":true},features:["mtm"]}});await prisma.mtmSetting.create({data:{organizationId:id,key:"attendanceEnabled",value:true}})}
     for(const [id,role,all] of[["branch-admin","admin",false],["branch-manager","manager",false],["branch-hr","manager",true]] as const)await prisma.user.create({data:{id,organizationId:ORG,email:`${id}@example.test`,name:id,role,passwordHash:"fixture-unusable",mtmAttendanceAll:all}})
     await prisma.mtmTeam.createMany({data:[{id:"branch-team-a",organizationId:ORG,name:"Fictional team A"},{id:"branch-team-b",organizationId:ORG,name:"Fictional team B"}]})
     await prisma.mtmAgent.createMany({data:[{id:"branch-manager-card",organizationId:ORG,name:"Fictional manager",role:"MANAGER",teamId:"branch-team-a",userId:"branch-manager"},{id:"branch-agent-a",organizationId:ORG,name:"Fictional employee A",role:"AGENT",teamId:"branch-team-a"},{id:"branch-agent-b",organizationId:ORG,name:"Fictional employee B",role:"AGENT",teamId:"branch-team-b"}]})
   })
 },180000)
 afterAll(async()=>{if(prisma)await prisma.$disconnect();if(createdDb)sql(adminUrl!,`DROP DATABASE "${scratch!.name}" WITH (FORCE)`);if(createdRole)sql(adminUrl!,`DROP ROLE "${scratch!.role}"`)},30000)
 it("creates through the guarded API, replays once, and keeps all renamed/archive versions",async()=>{
   const input=branchInput(),res=await post(branch.POST,input);expect(res.status).toBe(200);const first=(await res.json()).data.branch
   expect((await post(branch.POST,input)).status).toBe(200)
   expect((await post(branch.POST,{...input,name:"Changed replay"})).status).toBe(409)
   const update={...input,requestId:randomUUID(),branchId:first.id,expectedRevisionId:first.revisionId,name:"Fictional renamed",latitude:41,active:false}
   const second=(await (await post(branch.POST,update)).json()).data.branch
   expect(second.version).toBe(2);expect(second.active).toBe(false)
   await tenant(ORG,async()=>{
     const history=await prisma.$queryRaw<{name:string;latitude:number;active:boolean}[]>`SELECT name,latitude,active FROM mtm_attendance_branch_revisions WHERE "branchId"=${first.id} ORDER BY version`
     expect(history).toEqual([{name:input.name,latitude:40.4,active:true},{name:"Fictional renamed",latitude:41,active:false}])
     expect(await prisma.mtmAuditLog.count({where:{organizationId:ORG,entityId:first.id}})).toBe(2)
     await expect(prisma.$executeRaw`UPDATE mtm_attendance_branch_revisions SET name='rewrite' WHERE id=${first.revisionId}`).rejects.toThrow(/IMMUTABLE/)
     await expect(prisma.$executeRaw`DELETE FROM mtm_attendance_branches WHERE id=${first.id}`).rejects.toThrow(/IMMUTABLE/)
   })
   expect((await post(branch.POST,{...update,requestId:randomUUID(),name:"Stale overwrite"})).status).toBe(409)
 })
 it("serializes concurrent revisions, accepting exactly one expected version",async()=>{
   const input=branchInput(),first=await tenant(ORG,()=>store.saveAttendanceBranch(admin,input))
   const results=await Promise.allSettled([1,2].map(i=>tenant(ORG,()=>store.saveAttendanceBranch(admin,{...input,branchId:first.branch.id,expectedRevisionId:first.branch.revisionId,requestId:randomUUID(),name:`Concurrent ${i}`}))))
   expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1)
   expect(results.filter(result=>result.status==="rejected")).toHaveLength(1)
 })
 it("scope permits a manager's employee assignment but refuses another team, self and registry writes",async()=>{
   const first=await tenant(ORG,()=>store.saveAttendanceBranch(admin,branchInput()))
   caller.userId="branch-manager";caller.role="manager"
   try{
     const res=await assignment.GET(new NextRequest("http://localhost/api/v1/mtm/attendance/branches/assignments"),undefined)
     const body=await res.json();expect(body.data.employees.map((row:{id:string})=>row.id)).toContain("branch-agent-a");expect(body.data.employees.map((row:{id:string})=>row.id)).not.toContain("branch-agent-b")
     for(const agentId of["branch-agent-b","branch-manager-card"])expect((await post(assignment.POST,{requestId:randomUUID(),expectedRevisionId:null,agentId,branchId:first.branch.id})).status).toBe(403)
     expect((await post(branch.POST,branchInput())).status).toBe(403)
     const input={requestId:randomUUID(),expectedRevisionId:null,agentId:"branch-agent-a",branchId:first.branch.id}
     const saved=await post(assignment.POST,input);expect(saved.status).toBe(200);const primary=(await saved.json()).data.primary
     expect((await (await post(assignment.POST,input)).json()).data.idempotent).toBe(true)
     const removed=await post(assignment.POST,{...input,requestId:randomUUID(),expectedRevisionId:primary.revisionId,branchId:null});expect(removed.status).toBe(200)
     expect((await removed.json()).data.primary.branchId).toBe(null)
     await tenant(ORG,async()=>{const rows=await prisma.$queryRaw<{branchId:string|null}[]>`SELECT "branchId" FROM mtm_attendance_primary_branch_revisions WHERE "agentId"='branch-agent-a' ORDER BY version`;expect(rows).toEqual([{branchId:first.branch.id},{branchId:null}])})
   }finally{caller.userId="branch-admin";caller.role="admin"}
 })
 it("HR report-wide grant reads all employees without gaining any branch or assignment write",async()=>{
   caller.userId="branch-hr";caller.role="manager"
   try{
     const body=await (await assignment.GET(new NextRequest("http://localhost/api/v1/mtm/attendance/branches/assignments"),undefined)).json()
     expect(body.data.employees.some((employee:{id:string})=>employee.id==="branch-agent-b")).toBe(true)
     expect(body.data.employees.every((employee:{canAssign:boolean})=>employee.canAssign===false)).toBe(true)
     expect((await post(branch.POST,branchInput())).status).toBe(403)
     expect((await post(assignment.POST,{requestId:randomUUID(),expectedRevisionId:null,agentId:"branch-agent-b",branchId:null})).status).toBe(403)
   }finally{caller.userId="branch-admin";caller.role="admin"}
 })
 it("blocks archived/foreign branch assignment and stale history without writes",async()=>{
   const archived=await tenant(ORG,()=>store.saveAttendanceBranch(admin,{...branchInput(),active:false}))
   for(const branchId of[archived.branch.id,randomUUID()])expect((await post(assignment.POST,{requestId:randomUUID(),expectedRevisionId:null,agentId:"branch-agent-b",branchId})).status).toBe(409)
 })
 it("enforces current admin role, disabled feature, and session principal before writes",async()=>{
   await bypass(()=>prisma.user.update({where:{id:"branch-admin"},data:{role:"manager"}}))
   try{expect((await post(branch.POST,branchInput())).status).toBe(403)}finally{await bypass(()=>prisma.user.update({where:{id:"branch-admin"},data:{role:"admin"}}))}
   caller.principalType="api_key";try{expect((await post(branch.POST,branchInput())).status).toBe(403)}finally{caller.principalType="session"}
   await tenant(ORG,()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:false}}))
   try{expect((await post(branch.POST,branchInput())).status).toBe(404)}finally{await tenant(ORG,()=>prisma.mtmSetting.update({where:{organizationId_key:{organizationId:ORG,key:"attendanceEnabled"}},data:{value:true}}))}
 })
 it("enforces tenant RLS, cross-tenant foreign keys, immutable assignment rows and server timestamps",async()=>{
   const first=await tenant(ORG,()=>store.saveAttendanceBranch(admin,branchInput()))
   const foreignBranchId=randomUUID()
   await tenant(OTHER,async()=>{
     await prisma.$executeRaw`INSERT INTO mtm_attendance_branches(id,"organizationId") VALUES (${foreignBranchId},${OTHER})`
     expect(await prisma.$queryRaw`SELECT * FROM mtm_attendance_branch_revisions WHERE id=${first.branch.revisionId}`).toEqual([])
     await expect(prisma.$executeRaw`INSERT INTO mtm_attendance_branches(id,"organizationId") VALUES (${randomUUID()},${ORG})`).rejects.toThrow()
   })
   await tenant(ORG,async()=>{
     await expect(prisma.$executeRaw`INSERT INTO mtm_attendance_branch_revisions(id,"organizationId","branchId",version,"requestId","requestHash",name,address,latitude,longitude,"radiusMeters",active,"createdBy") VALUES (${randomUUID()},${ORG},${foreignBranchId},1,${randomUUID()},${"a".repeat(64)},'Cross-tenant','Demo',0,0,150,true,'branch-admin')`).rejects.toThrow(/foreign key/i)
     const [published]=await prisma.$queryRaw<{createdAt:Date}[]>`INSERT INTO mtm_attendance_branch_revisions(id,"organizationId","branchId",version,"previousId","requestId","requestHash",name,address,latitude,longitude,"radiusMeters",active,"createdBy","createdAt") VALUES (${randomUUID()},${ORG},${first.branch.id},2,${first.branch.revisionId},${randomUUID()},${"a".repeat(64)},'Clock authority','Demo',0,0,150,true,'branch-admin','1970-01-01'::timestamp) RETURNING "createdAt"`
     expect(published.createdAt.getTime()).toBeGreaterThan(new Date(first.branch.createdAt).getTime())
     await expect(prisma.$executeRaw`UPDATE mtm_attendance_primary_branch_revisions SET "branchId"=${first.branch.id} WHERE "agentId"='branch-agent-a'`).rejects.toThrow(/IMMUTABLE/)
     await expect(prisma.$executeRaw`INSERT INTO mtm_attendance_branch_revisions(id,"organizationId","branchId",version,"requestId","requestHash",name,address,latitude,longitude,"radiusMeters",active,"createdBy") VALUES (${randomUUID()},${ORG},${first.branch.id},99,${randomUUID()},${"a".repeat(64)},'Bad version','Demo',0,0,150,true,'branch-admin')`).rejects.toThrow(/CHANGED/)
   })
 })
})
