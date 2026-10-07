import * as liveFs from "node:fs"
import { createHash as liveHashCreate, randomBytes as liveRandomBytes } from "node:crypto"
import { spawn as liveSpawn } from "node:child_process"
import { lookup as liveLookup } from "node:dns/promises"
import { pathToFileURL as livePathToFileURL } from "node:url"
import { databaseConnectionEnvironment, readRootFile, parseMigrationEnv } from "./hrm-migration-metadata-preflight.mjs"
import { parseApplicationEnv, validateAclData } from "./hrm-default-acl-inspection.mjs"

export const LIVE_LIMITS = Object.freeze([
  "Supplemental catalog observation only; READ_COMPLETE is not ACL approval or release readiness",
  "Original metadata and strict declared-host ACL checks and their failures remain unchanged",
  "Unchanged configured loopback endpoints are proved against one simultaneously live runtime backend",
  "No role names, database identifiers, PID, private nonce, credentials or business rows exported",
  "OTHER recipients remain unidentified; no backup identity or authorization is inferred",
  "Read-only transactions have distinct snapshots; no reserved DDL quiet window or index timing is proved",
  "No production files, grants, role configuration, tenant activation or business data mutated",
])
export const LIVE_CODES = Object.freeze(["INPUT_INVALID","FILES_UNSAFE","SOURCE_CHANGED","ARTIFACT_MISMATCH","ENV_INVALID","NOT_EXPECTED_LOOPBACK","PRINCIPALS_EQUAL","PORT_OR_DATABASE_MISMATCH","QUERY_FAILED","IDENTITY_UNPROVED","PROFILE_UNPROVED","OUTPUT_INVALID","CLEANUP_UNPROVED","INSPECTION_FAILED"])
const LIVE_SHA = /^[0-9a-f]{40}$/
const LIVE_DIGEST = /^[0-9a-f]{64}$/
const LIVE_MAX = 65536
const liveFail = code => { throw new Error(code) }
const liveHash = b => liveHashCreate("sha256").update(b).digest("hex")
const liveExact = (v,k) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === k.split(",").sort().join(",")
const liveBools = (v,k) => k.split(",").every(x => typeof v[x] === "boolean")
const liveInt = (v,min=0,max=10000) => Number.isSafeInteger(v) && v>=min && v<=max
const liveProfile = p => liveExact(p,"present,noSuperuser,noBypassRls,canLogin,setPrivilegedCount") && liveBools(p,"present,noSuperuser,noBypassRls,canLogin") && liveInt(p.setPrivilegedCount)
const liveRuntimeSafe = p => p.present && p.noSuperuser && p.noBypassRls && p.canLogin && p.setPrivilegedCount===0
const liveMigrationSafe = p => p.present && p.noSuperuser && !p.noBypassRls && p.canLogin
const liveProfileEqual = (a,b) => ["present","noSuperuser","noBypassRls","canLogin","setPrivilegedCount"].every(k => a[k]===b[k])

/** Reject unreviewed topology before either connection; never rewrite a URL. */
export async function verifyLoopbackEndpoints(runtime,migration,lookup=liveLookup) {
  if (runtime.PGUSER===migration.PGUSER) liveFail("PRINCIPALS_EQUAL")
  if (runtime.PGPORT!==migration.PGPORT || runtime.PGDATABASE!==migration.PGDATABASE) liveFail("PORT_OR_DATABASE_MISMATCH")
  for (const host of new Set([runtime.PGHOST,migration.PGHOST])) {
    if (!["localhost","127.0.0.1","::1"].includes(host)) liveFail("NOT_EXPECTED_LOOPBACK")
    if (host==="localhost") {
      let timer
      try {
        const addresses = await Promise.race([lookup(host,{all:true}),new Promise((_,reject) => { timer=setTimeout(() => reject(new Error("NOT_EXPECTED_LOOPBACK")),2000) })])
        if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => !a || !["127.0.0.1","::1"].includes(a.address))) liveFail("NOT_EXPECTED_LOOPBACK")
      } catch { liveFail("NOT_EXPECTED_LOOPBACK") } finally { clearTimeout(timer) }
    }
  }
}

