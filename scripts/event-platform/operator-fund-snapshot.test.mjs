import test from 'node:test'
import assert from 'node:assert/strict'
import { collectFundRecoveryDatabaseSnapshot } from './operator-fund-snapshot.mjs'
function fixture(){
 const eventId='00000000-0000-4000-8000-000000000001',buildId='00000000-0000-4000-8000-000000000002'
 const scope={organizationId:'org-a',buildId,buildKey:'shadow-a',projectionVersion:2,codeSha:'a'.repeat(40),expectedReaderRole:'reader_a',environment:'staging',fundIds:['fund-a']}
 const state={organizationId:'org-a',fundId:'fund-a',balance:'10.0000',currency:'AZN',aggregateVersion:1,lastEventId:eventId,lastEventAt:'2026-10-19T00:00:00.000Z'}
 const raw={observedAt:'2026-10-19T00:00:00.000Z',databaseSnapshot:'100:100:',builds:[{id:buildId,org:'org-a',projection:'finance.fund-balance',version:2,key:'shadow-a',sha:scope.codeSha,mode:'shadow',status:'running',fenced:true,replay_from:null,replay_to:null}],
  funds:[{id:'fund-a',balance:'10.0000',currency:'AZN'}],events:[{id:eventId,fund:'fund-a',version:'1',type:'finance.fund-opened.v1',integrity:true,data_hash:'b'.repeat(64),outbox_hash:'c'.repeat(64),envelope:{organizationid:'org-a',aggregateid:'fund-a',id:eventId,aggregateversion:1,type:'finance.fund-opened.v1'}}],
  heads:[{fund:'fund-a',version:'1',last_event:eventId}],active:[{fund:'fund-a',balance:'10.0000',currency:'AZN',version:'1',last_event:eventId}],
  shadow:[{fund:'fund-a',balance:'10.0000',currency:'AZN',version:'1',last_event:eventId,status:'shadow',evidence_last_event:eventId,evidence_last_at:state.lastEventAt,worker_evidence:{adapterVersion:1,buildId,codeSha:scope.codeSha,sourceTopic:'ld.staging.finance.events.v1',sourcePartition:0,lastSourceOffset:'0',lastEventId:eventId,lastEventAt:state.lastEventAt}}],
  checkpoints:[{topic:'ld.staging.finance.events.v1',partition:0,last_offset:'0',last_event:eventId}],
  inbox:[{event:eventId,type:'finance.fund-opened.v1',hash:'c'.repeat(64),topic:'ld.staging.finance.events.v1',partition:0,offset:'0'}],nonLiveEffectPresent:false}
 const roles=[{current_role:'reader_a',session_role:'reader_a',restricted:true}],access=[{count:9,safe:true}],calls=[]
 const tx={$executeRawUnsafe:async sql=>{calls.push(sql);return 0},$queryRawUnsafe:async sql=>{
  calls.push(sql);if(sql.includes('FROM pg_catalog.pg_roles'))return roles
  if(sql.includes('FROM pg_catalog.pg_class'))return access
  if(sql.includes('set_config'))return[]
  return[{snapshot:raw}]
 }}
 const db={$transaction:async(work,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return work(tx)}}
 // Control-flow double only. Real canonical reducer executes in isolated PG CI.
 return{scope,raw,roles,access,calls,db,reduce:()=>({...state})}
}
const collect=f=>collectFundRecoveryDatabaseSnapshot(f.db,f.scope,f.reduce)
test('control flow sets READ ONLY before first read and returns only aggregate evidence',async()=>{
 const f=fixture(),result=await collect(f)
 assert.equal(f.calls[0],'SET TRANSACTION READ ONLY');assert.equal(result.source[0].balance,'10.0000')
 assert.equal(result.checkpoints[0].nextOffset,'1');assert.equal(result.brokerPositionsAuthenticated,false)
 assert.equal(JSON.stringify(result).includes('envelope'),false)
})
const cases={
 'missing worker provenance':f=>delete f.raw.shadow[0].worker_evidence,
 'unsafe table access':f=>f.access[0].safe=false,'missing forced RLS table':f=>f.access[0].count=8,
 'wrong shadow timestamp':f=>f.raw.shadow[0].evidence_last_at='2026-10-18T00:00:00.000Z','missing snapshot provenance':f=>delete f.raw.databaseSnapshot,
 'wrong role':f=>f.roles[0].session_role='other', 'unsafe role':f=>f.roles[0].restricted=false,
 'missing build':f=>f.raw.builds=[], 'wrong code':f=>f.raw.builds[0].sha='d'.repeat(40),
 'ranged build':f=>f.raw.builds[0].replay_from='2026-01-01', 'unfenced build':f=>f.raw.builds[0].fenced=false,
 'incomplete inventory':f=>f.scope.fundIds.push('missing-fund'), 'missing event':f=>f.raw.events=[],
 'missing outbox hash proof':f=>f.raw.events[0].integrity=false,'null outbox hash proof':f=>f.raw.events[0].integrity=null,
 'missing inbox':f=>f.raw.inbox=[], 'wrong inbox hash':f=>f.raw.inbox[0].hash='d'.repeat(64),
 'shadow amount':f=>f.raw.shadow[0].balance='11.0000','active version':f=>f.raw.active[0].version='2',
 'head version':f=>f.raw.heads[0].version='2','wrong checkpoint topic':f=>f.raw.checkpoints[0].topic='ld.other.finance.events.v1',
 'offset overflow':f=>f.raw.checkpoints[0].last_offset='9223372036854775807',
 'unknown checkpoint event':f=>f.raw.checkpoints[0].last_event='00000000-0000-4000-8000-000000000003',
 'non-live effects':f=>f.raw.nonLiveEffectPresent=true,'too many events':f=>f.raw.events=Array(1001).fill(f.raw.events[0]),
}
for(const[name,mutation]of Object.entries(cases))test(`reject ${name}`,async()=>{
 const f=fixture();mutation(f);await assert.rejects(collect(f),{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})
})
test('callback success cannot hide actual transaction COMMIT rejection; error is sanitized',async()=>{
 const f=fixture();f.db.$transaction=async work=>{await work({$executeRawUnsafe:async()=>0,$queryRawUnsafe:async sql=>sql.includes('FROM pg_catalog.pg_roles')?f.roles:sql.includes('FROM pg_catalog.pg_class')?f.access:sql.includes('set_config')?[]:[{snapshot:f.raw}]});throw new Error('secret database detail')}
 await assert.rejects(collect(f),{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})
})
test('input changes while awaiting cannot expand pinned Fund inventory',async()=>{
 const f=fixture(),base=f.db.$transaction
 f.db.$transaction=async(work,options)=>{f.scope.fundIds.push('other');return base(work,options)}
 const result=await collect(f);assert.equal(result.source.length,1)
})

