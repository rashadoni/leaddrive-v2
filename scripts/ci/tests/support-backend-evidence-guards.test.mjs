import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
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
  const code = [
    'import assert from "node:assert/strict"; import net from "node:net"; import dns from "node:dns"; import dgram from "node:dgram";',
    'for (const action of [()=>net.connect({host:"203.0.113.1",port:25}),()=>dns.lookup("example.invalid",()=>{}),()=>dgram.createSocket("udp4")]) assert.throws(action,/SUPPORT_BACKEND_OUTBOUND_BLOCKED/);',
    'const server=net.createServer(socket=>socket.end("local")); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));',
    'const client=net.connect({host:"127.0.0.1",port:server.address().port}); let data=""; client.on("data",chunk=>data+=chunk); await new Promise(resolve=>client.on("end",resolve)); assert.equal(data,"local"); await new Promise(resolve=>server.close(resolve));',
  ].join("\n")
  try {
    const result=spawnSync(process.execPath,["--import",path.join(root,"scripts/support-backend-network-guard.mjs"),"--input-type=module","-e",code],{env:{PATH:process.env.PATH,SUPPORT_BACKEND_NETWORK_LOG:log},encoding:"utf8",timeout:15_000})
    assert.equal(result.status,0,result.stderr)
    assert.equal(readFileSync(log,"utf8").trim().split("\n").length,3)
  } finally { rmSync(cwd,{recursive:true}) }
})
test("real harness refuses local execution before loading Prisma or making requests", () => {
  const result=spawnSync(process.execPath,[path.join(root,"scripts/support-backend-evidence.mjs")],{env:{PATH:process.env.PATH,CI:"false"},encoding:"utf8",timeout:15_000})
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/HOSTED_EPHEMERAL_REQUIRED/)
})