/** Private identifiers are validated/computed in memory, never copied to reports. */
export function validateLiveSnapshot(v,mode) {
  if (!liveExact(v,"mode,identity,roleProfile,acl") || !["runtime","migration"].includes(mode) || v.mode!==mode || !liveExact(v.identity,"expectedIdentity,sessionIdentityUnchanged,primary,readOnly,repeatableRead,probeNameVerified,backendPid,databaseOid,databaseName,liveRuntimeSeen") || !liveBools(v.identity,"expectedIdentity,sessionIdentityUnchanged,primary,readOnly,repeatableRead,probeNameVerified,liveRuntimeSeen") || typeof v.identity.backendPid!=="string" || !/^[1-9][0-9]{0,9}$/.test(v.identity.backendPid) || Number(v.identity.backendPid)>2147483647 || typeof v.identity.databaseOid!=="string" || !/^[1-9][0-9]{0,9}$/.test(v.identity.databaseOid) || Number(v.identity.databaseOid)>4294967295 || typeof v.identity.databaseName!=="string" || !v.identity.databaseName || Buffer.byteLength(v.identity.databaseName)>63 || /[\0\r\n]/.test(v.identity.databaseName) || !liveProfile(v.roleProfile)) liveFail("OUTPUT_INVALID")
  validateAclData(v.acl)
  if (mode==="runtime" && (v.acl.explicitPrivilegeRows!==0 || v.identity.liveRuntimeSeen!==false)) liveFail("OUTPUT_INVALID")
  return v
}
function liveParse(raw,mode) {
  if (typeof raw!=="string" || Buffer.byteLength(raw)>LIVE_MAX || raw.trim().split("\n").length!==1) liveFail("OUTPUT_INVALID")
  let parsed
  try { parsed=JSON.parse(raw) } catch { liveFail("OUTPUT_INVALID") }
  return validateLiveSnapshot(parsed,mode)
}

function liveConnection(connection,probe,mode) {
  const env=databaseConnectionEnvironment(connection)
  if (!probe || !/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(probe.runtimeRole) || !/^hrm_loopback_acl_[0-9a-f]{32}$/.test(probe.nonce) || !liveInt(probe.pid,0,2147483647)) liveFail("INPUT_INVALID")
  return {...env,PGAPPNAME:mode==="runtime"?probe.nonce:"hrm_loopback_acl_inspection",PGOPTIONS:"-c default_transaction_read_only=on -c application_name="+(mode==="runtime"?probe.nonce:"hrm_loopback_acl_inspection")+" -c hrm.live_expected_role="+env.PGUSER+" -c hrm.live_runtime_role="+probe.runtimeRole+" -c hrm.live_mode="+mode+" -c hrm.live_probe_name="+probe.nonce+" -c hrm.live_expected_pid="+probe.pid}
}
const liveArgs=["-X","-qAt","--no-password","-v","ON_ERROR_STOP=1","-v","VERBOSITY=sqlstate"]

