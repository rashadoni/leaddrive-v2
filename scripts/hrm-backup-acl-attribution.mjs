import * as backupFs from "node:fs"
import { createHash as backupCreateHash } from "node:crypto"
import { spawn as backupSpawn, execFileSync as backupExec } from "node:child_process"
import { pathToFileURL as backupPathToFileURL } from "node:url"
import { databaseConnectionEnvironment, readRootFile, parseMigrationEnv } from "./hrm-migration-metadata-preflight.mjs"
import { parseApplicationEnv, validateAclData } from "./hrm-default-acl-inspection.mjs"
import { inspectLiveAclRemote, validateLiveReport, validateLiveSnapshot, queryLiveMigration } from "./hrm-loopback-acl-inspection.mjs"

export const BACKUP_LIMITS = Object.freeze([
  "Supplemental catalog and protected declared-identity evidence only; READ_COMPLETE is not ACL approval or release readiness",
  "Original metadata, declared-host and live-loopback gates and previous failures remain unchanged",
  "Configured backup identity and catalog settings do not prove fresh backup authentication, commissioning, service operation or restore",
  "defaultReadOnly observes an explicit role/database override; absence does not prove a server-wide default",
  "No backup password file, third connection, service, dump or business rows accessed",
  "No role names, database identifiers, private probe values, configuration values or credentials exported",
  "No production files, grants, role configuration, tenant activation or business data mutated",
])
export const BACKUP_CODES = Object.freeze(["INPUT_INVALID","FILES_UNSAFE","SOURCE_CHANGED","ENV_INVALID","OUTPUT_INVALID","ARTIFACT_MISMATCH","DATABASE_MISMATCH","BACKUP_INSPECTION_FAILED"])
const backupFail = code => { throw new Error(code) }
const backupHash = bytes => backupCreateHash("sha256").update(bytes).digest("hex")
const backupExact = (v,keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",")===keys.split(",").sort().join(",")
const backupSha = /^[0-9a-f]{40}$/
const backupDigest = /^[0-9a-f]{64}$/
const backupRole = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/
const backupMax = 131072
const backupBools = "declaredRolePresent,separateFromRuntimeAndMigration,noSuperuser,bypassRls,canLogin,noCreateDb,noCreateRole,noInherit,noReplication,defaultReadOnly"
const backupCounts = "outboundMemberships,inboundMemberships,setPrivilegedCount,otherPrivilegeRows,matchedOtherPrivilegeRows,otherSelectRows,otherWriteRows,otherGrantableRows,otherRecipientCount,matchedOtherRecipientCount"

