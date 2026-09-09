# Paid social scans — per-client daily run-count quota

Owner decision (2026-07-19). A client's paid social scans can be governed by a
**run-count quota** (scans per client per UTC day) instead of USD budgets, so the
account can be priced by "N scans/day" without managing dollar caps. USD budgets
remain fully supported and are now optional.

## What a "scan" is

One scan = one collector run that reserves a paid provider call. The quota counts
**distinct paid collector runs per client per UTC day**, covering both automatic
(scheduled) and manual (button) runs. Pre-dispatch failures that never reached
the provider are not counted. Later phases of an already-started scan (e.g. a
discovery run that then collects comments) do not consume extra quota — the scan
is counted once.

## How it is enforced

- Tenant policy field `dailyRunQuota` (0 = off / USD governs; 1..100 = quota).
- A tenant policy is enable-able by **valid USD budgets OR a valid quota**.
- `reservePaidRouteBudget` (the single chokepoint before any paid provider I/O,
  used by both automatic and manual runs) reads the quota, allows a **no-USD
  reservation** when a quota governs, and blocks with
  `paid_run_daily_quota_exhausted` once the day's distinct scans reach the quota.

## Cost safety without a USD budget

A run-count quota does not by itself bound money — but each run is bounded by the
existing **per-run technical caps** (`maxItems`, max pages, timeout, circuit
breaker, emergency stop), which are retained. So daily spend is bounded by
`quota × per-run item cap`. This matches the selective-discovery plan's rule to
keep technical controls when monetary caps are removed. Removing the per-run
technical caps is a separate, unapproved safety-lane change.

## Configure it (admin UI)

Social Monitoring → **Settings** → **Tenant paid-run authorization**:

1. Turn on **Allow manual paid runs**.
2. Set **Scans per day (client quota)** to the client's paid count (e.g. `3`).
   Leave the USD fields at `0` to run on quota alone (or set them too for an
   additional dollar backstop).
3. **Prepare emergency-stop release**, tick the confirmation, **Save**.

The panel shows **Used today: N of quota**.

## Frequency vs. quota

- **Frequency** (how often an automatic scan fires) is the source's cadence
  (`cadenceMinutes`): 1440 = once/day, 480 = three times/day.
- **Quota** is the hard daily cap on paid scans, counting automatic + manual.

Set cadence to the client's desired automatic frequency and the quota as the
hard ceiling.

## Prerequisites (server)

- The master paid-enforcement switch `SOCIAL_MONITORING_ENFORCE_USD_BUDGETS=1`
  must be set for **any** paid run (quota or USD). Without it, paid runs stay
  blocked (`paid_route_budget_enforcement_disabled`).
- For Bright Data (TikTok/Instagram/Facebook) a paid scan additionally needs live
  routing enabled and a verified capability proof — see
  `docs/BRIGHTDATA-TIKTOK-CANARY-RUNBOOK.md`.

## Manual runs under a quota

Both automatic scheduled scans and the manual **Run** button are governed by the
quota. When a tenant is quota-governed, clicking **Run** on a paid source shows a
quota confirmation (no USD cap field) with "Scans remaining today: N of quota",
and the run goes through the standard quota-gated path — no USD cap needed. The
manual run counts toward the same daily quota and is blocked by the tenant
emergency stop. USD budgets remain available for tenants that prefer dollar
caps, in which case the manual dialog collects a per-run USD cap as before.
