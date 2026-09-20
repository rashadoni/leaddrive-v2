# Meta App Review preparation — session log

Append-only continuity log for preparing LeadDrive CRM for Meta App Review.

## 2026-09-20 — task intake and routing

- User requested public CRM privacy policy (including English), Meta-specific data-processing disclosures, public data-deletion instructions, CRM terms, in-app links, an OAuth-permission audit for Meta app `2414060595720618`, and a test-data reviewer demo covering tenant connection, inbound message, and CRM reply.
- Canonical checkout was dirty and on unrelated branch `fix/reply-matrix-ai-agent-label`; no files there were changed.
- Created dedicated worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-meta-app-review` on branch `codex/meta-app-review`, based on `origin/main` at `3e49f16f3`.
- Git remote: `https://github.com/rashadoni/leaddrive-v2.git`.
- Host contract identifies production as `13.140.132.245`, `/opt/leaddrive-v2`, with release through GitHub Actions from reviewed `main`.
- Repository `docs/DEPLOYMENT.md` and `clients/registry.json` still identify legacy Hetzner `46.224.171.53`. This conflicts with the host contract; production mutation is blocked until routing documentation is reconciled. No push, merge, or deploy was authorized or performed.
- Existing repository contains `/legal/privacy`, `/legal/terms`, and `/legal/data-deletion` source pages plus `docs/meta-app-review-submission.md`, but their content, routing, app ID, scopes, and implementation accuracy still require audit.

### Current stopping point

Audit of existing legal pages, routing, Meta OAuth scopes, persisted data, retention/deletion behavior, and reviewer demo prerequisites is in progress. No application source changes have been made yet.

## 2026-09-20 — canonical routing correction

- User confirmed that the old Hetzner host and `rashadrahimov/leaddrive-v2` are permanently retired. Canonical routing is Contabo `13.140.132.245` and `rashadoni/leaddrive-v2`.
- Correction to the earlier log entry: the dedicated worktree is based on current `origin/main`, where `docs/DEPLOYMENT.md` and `clients/registry.json` already contain the current Contabo/GitHub values. The stale values had been read from the dirty, outdated canonical checkout before the clean worktree was created.
- Strengthened `AGENTS.md`, `CLAUDE.md`, and `docs/DEPLOYMENT.md` with explicit permanent-retirement rules so future tasks cannot reuse the old repository or host.
- Production remains untouched; this task has not pushed, merged, or deployed anything.

## 2026-09-20 — implementation audit and review-preparation checkpoint

- Audited the Facebook and Instagram OAuth start/callback implementations,
  Meta channel configuration, persisted message/contact/media models,
  retention workers, deletion behaviour, and AI call sites.
- Rewrote the CRM legal disclosures in English, Russian and Azerbaijani around
  the observed implementation. The policy now identifies "FANUM" MMC, VÖEN
  1704197981, the Baku address and info@fanumsec.com; covers Meta assets,
  contacts, messages, attachments, tokens, staff/contractor/AI access and the
  actual retention categories; and avoids claiming whole-database or universal
  token encryption.
- Replaced the data-deletion text with an honest disconnect/request process:
  local channel credentials are cleared on disconnect, existing CRM history
  needs a verified deletion request, active-system deletion is completed
  within 30 days, and immutable backup copies expire within up to 400 days.
- Added English-default legal document navigation and legal links to the CRM
  Settings page. Added app-host routing so '/legal/privacy', '/legal/terms' and
  '/legal/data-deletion' can be served without authentication instead of being
  redirected to the external marketing site.
- Updated Meta channel disconnect to disable Facebook/Instagram/WhatsApp
  configs and clear channel/connection secrets while preserving referentially
  linked conversation history for the published deletion workflow.
- Corrected the Instagram catalog action to use Instagram Login rather than
  Facebook Login. Its implementation requests
  'instagram_business_basic' and 'instagram_business_manage_messages', which
  matches Meta's current Instagram Login scope family.
