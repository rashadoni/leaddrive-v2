WITH encoded AS (
  SELECT
    CASE WHEN id IS NULL THEN 'n' ELSE 'x' || encode(convert_to(id::text, 'UTF8'), 'hex') END AS e1,
    CASE WHEN checksum IS NULL THEN 'n' ELSE 'x' || encode(convert_to(checksum::text, 'UTF8'), 'hex') END AS e2,
    CASE WHEN finished_at IS NULL THEN 'n' ELSE 'x' || encode(convert_to(to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8'), 'hex') END AS e3,
    CASE WHEN migration_name IS NULL THEN 'n' ELSE 'x' || encode(convert_to(migration_name::text, 'UTF8'), 'hex') END AS e4,
    CASE WHEN logs IS NULL THEN 'n' ELSE 'x' || encode(convert_to(logs::text, 'UTF8'), 'hex') END AS e5,
    CASE WHEN rolled_back_at IS NULL THEN 'n' ELSE 'x' || encode(convert_to(to_char(rolled_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8'), 'hex') END AS e6,
    CASE WHEN started_at IS NULL THEN 'n' ELSE 'x' || encode(convert_to(to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8'), 'hex') END AS e7,
    CASE WHEN applied_steps_count IS NULL THEN 'n' ELSE 'x' || encode(convert_to(applied_steps_count::text, 'UTF8'), 'hex') END AS e8
  FROM public._prisma_migrations
)
SELECT e1, e2, e3, e4, e5, e6, e7, e8
  FROM encoded
 ORDER BY e4, e1;
