# Kafka recovery readiness — append-only session log

## 2026-10-19 (Asia/Baku): scope and baseline

- User requests bounded A3 backup/recovery preparation; coordinator is chat
  «Проверить защиту Kafka-консюмера». No merge/deploy, production restore,
  PostgreSQL/timer/Kafka/offset/replay changes, purchases or private key requests.
- Read AGENTS.md, ran codex-project-context, fetched origin/main. Canonical dirty
  checkout preserved. Dedicated clean worktree and codex/kafka-recovery-readiness
  start at 226dde0e77c0c36a4de991bb703ba8f8416c5a64.
- Origin: https://github.com/rashadoni/leaddrive-v2.git. Registry and deployment
  docs agree on 13.140.132.245:/opt/leaddrive-v2; delivery GitHub Actions only.
  AGENTS.md's Hetzner sentence is superseded by this current routing contract.
- Reviewed backup, restore canary, offline verifier, readiness reporter, runbook,
  ISMS-04 and Kafka backlog. Files/configuration are not execution receipts.
- Existing read-only backup-readiness workflow dispatched on exact main:
  https://github.com/rashadoni/leaddrive-v2/actions/runs/39163236284
  Initial state waiting; no fresh verdict inferred.
- Resource preflight: available RAM 15186 MiB, swap used 0, disk available 205G,
  memory pressure avg10/60/300 zero. Only small sequential checks permitted.

## 2026-10-19: bounded preparation and verification

- Added A3_RECOVERY_READINESS.md: evidence levels, controls, independent Farah
  acceptance packet, explicit PENDING and DR limitations. Linked fresh status
  in Kafka backlog. No changes to operational helpers or pinned digests needed.
- Read-only workflow completed failure at 2026-10-18T20:26Z (00:26 Baku):
  machine_ready=no, enterprise_ga_ready=no, issues=24, enterprise_gaps=9.
  Encryption explicitly off; live unit drift, missing runtime timer, other
  timers disabled/inactive; stale/uncompleted runs, swap fences absent;
  missing/unsafe evidence/genesis; Object Lock unknown_failure, not a proven
  policy/credential cause. Pinned tools/passfile checks passed. Restore NOT RUN.
- PASS sequentially: pgpass-contract 29 tests; object-lock-diagnostic 12 tests;
  event-platform assets (27 domains/86 topics/5 schemas); bash -n on backup,
  restore canary, offline verifier and readiness reporter; git diff --check.
- NOT RUN: actual libpq integration (test skipped by its CI-only disposable DB
  opt-in); full build/typecheck/browser suites (docs-only scope; heavy checks
  prohibited on Contabo); backup/decrypt/restore/PITR/full-authority/host-loss
  drills (outside authorized operations; keys/operator evidence unavailable).
- Identified historical docs conflicts: ISMS-04 three-timer/certification
  activation and runbook GitHub reviewer stop condition. Current deployment
  contract and four-timer activation ceremony apply; no reviewer gate restored.
- Remaining blocker: recovery commissioning prerequisites and successful
  independent exact-version restore + Farah decision. Next coordinator action:
  review this packet, scope prerequisite remediation and authorize isolated drill.

## 2026-10-19: review checkpoint

- Preparation checkpoint 4d176604d published on codex/kafka-recovery-readiness.
- Draft PR: https://github.com/rashadoni/leaddrive-v2/pull/892 (attached to chat).
- Current result: bounded preparation complete; A3 recovery remains NO-GO.
  Last action: created draft PR; no merge/deploy. Stopping at reviewable docs
  and fresh read-only diagnostic. Next: originating coordinator reviews gaps
  and arranges separately authorized isolated recovery with Farah acceptance.

## 2026-10-19: autonomous completion audit

- User requests autonomous progression through all remaining steps. Existing
  explicit no-merge/no-deploy/no-production-mutation/no-restore limits remain.
- Resumed recorded worktree and branch; codex-project-context confirms origin,
  production target and GitHub Actions route unchanged. Clean worktree.
- Fetched origin/main; reviewed PR892 at head8f30f041b: OPEN/DRAFT, no reviews
  or comments requiring action. pr-scope, runner-policy and scan SUCCESS.
  static-checks, typecheck and hosted production build SKIPPED by CI; do not
  report them as passed. PR checks run39163393178, runner39163393125,
  scan39163393216. This records that exact checked head, not later journal SHA.
