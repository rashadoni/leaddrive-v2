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
