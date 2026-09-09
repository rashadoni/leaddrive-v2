# SwissMed MTM browser evidence

This runbook records reproducible browser evidence for the 18 SwissMed MTM
reference scenarios. Browser capture is read-only. An optional, separately
confirmed preparation step may upsert only visibly prefixed `[QA-SWISSMED]`
fixtures in the explicitly allowlisted acceptance tenant.

## Scope

The manual GitHub Actions workflow
.github/workflows/swissmed-mtm-browser-evidence.yml:

- signs in with secret-managed Admin/Manager and Agent test principals;
- opens all SWM-01 through SWM-18 modern routes;
- opens the planning matrix and the filter-led route builder without saving;
- resolves the first visible contact, organization and task for detail evidence;
- captures desktop, tablet and phone screenshots across bounded sequential runs;
- records HTTP status, final URL, page errors, console errors, heading count and
  document-level horizontal overflow;
- uploads report.json, summary.md and screenshots as a 30-day artifact.

The workflow is locked to `https://app.leaddrivecrm.org` and the current
`leaddrive` acceptance tenant so secret-managed credentials cannot be sent to
an arbitrary workflow input URL. It uses the repository's pinned SSH host key,
and fixture refresh refuses to run unless the deployed seed hash exactly
matches the reviewed workflow revision.

The runner performs one credentials callback and read-only page/API requests.
It does not save plans, transfer ownership, decide approvals, post promotions,
acknowledge messages or mutate tasks.

## Required repository secrets

- MTM_EVIDENCE_ADMIN_EMAIL
- MTM_EVIDENCE_ADMIN_PASSWORD
- MTM_EVIDENCE_AGENT_EMAIL
- MTM_EVIDENCE_AGENT_PASSWORD

The principals must belong to the tenant selected by the workflow
organization_slug input. Do not place credentials in this repository or in
workflow inputs.

## Run

Open GitHub Actions, select **SwissMed MTM Browser Evidence**, then choose one
role, one viewport and one scenario batch. Production deliberately rejects a
combined role, viewport or unbounded scenario selection. A complete pass is 12
sequential runs: `admin` and `agent`, each with `planning` and `records`, for
`desktop`, then `tablet`, then `phone`. Let production memory return to its
normal baseline between runs; never re-run an older historical job that still
contains the removed combined viewport option. Enable fixture refresh only
when the dedicated QA rows must be created or reset, and enter the exact
confirmation `leaddrive-swissmed-evidence`. The application origin preserves
the session tenant selected by the credentials provider.

The documented Mars credentials in clients/registry.json returned
CredentialsSignin on 2026-08-11. A production read-only Prisma query then
confirmed that the active `mars` tenant currently has zero CRM users and zero
MTM agents; the documented `demo@mars.leaddrivecrm.org` and
`farid@mars.leaddrivecrm.org` principals do not exist in the current database.
Restore safe test accounts or configure another test tenant before expecting a
green run.

On 2026-08-20 a production read-only check found that the historical `zeytun`
tenant no longer exists. The owner therefore selected the existing populated
`leaddrive` tenant for the current acceptance pass. The dedicated
`scripts/seeds/zeytunpharm-swissmed-evidence.mjs` fixture remains additive and
idempotent: it never creates or updates a tenant, never changes branding, and
only provisions exact dedicated QA principals plus visibly prefixed
`[QA-SWISSMED]` MTM records required by the read-only evidence runner. The
historical `zeytun` target remains explicitly allowlisted for reproducibility;
no other tenant can be supplied dynamically.
Run it from the deployed standalone root so it resolves the Prisma client that
was generated from the exact production schema, rather than a potentially
stale development client in the repository root.

The current fixture requires the tenant-bound confirmation
`CONFIRM_PROD=leaddrive-swissmed-evidence`, the exact
`qa.swissmed.admin@leaddrivecrm.org` and
`qa.swissmed.agent@leaddrivecrm.org` principals, and
`MTM_EVIDENCE_PASSWORD` from the secret manager. The supplied password must
pass the shared application policy and the fixture's stronger 24-character
minimum. It is never printed; refreshing either CRM principal also advances
`passwordChangedAt`, invalidating older CRM sessions.

## Deployment checkpoint