for(const [field,value] of [['adapterVersion',2],['adapterVersion','1'],['buildId','wrong'],['codeSha','b'.repeat(40)],['sourceTopic','wrong'],['sourcePartition',1],['lastSourceOffset','1'],['lastSourceOffset',0],['lastEventId','wrong'],['lastEventAt','wrong']]) test(`worker provenance ${field} must match actual scope/inbox`,async()=>{
 const f=fixture();f.raw.shadow[0].worker_evidence[field]=value
 await assert.rejects(collect(f),{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})
})
test('checkpoint cannot invent a later duplicate position without durable position proof',async()=>{
 const f=fixture();f.raw.checkpoints[0].last_offset='1'
 await assert.rejects(collect(f),{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})
})
function twoPartitions(){
 const f=fixture(),first=f.raw.events[0],secondId='00000000-0000-4000-8000-000000000003'
 f.scope.fundIds.push('fund-b')
 f.raw.events.push({...first,id:secondId,fund:'fund-b',envelope:{...first.envelope,id:secondId,aggregateid:'fund-b'}})
 f.raw.funds.push({...f.raw.funds[0],id:'fund-b'})
 for(const name of ['heads','active','shadow']) f.raw[name].push({...f.raw[name][0],fund:'fund-b',last_event:secondId,...(name==='shadow'?{evidence_last_event:secondId,worker_evidence:{...f.raw.shadow[0].worker_evidence,lastEventId:secondId,sourcePartition:1}}:{})})
 f.raw.inbox.push({...f.raw.inbox[0],event:secondId,partition:1})
 f.raw.checkpoints.push({...f.raw.checkpoints[0],partition:1,last_event:secondId})
 f.reduce=(_,event)=>({organizationId:'org-a',fundId:event.aggregateid,balance:'10.0000',currency:'AZN',aggregateVersion:1,lastEventId:event.id,lastEventAt:'2026-10-19T00:00:00.000Z'})
 return f
}
test('two complete partition receipts retain exact event/position identity',async()=>{
 const f=twoPartitions();assert.equal((await collect(f)).checkpoints.length,2)
})
test('known events exchanged between complete partitions must not prove checkpoint delivery',async()=>{
 const f=twoPartitions();[f.raw.checkpoints[0].last_event,f.raw.checkpoints[1].last_event]=[f.raw.checkpoints[1].last_event,f.raw.checkpoints[0].last_event]
 await assert.rejects(collect(f),{message:'FUND_RECOVERY_SNAPSHOT_INVALID'})
})
