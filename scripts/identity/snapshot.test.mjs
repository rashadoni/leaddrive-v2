import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, chmod, readFile, stat, symlink, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { collectIdentitySnapshot, writePrivateSnapshot } from "./snapshot.mjs"

const scope = { organizationId: "org-example", organizationSlug: "example" }
const person = { id: "user-example", organizationId: scope.organizationId, phone: "+994550001122", isActive: true, anonymized: false, hasCredential: false }
const actor = { id: "agent-example", organizationId: scope.organizationId, userId: person.id, phone: null, role: "EMPLOYEE", status: "ACTIVE", attendanceParticipant: true, hasCredential: true }
const snapshot = { schemaVersion: 1, users: [person], agents: [actor] }

function fixture(overrides = {}) {
  const calls = []
  const tx = {
    async $executeRawUnsafe(sql) { calls.push({ sql, args: [] }); return 0 },
    async $queryRawUnsafe(sql, ...args) {
      calls.push({ sql, args })
      if (sql.includes("set_config")) return [{}]
      if (sql.includes("current_setting")) return overrides.mode ?? [{ readOnly: "on", isolation: "repeatable read", organizationId: scope.organizationId, bypass: "off" }]
      if (sql.includes("FROM organizations")) return overrides.organizations ?? [{ id: scope.organizationId, slug: scope.organizationSlug }]
      if (sql.includes("FROM users")) return overrides.users ?? [person]
      if (sql.includes("FROM mtm_agents")) return overrides.agents ?? [actor]
      throw new Error("Unexpected query")
    },
  }
  const client = { async $transaction(fn, options) { calls.push({ options }); return fn(tx) } }
  return { client, calls }
}

test("read-only consistent transaction and tenant scope precede all business reads", async () => {
  const { client, calls } = fixture()
  assert.deepEqual(await collectIdentitySnapshot(client, scope), snapshot)
  assert.deepEqual(calls[0].options, { isolationLevel: "RepeatableRead", timeout: 15_000, maxWait: 5_000 })
  assert.equal(calls[1].sql, "SET TRANSACTION READ ONLY")
  const context = calls.findIndex(call => call.sql?.includes("set_config"))
  const proof = calls.findIndex(call => call.sql?.includes("current_setting"))
  const reads = calls.filter(call => /FROM (users|mtm_agents)/.test(call.sql ?? ""))
  assert.equal(reads.length, 2)
  for (const call of reads) {
    assert.ok(calls.indexOf(call) > proof && proof > context)
    assert.deepEqual(call.args, [scope.organizationId])
    assert.match(call.sql, /WHERE "organizationId" = \$1/)
    assert.match(call.sql, /LIMIT 10001/)
    assert.match(call.sql, /AS "hasCredential"/)
    assert.ok(!call.sql.includes("SELECT *"))
  }
})

test("refuses unproved transaction mode or RLS scope before business data", async () => {
  for (const patch of [{ readOnly: "off" }, { isolation: "read committed" }, { organizationId: "other" }, { bypass: "on" }]) {
    const { client, calls } = fixture({ mode: [{ readOnly: "on", isolation: "repeatable read", organizationId: scope.organizationId, bypass: "off", ...patch }] })
    await assert.rejects(collectIdentitySnapshot(client, scope))
    assert.ok(!calls.some(call => /FROM (users|mtm_agents)/.test(call.sql ?? "")))
  }
})

test("tenant ID and slug must both match before exporting", async () => {
  for (const organizations of [[], [{ id: "wrong", slug: "example" }], [{ id: scope.organizationId, slug: "wrong" }]]) {
    const { client, calls } = fixture({ organizations })
    await assert.rejects(collectIdentitySnapshot(client, scope))
    assert.ok(!calls.some(call => /FROM (users|mtm_agents)/.test(call.sql ?? "")))
  }
})

test("refuses foreign rows, credentials and overflow returned by a broken adapter", async () => {
  for (const overrides of [
    { users: [{ ...person, organizationId: "other" }] },
    { agents: [{ ...actor, organizationId: "other" }] },
    { users: [{ ...person, passwordHash: "PRIVATE" }] },
    { users: Array.from({ length: 10_001 }, (_, i) => ({ ...person, id: `u${i}` })) },
  ]) await assert.rejects(collectIdentitySnapshot(fixture(overrides).client, scope))
})

test("rejects malformed scope before starting a transaction", async () => {
  const { client, calls } = fixture()
  await assert.rejects(collectIdentitySnapshot(client, { ...scope, organizationId: "x'; DROP TABLE users;" }))
  await assert.rejects(collectIdentitySnapshot(client, { ...scope, bypass: true }))
  assert.equal(calls.length, 0)
})

test("private snapshot is 0600, exact, and cannot overwrite an existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "identity-test-")), path = join(dir, "snapshot.json")
  try {
    await writePrivateSnapshot(path, snapshot)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), snapshot)
    await assert.rejects(writePrivateSnapshot(path, snapshot))
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), snapshot)
  } finally { await unlink(path).catch(() => {}); await rmdir(dir) }
})

test("shared directories, final symlinks and repository paths are refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "identity-test-")), path = join(dir, "snapshot.json"), target = join(dir, "target.json")
  try {
    await chmod(dir, 0o755)
    await assert.rejects(writePrivateSnapshot(path, snapshot))
    await chmod(dir, 0o700)
    await symlink(target, path)
    await assert.rejects(writePrivateSnapshot(path, snapshot))
    await assert.rejects(stat(target))
    await assert.rejects(writePrivateSnapshot(fileURLToPath(new URL("./private.json", import.meta.url)), snapshot))
  } finally { await unlink(path).catch(() => {}); await rmdir(dir) }
})

test("CLI refuses missing explicit connection without echoing scope or path", () => {
  const env = { ...process.env }; delete env.IDENTITY_AUDIT_DATABASE_URL
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./snapshot.mjs", import.meta.url)),
    "--organization-id", "private-id", "--organization-slug", "private-slug", "--output", "/private/file.json"],
  { encoding: "utf8", env, timeout: 5_000 })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "IDENTITY_SNAPSHOT_EXPORT_REFUSED\n")
})
