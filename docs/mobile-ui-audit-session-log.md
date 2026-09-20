# Mobile UI audit and simplification — session log

This file is append-only. It preserves requirements, decisions, implementation evidence, and the exact continuation point when chat history is compacted.

## 2026-09-19 — recovered scope and corrected baseline

- User approved simplifying the mobile Route & Field application for tablet-first use while preserving phone compatibility and both portrait and landscape orientations.
- Requested route-planning changes: date-only planning, no planned time, no draft step, month calendar, clients in the main navigation, add a client to a route for a selected date, and label the navigation action as “Как добраться”.
- Requested field-control changes: 30-minute visit guidance, reliable agent location on the manager map, detailed visit actions, and evidence that product presentations were opened, including time and location.
- Requested commercial hierarchy: product presentations grouped per agents/managers; managers own groups and subgroups; agents receive the relevant group.
- Requested client model: every client is a person located at one or more organizations; administrators can assign/unassign agents and the mobile application must remove out-of-scope client data; agents can add a doctor with name, specialty, address/clinic, phone, and notes.
- Requested SaaS customization: tenant administrators can add and change client categories such as doctors and pharmacies, with different fields for each category.
- Corrected an earlier stale-branch assessment. Current mobile `current/main` at `34ffca0` already contains presentation tracking, manager visit evidence, product hierarchy/membership, contact assignment tombstones, 30-minute visit guidance, location/map fixes, simplified date-only routes, Clients in main navigation, add-to-route, month calendar, and rotation navigation fixes.
- Physical tablet verification remains pending because neither the normal ADB server nor the forwarded ADB server at `127.0.0.1:35037` currently lists a device.

## 2026-09-19 — configurable client categories implementation

- Server worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mtm-configurable-client-types`, branch `codex/mtm-configurable-client-types`, based on server `active-github/main` commit `67e3f2800`.
- Mobile worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mtm-presentation-evidence-mobile`, branch `codex/mtm-presentation-evidence-mobile`, based on mobile `current/main` commit `34ffca0`.
- Added governed `CLIENT_TYPE` dictionaries with multilingual category labels, configurable fields, field types, required rules, and select options.
- Added `MtmContact.categoryData` and a migration so tenant-specific values remain separate from the signed category schema.
- Assignment validation rejects unknown fields, missing required values, invalid numbers, and unsupported select options.
- Web contact detail can assign/change a category and its fields; sync pull includes the category and field values for offline mobile use.
- Contact creation now loads active tenant categories, renders the correct fields, validates required inputs, and writes the person, workplace, category assignment, and category data together.
- Added a visual SaaS administrator builder for categories, fields, field types, required flags, and select options. Active configuration is changed by creating a prefilled new immutable version, preserving audit history.
- Mobile contact detail now displays the configured category in the header/summary and displays localized category fields in the overview, online and from the offline snapshot.
- Verification completed: server translation parity passed; Prisma schema validation passed; 43 targeted server tests passed; targeted production-file ESLint passed; server `git diff --check` passed. Mobile contact-detail suite passed 12 tests; mobile targeted ESLint passed; mobile TypeScript `tsc --noEmit` passed; mobile `git diff --check` passed.
- Full server TypeScript/build was not rerun locally: a previous full `tsc --noEmit` exhausted the local Node memory limit, and host rules require the heavy gate to run in CI.

## Current continuation point

- Next: checkpoint-commit the server and mobile changes, push feature branches, open/observe CI, then merge/deploy only after green required checks.
- After a tablet becomes visible in ADB: install the resulting mobile build and verify Clients, route planning/month calendar, configurable category fields, presentations, maps, and navigation in portrait and landscape.

## 2026-09-19 — release and deploy continuation

