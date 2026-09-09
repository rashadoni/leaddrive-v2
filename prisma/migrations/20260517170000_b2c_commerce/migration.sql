-- D2 B2C Commerce (Phase 6 Block A slice 1).
-- Storefront + session-bound Cart + CheckoutSession.

CREATE TABLE "storefronts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "primaryCurrency" TEXT NOT NULL DEFAULT 'USD',
    "primaryLocale" TEXT NOT NULL DEFAULT 'en-US',
    "theme" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "storefronts_pkey" PRIMARY KEY ("id")
);

-- Slug must be URL-safe AND forbid consecutive separators
-- (`a--b`, `a__b`, `a-_b`, `a_-b` all rejected). Single-char slugs
-- supported via the OR branch.
ALTER TABLE "storefronts"
  ADD CONSTRAINT "storefronts_slug_check"
  CHECK (
    length("slug") = 1
    OR ("slug" ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$' AND "slug" !~ '[_-]{2}')
  );

CREATE UNIQUE INDEX "storefronts_org_slug_uniq" ON "storefronts"("organizationId", "slug");
CREATE INDEX "storefronts_org_active_idx" ON "storefronts"("organizationId", "isActive");

ALTER TABLE "storefronts"
  ADD CONSTRAINT "storefronts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "sessionToken" TEXT,
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_status_check"
  CHECK ("status" IN ('open', 'abandoned', 'checked_out', 'merged'));

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_subtotal_check"
  CHECK ("subtotal" >= 0);

-- A cart must have AT LEAST ONE of contactId or sessionToken — a
-- cart with neither has no owner and is dead-data.
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_check"
  CHECK ("sessionToken" IS NOT NULL OR "contactId" IS NOT NULL);

CREATE INDEX "carts_org_status_idx" ON "carts"("organizationId", "status");
CREATE INDEX "carts_sessionToken_idx" ON "carts"("sessionToken");
CREATE INDEX "carts_contact_idx" ON "carts"("contactId");

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_storefrontId_fkey"
  FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "lineTotal" DOUBLE PRECISION NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_check"
  CHECK ("quantity" > 0);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_unitPrice_check"
  CHECK ("unitPrice" >= 0);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_lineTotal_check"
  CHECK ("lineTotal" >= 0);

CREATE UNIQUE INDEX "cart_items_cart_product_uniq" ON "cart_items"("cartId", "productId");
CREATE INDEX "cart_items_cart_idx" ON "cart_items"("cartId");

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_cartId_fkey"
  FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'shipping',
    "shipping" JSONB,
    "billing" JSONB,
    "paymentRef" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_status_check"
  CHECK ("status" IN ('shipping', 'payment', 'review', 'completed', 'failed', 'expired'));

CREATE INDEX "checkout_sessions_org_status_idx" ON "checkout_sessions"("organizationId", "status");
CREATE INDEX "checkout_sessions_cart_idx" ON "checkout_sessions"("cartId");

ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_cartId_fkey"
  FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