/** Open stdin keeps the actual runtime transaction alive; no sleep or tempfile. */
export function startLiveRuntime(connection,sql,probe,spawn=liveSpawn) {
  return new Promise((resolve,reject) => {
    let child
    try { child=spawn("psql",liveArgs,{env:liveConnection(connection,probe,"runtime"),stdio:["pipe","pipe","ignore"]}) } catch { reject(new Error("QUERY_FAILED")); return }
    let output="",ready=false,finishing=false,closed=false,exitCode=null,fault=false,settled=false
    let resolveClose
    const closePromise=new Promise(r => { resolveClose=r })
    const kill=() => {
      child.kill("SIGKILL")
      if (!ready) {
        rejectFirst();clearTimeout(startup);clearTimeout(watchdog)
        child.stdin.destroy();child.stdout.destroy();child.unref()
      }
    }
    // Entire held connection is bounded even if the observing connection stalls.
    const watchdog=setTimeout(() => { fault=true; kill() },55000)
    const startup=setTimeout(() => { fault=true; kill() },25000)
    const rejectFirst=() => { if (!settled) { settled=true; reject(new Error("QUERY_FAILED")) } }
    child.on("error",() => { fault=true; rejectFirst() })
    child.stdin.on("error",() => { fault=true })
    child.stdout.setEncoding("utf8")
    child.stdout.on("data",chunk => {
      output+=chunk
      if (Buffer.byteLength(output)>LIVE_MAX || (ready && chunk.trim())) { fault=true; kill(); return }
      if (!ready && output.includes("\n")) {
        if (output.trim().split("\n").length!==1) { fault=true; kill(); return }
        ready=true; settled=true; clearTimeout(startup)
        resolve({raw:output,finish:async () => {
          if (finishing) liveFail("CLEANUP_UNPROVED")
          finishing=true
          const wasClosed=closed
          if (!closed) child.stdin.end("ROLLBACK;\n\\q\n")
          let timeout
          const ended=await Promise.race([closePromise.then(() => true),new Promise(r => { timeout=setTimeout(() => r(false),5000) })])
          clearTimeout(timeout)
          if (!ended) {
            fault=true;kill()
            let killTimeout
            await Promise.race([closePromise,new Promise(r => { killTimeout=setTimeout(r,1000) })])
            clearTimeout(killTimeout)
            if (!closed) { child.stdin.destroy();child.stdout.destroy();child.unref() }
          }
          clearTimeout(watchdog)
          if (wasClosed || fault || !ended || exitCode!==0 || output.trim().split("\n").length!==1) liveFail("CLEANUP_UNPROVED")
        }})
      }
    })
    child.on("close",code => { closed=true;exitCode=code;clearTimeout(startup);clearTimeout(watchdog);resolveClose();if(!ready)rejectFirst();else if(!finishing)fault=true })
    child.stdin.write(sql+"\n")
  })
}

/** Fresh migration snapshot observes the still-live runtime PID and private nonce. */
export function queryLiveMigration(connection,sql,probe,spawn=liveSpawn) {
  return new Promise((resolve,reject) => {
    let child
    try { child=spawn("psql",liveArgs,{env:liveConnection(connection,probe,"migration"),stdio:["pipe","pipe","ignore"]}) } catch { reject(new Error("QUERY_FAILED"));return }
    let output="",fault=false
    const abort=() => { fault=true;child.kill("SIGKILL");clearTimeout(timer);child.stdin.destroy();child.stdout.destroy();child.unref();reject(new Error("QUERY_FAILED")) }
    const timer=setTimeout(abort,25000)
    child.on("error",() => { fault=true;clearTimeout(timer);reject(new Error("QUERY_FAILED")) })
    child.stdin.on("error",() => { fault=true })
    child.stdout.setEncoding("utf8")
    child.stdout.on("data",chunk => { output+=chunk;if(Buffer.byteLength(output)>LIVE_MAX)abort() })
    child.on("close",code => { clearTimeout(timer);if(fault || code!==0)reject(new Error("QUERY_FAILED"));else resolve(output) })
    child.stdin.end(sql+"\nROLLBACK;\n")
  })
}

export function validateLiveReport(v,sha) {
  if (!LIVE_SHA.test(sha) || !liveExact(v,"version,status,expectedMainSha,productionArtifactSha,bindings,proof,cleanup,limits,code") || v.version!==1 || v.expectedMainSha!==sha || !["READ_COMPLETE","ERROR"].includes(v.status) || !liveExact(v.bindings,"baseHelperSha256,aclHelperSha256,helperSha256,sqlSha256") || !Object.values(v.bindings).every(x=>typeof x==="string" && LIVE_DIGEST.test(x)) || !["NOT_STARTED","PASS","FAILED"].includes(v.cleanup) || JSON.stringify(v.limits)!==JSON.stringify(LIVE_LIMITS)) liveFail("OUTPUT_INVALID")
  if (v.status==="ERROR") {
    if (!LIVE_CODES.includes(v.code) || v.productionArtifactSha!==null || v.proof!==null || (v.code==="CLEANUP_UNPROVED" && v.cleanup!=="FAILED")) liveFail("OUTPUT_INVALID")
  } else {
    const p=v.proof
    const keys="readOnlyBoth,repeatableReadBoth,expectedRuntimeSession,expectedMigrationSession,separatePrincipals,configuredHostsVerifiedLoopback,matchingPortAndDatabase,sameLiveDatabaseBackend,primaryBoth,businessRowsRead,declaredHostsEqual"
    if (v.code!==null || v.cleanup!=="PASS" || v.productionArtifactSha!==sha || !liveExact(p,keys+",runtimeProfile,migrationProfile,acl") || !liveBools(p,keys) || !keys.split(",").filter(k=>!["businessRowsRead","declaredHostsEqual"].includes(k)).every(k=>p[k]===true) || p.businessRowsRead!==false || !liveProfile(p.runtimeProfile) || !liveRuntimeSafe(p.runtimeProfile) || !liveProfile(p.migrationProfile) || !liveMigrationSafe(p.migrationProfile)) liveFail("OUTPUT_INVALID")
    validateAclData(p.acl)
    for (const e of p.acl.entries) if ((e.recipient==="EXPECTED_RUNTIME" && !liveProfileEqual(e.recipientProfile,p.runtimeProfile)) || (e.recipient==="OWNER" && !liveProfileEqual(e.recipientProfile,p.migrationProfile))) liveFail("OUTPUT_INVALID")
  }
  return v
}

