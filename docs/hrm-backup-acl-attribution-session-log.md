# HRM declared backup ACL recipient attribution — append-only journal

## 2026-10-07 — source-only supplement starts at exact main f8dd20c

The user authorized normal reviewed release of WF-C6-010, preserving the
589→605→608 ancestry and excluding validation-only 606/609. Technical acceptance
of HRM5638 is complete. Actual read-only run37690299054 proved the runtime and
migration sessions share the same live database, expected runtime I/U/D, no
PUBLIC/default grant options, and one unidentified SELECT recipient with
BYPASSRLS. Unidentified purpose is a review hold, not proof of unsafe access.

Root owns the helper and this journal; independent peer owns fixed SQL, hosted
tests and workflow, then each reviews the other's source. Start main
f8dd20c7a849643087ee31969c2f582a96c8bab3; worktree and codex branch are dedicated
on remote-alt Contabo. Origin rashadoni/leaddrive-v2, production13.140.132.245
at /opt/leaddrive-v2, release only normal main/Actions. Canonical dirty checkout
is preserved. Old9 plus loopback5 paths remain byte unchanged.

Supplement reads stable protected canonical /etc/leaddrive/backup.env only in
memory, extracts static declared PGUSER/BACKUP_EXPECTED_DB_ROLE/PGDATABASE and
compares the OTHER catalog recipient with that role through the already trusted
migration session. root0600 or root:leaddrive-backup0640 match the actual backup
contract. Fixed catalog projection observes role profile, default read-only
settings and memberships. No PGPASSFILE/backup credential connection, service,
dump, production grant/configuration/file/business mutation or activation.
No raw identity/secret exports. READ_COMPLETE means observation, never approval.
Declared identity does not prove current backup authentication, commissioning,
service operation, restore or real HR operating observations.

All prior original errors remain immutable. New actual hosted PostgreSQL
positives/negatives and cleanup, old52, independent review and the existing five
required checks precede normal auxiliary release; then exact protected main and
artifact bound observation. Full build/browser/install/typecheck runs are NOT
RUN on Contabo; hosted Linux CI owns them. Accounting84/161/77open/60%, C6/C12
remain partial until all their criteria. No baselines/checks are weakened.
