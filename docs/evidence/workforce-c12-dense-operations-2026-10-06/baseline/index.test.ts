import {it,expect} from 'vitest'
import {PrismaClient,Prisma} from '@prisma/client'
import {readFileSync,writeFileSync} from 'node:fs'
import {readWorkforceReconciliationSnapshot} from '@/lib/workforce/reconciliation-snapshot'
const cfg=JSON.parse(readFileSync('/tmp/hrm-independent-perf/private-config.json','utf8'))
const admin=new PrismaClient({datasources:{db:{url:cfg.schema_url}}}),reader=new PrismaClient({datasources:{db:{url:cfg.reader_url}}})
function safe(x:any):any{const o:any={};for(const k of ['Node Type','Actual Rows','Actual Loops','Actual Total Time','Rows Removed by Filter','Shared Hit Blocks','Shared Read Blocks','Sort Method'])if(k in x)o[k]=x[k];if(x.Plans)o.Plans=x.Plans.map(safe);return o}
it('isolated experimental C-key index changes dense root access path',async()=>{
 try{await admin.$executeRawUnsafe('CREATE INDEX independent_experiment_tenant_c_id ON mtm_agent_workdays("organizationId",id COLLATE "C")');await admin.$executeRawUnsafe('ANALYZE mtm_agent_workdays');let plans:any[]=[];
 await reader.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;await tx.$queryRaw`SELECT set_config('app.org_id','ind-a',true),set_config('app.rls_bypass','off',true)`;let n=0;const wrapped={$queryRaw:async(q:Prisma.Sql)=>{if(++n<=2){const p=await tx.$queryRaw<any[]>(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${q}`);const x=p[0]['QUERY PLAN'][0];plans.push({page:n,planning_ms:x['Planning Time'],execution_ms:x['Execution Time'],plan:safe(x.Plan)})}return tx.$queryRaw(q)}};await expect(readWorkforceReconciliationSnapshot(wrapped as any,'ind-a')).rejects.toThrow(/^WORKFORCE_SWEEP_OVERFLOW$/)},{isolationLevel:'RepeatableRead',timeout:30000});expect(plans).toHaveLength(2);writeFileSync('/tmp/hrm-independent-perf/index-experiment-results.json',JSON.stringify({source:'0a40cd6922affc8c21cc07c655ad5af5df990b19',experimental_index_only_in_disposable_db:true,production_or_repository_schema_change:false,plans},null,2)+'\n')
 }finally{await Promise.all([admin.$disconnect(),reader.$disconnect()])}
})
