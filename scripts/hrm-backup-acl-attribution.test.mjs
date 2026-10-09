import { assertMetadataSourceContinuity } from "./ci/fixtures/hrm-metadata-preflight/source-continuity.mjs"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { databaseConnectionEnvironment } from "./hrm-migration-metadata-preflight.mjs"
import { queryLiveMigration } from "./hrm-loopback-acl-inspection.mjs"
import { BACKUP_LIMITS, BACKUP_CODES, parseBackupDeclarations, readBackupDeclarations, validateBackupSnapshot, validateBackupReport, inspectBackupAclRemote } from "./hrm-backup-acl-attribution.mjs"

const source = name => fs.readFileSync(new URL(name, import.meta.url), "utf8")
const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const liveSql = source("./hrm-loopback-acl-inspection.sql"), sql = source("./hrm-backup-acl-attribution.sql")
const bindings = Object.fromEntries(["baseHelperSha256", "aclHelperSha256", "liveHelperSha256", "liveSqlSha256", "helperSha256", "sqlSha256"].map((key, i) => [key, digest(source(["./hrm-migration-metadata-preflight.mjs", "./hrm-default-acl-inspection.mjs", "./hrm-loopback-acl-inspection.mjs", "./hrm-loopback-acl-inspection.sql", "./hrm-backup-acl-attribution.mjs", "./hrm-backup-acl-attribution.sql"][i]))]))
const sha = "a".repeat(40), secret = "private-backup-attribution-marker", nonce = "b".repeat(32)
const app = "postgresql://acl_runtime:" + secret + "@localhost:5432/fixture", migration = "postgresql://acl_migration:" + secret + "@127.0.0.1:5432/fixture"
const declarations = "PGUSER=acl_backup\nBACKUP_EXPECTED_DB_ROLE='acl_backup'\nPGDATABASE=fixture\nPGPASSFILE='/private/literal-password-path'\n"
const profile = bypass => ({ present: true, noSuperuser: true, noBypassRls: !bypass, canLogin: true, setPrivilegedCount: 0 })
const entry = (privilege, recipient = "EXPECTED_RUNTIME", bypass = false) => ({ scope: "PUBLIC_SCHEMA", recipient, privilege, grantable: false, rowCount: 1, recipientProfile: profile(bypass) })
const acl = entries => ({ explicitPrivilegeRows: entries.reduce((n,e)=>n+e.rowCount,0), publicPrivilegeRows: entries.filter(e=>e.recipient==="PUBLIC").reduce((n,e)=>n+e.rowCount,0), nonOwnerWriteRows: entries.filter(e=>e.recipient!=="OWNER" && e.privilege!=="SELECT").reduce((n,e)=>n+e.rowCount,0), grantableRows: entries.filter(e=>e.grantable).reduce((n,e)=>n+e.rowCount,0), entries })
const snapshot = (mode = "migration") => ({ mode, identity: { expectedIdentity: true, sessionIdentityUnchanged: true, primary: true, readOnly: true, repeatableRead: true, probeNameVerified: true, backendPid: mode === "runtime" ? "12345" : "12346", databaseOid: "12345", databaseName: "fixture", liveRuntimeSeen: mode === "migration" }, roleProfile: profile(mode === "migration"), acl: acl(mode === "runtime" ? [] : [entry("DELETE"), entry("INSERT"), entry("SELECT"), entry("UPDATE"), entry("SELECT", "OTHER", true)]) })
const attribution = () => ({ declaredRolePresent: true, separateFromRuntimeAndMigration: true, noSuperuser: true, bypassRls: true, canLogin: true, noCreateDb: true, noCreateRole: true, noInherit: true, noReplication: true, defaultReadOnly: true, outboundMemberships: 0, inboundMemberships: 0, setPrivilegedCount: 0, otherPrivilegeRows: 1, matchedOtherPrivilegeRows: 1, otherSelectRows: 1, otherWriteRows: 0, otherGrantableRows: 0, otherRecipientCount: 1, matchedOtherRecipientCount: 1 })
const envelope = () => ({ snapshot: snapshot(), attribution: attribution() })
const read = path => path.endsWith(".deploy-sha") ? sha : path.endsWith("migration.env") ? "MIGRATION_DATABASE_URL='"+migration+"'\nMIGRATION_EXPECTED_DB_ROLE=acl_migration\n" : "DATABASE_URL='"+app+"'\n"
const inspect = (overrides={}) => inspectBackupAclRemote(liveSql,sql,bindings,sha,{ uid:0, read, readBackup:()=>({text:declarations,profile:"ROOT_0600"}), lookup:async()=>[{address:"127.0.0.1",family:4}], nonce:()=>nonce, startRuntime:async()=>({raw:JSON.stringify(snapshot("runtime")),finish:async()=>{}}), queryMigration:async()=>JSON.stringify(envelope()), ...overrides })
const assertPrivate = r => assert.doesNotMatch(JSON.stringify(r), /private-backup-attribution|postgresql:\/\/|acl_runtime|acl_migration|acl_backup|PGUSER|PGPASSFILE|databaseOid|databaseName|backendPid|hrm_loopback_acl_[0-9a-f]{32}|"12345"|"12346"/)
const error = (r,code,cleanup="NOT_STARTED") => { assert.equal(r.status,"ERROR");assert.equal(r.code,code);assert.equal(r.cleanup,cleanup);assert.equal(r.backup,null);assert.equal(r.productionArtifactSha,null);assert.equal(validateBackupReport(r,sha),r);assertPrivate(r) }

