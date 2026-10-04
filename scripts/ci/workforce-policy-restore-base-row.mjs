import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { PrismaClient } from "@prisma/client"
assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true"); assert.equal(process.env.WF_POLICY_RESTORE_POSTGRES, "1")
const url = new URL(process.env.ADMIN_DATABASE_URL)
assert.equal(url.username, "postgres"); assert.equal(url.pathname, "/workforce_manager_today_browser"); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname))
const owner = new PrismaClient({ datasourceUrl: url.href })
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
    const [row] = await owner.$queryRaw`SELECT to_jsonb(p) AS row FROM workforce_policies p WHERE id=${id}`
    assert.equal(Object.hasOwn(row.row, "restoreOperationId"), false)
    await writeFile(path, JSON.stringify(row.row, null, 2) + "\n", { flag: "wx" })
  } else {
    assert.equal(process.argv[2], "after")
    const before = JSON.parse(await readFile(path, "utf8"))
    const [row] = await owner.$queryRaw`SELECT to_jsonb(p) AS row FROM workforce_policies p WHERE id=${id}`
    assert.equal(row.row.restoreOperationId, null); assert.equal(row.row.restoreRequestHash, null)
    const preserved = { ...row.row }
    delete preserved.restoreOperationId; delete preserved.restoreRequestHash
    assert.deepEqual(preserved, before)
    await owner.$transaction(async tx => { await tx.workforcePolicy.delete({ where: { id } }); await tx.user.delete({ where: { id: user } }); await tx.organization.delete({ where: { id: org } }) })
    assert.equal(await owner.organization.count({ where: { id: org } }), 0)
    await writeFile("artifacts/workforce-policy-restore/additive-existing-row-after.json", JSON.stringify({ status: "PASS",
      baseSha: process.env.WF_POLICY_RESTORE_BASE_SHA, candidateHead: process.env.WF_POLICY_RESTORE_HEAD_SHA, checkedMergeSha: process.env.GITHUB_SHA,
      beforeWholeRowPreserved: true, bothNewFieldsNull: true, legacyUnanchoredDeleteAllowed: true, cleanupAbsence: true,
      boundary: "One existing populated legacy DRAFT across actual additive migration on selected exact-base schema; not full historic migration replay." }, null, 2) + "\n", { flag: "wx" })
  }
} finally { await owner.$disconnect() }
