-- H2 follow-up: widen agent_steps.kind CHECK constraint to include 'ask'.
-- The Atlas PlanDecision variant `ask` (agent pauses for user clarification)
-- needs to be persistable as a step rather than synthesised via respond+
-- deferred. Architect-flagged H1↔H2 schema coherence gap.

ALTER TABLE "agent_steps" DROP CONSTRAINT "agent_steps_kind_check";
ALTER TABLE "agent_steps"
    ADD CONSTRAINT "agent_steps_kind_check"
    CHECK ("kind" IN ('observe', 'think', 'act', 'respond', 'ask'));
