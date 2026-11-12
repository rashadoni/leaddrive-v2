-- A task message its author changed (Ulviyya, 2026-11-12: «komentdə yazılan mətn
-- redaktə olmur»; the owner: «Да, делай» to the mockup). Empty for every message
-- written before — none of them was edited.
ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
