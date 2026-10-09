import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { FIELDS } from "./workforce-reconciliation-schema-contract.mjs"
import { SOURCE_PATHS, MAX_WIRE_BYTES, readTrustedSource, emitRemoteProgram, validateRemoteOutput, errorReport } from "./hrm-c12-operational-schema-inspection.mjs"

const SOURCE = "a".repeat(40)
const OTHER = "b".repeat(40)
const SECRET = "private_env_value_must_never_leave_validation"
const MODULE = new URL("./hrm-c12-operational-schema-inspection.mjs", import.meta.url)
const read = path => fs.readFileSync(new URL("../" + path, import.meta.url))
const fixture = () => {
  const files = new Map(SOURCE_PATHS.map(path => [path, read(path)]))
  return { head: () => SOURCE, working: path => files.get(path), committed: path => files.get(path), files }
}
const wire = (changes = {}, io = fixture()) => JSON.stringify({
  version: 1, status: "READ_COMPLETE", expectedArtifactSha: SOURCE,
  productionArtifactShaBefore: SOURCE, productionArtifactShaAfter: SOURCE,
  bindings: readTrustedSource(SOURCE, io).bindings,
  snapshot: Object.fromEntries(FIELDS.map(field => [field, true])), code: null, sqlState: null, envDetail: null,
  ...changes,
})
const validate = (text, exit = 0, io = fixture()) => validateRemoteOutput(text, SOURCE, exit, io)
const withheld = result => {
  assert.equal(result.status, "ERROR")
  assert.equal(result.productionObserved, false)
  assert.equal(result.historicalReplay, false)
  assert.equal(result.snapshot, null)
  assert.ok(!JSON.stringify(result).includes(SECRET))
}

test("complete simulated transport and both literal artifact markers admit only the catalog contract", () => {
  const result = validate(wire())
  assert.equal(result.status, "MATCHED_CATALOG_CONTRACT_ONLY")
  assert.equal(result.productionObserved, true)
  assert.equal(result.historicalReplay, false)
  assert.equal(result.originalRemoteWire, wire())
  assert.deepEqual(result.failed, [])
  assert.ok(result.limits.some(value => value.includes("does not complete C12")))
})

test("every missing prerequisite stays individually INCOMPLETE with its actual boolean", () => {
  for (const field of FIELDS) {
    const snapshot = Object.fromEntries(FIELDS.map(key => [key, key !== field]))
    const result = validate(wire({ snapshot }))
    assert.equal(result.status, "INCOMPLETE")
    assert.equal(result.productionObserved, true)
    assert.deepEqual(result.failed, [field])
    assert.equal(result.snapshot[field], false)
  }
})

test("neither failed transport nor a changed deployed marker can claim production observation", () => {
  for (const changes of [{ expectedArtifactSha: OTHER }, { productionArtifactShaBefore: OTHER }, { productionArtifactShaAfter: OTHER }, { productionArtifactShaAfter: null }]) withheld(validate(wire(changes)))
  for (const status of [1, 255]) withheld(validate(wire(), status))
  for (const status of [-1, 256, NaN, "0"]) withheld(validate(wire(), status))
})

test("unknown private fields, role data, wrong flags and SQL error text are withheld", () => {
  for (const changes of [
    { credentials: SECRET }, { role: SECRET }, { version: "1" }, { code: SECRET }, { sqlState: SECRET },
    { snapshot: { ...Object.fromEntries(FIELDS.map(field => [field, true])), employee: SECRET } },
    { snapshot: Object.fromEntries(FIELDS.map(field => [field, field === "rls" ? "true" : true])) },
    { snapshot: [] }, { status: "READY_FOR_REVIEW" }, { bindings: [{ path: SECRET }] },
  ]) withheld(validate(wire(changes)))
})

test("oversized, duplicate-key, truncated, appended and non-JSON wire data never reach an artifact", () => {
  for (const text of [SECRET, " ".repeat(MAX_WIRE_BYTES + 1), wire().slice(0, -1), wire() + "\n" + SECRET,
    wire().replace('"version":1', '"version":1,"version":1'), "null", "[]", "{}"] ) withheld(validate(text))
})

test("finite original query and admission errors stay errors without raw values", () => {
  const io = fixture()
  const common = { status: "ERROR", productionArtifactShaBefore: SOURCE, productionArtifactShaAfter: null, snapshot: null }
  const failure = validate(wire({ ...common, code: "QUERY_FAILED", sqlState: "42501" }, io), 1, io)
  assert.equal(failure.code, "QUERY_FAILED")
  assert.equal(failure.sqlState, "42501")
  assert.equal(failure.productionArtifactShaBefore, SOURCE)
  assert.equal(failure.originalRemoteWire, wire({ ...common, code: "QUERY_FAILED", sqlState: "42501" }, io))
  withheld(failure)
  for (const changes of [{ code: SECRET, sqlState: null }, { code: "QUERY_FAILED", sqlState: SECRET }, { code: "ENV_INVALID", sqlState: "42501" }]) withheld(validate(wire({ ...common, ...changes }), 1))
  withheld(validate(wire({ ...common, code: "ENV_INVALID", sqlState: null }), 0))
})

