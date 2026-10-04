import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { makeRlsTestPrisma } from "../_rls.mjs"

// This removes only schema-push-created anchors in an empty disposable fixture,
// before any selected canonical SQL, role setup or seed. Never a migration tool.
const indexName = "workforce_policies_organizationId_restoreOperationId_key"
const anchorNames = ["restoreOperationId", "restoreRequestHash"]
const addAnchors = [
  'ALTER TABLE public.workforce_policies ADD COLUMN "restoreOperationId" text, ADD COLUMN "restoreRequestHash" varchar(64)',
  `CREATE UNIQUE INDEX "${indexName}" ON public.workforce_policies ("organizationId", "restoreOperationId")`,
]
const rollbackMarker = new Error("FIXTURE_CONTROL_ROLLBACK")

export function classifyRestoreAnchorCatalog(catalog) {
  assert.equal(catalog.identity.user, "postgres", "Exact fixture owner required")
  assert.equal(catalog.identity.database, "workforce_manager_today_browser", "Exact fixture database required")
  assert.equal(catalog.identity.owner, true, "Policy table must belong to fixture owner")
  assert.ok(catalog.triggers.every(row => row.internal), "Conversion must precede all fixture guard imports")
  assert.ok(catalog.empty.every(row => row.empty === true), "Policy and core fixture tables must be empty")
  const columns = catalog.columns.filter(row => anchorNames.includes(row.name))
  const indexes = catalog.indexes.filter(row => row.name === indexName)
  if (columns.length === 0) {
    assert.equal(indexes.length, 0, "An absent anchor cannot have its index")
    assert.equal(catalog.dependencies.length, 0)
    return "ABSENT"
  }
  assert.equal(columns.length, 2, "Partial restore anchors are excluded")
  for (const [position, name] of anchorNames.entries()) {
    const column = columns.find(row => row.name === name)
    assert.ok(column)
    assert.equal(column.type, position === 0 ? "text" : "character varying(64)")
    assert.equal(column.nullable, true)
    assert.equal(column.default, null)
    assert.equal(column.generated, "")
    assert.equal(column.identity, "")
  }
  assert.equal(indexes.length, 1, "Exact restore unique index required")
  const index = indexes[0]
  assert.deepEqual(index.keys, ["organizationId", "restoreOperationId"])
  assert.equal(index.unique, true); assert.equal(index.valid, true); assert.equal(index.ready, true)
  assert.equal(index.primary, false); assert.equal(index.method, "btree")
  assert.equal(index.predicate, null); assert.equal(index.expressions, null)
  assert.equal(index.keyCount, 2); assert.equal(index.attributeCount, 2)
  assert.equal(index.constraintCount, 0)
  assert.deepEqual(index.options, [0, 0]); assert.deepEqual(index.collations, index.defaultCollations)
  assert.ok(index.defaultOperatorClasses.every(Boolean))
  // DROP COLUMN can implicitly remove dependent indexes/checks without CASCADE.
  // Reject every column dependency except the one exact ordinary unique index.
  assert.ok(catalog.dependencies.every(row => row.class === "pg_class" && row.name === indexName && row.type === "a"),
    "Unexpected anchor-dependent object is excluded")
  return "ANCHORED"
}

