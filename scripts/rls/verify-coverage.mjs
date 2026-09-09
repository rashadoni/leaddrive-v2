// Verify that the DATABASE actually enforces tenant isolation — not that the
// code remembers to ask for it.
//
// Finding F-25 (docs/isms/ISMS-02-gap-analysis.md). `find-context-gaps.py`
// checks call sites; nothing checked the server. Of 480 tenant tables only 150
// received RLS from a migration — the rest were switched on by hand on
// production. A database built from migrations alone therefore had ~330 tables
// wide open, including `users`, `api_keys`, `otp_codes` and `audit_logs`, and
// nothing failed: queries simply start returning other tenants' rows.
//
// A tenant table is one carrying an `organizationId` column.
//
// THAT DEFINITION HAS A BLIND SPOT, and it cost two HIGH findings (F-55, F-56).
// A child table with only a parent foreign key — offer_items -> offers,
// deal_competitors -> deals — holds tenant data just as surely, but carries no
// `organizationId`, so it was never counted, never checked and never reported.
// Its isolation is not enforced by the database at all: it depends on every
// caller remembering to filter through the parent, and two callers did not.
//
// Such tables are now listed as a SEPARATE, NON-FATAL category at the end of the
// run, so the next audit starts from a list instead of a discovery. They are not
// reported as leaks: most are genuinely fine, and failing the deploy gate on
// them would be false-positive noise. Tables already cleared by the 2026-08-27
// audit are folded into a count; anything NEW is named, because a child table
// nobody has looked at is exactly what F-55 and F-56 were.
//
// This does NOT test three flags separately, because the flags do not mean
// anything separately. It computes the OUTCOME for the role the application
// connects as:
//
//   * RLS off                          → every row of every tenant, always.
//   * role owns the table, no FORCE     → the policy exists and is skipped.
//     (FORCE is what makes a policy apply to the table's owner. `hermes` owns
//     most of this schema, so on this database it is not a hardening extra —
//     it is the difference between isolation and none.)
//   * role is SUPERUSER or BYPASSRLS    → policies never run at all, and no
//     amount of FORCE changes that.
//   * RLS on, policy applies, 0 policies → denies everything. Not a leak; a
//     dead table. Reported separately, because "safe" and "working" differ.
//
// A table that is not FORCEd but is owned by somebody else is reported as a
// warning, not a gap: isolation holds today and disappears the day ownership
// or the connection role changes, with no error in between.
//
// Env: DATABASE_URL, optional RLS_COVERAGE_ALLOWLIST=table1,table2
// Exit: 0 all covered · 1 gaps found · 2 could not check
import { makeScriptPrisma } from "./../_rls.mjs"

