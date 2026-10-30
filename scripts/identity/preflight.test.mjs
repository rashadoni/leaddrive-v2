import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { auditIdentitySnapshot } from "./preflight.mjs"

const user = (overrides = {}) => ({ id: "u1", organizationId: "o1", phone: "+994550001122", isActive: true, anonymized: false, hasCredential: false, ...overrides })
const agent = (overrides = {}) => ({ id: "a1", organizationId: "o1", userId: "u1", phone: "+994550001122", role: "EMPLOYEE", status: "ACTIVE", attendanceParticipant: true, hasCredential: true, ...overrides })
const snapshot = (users = [user()], agents = [agent()]) => ({ schemaVersion: 1, users, agents })
const codes = result => result.issues.map(issue => issue.code)
const cli = input => spawnSync(process.execPath, [fileURLToPath(new URL("./preflight.mjs", import.meta.url))], { input, encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 })

test("same linked person is not counted as two phone owners", () => {
  const result = auditIdentitySnapshot(snapshot())
  assert.equal(result.status, "NO_DETECTED_CONFLICTS")
  assert.equal(result.productionVerified, false)
  assert.equal(result.migrationAuthorized, false)
})

test("changing only the CRM number detects the stale linked card and collision", () => {
  const result = auditIdentitySnapshot(snapshot([user({ phone: "+994550009999" }), user({ id: "u2" })]))
  assert.ok(codes(result).includes("LINKED_PHONE_DISAGREEMENT"))
  const conflict = result.issues.find(issue => issue.code === "PHONE_CLAIM_CONFLICT")
  assert.deepEqual(conflict, { code: "PHONE_CLAIM_CONFLICT", userRows: [1], agentRows: [0] })
})

test("matching formatting and international 00 prefix do not manufacture disagreement", () => {
  assert.equal(auditIdentitySnapshot(snapshot([user({ phone: "00994 55 000 11 22" })], [agent({ phone: "+994 (55) 000-11-22" })])).status, "NO_DETECTED_CONFLICTS")
})

test("national or bare numbers are review cases, never guessed or merged", () => {
  const result = auditIdentitySnapshot(snapshot([user({ phone: "0550001122" })], [agent({ phone: "994550001122" })]))
  assert.equal(result.summary.counts.PHONE_FORMAT_REVIEW, 2)
  assert.ok(!codes(result).includes("PHONE_CLAIM_CONFLICT"))
  assert.equal(result.status, "REVIEW_REQUIRED")
})

test("same number in different tenants remains isolated", () => {
  const result = auditIdentitySnapshot(snapshot([user(), user({ id: "u2", organizationId: "o2" })], [agent(), agent({ id: "a2", userId: "u2", organizationId: "o2" })]))
  assert.equal(result.status, "NO_DETECTED_CONFLICTS")
})

test("cross-tenant reference is never accepted as identity proof", () => {
  const result = auditIdentitySnapshot(snapshot([user()], [agent({ organizationId: "o2" })]))
  assert.ok(codes(result).includes("CROSS_TENANT_LINK"))
  assert.ok(!codes(result).includes("LINKED_PHONE_DISAGREEMENT"))
})

test("missing and standalone actors require explicit identity mapping", () => {
  const result = auditIdentitySnapshot(snapshot([], [agent({ userId: "missing" }), agent({ id: "a2", userId: null })]))
  assert.ok(codes(result).includes("LINKED_ACCOUNT_MISSING"))
  assert.ok(codes(result).includes("ACCOUNT_LINK_REQUIRED"))
  assert.ok(codes(result).includes("PHONE_CLAIM_CONFLICT"))
})

test("multiple actor links are reported without rewriting historical actors", () => {
  const input = snapshot([user()], [agent(), agent({ id: "a2", status: "INACTIVE" })])
  const before = JSON.stringify(input)
  const result = auditIdentitySnapshot(input)
  assert.deepEqual(result.issues.find(issue => issue.code === "MULTIPLE_ACTORS_FOR_ACCOUNT")?.agentRows, [0, 1])
  assert.equal(JSON.stringify(input), before)
})

test("two credential sources require review without receiving or printing passwords", () => {
  const result = auditIdentitySnapshot(snapshot([user({ hasCredential: true })]))
  assert.ok(codes(result).includes("DUAL_CREDENTIAL_SOURCES"))
  assert.throws(() => auditIdentitySnapshot(snapshot([user({ passwordHash: "PRIVATE_HASH" })])), /IDENTITY_SNAPSHOT_INVALID/)
})

test("field attendance and active actor with disabled account are explicit reviews", () => {
  const result = auditIdentitySnapshot(snapshot([user({ isActive: false })], [agent({ role: "AGENT" })]))
  assert.ok(codes(result).includes("FIELD_ROLE_ATTENDANCE_REVIEW"))
  assert.ok(codes(result).includes("ACTIVE_ACTOR_ACCOUNT_DISABLED"))
})

test("phone fallback only uses an explicitly linked account in the same tenant", () => {
  assert.equal(auditIdentitySnapshot(snapshot([user()], [agent({ phone: null })])).status, "NO_DETECTED_CONFLICTS")
  const result = auditIdentitySnapshot(snapshot([user()], [agent({ userId: null, phone: null })]))
  assert.ok(codes(result).includes("ACTIVE_ACTOR_LOGIN_PHONE_UNRESOLVED"))
})

test("inactive historical phone does not block an unrelated active account", () => {
  const result = auditIdentitySnapshot(snapshot([user({ isActive: false }), user({ id: "u2" })], [agent({ status: "INACTIVE" })]))
  assert.ok(!codes(result).includes("PHONE_CLAIM_CONFLICT"))
})

test("rejects unknown fields, malformed flags, duplicate IDs and oversized inventory", () => {
  for (const input of [snapshot([user({ token: "PRIVATE" })]), snapshot([user({ isActive: "true" })]), snapshot([user(), user()]), snapshot(Array.from({ length: 10_001 }, (_, i) => user({ id: `u${i}` }))), { ...snapshot(), schemaVersion: 2 }]) {
    assert.throws(() => auditIdentitySnapshot(input), /IDENTITY_SNAPSHOT_INVALID/)
  }
})

test("CLI provides a private-data-free report and review exit code", () => {
  const input = snapshot([user({ phone: "+994550009999", id: "PRIVATE_USER_ID" })], [agent({ userId: "PRIVATE_USER_ID" })])
  const result = cli(JSON.stringify(input))
  assert.equal(result.status, 2)
  assert.equal(result.stderr, "")
  assert.equal(JSON.parse(result.stdout).status, "REVIEW_REQUIRED")
  for (const value of ["PRIVATE_USER_ID", "o1", "a1", "+994550009999", "+994550001122"]) assert.ok(!result.stdout.includes(value))
})

test("CLI never echoes malformed input or parser diagnostics", () => {
  for (const input of ['{"SECRET_TOKEN":', JSON.stringify(snapshot([user({ passwordHash: "PRIVATE_HASH" })]))]) {
    const result = cli(input)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.equal(result.stderr, "IDENTITY_SNAPSHOT_INVALID_OR_UNREADABLE\n")
  }
})

test("CLI rejects input over the byte limit without echoing it", () => {
  const result = cli(`{"secret":"${"x".repeat(5 * 1024 * 1024)}"}`)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "IDENTITY_SNAPSHOT_INVALID_OR_UNREADABLE\n")
})