async function catalog(tx) {
  const [identity] = await tx.$queryRawUnsafe(`SELECT current_user AS "user", current_database() AS database,
    c.relowner=r.oid AS owner,c.relrowsecurity AS rls,c.relforcerowsecurity AS force
    FROM pg_class c JOIN pg_roles r ON r.rolname=current_user WHERE c.oid='public.workforce_policies'::regclass`)
  const empty = await tx.$queryRawUnsafe(`SELECT 'workforce_policies' AS table, NOT EXISTS(SELECT 1 FROM public.workforce_policies) AS empty
    UNION ALL SELECT 'organizations',NOT EXISTS(SELECT 1 FROM public.organizations)
    UNION ALL SELECT 'users',NOT EXISTS(SELECT 1 FROM public.users)
    UNION ALL SELECT 'mtm_audit_logs',NOT EXISTS(SELECT 1 FROM public.mtm_audit_logs)`)
  const columns = await tx.$queryRawUnsafe(`SELECT a.attname AS name,a.attnum AS position,format_type(a.atttypid,a.atttypmod) AS type,
    NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS default,a.attgenerated::text AS generated,a.attidentity::text AS identity,
    a.attcollation::int AS collation FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.workforce_policies'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)
  const indexes = await tx.$queryRawUnsafe(`SELECT c.relname AS name,i.indisunique AS unique,i.indisvalid AS valid,i.indisready AS ready,
    i.indisprimary AS primary,am.amname AS method,pg_get_expr(i.indpred,i.indrelid) AS predicate,
    pg_get_expr(i.indexprs,i.indrelid) AS expressions,i.indnkeyatts::int AS "keyCount",i.indnatts::int AS "attributeCount",
    (SELECT count(*)::int FROM pg_constraint WHERE conindid=i.indexrelid) AS "constraintCount",
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num,n) LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY n) AS keys,
    ARRAY(SELECT x::int FROM unnest(i.indoption) x) AS options,ARRAY(SELECT x::int FROM unnest(i.indcollation) x) AS collations,
    ARRAY(SELECT a.attcollation::int FROM unnest(i.indkey) WITH ORDINALITY k(num,n) LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY n) AS "defaultCollations",
    ARRAY(SELECT o.opcdefault FROM unnest(i.indclass) WITH ORDINALITY k(num,n) JOIN pg_opclass o ON o.oid=k.num ORDER BY n) AS "defaultOperatorClasses",
    pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid='public.workforce_policies'::regclass ORDER BY c.relname`)
  const dependencies = await tx.$queryRawUnsafe(`SELECT d.classid::regclass::text AS class,CASE WHEN d.classid='pg_class'::regclass
    THEN (SELECT relname FROM pg_class WHERE oid=d.objid) ELSE NULL END AS name,d.deptype::text AS type,
    pg_describe_object(d.classid,d.objid,d.objsubid) AS description FROM pg_depend d
    WHERE d.refclassid='pg_class'::regclass AND d.refobjid='public.workforce_policies'::regclass
      AND d.refobjsubid IN (SELECT attnum FROM pg_attribute WHERE attrelid=d.refobjid AND attname IN ('restoreOperationId','restoreRequestHash') AND NOT attisdropped)
    ORDER BY d.classid,d.objid,d.objsubid,d.refobjsubid`)
  const constraints = await tx.$queryRawUnsafe(`SELECT conname AS name,pg_get_constraintdef(oid) AS definition,convalidated AS valid
    FROM pg_constraint WHERE conrelid='public.workforce_policies'::regclass ORDER BY conname`)
  const triggers = await tx.$queryRawUnsafe(`SELECT tgname AS name,tgenabled::text AS enabled,tgisinternal AS internal,pg_get_triggerdef(oid) AS definition
    FROM pg_trigger WHERE tgrelid='public.workforce_policies'::regclass ORDER BY tgname`)
  const policies = await tx.$queryRawUnsafe(`SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='workforce_policies' ORDER BY policyname`)
  return { identity, empty, columns, indexes, dependencies, constraints, triggers, policies }
}
function unrelated(value) {
  return { ...value, columns: value.columns.filter(row => !anchorNames.includes(row.name)),
    indexes: value.indexes.filter(row => row.name !== indexName), dependencies: [] }
}
async function convert(tx) {
  const before = await catalog(tx), branch = classifyRestoreAnchorCatalog(before)
  if (branch === "ANCHORED") {
    await tx.$executeRawUnsafe(`DROP INDEX public."${indexName}"`)
    await tx.$executeRawUnsafe('ALTER TABLE public.workforce_policies DROP COLUMN "restoreOperationId", DROP COLUMN "restoreRequestHash"')
  }
  const after = await catalog(tx)
  assert.equal(classifyRestoreAnchorCatalog(after), "ABSENT")
  assert.deepEqual(unrelated(after), unrelated(before), "Unrelated target-table catalog must be unchanged")
  return { branch: branch === "ANCHORED" ? "CONVERTED_EMPTY_BASE_FIXTURE" : "ABSENT_NO_DDL", before, after }
}
async function bounded(owner, callback) {
  return owner.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='3s'")
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout='10s'")
    await tx.$executeRawUnsafe("LOCK TABLE public.workforce_policies,public.organizations,public.users,public.mtm_audit_logs IN ACCESS EXCLUSIVE MODE")
    return callback(tx)
  }, { maxWait: 5000, timeout: 20000 })
}
async function controls(owner, cases) {
  const initial = await bounded(owner, catalog)
  classifyRestoreAnchorCatalog(initial)
  async function test(name, callback) {
    let reached = false
    try {
      await bounded(owner, async tx => {
        await convert(tx)
        for (const sql of addAnchors) await tx.$executeRawUnsafe(sql)
        await callback(tx); reached = true; throw rollbackMarker
      })
      assert.fail("Control must roll back")
    } catch (error) { assert.equal(error, rollbackMarker) }
    assert.equal(reached, true)
    assert.deepEqual(await bounded(owner, catalog), initial)
    cases.push({ name, status: "PASS", actualPostgres: true, wholeCatalogRolledBack: true })
  }
  await test("exact-anchored-conversion-and-absent-no-DDL", async tx => {
    const result = await convert(tx); assert.equal(result.branch, "CONVERTED_EMPTY_BASE_FIXTURE")
    const absent = await convert(tx); assert.equal(absent.branch, "ABSENT_NO_DDL"); assert.deepEqual(absent.before, absent.after)
  })
  const negatives = [
    ["partial-columns", `DROP INDEX public."${indexName}"`, 'ALTER TABLE public.workforce_policies DROP COLUMN "restoreRequestHash"'],
    ["missing-index", `DROP INDEX public."${indexName}"`],
    ["wrong-field-type", 'ALTER TABLE public.workforce_policies ALTER COLUMN "restoreRequestHash" TYPE text'],
    ["nonnullable-field", 'ALTER TABLE public.workforce_policies ALTER COLUMN "restoreRequestHash" SET NOT NULL'],
    ["unexpected-default", 'ALTER TABLE public.workforce_policies ALTER COLUMN "restoreRequestHash" SET DEFAULT repeat(\'a\',64)'],
    ["wrong-index-order", `DROP INDEX public."${indexName}"`, `CREATE UNIQUE INDEX "${indexName}" ON public.workforce_policies ("restoreOperationId","organizationId")`],
    ["extra-dependent-index", 'CREATE INDEX wf_fixture_unexpected_anchor_index ON public.workforce_policies ("restoreRequestHash")'],
    ["extra-dependent-check", 'ALTER TABLE public.workforce_policies ADD CONSTRAINT wf_fixture_unexpected_anchor_check CHECK (length("restoreRequestHash")>0)'],
    ["extra-dependent-view", 'CREATE VIEW public.wf_fixture_unexpected_anchor_view AS SELECT "restoreOperationId" FROM public.workforce_policies'],
    ["populated-core", `INSERT INTO public.organizations (id,name,slug,"updatedAt") VALUES ('wf-fixture-pre-anchor','Fixture','wf-fixture-pre-anchor',now())`],
    ["populated-policy", `INSERT INTO public.organizations (id,name,slug,"updatedAt") VALUES ('wf-fixture-pre-anchor','Fixture','wf-fixture-pre-anchor',now())`,
      `INSERT INTO public.workforce_policies (id,"organizationId",version,name,"effectiveFrom",definition,"definitionHash","updatedAt") VALUES ('wf-fixture-policy','wf-fixture-pre-anchor',1,'Fixture','2090-01-01','{}','${"a".repeat(64)}',now())`],
  ]
  for (const [name, ...sqls] of negatives) await test(name + "-fail-closed", async tx => {
    for (const sql of sqls) await tx.$executeRawUnsafe(sql)
    const before = await catalog(tx)
    await assert.rejects(() => convert(tx), assert.AssertionError)
    assert.deepEqual(await catalog(tx), before)
  })
  // Establish a committed anchored catalog, then throw after successful DROP DDL.
  // The transaction must restore that committed catalog, not merely its setup.
  if (classifyRestoreAnchorCatalog(initial) === "ABSENT") await bounded(owner, async tx => {
    for (const sql of addAnchors) await tx.$executeRawUnsafe(sql)
  })
  const committed = await bounded(owner, catalog)
  try {
    await bounded(owner, async tx => { await convert(tx); throw rollbackMarker })
    assert.fail("DDL fault must roll back")
  } catch (error) { assert.equal(error, rollbackMarker) }
  assert.deepEqual(await bounded(owner, catalog), committed)
  cases.push({ name: "post-DDL-fault-restores-committed-anchors", status: "PASS", actualPostgres: true })
  if (classifyRestoreAnchorCatalog(initial) === "ABSENT") await bounded(owner, convert)
  assert.deepEqual(unrelated(await bounded(owner, catalog)), unrelated(initial))
  return cases
}

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.env.CI, "true")
  assert.equal(process.env.WF_POLICY_RESTORE_POSTGRES, "1"); assert.notEqual(process.env.NODE_ENV, "production")
  for (const value of [process.env.WF_POLICY_RESTORE_HEAD_SHA, process.env.WF_POLICY_RESTORE_BASE_SHA, process.env.GITHUB_SHA]) assert.match(value || "", /^[a-f0-9]{40}$/)
  const url = new URL(process.env.ADMIN_DATABASE_URL)
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol)); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname))
  assert.equal(url.pathname, "/workforce_manager_today_browser"); assert.equal(url.username, "postgres")
  assert.equal(new URL(process.env.EVENT_PLATFORM_TEST_DATABASE_URL).href, url.href)
  const owner = makeRlsTestPrisma(url.href)
  const directory = process.env.WF_POLICY_RESTORE_OUTPUT_DIR || "artifacts/workforce-policy-restore"
  await mkdir(directory, { recursive: true })
  let failed = false, stage = "catalog", cases = [], conversion = null, failure = null
  try {
    stage = "mandatory-real-catalog-controls"; await controls(owner, cases)
    assert.equal(cases.length, 13)
    stage = "convert-empty-selected-base"; conversion = await bounded(owner, convert)
    stage = "complete"
  } catch (error) {
    failed = true
    const position = /workforce-policy-restore-pre-anchor\.mjs:(\d+):(\d+)/.exec(error?.stack || "")
    failure = { name: error?.name === "AssertionError" ? "AssertionError" : "Error",
      sourcePosition: position ? { line: Number(position[1]), column: Number(position[2]) } : null,
      diagnostic: "Fixed category/position only; no raw SQL/database URL/error/stack" }
  }
  finally {
    try { await owner.$disconnect() } catch { failed = true }
    const paths = ["scripts/ci/workforce-policy-restore-pre-anchor.mjs", "scripts/_rls.mjs", ".github/workflows/workforce-policy-restore-evidence.yml",
      "prisma/workforce-restore-base.prisma", "prisma/schema.prisma", "prisma/migrations/20261004073000_workforce_policy_restore_operation_anchor/migration.sql"]
    const sourceBindings = await Promise.all(paths.map(async path => { const raw = await readFile(path); return { path, bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") } }))
    await writeFile(directory + "/selected-pre-anchor-conversion.json", JSON.stringify({ status: failed ? "FAIL" : "PASS", stage, failure, requiredCases: 13, cases, conversion,
      candidateHead: process.env.WF_POLICY_RESTORE_HEAD_SHA, baseSha: process.env.WF_POLICY_RESTORE_BASE_SHA, checkedMergeSha: process.env.GITHUB_SHA, sourceBindings,
      boundary: "Actual PR-base schema push followed by explicitly converted EMPTY disposable pre-anchor fixture, before canonical guards or seeds. Exact target-table columns/indexes/constraints/triggers/policies/RLS preserved; no whole-schema or historical migration replay claim. No production migration, roles, grants or application writer changed." }, null, 2) + "\n", { flag: "wx" })
  }
  assert.equal(failed, false, "Pre-anchor fixture failed; complete fixed-category receipt retained")
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
