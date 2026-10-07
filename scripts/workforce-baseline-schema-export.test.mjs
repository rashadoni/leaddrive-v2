import { test } from 'node:test'
import assert from 'node:assert/strict'
import { minimizeBaselineCatalog, validateBaselineProvenance } from './workforce-baseline-schema-export.mjs'

const digest='a'.repeat(64)
const provenance={sourceKind:'ISOLATED_RESTORED_COPY',backupArtifactSha256:digest,restoreReceiptSha256:digest,sourceRevision:'b'.repeat(40),restoredAt:'2026-10-06T00:00:00Z'}
const raw=()=>({format:'workforce-baseline-catalog-v1',observedAt:provenance.restoredAt,serverVersion:'160010',encoding:'UTF8',inRecovery:false,databaseFingerprint:digest,collationFingerprint:digest,apiKeysExists:true,apiKeysRelationKind:'r',ledgerRelationKind:'r',ledgerVisibilityVerified:true,
  rls:{enabled:false,forced:false,ownerReference:digest},columns:[{position:1,name:'id',type:'text',notNull:true,identity:'',generated:'',defaultCollation:true,defaultKind:'NONE',defaultSha256:null}],constraints:[],indexes:[],policies:[],triggers:[],acl:[],ledger:[]})
const minimize=x=>minimizeBaselineCatalog(x,provenance,new Map([['known',digest]]))
test('column fragment explicitly cannot establish a historical executable baseline',()=>{
  const result=minimize(raw())
  assert.equal(result.completeness.executableBaseline,false)
  assert.equal(result.provenanceVerification,'OPERATOR_SUPPLIED_NOT_VERIFIED')
  assert.equal(result.apiKeys.structuralColumnsDdl,'CREATE TABLE public.api_keys (\n  "id" text NOT NULL\n);')
})
test('absent api_keys is evidence of absence, never reconstructed from Prisma',()=>{
  const x=raw();x.apiKeysExists=false;x.apiKeysRelationKind=null;x.rls=null;x.columns=[]
  assert.equal(minimize(x).status,'API_KEYS_ABSENT');assert.equal(minimize(x).apiKeys.structuralColumnsDdl,null)
})
test('unknown identifiers, defaults and extra raw fields cannot reach output',()=>{
  const x=raw();x.columns[0].name='PRIVATE-CANARY';x.columns[0].defaultKind='PRIVATE-CANARY';x.columns[0].defaultSha256=digest
  x.comment='PRIVATE-CANARY';x.logs='PRIVATE-CANARY';x.roleName='PRIVATE-CANARY';x.columns[0].extra='PRIVATE-CANARY'
  const result=minimize(x);assert.equal(result.apiKeys.structuralColumnsDdl,null)
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CANARY'))
})
test('generated or differently collated columns cannot masquerade as equivalent DDL',()=>{
  for(const patch of [{generated:'s'},{identity:'a'},{defaultCollation:false}]){
    const x=raw();Object.assign(x.columns[0],patch);assert.equal(minimize(x).apiKeys.structuralColumnsDdl,null)
  }
})
test('preserves incomplete, rolled-back and duplicate ledger records without logs',()=>{
  const x=raw();const row={name:'known',checksum:digest,startedAt:provenance.restoredAt,finishedAt:null,rolledBackAt:null,appliedSteps:0,logs:'PRIVATE-CANARY'}
  x.ledger=[row,{...row,rolledBackAt:provenance.restoredAt},{...row,name:'PRIVATE-CANARY',checksum:'c'.repeat(64)}]
  const result=minimize(x);assert.equal(result.ledger.length,3);assert.equal(result.ledger[0].finishedAt,null)
  assert.equal(result.ledger[0].repositoryMatch,true);assert.equal(result.ledger[2].repositoryMatch,null)
  assert.ok(!JSON.stringify(result).includes('PRIVATE-CANARY'))
})
test('refuses filtered ledger, collection truncation and malformed checksum',()=>{
  for(const patch of [{ledgerVisibilityVerified:false},{ledger:new Array(5001).fill({})},{ledger:[{checksum:'secret'}]}])assert.throws(()=>minimize({...raw(),...patch}),/EXPORT_INVALID/)
})
test('provenance accepts only bounded opaque receipts and a revision, never credential paths',()=>{
  assert.deepEqual(validateBaselineProvenance(provenance),provenance)
  for(const patch of [{url:'postgres://PRIVATE-CANARY'},{sourceRevision:'PRIVATE-CANARY'},{backupArtifactSha256:'PRIVATE-CANARY'},{sourceKind:'PRODUCTION'}])assert.throws(()=>validateBaselineProvenance({...provenance,...patch}),/EXPORT_INVALID/)
})

 test('refuses views, foreign/partitioned relations and impossible calendar timestamps',()=>{
   for(const patch of [{apiKeysRelationKind:'v'},{ledgerRelationKind:'v'},{apiKeysRelationKind:'f'},{ledgerRelationKind:'p'}])assert.throws(()=>minimize({...raw(),...patch}),/EXPORT_INVALID/)
   for(const restoredAt of ['2026-99-99T99:99:99Z','2026-02-29T00:00:00Z','2026-10-06T24:00:00Z','2026-10-06T00:00:00+14:01'])assert.throws(()=>validateBaselineProvenance({...provenance,restoredAt}),/EXPORT_INVALID/)
 })
 test('policy target roles remain distinct even when counts and expressions are unchanged',()=>{
   const x=raw();x.policies=[{command:'r',permissive:true,roleCount:1,roleReferences:[digest],definitionSha256:digest}]
   const before=minimize(x);x.policies[0].roleReferences=['d'.repeat(64)]
   assert.notDeepEqual(minimize(x).apiKeys.policies,before.apiKeys.policies)
 })
