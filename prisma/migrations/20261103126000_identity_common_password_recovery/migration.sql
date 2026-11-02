BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE identity_phone_proofs ALTER COLUMN "issuedByUserId" DROP NOT NULL;
ALTER TABLE identity_phone_proofs DROP CONSTRAINT identity_proof_authority_shape;
ALTER TABLE identity_phone_proofs ADD CONSTRAINT identity_proof_authority_shape CHECK (
  ("contextVersion" = 1 AND "issuedByUserId" IS NOT NULL AND "contactRevision" IS NULL AND "issuerAuthority" IS NULL)
  OR ("contextVersion" IN (2,3) AND "contactRevision" IS NOT NULL AND "contactRevision" > 0
    AND "issuerAuthority" IS NOT NULL AND jsonb_typeof("issuerAuthority") = 'object'
    AND (("contextVersion" = 2 AND "issuedByUserId" IS NOT NULL) OR ("contextVersion" = 3 AND "issuedByUserId" IS NULL)))
);
ALTER TABLE identity_phone_proofs DROP CONSTRAINT identity_phone_proofs_delivery_context;
ALTER TABLE identity_phone_proofs ADD CONSTRAINT identity_phone_proofs_delivery_context CHECK (
  "deliveryCiphertext" IS NULL OR (
    "deliveryCiphertext" ~ '^v[123][.][A-Za-z0-9_-]{1,40}[.][A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{8}[.][A-Za-z0-9_-]{22}$'
    AND split_part("deliveryCiphertext", '.', 1) = 'v' || "contextVersion"::text
    AND split_part("deliveryCiphertext", '.', 2) = "keyId"
  )
);
CREATE OR REPLACE FUNCTION identity_guard_proof_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contextVersion" IS DISTINCT FROM OLD."contextVersion"
    OR NEW."contactRevision" IS DISTINCT FROM OLD."contactRevision"
    OR NEW."issuerAuthority" IS DISTINCT FROM OLD."issuerAuthority"
    OR (OLD."contextVersion" IN (2, 3) AND (
      NEW.id IS DISTINCT FROM OLD.id OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."issuedByUserId" IS DISTINCT FROM OLD."issuedByUserId"
      OR NEW."reservationId" IS DISTINCT FROM OLD."reservationId" OR NEW."normalizedPhone" IS DISTINCT FROM OLD."normalizedPhone"
      OR NEW."accountVersion" IS DISTINCT FROM OLD."accountVersion" OR NEW."credentialEpoch" IS DISTINCT FROM OLD."credentialEpoch"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
      OR NEW."keyId" IS DISTINCT FROM OLD."keyId" OR NEW."codeHash" IS DISTINCT FROM OLD."codeHash"
    )) THEN RAISE EXCEPTION 'IDENTITY_PROOF_AUTHORITY_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
ALTER TABLE identity_events DROP CONSTRAINT identity_events_action_check;
ALTER TABLE identity_events ADD CONSTRAINT identity_events_action_check CHECK (action IN (
  'ACCOUNT_STAGED','GRANT_CHANGED','PHONE_RESERVED','PHONE_CONFIRMED','PHONE_RELEASED','RESERVATION_EXPIRED',
  'PHONE_PROOF_ISSUED','PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED','PHONE_RESERVATION_CANCELLED',
  'CREDENTIAL_STAGED','ACTOR_BINDING_REVIEWED','MEMBERSHIP_CHANGED','PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED','ACCOUNT_ACTIVATED','RECOVERY_ISSUED','RECOVERY_CONFIRMED','CREDENTIAL_CHANGED'
));
ALTER TABLE identity_events ADD CONSTRAINT identity_recovery_receipt_complete CHECK (
  action NOT IN ('RECOVERY_ISSUED','RECOVERY_CONFIRMED','CREDENTIAL_CHANGED') OR (
    "proofId" IS NOT NULL AND "claimId" IS NOT NULL AND "credentialEpoch" IS NOT NULL AND "contactRevision" IS NOT NULL
    AND application IS NOT NULL AND application IN ('TIME','ROUTE_FIELD')
    AND ((action = 'RECOVERY_ISSUED' AND "actorUserId" IS NULL)
      OR (action <> 'RECOVERY_ISSUED' AND "actorUserId" = "userId" AND "actorUserId" IS NOT NULL))
  )
);
-- The foundation's anonymous-receipt guard intentionally excluded issuance.
-- Recovery requests have no authenticated issuer; never attribute them to the subject.
DO $$ DECLARE guard_name text; BEGIN
  SELECT conname INTO STRICT guard_name FROM pg_constraint
    WHERE conrelid='identity_events'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%actorUserId%PHONE_PROOF_REJECTED%';
  EXECUTE format('ALTER TABLE identity_events DROP CONSTRAINT %I', guard_name);
END $$;
ALTER TABLE identity_events ADD CONSTRAINT identity_event_actor_required CHECK (
  "actorUserId" IS NOT NULL OR action IN ('PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED',
    'PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED','RECOVERY_ISSUED')
);
CREATE UNIQUE INDEX identity_recovery_proof_receipt ON identity_events ("organizationId","proofId",action)
  WHERE action IN ('RECOVERY_CONFIRMED','CREDENTIAL_CHANGED');
CREATE INDEX identity_recovery_subject_created ON identity_phone_proofs ("organizationId","userId","createdAt" DESC,id)
  WHERE "contextVersion" = 3;
COMMIT;
