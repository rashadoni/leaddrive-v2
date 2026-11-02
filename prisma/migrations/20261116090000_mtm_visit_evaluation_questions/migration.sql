-- MTM joint visit: every company rates its agents by its own list of
-- questions (owner, 2026-10-21: «Да, в параметрах MTM»). The list lives in
-- the MTM setting `visitEvaluationQuestions`; every rating keeps a copy of the
-- list it was given against, ids and texts, so renaming or deleting a question
-- later changes no rating already given.
--
-- Additive: a nullable column, no backfill. A rating saved before this
-- migration keeps NULL and is read against the original six questions
-- (MTM_VISIT_EVALUATION_ORIGINAL_QUESTIONS in
-- src/lib/mtm/visit-evaluation-questions.ts), which is exactly what it was
-- given against. The table's row-level security is untouched.
ALTER TABLE "mtm_visit_evaluations" ADD COLUMN "questions" JSONB;

ALTER TABLE "mtm_visit_evaluations"
  ADD CONSTRAINT "mtm_visit_evaluations_questions_check"
  CHECK ("questions" IS NULL OR jsonb_typeof("questions") = 'array');
