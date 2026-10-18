import {createHash,createPublicKey,verify} from 'node:crypto'
import {validateOperatorRecoveryEvidence} from './operator-recovery-evidence.mjs'

export const FUND_PROVENANCE_GATES=Object.freeze(['stop','broker','soak','archive','restore','approval','alerts'])
const check=x=>{if(!x)throw new Error('FUND_VERIFIER_DENIED')}
const digest=x=>createHash('sha256').update(x,'utf8').digest('hex')
const instant=x=>typeof x==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString()===x
const hex=x=>typeof x==='string' && /^[0-9a-f]{64}$/.test(x)
const token=x=>typeof x==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(x)
const sorted=rows=>[...rows].sort((a,b)=>a.aggregateId.localeCompare(b.aggregateId))
const fields=['aggregateId','eventCount','aggregateVersion','historyHash','stateHash','balance','currency']
const statesEqual=(a,b)=>Array.isArray(a) && Array.isArray(b) && a.length===b.length && sorted(a).every((x,i)=>fields.every(k=>x[k]===sorted(b)[i][k]))

/** Inactive server-only composition. Only a request ID crosses its public
 * boundary. Every adapter/key/clock comes from trusted service configuration;
 * no HTTP routes, credentials, URLs, fallback fixture or live senders here.
 * readSnapshot MUST capture materialHash in the SAME RR transaction as the
 * canonical collector. readKey MUST read current independently managed key
 * policy (including revocation); keys are never fetched from signed input.
 * Signers attest the precise manifest, not arbitrary operator booleans. Their
 * physical instrumentation, provisioning and real observations are external
 * prerequisites; synthetic signatures prove this protocol only.
 */
