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
All new tables use FORCE RLS and composite tenant foreign keys. Security
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

`planStagedApplicationGrant` records an explicit reconciliation plan against an
existing staged account, with expected account/grant versions. It never creates
another person for another module, never changes a CRM role, and refuses an
account that has already cut over. Admin/company/subject row locks serialize
authority revocation with the write. Each receipt records the exact application,
role, status and grant version; audit failure rolls back both the plan and its
version change. A stale parallel module connection must refresh and retry.
These stored plans do not bypass future entitlement, membership, phone proof or
audience-auth checks and cannot affect current login.

The same hosted gate validates/generates Prisma, compiles the focused identity modules,
runs the focused Vitest contract, then executes `foundation-contract.mjs`. That
script admits only the existing fixed synthetic PostgreSQL fixture, applies the
actual migration with psql, and uses a non-superuser/NOBYPASSRLS writer to
exercise staging, replay, authorization/revocation races, transaction rollback,
independent grant plans, tenant isolation and concurrent phone uniqueness. These
service/storage checks do not prove a finished registration API or an authorized
production cutover. Its sanitized receipt is SHA-bound alongside
the original six-check snapshot receipt.

Still required: verified phone/change/OTP service, independent enrollment and
grant API/UI, audience-specific sessions, offline compatibility, complete schema
replay/build/E2E/Maestro, tenant reconciliation and separately authorized rollout.
Do not apply this migration or stage a real tenant as an incidental diagnostic.

### Pending phone reservations (still inactive)

`reserveStagedIdentityPhone` reserves an explicit international number for ten
minutes against an already staged tenant+User and its account/credential
versions. It runs behind the same current-admin/company/subject checks and
tenant write lock, refuses a current claim or another live reservation, and
commits the private reservation receipt atomically. The receipt retains its
reservation ID and original expiry after expired rows are cleaned. Replay does
not extend the deadline and reports EXPIRED, SUPERSEDED or STALE when needed.
Responses contain no number or credentials. Phone presentation variants share
the same canonical idempotent request.

This is a pending shadow record, not evidence that the person possesses the
number. It sends/accepts no OTP, grants no access and changes no current phone,
password or legacy record. Live enrollment still requires complete legacy
reconciliation, proof delivery/consumption, explicit app permissions and the
reviewed auth cutover. A canonical shadow reservation alone never authorizes
linking an existing legacy person. No HTTP endpoint calls this function yet.

The hosted foundation contract additionally exercises real concurrent
reservations/idempotent retries, tenant/version boundaries, atomic rollback,
and expired/stale/superseded receipt handling. Expiry uses actual PostgreSQL
wall time; the fixture seeds a valid historical receipt instead of changing the
clock or weakening the append-only audit trigger.

The executable snapshot exporter creates its connection through the repository's
`makeScriptPrisma` with an explicit org and database override, then still
verifies READ ONLY, RepeatableRead, tenant scope and bypass off inside the
bounded export transaction. CI reader/writer clients use `makeRlsTestPrisma`
with both the existing strict CI-loopback admission and the exact disposable
`EVENT_PLATFORM_TEST_DATABASE_URL` fence. Neither client path bypasses the
repository's script RLS factory or widens the test baseline.

## Phone-possession proof primitive (stage 2 preparation)

`src/lib/identity/phone-proof.ts` prepares a six-digit cryptographic secret,
a keyed HMAC and an AES-256-GCM delivery payload. MAC and encryption keys are
derived separately with HKDF, including the configured key ID. The immutable
context binds purpose, company, User, reservation, challenge, canonical phone,
account/credential versions and a strict UTC interval no longer than ten
minutes. Tampered context/key ID, ciphertext/tag or noncanonical encoding is
refused. Verification uses a constant-time MAC comparison and an explicit
trusted server/database time, with the exact expiry instant rejected.

Issuance returns only key ID, hash and ciphertext. Only the trusted delivery
worker may decrypt the payload; no endpoint may return it or log the code.
There is no default key, environment-file load, provider call or plaintext
secret in receipts. Tests use synthetic keys and actual Node crypto; production
keys must be server-supplied cryptographic secrets retained for the bounded
rotation window. The primitive is not an authorization decision or a complete
OTP service: transactional persistence/delivery, resend/rate/attempt limits,
single-use consumption, claim assignment and narrow setup tokens are the next
integration. Existing authentication and the WhatsApp sender remain unchanged.

### Proof storage and delivery preparation

`IdentityPhoneProof` freezes the private context and stores only the keyed code
hash and encrypted delivery payload. The reservation ID is a historical
pointer: removing a consumed/expired reservation does not erase proof replay
context. Issuance/consumption must still revalidate the live owned reservation
and current versions. Composite tenant+User/issuer foreign keys, bounded TTL,
state/counter checks and a partial SQL unique index restrict pending proofs.
`IdentityPhoneProofOutbox` has a subject-bound proof FK and one CAS delivery
lease/send attempt. An ambiguous or expired send lease is not automatically
resent. SENT records provider acknowledgement, never phone possession.

The new explicit system/rejected-proof audit actions may have no human actor;
all existing administrator actions still require a non-null actor. This avoids
attributing an anonymous failed guess to its target User. Ciphertexts are
scrubbed by the future consumption/expiry service. Storage and crypto are not
an exposed OTP API or a running provider worker; no current authentication or
live sending behavior consumes these tables yet.

Attempt idempotency uses `phoneProofAttemptHash`, a separately HKDF-keyed HMAC
of the exact context, request ID and submitted text. Never persist an unkeyed
hash of the small OTP search space. A changed retry must be rejected before
checking correctness, so a reused failed request cannot become a code oracle.
