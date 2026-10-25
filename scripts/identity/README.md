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
rotation window. The primitive is not an authorization decision or an exposed OTP service.
The internal transaction service described below prepares issuance/consumption;
HTTP rate limits, provider composition and narrow setup tokens remain required
before enrollment can use it. Existing authentication and the WhatsApp sender
remain unchanged.

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
scrubbed by the internal consumption/cancellation/expiry service. Storage and crypto are not
an exposed OTP API or a running provider worker; no current authentication or
live sending behavior consumes these tables yet.

Attempt idempotency uses `phoneProofAttemptHash`, a separately HKDF-keyed HMAC
of the exact context, request ID and submitted text. Never persist an unkeyed
hash of the small OTP search space. A changed retry must be rejected before
checking correctness, so a reused failed request cannot become a code oracle.


### Internal staged proof transactions

`src/lib/identity/phone-proof-registry.ts` operates only on inactive staged
accounts (`cutoverAt IS NULL`). It is not imported by current login, personnel
or mobile routes. Issuance requires the current tenant administrator and a
live owned reservation with exact account/credential versions. Proof, private
outbox and immutable audit are committed together; repeated request IDs never
extend a deadline, and explicit resend has a 60-second cooldown.

Consumption uses the same tenant lock as grant/reservation writers and checks
current company, subject, issuing administrator, reservation and versions.
Wrong attempts return normally from the transaction so the counter commits;
five attempts lock and scrub the proof. An identical attempt request replays
its immutable receipt; changed text under that request ID is refused before
checking correctness. Correct current proof atomically replaces only the
staged claim, increments account and credential epochs, removes the consumed
reservation, scrubs the proof and appends its receipt. Legacy credentials,
phones, actor roles, application grants, MFA and current sessions are untouched.

Only a trusted server worker can claim a private delivery item. One CAS lease
permits one provider attempt; expired/ambiguous leases are never requeued.
A worker must enforce its short lease deadline before sending, decrypt only
in memory, never retry an uncertain send, and submit a capability-bound
receipt. Provider acknowledgement never assigns a phone. Late acknowledgements
retain provenance after cancellation/confirmation without reopening the proof.
Explicit cancellation never releases an already confirmed claim.

No provider worker, scheduler or public endpoint is activated. Before exposure,
compose trusted tenant/key selection, request rate limits, server-owned actor
context, provider deadline/retry handling and safe error responses. There is
no default production key or new authentication fallback. The hosted
foundation contract executes synthetic issue/consume/delivery/cancel races,
wrong-attempt replay, current authority/version/expiry fences and real
transaction rollback after injected audit failure. A source change is prepared
until its own exact-head CI receipt passes; earlier green results do not apply.


### Narrow staged credential setup

`consumeStagedPhoneProofWithSetup` first consumes the actual possession code,
then rechecks its current immutable confirmation before minting a deterministic
`lds1` capability. It is not a JWT/session and has no app or MFA authority. The
capability binds the tenant, person, proof, current claim, account/credential
versions and the original proof deadline. Its routing hint is untrusted.
`credential-setup.ts` derives separate capability/request MAC keys; no unkeyed
password fingerprint or raw capability belongs in audit receipts.

`setStagedIdentityCredential` requires the server's shared `passwordPolicyError`
(not a request-supplied function), uses bounded bcrypt cost12 outside the lock,
and revalidates current authority/claim/versions in the final transaction. It
sets only the inactive registry credential with epoch/version CAS and atomic
audit, making a new request under a spent capability fail. An identical retry
can replay its receipt without relying on bcrypt's random salt. Current User/
MtmAgent passwords, application grants, CRM MFA and live sessions are untouched.
No endpoint is exposed, and production setup must hardcode the shared policy,
server key ring and rate limits. The codec alone is not single-use; that property
comes from the consuming database transaction. This source remains prepared
until its exact focused compilation and real-PG checks pass.


