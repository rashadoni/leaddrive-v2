import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const hash = value => createHash('sha256').update(String(value)).digest('hex')
const fields = new Set(['id','organizationId','name','keyHash','keyPrefix','scopes','lastUsedAt','expiresAt','isActive','createdBy','createdAt','updatedAt','createdByApiKeyId'])
const tables = new Set(['api_keys','organizations','webhooks'])
const types = new Set(['text','text[]','boolean','timestamp(3) without time zone'])
const fail = () => { throw new Error('WORKFORCE_BASELINE_EXPORT_INVALID') }
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const date = value => {
  if (value === null) return true
  if (typeof value !== 'string' || value.length>32) return false
  const m=/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(value)
  if (!m) return false
  const [,y,mo,d,h,mi,se,zone]=m
  const year=Number(y),month=Number(mo),day=Number(d)
  const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31]
  if (year<1||month<1||month>12||day<1||day>days[month-1]||Number(h)>23||Number(mi)>59||Number(se)>59) return false
  if (zone!=='Z') { const z=zone.slice(1).replace(':',''); if(Number(z.slice(0,2))>14||Number(z.slice(2)||0)>59||(Number(z.slice(0,2))===14&&Number(z.slice(2)||0)!==0))return false }
  return true
}

export function validateBaselineProvenance(p) {
  const keys = ['sourceKind','backupArtifactSha256','restoreReceiptSha256','sourceRevision','restoredAt']
  if (!p || Object.keys(p).some(k => !keys.includes(k)) || keys.some(k => !(k in p))
    || p.sourceKind !== 'ISOLATED_RESTORED_COPY' || !sha(p.backupArtifactSha256) || !sha(p.restoreReceiptSha256)
    || !/^[a-f0-9]{40}$/.test(p.sourceRevision) || !date(p.restoredAt) || p.restoredAt === null) fail()
  return p
}

/** Raw catalog expressions/function bodies never leave PostgreSQL: only hashes
 * are selected. Comments, role names and migration logs are not selected.
 * Unknown identifier/type values are replaced by fingerprints.
 * This minimized first package is deliberately NOT an executable full baseline.
 */
