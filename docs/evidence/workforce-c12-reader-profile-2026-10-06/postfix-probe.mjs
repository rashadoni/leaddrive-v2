import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const root='/workspace/hrm-c12-acceptance-20261006',require=createRequire(`${root}/package.json`);
const {PrismaClient}=require('@prisma/client'),{createJiti}=require('jiti');
const cfg=JSON.parse(await readFile('/tmp/hrm-c12-acceptance-20261006/fixture-private.json','utf8'));
assert.equal(new URL(cfg.url).pathname,'/hrm_c12_schema_acceptance');
const db=new PrismaClient({datasources:{db:{url:cfg.url}}});
const jiti=createJiti(import.meta.url,{alias:{'@':`${root}/src`}});
const {runWorkforceReconciliationTick:tick}=await jiti.import(`${root}/src/lib/workforce/reconciliation-operations.ts`);
const reader=org=>({$transaction:(fn,options)=>db.$transaction(async tx=>{await tx.$executeRaw`SET LOCAL ROLE wf_c12_fixture_reader`;await tx.$executeRaw`SELECT set_config('app.org_id',${org},true)`;await tx.$executeRaw`SET LOCAL app.rls_bypass='off'`;return fn(tx);},options)});
let result={};
try {
 await db.$executeRaw`UPDATE system_job_leases SET "leaseUntil"=clock_timestamp()+interval '10 minutes'`;
 await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`;
 const before=await db.systemJobCursor.findUnique({where:{name:'workforce-claim-reconciliation-v1'}});
 const hidden=await tick({control:db,ownerToken:'synthetic-c12-owner',readerForOrganization:async org=>reader(org)});
 assert.equal(hidden.status,'INCOMPLETE');assert.deepEqual(await db.systemJobCursor.findUnique({where:{name:'workforce-claim-reconciliation-v1'}}),before);
 await db.$executeRaw`DROP POLICY hidden_roots_fixture ON mtm_agent_workdays`;
 await db.$executeRaw`UPDATE workforce_reconciliation_tenant_states SET "dueAt"=clock_timestamp()-interval '1 second'`;
 const good=await tick({control:db,ownerToken:'synthetic-c12-owner',readerForOrganization:async org=>reader(org)});
 result={hidden,good};assert.equal(good.status,'MATCHED');assert.equal(good.examined,1);result.status='PASS_CORRECTED_SAME_FIXTURE';
}catch(error){result.status='FAIL';result.failure={name:error?.name,code:error?.code};process.exitCode=1;}
finally{await db.$disconnect();await writeFile('/tmp/hrm-c12-acceptance-20261006/postfix-probe-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));}