- The previous continuation point is superseded: server PR `rashadoni/leaddrive-v2#241` and mobile PR `rashadoni/leaddrive-mtm#66` were merged after green CI.
- Mobile main produced release `v3.3.0-build256`; the APK was downloaded and its published SHA-256 checksum passed.
- Server production workflow run `35467618741` passed quality/security and artifact-build jobs; the atomic production deployment was still running when this entry was appended.
- ADB was checked again through both the local server and forwarded server at `127.0.0.1:35037`; both device lists remained empty, so no physical-device visual claim has been made.
- Per the user's explicit instruction, removed the three Social Monitoring-specific requirements from the shared deploy workflow: standalone page-manifest assertion, queue-scheduler smoke, and authenticated browser smoke/evidence upload. General build, security, database, MTM, scheduler, revision, ping, and asset smokes remain intact.
- Current continuation point: finish and smoke-check the active production deployment, publish the deploy-gate cleanup through review/CI, then install build 256 and complete portrait/landscape visual verification as soon as ADB exposes the device.

## 2026-09-19 — production completion and deploy-gate cleanup

- Server PR `rashadoni/leaddrive-v2#241` deployed successfully in workflow run `35467618741`; atomic deployment, database-path ping, deployed revision, login page, and hashed asset smokes all passed.
- Deploy-gate cleanup PR `rashadoni/leaddrive-v2#242` passed static checks and the full TypeScript gate, then merged as `b594797fb65059f4ae9192a3d5a4e60f9e9d14e5`.
- The next main commit `df65ee2bb1c33cd73c23465687809ee316c03c0f` contained the cleanup and superseded the first control run through the workflow concurrency rule.
- Final production workflow run `35470189884` completed successfully. Its actual deploy job contained the general security, database, MTM, scheduler, tenant-isolation, ping, revision, and asset checks, and contained no Social Monitoring step.
- Mobile release remains `v3.3.0-build256`; the verified APK is staged at `/tmp/leaddrive-mtm-build256/leaddrive-mtm-v3.3.0.apk` for installation.
- Current continuation point: both code releases and production deployment are complete. Physical portrait/landscape verification is the only unfinished item; resume by installing build 256 when the forwarded or local ADB server lists the phone/tablet.

## 2026-09-20 — physical phone audit and Outlook-style route calendar

- The previous continuation point is superseded: the forwarded ADB server at `127.0.0.1:35037` exposed the user's USB-connected Galaxy S23 Ultra (`SM_S918B`). Release `v3.3.0-build256` was checksum-verified, installed, opened with the existing demo account, and visually inspected from real device screenshots and UI-automation trees.
- The production bootstrap returned the old `fieldContactsEnabled=false` policy, causing the approved person-first client directory to appear as “Места”. Mobile policy handling was corrected so the primary destination is always “Клиенты”; organization/place context remains inside that directory.
- The month calendar was confirmed to contain route counts but rendered routes as dots only. It now preserves compact route summaries from `/mobile/week` and renders Outlook-style event rows directly in each relevant date: route name when present (otherwise “Маршрут”), point count, up to two rows plus an overflow count on tablets, and a compact route row on phones.
- The tablet calendar was changed from a narrow 55% split pane to a full-width seven-column month before the selected-day details. This gives route rows enough room and keeps date selection as the single path to the detailed plan for that day.
- The bottom navigation received an explicit high z-layer to keep all six destinations visible through Android rotation redraws.
- Mobile PR `rashadoni/leaddrive-mtm#67` passed scope, test, TypeScript, signing, APK/AAB build, package/version and signature verification, then merged to `main` as `fec03ed9428cb13669f504b8d5915ceaced780ae`.
- Main workflow run `35476085262` passed and published prerelease `v3.3.0-build259`. The published APK checksum passed, installation succeeded, and the device reports `versionCode=1259`.
- Physical phone acceptance passed in portrait: the main navigation says “Клиенты”, dates with demo routes show visible route rows, and all six bottom destinations are present. Physical phone acceptance passed in landscape: the calendar shows readable route rows and all six destinations remain visible.
- Because the Wi-Fi tablet did not appear in forwarded ADB or mDNS, physical-tablet acceptance remains `NOT RUN`. A reversible 2560×1600/320-dpi tablet viewport was applied to the connected phone instead; it confirmed the full-width Outlook-style grid, route rows/counts, and complete left navigation. This is responsive-layout evidence, not a claim that the physical tablet was inspected.
- The temporary viewport and orientation overrides were removed. Final device state was verified as physical 1080×2316 at 450 dpi, `accelerometer_rotation=1`, `user_rotation=0`.
- Verification: 39 targeted Jest tests passed; targeted ESLint passed; `npx tsc --noEmit` passed; `git diff --check` passed; PR and main Android CI passed; release checksum and install passed; real portrait/landscape device screenshots and UI trees passed.
- Current continuation point: code, release, phone installation, portrait/landscape acceptance, and simulated tablet responsive acceptance are complete. When the Wi-Fi tablet becomes visible in ADB, install release build 259 there and repeat the physical tablet portrait/landscape acceptance; no additional code change is currently required for this calendar request.

