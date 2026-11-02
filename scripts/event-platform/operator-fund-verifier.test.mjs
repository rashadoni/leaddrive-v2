import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,generateKeyPairSync} from 'node:crypto'
import {createFundEvidenceVerifier} from './operator-fund-verifier.mjs'
import {signedFundAttestations} from './operator-fund-verifier.fixture.mjs'
function fixture() {
 const now='2026-10-19T00:00:10.000Z',requestId='11111111-1111-4111-8111-111111111111'
 const plan={organizationId:'org-a',buildId:'22222222-2222-4222-8222-222222222222',projectionName:'finance.fund-balance',releaseSha:'a'.repeat(40),artifactSha256:`sha256:${'b'.repeat(64)}`,environment:'staging',clusterId:'cluster-a',topicId:'topic-a',groupId:'group-a',action:'promote',expectedPointerVersion:'9007199254740993'}
 const state={aggregateId:'fund-a',eventCount:'1',aggregateVersion:'1',historyHash:`sha256:${'c'.repeat(64)}`,stateHash:`sha256:${'d'.repeat(64)}`,balance:'10.0000',currency:'AZN'}
 const manifest={apiVersion:'event-platform.leaddrive.io/v1',kind:'OperatorRecoveryEvidence',...plan,previousBuildId:'33333333-3333-4333-8333-333333333333',receiptId:'recovery-a',observedAt:now,soakStartedAt:'2026-10-18T23:58:00.000Z',targetEffectsFenced:true,externalEffectAttempts:'0',unresolvedQuarantine:'0',stop:{intakeStopped:true,acksFenced:true,sqlSettled:true,childClosed:true,actualCloseReceiptId:'close-a'},sourceHistoryComplete:true,archiveVerified:true,restoreReceiptId:'restore-a',independentApprovalReceiptId:'approval-a',partitions:[{partition:0,historyStart:'0',replayStart:'0',frozenEndExclusive:'9007199254740993',checkpointNext:'9007199254740993',archiveNext:'9007199254740993'}],source:[state],shadow:[{...state}]}
 const raw=JSON.stringify(manifest);plan.evidenceSha256=`sha256:${createHash('sha256').update(raw).digest('hex')}`
 const context={requestId,plan,planHash:'a'.repeat(64),generation:'9007199254740993',operatorPrincipals:['requester','approver','controller'],maxAgeMs:60000,minSoakMs:60000,partitionCount:1,previousBuildId:manifest.previousBuildId,retainedUntil:'2026-10-19T01:00:00.000Z',leaseUntil:'2026-10-19T00:02:00.000Z'}
 const captured={materialHash:'c'.repeat(64),snapshot:{kind:'FundRecoveryDatabaseSnapshot',organizationId:plan.organizationId,buildId:plan.buildId,codeSha:plan.releaseSha,observedAt:now,source:[{...state}],shadow:[{...state}],checkpoints:[{topic:'ld.staging.finance.events.v1',partition:0,nextOffset:'9007199254740993'}]}}
 const signing=signedFundAttestations(context,captured.materialHash,now),registrations=[]
 const config={readContext:async()=>context,readManifest:async()=>raw,readSnapshot:async()=>captured,readAttestation:async gate=>signing.packets[gate],readKey:async gate=>signing.keys[gate],register:async row=>registrations.push(row),clock:()=>now}
 return {now,requestId,context,captured,...signing,registrations,config}
}
const deny=f=>assert.rejects(createFundEvidenceVerifier(f.config)(f.requestId),{message:'FUND_VERIFIER_DENIED'})
test('valid independently signed complete provenance registers once with exact raw bytes and bigint pins',async()=>{
 const f=fixture();const result=await createFundEvidenceVerifier(f.config)(f.requestId)
 assert.equal(result.gateCount,7);assert.equal(f.registrations.length,1)
 assert.equal(f.registrations[0].generation,'9007199254740993');assert.equal(f.registrations[0].materialHash,f.captured.materialHash)
 assert.equal(f.registrations[0].validUntil,'2026-10-19T00:00:55.000Z');assert.ok(Object.isFrozen(f.registrations[0]))
})
const cases={
 'missing signed gate':f=>delete f.packets.archive,
 'corrupt signature':f=>f.packets.stop.signature='A'.repeat(86)+'==',
 'unsigned tampered bytes':f=>f.packets.restore.raw=f.packets.restore.raw.replace('verified','pending'),
 'unknown key':f=>f.keys.broker.keyId='other',
 'disabled signer':f=>f.keys.soak.enabled=false,
 'operator signer':f=>f.keys.approval.principalId='controller',
 'wrong key purpose':f=>f.keys.alerts.gate='stop',
 'wrong key tenant':f=>f.keys.alerts.organizationId='org-b',
 'expired key':f=>f.keys.archive.validUntil=f.now,
 'future key':f=>f.keys.broker.validFrom='2026-10-19T00:01:00.000Z',
 'oversized packet':f=>f.packets.restore.raw='x'.repeat(65537),
 'manifest corruption':f=>f.config.readManifest=async()=>'{"status":"verified"}',
 'source parity forged in manifest':f=>f.captured.snapshot.source[0].balance='11.0000',
 'shadow parity forged in manifest':f=>f.captured.snapshot.shadow[0].stateHash=`sha256:${'e'.repeat(64)}`,
 'wrong snapshot tenant':f=>f.captured.snapshot.organizationId='org-b',
 'wrong snapshot build':f=>f.captured.snapshot.buildId='other',
 'wrong snapshot release':f=>f.captured.snapshot.codeSha='e'.repeat(40),
 'missing checkpoint':f=>f.captured.snapshot.checkpoints=[],
 'wrong checkpoint position':f=>f.captured.snapshot.checkpoints[0].nextOffset='9007199254740992',
 'numeric checkpoint':f=>f.captured.snapshot.checkpoints[0].nextOffset=9007199254740992,
 'no material fingerprint':f=>delete f.captured.materialHash,
 'expired lease':f=>f.context.leaseUntil=f.now,
 'numeric generation':f=>f.context.generation=1,
 'wrong request context':f=>f.context.requestId='22222222-2222-4222-8222-222222222222',
 'wrong signature key type':f=>f.keys.stop.publicKeyPem=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({type:'spki',format:'pem'}),
}
for(const [name,mutate]of Object.entries(cases))test(`reject ${name} without registration`,async()=>{const f=fixture();mutate(f);await deny(f);assert.equal(f.registrations.length,0)})
for(const [name,mutate]of Object.entries({
 'wrong request':r=>r.requestId='other', 'wrong generation':r=>r.generation='1','wrong manifest':r=>r.evidenceSha256=`sha256:${'e'.repeat(64)}`,'wrong material':r=>r.materialHash='e'.repeat(64),'pending observation':r=>r.result='pending','expired receipt':r=>r.validUntil=r.observedAt,'future observation':r=>r.observedAt='2026-10-19T00:01:00.000Z','wrong signer':r=>r.principalId='other','wrong gate':r=>r.gate='alerts','duplicate receipt':r=>r.receiptId='synthetic-receipt-stop',
})) test(`reject authentic signature with ${name}`,async()=>{const f=fixture();f.resign('restore',mutate);await deny(f);assert.equal(f.registrations.length,0)})
test('earlier key revocation/rotation during a later asynchronous fetch denies',async()=>{
 for(const mutate of [f=>f.keys.stop.enabled=false,f=>f.keys.stop.publicKeyPem=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})]){
  const f=fixture(),read=f.config.readAttestation
  f.config.readAttestation=async(...a)=>{if(a[0]==='alerts')mutate(f);return read(...a)}
  await deny(f);assert.equal(f.registrations.length,0)
 }
})
test('caller context mutation across adapter await cannot alter authority',async()=>{
 const f=fixture(),read=f.config.readManifest
 f.config.readManifest=async(...a)=>{f.context.plan.organizationId='org-b';f.context.operatorPrincipals.push('synthetic-observer');return read(...a)}
 assert.equal((await createFundEvidenceVerifier(f.config)(f.requestId)).gateCount,7)
})
test('clock advance while fetching final key denies before registration',async()=>{
 const f=fixture();let reads=0;const read=f.config.readKey
 f.config.readKey=async(...a)=>{reads++;if(reads>7)f.config.clock=()=>f.now;return read(...a)}
 let ticks=0;f.config.clock=()=>++ticks>8?'2026-10-19T00:01:10.000Z':f.now
 await deny(f);assert.equal(f.registrations.length,0)
})
test('private adapter errors are sanitized and no registry fallback occurs',async()=>{
 for(const key of ['readContext','readManifest','readSnapshot','readAttestation','readKey','register']){
  const f=fixture();f.config[key]=async()=>{throw new Error('private backend details')};await deny(f)
 }
})
