import { validateOperatorRecoveryEvidence } from './operator-recovery-evidence.mjs'
const check = value => { if (!value) throw new Error('OPERATOR_STOP_EVIDENCE_INVALID') }
const token = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)
const uint = value => typeof value==='string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value)<=9223372036854775807n
const instant = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value

/** Inactive read-only composition. Independent trusted scope/observer and
 * readReceipt come from server code, never operator request callbacks/URLs.
 * The observer must attest actual process/SQL/ACK closure; claimed JSON or a
 * mock adapter is not operational proof. No observer, stop signal, controller,
 * challenge consumption, broker connection, status change or activation here.
 * Historical closure does not exclude a later writer: recheck current lease and
 * final source barrier in the pointer-mutation transaction. Adapter must bound
 * response bytes before decoding; the gate also caps the JSON record at 64 KiB.
 */
export async function verifyOperatorRecoveryStop(raw,input,readReceipt) {
  try {
    // Freeze all expected values before the asynchronous trust boundary.
    const expected=structuredClone(input)
    const recovery=validateOperatorRecoveryEvidence(raw,expected)
    const manifest=JSON.parse(raw), stop=expected.stop
    check(typeof readReceipt==='function' && stop)
    for(const key of ['receiptId','requestId','workerInstanceId','challengeId','observerId']) check(token(stop[key]))
    check(uint(stop.generation) && stop.generation!=='0')
    check(manifest.stop.actualCloseReceiptId===stop.receiptId)
    const fetched=await readReceipt(stop.receiptId)
    check(fetched && Buffer.byteLength(JSON.stringify(fetched))<=65536)
    const receipt=structuredClone(fetched)
    check(receipt?.apiVersion==='event-platform.leaddrive.io/v1' && receipt.kind==='WorkerStopReceipt')
    for(const key of ['receiptId','requestId','workerInstanceId','challengeId','observerId','generation']) check(receipt[key]===stop[key])
    for(const key of ['organizationId','buildId','projectionName','releaseSha','artifactSha256','environment','clusterId','topicId','groupId','expectedPointerVersion']) check(receipt[key]===expected.plan[key])
    check(receipt.termination==='closed' && receipt.inFlightSql==='0' && receipt.pendingAcks==='0' && receipt.activeChildren==='0')
    const times=['requestedAt','intakeStoppedAt','ackFencedAt','sqlSettledAt','checkpointObservedAt','childClosedAt','observedAt'].map(key=>{
      check(instant(receipt[key]));return Date.parse(receipt[key])
    })
    const now=Date.parse(expected.now)
    check(now-expected.maxAgeMs<=times[0] && times.at(-1)<=Date.parse(manifest.observedAt))
    for(let i=1;i<times.length;i++) check(times[i-1]<=times[i])
    check(Array.isArray(receipt.partitions) && receipt.partitions.length===expected.partitionCount)
    const checkpoints=new Map(manifest.partitions.map(p=>[p.partition,p.checkpointNext])),seen=new Set()
    for(const p of receipt.partitions) {
      check(Number.isInteger(p.partition) && !seen.has(p.partition) && checkpoints.has(p.partition) && uint(p.checkpointNext))
      seen.add(p.partition);check(p.checkpointNext===checkpoints.get(p.partition))
    }
    return Object.freeze({kind:'RecoveryStopReadBack',receiptId:stop.receiptId,requestId:stop.requestId,generation:stop.generation,
      workerInstanceId:stop.workerInstanceId,evidenceSha256:recovery.evidenceSha256,partitionCount:seen.size})
  } catch { throw new Error('OPERATOR_STOP_EVIDENCE_INVALID') }
}
