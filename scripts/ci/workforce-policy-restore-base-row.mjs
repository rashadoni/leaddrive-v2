import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { makeRlsTestPrisma } from "../_rls.mjs"
assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true"); assert.equal(process.env.WF_POLICY_RESTORE_POSTGRES, "1")
const url = new URL(process.env.ADMIN_DATABASE_URL)
assert.equal(url.username, "postgres"); assert.equal(url.pathname, "/workforce_manager_today_browser"); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname))
const owner = makeRlsTestPrisma(url.href)
const org = "restore-migration-existing-org", user = "restore-migration-existing-user", id = "restore-migration-existing-draft"
const path = "artifacts/workforce-policy-restore/additive-existing-row-before.json"
const definition = { expectedWorkSeconds: 0, lateGraceSeconds: 0, undertimeToleranceSeconds: 0, overtimeThresholdSeconds: 0, longPauseThresholdSeconds: null }
const definitionHash = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(definition).sort(([a], [b]) => a.localeCompare(b))))).digest("hex")
try {
  if (process.argv[2] === "before") {
    // Minimal projections allow the candidate client to seed the pre-anchor schema.
    await owner.organization.create({ data: { id: org, name: "Additive migration existing fixture", slug: org }, select: { id: true } })
    await owner.user.create({ data: { id: user, organizationId: org, email: user + "@example.test", name: "Fixture actor", role: "admin", passwordHash: randomUUID() }, select: { id: true } })
    await owner.workforcePolicy.create({ data: { id, organizationId: org, version: 1, name: "Existing legacy draft", effectiveFrom: new Date("2090-01-01"), definition, definitionHash, createdByUserId: user }, select: { id: true } })
    for (const [version, status, from, to, system] of [[2, "ACTIVE", "2020-01-01", "2030-12-31", false],
      [3, "RETIRED", "2019-01-01", "2019-12-31", false], [4, "ACTIVE", "2031-01-01", null, true]]) {
      await owner.workforcePolicy.create({ data: { id: id + "-" + version, organizationId: org, version, status,
        name: "Existing published fixture", effectiveFrom: new Date(from), effectiveTo: to == null ? null : new Date(to), definition, definitionHash,
        provenance: system ? "SYSTEM_PROVISIONING" : "TENANT_ADMIN", systemProfileVersion: system ? "existing-fixture-profile" : null,
        createdByUserId: system ? null : user, activatedByUserId: system ? null : user, activatedAt: new Date(from), retiredAt: status === "RETIRED" ? new Date(to) : null }, select: { id: true } })
    }
    const rows = await owner.$queryRaw`SELECT to_jsonb(p) AS row FROM workforce_policies p WHERE "organizationId"=${org} ORDER BY id`
    assert.equal(rows.length, 4); for (const row of rows) assert.equal(Object.hasOwn(row.row, "restoreOperationId"), false)
    await writeFile(path, JSON.stringify(rows.map(row => row.row), null, 2) + "\n", { flag: "wx" })
  } else {
    assert.equal(process.argv[2], "after")
    const before = JSON.parse(await readFile(path, "utf8"))
    const rows = await owner.$queryRaw`SELECT to_jsonb(p) AS row FROM workforce_policies p WHERE "organizationId"=${org} ORDER BY id`
    assert.equal(rows.length, 4)
    const preserved = rows.map(({ row }) => { assert.equal(row.restoreOperationId, null); assert.equal(row.restoreRequestHash, null)
      const original = { ...row }; delete original.restoreOperationId; delete original.restoreRequestHash; return original })
    assert.deepEqual(preserved, before)
    await owner.$transaction(async tx => {
      await tx.workforcePolicy.delete({ where: { id } }) // Ordinary unanchored DRAFT behavior.
      await tx.$executeRawUnsafe("ALTER TABLE workforce_policies DISABLE TRIGGER workforce_policies_published_definition_delete_guard")
      await tx.workforcePolicy.deleteMany({ where: { organizationId: org } })
      await tx.$executeRawUnsafe("ALTER TABLE workforce_policies ENABLE TRIGGER workforce_policies_published_definition_delete_guard")
      await tx.user.delete({ where: { id: user } }); await tx.organization.delete({ where: { id: org } })
    })
    assert.equal(await owner.organization.count({ where: { id: org } }), 0)
    const [guard] = await owner.$queryRaw`SELECT tgenabled FROM pg_trigger WHERE tgname='workforce_policies_published_definition_delete_guard'`
    assert.equal(guard.tgenabled, "O")
    await writeFile("artifacts/workforce-policy-restore/additive-existing-row-after.json", JSON.stringify({ status: "PASS",
      baseSha: process.env.WF_POLICY_RESTORE_BASE_SHA, candidateHead: process.env.WF_POLICY_RESTORE_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA,
      existingRows: 4, beforeWholeRowsPreserved: true, bothNewFieldsNull: true, legacyUnanchoredDeleteAllowed: true, cleanupAbsence: true, publishedDeleteGuardRestored: true,
      boundary: "Four existing populated legacy DRAFT/TENANT_ADMIN ACTIVE/RETIRED/SYSTEM_PROVISIONING ACTIVE rows across actual additive migration on selected exact-base schema; not full historic migration replay." }, null, 2) + "\n", { flag: "wx" })
  }
} finally { await owner.$disconnect() }
