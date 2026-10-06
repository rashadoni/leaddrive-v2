import {it,expect} from 'vitest'
import {PrismaClient,Prisma} from '@prisma/client'
import {readFileSync,writeFileSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
import {readWorkforceReconciliationSnapshot} from '@/lib/workforce/reconciliation-snapshot'
const cfg=JSON.parse(readFileSync('/tmp/hrm-independent-perf/private-config.json','utf8'))
const admin=new PrismaClient({datasources:{db:{url:cfg.schema_url}}}),reader=new PrismaClient({datasources:{db:{url:cfg.reader_url}}})
function safe(x:any):any{const o:any={};for(const k of ['Node Type','Actual Rows','Actual Loops','Actual Total Time','Rows Removed by Filter','Shared Hit Blocks','Shared Read Blocks','Temp Read Blocks','Temp Written Blocks','Sort Method','Sort Space Used','Sort Space Type'])if(k in x)o[k]=x[k];if(x.Plans)o.Plans=x.Plans.map(safe);return o}
it('dense tenant safely refuses and quantifies C-collation page plan cost',async()=>{
 try{
  await admin.$executeRaw`INSERT INTO mtm_agent_workdays(id,"organizationId","agentId","workDate","startedAt","updatedAt") SELECT 'dense-'||lpad(n::text,8,'0'),'ind-a','agent-a','1000-01-01'::date+n,'1000-01-01'::timestamp+n*interval '1 day',now() FROM generate_series(1,100000)n`
  await admin.$executeRawUnsafe('ANALYZE mtm_agent_workdays')
  const before=await admin.$queryRaw`SELECT count(*)::int AS n,md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) AS hash FROM mtm_agent_workdays t`
  const evidence:any={source:'0a40cd6922affc8c21cc07c655ad5af5df990b19',selected_tenant_workdays:101000,foreign_tenant_workdays:20001,query_count:0};const start=performance.now()
  await expect(reader.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;await tx.$queryRaw`SELECT set_config('app.org_id','ind-a',true),set_config('app.rls_bypass','off',true)`;const wrapped={$queryRaw:async(q:Prisma.Sql)=>{evidence.query_count++;if(evidence.query_count===1){const p=await tx.$queryRaw<any[]>(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${q}`);const x=p[0]['QUERY PLAN'][0];evidence.first_page_plan={planning_ms:x['Planning Time'],execution_ms:x['Execution Time'],plan:safe(x.Plan)}}return tx.$queryRaw(q)}};return readWorkforceReconciliationSnapshot(wrapped as any,'ind-a')},{isolationLevel:'RepeatableRead',timeout:30000})).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/)
  evidence.duration_including_one_explain_ms=performance.now()-start;evidence.finite_code='WORKFORCE_SWEEP_OVERFLOW';expect(await admin.$queryRaw`SELECT count(*)::int AS n,md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) AS hash FROM mtm_agent_workdays t`).toEqual(before);evidence.unchanged_workday_facts=true
  writeFileSync('/tmp/hrm-independent-perf/dense-results.json',JSON.stringify(evidence,null,2)+'\n')
 }finally{await Promise.all([admin.$disconnect(),reader.$disconnect()])}
})