## 2026-09-20 — route-flow confusion audit and recovery implementation

- The previous continuation point is superseded. A new physical audit on the connected Galaxy S23 Ultra confirmed that the active route repeated the current client in the route-point list, showed a route journey strip and route summary above a second active-visit workflow, placed “Изменить план” inside the “Точки маршрута” heading, and appended another self-planning promo below the same published route.
- Tapping “Задачи и презентации” opened a screen titled “Итог визита” during an active visit. That screen mixed product presentations, assigned tasks, result history and every policy snapshot action, including OPTIONAL “Чек-лист” and “Следующее действие”. This is the confirmed source of the user-reported confusion.
- Mobile work now continues on `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mtm-presentation-evidence-mobile`, branch `codex/field-ux-simplification-v2`, based on mobile `current/main` commit `fec03ed`.
- Implemented but not yet released: one active-visit action list; separate Presentation and Visit tasks entries; inline completion checks; only REQUIRED policy actions are shown; the retired CHECKLIST and NEXT_ACTION rows are hidden; active client duplication is removed; route journey/summary are hidden while a visit is active; change-plan is separated from the section title; the redundant planning promo/hint is removed.
- The Today screen now preserves and renders the whole route client list instead of exposing only the next client.
- The web team-message send path already created threads, messages, notifications and receipts, but the mobile application had no Messages screen or API call. A Team messages screen, unread banner on Today, read receipts and acknowledgement receipts are now implemented in the mobile branch.
- A real demo “New doctor” submission was attempted from the installed production app. Required fields were filled, but submit returned the user to Login with “Доступ отозван”; no successful delivery is claimed. Code inspection confirms that a successful request has status SUBMITTED and appears in web `/mtm/contacts` under “Заявки на новых врачей”; approval creates the doctor, clinic and requesting-agent assignment.
- Server web recovery work continues on `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-field-ux-recovery`, branch `codex/field-ux-recovery`, based on `active-github/main` commit `921aa9d34`.
- The product-catalog form no longer silently disables creation with no explanation. Group and product actions remain pressable, show specific missing-field guidance, and surface the API error instead of replacing every failure with a generic message.
- Verification so far: mobile `npx tsc --noEmit` passed; 18 targeted mobile tests passed before the message screen addition; server translation parity passed. Server targeted ESLint is currently NOT RUN because this clean worktree has no installed ESLint dependency; no dependency install or full build was run on Contabo.
- Current continuation point: finish targeted mobile tests and the automated UI audit, checkpoint both branches, push/open CI, fix any CI findings, merge/release/deploy, install the new APK, log the agent back in, and repeat the route/message/doctor-request flows on the real phone before tablet acceptance.

## 2026-09-20 — simplified visit steps and retired prototype actions

