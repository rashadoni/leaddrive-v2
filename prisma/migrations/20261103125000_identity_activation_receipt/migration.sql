BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE identity_events ADD COLUMN "activationArtifactSha" VARCHAR(40)
  CHECK ("activationArtifactSha" IS NULL OR "activationArtifactSha" ~ '^[a-f0-9]{40}$');
ALTER TABLE identity_events DROP CONSTRAINT identity_events_action_check;
ALTER TABLE identity_events ADD CONSTRAINT identity_events_action_check CHECK (action IN (
  'ACCOUNT_STAGED','GRANT_CHANGED','PHONE_RESERVED','PHONE_CONFIRMED','PHONE_RELEASED','RESERVATION_EXPIRED',
  'PHONE_PROOF_ISSUED','PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED','PHONE_RESERVATION_CANCELLED',
  'CREDENTIAL_STAGED','ACTOR_BINDING_REVIEWED','MEMBERSHIP_CHANGED','PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED','ACCOUNT_ACTIVATED'
));
ALTER TABLE identity_events ADD CONSTRAINT identity_activation_receipt_complete CHECK (
  action <> 'ACCOUNT_ACTIVATED' OR ("actorUserId" IS NOT NULL AND "proofId" IS NOT NULL AND "claimId" IS NOT NULL
    AND "credentialEpoch" IS NOT NULL AND "contactRevision" IS NOT NULL AND "reviewReference" IS NOT NULL
    AND "activationArtifactSha" IS NOT NULL)
);
COMMIT;
