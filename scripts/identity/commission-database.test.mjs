import assert from "node:assert/strict"
import { test } from "node:test"
import { assertDatabaseIdentity, assertLiveDatabase, verifyDatabaseTarget } from "./commission-database.mjs"

const app = { cluster: "123456789", database: "fixture", oid: "16384", recovery: false, readonly: true, role: "fixture_app" }
const migration = { ...app, role: "fixture_owner" }

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
  assert.equal(verifyDatabaseTarget(alias.href, fixtureUrl), true)
  const another = new URL(fixtureUrl)
  another.pathname = "/postgres"
  assert.throws(() => verifyDatabaseTarget(alias.href, another.href), /DATABASE_TARGET_REFUSED/)
  const denied = new URL(fixtureUrl)
  denied.password = "rejected-fixture-password"
  assert.throws(() => verifyDatabaseTarget(denied.href, fixtureUrl), error => error.message === "IDENTITY_COMMISSION_DATABASE_PROBE_FAILED")
})
