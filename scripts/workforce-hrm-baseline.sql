\set ON_ERROR_STOP on

-- H0 Workforce/HRM baseline collector.
--
-- Usage (read-only database role):
--   psql "$DATABASE_URL" \
--     --set=organization_id='org-id' \
--     --set=window_days='30' \
--     --file=scripts/workforce-hrm-baseline.sql
--
-- This script never changes data. API response latency and mobile outbox age
-- are intentionally absent: they must come from ingress/application metrics
-- and device sync telemetry, not be guessed from database timestamps.

\if :{?organization_id}
\else
  \echo 'organization_id is required'
  \quit 2
\endif

\if :{?window_days}
\else
  \set window_days '30'
\endif

BEGIN TRANSACTION READ ONLY;

WITH parameters AS (
  SELECT
    :'organization_id'::text AS organization_id,
    GREATEST(1, :'window_days'::integer) AS window_days,
    now() AS captured_at
),
active_agents AS (
  SELECT count(*)::bigint AS count
  FROM mtm_agents, parameters
  WHERE "organizationId" = parameters.organization_id
    AND status = 'ACTIVE'
),
window_events AS (
  SELECT event."occurredAt"
  FROM mtm_agent_workday_events AS event, parameters
  WHERE event."organizationId" = parameters.organization_id
    AND event."occurredAt" >= parameters.captured_at - make_interval(days => parameters.window_days)
),
daily_events AS (
  SELECT "occurredAt"::date AS event_day, count(*)::bigint AS event_count
  FROM window_events
  GROUP BY "occurredAt"::date
),
open_previous_workdays AS (
  SELECT count(*)::bigint AS count
  FROM mtm_agent_workdays, parameters
  WHERE "organizationId" = parameters.organization_id
    AND status IN ('STARTED', 'PAUSED')
    AND "workDate" < CURRENT_DATE
),
pending_requests AS (
  SELECT count(*)::bigint AS count
  FROM mtm_hrm_requests, parameters
  WHERE "organizationId" = parameters.organization_id
    AND status = 'PENDING'
)
SELECT
  parameters.organization_id,
  parameters.captured_at,
  parameters.window_days,
  active_agents.count AS active_agents,
  COALESCE((SELECT sum(event_count) FROM daily_events), 0)::bigint AS events_in_window,
  COALESCE((SELECT round(avg(event_count)::numeric, 2) FROM daily_events), 0) AS average_events_per_active_day,
  COALESCE((SELECT max(event_count) FROM daily_events), 0)::bigint AS peak_events_per_utc_day,
  open_previous_workdays.count AS open_previous_workdays,
  pending_requests.count AS pending_hrm_requests
FROM parameters
CROSS JOIN active_agents
CROSS JOIN open_previous_workdays
CROSS JOIN pending_requests;

-- Diagnostic only: createdAt - occurredAt includes offline delay and queueing,
-- so it must not be reported as HTTP/API response latency.
WITH parameters AS (
  SELECT
    :'organization_id'::text AS organization_id,
    GREATEST(1, :'window_days'::integer) AS window_days,
    now() AS captured_at
),
event_lag AS (
  SELECT GREATEST(0, EXTRACT(EPOCH FROM (event."createdAt" - event."occurredAt"))) AS seconds
  FROM mtm_agent_workday_events AS event, parameters
  WHERE event."organizationId" = parameters.organization_id
    AND event."createdAt" >= parameters.captured_at - make_interval(days => parameters.window_days)
)
SELECT
  count(*)::bigint AS measured_events,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY seconds)::numeric, 3) AS event_persist_lag_p50_seconds,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY seconds)::numeric, 3) AS event_persist_lag_p95_seconds,
  round(max(seconds)::numeric, 3) AS event_persist_lag_max_seconds
FROM event_lag;

ROLLBACK;