export async function inspectLiveAclRemote(sql,bindings,sha,deps={}) {
  const report={version:1,status:"ERROR",expectedMainSha:sha,productionArtifactSha:null,bindings,proof:null,cleanup:"NOT_STARTED",limits:LIVE_LIMITS,code:"INSPECTION_FAILED"}
  let held,recheck,bodyFailure=null
  try {
    if (!LIVE_SHA.test(sha) || (deps.uid??process.getuid())!==0) liveFail("INPUT_INVALID")
    const read=deps.read??readRootFile,marker="/opt/leaddrive-v2/.next/standalone/.deploy-sha"
    if (read(marker,128).trim()!==sha) liveFail("ARTIFACT_MISMATCH")
    const appText=read("/etc/leaddrive/app.env",LIVE_MAX,0o600),migrationText=read("/etc/leaddrive/migration.env",32768,0o600)
    recheck=() => {
      if (read(marker,128).trim()!==sha) liveFail("ARTIFACT_MISMATCH")
      if (read("/etc/leaddrive/app.env",LIVE_MAX,0o600)!==appText || read("/etc/leaddrive/migration.env",32768,0o600)!==migrationText) liveFail("SOURCE_CHANGED")
    }
    let runtimeConnection,migrationConnection,runtimeEnv,migrationEnv
    try { runtimeConnection=parseApplicationEnv(appText);migrationConnection=parseMigrationEnv(migrationText);runtimeEnv=databaseConnectionEnvironment(runtimeConnection);migrationEnv=databaseConnectionEnvironment(migrationConnection) } catch { liveFail("ENV_INVALID") }
    await verifyLoopbackEndpoints(runtimeEnv,migrationEnv,deps.lookup??liveLookup)
    const probe={runtimeRole:runtimeEnv.PGUSER,nonce:"hrm_loopback_acl_"+(deps.nonce??(()=>liveRandomBytes(16).toString("hex")))(),pid:0}
    held=await (deps.startRuntime??startLiveRuntime)(runtimeConnection,sql,probe)
    if (!held || typeof held.finish!=="function") liveFail("OUTPUT_INVALID")
    const runtime=liveParse(held.raw,"runtime")
    for (const k of ["expectedIdentity","sessionIdentityUnchanged","primary","readOnly","repeatableRead","probeNameVerified"]) if (!runtime.identity[k]) liveFail("IDENTITY_UNPROVED")
    if (!liveRuntimeSafe(runtime.roleProfile)) liveFail("PROFILE_UNPROVED")
    probe.pid=Number(runtime.identity.backendPid)
    const migration=liveParse(await (deps.queryMigration??queryLiveMigration)(migrationConnection,sql,probe),"migration")
    for (const k of ["expectedIdentity","sessionIdentityUnchanged","primary","readOnly","repeatableRead","probeNameVerified","liveRuntimeSeen"]) if (!migration.identity[k]) liveFail("IDENTITY_UNPROVED")
    if (runtime.identity.backendPid===migration.identity.backendPid || runtime.identity.databaseOid!==migration.identity.databaseOid || runtime.identity.databaseName!==migration.identity.databaseName || runtime.identity.databaseName!==runtimeEnv.PGDATABASE) liveFail("IDENTITY_UNPROVED")
    if (!liveMigrationSafe(migration.roleProfile)) liveFail("PROFILE_UNPROVED")
    report.proof={readOnlyBoth:true,repeatableReadBoth:true,expectedRuntimeSession:true,expectedMigrationSession:true,separatePrincipals:true,configuredHostsVerifiedLoopback:true,matchingPortAndDatabase:true,sameLiveDatabaseBackend:true,primaryBoth:true,businessRowsRead:false,declaredHostsEqual:runtimeEnv.PGHOST===migrationEnv.PGHOST,runtimeProfile:runtime.roleProfile,migrationProfile:migration.roleProfile,acl:migration.acl}
  } catch (error) { bodyFailure=LIVE_CODES.includes(error?.message)?error.message:"INSPECTION_FAILED" }
  if (held && typeof held.finish==="function") {
    try { await held.finish();report.cleanup="PASS" } catch { report.cleanup="FAILED";bodyFailure??="CLEANUP_UNPROVED" }
  }
  if (!bodyFailure && recheck) {
    try { recheck() } catch (error) { bodyFailure=LIVE_CODES.includes(error?.message)?error.message:"INSPECTION_FAILED" }
  }
  if (bodyFailure || !report.proof) Object.assign(report,{code:bodyFailure??"INSPECTION_FAILED",proof:null})
  else Object.assign(report,{status:"READ_COMPLETE",productionArtifactSha:sha,code:null})
  try { return validateLiveReport(report,sha) } catch { return validateLiveReport({...report,status:"ERROR",productionArtifactSha:null,proof:null,code:"OUTPUT_INVALID"},sha) }
}

