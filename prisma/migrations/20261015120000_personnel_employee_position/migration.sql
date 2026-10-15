-- Personnel → Employees → card (owner, 2026-10-15): the job title HR writes on
-- «Forma N-1t» and in every staff list. Nullable, no backfill: an empty title
-- reads as "not filled", never as a guess.
ALTER TABLE "mtm_agents" ADD COLUMN "position" VARCHAR(120);
