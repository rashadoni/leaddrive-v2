# Post-Resolution Survey Catch-up Cron

**Endpoint:** `POST /api/cron/post-resolution-survey`
**Auth:** `x-cron-secret: $CRON_SECRET` header

## Purpose

Safety net for B9 CSAT/NPS auto-surveys. The immediate path
(`triggerSurveysOnTicketResolved` in `src/lib/survey-triggers.ts`) fires
synchronously on ticket→resolved transition. When that primary attempt
fails (SMTP outage, WhatsApp 5xx, transient DB error), this cron picks
up the missed invites in a short window.

## Required cron frequency: **hourly**

> ⚠️ **Operational invariant** — schedule this endpoint **every hour, never
> longer**. The handler relies on its lookback window (default 2h) being
> ≤ 2× the cron interval to guarantee at-most-one duplicate invite per
> ticket per run boundary.

Skewing the cron longer than the lookback window means tickets in the
gap go un-resurveyed; skewing it shorter means the same ticket is
surveyed in two consecutive runs.

Slice 2 will add a `SurveyInvite` log model and lift this invariant.

## Window logic

For each scan at time `T`:
- Lower bound: `T - lookbackHours` (default 2h)
- Upper bound: `T - minAgeMinutes` (default 30min)

Tickets resolved within `[T - 2h, T - 30min]` are eligible. The 30-minute
freshness margin gives the immediate path time to either succeed or fail
visibly before catch-up runs.

## Throttle

The handler skips a ticket when:
- A `SurveyResponse` exists for `(survey, ticket)` — customer already replied
- The contact's email or phone appears in any `SurveyResponse` from this
  org in the last 30 days — "recently responded" suppression

Until slice 2's `SurveyInvite` log lands, the handler **cannot** suppress
based on prior unanswered invites — only based on prior responses. This
is documented in the handler docstring.

## Tuning

`lookbackHours` / `minAgeMinutes` / `suppressionDays` are handler-signature
parameters today; slice 2 exposes them as query-string overrides for
on-demand catch-up after a known outage.