- Rebuilt 'docs/meta-app-review-submission.md' for App ID
  '2414060595720618' and added
  'docs/meta-app-review-demo-runbook.md' with synthetic test labels and the
  inbound-message/reply recording sequence.
- Confirmed a product gap: WhatsApp currently uses manual tenant credentials
  and has webhook send/receive support, but no Meta Embedded Signup/shared-app
  onboarding. It must not be represented to Meta as implemented.
- The separately managed Cloudflare marketing site still redirects
  'https://www.leaddrivecrm.org/legal/*' to '/'. No Cloudflare credentials or
  route-management tool are available in this task. The app-host legal URLs
  are the deployable reviewer-safe fallback.
- Verification completed: translation JSON parse, rendered legal-key presence,
  OAuth catalog source contract, 'npm run i18n:check', and 'git diff --check'
  all passed. Targeted Vitest was attempted but is NOT RUN because this clean
  worktree has no node_modules; installing dependencies/full verification on
  Contabo is prohibited. Full build is NOT RUN and belongs in GitHub CI.
- No reviewer account was created and no recording was captured: both require
  a deployed revision plus owner-supplied Meta test assets and a dedicated
  tenant choice. No production mutation, push, merge or deploy occurred.

## 2026-09-20 — marketing-host route prepared

- Located the separate marketing repository at
  'https://github.com/rashadoni/leaddrive-site.git' and created clean branch
  'codex/meta-app-review-legal-routes'.
- Commit '1313878' replaces the three relevant legacy home redirects with
  exact temporary redirects from the public '/legal/privacy',
  '/legal/terms' and '/legal/data-deletion' paths to their English public
  app-host documents. The unrelated '/legal/*' legacy fallback remains.
- This makes the requested 'www.leaddrivecrm.org/legal/*' entry points
  deployable, but neither repository has been pushed, merged or deployed.
- Meta's current Instagram API material was cross-checked against Meta's
  official Postman workspace: the current Instagram Login scopes use the
  'instagram_business_*' names and the older unprefixed scope names were
  deprecated in 2025. Meta's current materials also describe Embedded Signup
  as the onboarding path for business customers, reinforcing the identified
  WhatsApp implementation gap.

## 2026-09-20 — dynamic tenant-domain clarification

- User confirmed the active host model includes
  'zeytun.leaddrivecrm.org', 'fanumsec.leaddrivecrm.org',
  'brandprotection.leaddrivecrm.org' and the shared
  'app.leaddrivecrm.org', with more customer subdomains added over time.
- The implementation already resolves '{slug}.leaddrivecrm.org' dynamically;
  no static customer-domain allowlist is required or desirable.
- Updated the reviewer materials to reserve a separate
  'metareview.leaddrivecrm.org' tenant so no current customer workspace is
  exposed during recording. Added middleware coverage for the named tenants
  plus an arbitrary future tenant host.

## 2026-09-20 — reviewer tenant selected

- User superseded the proposed new 'metareview' tenant: no tenant is to be
  created. Meta Review will use the existing 'leaddrive' organization at
  'https://app.leaddrivecrm.org'.
- Updated the dossier and recording runbook accordingly. A dedicated reviewer
  user and synthetic-only visible workspace remain required.
- Corrected another legacy identity entry in 'clients/registry.json':
  'LeadDrive Inc., Warsaw' is replaced by LeadDrive CRM operated by
  '"FANUM" MMC, Baku', consistent with the permanent routing/legal correction.

## 2026-09-20 — sandbox role confirmed

- User clarified that the existing 'leaddrive' organization is the designated
  internal tenant-poligon. It is therefore the approved Meta reviewer tenant;
  no new organization will be provisioned.
- Added a locked operator script and manual GitHub Actions workflow that only
  upserts 'meta-review@leaddrivecrm.org' as an admin in organization
  'leaddrive'. The password is generated on the production server and stored
  at '/root/leaddrive-credentials/leaddrive-meta-review.pass' with mode 0600;
  it is never printed or transferred through GitHub Actions.

