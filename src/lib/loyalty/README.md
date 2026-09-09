# Loyalty module

The D8 Loyalty domain: earn rules, tiers, promo codes, the points ledger, tier
progression, redeem rewards, and the auto-earn CRM-event hooks. It is a **clean
leaf module** — it depends only on infrastructure (`@/lib/prisma`,
`@/lib/prisma-decimal`, `@/lib/constants`, `@/lib/rls-context`) and never reaches
into another business domain (invoices / deals / contacts / etc.).

## Public interface — import from `@/lib/loyalty`

External (non-loyalty) **server** code should import the module's entry points
from the barrel `index.ts`, not from individual files:

```ts
import { applyAutoEarn } from "@/lib/loyalty"
```

Key entry points:

- **`applyAutoEarn(prisma, {...})`** — credit rule-driven points on a CRM event.
  Used by the earn hooks: `invoices/[id]/payments`, `contacts`, `deals/[id]`.
  Idempotent on `referenceId`; gated by `settings.loyaltyAutoEarn`. Always
  fire-and-forget at the caller (a loyalty failure must not fail the parent op).
- **`reverseAutoEarn(...)`** — claw back points (e.g. a payment was deleted).
- **`runLoyaltyExpiry` / `runLoyaltyBirthday`** — the cron entry points.
- **`validatePromoApplication` / `calculateDiscount` / `acquirePromoCodeLock`** —
  promo redemption (used by `promo-codes/[id]/redeem`).
- **`resolveTier*` / `loadActiveTiers`**, **`redeemPoints`**, **`LOYALTY_TEMPLATES`**.

## ⚠️ Client-safe boundary

The barrel is **SERVER-ONLY** (it re-exports `auto-earn`, which pulls in Prisma).
Importing it from a `"use client"` component breaks `next build`
(`node:async_hooks`). Client components must import the **pure leaf** files
directly — these have no Prisma and are client-safe:

```ts
import { tierColor } from "@/lib/loyalty/tier-colors"
import { earnPreview } from "@/lib/loyalty/preview"
// also pure: ./limits, ./types
```

## What's in the module

- **Lib:** `src/lib/loyalty/*` (this folder). `index.ts` = the public barrel.
- **Push:** `src/lib/push/expo-push.ts` (generic Expo sender) + `loyalty-push.ts`.
- **API routes:** `src/app/api/v1/loyalty-*`, `src/app/api/v1/promo-codes/*`,
  `src/app/api/v1/public/{portal-loyalty,portal-redeem,portal-push-register}`,
  `src/app/api/cron/loyalty-{expiry,birthday}`.
- **Dashboard UI:** `src/app/(dashboard)/loyalty/**` + `src/components/loyalty/**`.
- **Member UI:** `src/app/portal/loyalty/page.tsx` + the native app (separate repo
  `leaddrive-loyalty-app`, consumes the public `portal-*` APIs).
- **Models** (`prisma/schema.prisma`): `LoyaltyAccount`, `LoyaltyTransaction`,
  `LoyaltyTier`, `LoyaltyEarnRule`, `LoyaltyReward`, `LoyaltyRedemption`,
  `PromoCode`, `PromoCodeRedemption`.
- **Registration:** module `"loyalty"` in `src/lib/modules.ts`; route gate in
  `src/lib/permissions.ts` (`ROUTE_MODULE_MAP`); nav in `src/lib/nav-items.ts`;
  feature flags `loyalty` + `loyalty_portal` on `Organization.features`.
- **Tests:** `src/__tests__/*loyalty*`, `*portal-loyalty*`, `*portal-redeem*`,
  `*push*`, `api-portal-push-register`.

## Boundary rules

- **Inbound** (loyalty → others): only infrastructure. Do NOT import another
  business domain here.
- **Outbound** (others → loyalty): go through `@/lib/loyalty` (the barrel) for
  server code; the pure leaves for client code. New external call sites should
  use the barrel. The cron / portal-* routes are the module's own surface and may
  import internal files directly.