- The user clarified that the visit must not show a second standalone “Обязательные действия” form and that prototype “Чек-лист” and “Следующее действие” rows are not part of the desired agent flow. Completion should instead be visible as checks on the real visit steps.
- Mobile now presents the active visit as one checklist: Presentation, Visit tasks when assigned, required photo/signature when configured, then Finish visit. Presentation and task workspaces are separate; only task-like policy requirements can appear in the task workspace.
- The server now treats legacy CHECKLIST and NEXT_ACTION policy actions as retired: new requirement snapshots resolve them as HIDDEN, the policy editor no longer offers them, demo seeds no longer require them, and historical REQUIRED snapshots cannot trap an already-started visit at checkout.
- Mobile verification passed: `npx tsc --noEmit`, `git diff --check`, and 21 targeted Jest tests across route simplification, Today route clients, route state, and visit-workspace mapping.
- Server verification passed: translation parity, targeted ESLint, `git diff --check`, and 23 targeted Vitest tests for visit-policy resolution and checkout readiness. Full server TypeScript/build remains for CI under the Contabo workload rules.
- Current continuation point: checkpoint the mobile, server, and journal changes; push both feature branches; open and observe CI; merge/release/deploy only after green gates; install the resulting APK and repeat the route, team-message, and doctor-request scenarios after the demo agent logs in again.

## 2026-09-20 — release build 262 and production rollout

- The previous continuation point is superseded. Mobile PR `rashadoni/leaddrive-mtm#68` passed its complete CI matrix and merged to `main` as `950c5a586ee23cbd646b33a084b2346922161365`.
- The official mobile main workflow `35480532120` passed and published release `v3.3.0-build262`. Its APK and published SHA-256 checksum were downloaded; `sha256sum -c` passed. The verified APK is staged at `/tmp/leaddrive-mtm-build262.ig3VY1/leaddrive-mtm-v3.3.0.apk`.
- Server PR `rashadoni/leaddrive-v2#246` passed static checks, the full TypeScript gate and scope checks, then merged to `main` as `1f4fe9d0e045d4c059277ad48e5ef4d4924097f9`.
- Server production workflow `35480923284` completed successfully. Quality/security gates, immutable production build, atomic deploy, scheduler checks, tenant-isolation coverage, public DB-path ping, served-revision verification and login/assets smoke all passed.
- Current continuation point: the phone is intentionally disconnected while release/deploy work completes. Ask the user to reconnect it, install build 262 over the existing app without clearing data, confirm `versionCode=1262`, and physically verify Today, route/active-visit simplification, team messages, new-doctor request, and portrait/landscape behavior. Check the Wi-Fi tablet afterward if ADB exposes it.

## 2026-09-20 — build 262 installation and fresh-login revocation diagnosis

- The Galaxy S23 Ultra reappeared through forwarded ADB, build 262 installed successfully over the existing app, and the device reported `versionCode=1262`, `versionName=3.3.0`.
- The preserved session had already been revoked. Re-entering credentials, including after a password reset and a clean process restart, briefly authenticated and then returned to the “Access revoked” login screen.
- The user clarified that the agent had pressed Pause/Break before the original session ended. A paused workday must persist across login and must not revoke account access.
- A direct production diagnostic used the affected demo credential without persisting or logging its password. Mobile auth returned HTTP 200 and the newly issued token immediately loaded `/mobile/bootstrap` with HTTP 200 and active `FIELD_EXECUTE` / `FIELD_TRACK` capabilities. This ruled out an inactive agent, revoked linked user, tenant entitlement failure, and invalid server token.
- Root cause was isolated to the mobile API client's 401 race: a response checked `this.token` only after the request completed and always called logout. A late 401 issued under an older token, or an unauthenticated parallel login, could therefore erase a newer valid token and show a false revoked banner.
- Mobile branch `codex/mobile-auth-session-race` now snapshots the request token and revokes only when the rejected token is still the current token. Two regression tests cover late old-session and late unauthenticated 401 responses. The focused API-client suite passed 71 tests; `tsc --noEmit`, `git diff --check`, and targeted ESLint passed (one pre-existing dot-notation warning, zero errors).
- Mobile PR `rashadoni/leaddrive-mtm#69` is open. Scope and test checks passed; the signed Android build check is running.
- Current continuation point: wait for PR 69 Android CI, merge after green, wait for the new main release, checksum-verify and install its APK without clearing data, then re-test login and confirm the paused workday is restored rather than falsely revoking access. Resume the original route/message/doctor-request portrait/landscape acceptance afterward.

