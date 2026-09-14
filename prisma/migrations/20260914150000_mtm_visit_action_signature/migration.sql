-- Customer signature as a visit action (owner request 2026-09-14): an agent
-- collects a finger-drawn signature on the tablet; a visit policy decides
-- whether it is hidden, optional or required. Additive enum value only.
ALTER TYPE "MtmVisitActionKey" ADD VALUE IF NOT EXISTS 'SIGNATURE';