export function createFundEvidenceVerifier(config) {
  const {readContext,readManifest,readSnapshot,readAttestation,readKey,register,clock}=config
  for(const fn of [readContext,readManifest,readSnapshot,readAttestation,readKey,register,clock]) check(typeof fn==='function')
  return async requestId=>{
    try {
      check(typeof requestId==='string' && /^[0-9a-f-]{36}$/.test(requestId))
      const context=structuredClone(await readContext(requestId)),plan=context.plan
      check(context.requestId===requestId && hex(context.planHash) && typeof context.generation==='string' && /^[1-9][0-9]{0,18}$/.test(context.generation) && BigInt(context.generation)<=9223372036854775807n)
      check(Array.isArray(context.operatorPrincipals) && context.operatorPrincipals.length===3 && context.operatorPrincipals.every(token))
      const raw=await readManifest(plan.evidenceSha256)
      let now=clock();check(instant(now))
      validateOperatorRecoveryEvidence(raw,{...context,now})
      const manifest=JSON.parse(raw)
      const captured=structuredClone(await readSnapshot(structuredClone(context))),s=captured.snapshot
      now=clock();check(instant(now))
      check(hex(captured.materialHash) && s?.kind==='FundRecoveryDatabaseSnapshot')
      check(s.organizationId===plan.organizationId && s.buildId===plan.buildId && s.codeSha===plan.releaseSha)
      check(instant(s.observedAt) && Date.parse(s.observedAt)<=Date.parse(now) && Date.parse(s.observedAt)>=Date.parse(now)-context.maxAgeMs)
      check(statesEqual(s.source,manifest.source) && statesEqual(s.shadow,manifest.shadow))
      check(Array.isArray(s.checkpoints) && s.checkpoints.length===manifest.partitions.length)
      const partitions=new Map(manifest.partitions.map(p=>[p.partition,p])),seen=new Set()
      for(const c of s.checkpoints) {
        check(!seen.has(c.partition) && c.topic===`ld.${plan.environment}.finance.events.v1` && partitions.get(c.partition)?.checkpointNext===c.nextOffset)
        seen.add(c.partition)
      }
      const pins={requestId,planHash:context.planHash,generation:context.generation,evidenceSha256:plan.evidenceSha256,materialHash:captured.materialHash}
      check(instant(context.leaseUntil) && Date.parse(context.leaseUntil)>Date.parse(now))
      const records=[],ids=new Set();let expiry=Math.min(Date.parse(now)+60000,Date.parse(context.leaseUntil))
      for(const gate of FUND_PROVENANCE_GATES) {
        const packet=structuredClone(await readAttestation(gate,structuredClone(pins)))
        check(packet && token(packet.keyId) && typeof packet.raw==='string' && Buffer.byteLength(packet.raw)<=65536)
        check(typeof packet.signature==='string' && /^[A-Za-z0-9+/]{86}==$/.test(packet.signature))
        // Key lookup is controlled by the fixed gate and trusted key registry.
        const key=structuredClone(await readKey(gate,packet.keyId));now=clock();check(instant(now))
        const publicKey=createPublicKey(key.publicKeyPem)
        check(publicKey.asymmetricKeyType==='ed25519' && key.enabled===true && key.gate===gate && key.keyId===packet.keyId)
        check(token(key.principalId) && !context.operatorPrincipals.includes(key.principalId))
        check(instant(key.validFrom) && instant(key.validUntil) && Date.parse(key.validFrom)<=Date.parse(now) && Date.parse(now)<Date.parse(key.validUntil))
        check(verify(null,Buffer.from(packet.raw,'utf8'),publicKey,Buffer.from(packet.signature,'base64')))
        const receipt=JSON.parse(packet.raw)
        check(receipt.kind==='FundOperationalAttestation' && receipt.apiVersion==='event-platform.leaddrive.io/v1' && receipt.gate===gate && receipt.principalId===key.principalId && receipt.result==='verified')
        for(const [k,v] of Object.entries(pins))check(receipt[k]===v)
        check(token(receipt.receiptId) && !ids.has(receipt.receiptId));ids.add(receipt.receiptId)
        check(instant(receipt.observedAt) && instant(receipt.validUntil) && Date.parse(key.validFrom)<=Date.parse(receipt.observedAt))
        check(Date.parse(now)-context.maxAgeMs<=Date.parse(receipt.observedAt) && Date.parse(receipt.observedAt)<=Date.parse(now) && Date.parse(receipt.validUntil)>Date.parse(now) && Date.parse(receipt.validUntil)<=Date.parse(key.validUntil))
        expiry=Math.min(expiry,Date.parse(receipt.validUntil),Date.parse(key.validUntil))
        records.push({gate,keyId:packet.keyId,principalId:key.principalId,keyHash:digest(key.publicKeyPem),validFrom:key.validFrom,validUntil:key.validUntil,hash:digest(packet.raw)})
      }
      // Re-read key policy after all asynchronous adapters, so a revoked or
      // remapped earlier key cannot survive a later receipt fetch.
      for(const record of records) {
        const key=await readKey(record.gate,record.keyId)
        check(key.enabled===true && key.principalId===record.principalId && key.gate===record.gate && key.keyId===record.keyId && instant(key.validUntil) && instant(key.validFrom) && Date.parse(key.validFrom)<=Date.parse(now) && digest(key.publicKeyPem)===record.keyHash && key.validFrom===record.validFrom && key.validUntil===record.validUntil)
        expiry=Math.min(expiry,Date.parse(key.validUntil))
      }
      now=clock();check(instant(now) && expiry>Date.parse(now))
      validateOperatorRecoveryEvidence(raw,{...context,now})
      const retainedUntil=plan.action==='rollback'?manifest.rollback.windowEndsAt:context.retainedUntil
      check(instant(retainedUntil) && Date.parse(retainedUntil)>Date.parse(now))
      // The named-verifier SQL endpoint must independently recheck current
      // principals/lease/generation, enforce one registration and bound expiry.
      await register(Object.freeze({...pins,raw,previousBuildId:context.previousBuildId,validUntil:new Date(expiry).toISOString(),retainedUntil,provenanceHash:digest(JSON.stringify(records))}))
      return Object.freeze({kind:'FundEvidenceRegistered',requestId,evidenceSha256:plan.evidenceSha256,gateCount:records.length})
    } catch {throw new Error('FUND_VERIFIER_DENIED')}
  }
}
