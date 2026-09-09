# MTM Routes Phase 1 — production pilot evidence

**Run date:** 2026-07-15

**Tenant:** `zeytun`

**Environment:** production API and database, production manager UI, sanitized demo workbook
**Technical result:** PASS for every autonomous software gate listed below

This run used names prefixed with `[PILOT-PHASE1-20260715]`, dedicated pilot
agents, and idempotent operation IDs. It did not use real customer data.

## Gate summary

| Gate | Result | Production evidence |
| --- | --- | --- |
| Route planning and multi-agent assignment | PASS | Production route `cmrl6b9ok01q550l9xdo2f0c8` was created with a primary agent and a participant from different teams. |
| Exact route duplicate prevention | PASS | An identical production route was rejected by the duplicate guard and surfaced in the manager UI. |
| Required-action checkout guard | PASS | Visit `cmrl6dj4601qy50l9b1iv8inr` could not close before `PRESENTATION` and `NEXT_ACTION`; explicit checkout then succeeded. |
| Visit never auto-closes | PASS | The visit remained `CHECKED_IN` after required actions and changed state only on explicit checkout. |
| Retry idempotency | PASS | Repeated action and checkout operation IDs returned the existing result instead of creating duplicates. |
| NEXT_ACTION reminder | PASS | One reminder was created for the visit; replay did not create a second reminder. |
| Published stop removal | PASS | Request `cmrl6gc0b01rp50l9wr8tnky9` was approved in the manager UI; the stop was soft-deleted and route total became two. |
| Mobile new-customer request | PASS | An authenticated mobile-agent JWT submitted request `cmrl6hwue01rz50l9h0j7uckh` through the mobile-compatible API. |
| Manager customer approval | PASS | The manager approved the request in the production UI and customer `cmrl6irtc01s950l99ujf7xyf` was created. |
| Exact customer duplicate prevention | PASS | Request `cmrl6jg6y01sp50l9llxks7x6` matched code and phone, approval was blocked, and rejection was saved. |
| Excel preview/apply/replay | PASS | Job `cmrlmg0ex0dwc50l9auo3mg4k`: 1 create, 1 update, 1 unchanged, 0 errors; apply replay and upload reuse both returned true. |
| Excel invalid-row protection | PASS | Job `cmrlmg0o70dwk50l9lkjqvpeu`: one invalid row, three actionable errors, apply rejected with HTTP 409. |
| Excel export and error workbook | PASS | Both files reopened successfully; export preserved text code `000P10715`. |
| Temporary Excel credential cleanup | PASS | The 15-minute one-shot API key was deleted in `finally`; zero pilot one-shot keys remained. |
| Tenant and PII safety checks | PASS | RLS gap scan reported 0 gaps; PII-column lint reported all 61 encrypted columns clear. |

## Request sources and mobile flow

New-customer requests have one server contract and two presentation surfaces:

1. The field application submits from the route screen with an authenticated
   MTM agent token. The current APK contains the compatibility endpoint
   `/customer-create-request`, duplicate candidates, and idempotent create
   operation IDs.
2. The responsive web panel uses `/customer-create-requests` and is suitable for
   phone-sized browsers. It shows essential fields first, puts optional fields
   behind progressive disclosure, can capture current coordinates, and tracks
   the manager decision.
3. The manager queue compares the request to existing customers. Exact code or
   phone matches disable approval; the manager can ask for details or reject
   with a required note.

Both endpoint spellings resolve to the same organization-scoped implementation,
so an old field build and the current web client follow the same duplicate and
approval rules.

## Demo workbook

The sanitized workbook is committed at
`docs/pilot-artifacts/mtm-phase1-customers-demo.xlsx`. It uses the official
`CUSTOMERS` template version `1.0` and contains only synthetic records:

| External code | Expected operation | Purpose |
| --- | --- | --- |
| `000P10715` | CREATE | Verifies identifiers with leading zeroes remain text. |
| `P1-20260715-P01` | UPDATE | Verifies preview and update of an existing customer. |
| `P1-20260715-D01` | UNCHANGED | Verifies matching data does not create an unnecessary write. |

The companion invalid workbook is generated on demand and verifies missing
name, invalid object type, and latitude outside `-90..90`.

## UI correction

The customer approval queue now prioritizes the decision instead of presenting
an unstructured record dump:

- pending count and a clear empty state;
- labelled requester, route, code, phone, address, and reason;
- side-by-side duplicate candidates with match score and reasons;
- explicit outcomes: approve and create, ask agent for details, reject;
- approval disabled for exact duplicates and notes required for return/reject;
- responsive stacking and accessible labels for smaller screens.

The agent form now uses a three-part visual flow: customer, location, reason.
Required fields stay visible, optional CRM details are collapsed, and the
request history explains what happens after submission.

## Automated verification

| Check | Result |
| --- | --- |
| MTM Phase 1 Vitest coverage | PASS — 50 files, 519 passed, 1 todo |
| Translation parity | PASS — EN 16,228 keys; RU/AZ missing 0, extra 0 |
| Translation JSON parse | PASS |
| Prisma validate and generate | PASS |
| RLS organization-context scan | PASS — 408 scoped models, 513 helpers, 0 gaps |
| PII-column lint | PASS — 61 encrypted columns across 19 routes |
| TypeScript | PASS with `NODE_OPTIONS=--max-old-space-size=8192` |
| Production build | PASS — Next.js 16 webpack build with an ephemeral local build secret |
| Post-deploy browser smoke | Recorded after final deployment |

## Android artifact boundary

The current supplied artifact is
`/Users/rashadrahimov/Desktop/LeadDrive-Field-1.3.4-phase1.apk`.

| Property | Verified value |
| --- | --- |
| Size | 62,924,160 bytes |
| SHA-256 | `69a89a3eb6aab3edea8ad2171601f7667373a94e0581b290262305a773960843` |
| ZIP integrity | PASS |
| Native ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| Production API URL in bundle | `https://app.leaddrivecrm.org/api/v1/mtm` |
| Customer request contract in bundle | PASS |

A fresh device installation is not claimed: this Mac currently has no Android
SDK, `adb`, emulator, or attached Android device. The APK contract and the
production mobile API mutation were verified, but a physical offline-to-online
transition and human usability sign-off remain external acceptance activities,
not unfinished server or web implementation.

## Release boundary

All autonomous Phase 1 implementation and production technical gates are
closed. Rollout approval still requires two observations that software cannot
manufacture: a pilot user completing the daily flow on a physical device and
that user signing off on usability. These are intentionally reported as
external acceptance rather than marked as passed without evidence.
