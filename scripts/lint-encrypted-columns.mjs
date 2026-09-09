#!/usr/bin/env node
/**
 * Lint guard: prevent plaintext writes to encrypted PII columns.
 *
 * Background: PR #118-#134 wrapped ~65 PII columns across 19 routes
 * to encrypt on write + soft-decrypt on read. The architect found
 * the same bug class in PR #127 (claims.decisionRationale), #132
 * (policies.cancellationReason), #133 (beneficiaries.revocationReason)
 * — each time, a route handler wrote `data.<col> = supplied` with
 * plaintext where every sibling assignment used encryptForTenant.
 *
 * This script grep-checks the route surface and fails the commit
 * if ANY assignment to an encrypted column doesn't pass through
 * encryptForTenant{,Bound}{,OrNull} on the RHS. Caller: pre-commit
 * hook or CI step.
 *
 * Phase 7 slice-3 migrated R2/R6/R7/R8/R11 + internal-users to the
 * column-bound AAD variants (`encryptForTenantBound(orgId, table,
 * column, value)` + matching `softDecryptForTenantBound`) — the
 * regexes below accept both old and new variants so PRs from either
 * era stay green.
 *
 * Run: `node scripts/lint-encrypted-columns.mjs`
 *
 * Exit codes:
 *   0 — all clear
 *   1 — at least one plaintext-write violation found
 *
 * Update ENCRYPTED_COLUMNS_BY_TABLE when new columns get wrapped.
 */

import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(__filename), "..")

// Map: route directory → list of encrypted column names on that
// route's entity. Keep in sync with PR #118-#134 slice-2 column wrap.
//
// If a new column gets wrapped, add it here AND verify the route
// handler encrypts it before persisting. The lint catches the
// inverse: encrypted column in this map but assignment lacks
// encryptForTenant on the RHS.
const ENCRYPTED_COLUMNS_BY_TABLE = {
  "health-patients": [
    "fullName",
    "sexAtBirth",
    "taxId",
    "addressLine1",
    "city",
    "postalCode",
    "country",
    "insuranceCarrier",
    "insurancePolicyId",
    "emergencyContactName",
    "emergencyContactPhone",
  ],
  "health-encounters": ["reason", "location", "cancellationReason"],
  "health-care-plans": ["description", "cancellationReason"],
  "health-providers": ["fullName"],
  "health-medical-records": ["clinicianNotes"],
  "policy-holders": [
    "fullName",
    "taxId",
    "mailingAddressLine1",
    "mailingCity",
    "mailingPostalCode",
    "mailingCountry",
  ],
  policies: ["cancellationReason"],
  claims: ["description", "decisionRationale"],
  beneficiaries: ["fullName", "relationship", "taxId", "revocationReason"],
  "insurance-service-team-members": ["fullName"],
  citizens: [
    "fullName",
    "taxId",
    "addressLine1",
    "addressLine2",
    "city",
    "stateProvince",
    "postalCode",
    "country",
  ],
  "public-sector-cases": [
    "description",
    "decisionRationale",
    "withdrawalReason",
  ],
  "public-sector-licenses": ["decisionRationale"],
  "public-sector-grants": [
    "narrative",
    "decisionRationale",
    "terminationReason",
  ],
  "public-sector-officials": ["fullName"],
  "media-subscribers": ["displayName"],
  "utility-customers": [
    "accountHolderName",
    "serviceAddressLine1",
    "serviceAddressLine2",
    "serviceCity",
    "servicePostalCode",
    "serviceCountry",
  ],
  "service-calls": [
    "subject",
    "description",
    "resolutionNotes",
    "cancellationReason",
  ],
  outages: ["publicSummary", "internalNotes"],
}

/**
 * For each route + column, search the route's two files (route.ts +
 * [id]/route.ts) for assignments to `<col>` that are NOT wrapped by
 * encryptForTenant{,OrNull}.
 *
 * A valid write looks like one of (both un-bound and bound-AAD variants
 * accepted — see slice-3 migration note in the header):
 *   data.foo = encryptForTenant(orgId, v)
 *   data.foo = encryptForTenantOrNull(orgId, v)
 *   data.foo = encryptForTenantBound(orgId, TABLE, "foo", v)
 *   data.foo = encryptForTenantBoundOrNull(orgId, TABLE, "foo", v)
 *   foo: encryptForTenant(orgId, ...)               // inside data: {}
 *   foo: encryptForTenantOrNull(orgId, ...)
 *   foo: encryptForTenantBound(orgId, TABLE, "foo", ...)
 *   foo: encryptForTenantBoundOrNull(orgId, TABLE, "foo", ...)
 *   data.foo = <fooCiphertext local>                // POST-style local
 *
 * Anything else (e.g. `data.foo = supplied`, `data.foo = v`,
 * `foo: trimOrNull(...)` inside data: {}) is a violation when foo is
 * in the encrypted-columns inventory for that route.
 */
