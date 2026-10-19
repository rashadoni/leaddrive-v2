import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyOperatorRecoveryStop} from './operator-stop-evidence.mjs'
function fixture() {
 const plan={organizationId:'org-a',buildId:'build-a',projectionName:'finance.fund-balance',releaseSha:'a'.repeat(40),artifactSha256:`sha256:${'b'.repeat(64)}`,environment:'staging',clusterId:'cluster-a',topicId:'topic-a',groupId:'group-a',action:'promote',expectedPointerVersion:'2'}
 const state={aggregateId:'fund-a',eventCount:'1',aggregateVersion:'1',historyHash:`sha256:${'c'.repeat(64)}`,stateHash:`sha256:${'d'.repeat(64)}`,balance:'10.0000',currency:'AZN'}
 const manifest={apiVersion:'event-platform.leaddrive.io/v1',kind:'OperatorRecoveryEvidence',...plan,previousBuildId:'build-old',receiptId:'recovery-a',observedAt:'2026-10-19T00:00:00.000Z',soakStartedAt:'2026-10-18T23:58:00.000Z',targetEffectsFenced:true,externalEffectAttempts:'0',unresolvedQuarantine:'0',stop:{intakeStopped:true,acksFenced:true,sqlSettled:true,childClosed:true,actualCloseReceiptId:'close-a'},sourceHistoryComplete:true,archiveVerified:true,restoreReceiptId:'restore-a',independentApprovalReceiptId:'approval-a',partitions:[{partition:0,historyStart:'0',replayStart:'0',frozenEndExclusive:'9007199254740993',checkpointNext:'9007199254740993',archiveNext:'9007199254740993'}],source:[state],shadow:[{...state}]}
 const stop={receiptId:'close-a',requestId:'stop-request-a',generation:'9007199254740993',workerInstanceId:'worker-a',challengeId:'challenge-a',observerId:'observer-a'}
 const expected={plan,stop,now:'2026-10-19T00:00:10.000Z',maxAgeMs:60000,minSoakMs:60000,partitionCount:1,previousBuildId:'build-old'}
 const receipt={apiVersion:'event-platform.leaddrive.io/v1',kind:'WorkerStopReceipt',...plan,...stop,termination:'closed',inFlightSql:'0',pendingAcks:'0',activeChildren:'0',requestedAt:'2026-10-18T23:59:40.000Z',intakeStoppedAt:'2026-10-18T23:59:41.000Z',ackFencedAt:'2026-10-18T23:59:42.000Z',sqlSettledAt:'2026-10-18T23:59:43.000Z',checkpointObservedAt:'2026-10-18T23:59:44.000Z',childClosedAt:'2026-10-18T23:59:45.000Z',observedAt:'2026-10-18T23:59:46.000Z',partitions:[{partition:0,checkpointNext:'9007199254740993'}]}
 const pin=()=>{const raw=JSON.stringify(manifest);plan.evidenceSha256=`sha256:${createHash('sha256').update(raw).digest('hex')}`;return raw}
 return {plan,manifest,expected,receipt,pin}
}
const deny=p=>assert.rejects(p,{message:'OPERATOR_STOP_EVIDENCE_INVALID'})
test('reads exact independent close receipt and preserves bigint scope',async()=>{
 const f=fixture(),reads=[]
 const result=await verifyOperatorRecoveryStop(f.pin(),f.expected,async id=>{reads.push(id);return f.receipt})
 assert.deepEqual(reads,['close-a']);assert.equal(result.generation,'9007199254740993');assert.ok(Object.isFrozen(result))
 assert.equal(result.partitionCount,1);assert.equal(result.kind,'RecoveryStopReadBack')
})
const cases={
 'wrong tenant':f=>f.receipt.organizationId='org-b',
 'wrong build':f=>f.receipt.buildId='build-b',
 'wrong release':f=>f.receipt.releaseSha='e'.repeat(40),
 'wrong artifact':f=>f.receipt.artifactSha256=`sha256:${'e'.repeat(64)}`,
 'wrong cluster':f=>f.receipt.clusterId='other',
 'wrong topic incarnation':f=>f.receipt.topicId='other',
 'wrong group':f=>f.receipt.groupId='other',
 'wrong environment':f=>f.receipt.environment='other',
 'stale pointer':f=>f.receipt.expectedPointerVersion='1',
 'wrong request':f=>f.receipt.requestId='other',
 'wrong lease':f=>f.receipt.generation='1',
 'numeric lease':f=>f.receipt.generation=9007199254740992,
 'wrong process':f=>f.receipt.workerInstanceId='other',
 'wrong challenge':f=>f.receipt.challengeId='other',
 'wrong observer':f=>f.receipt.observerId='other',
 'wrong receipt':f=>f.receipt.receiptId='other',
 'unclosed child':f=>f.receipt.termination='stopping',
 'pending SQL':f=>f.receipt.inFlightSql='1',
 'pending ACK':f=>f.receipt.pendingAcks='1',
 'active children':f=>f.receipt.activeChildren='1',
 'numeric zero':f=>f.receipt.inFlightSql=0,
 'stale stop':f=>f.receipt.requestedAt='2026-10-18T23:58:00.000Z',
 'after manifest':f=>f.receipt.observedAt='2026-10-19T00:00:01.000Z',
 'bad chronology':f=>f.receipt.childClosedAt=f.receipt.intakeStoppedAt,
 'checkpoint before settlement':f=>f.receipt.checkpointObservedAt=f.receipt.ackFencedAt,
 'invalid calendar':f=>f.receipt.observedAt='2026-02-30T00:00:00.000Z',
 'missing stage':f=>delete f.receipt.ackFencedAt,
 'missing partition':f=>f.receipt.partitions=[],
 'duplicate partition':f=>f.receipt.partitions.push({...f.receipt.partitions[0]}),
 'wrong partition':f=>f.receipt.partitions[0].partition=1,
 'wrong checkpoint':f=>f.receipt.partitions[0].checkpointNext='9007199254740992',
 'numeric checkpoint':f=>f.receipt.partitions[0].checkpointNext=9007199254740992,
 'wrong receipt kind':f=>f.receipt.kind='OperatorRecoveryEvidence',
}
for(const [name,mutate] of Object.entries(cases)) test(`reject ${name}`,async()=>{
 const f=fixture();mutate(f);await deny(verifyOperatorRecoveryStop(f.pin(),f.expected,async()=>f.receipt))
})
test('invalid manifest or independent stop pins prevent any adapter reads',async()=>{
 for(const mutate of [f=>f.manifest.stop.sqlSettled=false,f=>f.expected.stop.receiptId='different',f=>f.expected.stop.generation='0',f=>delete f.expected.stop.observerId]) {
  const f=fixture();mutate(f);let reads=0
  await deny(verifyOperatorRecoveryStop(f.pin(),f.expected,async()=>{reads++;return f.receipt}));assert.equal(reads,0)
 }
})
test('adapter failures or missing record are sanitized',async()=>{
 const f=fixture(),raw=f.pin()
 for(const read of [async()=>{throw new Error('private provider data')},async()=>null]) await deny(verifyOperatorRecoveryStop(raw,f.expected,read))
})
test('independent expected values cannot change across asynchronous readback',async()=>{
 const f=fixture(),raw=f.pin()
 await deny(verifyOperatorRecoveryStop(raw,f.expected,async()=>{
  f.expected.plan.organizationId='org-b';f.receipt.organizationId='org-b';return f.receipt
 }))
})
test('complete partitions compare by identity, not provider ordering',async()=>{
 const f=fixture();f.expected.partitionCount=2
 f.manifest.partitions.push({...f.manifest.partitions[0],partition:1,checkpointNext:'7',frozenEndExclusive:'7',archiveNext:'7'})
 f.receipt.partitions.unshift({partition:1,checkpointNext:'7'})
 assert.equal((await verifyOperatorRecoveryStop(f.pin(),f.expected,async()=>f.receipt)).partitionCount,2)
})
test('rollback consistency and retained-build checks still apply before readback',async()=>{
 const f=fixture();f.plan.action='rollback';f.manifest.action='rollback'
 f.manifest.rollback={retainedBuildId:f.plan.buildId,compatibilityVerified:true,windowEndsAt:'2026-10-19T01:00:00.000Z',writeFenceApplied:true}
 assert.equal((await verifyOperatorRecoveryStop(f.pin(),f.expected,async()=>f.receipt)).receiptId,'close-a')
 f.manifest.rollback.writeFenceApplied=false;let reads=0
 await deny(verifyOperatorRecoveryStop(f.pin(),f.expected,async()=>{reads++;return f.receipt}));assert.equal(reads,0)
})
test('tampered raw bytes and oversized observer record fail closed',async()=>{
 const f=fixture(),raw=f.pin();let reads=0
 await deny(verifyOperatorRecoveryStop(raw+'\n',f.expected,async()=>{reads++;return f.receipt}));assert.equal(reads,0)
 await deny(verifyOperatorRecoveryStop(raw,f.expected,async()=>({...f.receipt,body:'x'.repeat(65536)})))
})
