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
non-password sentinel must not count as a usable credential. This tool has no
exporter yet: do not claim a production audit from synthetic fixtures.

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
