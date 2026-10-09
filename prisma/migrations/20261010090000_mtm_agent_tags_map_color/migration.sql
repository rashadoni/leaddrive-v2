-- Labels («метки») and a personal map colour on an employee's card. A manager
-- sets both on the web; the live map's list shows, filters and searches by the
-- labels, and the employee's marker carries a ring of the colour. They are the
-- managers' own notes: read by managers at a browser only — never by a phone,
-- an integration key, or the employee himself under his own login
-- (src/lib/mtm/agent-tags.ts holds the rules).
--
-- Additive and without a backfill: every existing employee starts with no
-- labels (the empty array) and no colour (NULL), which is exactly how the map
-- looked before. "mapColor" holds a key of the fixed palette in the code, not
-- a hex, so there is nothing here for the database to check. The table's
-- FORCE RLS policy already covers new columns; it is not touched here.
--
-- Both columns are filled by the database when a row is inserted without them,
-- so the previous build, which does not know them, keeps creating employees
-- while the new one is being rolled out.

SET lock_timeout = '3s';

ALTER TABLE "mtm_agents"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "mapColor" TEXT;

-- Rollback is forward-safe: roll back the application code and keep the
-- columns. Removing them would discard the labels and colours managers set.
