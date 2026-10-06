import { reconcileWorkforceDenseSnapshot } from '@/lib/workforce/reconciliation-dense'
import { workforceReconciliationOperationsStore,runWorkforceReconciliationTick } from '@/lib/workforce/reconciliation-operations'
import { workforceReconciliationCursorStore } from '@/lib/workforce/reconciliation-cursor-store'
import { beforeAll, afterAll, it, expect } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { readWorkforceReconciliationSnapshot } from '@/lib/workforce/reconciliation-snapshot'
import { reconcileWorkforceSnapshot } from '@/lib/workforce/reconciliation'
import { buildWorkforceTimesheetApproval } from '@/lib/workforce/timesheet-approval'

const cfg=JSON.parse(readFileSync('/tmp/hrm-ops-independent-fullschema/private-config.json','utf8'))
const admin=new PrismaClient({datasources:{db:{url:cfg.schema_url}}})
const reader=new PrismaClient({datasources:{db:{url:cfg.reader_url}}})
const tables=['mtm_agent_workdays','mtm_agent_workday_events','workforce_site_transitions','workforce_attendance_evidence','workforce_evidence_assessments','workforce_exception_cases','workforce_timesheet_approvals','mtm_audit_logs']
const report:any={source:'mutable_ops_draft_base0a40',schema_mode:'base0a40 generated full schema SQL plus actual operations migration; not full migration replay',scenarios:[],plans:[],private_values_emitted:false}
function planSafe(x:any):any {const o:any={};for(const k of ['Node Type','Join Type','Actual Startup Time','Actual Total Time','Actual Rows','Actual Loops','Plan Rows','Plan Width','Rows Removed by Filter','Shared Hit Blocks','Shared Read Blocks','Temp Read Blocks','Temp Written Blocks','Sort Method','Sort Space Used','Sort Space Type'])if(k in x)o[k]=x[k];if(x.Plans)o.Plans=x.Plans.map(planSafe);return o}
async function fingerprint(){return Promise.all(tables.map(t=>admin.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS hash FROM "${t}" t`)))}
async function txRead<T>(org:string,fn:(tx:Prisma.TransactionClient)=>Promise<T>){return reader.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.$queryRaw`SELECT set_config('app.org_id',${org},true),set_config('app.rls_bypass','off',true)`;return fn(tx)},{isolationLevel:'RepeatableRead',timeout:30000})}
async function measure(label:string,explain=false){const before=await fingerprint();let queryCount=0;const seen=new Set<string>();const start=performance.now();const snapshot=await txRead('ind-a',async tx=>{const wrapped={$queryRaw:async (q:Prisma.Sql)=>{queryCount++;const table=tables.find(t=>q.text.includes('"'+t+'"'));if(explain&&table&&!seen.has(table)){seen.add(table);const plans=await tx.$queryRaw<any[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`);const root=plans[0]['QUERY PLAN'][0];report.plans.push({scenario:label,source_kind_index:tables.indexOf(table),planning_ms:root['Planning Time'],execution_ms:root['Execution Time'],plan:planSafe(root.Plan)})}return tx.$queryRaw(q)}};return readWorkforceReconciliationSnapshot(wrapped as any,'ind-a')});const elapsed=performance.now()-start;const result=reconcileWorkforceSnapshot(snapshot);expect(await fingerprint()).toEqual(before);report.scenarios.push({label,duration_ms:Math.round(elapsed*100)/100,query_count:queryCount,examined:result.examined,status:result.status,unchanged_facts:true});return snapshot}
beforeAll(async()=>{
 report.database=await admin.$queryRaw`SELECT version() AS version,(SELECT datcollate FROM pg_database WHERE datname=current_database()) AS collation,(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS table_count,(SELECT count(*)::int FROM pg_indexes WHERE schemaname='public') AS index_count,(SELECT count(*)::int FROM pg_constraint WHERE contype='f') AS foreign_key_count`
 report.reader_role=await reader.$queryRaw`SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`
 report.forced_rls=await admin.$queryRaw`SELECT count(*)::int AS forced_tables FROM pg_class WHERE relrowsecurity AND relforcerowsecurity`
 for(const suffix of ['a','b']){
  const org='ind-'+suffix,agent='agent-'+suffix,day='day-'+suffix,user='user-'+suffix
  await admin.organization.create({data:{id:org,name:'Synthetic isolation',slug:'synthetic-'+suffix,features:['workforce-hrm'],createdAt:new Date(suffix==='a'?'2026-01-01':'2026-01-02')}})
  await admin.user.create({data:{id:user,organizationId:org,email:'synthetic-'+suffix+'@invalid.example',name:'Synthetic',passwordHash:'not-an-auth-credential'}})
  await admin.mtmAgent.create({data:{id:agent,organizationId:org,name:'Synthetic'}})
  await admin.mtmAgentWorkday.create({data:{id:day,organizationId:org,agentId:agent,workDate:new Date('2026-10-01'),startedAt:new Date('2026-10-01T09:00:00Z')}})
  await admin.mtmAgentWorkdayEvent.create({data:{id:'event-'+suffix,organizationId:org,agentId:agent,workdayId:day,type:'START',occurredAt:new Date('2026-10-01T09:00:00Z')}})
  await admin.workforceShiftTemplate.create({data:{id:'template-'+suffix,organizationId:org,code:'synthetic',version:1,name:'Synthetic',timezone:'UTC',definition:{},definitionHash:'a'.repeat(64)}})
  await admin.workforceShiftSegment.create({data:{id:'segment-'+suffix,organizationId:org,templateId:'template-'+suffix,sequence:1,mode:'REMOTE',startTime:'09:00',endTime:'18:00'}})
  await admin.workforceSiteTransition.create({data:{id:'transition-'+suffix,organizationId:org,agentId:agent,workdayId:day,segmentId:'segment-'+suffix,kind:'ARRIVAL',clientTransitionId:'client-'+suffix,claimedAt:new Date(),capturedAt:new Date(),serverReceivedAt:new Date(),appliedAt:new Date(),requestHash:'a'.repeat(64)}})
  await admin.workforceAttendanceEvidence.create({data:{id:'evidence-'+suffix,organizationId:org,workdayEventId:'event-'+suffix,operationReference:'op-'+suffix,source:'LOCATION',schemaVersion:1,capturedAt:new Date(),payloadHash:'a'.repeat(64),redactedReceipt:{},rawExpiresAt:new Date('2027-01-01')}})
  await admin.workforceEvidenceAssessment.create({data:{id:'assessment-'+suffix,organizationId:org,evidenceId:'evidence-'+suffix,kind:'GEOFENCE',assessorVersion:'test-v1',verdict:'UNKNOWN',reasonCodes:[],assessedAt:new Date()}})
  await admin.workforceExceptionCase.create({data:{id:'exception-'+suffix,organizationId:org,agentId:agent,kind:'SYNTHETIC',detectorVersion:'v1',deduplicationKey:'a'.repeat(64),workdayId:day}})
  const payload=buildWorkforceTimesheetApproval({periodStart:'2026-10-01',periodEnd:'2026-10-01',agentId:agent,rows:[{agentId:agent,workdayId:day,workDate:'2026-10-01',calculationVersion:1,calculation:{calculationVersion:1,policySnapshotId:'policy',shiftSnapshotId:'shift',status:'COMPLETED',isFinal:true,plan:{plannedStartAt:'2026-10-01T09:00:00Z',plannedEndAt:'2026-10-01T10:00:00Z',expectedWorkSeconds:3600,workDate:'2026-10-01',timezone:'UTC'},fact:{workdayId:day,startedAt:'2026-10-01T09:00:00Z',completedAt:'2026-10-01T10:00:00Z',workedSeconds:3600,pausedSeconds:0,longestPauseSeconds:0},deviations:{lateStartSeconds:0,undertimeSeconds:0,overtimeSeconds:0,longPauseSeconds:0},exceptions:[]}}]})
  await admin.workforceTimesheetApproval.create({data:{id:'approval-'+suffix,organizationId:org,agentId:agent,periodStart:new Date('2026-10-01'),periodEnd:new Date('2026-10-01'),revision:1,calculationVersion:1,rowsHash:payload.rowsHash,factsHash:payload.factsHash,rows:payload.rows as any,approvedByUserId:user,approvedAt:new Date()}})
  await admin.mtmAuditLog.create({data:{id:'audit-'+suffix,organizationId:org,agentId:agent,action:'WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED',entity:'workforce_timesheet_approval',entityId:'approval-'+suffix,metadataKind:'workforce_timesheet_export',newData:{approvalId:'approval-'+suffix,recordKind:'APPROVAL',revision:1,periodStart:'2026-10-01',periodEnd:'2026-10-01',rowsHash:payload.rowsHash,factsHash:payload.factsHash,format:'workforce-approved-timesheet-v1',recipient:'SESSION_DIRECT_DOWNLOAD'}}})
 }
})
afterAll(async()=>{writeFileSync('/tmp/hrm-ops-independent-fullschema/retest-results.json',JSON.stringify(report,null,2)+'\n');await Promise.all([reader.$disconnect(),admin.$disconnect()])})