- Bounded preparation and all accessible verification are complete. No further
  production action is authorized. Remaining commissioning prerequisites and
  actual independent restore/Farah confirmation are external operational gates,
  not tasks Codex can close by editing a status field. No messages sent on
  Farah's behalf and no approval requested or manufactured.
- Stopping point: draft PR ready for originating coordinator; next action is
  coordinator review and separately scoped prerequisite remediation/drill.

## 2026-10-19: autonomous follow-through and executable documentation repair

- User reiterates autonomous completion. Previous stopping point omitted direct
  remediation of documented instruction conflicts; resumed that bounded work.
- Confirmed root/branch/origin/production route using codex-project-context.
  Final prior checkpoint56abd74 CI: pr-scope/runner-policy/scan PASS;
  static/typecheck/build SKIPPED, no review comments.
- Corrected BACKUP_RUNBOOK required-reviewer setup/stop instructions to current
  main-only environment policy without weakening independent signed recovery.
  Removed unverified provider attribution in its failure-domain summary.
- Replaced obsolete ISMS-04 current action sequence with v2 bootstrap -> v3
  full/log-genesis drill -> certification -> separately authorized normal-deploy
  four-timer activation -> fresh-run readiness. Historical evidence retained;
  old bootstrap drill explicitly scoped as historical rather than full proof.
- Resource preflight: available14931MiB, swap0, disk204G, memory pressure0.
  Repeated affected event-platform assets check PASS and diff whitespace PASS.
- Reviewed backup-pgpass-contract CI: no manual dispatch, paths exclude docs,
  job excludes draft PR. Do not change workflow/PR readiness just to force an
  unrelated integration run; real libpq remains explicitly NOT RUN here.
- Actual production prerequisites and independent Farah acceptance remain open;
  no production mutation, restore, merge or deploy performed.

- Follow-through checkpoint421c603bc published; A3 checklist updated to mark
  the identified runbook contradictions as corrected in this PR. Remaining
  stopping boundary is operational authorization/independent human evidence,
  not another unimplemented documentation step.

## 2026-10-19: final autonomous validation

- Exact head44ede6ba4c28c7057d99e1883d0ca96ab49eb5e1 CI complete:
  pr-scope PASS (39163993978), runner-policy PASS (39163993983), scan PASS
  (39163993986); static-checks/typecheck/production build SKIPPED by docs policy.
- Updated draft PR892 description with final documentation repair scope via
  REST after gh pr edit encountered a deprecated Projects Classic API error.
- All authorized bounded preparation finished. Current result: corrected
  operational instructions + acceptance packet + fresh read-only NO-GO.
  Last action: verify final content checkpoint CI and update PR.
  Stop: no remaining software/doc prerequisite identified in this scope;
  operational commissioning/real restore and Farah decision still blocked by
  original explicit limits and independent evidence requirement.
  Next: originating coordinator scopes/authorizes operational prerequisites;
  no production mutation, restore, merge/deploy or messages to Farah occurred.

## 2026-10-19: expanded commissioning authorization and prerequisite audit

- User explicitly supersedes earlier no-commissioning/no-merge/no-deploy limits:
  permits reviewed GitHub Actions commissioning, age encryption, units/timers,
  encrypted copies and restore ONLY into isolated scratch. Still forbids
  production restore/data deletion, Kafka/offset/replay changes, new spending,
  private-key transfer and substituting Farah confirmation. Coordinate overall
  delivery with originating chat «Проверить защиту Kafka-консюмера».
- Resumed b7d397f4a in dedicated worktree; root/origin/branch resolved correctly;
  fetched main226dde0e77c0c36a4de991bb703ba8f8416c5a64. Production target remains
  registry13.140.132.245:/opt/leaddrive-v2; Actions-only delivery.
- Read current AGENTS.md, DELIVERY-ARCHITECTURE, commissioning workflow and
  activation/fencing implementation. Existing durable timer rollback journal
  fences all runners; activation verifies signed custody and Object Lock before
  atomically changing encryption, commits with all timers disabled. Timers
  activate only after certificates and normal reviewed deploy. Do not bypass.
