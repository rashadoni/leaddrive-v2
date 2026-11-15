-- «Пропустить — не учить» on «Где ИИ ответил бы иначе» (owner, 2026-11-15: «Да, добавь»): a person's
-- answer that is not the company's knowledge (a joke, a one-off) is set aside — not taught, and not
-- counted in the readiness figure either way. See lib/inbox/learning/model computeReadiness.
ALTER TABLE "inbox_learning_samples" DROP CONSTRAINT "inbox_learning_samples_resolution_check";
ALTER TABLE "inbox_learning_samples" ADD CONSTRAINT "inbox_learning_samples_resolution_check"
  CHECK ("resolution" IS NULL OR "resolution" IN ('accepted', 'taught', 'dismissed'));
