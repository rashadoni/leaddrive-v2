import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateFundCanaryRead } from './operator-fund-canary.mjs'
const buildId='11111111-1111-4111-8111-111111111111'
function fixture() {
  const scope={enabled:true,organizationId:'org-a',buildId,buildKey:'canary',pointerVersion:'9007199254740993',projectionVersion:2,codeSha:'a'.repeat(40),fundIds:['fund-a']}
  const snapshot={pointer:{organizationId:'org-a',projectionName:'finance.fund-balance',activeBuildId:buildId,activationVersion:scope.pointerVersion},build:{organizationId:'org-a',id:buildId,projectionName:'finance.fund-balance',buildKey:'canary',projectionVersion:2,codeSha:scope.codeSha,mode:'shadow',status:'promoted',effectsFenced:true,replayFrom:null,replayTo:null},rows:[{organizationId:'org-a',fundId:'fund-a',buildId,buildKey:'canary',projectionVersion:2,status:'shadow',aggregateVersion:'7',lastEventId:buildId,balance:'50.1234',currency:'AZN'}]}
  return {scope,snapshot}
}
test('exact opted-in immutable result preserves bigint version and decimal money',()=>{
  const {scope,snapshot}=fixture(), result=validateFundCanaryRead(scope,snapshot)
  assert.equal(result.pointerVersion,'9007199254740993'); assert.equal(result.funds[0].balance,'50.1234')
  snapshot.rows[0].balance='0.0000'; assert.equal(result.funds[0].balance,'50.1234')
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.funds)&&Object.isFrozen(result.funds[0]))
})
const mutations={
  disabled:f=>f.scope.enabled=false,
  tenant:f=>f.snapshot.pointer.organizationId='org-b',
  rollback:f=>f.snapshot.pointer.activeBuildId='22222222-2222-4222-8222-222222222222',
  stalePointer:f=>f.snapshot.pointer.activationVersion='9007199254740994',
  numericPointer:f=>f.snapshot.pointer.activationVersion=9007199254740992,
  wrongBuildTenant:f=>f.snapshot.build.organizationId='org-b',
  wrongCode:f=>f.snapshot.build.codeSha='b'.repeat(40),
  running:f=>f.snapshot.build.status='running',
  effects:f=>f.snapshot.build.effectsFenced=false,
  replay:f=>f.snapshot.build.replayFrom='0',
  missing:f=>f.snapshot.rows=[],
  duplicate:f=>{f.scope.fundIds.push('fund-b');f.snapshot.rows.push({...f.snapshot.rows[0]})},
  unexpected:f=>f.snapshot.rows[0].fundId='fund-b',
  foreignTenant:f=>f.snapshot.rows[0].organizationId='org-b',
  foreignBuild:f=>f.snapshot.rows[0].buildId='22222222-2222-4222-8222-222222222222',
  staleProjection:f=>f.snapshot.rows[0].projectionVersion=1,
  wrongKey:f=>f.snapshot.rows[0].buildKey='other',
  negativeMoney:f=>f.snapshot.rows[0].balance='-1.0000',
  roundedMoney:f=>f.snapshot.rows[0].balance=50.1234,
  excessiveMoney:f=>f.snapshot.rows[0].balance='100000000000000.0000',
  badVersion:f=>f.snapshot.rows[0].aggregateVersion='9223372036854775808',
  rawError:f=>Object.defineProperty(f.snapshot,'pointer',{get(){throw new Error('private payload')}}),
}
for(const [name,mutate] of Object.entries(mutations)) test(`reject ${name} without fallback or payload disclosure`,()=>{
  const f=fixture();mutate(f);assert.throws(()=>validateFundCanaryRead(f.scope,f.snapshot),{message:'FUND_CANARY_READ_INVALID'})
})
