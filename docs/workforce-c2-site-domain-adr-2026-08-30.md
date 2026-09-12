# ADR — Workforce sites, zones and multi-branch segments

> **Status:** accepted vocabulary/compatibility boundary for `WF-C2-001` and
> `WF-C2-011`; no tenant site, geofence or employee location monitoring is
> activated by this ADR.
> **Recorded:** 2026-08-30T01:15:00+02:00

## Context

LeadDrive Workforce must express a scheduled day that can move from one branch
to another without turning those movements into Route customer visits or
creating a second workday. A site/geofence is evidence configuration, not an
identity claim and not an automatic payroll or disciplinary decision.

## Vocabulary

| Canonical term | AZ | RU | Meaning / boundary |
|---|---|---|---|
| Site | İş yeri | Рабочая площадка | Tenant-owned expected place or declared work context; never a Route customer. |
| Area | Zona | Зона | A named sub-area of a Site, reserved for a later controlled extension; not v1 geometry. |
| Segment | İş seqmenti | Рабочий сегмент | Ordered planned portion of one workday, with mode/site/window/proof policy. |
| Office | Ofis | Офис | A regular administrative work site. |
| Warehouse | Anbar | Склад | A logistics/warehouse work site. |
| Temporary site | Müvəqqəti iş yeri | Временная площадка | A time-bounded site created by an accountable administrator. |
| Customer site | Müştəri məkanı | Площадка клиента | An HR-declared work site, separate from Route customer data. |
| Home/Remote | Ev/Uzaqdan | Дом/Удалённо | A declared working mode; it does not imply continuous home tracking. |
| Field | Sahə | Полевая работа | A declared non-site mode; route/visit facts remain separate. |
| Travel | Səfər | Перемещение | A transition segment whose paid/expected treatment is not inferred. |
| On-call | Növbətçilik | Дежурство | Availability context, not an attendance location claim. |
| Exception | İstisna | Исключение | A reviewable deviation with an accountable HR decision. |

## Decisions

1. `WorkforceSite` and all associated evidence remain tenant-scoped Workforce
   records. They have no foreign key, lookup or fallback to `MtmCustomer`,
   `MtmRoute` or Route customer geofences.
2. A workday is a single employee-day ledger. It may have multiple ordered
   segments (`09:00–13:00 Office A`, `14:00–18:00 Office B`) and explicit
   transition facts. The later site/segment snapshot—not the current live
   site—is what historical review reads.
3. V1 geometry is a validated **circle** only. A circle is a presence-evidence
   boundary, not proof of a human identity, and cannot by itself approve a
   timesheet or discipline an employee.
4. V1 supports site code/name/timezone/address label/status/responsible scope;
   `Home/Remote`, `Field`, `Travel` and `On-call` can be modes without an exact
   continuously tracked coordinate.
5. No raw GPS point is copied into site configuration, audits or general
   reports. C4 will separately evaluate redacted evidence against a snapshotted
   revision and preserve a reason/verdict after raw retention expires.
6. Travel compensation, expected duration, late grace and who can alter an
   inter-site segment remain `OD-09`. C2 may model a `Travel` segment but must
   not calculate payable time or silently rewrite an expected schedule.

## Calibration starting standard (not physical evidence)

The reversible technical default for a future circle validator is **25–5,000
meters** and a submitted GPS measurement with reported accuracy no worse than
**100 meters**. Before an active employee policy uses a site, HR must retain a
site-local calibration reference, document the intended entrance/working area
and test the boundary with representative devices. That physical procedure,
tenant policy and legal notice are still open; this ADR neither claims nor
substitutes their evidence.

## Compatibility and extension boundary

The first schema stores the geometry kind, revision identity and canonical
circle parameters separately from future geometry payloads. `POLYGON`,
multiple entrances, indoor floor plans, beacon/badge zones and large-campus
rules require a new versioned geometry type, validation, snapshot and test
matrix. No v1 parser treats a polygon-like object as a circle or silently
approximates it.

## Consequences

- C2 implementation adds independent Workforce tables, APIs and tenant/RLS
  checks; it does not alter Route visit behavior.
- Effective-dated site eligibility and shift segments must resolve from their
  historical assignment/configuration records, not an employee's current
  team/site after an offline upload.
- C2 cannot leave its gate green until those schemas, validation, snapshots
  and multi-site timeline tests exist. This ADR completes terminology and the
  v1/future-geometry boundary only.