- Exact external blocker verified by GitHub secret NAMES ONLY:
  BACKUP_OFFLINE_ALLOWED_SIGNERS absent from both repository and production
  environment secret lists. Four monitoring URL secret names exist; their
  values were neither read nor printed. No signed custody bundle supplied.
- activate-backup-encryption requires TWO_READABLE_OFFLINE_COPIES_AND_INDEPENDENT_
  DECRYPT_CONFIRMED plus existing verifier-generated signed bundle/operator/time,
  exact recipient digest and trusted public signer allowlist. Codex cannot
  truthfully assert these inputs or retrieve private keys. Consequently bootstrap
  creation/certification/full backup/offline drill/activation depend on missing
  external evidence, regardless of expanded operational authorization.
- Tools already passed exact pinned age/AWS validation in latest diagnostic;
  no gratuitous reinstall or retention extension performed. Unit replacement
  and timer activation cannot be detached from certificate-backed deployment.
  Object Lock unknown_failure remains unresolved, not relabelled as success.
- Coordinator chat located/read (01a05e9c-4a3e-7f22-aeb7-53735f885366), active on
  PR891 with code gates under repair. No send_message_to_thread tool available.
  Use explicit PR892 coordination comment; leave main merge/deploy to common
  release sequence rather than racing coordinator. Every main push triggers
  deploy.yml, even docs-only, so uncoordinated docs merge is not harmless.
- All independent technical preparation complete; ready PR is reviewable.
  Production mutations and real backup/restore NOT RUN because signed custody
  prerequisite cannot be met. Actual private key custody/decrypt must remain
  with independent operator; request only public allowlist and PII-free signed
  evidence, never private material.

## 2026-10-19: user-authorized new age key candidate

- User explicitly requests creation of a new key because prior custody is not
  remembered. Created one NEW candidate on administrative development host,
  outside repository/production/Actions; existing recipient not replaced.
- Used age/age-keygen1.3.2 from release archive with pinned SHA256 verified.
  Candidate directory0700/private identity0600; private bytes never printed,
  committed, sent to GitHub or production. Local random encrypt/decrypt PASS.
- Public recipient SHA256(no newline):
  b6a074dd5a7a7ea0c0b71e7c120fe07e85603444d2e598cd0949dd8ae5926241.
- Existing old archives NOT TESTED; new candidate cannot decrypt ciphertext
  for a different old key. Forgetting custody does not prove old key lost.
- This is a single online administrative candidate, NOT two offline copies,
  independent custody/signature or Farah evidence. No synthetic evidence made.
  Signing key for another person not generated; production encryption/timers
  unchanged. Precise private recovery paths intentionally omitted from Git.
- Next: owner/independent custodian securely places candidate on two physically
  separate offline media, proves their readability with existing verifier and
  supplies only public signer allowlist + signed PII-free evidence. Production
  rotation requires reviewed Actions route and retained old-recipient history.

## 2026-10-19: owner keeps administrative copy, no second USB available

- User screenshots show successful SCP to Mac and `cmp` output “Копии
  совпадают” comparing Mac file with first external LeadDrive Recovery volume.
  This is screenshot evidence of byte equality, not independent decrypt drill,
  physical-media custody signature, filesystem permissions or Farah acceptance.
- User has no second external medium and explicitly requests keeping second
  copy here and continuing. Existing candidate retained on administrative
  Contabo host, outside repository. lstat verifies regular identity0600 and
  directory0700 owned by current account. No secret bytes output/transmitted.
- Do not generate another unrelated key or duplicate same-host file merely
  to count copies. Mac, first external medium and administrative host copies
  exist by creation/screenshot evidence; TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA
  requirement remains unmet. User request to retain online copy is recorded
  accurately, not converted to a false signed offline attestation.
- Safe existing production SSH alias attempted for public-recipient comparison
  and marker existence only; authentication rejected (publickey). No remote
  script executed and no host state changed. Actions inspection route remains
  the verified fallback; do not infer that all production access is unavailable.
- Main unchanged226dde0e7, own PR892 OPEN. Existing production public recipient
  has NOT been compared to new candidate; key rotation must not be guessed.
- External signer/custody bundle absent; no second-person identity invented,
  no gate weakening, no unreviewed production recipient edit. Offline storage
  gap does not prevent retaining candidate or continuing documentation/checks,
  but currently prevents encrypted commissioning through existing workflow.