test("static canonical declarations require unique matching role and database without evaluation",()=>{
  assert.deepEqual(parseBackupDeclarations(declarations),{role:"acl_backup",database:"fixture"})
  assert.deepEqual(parseBackupDeclarations("# heading\nexport PGUSER=acl_backup\n BACKUP_EXPECTED_DB_ROLE=\"acl_backup\"\n PGDATABASE='fixture'\nUNKNOWN='literal $HOME `do-not-execute`'\n"),{role:"acl_backup",database:"fixture"})
  for(const text of ["",declarations+"PGUSER=acl_backup\n",declarations+"PGDATABASE=fixture\n",declarations.replace("BACKUP_EXPECTED_DB_ROLE='acl_backup'","BACKUP_EXPECTED_DB_ROLE=other"),declarations.replace("PGUSER=acl_backup","PGUSER=$DYNAMIC"),declarations.replace("PGUSER=acl_backup","PGUSER=$(command)"),declarations.replace("PGUSER=acl_backup","PGUSER=\"$DYNAMIC\""),declarations.replace("PGUSER=acl_backup","unset PGUSER"),declarations+"source /private/file\n",declarations+"UNKNOWN=$(private)\n",declarations.replace("PGDATABASE=fixture","PGDATABASE='bad database'"),declarations+"\0", "x".repeat(65537)])assert.throws(()=>parseBackupDeclarations(text),{message:"ENV_INVALID"})
})

const fakeIo = (mode=0o600,gid=0) => {
  const text=declarations, file={dev:1,ino:2,size:Buffer.byteLength(text),mtimeMs:3,ctimeMs:4,mode:0o100000|mode,uid:0,gid,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false}, parent={mode:0o40755,uid:0,isFile:()=>false,isDirectory:()=>true,isSymbolicLink:()=>false};let closed=0
  const io={ lstatSync:path=>path==="/etc/leaddrive/backup.env"?{...file}:{...parent},openSync:(path,flags)=>{assert.equal(path,"/etc/leaddrive/backup.env");assert.ok(flags&fs.constants.O_NOFOLLOW);return 7},fstatSync:()=>({...file}),readFileSync:()=>Buffer.from(text),closeSync:()=>{closed++} }
  return {io,file,parent,closed:()=>closed}
}
test("protected reader accepts only root0600 or stable root backup0640 with exact group",()=>{
  let fixture=fakeIo();assert.deepEqual(readBackupDeclarations(fixture.io,()=>assert.fail("0600 needs no group lookup")),{text:declarations,profile:"ROOT_0600"});assert.equal(fixture.closed(),1)
  fixture=fakeIo(0o640,712);let calls=0;assert.equal(readBackupDeclarations(fixture.io,()=>{calls++;return 712}).profile,"ROOT_BACKUP_0640");assert.equal(calls,2);assert.equal(fixture.closed(),1)
  for(const change of [f=>{f.file.mode=0o100644},f=>{f.file.uid=1},f=>{f.file.isSymbolicLink=()=>true},f=>{f.parent.uid=1},f=>{f.parent.mode=0o40777}]){const f=fakeIo();change(f);assert.throws(()=>readBackupDeclarations(f.io,()=>0),{message:"FILES_UNSAFE"})}
  assert.throws(()=>readBackupDeclarations(fakeIo(0o640,712).io,()=>713),{message:"FILES_UNSAFE"})
  fixture=fakeIo(0o640,712);calls=0;assert.throws(()=>readBackupDeclarations(fixture.io,()=>++calls===1?712:713),{message:"SOURCE_CHANGED"})
  fixture=fakeIo();fixture.io.readFileSync=()=>{fixture.file.gid=1;return Buffer.from(declarations)};assert.throws(()=>readBackupDeclarations(fixture.io),{message:"SOURCE_CHANGED"});assert.equal(fixture.closed(),1)
})

