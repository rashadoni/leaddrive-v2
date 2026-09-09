-- Allow sub-hour SLAs: store first-response / resolution as decimal hours (e.g. 0.5 = 30 min).
-- Int → double precision is a widening, lossless change; existing integer hours are preserved.
ALTER TABLE "sla_policies" ALTER COLUMN "firstResponseHours" SET DATA TYPE DOUBLE PRECISION;
ALTER TABLE "sla_policies" ALTER COLUMN "resolutionHours" SET DATA TYPE DOUBLE PRECISION;
