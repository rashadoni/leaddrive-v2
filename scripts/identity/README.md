# Identity inventory preflight

Stage 0 of `docs/person-identity-architecture.md`. This tool consumes a supplied
snapshot and has no database or network access. It never changes identities,
resolves conflicts, enables app access, or authorizes a migration.

Run with Node 20 or newer, using a private snapshot on stdin:

```sh
node scripts/identity/preflight.mjs < /private/path/identity-snapshot.json
node --test scripts/identity/preflight.test.mjs
```

The input is sensitive: keep it outside Git, with restricted file permissions.
No raw password/hash/token, names, emails or extra fields are accepted. An export
must calculate `hasCredential` as a boolean without exporting its value. A
non-password sentinel must not count as a usable credential. The companion
`snapshot.mjs` exporter returns only a boolean for bcrypt-shaped credentials;
it does not verify a password. Do not claim a production audit from synthetic
fixtures or from mocked transaction tests.

Exact input shape (fictional values):

```json
{
  "schemaVersion": 1,
  "users": [{
    "id": "user-example", "organizationId": "example-company",
    "phone": "+994550001122", "isActive": true,
    "anonymized": false, "hasCredential": false
  }],
  "agents": [{
    "id": "actor-example", "organizationId": "example-company",
    "userId": "user-example", "phone": "+994550001122",
    "role": "EMPLOYEE", "status": "ACTIVE",
    "attendanceParticipant": true, "hasCredential": true
  }]
}
```

Both phone fields may be null, as may `userId`. `anonymized` is derived from the
presence of the existing anonymization timestamp. The snapshot must include all
relevant User/Agent records, including inactive historical links; this tool
cannot attest to export completeness or consistency. A production exporter must
use one bounded read-only consistent transaction and approved tenant scope.
The current limits are 10,000 rows per table, 5 MiB stdin and 30 seconds to read.

Only explicit international numbers are compared. Presentation punctuation and
the international `00` prefix are normalized; national numbers and missing
country codes require review. No suffix inference or country guessing occurs.

Output contains issue codes, counts and **zero-based input array positions**,
never record IDs or phone numbers. Position references are only meaningful
against the same private snapshot; keep the two associated securely. All issues
require review. Contact-number collisions are conservative *candidates*, not
proof that either account should own the login number. The tool does not assess
grants, enrollment history, credential equality, OTP state, database constraints,
session revocation or offline queues.

Exit codes: 0 = no detected conflicts in this supplied snapshot; 2 = review
required; 1 = invalid/unreadable input. Even exit 0 leaves `productionVerified`
and `migrationAuthorized` false. Empty input arrays do not prove an empty live
database. No output from this tool is a release gate by itself.

## Read-only exporter

`snapshot.mjs` requires the project's generated Prisma client and an explicitly
provided `IDENTITY_AUDIT_DATABASE_URL` through the established secret mechanism.
It does not load environment files or fall back to `DATABASE_URL`. Before use,
verify the registered target and obtain authorization for the intended read.
No production export has been run as part of this implementation.

```sh
node scripts/identity/snapshot.mjs \
  --organization-id approved-organization-id \
  --organization-slug approved-company \
  --output /private/audit-directory/identity-snapshot.json
node --test scripts/identity/snapshot.test.mjs
```

The output directory must already exist outside this worktree, belong to the
current user and have no group/other permissions (0700). The exporter creates a
new file with 0600 permissions, refuses overwrite and final symlinks, and prints
only counts and completion status. A failed file write may leave a private,
incomplete file; a nonzero exit must never be treated as a valid export.

All reads occur in one bounded repeatable-read transaction, explicitly set to
READ ONLY before data queries. The exporter sets the tenant RLS context with
bypass off, verifies those settings, verifies both organization ID and slug,
and additionally filters each business query by organization ID. It imposes
statement/lock/transaction timeouts and refuses row/byte overflow. It includes
inactive rows to preserve historical links and never exports actual credential
values, names, email, OTP or session data.

Transaction tests use an injected mock client: ordering, parameter binding,
fail-closed checks and file privacy are covered. Actual PostgreSQL/RLS query
execution remains a required CI gate before production use. The snapshot is
limited to identity links and phones, not application grants or HR history.

## Hosted PostgreSQL contract

`.github/workflows/identity-snapshot-contract.yml` runs the unit/file tests and
then `postgres-contract.mjs` against an isolated PostgreSQL 16 service. The
contract only admits CI, the loopback host, an explicit port and the fixed
`identity_snapshot_contract_test` database. It refuses an already populated
fixture instead of resetting it. The reader role has SELECT only and no RLS
bypass. No production secret is required or used.

The six database checks cover actual Prisma projection/credential masking,
missing and foreign tenant contexts, tenant ID/slug mismatch, PostgreSQL's
READ ONLY write rejection, a consistent snapshot across a concurrent commit,
and the reported stale actor phone after a CRM-only number change. The fixture
uses only columns needed by the exporter: this is not a full migration replay
or validation of the whole application schema. The receipt is bound to the
checked-out source commit and contains fixed check names, never private data.

## Additive account and application foundation (stage 1)

`20261103120000_identity_foundation` adds an empty registry linked to the
existing tenant+User key. A person may have CRM, TIME and ROUTE_FIELD grants
independently, with one current verified login phone per person and one owner
per company+phone. The same phone in a different company is a separate identity.
Reservations are separate, expire within 15 minutes, and cannot authorize login.
All five new tables use FORCE RLS and composite tenant foreign keys. Security
receipts are append-only even for a table owner. The migration changes no
legacy rows, credentials, roles, triggers or application access.

`src/lib/identity/registry.ts` exposes explicit admin-only staging of an existing
User and a consistent read-only shadow comparison. Staging creates no phone
claim, credential, CRM access, employee card or app grant. It serializes tenant
writes before reading current state, rechecks the stored administrator and
company, rejects ambiguous actor links, binds idempotency to actor+subject, and
commits its audit receipt atomically. Shadow comparison returns issue codes and
explicit grant states, never raw numbers or credentials. Neither function is
called from a current HTTP, login or enrollment path. `authenticationChanged`
is always false in this stage.

The same hosted gate validates/generates Prisma, compiles the two service files,
runs the focused Vitest contract, then executes `foundation-contract.mjs`. That
script admits only the existing fixed synthetic PostgreSQL fixture, applies the
actual migration with psql, and uses a non-superuser/NOBYPASSRLS writer to
exercise staging, replay, authorization, transaction rollback, independent
grants, tenant isolation and concurrent phone uniqueness. Direct fixture grants
prove the storage contract; they do not prove a finished registration API or
an authorized production cutover. Its sanitized receipt is SHA-bound alongside
the original six-check snapshot receipt.

Still required: verified phone/change/OTP service, independent enrollment and
grant API/UI, audience-specific sessions, offline compatibility, complete schema
replay/build/E2E/Maestro, tenant reconciliation and separately authorized rollout.
Do not apply this migration or stage a real tenant as an incidental diagnostic.