test("backup attribution wraps the unchanged held live observer and rolls back before file rereads",async()=>{
  const events=[];let live=false
  const r=await inspect({readBackup:()=>{events.push("backup-file");return {text:declarations,profile:"ROOT_BACKUP_0640"}},startRuntime:async(connection,statement,probe)=>{assert.equal(connection,app);assert.equal(statement,liveSql);assert.equal(probe.runtimeRole,"acl_runtime");events.push("runtime");live=true;return{raw:JSON.stringify(snapshot("runtime")),finish:async()=>{events.push("rollback");live=false}}},queryMigration:async(connection,statement,probe,role)=>{assert.equal(live,true);assert.equal(connection,migration);assert.equal(statement,sql);assert.equal(probe.pid,12345);assert.equal(role,"acl_backup");events.push("catalog");return JSON.stringify(envelope())}})
  assert.deepEqual(events,["backup-file","runtime","catalog","rollback","backup-file"]);assert.equal(r.status,"READ_COMPLETE");assert.equal(r.cleanup,"PASS");assert.equal(r.live.proof.sameLiveDatabaseBackend,true);assert.equal(r.live.proof.declaredHostsEqual,false);assert.equal(r.backup.protectedFileProfile,"ROOT_BACKUP_0640");assert.deepEqual(r.backup.attribution,attribution());assert.equal(validateBackupReport(r,sha),r);assertPrivate(r)
  assert.ok(BACKUP_LIMITS.some(v=>v.includes("not ACL approval")));assert.ok(BACKUP_LIMITS.some(v=>v.includes("absence does not prove")))
})

test("private declaration/database/file failures are rejected before any connection",async()=>{
  const cases=[[{uid:1},"INPUT_INVALID"],[{readBackup:()=>({text:"",profile:"ROOT_0600"})},"ENV_INVALID"],[{readBackup:()=>({text:declarations,profile:"UNKNOWN"})},"FILES_UNSAFE"],[{readBackup:()=>{throw new Error("FILES_UNSAFE")}},"FILES_UNSAFE"],[{readBackup:()=>({text:declarations.replace("PGDATABASE=fixture","PGDATABASE=elsewhere"),profile:"ROOT_0600"})},"DATABASE_MISMATCH"],[{read:path=>path.endsWith(".deploy-sha")?"c".repeat(40):read(path)},"BACKUP_INSPECTION_FAILED"]]
  for(const [overrides,code] of cases)error(await inspect({...overrides,startRuntime:()=>assert.fail("configuration rejected before SQL"),queryMigration:()=>assert.fail("configuration rejected before SQL")}),code)
})

test("strict attribution rejects raw names, unexpected fields, malformed counters and mismatched ACL counts",()=>{
  for(const mutate of [v=>{v.rawSecret=secret},v=>{v.attribution.roleName=secret},v=>{v.attribution.defaultReadOnly="true"},v=>{v.attribution.otherPrivilegeRows++},v=>{v.attribution.otherWriteRows++},v=>{v.attribution.otherRecipientCount=0},v=>{v.attribution.matchedOtherPrivilegeRows=2},v=>{v.attribution.matchedOtherRecipientCount=2},v=>{v.attribution.outboundMemberships=-1},v=>{v.attribution.inboundMemberships=10001},v=>{v.attribution.declaredRolePresent=false},v=>{v.snapshot.identity.backendPid=secret}]){const v=envelope();mutate(v);assert.throws(()=>validateBackupSnapshot(v),{message:"OUTPUT_INVALID"})}
})

test("missing declared identity and unsafe profile/default/memberships remain observations without approval",async()=>{
  for(const mutate of [a=>{a.defaultReadOnly=false},a=>{a.noSuperuser=false;a.noCreateRole=false;a.noCreateDb=false;a.noReplication=false;a.noInherit=false},a=>{a.outboundMemberships=1;a.inboundMemberships=1;a.setPrivilegedCount=1},a=>{a.declaredRolePresent=false;a.defaultReadOnly=false;a.matchedOtherPrivilegeRows=0;a.matchedOtherRecipientCount=0},a=>{a.separateFromRuntimeAndMigration=false}]){
    const v=envelope();mutate(v.attribution);const r=await inspect({queryMigration:async()=>JSON.stringify(v)});assert.equal(r.status,"READ_COMPLETE");assert.deepEqual(r.backup.attribution,v.attribution);assert.equal(validateBackupReport(r,sha),r);assertPrivate(r)
  }
})

