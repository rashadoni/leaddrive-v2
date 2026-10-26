import assert from "node:assert/strict"
import { test } from "node:test"
import { assertDatabaseIdentity, assertLiveDatabase, databaseEnvironment, verifyDatabaseTarget } from "./commission-database.mjs"

const app = { cluster: "123456789", database: "fixture", oid: "16384", recovery: false, readonly: true, role: "fixture_app" }
const migration = { ...app, role: "fixture_owner" }

test("libpq connect_timeout hints preserve fixed budgets and readonly across valid signed int32 values", () => {
  const base = "postgresql://fixture:private@127.0.0.1/fixture"
  for (const hint of ["5", "0", "-1", "+10", "%2B10", "2147483647", "-2147483648"]) {
    const url = `${base}?connect_timeout=${hint}`
    const env = databaseEnvironment(url, url, true)
    assert.equal(env.PGCONNECT_TIMEOUT, "5")
    assert.match(env.PGOPTIONS, /default_transaction_read_only=on/)
    assert.match(env.PGOPTIONS, /statement_timeout=5000/)
  }
  for (const hint of ["", "%2010", "10%20", "1.5", "1e3", "2147483648", "-2147483649", "--1", "1;echo"]) {
    const url = `${base}?connect_timeout=${hint}`
    assert.throws(() => databaseEnvironment(url, url, true), /CONFIG_INVALID_CONNECT_TIMEOUT/)
  }
  assert.throws(() => databaseEnvironment(base, `${base}?connect_timeout=1&connect_timeout=2`, true), /CONFIG_INVALID_DUPLICATE/)
})

test("database admission compares actual cluster/database identity, independently of login role", () => {
  assertDatabaseIdentity(app, migration)
  for (const change of [{ cluster: "987654321" }, { database: "another" }, { oid: "16385" },
    { recovery: true }, { readonly: false }, { cluster: "" }, { oid: "0" }, { role: "" }]) {
    assert.throws(() => assertDatabaseIdentity(app, { ...migration, ...change }), /DATABASE_TARGET_REFUSED/)
    assert.throws(() => assertDatabaseIdentity({ ...app, ...change }, migration), /DATABASE_TARGET_REFUSED/)
  }
})
test("matching physical clone metadata is insufficient without exactly one live app probe", () => {
  assertDatabaseIdentity(app, migration)
  assertLiveDatabase("1")
  for (const count of ["0", "2", "", "1\n1", null]) assert.throws(() => assertLiveDatabase(count), /DATABASE_LIVE_TARGET_REFUSED/)
})

const fixtureUrl = process.env.IDENTITY_COMMISSION_TEST_DATABASE_URL
test("actual PostgreSQL aliases share one live readonly database; another database is refused", { skip: !fixtureUrl, timeout: 60_000 }, () => {
  const alias = new URL(fixtureUrl)
  assert.equal(alias.hostname, "127.0.0.1", "Hosted fixture must be disposable loopback PostgreSQL")
  assert.equal(alias.pathname, "/identity_snapshot_contract_test")
  alias.hostname = "localhost"
  alias.search = "?connect_timeout=+0"
  const migrationWithHint = new URL(fixtureUrl)
  migrationWithHint.search = "?connect_timeout=-1"
  assert.equal(verifyDatabaseTarget(alias.href, migrationWithHint.href), true)
  const another = new URL(fixtureUrl)
  another.pathname = "/postgres"
  assert.throws(() => verifyDatabaseTarget(alias.href, another.href), /DATABASE_TARGET_REFUSED/)
  const denied = new URL(fixtureUrl)
  denied.password = "rejected-fixture-password"
  assert.throws(() => verifyDatabaseTarget(denied.href, fixtureUrl), error => error.message === "IDENTITY_COMMISSION_DATABASE_PROBE_FAILED")
})
