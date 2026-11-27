-- «Автоответы» (owner, 2026-11-27): a rule may hand the conversation to people after the
-- bot has answered. One person — to them; several — to whoever of them holds the fewest
-- open conversations. Bare user ids like assignedTo: checked against the organization
-- when the rule fires, never trusted from the row.
ALTER TABLE "chatbot_rules" ADD COLUMN "handoffUserIds" TEXT[] NOT NULL DEFAULT '{}';