test("source changes inside rollback or final backup reread discard successful evidence",async()=>{
  for(const target of ["backup-text","backup-profile",".deploy-sha","app.env","migration.env"]){let changed=false,finished=0
    const r=await inspect({readBackup:()=>({text:changed&&target==="backup-text"?declarations+"#changed\n":declarations,profile:changed&&target==="backup-profile"?"ROOT_BACKUP_0640":"ROOT_0600"}),read:path=>changed&&path.endsWith(target)?target===".deploy-sha"?"c".repeat(40):read(path)+"#changed\n":read(path),startRuntime:async()=>({raw:JSON.stringify(snapshot("runtime")),finish:async()=>{changed=true;finished++}})})
    error(r,target===".deploy-sha"||target==="app.env"||target==="migration.env"?"BACKUP_INSPECTION_FAILED":"SOURCE_CHANGED","PASS");assert.equal(finished,1)
  }
})

test("malformed query and cleanup failures never export private errors or approve evidence",async()=>{
  for(const raw of [secret,JSON.stringify(envelope())+"\n"+secret,"x".repeat(131073)]){const r=await inspect({queryMigration:async()=>raw});error(r,"BACKUP_INSPECTION_FAILED","PASS");assert.equal(r.live.code,"OUTPUT_INVALID")}
  let r=await inspect({queryMigration:async()=>{throw new Error(secret)}});error(r,"BACKUP_INSPECTION_FAILED","PASS");assert.equal(r.live.code,"INSPECTION_FAILED")
  const v=envelope();v.snapshot.identity.liveRuntimeSeen=false
  r=await inspect({queryMigration:async()=>JSON.stringify(v),startRuntime:async()=>({raw:JSON.stringify(snapshot("runtime")),finish:async()=>{throw new Error(secret)}})});error(r,"BACKUP_INSPECTION_FAILED","FAILED");assert.equal(r.live.code,"IDENTITY_UNPROVED")
  r=await inspect({startRuntime:async()=>({raw:JSON.stringify(snapshot("runtime")),finish:async()=>{throw new Error(secret)}})});error(r,"BACKUP_INSPECTION_FAILED","FAILED");assert.equal(r.live.code,"CLEANUP_UNPROVED")
})

test("PUBLIC and OTHER write/grantable rows remain catalog facts rather than automatic ACL acceptance",async()=>{
  const v=envelope(),publicProfile={present:false,noSuperuser:false,noBypassRls:false,canLogin:false,setPrivilegedCount:0}
  v.snapshot.acl=acl([entry("INSERT"),entry("SELECT","OTHER",true),{...entry("TRUNCATE","OTHER",true),grantable:true},{...entry("SELECT","PUBLIC"),scope:"GLOBAL",recipientProfile:publicProfile}]);Object.assign(v.attribution,{otherPrivilegeRows:2,matchedOtherPrivilegeRows:2,otherWriteRows:1,otherGrantableRows:1})
  const r=await inspect({queryMigration:async()=>JSON.stringify(v)});assert.equal(r.status,"READ_COMPLETE");assert.equal(r.live.proof.acl.publicPrivilegeRows,1);assert.equal(r.backup.attribution.otherWriteRows,1);assert.equal(r.backup.attribution.otherGrantableRows,1);assertPrivate(r)
})

test("public reports reject readiness, injected secrets, invalid bindings and forged observed counters",async()=>{
  const complete=await inspect()
  for(const mutate of [r=>{r.status="READY"},r=>{r.secret=secret},r=>{r.backup.roleName=secret},r=>{r.backup.attribution.otherSelectRows=2},r=>{r.live.bindings.helperSha256="c".repeat(64)},r=>{r.cleanup="NOT_STARTED"},r=>{r.backup.databaseMatchesRuntime=false},r=>{r.limits=[]},r=>{r.productionArtifactSha="c".repeat(40)}]){const r=structuredClone(complete);mutate(r);assert.throws(()=>validateBackupReport(r,sha),{message:"OUTPUT_INVALID"})}
  const failed=await inspect({uid:1});for(const code of BACKUP_CODES)assert.equal(validateBackupReport({...failed,code},sha).code,code)
  assert.throws(()=>validateBackupReport({...failed,code:secret},sha),{message:"OUTPUT_INVALID"})
})

test("SQL preserves original guarded snapshot and reads only finite role/default ACL/settings catalogs",()=>{
  const original=liveSql.slice(liveSql.indexOf("SELECT pg_catalog.json_build_object("),-2)
  assert.ok(sql.includes(original+" AS snapshot"));for(const line of liveSql.slice(liveSql.indexOf("BEGIN"),liveSql.indexOf("SELECT pg_catalog.json_build_object(")).split("\n").filter(Boolean))assert.ok(sql.includes(line))
  assert.match(sql,/SET LOCAL lock_timeout = '2s';/);assert.match(sql,/SET LOCAL statement_timeout = '10s';/);assert.match(sql,/pg_catalog\.pg_db_role_setting/);assert.match(sql,/s\.setrole IN \(0,\(SELECT oid FROM backup_role\)\)/);assert.doesNotMatch(sql,/ROLLBACK;|pg_control_system|pg_read_all_stats|\b(?:FROM|JOIN)\s+public\./i)
  assert.doesNotMatch(sql.replace(/^--.*$/gm,""),/\b(?:CREATE|ALTER|DROP|GRANT|REVOKE|COPY)\s+(?:TABLE|ROLE|USER|DATABASE|SCHEMA)\b/i)
})

