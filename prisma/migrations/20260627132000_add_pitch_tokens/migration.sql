CREATE TABLE "pitch_tokens" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "viewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pitch_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pitch_tokens_token_key" ON "pitch_tokens"("token");
CREATE INDEX "pitch_tokens_organizationId_createdAt_idx" ON "pitch_tokens"("organizationId", "createdAt");

ALTER TABLE "pitch_tokens"
  ADD CONSTRAINT "pitch_tokens_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
