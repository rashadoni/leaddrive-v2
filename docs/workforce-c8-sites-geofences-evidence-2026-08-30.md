# Workforce C8 — sites and geofence configuration evidence

> **Status:** `WF-C8-006` completed as a tenant-administrator web slice.
> **Recorded:** 2026-08-30
> **Scope:** named Workforce sites, future-effective calibrated circle
> revisions and a non-surveillance impact preview. This is not employee
> location collection, a live map, or a physical-location assurance claim.

## Safe configuration path

The Workforce configuration workbench now lets a tenant administrator create a
named Workforce site with code, site type, IANA timezone, optional address
label and optional responsible team. It uses the independent
`/api/v1/workforce/configuration/sites` boundary, not a Route or customer
location endpoint.

For an active selected site, the same workbench schedules a circle revision
with a future effective date, latitude, longitude, radius and calibration
reference. The browser validates the v1 bounded-circle contract before sending
it: latitude `-90..90`, longitude `-180..180`, integer radius `25..5000m`, and
a non-empty calibration reference. The server remains authoritative: it is the
existing tenant-admin session boundary that rejects past dates and invalid or
archived sites, appends a revision, closes only the previous prospective
window, and writes an audit that excludes raw coordinates and the calibration
reference.

The optional **Open map pin** link is a deliberate administrator preview of the
entered or revisioned site coordinate in OpenStreetMap. It does not request
`navigator.geolocation`, send employee location, render a live employee map or
turn a map click into attendance evidence.

## Impact and history safeguards

Before scheduling a revision, the page counts and names only the existing
Workforce site assignments active for the selected effective date. It explicitly
states that the preview does not reevaluate recorded attendance or expose
employee location. The revision history displays effective ranges and the
bounded-circle version for the selected site, so a prospective correction is
not presented as a rewrite of earlier attendance facts.

This is an administrator configuration path. It is separate from the ordinary
scheduler/site-assignment experience and from Route & Field. It does not decide
attendance, establish physical presence, or activate background collection.
Those future proof-policy and legal-gate requirements remain C4/C5/C10/C14
work.

## Checks

- `PASS` — 25 focused tests across the Workforce site/geofence API and domain
  management, named configuration UI contract and existing assignment UI
  contract.
- `PASS` — targeted ESLint for the modified workbench and UI contract test.
- `PASS` — `npm run i18n:check`: EN/RU/AZ parity (21,159 leaf keys).
- `PASS` — `git diff --check`.
- `NOT RUN` — browser E2E/visual calibration evidence, desktop/tablet/phone at
  200% zoom, full build, real site calibration, GPS/QR/device physical flows,
  load and staging migration checks. These require the approved CI/heavy or
  physical environments and remain release/pilot gates.