### Bounded dispatch composition

`phone-proof-dispatch.ts` composes the authorized store lease/receipt methods,
private decryption and one fixed server transport. It checks tenant/proof scope,
the exact lease and proof deadlines, and caps waiting at30 seconds. A thrown
provider call, missing acknowledgement ID or timeout is uncertain and is never
retried. A transport that ignores abort still cannot make the worker wait
forever. Receipt-write failure is a fixed safe error; the existing lease prevents
a second send. Output contains only status and authenticationChanged=false.

No transport/provider/scheduler is activated. A future adapter MUST send one
request without hidden retries and respect the supplied AbortSignal; do not
plug in the legacy multi-language retry loop unchanged. Local failures before
transport are definite FAILED; failures after entering provider code default
to UNCERTAIN. The hosted PostgreSQL case composes the real store with a
synthetic transport and checks parallel dispatch sends once, records the ack,
and still creates no claim until the person submits the code.


### Future mobile session authorization contract

`mobile-session-contract.ts` is a policy over already cryptographically verified
claims and fresh tenant-scoped state; it is not a token verifier or a live auth
path. A future verifier must pin a dedicated identity key/issuer/algorithm and
exact single-app audience, then call this policy with the server route's app.
Never reuse legacy JWT_SECRET or accept a request body/header as verified
claims. Current login/middleware does not call this file.

Requires explicit rollout, authoritative cutover, active company/person,
current phone claim and credential epoch, the current app grant/version/role,
license and app membership with the original actor. Rejects cross-tenant/app
state, CRM, legacy/setup shapes and ambiguous audiences. account.version is
only a write-CAS revision: a sibling grant change must not kill this app's
unchanged session. The shared credential epoch does revoke both. Output keeps
actorId/application explicit; adapting it blindly into legacy agentId/role
would bypass the workday and HR separation still required before cutover.


`mobile-session.ts` prepares the missing actual JWT signer/verifier. Both are
unused by current login/routes. Sign only after real credential authentication
using freshly resolved authoritative state; an admin lookup or setup token is
not authentication. Requires a dedicated32-byte identity root with explicit
purpose; there is no legacy JWT_SECRET/environment fallback. HKDF additionally
separates JWT MAC material from legacy raw-secret/OTP/setup signatures.

The verifier pins HS256, issuer, exact audience and explicit token type, permits
only alg/typ/kid headers, validates kid before an allowlisted key-ring lookup,
and never follows token URLs. Only after signature/expiry validation does it
apply the fresh app policy. Six tests use the real jsonwebtoken library for
round trips, signature/key tampering, legacy-key separation, unsafe headers,
app/tenant/CRM/setup refusal, current revocation and expiry. No live key or JWT
session is issued by the application until the future login composition exists.


### Reviewed actor ownership and independent membership plans

`IdentityActorBinding` is a permanent administrator-reviewed mapping from one
historical tenant actor to one person. Composite FKs bind the staged account,
existing actor and reviewer; SQL refuses UPDATE/DELETE/TRUNCATE. The service
requires an explicit review reference, current unambiguous same-person legacy
link, active subject/actor and account revision. It never adopts by phone/email
or creates/changes the legacy actor/User. Corrections require a separate reviewed
reconciliation; ordinary registration cannot transfer an actor's history/queue.

`IdentityApplicationMembership` plans each mobile app separately, referencing
both that person's reviewed binding and existing app grant. Member changes
advance only its membership version and the account write-CAS revision, with
atomic immutable audit bound to the grant revision. The credential epoch and
sibling grant/membership stay unchanged. Re-enable advances the version again;
old tokens cannot revive. Revocation remains possible when the person is
inactive or its legacy link changed; enabling requires the current active link.
Both services reject already-authoritative accounts, remain unused by routes,
and cannot enable current HR/CRM/Field access. Before rollout, implement the
fresh resolver, app-specific storage/sync/lifecycle and reviewed tenant migration.


