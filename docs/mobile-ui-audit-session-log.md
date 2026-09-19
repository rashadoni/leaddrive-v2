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
