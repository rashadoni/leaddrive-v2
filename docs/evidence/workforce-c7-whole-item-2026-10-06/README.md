# WF-C7-007 whole-item runtime acceptance — 2026-10-06

Accepted runtime candidate: `d303ae3aac6a2ddb62439e433c08bca29c0befb9`, tree
`d0b39cd92c5078b22438bc7249cde9701843ee35`. The tested synthetic merge is
`b59a81751fa811d419f2056f21348ea695d6bb47`, with the same tree and parents
main `d2fd13aab5c85841ccab723dfc9d784ca7c7fb09` and the candidate.

[PR589](https://github.com/rashadoni/leaddrive-v2/pull/589) completes the existing
future-effective bulk schedule/site assignment contract: up to 200 named
employees, preview/conflict/no-change outcomes, reversible local drafts,
explicit atomic publication, safe exact retry and sensitive-scope reset.
General recurrence/temporary cover stays under C3-009.

## Current accepted evidence

- All 15 applicable GitHub Actions jobs pass for the exact runtime head,
  including the five required checks and hosted Linux production build.
- C7 run `37494712563`, artifact `11427323359`: 52 PostgreSQL/React tests pass
  with no skips; all 26 authenticated browser cases pass; all 24 rendered text
  contrast measurements pass, minimum 5.223162711549741:1. Actual native browser
  zoom is 200% in EN/RU/AZ; all 11 selected tables enforce FORCE RLS.
- Artifact ZIP SHA256:
  `ac1a180f8b77ea885b3145c566df71ec36b68c0b565b4d12fb3065fd719be780`.
  Exactly four minimized JSON originals were retrieved through the authorized
  connector and verified against source bytes. No raw CI logs or screenshots
  were read or retained for this acceptance.
- Independent exact-source review verifies all 8,810 blobs and 2,812 trees,
  preserves all incoming Support/MTM main changes, and reports no unresolved
  P0–P3 findings. Independent artifact review recomputes the contrast values
  and checks all 36 source bindings against the immutable Git manifest.

## Files and integrity

`prior-minimized-receipts.json` retains each original minimized receipt as an
exact UTF-8 string with its byte count and SHA256. Decode the `utf8` value to
recover the original bytes; verify before interpreting a receipt. This includes
negative attempts and predecessor-head evidence, the all-79 audit, current
source/artifact/CI verification and next-task dependency assessment.

`local-test-outcomes.json` contains minimized test case names/statuses/counts and
the original local report hashes. It deliberately excludes raw test diagnostics;
it is not a lossless archive of raw test output. Hosted acceptance JSON originals
are preserved losslessly in the first bundle.

`manifest.json` binds these bundle bytes and states the exact acceptance scope.
Prior accepted31d evidence at `095ef3ef4b0de33e0170aca2766555e5c28d5632` and every
one of its 9,255 archive blobs remain unchanged in this append-only successor.

## Qualifications and next work

The repository gates remain baseline-qualified: 18 known failing test files and
64 gated typecheck pairs are unchanged; scoped compilation retains six existing
TS7006 diagnostics. This does not claim a globally clean compiler or test suite.
Local PostgreSQL used two unrelated vector-column substitutions; the hosted
acceptance used the unmodified candidate pgvector schema with selected actual
migration guards. Neither proves complete historical migration replay.

6d0 browser overflow and fixture-classifier failures, 85fb's missing contrast
criterion, and local network/browser limitations remain explicit historical
evidence. Earlier green jobs are never substituted for current acceptance.

The next prepared non-overlapping whole item is C8-002 manager Today. Its actual
browser/AT requirement remains open. Linux AT-SPI groundwork is available and
isolated Orca execution is a plausible setup task, not a proven external blocker
or an invented human-only approval gate. No C8 status is changed here.

This is product/runtime acceptance, not merge, deployment, tenant activation,
production migration, real-data publication, credentials/grant/retention change,
physical-device, human-AT, full WCAG, 5,000-user, pilot or whole-HRM acceptance.
The separate documentation closure changes only C7-007 and its derived ledger:
83/161 done, 78 open, C7 80%, gates unchanged 14/15, rounded weighted total 60%.
See the candidate's bulk acceptance document and existing rollback runbook;
saved assignments, receipts, audits and pinned facts must be preserved.