## 2026-09-20 — build 264 repeated revocation and authoritative-session fix

- The previous continuation point is superseded. Mobile PR `rashadoni/leaddrive-mtm#69` passed CI, merged as `e45f741009531439f3b4005d538eb95cd606de1e`, and official release `v3.3.0-build264` was checksum-verified and installed. The Galaxy S23 Ultra reported `versionCode=1264`, `versionName=3.3.0`.
- A fresh physical login still returned immediately to the false “Access revoked” screen. This proved that the old-token race fix was valid but insufficient: a 401 from a request made by the new token could still globally clear a session whose authoritative bootstrap remained valid.
- Read-only startup tracing confirmed that Today starts routes, KPI and team-message reads while the session refresh starts bootstrap, v1 sync, optional v2 route sync and any retained media queue. The separate photo uploader still used the old unconditional 401 logout path.
- A concrete team-message transport mismatch was found: the mobile client requested `/api/v2/mtm/mobile/messages`, while the deployed list and thread handlers are `/api/v1/mtm/mobile/messages`. This explains why manager messages did not appear in the app.
- Mobile work now continues on `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mobile-authoritative-session-revoke`, branch `codex/mobile-authoritative-session-revoke`, checkpoint commit `8de33bf`.
- The client now ends a session only when the same-token `/mobile/bootstrap` returns 401. A 401 from messages, routes, KPI, sync or photo upload triggers one token-bound bootstrap validation; bootstrap 200, network failure or 5xx leaves the session intact. Parallel failures share one validation, and a late result cannot clear a newer login. Photo upload uses the same snapshot-token path.
- Team-message list and thread reads now use the deployed v1 API.
- Verification passed: 78 focused API-client Jest tests, 3 field-UX/message contract tests, `npx tsc --noEmit`, targeted ESLint with zero warnings/errors, and `git diff --check`. Full Android build is intentionally reserved for GitHub CI under the Contabo workload contract.
- Current continuation point: push checkpoint `8de33bf`, open and observe the mobile PR, merge only after green CI, wait for the official main APK release, checksum-verify/install it on the connected phone, then re-test login and continue the route, messages, new-doctor, portrait/landscape and tablet acceptance flows.

## 2026-09-20 — build 266 authentication recovery and Today-route duplication

- The previous continuation point is superseded. Mobile PR `rashadoni/leaddrive-mtm#70` passed its required checks and merged to `main` as `0718615746157215616f75117ece46b68ac47523`.
- Official release `v3.3.0-build266` was checksum-verified, installed on the connected Galaxy S23 Ultra, and reported `versionCode=1266`, `versionName=3.3.0`.
- Physical launch acceptance passed: the saved agent session opened the Today screen without a false “Access revoked” banner, the paused workday was restored, and the manager announcement appeared in the unread-message banner. This confirms the authoritative same-token session validation and deployed v1 message reads on the real phone.
- The same physical screenshot exposed a remaining Today-screen defect: `ADV-DEMO Store 3` appeared once as a 27/33 heavyweight hero title and again as route point 1; the remaining-point count was also printed twice before point 2.
- Mobile work now continues in `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mobile-authoritative-session-revoke`, branch `codex/today-route-dedup`, checkpoint `0db665d`.
- The Today route card now has one compact header, one remaining-point count, and one flat ordered list. Each customer appears once; the actual `nextPoint` row receives the short localized marker `Следующая` / `Next` / `Növbəti`. The next customer name and address are no longer repeated as a separate hero block.
- Local verification passed: 14 targeted Jest tests, targeted ESLint with zero warnings/errors, `npx tsc --noEmit`, and `git diff --check`.
- Mobile PR `rashadoni/leaddrive-mtm#71` is open. Scope and test checks passed; the signed Android APK/AAB build is running.
- Current continuation point: wait for PR 71 Android CI, merge after green, wait for the official main APK release, checksum-verify and install it without clearing data, then visually confirm on the real phone that each route point and the remaining count appear once. Continue the broader route/message/new-doctor portrait/landscape/tablet acceptance after this regression is closed.

