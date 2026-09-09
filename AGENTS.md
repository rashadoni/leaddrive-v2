# AGENTS.md — LeadDrive Codex operating rules

## GitHub return — prepared 2026-09-09

The owner authorized returning source control and normal Linux CI to a new,
public GitHub repository. The cutover is not active until the new repository is
created, its public-history secret scan is clean, required checks pass, and one
production release is verified. Until that proof, Azure and the existing
Contabo CI agent are a temporary bridge; do not run the same commit in two CI
providers merely to make it finish sooner.

GitHub-hosted macOS runners are prohibited. Native macOS/iOS jobs, if a project
actually needs them, must use the owner's physical Mac with
`runs-on: [self-hosted, macOS, ARM64, leaddrive-mac-local]`. Standard checks and
builds use GitHub-hosted Linux. The executable policy is
`scripts/ci/check-github-runner-policy.mjs`; do not weaken or bypass it.

After the new GitHub path passes a PR cycle and a production release, remove
only the Contabo/Azure CI agents and queues. Production sites, databases,
backups, DNS and persistent services are outside that shutdown. Keep the full
legacy history in the private Azure archive; the public GitHub repository starts
from a scanned clean snapshot. Validate `/api/v1/public/build-info` before
reporting a release.

Default mode is **Codex-only**. There is no cross-agent baton file and no
cross-agent handoff protocol. Codex owns normal product work, checkpoint
commits, verification, and user-facing status.

**Delivery is governed by `docs/DELIVERY-ARCHITECTURE.md`, and it outranks this
file on anything about how a change reaches production.** Four layers, in short:

1. `main` accepts pull requests only. No direct push.
2. Every pull request is reviewed by an agent that did not write it
   (`agent-review`, the one required check). Reviewing your own work does not
   count.
3. Production deploys only from `main`, with the atomic swap, health check and
   rollback that already exist.
4. Before merging anything a user will see, show the owner a short plain-language
   list of what is about to reach them and wait for his go-ahead. This is the one
   thing no check can do: on 2026-09-06 a correctly written dashboard feature
   nobody had asked for reached `main` with green checks.

The owner works alone and does not read diffs. Everything else is yours.

## Core workflow

- Work from a clean `main` worktree. If the user workspace is dirty or on a
  feature branch, create/use a separate clean worktree instead of touching
  unrelated changes.
- Auto-commit is ON: make checkpoint commits for logical units.
- Auto-handoff is OFF: do not create or update handoff files.
- Keep changes path-scoped. Do not do broad cleanup while implementing a
  feature request.
- Never use `git add -A` or `git add .`. Stage only explicit paths.
- Never use `git reset --hard`, force-push, or destructive cleanup unless the
  user explicitly asks for that exact operation.

## Fast lane vs safety lane

Fast lane is appropriate for docs, copy, small UI polish, narrow CSS/component
tweaks, and mechanical refactors that do not touch high-risk surfaces.

Safety lane applies to auth, tenant/RLS, Prisma/schema, billing, permissions,
deploy/build scripts, external sends/calls, background jobs, migrations/backfills,
or anything the user marks high-risk. For safety-lane work, use a short plan,
verify more broadly, and report blockers instead of guessing.

## Verification

Never report a check as passed unless it was actually run in the current tree.
Use the narrowest meaningful check for the change:

- docs-only: `git diff --check`
- UI-only: targeted lint/typecheck for touched files plus browser verification
  when practical
- code: targeted tests plus `npx tsc --noEmit` where practical
- `"use client"` boundary or `next.config.ts`: run or explicitly mark
  `npm run build` as NOT RUN/BLOCKED
- schema: Prisma validate/generate/migration procedure before deploy
- `messages/*.json`: `npm run i18n:check`

If a check is not run, say `NOT RUN` and why.

## Autonomy

The project owner runs several agent sessions in parallel (Codex, Claude
desktop, CI helpers) and does not want to be the message bus between them.
Standing authorization, granted 2026-09-06: **carry a change all the way to
production yourself.** That means, without asking for confirmation at any
step:

- push your branch and open the pull request;
- watch its checks, and when one is red, diagnose and fix it — a red check is
  work to do, not a question to forward;
- merge it into `main` once the required checks are green;
- let the deploy that follows the merge proceed (see "Deploy" below, which
  already carries standing deploy authorization).

Report the outcome, not each step. "Merged #1102, deployed, /api/v1/ping ok"
is the whole update the owner wants.

That authorization now runs through `docs/DELIVERY-ARCHITECTURE.md`: carry the
change yourself, but merge only once `agent-review` is green, and for anything a
user will see, get the owner's go-ahead on the short list first. Neither step is
a request for permission to work — they are part of the work.

What this authorization does NOT cover, because no amount of autonomy makes
these safe:

- **Merging red.** Never merge with a failing required check, never use
  `--admin` to bypass one, and never weaken, relabel or delete a gate to get
  a merge through. If a gate is genuinely wrong, say so and leave it standing.
- **Destructive production data operations** — dropping or restoring a
  database, deleting a tenant, running a backfill that cannot be reversed.
  Prepare it, then ask.
- **Anything requiring the owner personally**: passwords, payment details,
  account creation, provider panels. Ask; do not improvise around it.
- **Someone else's in-flight branch.** Merge what you built. Do not merge
  another session's PR unless the owner asked you to.

If a merge you made breaks production, revert it and redeploy immediately —
that is also your job, and it does not need permission either.

## Deploy

