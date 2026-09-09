-- S6 CPQ — Configure-Price-Quote slice-1: schema foundation.
--
-- Adds two tables: `quotes` (top-level proposal) + `quote_line_items`
-- (per-product breakdown). All money columns are Decimal(18, 4) per
-- the D5 Payments + D8 Loyalty Float→Decimal sweep pattern.
--
-- State machine for `quotes.status`: draft → sent → viewed →
-- accepted | rejected | expired. DB-level CHECK enforces taxonomy;
-- transition validation lives in the (slice-2) route layer.
--
-- Discount XOR (lineDiscountAmount XOR lineDiscountPct on line items,
-- discountAmount XOR discountPct on quotes) is enforced at the route
-- layer in slice-2 — DB tolerates both being non-NULL so a future
-- "absolute discount on top of percentage" feature wouldn't need a
-- second migration.
--
-- No back-fill needed (additive). No down-migration; if rolled back,
-- both tables drop empty (no live writes in slice-1).
--
-- Memory: `memory/project_salesforce_phase5_audit.md` slice-1 scratchpad.

CREATE TABLE "quotes" (
  "id"              TEXT          NOT NULL,
  "organizationId"  TEXT          NOT NULL,
  "quoteNumber"     VARCHAR(50)   NOT NULL,
  "version"         INTEGER       NOT NULL DEFAULT 1,
  "dealId"          TEXT,
  "status"          TEXT          NOT NULL DEFAULT 'draft',
  "validUntil"      TIMESTAMP(3),
  "currency"        TEXT          NOT NULL DEFAULT 'AZN',
  "subtotal"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  "discountAmount"  DECIMAL(18,4) NOT NULL DEFAULT 0,
  "discountPct"     DECIMAL(5,2),
  "totalAmount"     DECIMAL(18,4) NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "sentAt"          TIMESTAMP(3),
  "viewedAt"        TIMESTAMP(3),
  "acceptedAt"      TIMESTAMP(3),
  "rejectedAt"      TIMESTAMP(3),
  "rejectedReason"  TEXT,
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id"),

  -- State-machine taxonomy. Slice-2 routes additionally validate
  -- transition legality (draft→sent is OK, sent→draft is not).
  CONSTRAINT "quotes_status_check"
    CHECK ("status" IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),

  -- Discount % must be in [0, 100). Negative discounts and >=100%
  -- discounts are not real-world quotes — reject at the DB boundary.
  CONSTRAINT "quotes_discount_pct_range_check"
    CHECK ("discountPct" IS NULL OR ("discountPct" >= 0 AND "discountPct" < 100)),

  -- Money columns can't go negative. (Refund-style negative-amount
  -- quotes would be a separate "credit note" flow, not this table.)
  CONSTRAINT "quotes_amounts_non_negative_check"
    CHECK ("subtotal" >= 0 AND "discountAmount" >= 0 AND "totalAmount" >= 0)
);

CREATE TABLE "quote_line_items" (
  "id"                  TEXT          NOT NULL,
  "quoteId"             TEXT          NOT NULL,
  "productId"           TEXT,
  "productName"         TEXT          NOT NULL,
  "description"         TEXT,
  "quantity"            DECIMAL(18,4) NOT NULL DEFAULT 1,
  "unitPrice"           DECIMAL(18,4) NOT NULL,
  "lineDiscountAmount"  DECIMAL(18,4) NOT NULL DEFAULT 0,
  "lineDiscountPct"     DECIMAL(5,2),
  "lineTotal"           DECIMAL(18,4) NOT NULL,
  "sortOrder"           INTEGER       NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id"),

  -- Per-line discount % constraint (same shape as the quote-level one).
  CONSTRAINT "quote_line_items_discount_pct_range_check"
    CHECK ("lineDiscountPct" IS NULL OR ("lineDiscountPct" >= 0 AND "lineDiscountPct" < 100)),

  -- Money columns can't go negative. quantity can be zero (placeholder
  -- line during quote build), unitPrice can't (a paid line has price).
  CONSTRAINT "quote_line_items_amounts_non_negative_check"
    CHECK ("quantity" >= 0 AND "unitPrice" >= 0 AND "lineDiscountAmount" >= 0 AND "lineTotal" >= 0)
);

-- ── Indices on quotes ───────────────────────────────────────────────
-- UNIQUE prevents two rows sharing (org, quoteNumber, version) — a
-- revision MUST bump version, not overwrite.
CREATE UNIQUE INDEX "quotes_org_number_version_uniq"
  ON "quotes" ("organizationId", "quoteNumber", "version");

-- List by org + status (dashboard "all draft quotes" / "all sent" views).
CREATE INDEX "quotes_org_status_idx"
  ON "quotes" ("organizationId", "status");

-- List by org + dealId (dashboard "all quotes for this deal").
CREATE INDEX "quotes_org_dealId_idx"
  ON "quotes" ("organizationId", "dealId");

-- ── Indices on quote_line_items ─────────────────────────────────────
-- List by quote (1:N navigation from a single Quote — the canonical
-- read pattern).
CREATE INDEX "quote_line_items_quoteId_idx"
  ON "quote_line_items" ("quoteId");

-- ── Foreign keys ────────────────────────────────────────────────────
-- Org cascade — deleting an organization wipes its quotes (consistent
-- with how deals/contacts/leads cascade in this schema).
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Deal SET NULL — a deleted deal preserves the quote audit trail
-- (matches Task.projectId pattern).
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- createdBy SET NULL — author may be deactivated; quote stays whole.
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Quote cascade — deleting a quote wipes its line items.
ALTER TABLE "quote_line_items"
  ADD CONSTRAINT "quote_line_items_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "quotes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Product SET NULL — productName snapshot preserves audit integrity
-- if the referenced Product row is later removed.
ALTER TABLE "quote_line_items"
  ADD CONSTRAINT "quote_line_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
