import { createRequire } from "node:module"
import { sanitizedAuthLogEvidence, sanitizedRedirectEvidence, loopbackApplicationOrigin } from "../../support-backend-evidence-guards.mjs"
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { validateContext, childEnvironment } from "../../support-backend-evidence-guards.mjs"
const root = fileURLToPath(new URL("../../../", import.meta.url))
const temporary = () => mkdtempSync(path.join(tmpdir(), "support-backend-guard-unit-"))
const accepted = cwd => ({
  CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", NODE_ENV: "development",
  SUPPORT_BACKEND_EVIDENCE: "fresh-postgres-v1", SUPPORT_BACKEND_HEAD_SHA: "a".repeat(40), GITHUB_SHA: "b".repeat(40),
  GITHUB_WORKSPACE: cwd, RUNNER_TEMP: cwd, SUPPORT_BACKEND_ADMIN_URL: "postgresql://postgres:unit-only@127.0.0.1:54321/postgres",
})
test("pure guard accepts only the documented hosted shape, without connecting", () => {
  const cwd = temporary()
  try { assert.equal(validateContext(accepted(cwd), cwd).databaseName, "support_backend_evidence") }
  finally { rmSync(cwd, { recursive: true }) }
})
for (const [key,value] of [
  ["CI","false"],["GITHUB_ACTIONS","false"],["RUNNER_ENVIRONMENT","self-hosted"],
  ["NODE_ENV","production"],["SUPPORT_BACKEND_EVIDENCE",""],
  ["SUPPORT_BACKEND_HEAD_SHA","main"],["GITHUB_SHA","short"],
  ["GITHUB_WORKSPACE","/"],["RUNNER_TEMP","relative"],
]) test("refuses unsafe context " + key, () => {
  const cwd = temporary()
  try { assert.throws(() => validateContext({ ...accepted(cwd), [key]:value }, cwd)) }
  finally { rmSync(cwd, { recursive: true }) }
})
for (const url of [
  "postgresql://postgres:unit-only@203.0.113.1:5432/postgres",
  "postgresql://postgres:unit-only@localhost:5432/postgres",
  "postgresql://postgres:unit-only@127.0.0.1:5432/production",
  "postgresql://app:unit-only@127.0.0.1:5432/postgres",
  "postgresql://postgres@127.0.0.1:5432/postgres",
  "postgresql://postgres:unit-only@127.0.0.1/postgres",
  "postgresql://postgres:unit-only@127.0.0.1:5432/postgres?host=remote",
  "postgresql://postgres:unit-only@127.0.0.1:5432/postgres#fragment",
  "https://127.0.0.1:5432/postgres",
]) test("refuses unsafe database URL " + new URL(url).host + new URL(url).pathname + new URL(url).search, () => {
  const cwd = temporary()
  try { assert.throws(() => validateContext({ ...accepted(cwd), SUPPORT_BACKEND_ADMIN_URL:url }, cwd)) }
  finally { rmSync(cwd, { recursive: true }) }
})
for (const name of [".env",".env.local",".env.development",".env.development.local",".env.production",".env.production.local"]) test("refuses auto-loaded " + name, () => {
  const cwd = temporary()
  try {
    writeFileSync(path.join(cwd, name), "SYNTHETIC=unit-only\n")
    assert.throws(() => validateContext(accepted(cwd), cwd), /ENV_FILE_FORBIDDEN/)
  } finally { rmSync(cwd, { recursive: true }) }
})
test("does not forward provider, proxy, AWS, SMTP or database credentials", () => {
  const env = childEnvironment({ PATH:"/usr/bin", SMTP_PASSWORD:"unit", OPENAI_API_KEY:"unit", HTTPS_PROXY:"unit", AWS_SECRET_ACCESS_KEY:"unit", DATABASE_URL:"unit", NODE_OPTIONS:"--require unwanted" }, { DATABASE_URL:"synthetic-loopback" })
  assert.deepEqual(Object.keys(env).sort(), ["PATH","LANG","CI","NODE_ENV","NEXT_TELEMETRY_DISABLED","LEADDRIVE_DISABLE_SERVICE_WORKER","DATABASE_URL"].sort())
  assert.equal(env.DATABASE_URL,"synthetic-loopback")
})
test("Node transport fence rejects TCP/DNS/UDP and permits loopback without faking routes", () => {
  const cwd = temporary()
  const log = path.join(cwd,"network.log")
  writeFileSync(log,"")
  const preload = path.join(cwd, "dns-tripwire.mjs")
  // Guard regressions must fail closed even if a DNS patch is accidentally removed.
  writeFileSync(preload, [
    'import dns from "node:dns"; import { syncBuiltinESMExports } from "node:module";',
    'for (const target of [dns,dns.promises,dns.Resolver.prototype,dns.promises.Resolver.prototype]) for (const name of Object.getOwnPropertyNames(target)) {',
    'if (!/^(lookup|reverse|resolve)/.test(name) || typeof target[name]!=="function") continue; const original=target[name];',
    'target[name]=function(host,...args) { if (name==="lookup" && ["127.0.0.1","::1","localhost"].includes(host)) return original.call(this,host,...args); throw new Error("DNS_TRIPWIRE_UNGUARDED"); }; }',
    'syncBuiltinESMExports();',
    'await import(' + JSON.stringify(pathToFileURL(path.join(root,"scripts/support-backend-network-guard.mjs")).href) + ');',
  ].join("\n"))
  const code = [
    'import assert from "node:assert/strict"; import net from "node:net"; import dns, { resolve4 as namedResolve4 } from "node:dns"; import { resolveTxt as namedResolveTxt, lookup as namedPromiseLookup } from "node:dns/promises"; import dgram from "node:dgram";',
    'for (const action of [()=>net.connect({host:"203.0.113.1",port:25}),()=>dns.lookup("example.invalid",()=>{}),()=>dgram.createSocket("udp4"),()=>dns.resolve4("example.invalid",()=>{}),()=>dns.promises.resolveTxt("example.invalid"),()=>new dns.Resolver().resolveMx("example.invalid",()=>{}),()=>new dns.promises.Resolver().resolveSrv("example.invalid"),()=>dns.reverse("203.0.113.1",()=>{}),()=>dns.lookupService("203.0.113.1",25,()=>{}),()=>namedResolve4("example.invalid",()=>{}),()=>namedResolveTxt("example.invalid")]) assert.throws(action,/SUPPORT_BACKEND_OUTBOUND_BLOCKED/);',
    'await assert.rejects(dns.promises.lookup("example.invalid"),/SUPPORT_BACKEND_OUTBOUND_BLOCKED/); await assert.rejects(namedPromiseLookup("example.invalid"),/SUPPORT_BACKEND_OUTBOUND_BLOCKED/);',
    'assert.equal((await dns.promises.lookup("127.0.0.1")).address,"127.0.0.1");',
    'const server=net.createServer(socket=>socket.end("local")); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));',
    'const client=net.connect({host:"127.0.0.1",port:server.address().port}); let data=""; client.on("data",chunk=>data+=chunk); await new Promise(resolve=>client.on("end",resolve)); assert.equal(data,"local"); await new Promise(resolve=>server.close(resolve));',
  ].join("\n")
  try {
    const result=spawnSync(process.execPath,["--import",preload,"--input-type=module","-e",code],{env:{PATH:process.env.PATH,SUPPORT_BACKEND_NETWORK_LOG:log},encoding:"utf8",timeout:15_000})
    assert.equal(result.status,0,result.stderr)
    assert.equal(readFileSync(log,"utf8").trim().split("\n").length,13)
  } finally { rmSync(cwd,{recursive:true}) }
})
test("real harness refuses local execution before loading Prisma or making requests", () => {
  const result=spawnSync(process.execPath,[path.join(root,"scripts/support-backend-evidence.mjs")],{env:{PATH:process.env.PATH,CI:"false"},encoding:"utf8",timeout:15_000})
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/HOSTED_EPHEMERAL_REQUIRED/)
})

