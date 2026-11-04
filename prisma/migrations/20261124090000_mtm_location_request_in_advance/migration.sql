-- «Адрес и точка» in «Предложить изменение» (owner, 2026-11-04): an agent may
-- correct a customer's place not only standing at it («Клиент здесь») but in
-- advance — «он заранее смотрит, видит, что уже не там, и предлагает сразу же»
-- — and confirm it later, when he is at the new place: «пришёл уже на
-- правильное место и подтверждает, что это был правильно предложенный адрес».
-- The street address can be corrected too, not only the pin.
--
--  - `origin`: ON_SITE (every row so far) or REMOTE;
--  - the agent's own fix becomes optional — a request in advance is not made
--    from anywhere in particular — but an ON_SITE row still cannot exist
--    without it (`on_site_fix_check`);
--  - `previousAddress` / `proposedAddress`: the address as the card had it and
--    as the agent says it is;
--  - `confirm*`: where the agent's phone was when he confirmed an advance
--    request at the proposed place. Only a REMOTE row is confirmed.
--
-- Additive for the build before this one: it never writes REMOTE, and every
-- row it reads that it wrote itself still has the fix it expects. A REMOTE row
-- read by it during a rollback has no fix; that build would then fail to
-- accept it (the receipt wants the fix's time) — it can be declined, or
-- accepted once the release is back.

SET lock_timeout = '3s';

CREATE TYPE "MtmLocationRequestOrigin" AS ENUM ('ON_SITE', 'REMOTE');

ALTER TABLE "mtm_customer_location_requests"
  ADD COLUMN "origin" "MtmLocationRequestOrigin" NOT NULL DEFAULT 'ON_SITE',
  ADD COLUMN "previousAddress" TEXT,
  ADD COLUMN "proposedAddress" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmLatitude" DOUBLE PRECISION,
  ADD COLUMN "confirmLongitude" DOUBLE PRECISION,
  ADD COLUMN "confirmAccuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "confirmToProposedMeters" INTEGER,
  ALTER COLUMN "agentLatitude" DROP NOT NULL,
  ALTER COLUMN "agentLongitude" DROP NOT NULL,
  ALTER COLUMN "agentAccuracyMeters" DROP NOT NULL,
  ALTER COLUMN "agentFixAt" DROP NOT NULL,
  ALTER COLUMN "agentToProposedMeters" DROP NOT NULL;

ALTER TABLE "mtm_customer_location_requests"
  -- «Клиент здесь» is a claim about where the agent stands: never without the fix that says so.
  ADD CONSTRAINT "mtm_customer_location_requests_on_site_fix_check" CHECK (
    "origin" = 'REMOTE' OR (
      "agentLatitude" IS NOT NULL AND "agentLongitude" IS NOT NULL AND "agentAccuracyMeters" IS NOT NULL
      AND "agentFixAt" IS NOT NULL AND "agentToProposedMeters" IS NOT NULL
    )
  ),
  -- Half a fix is not a fix.
  ADD CONSTRAINT "mtm_customer_location_requests_agent_fix_whole_check" CHECK (
    ("agentLatitude" IS NULL) = ("agentLongitude" IS NULL)
    AND ("agentLatitude" IS NULL) = ("agentAccuracyMeters" IS NULL)
    AND ("agentLatitude" IS NULL) = ("agentFixAt" IS NULL)
  ),
  -- A confirmation is all of it or none of it, only on an advance request,
  -- at a real point on the globe (never 0,0).
  ADD CONSTRAINT "mtm_customer_location_requests_confirm_check" CHECK (
    ("confirmedAt" IS NULL) = ("confirmLatitude" IS NULL)
    AND ("confirmedAt" IS NULL) = ("confirmLongitude" IS NULL)
    AND ("confirmedAt" IS NULL) = ("confirmAccuracyMeters" IS NULL)
    AND ("confirmedAt" IS NULL) = ("confirmToProposedMeters" IS NULL)
    AND ("confirmedAt" IS NULL OR "origin" = 'REMOTE')
    AND ("confirmedAt" IS NULL OR (
      "confirmLatitude" BETWEEN -90 AND 90 AND "confirmLongitude" BETWEEN -180 AND 180
      AND NOT ("confirmLatitude" = 0 AND "confirmLongitude" = 0)
      AND "confirmAccuracyMeters" >= 0 AND "confirmToProposedMeters" >= 0
    ))
  ),
  -- An address is words, not whitespace.
  ADD CONSTRAINT "mtm_customer_location_requests_address_check" CHECK (
    "proposedAddress" IS NULL OR length(btrim("proposedAddress")) > 0
  );
