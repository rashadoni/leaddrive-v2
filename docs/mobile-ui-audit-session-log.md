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