export function minimizeBaselineCatalog(raw, provenance, repositoryMigrations) {
  validateBaselineProvenance(provenance)
  if (raw?.format !== 'workforce-baseline-catalog-v1' || !date(raw.observedAt) || raw.observedAt === null
    || !/^\d{6}$/.test(raw.serverVersion) || raw.encoding !== 'UTF8' || typeof raw.inRecovery !== 'boolean'
    || !sha(raw.databaseFingerprint) || !sha(raw.collationFingerprint) || typeof raw.apiKeysExists !== 'boolean'
    || raw.ledgerVisibilityVerified !== true || raw.ledgerRelationKind !== 'r'
    || (raw.apiKeysExists ? raw.apiKeysRelationKind !== 'r' : raw.apiKeysRelationKind !== null)) fail()
  const omitted = []
  const known = (value, allowed, label) => allowed.has(value) ? value : (omitted.push(label), `OMITTED:${hash(value)}`)
  const collection = (key, limit) => { const a=raw[key]; if (!Array.isArray(a)||a.length>limit) fail(); return a }
  const bool = v => { if (typeof v !== 'boolean') fail(); return v }
  const fingerprint = v => { if (!sha(v)) fail(); return v }
  const columns = collection('columns',100).map(c => {
    if (!Number.isInteger(c.position)||c.position<1||c.position>1600) fail()
    const name=known(c.name,fields,'columnName'),type=known(c.type,types,'columnType')
    const defaultKind=known(c.defaultKind,new Set(['NONE','true','false','now()','CURRENT_TIMESTAMP']),'defaultExpression')
    const identity=known(c.identity,new Set(['','a','d']),'identityKind'),generated=known(c.generated,new Set(['','s','v']),'generatedKind')
    if (identity!==''||generated!=='') omitted.push('identityOrGeneratedColumn')
    if (!bool(c.defaultCollation)) omitted.push('nonDefaultColumnCollation')
    return {position:c.position,name,type,notNull:bool(c.notNull),defaultKind,identity,generated,defaultCollation:c.defaultCollation,
      defaultSha256:c.defaultSha256===null?null:fingerprint(c.defaultSha256)}
  })
  const constraints=collection('constraints',200).map(c => ({
    kind:known(c.kind,new Set(['p','f','u','c','x']),'constraintKind'),
    schema:known(c.schema,new Set(['public']),'dependencySchema'),relation:known(c.relation,tables,'dependencyTable'),
    columns:(Array.isArray(c.columns)?c.columns:fail()).map(x=>known(x,fields,'constraintColumn')),
    referenceSchema:c.referenceSchema===null?null:known(c.referenceSchema,new Set(['public']),'referenceSchema'),
    referenceRelation:c.referenceRelation===null?null:known(c.referenceRelation,tables,'referenceTable'),
    referenceColumns:(Array.isArray(c.referenceColumns)?c.referenceColumns:fail()).map(x=>known(x,fields,'referenceColumn')),
    onUpdate:known(c.onUpdate,new Set(['a','r','c','n','d',' ']),'updateRule'),
    onDelete:known(c.onDelete,new Set(['a','r','c','n','d',' ']),'deleteRule'),
    matchType:known(c.matchType,new Set(['s','f','p',' ']),'matchRule'),
    deferrable:bool(c.deferrable),deferred:bool(c.deferred),validated:bool(c.validated),onTarget:bool(c.onTarget),definitionSha256:fingerprint(c.definitionSha256),
  }))
  const indexes=collection('indexes',100).map(i=>({primary:bool(i.primary),unique:bool(i.unique),valid:bool(i.valid),ready:bool(i.ready),
    method:known(i.method,new Set(['btree','hash','gist','spgist','gin','brin']),'indexMethod'),
    columns:(Array.isArray(i.columns)?i.columns:fail()).map(x=>known(x,fields,'indexColumn')),
    expressions:bool(i.expressions),predicate:bool(i.predicate),definitionSha256:fingerprint(i.definitionSha256)}))
  const policies=collection('policies',100).map(p=>{
    if (!Number.isInteger(p.roleCount)||p.roleCount<0||p.roleCount>1000) fail()
    if (!Array.isArray(p.roleReferences)||p.roleReferences.length!==p.roleCount) fail()
    return {roleReferences:p.roleReferences.map(fingerprint),command:known(p.command,new Set(['*','r','a','w','d']),'policyCommand'),permissive:bool(p.permissive),roleCount:p.roleCount,definitionSha256:fingerprint(p.definitionSha256)}
  })
  const triggers=collection('triggers',100).map(t=>{
    if (!Number.isInteger(t.argumentCount)||t.argumentCount<0||t.argumentCount>1000) fail()
    return {enabled:known(t.enabled,new Set(['O','D','R','A']),'triggerState'),internal:bool(t.internal),argumentCount:t.argumentCount,
      definitionSha256:fingerprint(t.definitionSha256),functionSha256:fingerprint(t.functionSha256)}
  })
  const acl=collection('acl',1000).map(a=>({roleReference:fingerprint(a.roleReference),
    privilege:known(a.privilege,new Set(['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']),'privilege'),grantable:bool(a.grantable)}))
  const ledger=collection('ledger',5000).map(l=>{
    if (!sha(l.checksum)||!date(l.startedAt)||!date(l.finishedAt)||!date(l.rolledBackAt)||!Number.isInteger(l.appliedSteps)||l.appliedSteps<0) fail()
    const expected=repositoryMigrations.get(l.name)
    if (!expected) omitted.push('unknownMigrationName')
    return {name:expected?l.name:`OMITTED:${hash(l.name)}`,checksum:l.checksum,repositoryChecksum:expected??null,
      repositoryMatch:expected?l.checksum===expected:null,startedAt:l.startedAt,finishedAt:l.finishedAt,rolledBackAt:l.rolledBackAt,appliedSteps:l.appliedSteps}
  })
  const rls=raw.rls===null?null:{enabled:bool(raw.rls.enabled),forced:bool(raw.rls.forced),ownerReference:fingerprint(raw.rls.ownerReference)}
  if (raw.apiKeysExists!==(rls!==null)||raw.apiKeysExists!==(columns.length>0)) fail()
  const structuralColumnsDdl = columns.every(c=>!c.name.startsWith('OMITTED:')&&!c.type.startsWith('OMITTED:')&&!c.defaultKind.startsWith('OMITTED:')&&c.identity===''&&c.generated===''&&c.defaultCollation)
    ? `CREATE TABLE public.api_keys (\n${columns.map(c=>`  "${c.name}" ${c.type}${c.notNull?' NOT NULL':''}${c.defaultKind==='NONE'?'':` DEFAULT ${c.defaultKind}`}`).join(',\n')}\n);`
    : null
  return {format:'workforce-baseline-minimized-v1',status:raw.apiKeysExists?'PARTIAL_SCHEMA_EVIDENCE':'API_KEYS_ABSENT',provenance,
    provenanceVerification:'OPERATOR_SUPPLIED_NOT_VERIFIED',catalogScope:'API_KEYS_AND_DIRECT_FOREIGN_KEYS_NOT_TRANSITIVE_CLOSURE',relationKinds:{apiKeys:raw.apiKeysRelationKind,ledger:raw.ledgerRelationKind},
    observedAt:raw.observedAt,serverVersion:raw.serverVersion,encoding:raw.encoding,inRecovery:raw.inRecovery,
    databaseFingerprint:raw.databaseFingerprint,collationFingerprint:raw.collationFingerprint,
    apiKeys:{exists:raw.apiKeysExists,columns,structuralColumnsDdl:raw.apiKeysExists?structuralColumnsDdl:null,constraints,indexes,rls,policies,triggers,acl},ledger,
    omittedCategories:[...new Set(omitted)],
    completeness:{executableBaseline:false,ledger:'COMPLETE_UP_TO_5000_OR_EXPORT_REFUSED',rawData:'NOT_QUERIED',credentialValues:'NOT_EXPORTED',
      definitions:'Column-only DDL; constraints/indexes structural metadata and fingerprints. Policy/trigger/function bodies, comments, role names, collation names, custom types and unknown defaults require a separately reviewed schema-only supplement. Foreign dependency closure is not established.'}}
}

