import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='/workspace/hrm-c12-acceptance-20261006';
const require=createRequire(`${root}/package.json`);
const {PrismaClient}=require('@prisma/client');
const {createJiti}=require('jiti');
const cfg=JSON.parse(await readFile('/tmp/hrm-c12-acceptance-20261006/fixture-private.json','utf8'));
const target=new URL(cfg.url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/hrm_c12_schema_acceptance');
const db=new PrismaClient({datasources:{db:{url:cfg.url}}});
const jiti=createJiti(import.meta.url,{alias:{'@':`${root}/src`}});
const {runWorkforceReconciliationTick:tick}=await jiti.import(`${root}/src/lib/workforce/reconciliation-operations.ts`);
const tables=['mtm_agent_workdays','mtm_agent_workday_events','workforce_site_transitions','workforce_attendance_evidence','workforce_evidence_assessments','workforce_exception_cases','workforce_timesheet_approvals','mtm_audit_logs','mtm_agents','workforce_employee_team_memberships','workforce_shift_templates','workforce_shift_segments','workforce_shift_assignments','workforce_shift_default_assignments','workforce_shift_team_default_assignments','workforce_workday_schedule_snapshots','workforce_shift_snapshots','workforce_policy_snapshots'];
const receipt={sourceHead:'bf6ed11f2bba8c93e828fb044315794b44224741',fixture:'full-current-Prisma-schema plus synthetic SELECT-only tenant role; not historical replay',cases:[],sourceBindings:[]};
async function fingerprint(){const result=[];for(const t of tables){const q=await db.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(x)::text,'' ORDER BY id),'')) AS hash FROM public."${t}" x`);result.push({table:t,...q[0]});}return result;}
const reader=org=>({$transaction:(fn,options)=>db.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL ROLE wf_c12_fixture_reader`;await tx.$executeRaw`SELECT set_config('app.org_id',${org},true)`;await tx.$executeRaw`SET LOCAL app.rls_bypass='off'`;return fn(tx);},options)});
try{
 await db.$executeRaw`CREATE ROLE wf_c12_fixture_reader NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`;
 await db.$executeRawUnsafe(`GRANT SELECT ON organizations,workforce_reconciliation_tenant_states,${tables.join(',')} TO wf_c12_fixture_reader`);
 for(const t of tables){await db.$executeRawUnsafe(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);await db.$executeRawUnsafe(`ALTER TABLE public."${t}" FORCE ROW LEVEL SECURITY`);await db.$executeRawUnsafe(`CREATE POLICY tenant_isolation ON public."${t}" USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on') WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on')`);}
 const a=await db.organization.create({data:{name:'Synthetic C12 A',slug:'synthetic-c12-a',plan:'enterprise',modules:{'workforce-hrm':true},features:['workforce-hrm']}});
 const b=await db.organization.create({data:{name:'Synthetic C12 B',slug:'synthetic-c12-b',isActive:false}});
 for(const org of [a,b]){const agent=await db.mtmAgent.create({data:{organizationId:org.id,name:'Synthetic employee'}});await db.mtmAgentWorkday.create({data:{organizationId:org.id,agentId:agent.id,workDate:new Date('2026-10-01T00:00:00Z'),startedAt:new Date('2026-10-01T08:00:00Z')}});}
 await db.systemJobLease.create({data:{name:'workforce-claim-reconciliation-v1',ownerToken:'synthetic-c12-owner',status:'running',leaseUntil:new Date(Date.now()+600000)}});
 const before=await fingerprint();
 const good=await tick({control:db,ownerToken:'synthetic-c12-owner',readerForOrganization:async org=>reader(org)});
 assert.equal(good.status,'MATCHED');assert.equal(good.examined,1);assert.deepEqual(await fingerprint(),before);
 receipt.cases.push({name:'complete-tenant-reader',result:good,foreignWorkdayExcluded:true,businessFactsUnchanged:true});
 await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`;
 await db.$executeRaw`CREATE POLICY hidden_roots_fixture ON mtm_agent_workdays AS RESTRICTIVE FOR SELECT TO wf_c12_fixture_reader USING (false)`;
 const cursorBefore=await db.systemJobCursor.findUnique({where:{name:'workforce-claim-reconciliation-v1'}});
 const hidden=await tick({control:db,ownerToken:'synthetic-c12-owner',readerForOrganization:async org=>reader(org)});
 const cursorAfter=await db.systemJobCursor.findUnique({where:{name:'workforce-claim-reconciliation-v1'}});
 assert.deepEqual(await fingerprint(),before);
 receipt.cases.push({name:'additional-restrictive-policy-hides-real-root',result:hidden,actualTenantWorkdays:1,checkpointAdvanced:cursorAfter?.version!==cursorBefore?.version,businessFactsUnchanged:true});
 receipt.status=hidden.status==='MATCHED'&&hidden.examined===0?'NEGATIVE_REPRODUCED_UNVERIFIED_READER_FALSE_MATCH':'SAFE_REFUSAL_OBSERVED';
 for(const p of ['prisma/schema.prisma','src/lib/workforce/reconciliation-operations.ts','src/lib/workforce/reconciliation-sweep.ts','src/lib/workforce/reconciliation-dense.ts','src/lib/workforce/reconciliation-source-page.ts']){const bytes=await readFile(`${root}/${p}`);receipt.sourceBindings.push({path:p,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 receipt.factFingerprints=before;
}catch(error){receipt.status='PROBE_FAILED';receipt.failure={name:error?.name??'Error',code:typeof error?.code==='string'?error.code:null};process.exitCode=1;}
finally{await db.$disconnect();await writeFile('/tmp/hrm-c12-acceptance-20261006/initial-visibility-probe.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:receipt.status,cases:receipt.cases}));}
