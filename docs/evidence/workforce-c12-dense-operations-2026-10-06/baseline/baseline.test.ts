import { beforeAll, afterAll, it, expect } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { readWorkforceReconciliationSnapshot } from '@/lib/workforce/reconciliation-snapshot'
import { reconcileWorkforceSnapshot } from '@/lib/workforce/reconciliation'
import { buildWorkforceTimesheetApproval } from '@/lib/workforce/timesheet-approval'

const cfg=JSON.parse(readFileSync('/tmp/hrm-independent-perf/private-config.json','utf8'))
const admin=new PrismaClient({datasources:{db:{url:cfg.schema_url}}})
const reader=new PrismaClient({datasources:{db:{url:cfg.reader_url}}})
const tables=['mtm_agent_workdays','mtm_agent_workday_events','workforce_site_transitions','workforce_attendance_evidence','workforce_evidence_assessments','workforce_exception_cases','workforce_timesheet_approvals','mtm_audit_logs']
const report:any={source:'0a40cd6922affc8c21cc07c655ad5af5df990b19',schema_mode:'full schema.prisma generated SQL, not migration replay',scenarios:[],plans:[],private_values_emitted:false}
function planSafe(x:any):any {const o:any={};for(const k of ['Node Type','Join Type','Actual Startup Time','Actual Total Time','Actual Rows','Actual Loops','Plan Rows','Plan Width','Rows Removed by Filter','Shared Hit Blocks','Shared Read Blocks','Temp Read Blocks','Temp Written Blocks','Sort Method','Sort Space Used','Sort Space Type'])if(k in x)o[k]=x[k];if(x.Plans)o.Plans=x.Plans.map(planSafe);return o}
async function fingerprint(){return Promise.all(tables.map(t=>admin.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) AS hash FROM "${t}" t`)))}
async function txRead<T>(org:string,fn:(tx:Prisma.TransactionClient)=>Promise<T>){return reader.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.$queryRaw`SELECT set_config('app.org_id',${org},true),set_config('app.rls_bypass','off',true)`;return fn(tx)},{isolationLevel:'RepeatableRead',timeout:30000})}
async function measure(label:string,explain=false){const before=await fingerprint();let queryCount=0;const seen=new Set<string>();const start=performance.now();const snapshot=await txRead('ind-a',async tx=>{const wrapped={$queryRaw:async (q:Prisma.Sql)=>{queryCount++;const table=tables.find(t=>q.text.includes('"'+t+'"'));if(explain&&table&&!seen.has(table)){seen.add(table);const plans=await tx.$queryRaw<any[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q}`);const root=plans[0]['QUERY PLAN'][0];report.plans.push({scenario:label,source_kind_index:tables.indexOf(table),planning_ms:root['Planning Time'],execution_ms:root['Execution Time'],plan:planSafe(root.Plan)})}return tx.$queryRaw(q)}};return readWorkforceReconciliationSnapshot(wrapped as any,'ind-a')});const elapsed=performance.now()-start;const result=reconcileWorkforceSnapshot(snapshot);expect(await fingerprint()).toEqual(before);report.scenarios.push({label,duration_ms:Math.round(elapsed*100)/100,query_count:queryCount,examined:result.examined,status:result.status,unchanged_facts:true});return snapshot}
beforeAll(async()=>{
 report.database=await admin.$queryRaw`SELECT version() AS version,(SELECT datcollate FROM pg_database WHERE datname=current_database()) AS collation,(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public') AS table_count,(SELECT count(*)::int FROM pg_indexes WHERE schemaname='public') AS index_count,(SELECT count(*)::int FROM pg_constraint WHERE contype='f') AS foreign_key_count`
 report.reader_role=await reader.$queryRaw`SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user`
 report.forced_rls=await admin.$queryRaw`SELECT count(*)::int AS forced_tables FROM pg_class WHERE relrowsecurity AND relforcerowsecurity`
 for(const suffix of ['a','b']){
  const org='ind-'+suffix,agent='agent-'+suffix,day='day-'+suffix,user='user-'+suffix
  await admin.organization.create({data:{id:org,name:'Synthetic isolation',slug:'synthetic-'+suffix}})
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
afterAll(async()=>{writeFileSync('/tmp/hrm-independent-perf/baseline-results.json',JSON.stringify(report,null,2)+'\n');await Promise.all([reader.$disconnect(),admin.$disconnect()])})
it('full schema all eight kinds are healthy and FORCE RLS isolates direct unfiltered reads',async()=>{
 const snap=await measure('all8_minimal',true);expect(reconcileWorkforceSnapshot(snap).status).toBe('MATCHED')
 await txRead('ind-a',async tx=>{for(const t of tables){const rows=await tx.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n,count(*) FILTER(WHERE "organizationId"!='ind-a')::int AS foreign_n FROM "${t}"`);expect(rows[0]).toEqual({n:1,foreign_n:0});}const hidden=await readWorkforceReconciliationSnapshot(tx,'ind-b');expect(Object.values(hidden).every(rows=>rows.length===0)).toBe(true)})
 await reader.$transaction(async tx=>{const rows=await tx.$queryRawUnsafe<any[]>('SELECT count(*)::int AS n FROM mtm_agent_workdays');expect(rows[0].n).toBe(0)})
 report.isolation={eight_unfiltered_queries_foreign_count:0,foreign_scope_argument_visible_roots:0,unset_context_visible_workdays:0,bypass_setting:'off',reader_superuser:false,reader_bypass_rls:false}
})
it('near supported root limits with foreign tenant noise and sanitized plans',async()=>{
 await admin.$executeRaw`INSERT INTO mtm_agent_workdays(id,"organizationId","agentId","workDate","startedAt","updatedAt") SELECT 'near-day-'||n,'ind-a','agent-a','2020-01-01'::date+n,'2020-01-01'::timestamp+n*interval '1 day',now() FROM generate_series(1,999)n`
 await admin.$executeRaw`INSERT INTO mtm_agent_workdays(id,"organizationId","agentId","workDate","startedAt","updatedAt") SELECT 'foreign-day-'||n,'ind-b','agent-b','1900-01-01'::date+n,'1900-01-01'::timestamp+n*interval '1 day',now() FROM generate_series(1,20000)n`
 await admin.$executeRaw`INSERT INTO mtm_agent_workday_events(id,"organizationId","agentId","workdayId",type,"occurredAt") SELECT 'near-event-'||n,'ind-a','agent-a','near-day-'||n,'START','2020-01-01'::timestamp FROM generate_series(1,999)n`
 await admin.$executeRaw`INSERT INTO workforce_attendance_evidence(id,"organizationId","workdayEventId","operationReference",source,"schemaVersion","capturedAt","payloadHash","redactedReceipt","rawExpiresAt") SELECT 'near-evidence-'||n,'ind-a','near-event-'||n,'near-op-'||n,'LOCATION',1,now(),repeat('a',64),'{}'::jsonb,now() FROM generate_series(1,999)n`
 await admin.$executeRaw`INSERT INTO workforce_evidence_assessments(id,"organizationId","evidenceId",kind,"assessorVersion",verdict,"reasonCodes","assessedAt") SELECT 'near-assessment-'||n,'ind-a','near-evidence-'||n,'GEOFENCE','v1','UNKNOWN','[]'::jsonb,now() FROM generate_series(1,999)n`
 await admin.$executeRaw`INSERT INTO workforce_exception_cases(id,"organizationId","agentId",kind,"detectorVersion","deduplicationKey","workdayId") SELECT 'near-case-'||n,'ind-a','agent-a','SYNTHETIC','v1',lpad(n::text,64,'0'),'near-day-'||n FROM generate_series(1,999)n`
 await admin.$executeRaw`INSERT INTO mtm_audit_logs(id,"organizationId","agentId",action,entity,"entityId","metadataKind","newData") SELECT 'near-audit-'||n,"organizationId","agentId",action,entity,"entityId","metadataKind","newData" FROM mtm_audit_logs CROSS JOIN generate_series(1,999)n WHERE id='audit-a'`
 await admin.$executeRawUnsafe('ANALYZE')
 const snap=await measure('near1000_roots_foreign20001',true);expect(snap.workdays).toHaveLength(1000);expect(snap.exports).toHaveLength(1000);expect(reconcileWorkforceSnapshot(snap).status).toBe('MATCHED')
 for(let i=0;i<3;i++)await measure('near1000_repeat_'+i)
})
it('1001 roots fail closed without changing facts',async()=>{
 await admin.$executeRaw`INSERT INTO mtm_agent_workdays(id,"organizationId","agentId","workDate","startedAt","updatedAt") VALUES('overflow-day','ind-a','agent-a','2100-01-01','2100-01-01',now())`
 const before=await fingerprint(),start=performance.now();await expect(txRead('ind-a',tx=>readWorkforceReconciliationSnapshot(tx,'ind-a'))).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/);expect(await fingerprint()).toEqual(before);report.scenarios.push({label:'1001_root_refusal',duration_ms:performance.now()-start,finite_code:'WORKFORCE_SWEEP_OVERFLOW',unchanged_facts:true});await admin.mtmAgentWorkday.delete({where:{id:'overflow-day'}})
})
it('read-only non-superuser denies source mutation and snapshot is stable across concurrent changes',async()=>{
 await expect(txRead('ind-a',tx=>tx.$executeRaw`UPDATE mtm_agent_workdays SET status='PAUSED' WHERE id='day-a'`)).rejects.toThrow()
 await txRead('ind-a',async tx=>{const first=await readWorkforceReconciliationSnapshot(tx,'ind-a');expect(first.workdays).toHaveLength(1000);await admin.mtmAgentWorkdayEvent.update({where:{id:'event-a'},data:{agentId:'agent-b'}});const same=await readWorkforceReconciliationSnapshot(tx,'ind-a');expect(reconcileWorkforceSnapshot(same).status).toBe('MATCHED')})
 const next=await measure('next_mvcc_detects_update');expect(reconcileWorkforceSnapshot(next).status).toBe('MISMATCH');await admin.mtmAgentWorkdayEvent.update({where:{id:'event-a'},data:{agentId:'agent-a'}});report.mvcc={concurrent_update_invisible_in_original_snapshot:true,next_snapshot_detects_mismatch:true,readonly_mutation_denied:true}
})
it('UTF8 audit and approval byte guards reject under full schema',async()=>{
 const approval=await admin.workforceTimesheetApproval.findUniqueOrThrow({where:{id:'approval-a'}});await admin.workforceTimesheetApproval.update({where:{id:'approval-a'},data:{rows:['я'.repeat(600000)]}});const before=await fingerprint();await expect(txRead('ind-a',tx=>readWorkforceReconciliationSnapshot(tx,'ind-a'))).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/);expect(await fingerprint()).toEqual(before);await admin.workforceTimesheetApproval.update({where:{id:'approval-a'},data:{rows:approval.rows!}})
 const audit=await admin.mtmAuditLog.findUniqueOrThrow({where:{id:'audit-a'}});await admin.mtmAuditLog.update({where:{id:'audit-a'},data:{newData:{...(audit.newData as any),approvalId:'я'.repeat(3000)}}});await expect(txRead('ind-a',tx=>readWorkforceReconciliationSnapshot(tx,'ind-a'))).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/);await admin.mtmAuditLog.update({where:{id:'audit-a'},data:{newData:audit.newData!}});report.byte_guards={oversize_utf8_approval_refused:true,oversize_audit_projection_refused:true}
})