test("auth diagnostics retain fixed error categories without private values", () => {
  const secret = "never-publish-this-secret"
  const result = sanitizedAuthLogEvidence("[Auth] credentials_rejected reason=no_candidates email=" + secret
    + "\n[Auth] Login error: code: 'P2022' permission denied for table users\nCredentialsSignin")
  assert.deepEqual(result.credentialReasons, ["no_candidates"])
  assert.deepEqual(result.prismaCodes, ["P2022"])
  assert.equal(result.permissionDenied, true)
  assert.equal(result.authLoginException, true)
  assert.equal(JSON.stringify(result).includes(secret), false)
})
test("unknown auth reasons and arbitrary messages are not exported", () => {
  const result = sanitizedAuthLogEvidence("reason=custom_private_reason token=secret https://private.example")
  assert.deepEqual(result.credentialReasons, [])
  assert.deepEqual(result.authErrorTypes, [])
  assert.deepEqual(result.prismaCodes, [])
  assert.equal(JSON.stringify(result).includes("private"), false)
})

test("redirect diagnostics expose only fixed origin categories and numeric port", () => {
  const observed = sanitizedRedirectEvidence("http://localhost:3000/login?token=never-print", "http://127.0.0.1:40001")
  assert.equal(observed.hostKind, "localhost")
  assert.equal(observed.port, 3000)
  assert.equal(observed.sameHostname, false)
  assert.equal(observed.samePort, false)
  assert.equal(JSON.stringify(observed).includes("never-print"), false)
  const foreign = sanitizedRedirectEvidence("https://private-customer.example/private-id?secret=never", "http://127.0.0.1:40001")
  assert.equal(foreign.hostKind, "NON_LOOPBACK")
  assert.equal(foreign.pathKind, "OTHER")
  assert.equal(JSON.stringify(foreign).includes("private"), false)
})

test("application origin survives the real NextRequest loopback canonicalization", () => {
  const { NextRequest } = createRequire(import.meta.url)("next/server")
  const expected = loopbackApplicationOrigin(45678)
  const request = new NextRequest(expected + "/api/auth/callback/credentials")
  assert.equal(new URL(request.url).origin, expected)
  assert.equal(request.nextUrl.origin, expected)
  const oldNumeric = new NextRequest("http://127.0.0.1:45678/api/auth/callback/credentials")
  assert.notEqual(new URL(oldNumeric.url).origin, "http://127.0.0.1:45678")
  assert.equal(new URL(oldNumeric.url).origin, expected)
})
test("application origin accepts only a numeric unprivileged loopback port", () => {
  for (const port of [0, -1, 80, 65536, NaN, "45678", "example.test"]) {
    assert.throws(() => loopbackApplicationOrigin(port), /INVALID_EPHEMERAL_APP_PORT/)
  }
})