Default production deploy is `git push origin main`, then GitHub Actions builds
on an ephemeral hosted Linux runner and deploys to the shared production host
registered in `clients/registry.json`. Do not infer its physical processing
region from an IP address; verify the provider contract/panel before a legal
claim.
Post-deploy smoke starts with `/api/v1/ping`; run feature-specific smoke checks
when relevant.

The project owner has granted standing authorization for deployment: after a
successful merge into `main`, deploy to production automatically without
asking again. Do not wait for another confirmation. For changes that have not
been merged into `main`, do not deploy them as an incidental step.

## UI and browser evidence

- Do not remove, move, or replace UI sections without explicit user approval.
- For visible UI work, inspect the actual page when practical.
- Never claim something is visible in a screenshot/browser unless you have
  concrete evidence. If uncertain, say so and verify differently.

## Help videos and voiceover

- Hard rule: do not create, install, run, or use local TTS voiceover for help
  videos. This includes `edge-tts`, Microsoft Edge neural voices, macOS `say`,
  `pyttsx3`, `espeak`, `gTTS`, Coqui, or any other locally generated synthetic
  narration.
- If a tutorial video needs narration, use only user-provided recorded human
  audio or an explicitly approved external studio/provider workflow. If no
  approved audio source is available, stop and report voiceover as blocked
  instead of generating a local TTS fallback.
- Browser-guided video capture may still be generated as a silent or
  externally-narrated draft, but only when the audio source complies with the
  rule above.
- Microsoft Azure Speech is an approved external provider only when the user
  explicitly requests it and credentials are supplied through environment
  variables. Do not commit credentials and do not replace Azure failures with
  local TTS.

## CI cost policy

CI runs on **GitHub-hosted Linux in the public repository
`rashadoni/leaddrive-v2`**. Standard runners are free for public repositories,
so PR checks no longer compete for a metered minute budget. What made the old
bill was `macos-*`: of the $121.17 charged in September 2026, $84.41 was macOS
and $36.76 Linux. That is why the macOS ban below is absolute and machine-checked.

The Contabo CI pool and the Azure DevOps pipelines that briefly replaced it are
retired. Their labels (`leaddrive-ci`, `leaddrive-typecheck`,
`leaddrive-ci-light`) must never reappear in a workflow.

- **Every GitHub-hosted job pins `runs-on: ubuntu-24.04`.** Not `ubuntu-latest`:
  that alias moves to the next LTS on GitHub's schedule, changing every job's
  base image on a day with no commit to bisect.
- **Never add `runs-on: macos-*`.** Not for a native check, not temporarily, not
  behind a label gate. Real native macOS/iOS work goes on the owner's physical
  Mac under `runs-on: [self-hosted, macOS, ARM64, leaddrive-mac-local]` with a
  `timeout-minutes`. As of 2026-09-09 the repository has no Swift/Xcode target,
  so no Mac runner is registered — if you think you need one, raise it first.
- `scripts/ci/check-github-runner-policy.mjs` enforces all of the above and is a
  required check. Run it locally before touching a workflow.
- The one remaining self-hosted runner is `[self-hosted, fanum-pbx-vpn]`, used
  only by `set-voice-provider-registry-cutover.yml` because it needs the PBX
  VPN. Do not route anything else to it and never put a production credential on
  a workflow you have just relabelled.

Cost is no longer the binding constraint; **wall-clock and review noise are**.
Keep the guards that exist:

- **Open pull requests as drafts and keep them draft while iterating.** The
  expensive `static-checks` and `typecheck` jobs skip drafts. Mark the PR ready
  for review when the branch is finished; that fires `ready_for_review` and the
  gate runs once, before the merge it guards.
- Documentation-only changes (`**/*.md`, `docs/**`, `.agents/**`) do not start
  `pr-checks.yml`. Do not add code to a docs PR to make CI run.
- Any new `pull_request` workflow must declare a `paths:` filter narrower than
  the whole repository **and** a `concurrency:` group with
  `cancel-in-progress: true`, so a new push cancels the previous run.
  **One exception, and only one:** a workflow whose check is *required* on
  `main` must not be path-filtered. GitHub marks a required context satisfied
  only when a check run reports it, so a path-filtered required check leaves
  every PR outside its paths stuck on "Expected — waiting for status". That is
  why `runner-policy.yml` runs on every pull request. If you make a check
  required, remove its `paths:` filter in the same change.
- Do not remove these guards to make a check run sooner. Ask instead.

Because the repository is public:

- **Never use `pull_request_target`.** It runs with the base repository's
  secrets against untrusted head code. Plain `pull_request` does not hand
  secrets to fork PRs, which is what keeps `ANTHROPIC_API_KEY` and
  `NEXTAUTH_SECRET` safe in `agent-review.yml` and `pr-checks.yml`.
- Fork pull requests must stay gated behind "Require approval for all external
  contributors" in Settings -> Actions.
- Treat every value in the `production` environment as production-grade. Nothing
  reads it except `deploy.yml` and the operational `workflow_dispatch` jobs.

Check Billing -> Actions usage by SKU weekly. **Any macOS SKU appearing at all
is an incident** — find the workflow that produced it and report it.

Measured numbers and the reasoning are in `docs/ci-cost-policy.md`.

## Project references

- Architecture: `docs/ARCHITECTURE.md`
- Deployment: `docs/DEPLOYMENT.md`
- Client registry: `clients/registry.json`
- Current product plans live in `docs/` and implementation-plan files, not in a
  handoff file.
