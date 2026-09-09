-- D8 Loyalty auto-earn idempotency anchor.
-- One 'earn' transaction per (organizationId, referenceId): if an event
-- (invoice-paid / deal-won / …) double-fires, the second insert is rejected
-- so a member can't be double-awarded for the same source row.
-- PARTIAL (referenceId IS NOT NULL): the many manual / null-reference earn
-- rows stay unconstrained. Mirrors the payment_intents externalRef partial-
-- unique pattern. referenceId is NULL on every existing row today, so this
-- index builds trivially.
CREATE UNIQUE INDEX "loyalty_txn_org_type_ref_uniq"
  ON "loyalty_transactions" ("organizationId", "type", "referenceId")
  WHERE "referenceId" IS NOT NULL;
