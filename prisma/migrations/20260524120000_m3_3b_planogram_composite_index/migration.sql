-- M3-3b fix: add composite index to mtm_planograms for the hot-path query
-- runShelfAnalysis filters organizationId + customerCategory + isActive on every shelf analysis.
-- Without this index the query degrades to a full-table scan as planogram count grows.

CREATE INDEX IF NOT EXISTS "mtm_planograms_organizationId_customerCategory_isActive_idx"
  ON "mtm_planograms" ("organizationId", "customerCategory", "isActive");
