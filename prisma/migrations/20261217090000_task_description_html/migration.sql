-- The task's description with its formatting (bold, italic, underline, lists) — Zeytun, 2026-11-13:
-- «в тасках включите функцию жирный шрифт как в бордио». `description` stays the plain text every
-- other reader uses (search, lists, exports, subtasks from a list); this column holds the cleaned
-- HTML of the same text and is NULL when the text has no formatting.
ALTER TABLE "tasks" ADD COLUMN "descriptionHtml" TEXT;
