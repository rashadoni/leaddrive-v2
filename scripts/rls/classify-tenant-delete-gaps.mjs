#!/usr/bin/env node
/**
 * Turn the raw output of audit-tenant-delete-cascade.sql into a work plan.
 *
 * That query answers WHICH tables survive a tenant purge (83 of them on prod,
 * 2026-08-26). It cannot answer what to do about each, and "add 83 cascading
 * foreign keys" is the wrong answer: some of these must NOT be cascade-deleted,
 * and some cannot be until something else is deleted first.
 *
 * So this sorts them into buckets by reading schema.prisma, and is deliberately
 * conservative — anything it is not sure about lands in `review`, never in
 * `cascade`. Its output is a starting point for a human, not a migration.
 *
 *   node scripts/rls/classify-tenant-delete-gaps.mjs <audit-output.txt>
 *
 * Buckets:
 *   cascade  — a plain child of the tenant: no other model points at it, and
 *              nothing about it says "keep". A cascading FK is likely right.
 *   ordered  — other models reference it, so deleting it needs an order (or the
 *              parent's own cascade already covers it and the FK is redundant).
 *   keep     — retention-bound or evidentiary (audit/compliance/log). Deleting
 *              these with the tenant may violate the retention rules in
 *              ISMS-12 §1. Decide before touching.
 *   review   — could not be matched to a model in schema.prisma. Most likely a
 *              table created by `db push` that never reached a migration, which
 *              is exactly the drift that made this whole question unanswerable
 *              from the repo.
 */
import { readFileSync } from "node:fs"

const auditPath = process.argv[2]
if (!auditPath) {
  console.error("usage: node scripts/rls/classify-tenant-delete-gaps.mjs <audit-output.txt>")
  process.exit(1)
}

// psql prints "  table_name | reason"; ignore header, separator and "(N rows)".
const tables = readFileSync(auditPath, "utf8")
  .split("\n")
  .map((line) => line.split("|")[0]?.trim())
  .filter((name) => name && /^[a-z_][a-z0-9_]*$/.test(name) && name !== "orphan_table")

if (tables.length === 0) {
  console.error(`No table names found in ${auditPath} — is it the query's output?`)
  process.exit(1)
}

const schema = readFileSync("prisma/schema.prisma", "utf8")
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
  name,
  body,
  table: body.match(/@@map\("([^"]+)"\)/)?.[1] ?? name,
}))
const byTable = new Map(models.map((m) => [m.table, m]))

// A table nothing else points at can be cut loose on its own.
const referenced = new Set()
for (const m of models) {
  for (const [, target] of m.body.matchAll(/@relation\([^)]*\)\s*$/gm)) void target
  for (const [, typeName] of m.body.matchAll(/^\s+\w+\s+(\w+)(\[\]|\?)?\s+@relation/gm)) {
    const t = byTable.get(typeName) ?? models.find((x) => x.name === typeName)
    if (t) referenced.add(t.table)
  }
}

const KEEP = /audit|compliance|_log$|_logs$|history|evidence/
const buckets = { cascade: [], ordered: [], keep: [], review: [] }

for (const table of tables) {
  const model = byTable.get(table)
  if (!model) { buckets.review.push([table, "no model in schema.prisma (db push drift?)"]); continue }
  if (KEEP.test(table)) { buckets.keep.push([table, "retention/evidence — check ISMS-12 §1 first"]); continue }
  if (referenced.has(table)) { buckets.ordered.push([table, "other models reference it — needs a deletion order"]); continue }
  buckets.cascade.push([table, "leaf of the tenant — a cascading FK is likely correct"])
}

console.log(`Tenant-delete gaps from ${auditPath}: ${tables.length} tables\n`)
for (const [name, rows] of Object.entries(buckets)) {
  if (!rows.length) continue
  console.log(`── ${name.toUpperCase()} (${rows.length})`)
  for (const [table, why] of rows.sort()) console.log(`   ${table.padEnd(38)} ${why}`)
  console.log()
}
console.log("Nothing here is a decision. `cascade` is the only bucket that is")
console.log("mechanical, and even it should be read before it is migrated.")
