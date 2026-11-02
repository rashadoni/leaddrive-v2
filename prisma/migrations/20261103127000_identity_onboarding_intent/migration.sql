-- Empty reviewed-intent store; no person, phone, permission or credential is migrated.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE identity_onboarding_intents (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
 "issuedByUserId" TEXT NOT NULL, "issuerAuthority" JSONB NOT NULL CHECK (jsonb_typeof("issuerAuthority")='object'),
 "normalizedPhone" VARCHAR(16) NOT NULL CHECK ("normalizedPhone" ~ '^\+[1-9][0-9]{6,14}$'),
 application VARCHAR(16) NOT NULL CHECK (application IN ('TIME','ROUTE_FIELD')),
 applications JSONB NOT NULL CHECK (jsonb_typeof(applications)='array' AND jsonb_array_length(applications) BETWEEN 1 AND 3),
 "accountVersion" INTEGER NOT NULL CHECK ("accountVersion">0),
 "credentialEpoch" INTEGER NOT NULL CHECK ("credentialEpoch">0),
 "contactRevision" INTEGER NOT NULL CHECK ("contactRevision">0),
 "requestId" VARCHAR(128) NOT NULL CHECK (length("requestId")>0),
 "requestHash" VARCHAR(64) NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
 "reviewReference" VARCHAR(128) NOT NULL CHECK (length("reviewReference")>0),
 status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED','EXPIRED')),
 "currentProofId" TEXT,
 "issuedAccountVersion" INTEGER NOT NULL CHECK ("issuedAccountVersion">0),
 "issuedCredentialEpoch" INTEGER NOT NULL CHECK ("issuedCredentialEpoch">0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "completedAt" TIMESTAMPTZ(3),
 CHECK ("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '7 days'),
 CHECK ((status='COMPLETED')=("completedAt" IS NOT NULL)),
 CHECK ("issuedAccountVersion">="accountVersion" AND "issuedCredentialEpoch">="credentialEpoch"),
 CONSTRAINT identity_onboarding_intents_subject_key UNIQUE ("organizationId","userId",id),
 FOREIGN KEY ("organizationId","userId") REFERENCES identity_accounts("organizationId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("organizationId","issuedByUserId") REFERENCES users("organizationId",id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX identity_onboarding_request_key ON identity_onboarding_intents ("organizationId","requestId");
CREATE INDEX identity_onboarding_phone_status_idx ON identity_onboarding_intents ("organizationId","normalizedPhone",status);
CREATE UNIQUE INDEX identity_onboarding_one_active_person ON identity_onboarding_intents ("organizationId","userId") WHERE status='ACTIVE';
CREATE UNIQUE INDEX identity_onboarding_one_active_phone ON identity_onboarding_intents ("organizationId","normalizedPhone") WHERE status='ACTIVE';
ALTER TABLE identity_phone_proofs ADD COLUMN "onboardingIntentId" TEXT;
ALTER TABLE identity_phone_proofs ADD CONSTRAINT identity_proof_onboarding_subject FOREIGN KEY ("organizationId","userId","onboardingIntentId")
 REFERENCES identity_onboarding_intents("organizationId","userId",id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE identity_phone_proofs ADD CONSTRAINT identity_proof_onboarding_context CHECK ("onboardingIntentId" IS NULL OR "contextVersion"=2);
ALTER TABLE identity_onboarding_intents ADD CONSTRAINT identity_onboarding_current_proof FOREIGN KEY ("organizationId","userId","currentProofId")
 REFERENCES identity_phone_proofs("organizationId","userId",id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE identity_onboarding_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_onboarding_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON identity_onboarding_intents USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on')
 WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
CREATE FUNCTION identity_guard_onboarding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IDENTITY_ONBOARDING_RETAINED' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','currentProofId','issuedAccountVersion','issuedCredentialEpoch','completedAt'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','currentProofId','issuedAccountVersion','issuedCredentialEpoch','completedAt'])
   OR OLD.status<>'ACTIVE'
   OR NEW."issuedAccountVersion"<OLD."issuedAccountVersion" OR NEW."issuedCredentialEpoch"<OLD."issuedCredentialEpoch"
 THEN RAISE EXCEPTION 'IDENTITY_ONBOARDING_REVIEW_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_onboarding_review_immutable BEFORE UPDATE OR DELETE ON identity_onboarding_intents FOR EACH ROW EXECUTE FUNCTION identity_guard_onboarding();
CREATE FUNCTION identity_guard_proof_onboarding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."onboardingIntentId" IS DISTINCT FROM OLD."onboardingIntentId" THEN
 RAISE EXCEPTION 'IDENTITY_PROOF_ONBOARDING_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER identity_proof_onboarding_immutable BEFORE UPDATE ON identity_phone_proofs FOR EACH ROW EXECUTE FUNCTION identity_guard_proof_onboarding();
ALTER TABLE identity_events DROP CONSTRAINT identity_events_action_check;
ALTER TABLE identity_events ADD CONSTRAINT identity_events_action_check CHECK (action IN (
 'ACCOUNT_STAGED','GRANT_CHANGED','PHONE_RESERVED','PHONE_CONFIRMED','PHONE_RELEASED','RESERVATION_EXPIRED',
 'PHONE_PROOF_ISSUED','PHONE_PROOF_REJECTED','PHONE_DELIVERY_LEASED','PHONE_DELIVERY_RECORDED','PHONE_RESERVATION_CANCELLED',
 'CREDENTIAL_STAGED','ACTOR_BINDING_REVIEWED','MEMBERSHIP_CHANGED','PERSON_LIFECYCLE_CHANGED','ACTOR_LIFECYCLE_CHANGED',
 'ACCOUNT_ACTIVATED','RECOVERY_ISSUED','RECOVERY_CONFIRMED','CREDENTIAL_CHANGED','ONBOARDING_CANCELLED'
));
ALTER TABLE identity_events ADD CONSTRAINT identity_onboarding_cancellation_complete CHECK (
 action<>'ONBOARDING_CANCELLED' OR ("actorUserId" IS NOT NULL AND "reviewReference" IS NOT NULL AND "credentialEpoch" IS NOT NULL)
);
COMMIT;
