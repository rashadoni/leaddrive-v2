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

## 2026-09-21 — screencasts, submission form and reviewer account

- Screencasts were recorded from the owner's Chrome against production with
  the CRM interface switched to English through the `NEXT_LOCALE` cookie (the
  owner's account settings were not touched; the cookie was set back to `ru`
  afterwards). The Facebook Login for Business dialog ignores a `locale`
  parameter and stays in the account language, so the Meta part of the
  recordings is in Russian; the reviewer instructions are in English.
- Three recordings exist: Facebook Page connection (config_id flow, Page "Lead
  Drive CRM"), Instagram Login connection (@leaddrive.az) and the WhatsApp
  settings page with the "Verify" credential check. Each was exported from the
  recorder as a GIF, dropped into the CRM's own inbox upload endpoint, copied
  from the production upload directory and converted with ffmpeg to H.264 MP4
  (the App Review uploader accepts `video/*` only). The upload files remain
  under the leaddrive tenant's inbox upload directory and can be deleted.
- Every recording re-ran the staged OAuth path only. The channel-row snapshot
  taken before the work and the one taken after differ solely in the four
  `appReviewOnly` rows (new Page/Instagram tokens); no live row changed.
- Submission draft `2418323735294304`: "Verification", "App settings", "Data
  handling" and "Reviewer instructions" are complete. In "Allowed usage" the
  descriptions, terms confirmations and (where available) screencasts are
  saved for all eight permissions. `business_management` was removed from the
  request: the Facebook Login for Business configuration does not grant it,
  the code makes no business-level call, and Meta requires a test call for it.
- Data handling answers, as entered: platform data is accessible to
  processors (Contabo GmbH — hosting/backups; Cloudflare, Inc. — TLS proxy and
  CDN; OpenAI, L.L.C. — optional voice-message transcription); the controller
  is "FANUM" MMC, Azerbaijan; no government national-security requests in the
  last twelve months; no formal policy for such requests is in place ("none of
  the above"). The Contabo processing country is entered as Germany until the
  owner confirms the VPS region from the Contabo panel — the privacy policy's
  "France" wording remains unverified.
- Reviewer account `meta-review@leaddrivecrm.org` (admin in the `leaddrive`
  tenant, created 2026-09-20 by the operator workflow): its password was reset
  through the dedicated reset-password endpoint, the login was verified from
  the dev box against production, and the new value was written to the
  root-only credential file on the production host and into the access-codes
  field of the submission. It appears nowhere in the repository.
- Test API calls: `GET /{page-id}/subscribed_apps` was executed with the staged
  Page token (pages_manage_metadata); Meta shows completed calls with up to 24 h
  delay. The WhatsApp permissions already show "Done" on the Testing page.
- Still blocking submission: `pages_messaging` needs an inbound Messenger
  message from a Facebook account with a role in the app (the owner's second
  account is an app admin) followed by a reply sent with the staged Page token;
  `whatsapp_business_messaging` and `instagram_business_manage_messages` need
  inbox screencasts with a test inbound message (Instagram additionally needs
  the sender to hold an Instagram tester role while the app is in development
  mode). The Instagram card currently carries the connection recording as a
  placeholder.
- Tooling note for the next session: the Chrome recorder captures a frame per
  `computer`/`navigate` action only, so clicks made through `javascript_tool`
  leave no frame; `find` references are invalidated by every navigation; the
  dashboard's inner `main` element scrolls, not `window`.

## 2026-09-21 — submitted for App Review

Submission `2418323735294304` was sent and Meta shows **"Идет проверка"** with the
usual "most requests are reviewed within 20 days". Seven permissions went in:
`pages_messaging`, `pages_show_list`, `pages_manage_metadata`,
`instagram_business_basic`, `instagram_business_manage_messages`,
`public_profile`, `whatsapp_business_management`. The submission can no longer be
edited or withdrawn.

Two real defects had to be fixed before any of it could work, and both were
invisible from the code:

- **The Messenger webhook pointed at `https://v2.leaddrivecrm.org/api/v1/webhooks/facebook`,
  without `?t=<slug>`.** That host resolves and serves the app, so nothing looked
  broken, but without the slug the request never reaches the tenant's own verify
  token or app secret. Changed to
  `https://app.leaddrivecrm.org/api/v1/webhooks/facebook?t=leaddrive` with a fresh
  verify token stored on the staged config row. Meta ran its own verification GET
  against it (nginx, 11:12 UTC, `hub.challenge`, 200).
- **Meta Business Agent (Meta's AI) was enabled on the Page and owned every
  thread.** Under the Handover Protocol the app was a secondary receiver, so
  inbound messages went to the `standby` field instead of `messages` — production
  had recorded zero webhook POSTs ever — and `POST /{page-id}/messages` failed with
  `(#10) another app currently controls this thread`. `take_thread_control`
  answered `(#27) not supported` (only the primary receiver may take control) and
  `request_thread_control` returned `{"success":true}` without transferring
  anything. The owner turned the agent off in Business Suite → Inbox → Meta
  Business Agent. Turning it back on will re-break delivery; that is the trade to
  be aware of, not a setting to flip casually.

With both fixed, the whole path works end to end and was recorded as the
`pages_messaging` screencast: a message sent in Messenger appears in the CRM inbox
within seconds, a reply typed in the inbox arrives back in Messenger. The reply
was also sent once directly through `POST /{page-id}/messages` with the staged
Page token, which is what flipped the required API test call for `pages_messaging`
to "Выполнено".

A third thing surfaced while reading production and is worth keeping:
**`now() - interval` in a psql session on production hides fresh rows.** The
inbound message was in `channel_messages` the whole time; the window compared a
CEST `now()` against a UTC `createdAt` and returned nothing, which read exactly
like "the webhook did not store anything". Query by absolute timestamp
(`order by "createdAt" desc limit N`) before concluding a row is missing.

`whatsapp_business_messaging` was removed from the request. Meta states it on the
WhatsApp configuration page: unpublished apps receive only test webhooks from the
app dashboard, and production data — including from admins, developers and
testers — is not delivered until the app is published. A truthful screencast of an
inbound WhatsApp message is therefore impossible before publication, so the
permission goes in its own submission afterwards. `whatsapp_business_management`
stayed: it needs no webhook, its API test calls are already complete, and its
screencast shows credential verification and template sync.

The app itself is still **not published**.

## 2026-09-21 (evening) — preparing a possible resubmission

Nothing here changes the submission under review; it prepares the second round.

- **Instagram and WhatsApp messaging demos are impossible before publication.**
  Meta states it on both configuration pages: webhooks for Instagram (Instagram
  Login) and WhatsApp are not delivered to an unpublished app, including from
  admins and testers. Messenger is the exception — role holders' messages are
  delivered. So `instagram_business_manage_messages` and
  `whatsapp_business_messaging` can only get a real screencast after the app is
  published.
- **The Instagram webhook must stay without `?t=`.** The Instagram product of
  `2414060595720618` is `782807994549098`, the same ID production carries in
  `INSTAGRAM_APP_ID`; its callback is the shared path for every tenant.
- **#317 — a staged row can no longer outrank a live claim.** On the Instagram
  webhook the review tenant's staged Instagram-Login row for @leaddrive.az ranked
  above Fanumsec's live row; after publication real Direct would have landed in
  the review sandbox. Staged rows now rank last (still ingesting when they are the
  only claimant).
- **Old Messenger connection of the Lead Drive CRM Page switched off** (owner's
  decision) — row `cmq3imyda000250xyo0gkmomu`, app `1276226757359622`, which was no
  longer subscribed to the Page. Messages for the Page now land on the staged row
  and replies go out through the app under review. Re-enable it to undo.
- **#320 — a conversation follows the connection that delivered its latest
  message.** It used to stay bound to its first connection forever; with that one
  switched off, inbound kept arriving while every reply failed with «… не
  настроен». Verified on production: new message → rebinding → reply delivered.
- **#334 (separate session) — after Connect with Meta the page opens the channel
  that was connected**, not the organization's most recent row (it had shown
  another tenant customer's Page in the form). Verified on production.
- **Screencasts re-recorded for a resubmission**: `pages_messaging` (real screen
  recording of the CRM from a headless browser signed in as the reviewer account,
  inbox filtered to the test conversation, Messenger chat list cropped out),
  Facebook Page connection and Instagram connection — all with English captions in
  a bar under the frame. Files are local to the session, not in the repository.
- The Facebook profile name of a Messenger sender cannot be read yet (`GET
  /{psid}` → code 100/33): it needs the Business Asset User Profile Access
  feature, so the inbox shows the Page-scoped ID instead of a name.
- The owner offered the second account (Rocky Marciano, an app admin) as the
  reviewer's test account. Its credentials are the owner's to enter into the
  access-codes field; the password he shared in chat is weak and exposed, and he
  was asked to replace it first. Nothing was stored anywhere.

## 2026-10-03 — review result, and why the Instagram flow never delivered a message

Meta answered submission `2418323735294304`. Approved: `pages_show_list`,
`pages_manage_metadata`, `pages_messaging`, `public_profile`,
`whatsapp_business_management`. Rejected: `instagram_business_basic` and
`instagram_business_manage_messages`, both with the same finding (Developer
Policy 1.6): the screencast does not show the complete use case described in the
notes. The reviewer accepts the use case and asks for the Meta login from start
to finish, the user granting the permission, the full use of each permission,
and an English interface with captions. The "Publish" button is now active; the
app is still unpublished.

The rejected screencast for `instagram_business_manage_messages` was the
connection recording used as a placeholder (see 2026-09-21). The description
promised an inbound Direct message, a reply and a lead.

What was verified on 2026-10-02/03, read-only unless stated:

- **The flow belongs to the app under review.** Instagram API setup of
  `2414060595720618` shows Instagram app "CRM-IG", ID `782807994549098`. The
  production process carries the same ID in `INSTAGRAM_APP_ID`, its secret has
  the same hash as the one stored on the staged row `cmuaws3n70000kp9k20thcsos`,
  and `/api/v1/social/oauth/preflight` reports `source: env` for the `leaddrive`
  tenant. The Connect button on the Instagram card calls
  `/api/v1/social/oauth/instagram/start` with no `?app=`: `api.instagram.com`,
  scopes `instagram_business_basic,instagram_business_manage_messages`, redirect
  `https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback` — the
  one URI registered in the app's business login settings. The old Facebook app
  `1276226757359622` is not on this path.
- **The webhook endpoint and its signature check work.** Meta's dashboard test
  for the `messages` field reached production: `POST
  /api/v1/webhooks/instagram` → 200 at 2026-10-02 22:31:33 UTC (an invalid
  signature answers 403). The sample carries placeholder ids, so nothing was
  stored.
- **No real message had ever arrived that way.** nginx holds fourteen days of
  logs and they contain no other POST to that path. The two Instagram messages
  of 2026-09-11 came through the Facebook-Login webhook of the old app.
- **Cause, in our code:** the Instagram callback never enabled the account's
  subscription (`POST /me/subscribed_apps` on `graph.instagram.com`). The app
  dashboard listed `leaddrive.az` with "Webhooks subscription: off". Fixed in
  PR #535 for an ordinary connect; a staged connect still asks for nothing.
- **Cause, on Meta's side:** Instagram webhooks are delivered to published apps
  only. This is in the Instagram Platform webhook documentation and on the app's
  webhook settings page. Not changed here — publishing is the owner's call.
- **Reviewer account** `meta-review@leaddrivecrm.org`: admin in `leaddrive`,
  active, no second factor required, and the password in the root-only file on
  production matches the stored hash (compared on the server, nothing printed).
- **Test accounts are missing.** The only Instagram Tester of the app is
  `leaddrive.az`, which is the live company profile claimed by `fanumsec`.
  There is no sender account with a role at all.

Not done, because it cannot be done truthfully yet: the screencast and the
resubmission. They need the two test accounts and a published app; see
"Instagram: what has to be true before a take" in the demo runbook.

Noticed and left alone: in the Instagram business login settings the
"Deauthorize callback URL" and "Data deletion request URL" are empty, and the
application has no endpoint for either. The app-level data deletion
instructions URL is set and was accepted in the first review.

## 2026-10-03 (night) — published, recorded end to end, resubmitted

- **The app was published** by the owner (the button is blocked for an agent session). Before
  that, a Direct message between two Instagram testers to an account whose subscription was on
  produced no webhook at all — Meta's "Live only" rule for Instagram webhooks is real, not a
  dashboard banner.
- **Test accounts, all the owner's own:** business `@rentacarazerbaijan` (IG id
  `17841405965503896`, connected to `leaddrive` through the ordinary Instagram Login, row
  `cmurlu8ci000okpg5xv7wl58z`, `inboxSubscribed: true`), customers `@rahimofff` and
  `@leaddrive.az`. All three hold the Instagram Tester role; adding roles is also blocked for an
  agent session, the owner did it.
- **Verified on production after publishing:** a Direct from `@rahimofff` reached
  `/api/v1/webhooks/instagram` (200) and was stored as inbound (`igLogin: true`); the reply typed
  in the inbox went out through `graph.instagram.com/me/messages` and showed "Seen" in Instagram;
  "Create lead and assign salesperson" created lead `cmurmiyf7000fkp4zanieuy2y` with both
  messages under Interactions. The test phone on that lead is Ofcom's reserved drama number.
- **Screencast:** 1:34, 1568x952 H.264, English caption bar under every frame, third-party names
  and older private chats blurred. Built from the recorder frames with `build.py`; master and
  sources in `/home/rashad/inbox/meta-review-2026-10-03/` on the dev box (SHA-256 `dd60986c…`).
  Recorder GIFs larger than ~10 MB do not pass `/api/v1/inbox/upload` ("Invalid form data");
  decoding the GIF in the page and uploading frames one by one works (mind the rate limit).
- **Submission `2592383921221617`** — "Идет проверка" since 2026-10-03 ~02:58 Baku: new requests
  `instagram_business_basic`, `instagram_business_manage_messages`; the five approved permissions
  carried over as renewals. Descriptions carry timecodes and say explicitly: Instagram Login by the
  account owner, no System User token, exchange/webhooks/replies on our server. Data handling now
  lists **Anthropic, PBC** as a processor: the inbox lead classifier and the stage classifier send
  Instagram message text to Anthropic, and the earlier list (Contabo, Cloudflare, OpenAI) missed
  it. Reviewer instructions rewritten (the old text named `@leaddrive.az`, "development mode" and a
  non-admin reviewer); the access-codes field still holds the current reviewer password (checked by
  hash against the root-only file on production).
- **Left as found / changed on purpose:** the staged row "@leaddrive.az (App Review)"
  (`cmuawxt5o00hfkp9kjet96tsq`) stays switched off — it never delivered anything and kept the
  Instagram card on "Edit setup" instead of "Connect with Meta"; one click in its form turns it back
  on. Chatbot auto-reply for Instagram was off only during the take and is on again.
- **Still open:** the Instagram business login "Deauthorize callback URL" and "Data deletion
  request URL" are empty and the app has no endpoints for them; the `leaddrive` inbox that the
  reviewer login opens contains real third-party conversations; `whatsapp_business_messaging`,
  `instagram_manage_comments` and `business_management` are not requested.