export function exportBaseline({provenancePath,outputPath,repositoryRoot}) {
  if (!process.env.PGSERVICE) throw new Error('WORKFORCE_BASELINE_SERVICE_REQUIRED')
  const provenance=validateBaselineProvenance(JSON.parse(readFileSync(provenancePath,'utf8')))
  const migrations=new Map(readdirSync(resolve(repositoryRoot,'prisma/migrations'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>{
    return [x.name,hash(readFileSync(resolve(repositoryRoot,'prisma/migrations',x.name,'migration.sql'),'utf8'))]
  }))
  const sql=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'workforce-baseline-schema-export.sql'),'utf8')
  const result=spawnSync('psql',['-X','--no-password','--quiet','--tuples-only','--no-align','--set','ON_ERROR_STOP=1'],
    {input:sql,encoding:'utf8',maxBuffer:2*1024*1024,timeout:30000,env:{...process.env,PGCONNECT_TIMEOUT:'5'}})
  if (result.error||result.status!==0) throw new Error('WORKFORCE_BASELINE_EXPORT_FAILED')
  const evidence=minimizeBaselineCatalog(JSON.parse(result.stdout),provenance,migrations)
  writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'})
  return {status:evidence.status,ledgerRows:evidence.ledger.length,executableBaseline:false}
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2)
    if (args.length!==3) throw new Error('WORKFORCE_BASELINE_ARGUMENTS_REQUIRED')
    console.log(JSON.stringify(exportBaseline({provenancePath:args[0],outputPath:args[1],repositoryRoot:args[2]})))
  } catch { console.error('WORKFORCE_BASELINE_EXPORT_REFUSED');process.exitCode=1 }
}