## 2026-09-20 — build 268 Today-route physical acceptance

- The previous continuation point is superseded. Mobile PR `rashadoni/leaddrive-mtm#71` passed scope, tests and the signed Android APK/AAB build, then merged to `main` as `f64a3c945bd402252a90d744444df46eeb5a927f`.
- Official main workflow `35497877375` passed and published prerelease `v3.3.0-build268`. Its APK and published SHA-256 file were downloaded; `sha256sum -c` passed.
- Build 268 installed successfully over build 266 without clearing application data. The connected Galaxy S23 Ultra reports `versionCode=1268`, `versionName=3.3.0`, and preserved the authenticated agent session and paused workday.
- Real-device portrait acceptance passed. The Today card shows one compact “Маршрут на сегодня” header, one `Осталось точек: 2` line, one `ADV-DEMO Store 3` row with the `Следующая` marker, and one separate `ADV-Store 1` row. UI-automation counts for all four strings are exactly one.
- Real-device landscape acceptance passed after forced rotation: the same four route strings each occur once and all six navigation destinations remain present. The temporary rotation override was removed; final settings are `accelerometer_rotation=1`, `user_rotation=0`, and the phone was returned to portrait.
- Current continuation point: the reported Today-screen duplication and oversized next-client hero are fixed, merged, released, installed and physically verified. Resume the broader outstanding acceptance scope at the route/active-visit actions, team-message interaction, new-doctor request delivery/status, and physical Wi-Fi tablet when it becomes visible in ADB.

## 2026-09-20 — Cloud transfer checkpoint: build 273

- This entry supersedes the build 268 stopping point for handoff purposes. The authoritative mobile repository is `rashadoni/leaddrive-mtm`; use `current/main` / GitHub `main` at `0578ad85b76bc544ac80b1ebc704859712f6932f`. The stale local `origin` remote and stale canonical checkout must not be used as the release authority.
- Mobile PR `rashadoni/leaddrive-mtm#72` merged as `e973164432bfbf2091468479c2c6f543586f6f69`. Android no longer relies on WebView to render an authenticated PDF. It downloads to private cache with bearer authentication, verifies exact size and SHA-256, renders pages through native `PdfRenderer`, and records a presentation only after a page image loads. The UI includes page navigation and responsive phone/tablet portrait/landscape layouts. PPT/PPTX external handoff is explicitly not counted as a verified presentation.
- PR 72 verification passed in CI, including the signed APK/AAB build. Local targeted verification before merge passed 24 Jest tests, targeted ESLint, TypeScript, and `git diff --check`. Release build 272 was checksum-verified, installed, and launched, but the new native PDF page itself was not physically accepted before the next release.
- Mobile PR `rashadoni/leaddrive-mtm#73` merged as `0578ad85b76bc544ac80b1ebc704859712f6932f`. Team Messages refresh on screen focus, every 30 seconds while focused, and on foreground return; the unread badge uses the server count. This is bounded polling, not background push/FCM.
- Official workflow `35501866834` passed and published prerelease `v3.3.0-build273`. The APK and published checksum were downloaded; `sha256sum -c` passed. Direct APK URL: `https://github.com/rashadoni/leaddrive-mtm/releases/download/v3.3.0-build273/leaddrive-mtm-v3.3.0.apk`.
- The checksum-verified build 273 APK returned `Success` when installed over build 272 without clearing data. The phone then disappeared from forwarded ADB before version/startup/UI inspection, so build 273 physical launch, session preservation, native PDF rendering and message polling are explicitly NOT YET VERIFIED.
- Reinspection of build 272 immediately before the final install showed the corrected Today card: one `ADV-DEMO Store 3`, one `ADV-Store 1`, one remaining count and no large duplicate customer hero. The historic duplicate was exactly one `nextPoint` rendered both as a hero and inside `route.points.map`; PR 71 removed the hero. A malformed legacy payload can still repeat an identical `point.id` because mobile normalization does not defensively deduplicate it, although normal server create/update validation rejects duplicate route targets.
- Server PR `rashadoni/leaddrive-v2#251` merged as `c4f08f90ae1868cffdb666768fe9bd3ae564aea5`. It allows the exact mobile v2 new-contact-request POST route and assigns the clinic to the requesting agent when a manager approves a new doctor request (PRIMARY for a new clinic, SECONDARY for an existing clinic, without stealing ownership or duplicating an active assignment). Six targeted tests, targeted ESLint, diff check and CI gates passed.
- Server production workflow `35501471856` completed build/security gates and entered the production deploy job. At this checkpoint the atomic deploy and post-deploy smokes were still running; production success is not yet claimed.
- The successful new-doctor destination is `/mtm/contacts` in the manager web application, with initial request status `SUBMITTED`; it is not delivered as a team-chat message. The mobile app currently has no request-history/status screen and no background push for this request.