The runner was merged by PR #816. The Zeytun fixture and workflow defaults were
merged by PR #822, and the standalone Prisma resolution repair by PR #824. The
production release workflow `31530753524` completed its quality, security,
MTM/auth/i18n, build, deploy and smoke jobs successfully at
`bf85b881e3d6aa8acfb09fb818e5ce77b1b4a5a3`; that release contains the fixture
implementation. The repaired operator script was then installed with a
matching SHA-256 and the tenant-locked, additive seed completed successfully.

At the historical Zeytun checkpoint, repository secrets pointed to two
dedicated active Zeytun QA principals. Read-only production verification found
3 QA organizations, 2 QA contacts, 1 route, 3 route points, 1 visit, 1 task and
3 GPS locations. Existing non-QA rows were not updated. That historical state
must not be mistaken for the current tenant inventory.

The first diagnostic workflow `31533466798` used
`https://zeytunpharm.leaddrivecrm.org` and correctly failed: middleware compared
the hostname slug `zeytunpharm` with the authenticated production tenant slug
`zeytun` and redirected every scenario to `cross-tenant`. Those login-page
screenshots are not acceptance evidence. Renaming the production tenant or
weakening tenant binding was deliberately avoided.

The first authoritative workflow `31533815696` used
`https://app.leaddrivecrm.org` with organization slug `zeytun`. The current
runner at that checkpoint marked all 84 permitted role-by-viewport route/layout checks as passed:
54 Admin results and 30 Agent results, split evenly into 28 desktop, 28 tablet
and 28 phone-viewport results. It recorded no login redirects, main-document
HTTP errors, page exceptions or document-level horizontal overflow. Visual
inspection confirmed real authenticated Zeytun screens containing the
dedicated QA doctor, pharmacy, task, route and GPS fixtures.

That checkpoint was not an 84/84 functional acceptance claim. The report retained one
console error: the Agent phone rendering of SWM-10 logged a `502` subresource
response, and its screenshot showed the history filter shell without a loaded
GPS result. Several paired scenarios also share one page and currently capture
the same default state (notably SWM-03/04 and SWM-10/11). The next runner
checkpoint must fail on same-origin 4xx/5xx responses and open the distinct
scoring/replay/transfer states before those actions can be represented as
scenario-specific evidence.

The superseding scenario-specific workflow `31548934762` ran the evidence
runner at `3c101f17da935c9007c2c2ed38128b307600bbf2` against deployed production
SHA `b1f7180269271181cec7ff27462b54dc2a9b78d9`. All 84 checks passed: 54 Admin,
30 Agent, and 28 checks for each desktop/tablet/phone viewport. The report
contains zero blocking same-origin HTTP errors, page errors, console errors,
login redirects and document-level horizontal overflow. It also contains zero
CSP telemetry errors for this run.

The runner now opens the required SWM-02 transfer, SWM-04 scoring, SWM-10
history, SWM-11 replay and SWM-15 coverage states. Screenshot hashes confirm
that SWM-02/05, SWM-03/04, SWM-10/11 and SWM-15/17 are distinct in every
applicable role and viewport. Only the exact
`POST /api/v1/public/csp-report` fire-and-forget telemetry sink is recorded as
non-blocking telemetry; all other same-origin 4xx/5xx responses still fail the
scenario.

The artifact contains `report.json` and all screenshots with 30-day GitHub
retention. A persistent package with 84 PNG files and desktop/tablet/phone
contact sheets is kept in the Codex visualization workspace under
`zeytun-swissmed-scenario-evidence-2026-08-12`.

## Interpretation

- passed means the authenticated route rendered in that role and viewport,
  produced no page exception or document-level horizontal overflow, and left a
  screenshot.
- blocked means authentication or a required demo contact/organization/task
  fixture was absent.
- failed means the route redirected to login, returned an error, raised a page
  exception, overflowed the viewport, or its required interactive state could
  not be reached.

A green browser run is only web/tablet visual evidence. It does not approve
missing SwissMed formulas, dictionaries or policies, and it does not replace a
physical Android offline/restart test.

The run also makes product-rule gaps visible rather than hiding them. For
example, SWM-09 blocks point accrual when the policy is unknown or unsigned,
and SWM-18 does not populate the contact-by-date matrix until a signed coverage
snapshot has passed validation. These are expected `BLOCKED` product gates,
not browser-rendering failures.