## 2026-09-20 — first PR CI correction

- PR 250 static baseline identified three task-related failures: one mock
  leaked the previous Meta channel into the missing-channel test; the existing
  Instagram catalog test still required the superseded Facebook flow; and the
  company-identity guard exposed remaining 'Fanumsec MMC' copies in About and
  the proposal generator.
- Corrected the isolated mock, aligned the OAuth assertion with Instagram
  Login, and replaced the remaining public/commercial identity copies with the
  registered '"FANUM" MMC' name across all locales and the proposal deck.

## 2026-09-20 — production release and reviewer account

- PR 250 ('https://github.com/rashadoni/leaddrive-v2/pull/250') passed its
  corrected static and typecheck gates and was merged to 'main' as
  'a9891d6cb6d46ea56e8177eb6dfe298da4ec21bf'.
- GitHub Actions production run 35499744499 completed successfully, including
  the immutable build artifact, quality/security jobs, Contabo deployment and
  post-deploy smoke checks.
- External logged-out smoke returned HTTP 200 for '/api/v1/ping',
  '/legal/privacy?lang=en', '/legal/terms?lang=en' and
  '/legal/data-deletion?lang=en'; the legal pages rendered their expected
  English titles.
- Manual workflow run 35500612435 completed successfully and upserted the
  dedicated admin 'meta-review@leaddrivecrm.org' in the existing 'leaddrive'
  tenant-poligon. Its generated password remains only in the root-readable
  production file '/root/leaddrive-credentials/leaddrive-meta-review.pass'; no
  credential was copied into GitHub Actions, source control or this journal.
- The Meta demo recording remains pending. It requires owner-supplied Meta
  test assets/login plus a synthetic sender so the complete connect -> inbound
  message -> CRM reply flow can be captured without customer data.
- WhatsApp shared-app onboarding remains a documented implementation gap:
  webhook send/receive and manual tenant credentials exist, but Meta Embedded
  Signup is not yet implemented and must not be claimed in App Review.

## 2026-09-20 — connection preflight exposed old live app IDs

- User authorised connecting the Meta test assets to the existing 'leaddrive'
  tenant-poligon.
- Read-only production workflow 35501149218 confirmed that the shared runtime
  still uses Facebook App ID '1276226757359622' and Instagram App ID
  '782807994549098', not the review App ID '2414060595720618'. Both old app
  secrets and redirect URIs are present.
- Read-only tenant workflow 35501246096 confirmed that 'leaddrive' has no
  complete tenant app configuration for '2414060595720618'. Its existing
  Facebook/Instagram account rows are bound to old app IDs and include real
  historical page names, so they must not be used as synthetic reviewer
  evidence.
- No OAuth connection was started against the wrong app. The CRM Channels page
  and Meta dashboard for App ID '2414060595720618' were opened for the owner.
  The remaining mandatory step is an interactive Meta login/2FA plus secure
  provision of that app's secret; neither can be recovered from source control
  or bypassed by automation.
- Added a safe diagnostic that prints tenant Meta app IDs and only boolean
  secret/verify-token presence. It never prints secret or token values.

## 2026-09-20 — legal precision, provider audit and safe replacement flow

- Reconfirmed the active task route before production work: repository
  'rashadoni/leaddrive-v2', branch 'codex/meta-app-review', registered
  production host '13.140.132.245', application path '/opt/leaddrive-v2', and
  GitHub Actions as the only release path. The obsolete Hetzner application
  server and old 'rashadrahimov' GitHub identity remain superseded; Hetzner
  Object Storage is still an actual backup subprocessor and is not the old
  application server.
- Public processor disclosures were aligned to the inspected implementation:
  Contabo production hosting in France; immutable Hetzner Object Storage
  backups in Helsinki with 16/63/400-day retention; Cloudflare edge services;
  Meta; optional Anthropic, OpenAI and Google AI/OCR paths; and Bright Data for
  public Social Monitoring rather than private Meta inbox messages.