### Exact continuation for Codex Cloud

1. In Cloud choose the environment for GitHub repository `rashadoni/leaddrive-mtm` and use `/workspace/leaddrive-mtm`; verify `main` is at `0578ad85b76bc544ac80b1ebc704859712f6932f` and never use Contabo `/home/...` paths there.
2. For server/admin work choose `rashadoni/leaddrive-v2` and `/workspace/leaddrive-v2`; verify `main` contains `c4f08f90ae1868cffdb666768fe9bd3ae564aea5`.
3. Check production workflow `https://github.com/rashadoni/leaddrive-v2/actions/runs/35501471856`. After success, verify `/api/v1/ping` and `/api/v1/public/build-info` serve the merged SHA.
4. Reconnect the Galaxy S23 Ultra to forwarded ADB at `tcp:127.0.0.1:35037`, confirm `com.mtmobileapp` reports `versionCode=1273`, launch it, and confirm the preserved demo-agent session. If it does not report 1273, reinstall the checksum-verified build 273 APK without clearing app data.
5. Physically test the native PDF presentation viewer in portrait and landscape: visible page content, `Страница 1 / N`, next/previous page controls, and no blank WebView. Confirm the presentation/evidence record is created only after the page appears.
6. Send a unique demo announcement from web, keep Team Messages focused on the phone for up to 30 seconds, verify arrival, unread/read state, and acknowledgement. Do not claim background push; only focused/foreground polling exists.
7. Submit a uniquely named demo doctor from mobile after server deploy, verify initial `SUBMITTED` request in web `/mtm/contacts`, approve it, and confirm the doctor plus workplace are synced to the requesting agent. Record where status is visible and the lack of a mobile request-history screen.
8. Repeat the full active-visit path on the phone: one client per route point, Presentation and Visit tasks as separate steps, checks appearing only on completed real steps, no legacy `Чек-лист` / `Следующее действие`, only configured REQUIRED photo/signature actions, and Finish visit. Recheck the `Изменить план` spacing/collision.
9. Browser-test product group and presentation creation in the admin after the PR 246 feedback fix, including an actual successful API save; prior verification covered code/tests but not a successful production browser creation.
10. Connect the real Wi-Fi tablet and repeat Today, calendar, clients/add-to-route, route/visit, presentation, and bottom/side navigation in portrait and landscape. Only a simulated 2560×1600 tablet viewport has passed; the physical tablet remains NOT RUN.

### Remaining UX risks, not release blockers already fixed

- Add defensive mobile deduplication by `point.id` plus a unit test for corrupted/legacy payloads; never deduplicate by `customerId`, because separate doctors in the same clinic are valid route points.
- Today currently normalizes away route-point contact detail and may show the same clinic name for two different doctors. Prefer the contact/person display name with the clinic as secondary context.
- Team Messages has no FCM/background notification pipeline, only 30-second focused polling and foreground refresh.
- New-doctor requests have no mobile history/status screen, and managers are not proactively pushed; they see the queue in `/mtm/contacts` on load/refresh.
