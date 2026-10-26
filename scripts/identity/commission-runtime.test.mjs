import assert from "node:assert/strict"
import { test } from "node:test"
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { commissionInput, envValue, parseRings, planKeyPreparation, databaseEnvironment, assertInventory, assertLiveKeys, replaceEnvironment } from "./commission-runtime.mjs"

const state = { privileged: true, flagValid: true, companyCount: 1, enabled: false, canonicalCount: 0, proofCount: 0 }
const values = [1, 2].map(n => JSON.stringify({ active: "fixture", keys: { fixture: String(n).repeat(64) } }))
const source = `UNRELATED='preserve literal $(command) and spaces'\nIDENTITY_MOBILE_SESSION_KEYS='${values[0]}'\nIDENTITY_PHONE_PROOF_KEYS='${values[1]}'\n`

test("operator admission refuses arbitrary actions, shell/path input and non-SHA revisions", () => {
  assert.equal(commissionInput("inspect", "fixture-company", "a".repeat(40), "fixture-operator").mode, "inspect")
  for (const input of [["disable", "fixture", "a".repeat(40), "operator"], ["inspect", "fixture;echo", "a".repeat(40), "operator"],
    ["inspect", "../fixture", "a".repeat(40), "operator"], ["inspect", "fixture", "main", "operator"], ["inspect", "fixture", "a".repeat(40), "x' y"]]) {
    assert.throws(() => commissionInput(...input), /INPUT_INVALID/)
  }
})
test("environment parser never evaluates values and refuses ambiguous duplicate definitions", () => {
  assert.equal(envValue(source, "UNRELATED"), "preserve literal $(command) and spaces")
  assert.equal(envValue("export EXAMPLE = 'literal'\r\n", "EXAMPLE"), "literal")
  assert.equal(envValue(source, "MISSING"), undefined)
  assert.throws(() => envValue("EXAMPLE=x\n export EXAMPLE=y", "EXAMPLE"), /ENV_DUPLICATE/)
})
test("key admission refuses partial, malformed, all-zero and cross-purpose duplicate authority", () => {
  assert.equal(parseRings([undefined, undefined]), null)
  assert.equal(parseRings(values).length, 2)
  for (const pair of [[values[0], undefined], ["", values[1]], [values[0], values[0]], ["{}", values[1]],
    [JSON.stringify({ active: "fixture", keys: { fixture: "0".repeat(64) } }), values[1]],
    [JSON.stringify({ active: "missing", keys: { fixture: "3".repeat(64) } }), values[1]]]) {
    assert.throws(() => parseRings(pair), /KEYS_INVALID/)
  }
})
test("first preparation generates independent durable keys while preserving all existing environment bytes", () => {
  const before = "UNRELATED='kept'\n"
  const result = planKeyPreparation(before, state, [undefined, undefined])
  assert.equal(result.created, true); assert.ok(result.source.startsWith(before))
  const rings = parseRings(["IDENTITY_MOBILE_SESSION_KEYS", "IDENTITY_PHONE_PROOF_KEYS"].map(key => envValue(result.source, key)))
  assert.equal(rings.length, 2)
  const retried = planKeyPreparation(result.source, { ...state, canonicalCount: 4, proofCount: 9 }, [])
  assert.equal(retried.created, false); assert.ok(retried.source === result.source)
})
test("missing durable keys are never replaced after a proof, conversion or live process key", () => {
  for (const [inventory, live] of [[{ ...state, canonicalCount: 1 }, []], [{ ...state, proofCount: 1 }, []], [state, values]]) {
    assert.throws(() => planKeyPreparation("OTHER=kept\n", inventory, live), /RESTORE_KEYS_REQUIRED/)
  }
})
test("operator inventory must be unfiltered and identify exactly one active company", () => {
  assertInventory(state)
  for (const change of [{ privileged: false }, { flagValid: false }, { companyCount: 0 }, { companyCount: 2 }, { enabled: "true" }, { canonicalCount: -1 }, { proofCount: 0.5 }]) {
    assert.throws(() => assertInventory({ ...state, ...change }), /INVENTORY_REFUSED/)
  }
})
test("opt-in requires both dedicated rings in every live application process", () => {
  assertLiveKeys(source, [values, values])
  for (const live of [[], [[undefined, undefined]], [values, [undefined, undefined]], [[values[1], values[0]]]]) {
    assert.throws(() => assertLiveKeys(source, live), /REDEPLOY_REQUIRED/)
  }
})
test("database credentials stay in a constrained child environment with explicit readonly inspection", () => {
  const app = "postgresql://fixture_app:fixture@127.0.0.1:5432/fixture_db?schema=public"
  const db = "postgresql://fixture_owner:fixture@127.0.0.1:5432/fixture_db?sslmode=require"
  const env = databaseEnvironment(app, db, true)
  assert.equal(env.PGUSER, "fixture_owner"); assert.equal(env.PGSSLMODE, "require")
  assert.match(env.PGOPTIONS, /default_transaction_read_only=on/)
  assert.match(databaseEnvironment(app, db, false).PGOPTIONS, /default_transaction_read_only=off/)
  // Parsing is not target admission: the CLI verifies actual cluster/database
  // identity and an observed live app backend before inventory or any write.
  assert.equal(databaseEnvironment(app, db.replace("127.0.0.1", "another-host"), true).PGHOST, "another-host")
  for (const url of [db + "&options=unsafe", db + "&sslmode=disable", "not-a-url"]) {
    assert.throws(() => databaseEnvironment(app, url, true), /DATABASE_CONFIG_INVALID/)
  }
})
test("managed PostgreSQL CA and verify-full survive sanitized operator connection", () => {
  const app = "postgresql://fixture_app:fixture@db.invalid:5432/fixture_db?sslmode=verify-full&sslrootcert=%2Fetc%2Fleaddrive%2Fmanaged-postgres-ca.crt"
  const db = app.replace("fixture_app", "fixture_owner")
  const previous = process.env.PGOPTIONS
  process.env.PGOPTIONS = "-c default_transaction_read_only=off"
  try {
    const env = databaseEnvironment(app, db, true)
    assert.equal(env.PGSSLROOTCERT, "/etc/leaddrive/managed-postgres-ca.crt")
    assert.equal(env.PGSSLMODE, "verify-full")
    assert.equal(env.PGUSER, "fixture_owner")
    assert.match(env.PGOPTIONS, /default_transaction_read_only=on/)
    assert.match(databaseEnvironment(app, db, false).PGOPTIONS, /default_transaction_read_only=off/)
    for (const suffix of ["&sslrootcert=/another-ca", "&options=-c%20default_transaction_read_only=off", "&hostaddr=another-host"]) {
      assert.throws(() => databaseEnvironment(app, db + suffix, true), /DATABASE_CONFIG_INVALID/)
    }
    for (const value of ["relative-ca", "", "%00", "%2Fca%0Aoverride"]) {
      assert.throws(() => databaseEnvironment(app, db.replace("%2Fetc%2Fleaddrive%2Fmanaged-postgres-ca.crt", value), true), /DATABASE_CONFIG_INVALID_OPTION/)
    }
  } finally {
    if (previous === undefined) delete process.env.PGOPTIONS
    else process.env.PGOPTIONS = previous
  }
})
test("database refusals expose only fixed reason categories, never URL material", () => {
  const app = "postgresql://fixture_app:private-fixture@db.invalid/fixture_db"
  for (const [db, reason] of [[app + "?sslmode=require&sslmode=disable", "DUPLICATE"], [app + "?secret-option=private-fixture", "OPTION"]]) {
    assert.throws(() => databaseEnvironment(app, db, true), error => error.message === `IDENTITY_COMMISSION_DATABASE_CONFIG_INVALID_${reason}`)
  }
})
function fileFixture(work) {
  const root = mkdtempSync(path.join(tmpdir(), "identity-commission-test-")), file = path.join(root, "app.env")
  writeFileSync(file, source, { mode: 0o600 })
  try { work({ root, file, uid: process.getuid(), gid: process.getgid() }) } finally { rmSync(root, { recursive: true, force: true }) }
}
test("environment replacement is atomic, private, preserves bytes and removes only its temporary file", () => fileFixture(options => {
  replaceEnvironment(source, source + "OTHER=kept\n", options)
  assert.ok(readFileSync(options.file, "utf8") === source + "OTHER=kept\n")
  assert.equal(statSync(options.file).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(options.root), ["app.env"])
}))
test("environment changed since review is preserved and cannot be overwritten", () => fileFixture(options => {
  writeFileSync(options.file, "CONCURRENT=preserved\n")
  assert.throws(() => replaceEnvironment(source, "replacement", options), /ENV_CHANGED/)
  assert.equal(readFileSync(options.file, "utf8"), "CONCURRENT=preserved\n")
  assert.deepEqual(readdirSync(options.root), ["app.env"])
}))
test("unsafe file mode and symlink never permit changing another file", () => fileFixture(options => {
  chmodSync(options.file, 0o644)
  assert.throws(() => replaceEnvironment(source, "replacement", options), /FILE_UNSAFE/)
  chmodSync(options.file, 0o600)
  const link = path.join(options.root, "link.env")
  symlinkSync(options.file, link)
  assert.throws(() => replaceEnvironment(source, "replacement", { ...options, file: link }), /FILE_UNSAFE/)
  assert.ok(readFileSync(options.file, "utf8") === source)
}))
test("group/world writable parent is refused before any environment write", () => fileFixture(options => {
  chmodSync(options.root, 0o777)
  assert.throws(() => replaceEnvironment(source, "replacement", options), /DIRECTORY_UNSAFE/)
  assert.ok(readFileSync(options.file, "utf8") === source)
}))
test("unprivileged CLI emits only a bounded refusal without reading production files", { skip: process.getuid?.() === 0 }, () => {
  const result = spawnSync(process.execPath, [new URL("./commission-runtime.mjs", import.meta.url).pathname, "inspect", "fixture", "a".repeat(40), "fixture"], { encoding: "utf8" })
  assert.equal(result.status, 1); assert.equal(result.stdout, "")
  assert.equal(result.stderr.trim(), "IDENTITY_COMMISSION_ROOT_REQUIRED")
})
