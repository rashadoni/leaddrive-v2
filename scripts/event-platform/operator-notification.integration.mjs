// Real HTTP delivery to a separate disposable process with fsynced read-back.
// Controlled test triggers/machine ACK, not production alert rule/human proof.
import test from 'node:test'
import assert from 'node:assert/strict'
import {fork,execFileSync} from 'node:child_process'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {mkdtemp,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createOperatorAlertReadBack} from './operator-alert-http.mjs'
import {OPERATOR_ALERT_GATES,verifyOperatorAlertEvidence} from './operator-alert-evidence.mjs'
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.LD_OPERATOR_DISPOSABLE,'1')
assert.ok(process.env.RUNNER_TEMP?.startsWith('/'))
const directory=await mkdtemp(join(process.env.RUNNER_TEMP,'operator-notifications-'))
const scope={environment:'staging',releaseSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 changeId:`ci-${randomUUID()}`,challengeId:randomUUID(),destinationId:'disposable-receiver',responderId:'independent-test-responder'}
const tokens=Object.fromEntries(['sender','reader','responder'].map(k=>[k,randomBytes(32).toString('hex')]))
const config={scope,tokens,path:join(directory,'receipts.jsonl')}
let child,origin,read
async function start(restore=false){
 child=fork(new URL('./operator-notification-receiver.fixture.mjs',import.meta.url),[],{
  env:{GITHUB_ACTIONS:'true',LD_OPERATOR_DISPOSABLE:'1',RUNNER_TEMP:process.env.RUNNER_TEMP},stdio:['ignore','ignore','pipe','ipc']})
 child.stderr.resume()
 const ready=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('RECEIVER_START_DEADLINE'))},5000)
  child.once('error',()=>{clearTimeout(timer);reject(new Error('RECEIVER_START_FAILED'))})
  child.once('exit',()=>{clearTimeout(timer);reject(new Error('RECEIVER_EARLY_EXIT'))})
  child.once('message',v=>{clearTimeout(timer);resolve(v)});child.send({...config,restore})
 })
 assert.equal(ready.pid,child.pid);assert.notEqual(ready.pid,process.pid)
 assert.ok(Number.isInteger(ready.port)&&ready.port>0&&ready.port<65536)
 origin=`http://127.0.0.1:${ready.port}`
 read=createOperatorAlertReadBack({origin,bearerToken:tokens.reader,disposableLoopback:true})
}
async function stop(){if(child?.exitCode===null)await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('RECEIVER_STOP_DEADLINE'))},5000)
 child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('RECEIVER_STOP_FAILED'))});child.send('stop')
})}
const post=(path,actor,body)=>fetch(origin+path,{method:'POST',headers:{authorization:`Bearer ${tokens[actor]}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(3000)})
const evidence={apiVersion:'event-platform.leaddrive.io/v1',kind:'KafkaOperatorAlertEvidence',...scope,
 receipts:OPERATOR_ALERT_GATES.map(gate=>({gate,receiptId:`delivery-${randomUUID()}`}))}
const expected=()=>({...scope,now:new Date().toISOString(),maxAgeMs:60000})
const manifest=evidence.receipts.map(item=>({...scope,...item,triggeredAt:new Date().toISOString()}))
let failed=false
async function scenario(name,work){await test(name,async()=>{try{await work()}catch(error){failed=true;throw error}})}
try{
 await start()
 await scenario('actual separate receiver durably receives all ten controlled test alerts; accepted is not acknowledged',async()=>{
  for(const body of manifest)assert.equal((await post('/alerts','sender',body)).status,202)
  assert.equal((await read(manifest[0].receiptId)).acknowledged,false)
  await assert.rejects(verifyOperatorAlertEvidence(evidence,expected(),read),{message:'OPERATOR_ALERT_EVIDENCE_INVALID'})
 })
 await scenario('sender/reader cannot forge responder authority; authenticated responder ACK is observed independently',async()=>{
  assert.equal((await post('/ack','sender',{receiptId:manifest[0].receiptId})).status,403)
  assert.equal((await post('/ack','reader',{receiptId:manifest[0].receiptId})).status,403)
  assert.equal((await post('/alerts','reader',manifest[0])).status,403)
  for(const body of manifest)assert.equal((await post('/ack','responder',{receiptId:body.receiptId,responderId:'forged-body-actor'})).status,200)
  const result=await verifyOperatorAlertEvidence(evidence,expected(),read)
  assert.equal(result.gateCount,10);assert.equal((await read(manifest[0].receiptId)).responderId,scope.responderId)
 })
 await scenario('repeated delivery/ACK is idempotent and changed payload/scope cannot overwrite receipt',async()=>{
  const before=await readFile(config.path),hash=createHash('sha256').update(before).digest('hex')
  assert.equal((await post('/alerts','sender',manifest[0])).status,200)
  assert.equal((await post('/ack','responder',{receiptId:manifest[0].receiptId})).status,200)
  assert.equal((await post('/alerts','sender',{...manifest[0],gate:manifest[1].gate})).status,409)
  assert.equal((await post('/alerts','sender',{...manifest[0],challengeId:'other'})).status,403)
  await assert.rejects(verifyOperatorAlertEvidence(evidence,{...expected(),destinationId:'other'},read))
  assert.equal(createHash('sha256').update(await readFile(config.path)).digest('hex'),hash)
  assert.equal(before.toString().trim().split('\n').length,20)
 })
 await scenario('independent read-back refuses missing/auth/redirect/oversized/chunked/invalid responses',async()=>{
  for(const id of ['missing','probe-redirect','probe-large','probe-chunked','probe-bad-json','probe-bad-utf8'])await assert.rejects(read(id),{message:'OPERATOR_ALERT_READBACK_DENIED'})
  const unauthorized=createOperatorAlertReadBack({origin,bearerToken:randomBytes(32).toString('hex'),disposableLoopback:true})
  await assert.rejects(unauthorized(manifest[0].receiptId),{message:'OPERATOR_ALERT_READBACK_DENIED'})
 })
 await scenario('actual receiver restart preserves fsynced delivery/ACK receipts for readonly verification',async()=>{
  const before=await readFile(config.path);await stop();await start(true)
  assert.equal((await verifyOperatorAlertEvidence(evidence,expected(),read)).gateCount,10)
  assert.deepEqual(await readFile(config.path),before)
 })
 assert.equal(failed,false,'every physical drill scenario must succeed before issuing receipt')
 console.log('operator_notification_delivery=PASS; scope=disposable-http; controlled_triggers=10; independent_machine_ack=PASS; receiver_restart=PASS; production_rules_human_paging=NOT_PROVEN')
}finally{await stop()}
