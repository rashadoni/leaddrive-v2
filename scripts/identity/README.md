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