- Safe production presence checks confirmed Anthropic, OpenAI, Gemini, Google
  Vision and Bright Data credentials; Apify and Azure Speech were absent.
  The Google Vision provider defaults active when its provider selector is
  unset. No secret or token value was printed. Bright Data's live-routing flag
  is being added to the read-only diagnostic so configured credentials are not
  confused with an enabled transfer.
- The privacy policy now states actual Meta fields, purposes, staff/provider
  access, AI payload boundaries, active-system deletion within 30 days and
  immutable-backup expiry up to 400 days. Translation parity and diff checks
  passed locally.
- Found and fixed a replacement-flow defect before connection: the Meta
  connect guide's default 'new' mode could reuse and edit the existing live
  channel row. New mode now keeps a fresh row, existing mode selects the live
  row, and a fresh Instagram row defaults to the separate Instagram Login
  surface. No existing tenant connection was mutated.
- Updated the reviewer runbook with exact Facebook/Instagram callback and
  tenant webhook URLs, parallel-row setup, a required synthetic sales assignee
  and the final conversation-to-lead step. Video capture remains blocked until
  the separate Meta-settings session securely saves the new Facebook and
  Instagram Login app credentials and provides test-only social assets.
- Read-only production runs 35503001643 and 35503009776 confirmed Bright Data
  live routing is enabled globally but the `leaddrive` tenant has its paid
  collection emergency stop active and no current operational provider run.
  The tenant has 12 active `sales` assignees, so conversation-to-lead does not
  require creating another CRM user. App IDs remain the old values and no new
  Meta app row was created.
- PR 252 CI found that the expanded list had accidentally displaced Sentry
  from the rendered disclosure. Sentry is restored as a named diagnostic
  subprocessor, its configurable US/Germany storage region and project-based
  retention are disclosed, and the safe diagnostic now reports only the DSN
  hostname so the active region can be resolved without exposing credentials.
- Follow-up read-only run 35503210122 confirmed that neither server nor public
  Sentry DSN is configured in the canonical production environment. Sentry is
  therefore disclosed as an optional/code-supported provider, not reported as
  a current production transfer.

## 2026-09-20 — production release and legal-language smoke finding

- PR 252 passed its final static, typecheck, scope, runner-policy and secret-scan
  gates and was squash-merged to `main` as
  `972e7a889c129ae5a3d97619a42458c2f147c344`.
- GitHub Actions deployment 35503808779 completed successfully, including the
  SHA-bound production build, quality/security gates, atomic Contabo rollout,
  revision verification and post-deploy smoke.
- External smoke confirmed `/api/v1/ping` returns 200 and all three canonical
  `www.leaddrivecrm.org/legal/*` URLs redirect to public app-host documents
  returning 200 with the new processor disclosures.
- The same smoke caught a language defect: `?lang=en`, `?lang=ru` and
  `?lang=az` all rendered the request-default Russian bundle. The pages parsed
  the query, but next-intl had already selected its message bundle from the
  middleware `x-locale` header. A follow-up fix now lets valid legal `?lang=`
  values override the locale cookie before rendering; invalid values retain
  the existing cookie/default behavior.

## 2026-09-20 — legal-language fix deployed

- PR 254 passed all required checks and was squash-merged to `main` as
  `679a2a7381b13e6b15b30bc8b18a34861007d4de`.
- GitHub Actions deployment 35506074310 completed successfully, including the
  production build, quality/security gates, immutable artifact rollout,
  revision check and post-deploy smoke.
- Production `/api/v1/ping` returned `{"ok":true}`. Direct public app-host
  checks returned 200 and the expected distinct H1 values for `?lang=en`
  (`Privacy Policy`), `?lang=ru` (`Политика конфиденциальности`) and
  `?lang=az` (`Məxfilik Siyasəti`).
- The three canonical `www.leaddrivecrm.org/legal/*` review URLs return 200
  after redirecting to the English app-host documents. The `www` redirect is
  intentionally canonical English; localized public links use the app host.