test("all previous fourteen observer source files remain byte exact",()=>{
  for(const [path,hash] of [
    ["./hrm-migration-metadata-preflight.mjs","46b417da7bbe763960b8ede8fa0e9dbd98543d090d54f73979289504bfe35771"],
    ["./hrm-migration-metadata-preflight.sql","b174e32eb68a0dbcca98e8557fe8c716ed8277111e79ba822bce43f4e7023b6a"],
    ["./hrm-migration-metadata-preflight.test.mjs","39c947982f5e7dc2ca1e96307ac5314518bfe748ec58a3cf217f8f09194c0eef"],
    ["../.github/workflows/hrm-migration-metadata-preflight.yml","f90937ecda3b81e7dd017819cfaec1afdefc5fee58167fdfc2289ce012a1dcf1"],
    ["./hrm-default-acl-inspection.mjs","a6aa4f3526fd5edf29bd2b3a1309f7703e85acad70c0e683cba69dbb281c2027"],
    ["./hrm-default-acl-inspection.sql","524bc02f34a75f445aff6b3834df6e02aa86665dee9acd835b2b5fc621127e2a"],
    ["./hrm-default-acl-inspection.test.mjs","402a2dde20443676d6bac430ab4e80a74f507c2dd3828b920c278cafcf0c7c3c"],
    ["../.github/workflows/hrm-default-acl-inspection.yml","954c6d042bf00420f1ecd3c9ed0c378bc41305c0af08c30cdc3a97f06f81df2a"],
    ["../docs/hrm-default-acl-inspection-session-log.md","8d3af68cc9a724374a30d5eba1e06d37537473cef61ca4d89549adced5500a5f"],
    ["./hrm-loopback-acl-inspection.mjs","e8d5fb47eddfb0d7e371943f2d3b3459b66e9d17927161bf9233bd6189074dbf"],
    ["./hrm-loopback-acl-inspection.sql","7a4a9d79534e40cf7672c31797f2015a543f7061c1522ee30a7cfb9e147f8c58"],
    ["./hrm-loopback-acl-inspection.test.mjs","7e1264a6a754b655306b936c971a28584532b6921a005012f5d2769d522c8993"],
    ["../.github/workflows/hrm-loopback-acl-inspection.yml","bfbcb2b83fab53817ce71ae1e511389cbab7f9ca6aeff0785801b24aee76a116"],
    ["../docs/hrm-loopback-acl-inspection-session-log.md","36658d86a3a32d577e1284c3f0ca7bdd38221d64237903c74ddcc5fa60969d72"],
  ])assertMetadataSourceContinuity(path, hash)
})

test("stdin emitter and validator bind all six sources without reading any private files",async()=>{
  const emitted=execFileSync(process.execPath,["scripts/hrm-backup-acl-attribution.mjs","--emit-remote"],{encoding:"utf8",maxBuffer:300000})
  const safe=emitted.replace(",process.env.EXPECTED_MAIN_SHA);",",process.env.EXPECTED_MAIN_SHA,{uid:1});");assert.notEqual(safe,emitted)
  try{execFileSync(process.execPath,["--input-type=module","-"],{input:safe,encoding:"utf8",env:{EXPECTED_MAIN_SHA:sha},maxBuffer:131072,stdio:["pipe","pipe","pipe"]});assert.fail("nonroot must fail")}catch(e){assert.equal(e.status,1);assert.equal(e.stderr,"");const r=JSON.parse(e.stdout);error(r,"INPUT_INVALID");assert.deepEqual(r.bindings,bindings)}
  const run=r=>execFileSync(process.execPath,["scripts/hrm-backup-acl-attribution.mjs","--validate-output",sha],{input:JSON.stringify(r),encoding:"utf8",maxBuffer:131072,stdio:["pipe","pipe","pipe"]})
  const complete=await inspect();assert.deepEqual(JSON.parse(run(complete)),complete)
  for(const r of [{...complete,secret},{...complete,status:"READY"},{...complete,bindings:{...bindings,sqlSha256:"c".repeat(64)}}]){try{run(r);assert.fail("forged receipt must fail")}catch(e){assert.equal(e.status,1);assert.equal(e.stdout,"");assert.equal(e.stderr,"HRM backup ACL output invalid; raw data withheld\n")}}
})