/** Read static shell declarations without sourcing the file or interpreting expansions. */
export function parseBackupDeclarations(text) {
  if(typeof text!=="string" || Buffer.byteLength(text)>65536 || text.includes("\0"))backupFail("ENV_INVALID")
  const selected={PGUSER:[],BACKUP_EXPECTED_DB_ROLE:[],PGDATABASE:[]}
  for(const line of text.split(/\r?\n/)) {
    if(/^\s*(?:#.*)?$/.test(line))continue
    const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if(!m)backupFail("ENV_INVALID")
    let value=m[2]
    if(value.startsWith("'")) {
      if(!/^'[^']*'$/.test(value))backupFail("ENV_INVALID")
      value=value.slice(1,-1)
    } else if(value.startsWith('"')) {
      if(!/^"[^"$`\\]*"$/.test(value))backupFail("ENV_INVALID")
      value=value.slice(1,-1)
    } else if(!/^[^\s#'"$`\\;&|()<>]*$/.test(value))backupFail("ENV_INVALID")
    if(Object.hasOwn(selected,m[1]))selected[m[1]].push(value)
  }
  if(Object.values(selected).some(v=>v.length!==1) || !backupRole.test(selected.PGUSER[0]) || selected.PGUSER[0]!==selected.BACKUP_EXPECTED_DB_ROLE[0])backupFail("ENV_INVALID")
  const database=selected.PGDATABASE[0]
  if(!database || Buffer.byteLength(database)>63 || /[\x00-\x20\x7f]/.test(database))backupFail("ENV_INVALID")
  return {role:selected.PGUSER[0],database}
}

function backupGroup() {
  try {
    const value=backupExec("getent",["group","leaddrive-backup"],{env:{PATH:"/usr/bin:/bin",LC_ALL:"C"},encoding:"utf8",timeout:1000,maxBuffer:4096,stdio:["ignore","pipe","ignore"]}).trim()
    const parts=value.split(":")
    if(parts.length!==4 || parts[0]!=="leaddrive-backup" || !/^[0-9]{1,10}$/.test(parts[2]) || Number(parts[2])>4294967295)backupFail("FILES_UNSAFE")
    return Number(parts[2])
  } catch {backupFail("FILES_UNSAFE")}
}

/** Same canonical file and modes accepted by the normal deployment backup contract. */
export function readBackupDeclarations(io=backupFs,lookupGroup=backupGroup) {
  const path="/etc/leaddrive/backup.env"
  const before=io.lstatSync(path),mode=before.mode&0o777
  if(![0o600,0o640].includes(mode) || before.uid!==0 || !before.isFile() || before.isSymbolicLink())backupFail("FILES_UNSAFE")
  if(mode===0o640 && before.gid!==lookupGroup())backupFail("FILES_UNSAFE")
  const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,s.uid,s.gid].join(":")
  const text=readRootFile(path,65536,mode,io)
  if(signature(before)!==signature(io.lstatSync(path)) || mode===0o640 && before.gid!==lookupGroup())backupFail("SOURCE_CHANGED")
  return {text,profile:mode===0o600?"ROOT_0600":"ROOT_BACKUP_0640"}
}

export function validateBackupSnapshot(value) {
  if(!backupExact(value,"snapshot,attribution"))backupFail("OUTPUT_INVALID")
  validateLiveSnapshot(value.snapshot,"migration")
  validateBackupAcl(value.attribution,value.snapshot.acl)
  return value
}

function validateBackupAcl(a,acl) {
  validateAclData(acl)
  validateBackupAttribution(a)
  const other=acl.entries.filter(e=>e.recipient==="OTHER")
  const count=entries=>entries.reduce((n,e)=>n+e.rowCount,0)
  if(a.otherPrivilegeRows!==count(other) || a.otherSelectRows!==count(other.filter(e=>e.privilege==="SELECT")) || a.otherWriteRows!==count(other.filter(e=>["INSERT","UPDATE","DELETE","TRUNCATE","TRIGGER","REFERENCES"].includes(e.privilege))) || a.otherGrantableRows!==count(other.filter(e=>e.grantable)))backupFail("OUTPUT_INVALID")
  return a
}

function validateBackupAttribution(a) {
  if(!backupExact(a,backupBools+","+backupCounts) || backupBools.split(",").some(k=>typeof a[k]!=="boolean") || backupCounts.split(",").some(k=>!Number.isSafeInteger(a[k]) || a[k]<0 || a[k]>10000))backupFail("OUTPUT_INVALID")
  if(a.matchedOtherPrivilegeRows>a.otherPrivilegeRows || a.otherSelectRows>a.otherPrivilegeRows || a.otherWriteRows>a.otherPrivilegeRows || a.otherGrantableRows>a.otherPrivilegeRows || a.matchedOtherRecipientCount>a.otherRecipientCount || a.matchedOtherRecipientCount>1 || a.otherRecipientCount>a.otherPrivilegeRows || (a.matchedOtherRecipientCount===0)!==(a.matchedOtherPrivilegeRows===0) || !a.declaredRolePresent && (a.matchedOtherRecipientCount!==0 || a.defaultReadOnly))backupFail("OUTPUT_INVALID")
  return a
}

export function validateBackupReport(report,sha) {
  if(!backupSha.test(sha) || !backupExact(report,"version,status,expectedMainSha,productionArtifactSha,bindings,live,backup,cleanup,limits,code") || report.version!==1 || report.expectedMainSha!==sha || !["READ_COMPLETE","ERROR"].includes(report.status) || !["NOT_STARTED","PASS","FAILED"].includes(report.cleanup) || !backupExact(report.bindings,"baseHelperSha256,aclHelperSha256,liveHelperSha256,liveSqlSha256,helperSha256,sqlSha256") || Object.values(report.bindings).some(v=>typeof v!=="string" || !backupDigest.test(v)) || JSON.stringify(report.limits)!==JSON.stringify(BACKUP_LIMITS))backupFail("OUTPUT_INVALID")
  if(report.live!==null) {
    validateLiveReport(report.live,sha)
    const b=report.bindings,l=report.live.bindings
    if(b.baseHelperSha256!==l.baseHelperSha256 || b.aclHelperSha256!==l.aclHelperSha256 || b.liveHelperSha256!==l.helperSha256 || b.liveSqlSha256!==l.sqlSha256 || report.cleanup!==report.live.cleanup)backupFail("OUTPUT_INVALID")
  }
  if(report.status==="ERROR") {
    if(!BACKUP_CODES.includes(report.code) || report.productionArtifactSha!==null || report.backup!==null)backupFail("OUTPUT_INVALID")
  } else {
    const b=report.backup
    if(report.code!==null || report.productionArtifactSha!==sha || report.cleanup!=="PASS" || !report.live || report.live.status!=="READ_COMPLETE" || !backupExact(b,"protectedFileProfile,databaseMatchesRuntime,declaredUserMatchesExpectedRole,attribution") || !["ROOT_0600","ROOT_BACKUP_0640"].includes(b.protectedFileProfile) || b.databaseMatchesRuntime!==true || b.declaredUserMatchesExpectedRole!==true)backupFail("OUTPUT_INVALID")
    validateBackupAcl(b.attribution,report.live.proof.acl)
  }
  return report
}

export async function inspectBackupAclRemote(liveSql,sql,bindings,sha,deps={}) {
  const report={version:1,status:"ERROR",expectedMainSha:sha,productionArtifactSha:null,bindings,live:null,backup:null,cleanup:"NOT_STARTED",limits:BACKUP_LIMITS,code:"BACKUP_INSPECTION_FAILED"}
  try {
    if(!backupSha.test(sha) || (deps.uid??process.getuid())!==0)backupFail("INPUT_INVALID")
    const read=deps.read??readRootFile,readBackup=deps.readBackup??readBackupDeclarations
    const initial=readBackup(),declared=parseBackupDeclarations(initial.text)
    if(!["ROOT_0600","ROOT_BACKUP_0640"].includes(initial.profile))backupFail("FILES_UNSAFE")
    const appText=read("/etc/leaddrive/app.env",65536,0o600)
    const migrationText=read("/etc/leaddrive/migration.env",32768,0o600)
    const runtime=databaseConnectionEnvironment(parseApplicationEnv(appText))
    if(declared.database!==runtime.PGDATABASE)backupFail("DATABASE_MISMATCH")
    let attribution
    const query=deps.queryMigration??((connection,statement,probe,role)=>queryLiveMigration(connection,statement,probe,(cmd,args,opts)=>backupSpawn(cmd,args,{...opts,env:{...opts.env,PGOPTIONS:opts.env.PGOPTIONS+" -c hrm.backup_expected_role="+role}})))
    const queryWrapper=async(connection,_statement,probe)=>{
      const raw=await query(connection,sql,probe,declared.role)
      if(typeof raw!=="string" || Buffer.byteLength(raw)>backupMax || raw.trim().split("\n").length!==1)backupFail("OUTPUT_INVALID")
      let value
      try {value=JSON.parse(raw)} catch {backupFail("OUTPUT_INVALID")}
      validateBackupSnapshot(value);attribution=value.attribution
      return JSON.stringify(value.snapshot)
    }
    const liveBindings={baseHelperSha256:bindings.baseHelperSha256,aclHelperSha256:bindings.aclHelperSha256,helperSha256:bindings.liveHelperSha256,sqlSha256:bindings.liveSqlSha256}
    const stableRead=(path,limit,mode)=>{
      const text=read(path,limit,mode)
      if(path==="/etc/leaddrive/app.env" && text!==appText || path==="/etc/leaddrive/migration.env" && text!==migrationText)backupFail("SOURCE_CHANGED")
      return text
    }
    report.live=await inspectLiveAclRemote(liveSql,liveBindings,sha,{...deps,read:stableRead,queryMigration:queryWrapper})
    report.cleanup=report.live.cleanup
    if(report.live.status!=="READ_COMPLETE")backupFail("BACKUP_INSPECTION_FAILED")
    const final=readBackup()
    if(final.text!==initial.text || final.profile!==initial.profile)backupFail("SOURCE_CHANGED")
    if(read("/opt/leaddrive-v2/.next/standalone/.deploy-sha",128).trim()!==sha)backupFail("ARTIFACT_MISMATCH")
    stableRead("/etc/leaddrive/app.env",65536,0o600)
    stableRead("/etc/leaddrive/migration.env",32768,0o600)
    report.backup={protectedFileProfile:initial.profile,databaseMatchesRuntime:true,declaredUserMatchesExpectedRole:true,attribution}
    report.status="READ_COMPLETE";report.productionArtifactSha=sha;report.code=null
  } catch(error) {
    report.status="ERROR";report.productionArtifactSha=null;report.backup=null
    report.code=BACKUP_CODES.includes(error?.message)?error.message:"BACKUP_INSPECTION_FAILED"
  }
  return validateBackupReport(report,sha)
}

const backupImports=[
  'import { databaseConnectionEnvironment, readRootFile, parseMigrationEnv } from "./hrm-migration-metadata-preflight.mjs"',
  'import { parseApplicationEnv, validateAclData } from "./hrm-default-acl-inspection.mjs"',
  'import { inspectLiveAclRemote, validateLiveReport, validateLiveSnapshot, queryLiveMigration } from "./hrm-loopback-acl-inspection.mjs"',
]
async function backupMain() {
  const files=["hrm-migration-metadata-preflight.mjs","hrm-default-acl-inspection.mjs","hrm-loopback-acl-inspection.mjs","hrm-loopback-acl-inspection.sql","hrm-backup-acl-attribution.mjs","hrm-backup-acl-attribution.sql"]
  const bytes=files.map(file=>backupFs.readFileSync(new URL("./"+file,import.meta.url)))
  const bindings=Object.fromEntries(["baseHelperSha256","aclHelperSha256","liveHelperSha256","liveSqlSha256","helperSha256","sqlSha256"].map((key,i)=>[key,backupHash(bytes[i])]))
  if(process.argv[2]==="--emit-remote" && process.argv.length===3) {
    const strip=(data,imports)=>{let source=data.toString("utf8");for(const line of imports){if(source.split("\n").filter(x=>x===line).length!==1)backupFail("SOURCE_CHANGED");source=source.split("\n").filter(x=>x!==line).join("\n")}return source}
    process.stdout.write(bytes[0].toString("utf8")+"\n"+strip(bytes[1],[backupImports[0]])+"\n"+strip(bytes[2],backupImports.slice(0,2))+"\n"+strip(bytes[4],backupImports)+"\nconst backupResult=await inspectBackupAclRemote("+JSON.stringify(bytes[3].toString("utf8"))+","+JSON.stringify(bytes[5].toString("utf8"))+","+JSON.stringify(bindings)+",process.env.EXPECTED_MAIN_SHA);\nconsole.log(JSON.stringify(backupResult));\nif(backupResult.status!=='READ_COMPLETE')process.exitCode=1;\n")
  } else if(process.argv[2]==="--validate-output" && process.argv.length===4) {
    let raw=""
    for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>backupMax)backupFail("OUTPUT_INVALID")}
    const report=validateBackupReport(JSON.parse(raw),process.argv[3])
    if(JSON.stringify(report.bindings)!==JSON.stringify(bindings))backupFail("SOURCE_CHANGED")
    process.stdout.write(JSON.stringify(report,null,2)+"\n")
  } else backupFail("INPUT_INVALID")
}
if(process.argv[1] && import.meta.url===backupPathToFileURL(process.argv[1]).href)backupMain().catch(()=>{console.error("HRM backup ACL output invalid; raw data withheld");process.exitCode=1})