const allowlist = new Set(
  (process.env.RLS_COVERAGE_ALLOWLIST ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
)

// Child tables reviewed by the multi-agent audit of 2026-08-27, with the reason
// each was cleared. Listing them here keeps the output about what is NEW.
// Two more — offer_items and deal_competitors — were found exploitable and are
// NOT here: they were given their own `organizationId` and tenant_isolation
// policy by 20260828060000_offer_items_deal_competitors_rls, so they now appear
// in the main coverage count above like any other tenant table.
const REVIEWED_CHILDREN = new Map([
  // Isolated in practice because every read and write goes through the parent,
  // which is itself under FORCE RLS.
  ["invoice_items", "safe via parent"],
  ["recurring_invoice_items", "safe via parent"],
  ["quote_line_items", "safe via parent"],
  ["buyer_order_items", "safe via parent"],
  ["order_return_items", "safe via parent"],
  ["deal_contact_roles", "safe via parent"],
  ["deal_team_members", "safe via parent"],
  ["event_participants", "safe via parent"],
  ["territory_memberships", "safe via parent"],
  ["ticket_comments", "safe via parent"],
  ["ai_chat_messages", "safe via parent"],
  ["agent_steps", "safe via parent"],
  ["journey_steps", "safe via parent"],
  ["workflow_actions", "safe via parent"],
  ["campaign_variants", "safe via parent"],
  ["contract_approval_rule_actions", "safe via parent"],
  ["accounts", "safe via parent"],
  // Not tenant data at all.
  ["apps", "global/system table"],
  ["plan_templates", "global/system table"],
  ["organizations", "global/system table"],
  // No rows and no code path that writes any.
  ["cart_items", "unused"],
  ["request_for_quote_items", "unused"],
  ["promotion_tactics", "unused"],
  ["page_views", "unused"],
])

let prisma
try {
  prisma = await makeScriptPrisma()
} catch (err) {
  console.error(`[rls-coverage] cannot connect: ${err.message}`)
  process.exit(2)
}

try {
  const [role] = await prisma.$queryRawUnsafe(`
    SELECT current_user                AS name,
           r.rolsuper                  AS is_super,
           r.rolbypassrls              AS bypass_rls
    FROM pg_roles r WHERE r.rolname = current_user
  `)

  const rows = await prisma.$queryRawUnsafe(`
    SELECT c.relname                              AS table_name,
           c.relrowsecurity                       AS enabled,
           c.relforcerowsecurity                  AS forced,
           pg_get_userbyid(c.relowner)            AS owner,
           pg_has_role(current_user, c.relowner, 'USAGE') AS owns,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'organizationId'
      )
    ORDER BY c.relname
  `)

  // Child tables: no `organizationId` of their own, but a foreign key to a table
  // that has one. Nothing in the database isolates these — only application code
  // does, by filtering through the parent on every single query.
  const childRows = await prisma.$queryRawUnsafe(`
    SELECT child.relname AS table_name,
           string_agg(DISTINCT parent.relname, ', ') AS parents
    FROM pg_constraint con
    JOIN pg_class     child  ON child.oid  = con.conrelid
    JOIN pg_class     parent ON parent.oid = con.confrelid
    JOIN pg_namespace cn ON cn.oid = child.relnamespace
    JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    WHERE con.contype = 'f'
      AND cn.nspname = 'public'
      AND pn.nspname = 'public'
      AND child.relkind = 'r'
      AND child.oid <> parent.oid
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = child.relname
          AND col.column_name = 'organizationId'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = parent.relname
          AND col.column_name = 'organizationId'
      )
    GROUP BY child.relname
    ORDER BY child.relname
  `)

  // A role that bypasses RLS at the server level makes the per-table answer
  // irrelevant: no policy on any table will ever run for it.
  if (role?.is_super || role?.bypass_rls) {
    const why = role.is_super ? "is a SUPERUSER" : "carries BYPASSRLS"
    console.error(`[rls-coverage] the application role "${role.name}" ${why}.`)
    console.error("Every policy on every table is skipped for it. Per-table")
    console.error("results below would be misleading, so they are not shown.")
    process.exit(1)
  }

  const leaks = []   // isolation is not enforced
  const dead = []    // enforced so hard the table returns nothing
  const warns = []   // enforced today, silently unenforced after a change
  let covered = 0

  for (const r of rows) {
    if (allowlist.has(r.table_name)) continue
    const policies = Number(r.policies)
    const ownerBypasses = r.owns && !r.forced

    if (!r.enabled) {
      leaks.push([r.table_name, "RLS disabled — every tenant's rows are returned"])
    } else if (ownerBypasses) {
      leaks.push([
        r.table_name,
        `owned by "${r.owner}", which this role has, and not FORCEd — the policy is skipped`,
      ])
    } else if (policies === 0) {
      dead.push([r.table_name, "RLS on with no policy — returns nothing to anyone"])
    } else {
      covered++
      if (!r.forced) {
        warns.push([
          r.table_name,
          `not FORCEd. Isolation holds only because "${r.owner}" owns it and this ` +
          `role does not; it ends the moment either changes, with no error`,
        ])
      }
    }
  }

  const skipped = [...allowlist].filter(t => rows.some(r => r.table_name === t)).length
  console.log(
    `[rls-coverage] role: ${role?.name} · tenant tables: ${rows.length} · ` +
    `checked: ${rows.length - skipped} · enforced: ${covered} · ` +
    `leaks: ${leaks.length} · unreadable: ${dead.length} · warnings: ${warns.length}`
  )
  if (skipped) console.log(`[rls-coverage] explicitly allowlisted: ${[...allowlist].join(", ")}`)

  for (const [table, why] of warns) console.log(`  ! ${table}: ${why}`)

  // ── Child tables isolated only by application code ────────────────────────
  // Informational. This category NEVER changes the exit code: it is a starting
  // point for the next review, not a verdict, and the deploy gate must not begin
  // failing on tables that were fine yesterday.
  const reviewed = childRows.filter(r => REVIEWED_CHILDREN.has(r.table_name))
  const unreviewed = childRows.filter(r => !REVIEWED_CHILDREN.has(r.table_name))

  console.log("")
  console.log(
    `[rls-coverage] child tables with no organizationId (isolated by application ` +
    `code only): ${childRows.length} · reviewed: ${reviewed.length} · ` +
    `NOT YET REVIEWED: ${unreviewed.length}`
  )
  console.log(
    "  These carry tenant data through a parent FK but hold no organizationId, so"
  )
  console.log(
    "  no policy can apply to them and the main count above cannot see them. Every"
  )
  console.log(
    "  query against one must filter through its parent — findings F-55/F-56 are"
  )
  console.log("  what happens when one does not.")
  if (unreviewed.length) {
    console.log("  Not yet reviewed — check every read and write against these:")
    for (const r of unreviewed) console.log(`    ? ${r.table_name} → parent: ${r.parents}`)
  } else if (childRows.length) {
    console.log("  All of them were cleared by the 2026-08-27 audit.")
  }

  if (leaks.length === 0 && dead.length === 0) {
    console.log("[rls-coverage] OK — every tenant table enforces isolation.")
    process.exit(0)
  }

  if (leaks.length) {
    console.error("")
    console.error("[rls-coverage] TENANT ISOLATION NOT ENFORCED:")
    for (const [table, why] of leaks) console.error(`  ${table}: ${why}`)
    console.error("")
    console.error("This is not a warning. Until it is closed, a query against these")
    console.error("tables can return rows belonging to other tenants.")
    console.error("Remediation: bash scripts/rls/enable-one.sh <table>")
  }

  if (dead.length) {
    console.error("")
    console.error("[rls-coverage] RLS ON WITH NO POLICY (no leak — the table is unreadable):")
    for (const [table, why] of dead) console.error(`  ${table}: ${why}`)
  }

  process.exit(1)
} finally {
  await prisma.$disconnect()
}