async function liveStdin() {
  let value=""
  for await(const chunk of process.stdin){value+=chunk;if(Buffer.byteLength(value)>LIVE_MAX)liveFail("OUTPUT_INVALID")}
  return value
}
const LIVE_BASE_IMPORT='import { databaseConnectionEnvironment, readRootFile, parseMigrationEnv } from "./hrm-migration-metadata-preflight.mjs"'
const LIVE_ACL_IMPORT='import { parseApplicationEnv, validateAclData } from "./hrm-default-acl-inspection.mjs"'
async function liveMain() {
  const base=liveFs.readFileSync(new URL("./hrm-migration-metadata-preflight.mjs",import.meta.url)),acl=liveFs.readFileSync(new URL("./hrm-default-acl-inspection.mjs",import.meta.url)),helper=liveFs.readFileSync(new URL(import.meta.url)),sql=liveFs.readFileSync(new URL("./hrm-loopback-acl-inspection.sql",import.meta.url))
  const bindings={baseHelperSha256:liveHash(base),aclHelperSha256:liveHash(acl),helperSha256:liveHash(helper),sqlSha256:liveHash(sql)}
  if(process.argv[2]==="--emit-remote" && process.argv.length===3){
    const strip=(bytes,imports)=>{let source=bytes.toString("utf8");for(const line of imports){if(source.split("\n").filter(x=>x===line).length!==1)liveFail("SOURCE_CHANGED");source=source.split("\n").filter(x=>x!==line).join("\n")}return source}
    process.stdout.write(base.toString("utf8")+"\n"+strip(acl,[LIVE_BASE_IMPORT])+"\n"+strip(helper,[LIVE_BASE_IMPORT,LIVE_ACL_IMPORT])+"\nconst liveResult=await inspectLiveAclRemote("+JSON.stringify(sql.toString("utf8"))+","+JSON.stringify(bindings)+",process.env.EXPECTED_MAIN_SHA);\nconsole.log(JSON.stringify(liveResult));\nif(liveResult.status!=='READ_COMPLETE')process.exitCode=1;\n")
  }else if(process.argv[2]==="--validate-output" && process.argv.length===4){
    const report=validateLiveReport(JSON.parse(await liveStdin()),process.argv[3])
    if(JSON.stringify(report.bindings)!==JSON.stringify(bindings))liveFail("SOURCE_CHANGED")
    process.stdout.write(JSON.stringify(report,null,2)+"\n")
  }else liveFail("INPUT_INVALID")
}
if(process.argv[1] && import.meta.url===livePathToFileURL(process.argv[1]).href)liveMain().catch(()=>{console.error("HRM live loopback ACL output invalid; raw data withheld");process.exitCode=1})
