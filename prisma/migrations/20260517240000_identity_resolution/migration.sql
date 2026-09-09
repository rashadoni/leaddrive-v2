-- G2: Identity Resolution (Phase 6 Block B slice 1).
-- Salesforce Identity Resolution analogue. Builds on G1
-- UnifiedProfile to add FUZZY-match scoring + manual-merge queue.
--
-- G1's exact-match `decideMerge` returns 4 outcomes; G2 extends two
-- paths:
--   • `ambiguous` (email matches A, phone matches B): fuzzy-score
--     between A and B → auto-resolve if score gap is clear, else
--     queue for operator review.
--   • `create_new` (no exact match): scan existing profiles for
--     FUZZY matches (Levenshtein on email local-part, digit-edit
--     distance on phone, name similarity) → queue near-matches as
--     potential merges instead of creating a new profile.
--
-- Slice 1 ships schema + pure helpers (Levenshtein, fuzzy-matcher,
-- merge-resolver thresholds). Slice 2 wires:
--   • POST /api/v1/identity-merge-candidates — admin queue routes
--   • POST /api/v1/identity-merge-candidates/[id]/approve|reject
--   • Cron that auto-emits high-confidence (>= 0.95) candidates as
--     immediate merges (slice 1 helper returns the auto-resolve
--     intent; slice 2 cron consumes).
-- Slice 3 wires the AI-duplicate-detection pipeline (reuses
-- `src/lib/ai/duplicates.ts`).

-- ── ProfileMergeCandidate ──────────────────────────────────────
-- One row per identified potential-merge pair. The fuzzy-matcher
-- emits these; an operator reviews + approves/rejects via the
-- admin queue, OR the slice-2 cron auto-resolves high-confidence
-- (>= autoMergeThreshold) candidates.
--
-- (orgId, primaryProfileId, secondaryProfileId) is unique — a single
-- candidate pair has one open queue entry at a time. The matcher
-- consistently picks the LOWER profileId.id as primary (lexicographic)
-- so the unique key is deterministic.
CREATE TABLE "profile_merge_candidates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /** Canonical winner — by deterministic rule, the lexicographically-smaller profile id. */
    "primaryProfileId" TEXT NOT NULL,
    /** The loser — merged INTO primary on approval. */
    "secondaryProfileId" TEXT NOT NULL,
    /** Fuzzy match score 0..1. Helper computes from email + phone + name similarity. */
    "score" DOUBLE PRECISION NOT NULL,
    /**
     * Per-key contribution to the score, JSON shape:
     *   { email: number, phone: number, name: number,
     *     emailWeight: number, phoneWeight: number, nameWeight: number }
     * Surfaces in the admin UI ("why does Claude think these are the same person?")
     */
    "matchBreakdown" JSONB NOT NULL DEFAULT '{}',
    /** Free-text caller-supplied reason (e.g. "fuzzy:email local-part Levenshtein=1"). */
    "reason" TEXT,
    /**
     * pending → auto_merged | manually_merged | rejected
     * pending is the queue state; the other three are terminal.
     */
    "status" TEXT NOT NULL DEFAULT 'pending',
    /** Operator-side metadata — set on approve/reject terminal transition. */
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "profile_merge_candidates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_status_check"
  CHECK ("status" IN ('pending', 'auto_merged', 'manually_merged', 'rejected'));

ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_score_check"
  CHECK ("score" >= 0 AND "score" <= 1);

-- Primary ≠ secondary — a profile cannot be merged into itself.
ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_distinct_check"
  CHECK ("primaryProfileId" <> "secondaryProfileId");

-- Review-coherence: terminal statuses MUST have reviewedAt + reviewedBy.
-- pending status MUST NOT have either set (atomic transition on approve/reject).
ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_review_coherence_check"
  CHECK (
    ("status" = 'pending' AND "reviewedAt" IS NULL AND "reviewedBy" IS NULL)
    OR ("status" IN ('auto_merged', 'manually_merged', 'rejected')
        AND "reviewedAt" IS NOT NULL
        AND "reviewedBy" IS NOT NULL)
  );

-- Partial UNIQUE on (org, primary, secondary) WHERE pending — one
-- open candidate per pair. Terminal rows accumulate (audit trail);
-- a new candidate for the same pair can be opened AFTER the previous
-- one is reviewed (or rejected).
CREATE UNIQUE INDEX "profile_merge_candidates_pending_pair_uniq"
  ON "profile_merge_candidates"("organizationId", "primaryProfileId", "secondaryProfileId")
  WHERE "status" = 'pending';

CREATE INDEX "profile_merge_candidates_org_status_idx" ON "profile_merge_candidates"("organizationId", "status");
CREATE INDEX "profile_merge_candidates_org_score_idx" ON "profile_merge_candidates"("organizationId", "score");
CREATE INDEX "profile_merge_candidates_primary_idx" ON "profile_merge_candidates"("primaryProfileId");
CREATE INDEX "profile_merge_candidates_secondary_idx" ON "profile_merge_candidates"("secondaryProfileId");

ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_primaryProfileId_fkey"
  FOREIGN KEY ("primaryProfileId") REFERENCES "unified_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_merge_candidates"
  ADD CONSTRAINT "profile_merge_candidates_secondaryProfileId_fkey"
  FOREIGN KEY ("secondaryProfileId") REFERENCES "unified_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
