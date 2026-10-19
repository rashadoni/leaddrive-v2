# Direct TikTok Business Messaging integration

## 2026-10-19 — scope and starting point

The owner requested a direct TikTok to LeadDrive CRM integration with OAuth and explicitly excluded Chatwoot. TikTok developer registration and the LeadDrive CRM app have been submitted; the portal currently reports Pending and does not yet display an App ID. This work must not claim live messaging or approval before provider access and a real-account test.

Repository: rashadoni/leaddrive-v2. Dedicated branch: codex/tiktok-native-messaging-20261019, based on origin/main 6d2e521ce. Authoritative worktree: /mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-tiktok-native-messaging-20261019 on remote-alt. The dirty canonical checkout and other branches are untouched. Files are edited in a scoped local source mirror and copied only to this task's worktree.

Plan: separate account-holder OAuth with tenant/admin/state checks and encrypted rotating tokens; authenticated DIRECT_MESSAGE webhook ingestion with deduplication and tenant binding; native reply transport with persistent idempotency and honest unknown-delivery handling; a direct connection option/status in the existing channel UI; targeted security and regression tests, then required CI. Existing legacy conversations must retain their original transport; new native conversations must never fall back to Chatwoot.

Initial audit: the existing TikTok Business OAuth is for comments, its webhook is for Lead Ads, and DM routing is currently Chatwoot. Reusing these as if they were a native DM integration would be incorrect. No existing credentials or provider settings have been changed. No external messages have been sent.

Release follows docs/DELIVERY-ARCHITECTURE.md: feature PR, required checks, owner-visible release scope, then main/deploy. Live activation additionally requires TikTok approval, app credentials and account-holder consent. Production configuration will not be fabricated.

## 2026-10-19 — implementation and first review

Added a distinct native provider, dedicated account-holder OAuth, signed one-use tenant/user state, encrypted account credentials and token rotation, account Advanced Access verification, signed webhook parsing and account-qualified inbox persistence. Native text replies use a durable operation ledger; unknown delivery blocks blind retries. Added explicit operator reconciliation in TikTok and protected the native configuration from generic edits. Existing Chatwoot conversations keep their provider. New settings page uses existing styles and EN/RU/AZ copy; the implementation applied the React best-practices skill.

Independent read-only review identified a disconnect/reconciliation versus queued-send race, generic configuration mutation exposure, definitive-rejection retry behavior and a trailing-slash webhook redirect risk. Fixed these: dispatch now holds the account lock and rechecks the durable pending row, finalizes accepted sends within that transaction, generic API rejects native config mutation, UI resets keys only after authoritative non-delivery, canonical webhook has no trailing slash. Token refresh commits rotation even if later verification fails; unverified tokens cannot send.

Verification so far: remote-alt npm ci completed, Prisma client generated, first targeted run 41/41 passed. Expanded run 84/85 passed; one old test asserted the exact Prisma select shape and now needs the provider metadata field. This expectation was updated without changing the tenant predicate. Subsequent tests, lint and required CI are pending. Full build/typecheck are NOT RUN on the shared host by workload policy. No live TikTok messages, production credentials, provider changes, push or deploy at this phase.

## 2026-10-19 — verified checkpoint

Targeted lint of the new backend/routes/settings UI passed. The expanded suite passed 95/95 tests in 13 files, including 10 credential lifecycle/dispatch tests and existing Chatwoot ledger/catalog/reply-policy regressions. Tests model provider calls and transactions; they are not proof of real PostgreSQL races or live TikTok delivery. First failure was corrected solely by updating the old assertion to include the newly selected provider metadata.

Ready for a path-scoped checkpoint and draft PR. Mandatory GitHub checks will run after readiness; full build and live browser/provider acceptance remain NOT RUN (shared-host policy and pending TikTok access). Current scope: OAuth connection/status, native inbound inbox messages, manual text replies, safe retry/reconciliation and local disconnect. No production changes or test messages.

## 2026-10-19 — PR and final local verification

Created and attached PR https://github.com/rashadoni/leaddrive-v2/pull/917 after checkpoint 5929f447f. During final review, explicitly typed new Prisma transaction callbacks/JSON writes and reconciliation results. Added canonical-host checks for OAuth, safe status serialization tests, manual-only native dispatch and linked-contact retention. No settings or messages changed in provider/production accounts.

Latest targeted verification: 98/98 tests passed in 14 files; targeted ESLint passed. PR will run the five required checks plus the existing production-build job on GitHub-hosted Linux. Build/CI results are pending; no merge/deploy has occurred. Next: resolve any CI regressions, then present the concrete owner release scope before merging under DELIVERY-ARCHITECTURE.md.
