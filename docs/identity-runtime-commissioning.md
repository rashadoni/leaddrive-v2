# Reviewed identity runtime activation

This procedure prepares the deployed identity implementation for one explicitly
selected company. It does not convert people, merge phone owners, issue codes,
change passwords, grant application access, or publish an Android candidate.
The owner's visible authentication rollout approval and required green PR gates
precede execution. Preparing these files is not that approval.

Production remains the registered `13.140.132.245:/opt/leaddrive-v2`. Use only
`Identity runtime commissioning` (`identity-runtime-commission.yml`) from
protected `main`, with its `production` environment, pinned SSH setup and the
shared deployment concurrency group. Its `deployed_sha` must equal both the
workflow's reviewed source SHA and the installed identity artifact SHA. No
feature-branch execution, secret input, alternate server or direct application
deployment is accepted.

## Sequence

1. Merge the verified server change after the owner approves the concrete
   behavior. Let the normal immutable-artifact deployment finish, including
   migrations, ping and exact public build-info verification. Keep the company
   flag off. Publish and install a compatible reviewed main-built native release
   before converting mobile users. Time1049 and Field1819 are qualified feature
   candidates; a fresh main build must have an increasing version code. Their
   candidate numbers are not promised public release numbers.
2. Dispatch `inspect`, selecting the actual company slug (for Zeytun: `zeytun`)
   and the verified deployed main SHA. It reports only configuration presence,
   aggregate identity counts and the selected company's opt-in state. Missing
   or ambiguous company, filtered database authority, unsupported flag data or
   unsafe canonical files are refusals. No phone/person record is returned.
3. Dispatch `prepare-keys` at that same reviewed deployed SHA. It creates two
   independent random key rings only when both durable rings are absent and no
   proof, converted account or live process key exists. Existing valid rings
   remain byte-for-byte unchanged. The atomic root-only environment update
   holds the existing app-env lock. The existing encrypted secret-backup script
   must verify its remote backup before this step reports success.
4. Run the normal `deploy.yml` route again from reviewed main to load the durable
   environment. The operator job never restarts PM2 or deploys application code.
   Recheck public build-info and ping. If main has advanced, use its newly
   verified deployed SHA for the next operation; never reuse the old SHA by
   pretending it is current.
5. Dispatch `enable-company`. Every running `leaddrive-v2` application process
   must have both exact durable rings; otherwise the operation requires the
   normal redeploy. A fresh encrypted backup precedes a transaction that opts
   in only the selected active company and records an audit with the reviewed
   source SHA and GitHub operator. A failed audit rolls the flag back; retrying
   a completed enable is idempotent. No account is converted by this operation.
6. The authenticated administrator explicitly reviews their own number and
   retained applications, confirms possession and sets the shared password.
   They then sign in normally, including MFA. In Time, explicitly select the
   actual existing employee; verify the original Field history and separate
   Time card on the installed compatible application. A matching phone alone
   never authorizes accepting the proposed person.

## Failure and recovery

If backup fails after keys were written, retain those keys and retry preparation;
do not regenerate or roll them back. If keys are missing after any proof or
conversion, restore the verified encrypted secret backup through the existing
recovery procedure. The commissioning operation refuses to invent replacement
authority. Partial, malformed or conflicting rings require deliberate review.

After any person is converted, switching off the company flag or restoring an
old executable is not an authentication rollback. The retained canonical
authority and artifact compatibility floor remain in force. Fix forward with
a compatible verified release. Inspect state after an interrupted operator
job; never infer that a failed/cancelled CI run implies no committed flag change.

Local filesystem/key-planning tests and disposable PostgreSQL transaction tests
qualify the implementation. They are not evidence that production keys, backup,
live-process admission, the selected person's number or physical Android login
have been exercised. Record those results separately when the approved steps
actually run. Direct production SSH from this development chat currently
refuses authentication; this workflow uses the existing protected Actions route.
