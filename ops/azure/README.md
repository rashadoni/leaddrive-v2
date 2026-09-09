# LeadDrive delivery through Azure

Repository: https://dev.azure.com/rashadrahimov/leaddrive-v2/_git/leaddrive-v2

This replaces GitHub Actions. Production sites and databases stay on their
existing server. The Contabo CI host is a temporary bridge, not a completed
move of compute to Azure. Do not cancel that server while jobs use pool 12.

## For a waiting development session

1. Keep the current branch and uncommitted work. Commit only your task's files.
2. Check the repository identity and Azure access. Add a separate `azure` remote
   with the URL above if it is absent. Do not overwrite an unrelated remote.
3. Push your feature branch to `azure`, not `main`. Use the existing migrated
   Azure draft PR if one matches; otherwise open an Azure draft PR.
4. Finish targeted local checks, then mark the PR ready. Azure branch policies
   run checks and independent review. Fix red results; do not re-enable GitHub.
5. After the owner's authorization for visible product changes, merge when the
   checks are green, or use Azure auto-complete. Main starts release automatically.
6. Report the production run URL and the verified live SHA. A merged PR by itself
   is not a deployment. A failed release is still work to diagnose.

If Azure authentication is not available in this session, preserve the local
commit and report the exact repository, branch, commit and authentication error.
Do not expose tokens, overwrite credentials belonging to another account, or
switch an entire dirty checkout to another branch to work around the issue.

## Trusted definitions

| Definition | Pool | Purpose | Variable group |
| --- | --- | --- | --- |
| 4 `leaddrive-checks` | 12 `leaddrive-azure-build` | PR static/type/db and applicable Social browser gates | none |
| 6 `leaddrive-agent-review` | Microsoft-hosted Ubuntu | secret scan and independent semantic review | 2 review only |
| 5 `leaddrive-release-build` | 12 `leaddrive-azure-build` | main quality gates and immutable standalone artifact | 1 public map build key |
| 7 `leaddrive-production` | Microsoft-hosted Ubuntu | exact successful main artifact to existing production | 3 production only |

The definition scripts are embedded from this reviewed source. They are classic
build definitions so a pull request cannot replace the validation or access
production by changing candidate YAML. Candidate code runs only inside a
disposable container with read-only source, no agent home or Docker socket,
18 GiB memory limit, bounded timeout and unconditional cleanup. Log commands
from the sandbox are escaped. One host lock prevents competing heavy jobs.
The Docker-capable host user must never execute candidate code outside this sandbox.

The application container shares only its disposable PostgreSQL container's
network namespace, so the database is reached on `127.0.0.1` without publishing
ports on the host. This preserves the browser test's localhost-only guard; it
does not grant access to the host network or production database.

The workspace is a fresh disk-backed Docker volume at `/workspace/source`,
outside `/tmp` and outside the container overlay. `VITEST_MAX_WORKERS=4` is
explicitly read by the Vitest configuration. A host systemd timer invokes
`cleanup-resources.sh` every minute: it takes the same non-blocking host lock
and removes only resources labelled `leaddrive.azure-ci=1` while no job owns
the lock. This also cleans up after an agent cancellation or process crash;
the next job performs the same cleanup before its memory preflight.

`generate-definitions.py` produces disabled definitions for reviewed installation.
Installation preserves identities and pins the approved release definition
revision in the production admission variables. Changing definition 5 requires
independent review and an explicit update of that pin; otherwise deploy fails.

The production path retains the canonical host, backup gate, migration checks,
atomic swap, automatic localhost-health rollback, scheduler/tenant checks and
public revision/assets checks. It serializes the entire ceremony using a
server-side lease. An old successful build cannot deploy over newer main.

The authenticated Social Monitoring production browser smoke is reported as
NOT RUN until its dedicated smoke account is configured in Azure. This is the
same explicit optional-account rule as the previous production workflow;
public and server checks continue to be enforced independently.

## Verification

Run `python3 -m unittest discover -s ops/azure -p 'test_*.py'` for the narrow
definition/admission tests. Run full application checks only in the designated
build environment. Never create parallel heavy retries to reduce a queue.

GitHub Actions and the retired pilot pipelines stay disabled. Enabling a new
Azure VM or buying additional compute is separate from this source migration.