test("source bindings reject another HEAD, changed worktree bytes and changed approved dependencies", () => {
  for (const path of SOURCE_PATHS) {
    const io = fixture()
    const original = io.files.get(path)
    io.working = name => name === path ? Buffer.concat([original, Buffer.from("\n" + SECRET)]) : io.files.get(name)
    assert.throws(() => readTrustedSource(SOURCE, io), { message: "SOURCE_CHANGED" })
    withheld(validate(wire(), 0, io))
  }
  const io = fixture()
  io.head = () => OTHER
  assert.throws(() => emitRemoteProgram(SOURCE, io), { message: "SOURCE_CHANGED" })
  const changed = fixture()
  changed.files.set(SOURCE_PATHS[0], Buffer.from("not the approved executor"))
  assert.throws(() => readTrustedSource(SOURCE, changed), { message: "SOURCE_CHANGED" })
})

test("a source HEAD changed during binding is rejected before a remote program is emitted", () => {
  const io = fixture()
  let count = 0
  io.head = () => count++ === 0 ? SOURCE : OTHER
  assert.throws(() => emitRemoteProgram(SOURCE, io), { message: "SOURCE_CHANGED" })
})

test("wire binding drift is rejected even when all thirteen catalog flags are true", () => {
  const bindings = readTrustedSource(SOURCE, fixture()).bindings
  for (const change of [list => list.reverse(), list => { list[0].bytes++ }, list => { list[0].sha256 = "0".repeat(64) }, list => { list[0].extra = SECRET }]) {
    const value = structuredClone(bindings)
    change(value)
    withheld(validate(wire({ bindings: value })))
  }
})

test("emitted stdin module rejects a different expected SHA before credentials or filesystem access", () => {
  const io = fixture()
  const program = emitRemoteProgram(SOURCE, io)
  assert.ok(program.startsWith(read(SOURCE_PATHS[0]).toString()))
  const sql = JSON.parse(program.match(/^const C12_INSPECTION_SQL=(.+);$/m)[1])
  assert.equal(sql, read(SOURCE_PATHS[1]).toString())
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: program, encoding: "utf8", timeout: 5000, maxBuffer: MAX_WIRE_BYTES,
    env: { PATH: process.env.PATH, EXPECTED_DEPLOYED_SHA: SECRET },
  })
  assert.equal(result.status, 1)
  assert.equal(result.stderr, "")
  assert.ok(!result.stdout.includes(SECRET))
  const report = JSON.parse(result.stdout)
  assert.equal(report.expectedArtifactSha, SOURCE)
  assert.equal(report.code, "INPUT_INVALID")
  assert.equal(report.productionArtifactShaBefore, null)
  assert.equal(report.productionArtifactShaAfter, null)
})

test("CLI denies URL/SQL overrides and invalid expected SHA without reflecting private input", () => {
  for (const args of [["--emit-remote", SOURCE, "--url", SECRET], ["--error", SECRET, "EARLY_INSPECTION_NOT_COMPLETED"], ["--validate-output", SOURCE, "256"]]) {
    const child = spawnSync(process.execPath, [MODULE.pathname, ...args], { input: SECRET, encoding: "utf8", timeout: 5000, maxBuffer: MAX_WIRE_BYTES })
    assert.equal(child.status, 1)
    assert.ok(!child.stdout.includes(SECRET))
    assert.ok(!child.stderr.includes(SECRET))
    const result = JSON.parse(child.stdout)
    withheld(result)
  }
  const direct = errorReport({ toString() { throw new Error(SECRET) } }, "OUTPUT_INVALID")
  assert.equal(direct.expectedArtifactSha, null)
  withheld(direct)
})

test("real repository mismatch is refused without needing a database or production credential", () => {
  const current = execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("../", import.meta.url), encoding: "utf8" }).trim()
  const wrong = current === OTHER ? SOURCE : OTHER
  assert.throws(() => readTrustedSource(wrong), { message: "SOURCE_CHANGED" })
})

test("failed transport retains only a validated identifier-free original, never a private invalid snapshot", () => {
  const original = wire();
  const result = validate(original, 255);
  assert.equal(result.status, "ERROR");
  assert.equal(result.code, "TRANSPORT_FAILED");
  assert.equal(result.productionObserved, false);
  assert.equal(result.originalRemoteWire, original);
  const unsafe = validate(wire({ snapshot: { ...Object.fromEntries(FIELDS.map(field => [field, true])), employee: SECRET } }), 255);
  withheld(unsafe);
  assert.equal(unsafe.originalRemoteWire, null);
  assert.equal(unsafe.code, "TRANSPORT_OR_OUTPUT_INVALID");
});

test("known environment rejection preserves the precise safe detail and original marker while private or unrelated details are withheld", () => {
  const common = { status: "ERROR", code: "ENV_INVALID", sqlState: null, snapshot: null, productionArtifactShaBefore: SOURCE, productionArtifactShaAfter: null };
  const original = wire({ ...common, envDetail: "ROLE_IDENTITY_MISMATCH" });
  const result = validate(original, 1);
  assert.equal(result.code, "ENV_INVALID");
  assert.equal(result.envDetail, "ROLE_IDENTITY_MISMATCH");
  assert.equal(result.productionArtifactShaBefore, SOURCE);
  assert.equal(result.originalRemoteWire, original);
  withheld(result);
  for (const changes of [{ envDetail: SECRET }, { envDetail: null }, { envDetail: "ROLE_IDENTITY_MISMATCH", code: "QUERY_FAILED" }]) {
    const invalid = validate(wire({ ...common, ...changes }), 1);
    withheld(invalid);
    assert.equal(invalid.originalRemoteWire, null);
    assert.equal(invalid.envDetail, null);
  }
});
