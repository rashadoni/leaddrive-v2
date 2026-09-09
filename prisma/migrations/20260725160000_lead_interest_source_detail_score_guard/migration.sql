ALTER TABLE "leads"
ADD COLUMN "sourceDetail" TEXT,
ADD COLUMN "interest" TEXT;

UPDATE "leads"
SET "score" = GREATEST(0, LEAST(100, "score"))
WHERE "score" < 0 OR "score" > 100;

ALTER TABLE "leads"
ADD CONSTRAINT "leads_score_range_check"
CHECK ("score" >= 0 AND "score" <= 100);