### Fresh authoritative session resolution, still inactive

`mobile-session-resolver.ts` verifies the real JWT/profile before opening a
business transaction, then loads the actual account/claim/grant/membership/
reviewed binding/current actor and person under READ ONLY/REPEATABLE READ.
RLS org/bypass and transaction modes are checked before reads and again after
the fixed tenant-policy callback. End-of-read database wall time enforces
expiry. Missing/inactive/staged/foreign state or any key/DB/policy error denies;
there is no cache or legacy fallback. No passwords or raw phones are selected.

The tenant-policy callback is a required trusted server dependency, never
request data or a default license. It must read the actual rollout and app
entitlement/settings through this transaction. Current routes do not call the
resolver. A business write must recheck current rights in its own transaction;
this snapshot is not a privilege lock held across a later write. The hosted
fixture checks actual RLS/readonly modes including inherited bypass setup,
no DB access for invalid JWTs, failed/mutating policy refusal, independent app
revocation, membership reactivation, common credential epoch and stale actor
link. This is a synthetic post-auth fixture, not a public password-login test
or production entitlement audit.


### Monotonic security state and authoritative lifecycle

SQL refuses decreasing account/credential revisions, changing the person/tenant
key, clearing/changing an existing cutover, or changing the hash/first cutover
without a new credential epoch. An application rollback cannot restore legacy
password lookup through a nullable authority marker.

For authoritative accounts only, changes to User isActive/anonymizedAt advance
the shared credential epoch/revision with immutable system audit. Changes to a
technical actor's global user link/status advance each linked membership version
and audit, without changing the binding or activating a grant. Disable/restore
cannot revive an old JWT. Trigger audit failure rolls back the status/link and
versions atomically. Staged/legacy accounts are unaffected. Tests use a separate
NOLOGIN/NOBYPASSRLS operator with minimal column privileges and tenant policies,
not a weaker snapshot/staging writer.

Person/technical-actor global lifecycle is distinct from an ordinary app access
switch. Before cutover, adapt/fence all legacy writers: disabling Field alone
must change only Field grant/membership, not User.isActive or MtmAgent.status.
The triggers are not permission to turn on new auth ahead of that work. Normal
password login/provider/API/UI and app workflow/queue migration remain separate
integration gates; no current route has switched to this identity runtime.


### Fixed shared tenant policy

`tenant-policy.ts` implements the server dependency using the existing shared
capability catalog and `readAttendanceFeature`. Time requires Personnel plus
the actual attendance switch; Field requires Route & Field and never reads an
HR switch. Identity opt-in is exactly `{version:1,enabled:true}` at the new
control-plane setting, not a truthy/missing default. The resolver still checks
immutable per-person cutover, so toggling rollout cannot restore legacy auth.
No setting is written by this policy and no current route enables it.

The scoped hosted compiler now extends the repository's actual alias config,
compiles only identity and its pure policy dependencies, and links exact locked
runtime packages plus the existing @/lib alias into private scratch output.
It does not edit application imports or install new bundlers. Node20 alias
resolution and29 lightweight admission/inventory tests passed locally; real
compiler/Vitest/PG work stays in GitHub. CI explicitly imports the emitted
policy before tests, avoiding an untested output/dependency layout. The shared
catalog and attendance regression suites are included in the focused gate.


### Canonical password login composition, no public endpoint

`mobile-password-auth.ts` considers only the selected company's authoritative
canonical claim/account with a cost12 credential. It never reads User/agent
passwords, legacy phones or email as a fallback. Valid unknown numbers still
perform fictitious cost12 work; absent/staged candidates always fail. Password
input is bounded to72 UTF-8 bytes; the public boundary must add IP/tenant/
principal rate limits before exposing this function. Other historical bcrypt
costs need reviewed reset/rehash during migration, not silent adoption here.