// Mutations below run only in the GitHub-hosted disposable PostgreSQL16 service.
// The production helper has no fixture mode and never opens a backup connection.
test("hosted PostgreSQL attributes configured backup with real default spawn, live guards and complete cleanup",{skip:!process.env.HRM_BACKUP_ACL_TEST_DATABASE_URL},async context=>{
  assert.equal(process.env.GITHUB_ACTIONS,"true");assert.equal(process.env.CI,"true")
  const admin=new URL(process.env.HRM_BACKUP_ACL_TEST_DATABASE_URL);assert.equal(admin.hostname,"127.0.0.1");assert.equal(admin.pathname,"/hrm_preflight_test");assert.equal(admin.username,"postgres")
  const adminEnv={...databaseConnectionEnvironment(admin.href),PGOPTIONS:"-c default_transaction_read_only=off"},allowedStates=new Set(["08001","08006","25006","28000","28P01","42501","42601","42704","42P01","2BP01","55P03","57014","XX000"])
  const execute=statement=>{try{return execFileSync("psql",["-X","-qAt","--no-password","-v","ON_ERROR_STOP=1","-v","VERBOSITY=sqlstate"],{input:statement,encoding:"utf8",env:adminEnv,timeout:20000,maxBuffer:65536,stdio:["pipe","pipe","pipe"]})}catch(e){const state=String(e.stderr??"").match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b/)?.[1];const safe=new Error("HOSTED_BACKUP_SQL_FAILED");safe.fixtureSqlState=allowedStates.has(state)?state:"UNAVAILABLE";throw safe}}
  const detail=e=>"kind="+(e?.fixtureSqlState?"PSQL":e?.code==="ERR_ASSERTION"?"ASSERTION":"OTHER")+" sqlState="+(allowedStates.has(e?.fixtureSqlState)?e.fixtureSqlState:"UNAVAILABLE")
  assert.equal(execute("SELECT current_database()='hrm_preflight_test' AND (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user);").trim(),"t");assert.equal(execute("SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';").trim(),"0")
  const runtime=new URL(admin.href);runtime.username="hrm_backup_runtime";runtime.password="isolated-backup-runtime";runtime.hostname="localhost"
  const migrator=new URL(admin.href);migrator.username="hrm_backup_migration";migrator.password="isolated-backup-migration"
  const privateRead=path=>path.endsWith(".deploy-sha")?sha:path.endsWith("migration.env")?"MIGRATION_DATABASE_URL='"+migrator.href+"'\nMIGRATION_EXPECTED_DB_ROLE=hrm_backup_migration\n":"DATABASE_URL='"+runtime.href+"'\n"
  const backupRead=(role="hrm_backup_declared")=>({text:"PGUSER="+role+"\nBACKUP_EXPECTED_DB_ROLE="+role+"\nPGDATABASE=hrm_preflight_test\nPGPASSFILE=/unread/backup-password\n",profile:"ROOT_BACKUP_0640"})
  const observe=async(role="hrm_backup_declared")=>{
    // No query/startRuntime overrides: this exercises the production adapter,
    // its added GUC and unchanged PGAPPNAME/PID/nonce/isolation checks.
    const r=await inspectBackupAclRemote(liveSql,sql,bindings,sha,{uid:0,read:privateRead,readBackup:()=>backupRead(role)})
    assert.equal(r.status,"READ_COMPLETE","HOSTED_BACKUP_INSPECTION status="+r.status+" code="+r.code+" liveCode="+(r.live?.code??"NONE")+" cleanup="+r.cleanup);assert.equal(r.cleanup,"PASS");assert.equal(r.live.proof.sameLiveDatabaseBackend,true);assert.equal(r.live.proof.declaredHostsEqual,false);assert.equal(r.live.proof.businessRowsRead,false);assert.equal(validateBackupReport(r,sha),r)
    assert.doesNotMatch(JSON.stringify(r),/hrm_backup_(?:declared|runtime|migration|other|privileged)|isolated-backup|postgresql:\/\/|backendPid|databaseOid|databaseName|PGPASSFILE|hrm_loopback_acl_[0-9a-f]{32}/);return r
  }
  execute("BEGIN; CREATE ROLE hrm_backup_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'isolated-backup-runtime'; CREATE ROLE hrm_backup_migration LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'isolated-backup-migration'; CREATE ROLE hrm_backup_declared LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION; CREATE ROLE hrm_backup_other NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE hrm_backup_privileged NOLOGIN NOSUPERUSER BYPASSRLS; ALTER ROLE hrm_backup_declared SET default_transaction_read_only=on; GRANT USAGE,CREATE ON SCHEMA public TO hrm_backup_migration; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO hrm_backup_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration IN SCHEMA public GRANT SELECT ON TABLES TO hrm_backup_declared; COMMIT;")
  let stage="FIXTURE_IDENTITY",bodyError=null,cleanupError=null,migrationOid
  try{
    migrationOid=execute("SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname='hrm_backup_migration';").trim();assert.ok(/^[1-9][0-9]{0,9}$/.test(migrationOid),"HOSTED_BACKUP_FIXTURE_IDENTITY_UNPROVED")
    stage="CONFIGURED_BACKUP";let r=await observe(),a=r.backup.attribution
    assert.deepEqual(a,{...attribution()});assert.equal(r.live.proof.acl.explicitPrivilegeRows,5);assert.equal(r.live.proof.acl.publicPrivilegeRows,0);assert.equal(r.live.proof.acl.grantableRows,0);assert.deepEqual(r.live.proof.acl.entries.filter(e=>e.recipient==="EXPECTED_RUNTIME").map(e=>e.privilege).sort(),["DELETE","INSERT","SELECT","UPDATE"])
    context.diagnostic("HOSTED_BACKUP_MILESTONE defaultAdapterLiveAndAttribution=PASS")
    stage="WRONG_OR_MISSING_DECLARATION"
    r=await observe("hrm_backup_other");assert.equal(r.backup.attribution.declaredRolePresent,true);assert.equal(r.backup.attribution.matchedOtherPrivilegeRows,0);assert.equal(r.backup.attribution.matchedOtherRecipientCount,0);assert.equal(r.backup.attribution.defaultReadOnly,false)
    r=await observe("hrm_backup_missing");assert.equal(r.backup.attribution.declaredRolePresent,false);assert.equal(r.backup.attribution.matchedOtherPrivilegeRows,0);assert.equal(r.backup.attribution.matchedOtherRecipientCount,0);assert.equal(r.backup.attribution.defaultReadOnly,false)
    context.diagnostic("HOSTED_BACKUP_MILESTONE mismatchedOrMissingIsObservation=PASS")
    stage="DEFAULT_SETTING_PRECEDENCE"
    execute("ALTER ROLE hrm_backup_declared IN DATABASE hrm_preflight_test SET default_transaction_read_only=off;");assert.equal((await observe()).backup.attribution.defaultReadOnly,false)
    execute("ALTER ROLE hrm_backup_declared IN DATABASE hrm_preflight_test RESET default_transaction_read_only;");assert.equal((await observe()).backup.attribution.defaultReadOnly,true)
    execute("ALTER ROLE hrm_backup_declared RESET default_transaction_read_only;");assert.equal((await observe()).backup.attribution.defaultReadOnly,false)
    execute("ALTER DATABASE hrm_preflight_test SET default_transaction_read_only=on;");assert.equal((await observe()).backup.attribution.defaultReadOnly,true)
    // Existing server-wide defaults are not inferred from forced migration RO.
    execute("ALTER ROLE hrm_backup_declared SET default_transaction_read_only=off;");assert.equal((await observe()).backup.attribution.defaultReadOnly,false)
    execute("ALTER DATABASE hrm_preflight_test RESET default_transaction_read_only; ALTER ROLE hrm_backup_declared SET default_transaction_read_only=on;")
    context.diagnostic("HOSTED_BACKUP_MILESTONE roleDatabaseOverRoleOverDatabaseAndAbsent=PASS")
    stage="MEMBERSHIP_PROFILE_OBSERVATIONS"
    execute("GRANT hrm_backup_privileged TO hrm_backup_declared; GRANT hrm_backup_declared TO hrm_backup_other;");a=(await observe()).backup.attribution;assert.equal(a.outboundMemberships,1);assert.equal(a.inboundMemberships,1);assert.equal(a.setPrivilegedCount,1)
    execute("REVOKE hrm_backup_privileged FROM hrm_backup_declared; REVOKE hrm_backup_declared FROM hrm_backup_other; ALTER ROLE hrm_backup_declared SUPERUSER CREATEDB CREATEROLE INHERIT REPLICATION;");a=(await observe()).backup.attribution;for(const field of ["noSuperuser","noCreateDb","noCreateRole","noInherit","noReplication"])assert.equal(a[field],false)
    execute("ALTER ROLE hrm_backup_declared NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;")
    context.diagnostic("HOSTED_BACKUP_MILESTONE membershipAndUnsafeProfileAreObservation=PASS")
    stage="GLOBAL_AND_PUBLIC_SCOPES"
    execute("ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration GRANT SELECT ON TABLES TO hrm_backup_declared;");a=(await observe()).backup.attribution;assert.equal(a.otherPrivilegeRows,2);assert.equal(a.otherSelectRows,2);assert.equal(a.otherRecipientCount,1);assert.equal(a.matchedOtherRecipientCount,1);assert.equal(a.matchedOtherPrivilegeRows,2)
    execute("ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration IN SCHEMA public GRANT SELECT ON TABLES TO hrm_backup_other; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration IN SCHEMA public GRANT TRUNCATE,TRIGGER,REFERENCES ON TABLES TO hrm_backup_declared; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration IN SCHEMA public GRANT INSERT ON TABLES TO hrm_backup_declared WITH GRANT OPTION; ALTER DEFAULT PRIVILEGES FOR ROLE hrm_backup_migration GRANT SELECT ON TABLES TO PUBLIC;")
    r=await observe();a=r.backup.attribution;assert.equal(a.otherPrivilegeRows,7);assert.equal(a.matchedOtherPrivilegeRows,6);assert.equal(a.otherRecipientCount,2);assert.equal(a.matchedOtherRecipientCount,1);assert.equal(a.otherSelectRows,3);assert.equal(a.otherWriteRows,4);assert.equal(a.otherGrantableRows,1);assert.equal(r.live.proof.acl.publicPrivilegeRows,1);assert.equal(r.live.proof.acl.grantableRows,1)
    context.diagnostic("HOSTED_BACKUP_MILESTONE crossScopeMultipleRecipientWritePublicGrantableAreObservation=PASS")
    stage="LIVE_AND_READ_ONLY_GUARDS"
    const invalid=await inspectBackupAclRemote(liveSql,sql,bindings,sha,{uid:0,read:privateRead,readBackup:()=>backupRead(),queryMigration:(connection,statement,probe,role)=>queryLiveMigration(connection,statement,{...probe,pid:2147483647},(binary,args,options)=>spawn(binary,args,{...options,env:{...options.env,PGOPTIONS:options.env.PGOPTIONS+" -c hrm.backup_expected_role="+role}}))})
    assert.equal(invalid.status,"ERROR");assert.equal(invalid.live.code,"IDENTITY_UNPROVED");assert.equal(invalid.cleanup,"PASS");assert.equal(invalid.backup,null)
    const probe={runtimeRole:"hrm_backup_runtime",nonce:"hrm_loopback_acl_"+"d".repeat(32),pid:0}
    assert.equal((await queryLiveMigration(migrator.href,"SELECT current_setting('transaction_read_only');",probe)).trim(),"on")
    await assert.rejects(queryLiveMigration(migrator.href,"CREATE TABLE hrm_backup_forbidden(id integer);",probe),{message:"QUERY_FAILED"});assert.equal(execute("SELECT to_regclass('public.hrm_backup_forbidden') IS NULL;").trim(),"t")
    context.diagnostic("HOSTED_BACKUP_BODY=PASS")
  }catch(e){bodyError=e;context.diagnostic("HOSTED_BACKUP_BODY=FAIL stage="+stage+" "+detail(e))}
  finally{
    try{execute("ALTER DATABASE hrm_preflight_test RESET default_transaction_read_only;");context.diagnostic("HOSTED_BACKUP_CLEANUP databaseDefault=PASS")}catch(e){cleanupError??=e;context.diagnostic("HOSTED_BACKUP_CLEANUP databaseDefault=FAIL "+detail(e))}
    const roles=[["RUNTIME","hrm_backup_runtime"],["MIGRATION","hrm_backup_migration"],["BACKUP","hrm_backup_declared"],["OTHER","hrm_backup_other"],["PRIVILEGED","hrm_backup_privileged"]]
    for(const command of ["DROP OWNED BY","DROP ROLE"])for(const [slot,role]of roles){const action=command==="DROP OWNED BY"?"DROP_OWNED":"DROP_ROLE";try{execute(command+" "+role+";");context.diagnostic("HOSTED_BACKUP_CLEANUP action="+action+" slot="+slot+" status=PASS")}catch(e){cleanupError??=e;context.diagnostic("HOSTED_BACKUP_CLEANUP action="+action+" slot="+slot+" status=FAIL "+detail(e))}}
    try{assert.ok(/^[1-9][0-9]{0,9}$/.test(migrationOid),"HOSTED_BACKUP_CLEANUP_IDENTITY_UNPROVED");assert.equal(execute("SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('hrm_backup_runtime','hrm_backup_migration','hrm_backup_declared','hrm_backup_other','hrm_backup_privileged')) AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole="+migrationOid+") AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE setdatabase=(SELECT oid FROM pg_catalog.pg_database WHERE datname='hrm_preflight_test') AND 'default_transaction_read_only=on'=ANY(s.setconfig));").trim(),"t");context.diagnostic("HOSTED_BACKUP_CLEANUP residue=PASS")}catch(e){cleanupError??=e;context.diagnostic("HOSTED_BACKUP_CLEANUP residue=FAIL "+detail(e))}
    if(!cleanupError)context.diagnostic("HOSTED_BACKUP_CLEANUP=PASS")
  }
  if(bodyError)throw bodyError
  if(cleanupError)throw cleanupError
})