function scopedReader(org:string){return {$transaction:async(fn:any,options:any)=>reader.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL app.org_id = '"+org+"'");await tx.$executeRaw`SET LOCAL app.rls_bypass='off'`;return fn(tx)},options)}}
async function denseMeasure(label:string,explain=false){
 const before=await fingerprint();let queries=0;const seen=new Set<string>();const start=performance.now()
 const result=await txRead('ind-a',async tx=>{const wrapped={$queryRaw:async(...args:any[])=>{
  const q=Array.isArray(args[0])?Prisma.sql(args[0],...args.slice(1)):args[0];queries++
  const table=tables.find(t=>q.text.includes(t));if(explain&&table&&!seen.has(table)){seen.add(table);const rows=await tx.$queryRaw<any[]>(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${q}`);const x=rows[0]['QUERY PLAN'][0];report.plans.push({scenario:label,source_kind_index:tables.indexOf(table),planning_ms:x['Planning Time'],execution_ms:x['Execution Time'],plan:planSafe(x.Plan)})}
  return tx.$queryRaw(q)
 }};return reconcileWorkforceDenseSnapshot(wrapped as any,'ind-a')})
 const elapsed=performance.now()-start;expect(await fingerprint()).toEqual(before);report.scenarios.push({label,duration_ms:elapsed,query_count:queries,examined:result.examined,status:result.status,unchanged_facts:true});return result
}
const ops=()=>workforceReconciliationOperationsStore(admin)
const cursor=()=>workforceReconciliationCursorStore(admin)
async function lease(){await admin.$executeRaw`INSERT INTO system_job_leases(name,"ownerToken","leaseUntil",status,"lastStartedAt","updatedAt") VALUES('workforce-claim-reconciliation-v1','ind-owner',clock_timestamp()+interval '10 minutes','running',clock_timestamp(),clock_timestamp()) ON CONFLICT(name) DO UPDATE SET "ownerToken"='ind-owner',"leaseUntil"=clock_timestamp()+interval '10 minutes',status='running'`}
async function resetOps(){await admin.$executeRaw`DELETE FROM workforce_reconciliation_tenant_states`;await admin.$executeRaw`DELETE FROM system_job_cursors WHERE name='workforce-claim-reconciliation-v1'`;await lease()}
it('full-schema scoped tick commits only operational state and opaque progress',async()=>{
 await resetOps();const before=await fingerprint()
 const result=await runWorkforceReconciliationTick({control:admin,ownerToken:'ind-owner',readerForOrganization:async org=>scopedReader(org) as any})
 expect(result).toMatchObject({status:'MATCHED',eligible:2,examined:8,attemptRecorded:true});expect(await fingerprint()).toEqual(before);expect((await cursor().read())?.version).toBe(1)
 await txRead('ind-b',async tx=>expect(await tx.$queryRaw`SELECT "organizationId" FROM workforce_reconciliation_tenant_states`).toEqual([]))
 const health=await ops().health();expect(health.coverage).toBe('TRACKED_ATTEMPTS_ONLY');expect(health.eligibleRosterCoverage).toBe('NOT_MEASURED');expect(JSON.stringify({result,health})).not.toMatch(/ind-a|agent-a|ind-owner|attemptToken/)
 report.scenarios.push({label:'scoped_tick',status:result.status,unchanged_facts:true,tenant_owned_state_isolated:true,global_checkpoint_opaque:true})
})
it('wrong tenant context and superuser reader refuse without checkpoint',async()=>{
 for(const factory of [async()=>scopedReader('ind-b') as any,async()=>admin]){
  await resetOps();expect(await runWorkforceReconciliationTick({control:admin,ownerToken:'ind-owner',readerForOrganization:factory})).toMatchObject({status:'INCOMPLETE',attemptRecorded:true});expect(await cursor().read()).toBeNull()
 }
 report.scenarios.push({label:'wrong_context_and_superuser_refusal',checkpoint:'NONE'})
})
it('replaced or expired attempt cannot advance even with same live lease owner',async()=>{
 await resetOps();const first=await ops().claim('ind-owner');if(first.status!=='CLAIMED')throw new Error('CLAIM_FIXTURE')
 const fenced=workforceReconciliationCursorStore(admin,first.claim)
 await admin.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`
 expect(await fenced.commit({expected:null,nextCursor:'wf-sweep-v1:00000000-0000-4000-8000-000000000000',ownerToken:'ind-owner'})).toBe('FENCED_OUT')
 const next=await ops().claim('ind-owner');expect(next.status).toBe('CLAIMED')
 expect(await fenced.commit({expected:null,nextCursor:'wf-sweep-v1:00000000-0000-4000-8000-000000000000',ownerToken:'ind-owner'})).toBe('FENCED_OUT');expect(await cursor().read()).toBeNull()
 expect(await ops().finish('ind-owner',first.claim,{outcome:'MATCHED',examined:8,mismatches:0,durationMs:1})).toBe(false)
 report.scenarios.push({label:'attempt_replacement_and_expiry',checkpoint:'NONE',stale_finish:false})
})
it('oversized atomic approval refuses without operational progress',async()=>{
 const prior=await admin.workforceTimesheetApproval.findUniqueOrThrow({where:{id:'approval-a'}});await admin.workforceTimesheetApproval.update({where:{id:'approval-a'},data:{rows:['я'.repeat(600000)]}})
 await resetOps();const before=await fingerprint();expect(await runWorkforceReconciliationTick({control:admin,ownerToken:'ind-owner',readerForOrganization:async org=>scopedReader(org) as any})).toMatchObject({status:'INCOMPLETE'});expect(await cursor().read()).toBeNull();expect(await fingerprint()).toEqual(before);await admin.workforceTimesheetApproval.update({where:{id:'approval-a'},data:{rows:prior.rows!}})
 report.scenarios.push({label:'atomic_utf8_group_refusal',checkpoint:'NONE',unchanged_facts:true})
})