After bcrypt outside any transaction, a second guarded snapshot rechecks the
same claim/person/hash/epoch and the actual fixed tenant policy, current app
grant/membership/binding/actor. Only then it signs a dedicated app JWT using DB
time. Claim reassignment or password rotation during comparison cannot sign
for the new owner. The result contains only token and own app context; no hash
or raw private candidate. No CRM session, MFA change, implicit app grant or
legacy data mutation occurs. No current route calls this canonical login.

Five actual-PG groups build three synthetic principals through the real staged
review/grant/member/reservation/proof/setup services, then assume an approved
test cutover. They check both apps/one actor, same phone/different company,
valid legacy-password refusal, real grant/license gates and credential/owner
races. Reassignment is a trusted fixture mutation to test the reader, not a
phone-change API or evidence of a real SMS/WhatsApp ownership check.


### Existing logout-all compatibility (inactive)

For authoritative accounts only, actual User.passwordChangedAt transitions also advance the shared credential epoch/revision with atomic system audit. This preserves the current logout-all marker and security actions that write it. Equal timestamps do nothing; clearing/backdating cannot revive an old epoch. Password hashes and per-app memberships stay unchanged. Staged/legacy identities are unaffected. The actual PostgreSQL case includes both audiences, audit-failure rollback, no-op and clearing, and staged isolation. Legacy password reset still must be fenced: this revocation bridge never adopts its new hash as the canonical password. No current route or production cutover is activated.


### Retained application security revisions (inactive)

SQL guards also make grant/membership keys and original member actor immutable, reject revision rollback, and require a new version for actual status/role transitions. Those rows cannot be deleted or truncated and then recreated with an old version; revoke through a new revision instead. Normal services still require current administrator authorization and atomic audit. An actor correction is a separate reviewed migration. Two dedicated disposable-PG groups check failed mutations preserve row counts, valid monotonic reactivation and sibling isolation. This candidate requires its own exact-source hosted gate; no current application route uses these tables.


### Legacy credential eligibility boundary (inactive)

readLegacyCredentialBoundary returns LEGACY/MIGRATED/UNAVAILABLE from a fresh guarded tenant snapshot; it is not authentication. Only LEGACY permits the caller to continue all prior credential/MFA/license/role checks. Any error denies fallback. Irreversible authority is independent of rollout flags and incomplete claims/grants. An actor checks both its fresh linked User and immutable reviewed owner; relink/unlink/new unreviewed card cannot restore old credentials for a canonical person. Shadow/staged records preserve legacy eligibility. No current route calls this reader; later writes need their own transaction guard. Three actual-PG groups are prepared and need the next exact hosted gate.


Legacy boundary caller update: the next candidate fences resolveMobileAuth after legacy signature verification and before ordinary state reads. Only LEGACY continues existing fingerprint/role/HR/license checks; getOrgId uses that resolver for approved MTM namespaces. It never activates canonical login. Seven new direct/office/tenant/invalid-signature regression cases and the existing compatibility suites are queued for the next exact focal gate. Password/code/setup and transactional writers remain separate prerequisites; do not enable cutover from this partial caller integration.


App Prisma composition: PostgreSQL set_config in injected-client helpers is not a substitute for the extended app client AsyncLocalStorage scope. Call the legacy reader inside runWithTenant using the verified tenant so the Prisma transaction proxy establishes inTx; the reader still forces and verifies read-only/RR/bypass-off. Preserve prior context with run, not enterWith. Broad real-login PG caught the missing no-context wrapper; keep that positive compatibility assertion and the RLS test guard enabled.


Source imports use the application convention without a .js suffix so Next can resolve TypeScript neighbors. The scoped NodeNext build emits CommonJS under this package default; emitted .js files still resolve through require and fixture entry points keep their explicit emitted paths. The actual scoped runtime/PG and Next bundle both guard compatibility; do not treat the standalone compiler alone as a bundler check.