function scanRoute(routeName, columns) {
  const violations = []
  const routeFiles = [
    `src/app/api/v1/${routeName}/route.ts`,
    `src/app/api/v1/${routeName}/[id]/route.ts`,
  ]

  for (const relPath of routeFiles) {
    let content
    try {
      content = readFileSync(resolve(REPO_ROOT, relPath), "utf8")
    } catch {
      continue // file may not exist (some entities are read-only)
    }
    const lines = content.split("\n")

    for (const col of columns) {
      // Match: `<col>: <value>` inside an object literal (POST data: {})
      //    OR: `data.<col> = <value>`
      // Negative pattern: <value> contains encryptForTenant on the same
      // logical statement. To handle multi-line wrapping, we look at
      // the line PLUS the following two lines.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Pattern 1: data.<col> = ...
        const propAssign = new RegExp(`\\bdata\\.${col}\\s*=`)
        // Pattern 2: <col>: ... (inside object literal, in route.ts
        // create paths). Restrict to lines that look like an object
        // property to avoid matching `if (col === ...)` etc.
        const objProp = new RegExp(`^\\s*${col}:`)

        if (propAssign.test(line) || objProp.test(line)) {
          // Look at the line + next 2 (multi-line RHS).
          const window = lines.slice(i, i + 3).join(" ")
          // Allow if:
          //   contains encryptForTenant{,Bound}{,OrNull}
          //   OR contains <col>Ciphertext (POST-style hoisted local)
          //   OR is a select clause (`<col>: true,`)
          //   OR is a const data type declaration (`<col>?:`)
          //
          // Both bound (column-bound AAD) and un-bound variants accepted —
          // Phase 7 slice-3 migrated R2/R6/R7/R8/R11 + internal-users to
          // `encryptForTenantBound(orgId, TABLE, "<col>", v)` to defeat
          // same-tenant cross-column ciphertext shuffle. Old routes
          // (pre-slice-3) still use plain `encryptForTenant(orgId, v)`.
          if (
            /encryptForTenant(?:Bound)?(?:OrNull)?\b/.test(window) ||
            // Response-shape assignments use softDecryptForTenant{,Bound} —
            // those are READS, not writes. Accept both variants.
            /softDecryptForTenant(?:Bound)?\b/.test(window) ||
            new RegExp(`\\b${col}Ciphertext\\b`).test(window) ||
            new RegExp(`\\b${col}:\\s*true,?$`).test(line) ||
            new RegExp(`\\b${col}\\?:`).test(line) ||
            // Type annotation lines (e.g. `fullName?: string | null`)
            // are not assignments.
            new RegExp(`\\b${col}:\\s*(?:string|Date|Prisma|number|boolean)`).test(line)
          ) {
            continue
          }
          // Also allow type-narrowing positions: lines that look like
          // input parsing — `const v = strField(body.<col>, ...)` then
          // a later `data.<col> = encryptForTenant(...)`. The
          // assignment-line check above will catch the actual write.
          // Skip lines that don't contain `data.<col>` or `<col>:` in
          // a Prisma create/update create position.
          if (!propAssign.test(line) && !objProp.test(line)) continue

          violations.push({
            route: routeName,
            file: relPath,
            line: i + 1,
            col,
            text: line.trim(),
          })
        }
      }
    }
  }
  return violations
}

const KNOWN_FALSE_POSITIVES = new Set([
  // PATCH select clauses for type-narrowing on existing — these aren't
  // writes, they're reads. The pattern check should already skip these,
  // but enumerate any that slip past as known-safe.
])

const allViolations = []
for (const [route, columns] of Object.entries(ENCRYPTED_COLUMNS_BY_TABLE)) {
  allViolations.push(...scanRoute(route, columns))
}

const filtered = allViolations.filter(
  (v) => !KNOWN_FALSE_POSITIVES.has(`${v.file}:${v.line}`),
)

if (filtered.length === 0) {
  console.log(
    `lint-encrypted-columns: all clear — ${Object.values(ENCRYPTED_COLUMNS_BY_TABLE).flat().length} encrypted columns across ${Object.keys(ENCRYPTED_COLUMNS_BY_TABLE).length} routes verified.`,
  )
  process.exit(0)
}

console.error("lint-encrypted-columns: VIOLATIONS FOUND")
console.error("")
for (const v of filtered) {
  console.error(`  ${v.file}:${v.line}`)
  console.error(`    column "${v.col}" assigned plaintext:`)
  console.error(`    ${v.text}`)
  console.error("")
}
console.error(
  `Fix: wrap the right-hand side with encryptForTenant(orgId, value)`,
)
console.error(
  `  or encryptForTenantOrNull(orgId, value) for nullable columns`,
)
console.error(
  `  or encryptForTenantBound(orgId, TABLE, "<col>", value) for column-bound AAD`,
)
console.error(
  `  (Phase 7 slice-3 routes use the Bound variant — see the migration note`,
)
console.error(
  `   at the top of this script).`,
)
console.error(``)
console.error(
  `If this is a legitimate exception, add the file:line to`,
)
console.error(`KNOWN_FALSE_POSITIVES in scripts/lint-encrypted-columns.mjs.`)
process.exit(1)
