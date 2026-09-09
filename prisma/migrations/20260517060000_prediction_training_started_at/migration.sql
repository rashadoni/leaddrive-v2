-- H3 follow-up — `trainingStartedAt` enables a stale-lock sweeper for
-- prediction models stuck in "training" after a route crash or timeout.

ALTER TABLE "prediction_models" ADD COLUMN "trainingStartedAt" TIMESTAMP(3);
