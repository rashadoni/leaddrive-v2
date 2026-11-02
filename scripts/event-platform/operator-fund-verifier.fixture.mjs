// Test-only ephemeral signing material. Never configured by runtime code.
import {generateKeyPairSync,sign} from 'node:crypto'
import {FUND_PROVENANCE_GATES} from './operator-fund-verifier.mjs'
export function signedFundAttestations(context,materialHash,now) {
 const {privateKey,publicKey}=generateKeyPairSync('ed25519')
 const keys={},packets={}
 const expiry=new Date(Date.parse(now)+45000).toISOString()
 for(const gate of FUND_PROVENANCE_GATES) {
  const keyId=`synthetic-${context.requestId}-${gate}`,principalId='synthetic-observer'
  keys[gate]={organizationId:context.plan.organizationId,enabled:true,keyId,gate,principalId,publicKeyPem:publicKey.export({type:'spki',format:'pem'}),validFrom:new Date(Date.parse(now)-60000).toISOString(),validUntil:expiry}
  const receipt={apiVersion:'event-platform.leaddrive.io/v1',kind:'FundOperationalAttestation',gate,principalId,result:'verified',receiptId:`synthetic-receipt-${gate}`,requestId:context.requestId,planHash:context.planHash,generation:context.generation,evidenceSha256:context.plan.evidenceSha256,materialHash,observedAt:now,validUntil:expiry}
  const raw=JSON.stringify(receipt)
  packets[gate]={keyId,raw,signature:sign(null,Buffer.from(raw),privateKey).toString('base64')}
 }
 const resign=(gate,mutate)=>{const value=JSON.parse(packets[gate].raw);mutate(value);packets[gate].raw=JSON.stringify(value);packets[gate].signature=sign(null,Buffer.from(packets[gate].raw),privateKey).toString('base64')}
 return {keys,packets,resign}
}
