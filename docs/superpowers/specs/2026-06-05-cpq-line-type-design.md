# CPQ Quote Line Item — Type, SKU & Catalog Picker (P0)

- **Date:** 2026-06-05
- **Status:** Approved design (pending spec review)
- **Module:** CPQ (quotes) — `src/components/cpq/quote-create-dialog.tsx`, `src/app/(dashboard)/quotes/[id]/page.tsx`, `src/app/api/v1/quotes/**`, `prisma/schema.prisma`

## 1. Background & motivation

Quote line items are modelled as free-text only (`productName`); the `productId` FK exists but is unused in the UI. Two gaps surfaced:

1. The New Quote form is effectively hardware-only — no way to mark a line as a license/subscription, and no part-number/SKU.
2. Quantity was tightened to integer-only (shipped, **live on prod**, commit `fb027446`). That correctly blocks "1.03 firewalls" but wrongly blocks fractional **services** (consulting hours, prorated months — the schema's `Decimal(18,4)` was intentional).

Chosen direction: audit **option B** (quantity integer-vs-decimal depends on line type) at **full P0** scope (type + SKU + catalog picker, wiring the dead `productId` FK).

## 2. Scope

**In scope (this iteration):**
- `productType` classification on `Product` + `QuoteLineItem`.
- `sku` (part number) on `Product` + `QuoteLineItem`.
- Catalog product picker (combobox) in the New Quote dialog + detail editor, fed by `GET /api/v1/products`; autofills name/SKU/type/price; still allows ad-hoc free-text lines.
- Conditional quantity: decimal for `service`, integer ≥1 otherwise (replaces the current blanket integer constraint).
- One-wide-row layout; widen the quote dialog via a new optional width prop on the shared `Dialog`.
- i18n (en/ru/az) for type labels.
- Tests for conditional validation + snapshot.

**Out of scope (P1+, explicitly deferred):**
- Subscription term / billing frequency / start-end dates.
- Unit of measure (UOM).
- List vs net price, tiered/volume pricing.
- Bundles/kits, configurable products.

## 3. Taxonomy

`productType ∈ { hardware, license, subscription, service, other }`.

- Stored as **String** (not a Prisma enum), validated app-side with `z.enum([...])` — consistent with existing String statuses/categories in the codebase, and avoids enum-migration churn when values evolve.
- Default: `other`.

**Quantity rule by type:**

| productType | quantity |
|---|---|
| `service` | decimal, **> 0** (hours, e.g. 2.5; proration, e.g. 0.75 month) |
| `hardware`, `license`, `subscription`, `other` | **integer ≥ 1** |

## 4. Data model

`prisma/schema.prisma`:

- **`Product`** — add `sku String?`, `productType String @default("other")`. (`category` left untouched — pre-existing, used elsewhere.)
- **`QuoteLineItem`** — add `sku String?`, `productType String @default("other")`. `quantity` **stays `Decimal(18,4)`** (column unchanged; integer/decimal is enforced by validation, not column type).

**Migration:** additive, all new columns nullable or defaulted → no backfill. Existing rows get `productType = "other"` (integer-treated going forward) and `sku = null`. No data migration, no destructive change.

**Snapshot semantics:** when a line is created from a catalog product, `productName` / `sku` / `productType` / `unitPrice` are snapshotted from `Product` (stable even if the catalog changes later) — mirroring the existing `productName` snapshot pattern. Ad-hoc lines (free-text product, no `productId`) set these fields directly.

## 5. Quantity behavior & reconciliation

The blanket integer sanitizer (UI) + `asPositiveInteger` refine (API) from commit `fb027446` become **conditional on `productType`**:

- **UI** — the qty input renders in integer-mode (`type="text" inputMode="numeric"` + digit sanitize) when `productType !== "service"`, and decimal-mode (`type="number" step="0.01"`) when `service`. Switching the type dropdown re-renders the qty input mode live.
- **API** — quantity refine becomes `productType === "service" ? asPositive(quantity) : asPositiveInteger(quantity)`, applied in **both** route schemas: `src/app/api/v1/quotes/route.ts` (POST — the `asPositiveInteger` refine, ~line 77) **and** `src/app/api/v1/quotes/[id]/route.ts` (PATCH — ~line 82). Both `asPositive`/`asPositiveInteger` helpers already exist in each file. Missing either leaves the blanket-integer rule lingering on that path.

Net: hardware/license/subscription/other stay integer ≥1; `service` allows fractional. This **reverts the over-broad integer constraint** to a type-aware one.

## 6. UX

### 6.1 Dialog width
Add an optional prop to `ui/dialog.tsx` `Dialog`: `widthClassName?: string`, defaulting to `"max-w-[40rem]"`. The outer wrapper renders `w-full ${widthClassName} ...`. The quote create dialog passes a wider class (`max-w-5xl` ≈ 1024px). **All other dialogs keep the default** — no visual change anywhere else (verified by the default).

### 6.2 Line-item row (one wide row)
Columns, left→right: **Product (combobox)** | **Type ▾** | **SKU** | **Qty** | **Unit price** | **Discount** | **🗑**.
- **Product combobox — NET-NEW component (largest build item).** The project has only a native `<select>` wrapper (`ui/select.tsx`) + `@radix-ui/react-select`; there is **no** searchable combobox and no `cmdk`/`downshift`. A searchable product combobox must be built from scratch (Radix Select doesn't do free-text search; likely a custom input+filtered-list popover, or add a `cmdk`-style component). Behaviour: searchable list from `GET /api/v1/products` (shows name + SKU); selecting autofills `productName`, `sku`, `productType`, `unitPrice` and sets `productId`; typing free text → ad-hoc line (`productId` null; type/SKU user-editable).
- **Type dropdown:** the 5 types (can reuse `ui/select.tsx`); changing it switches the qty input mode live (§5).
- **SKU:** text; auto-filled from the chosen product, editable for ad-hoc.
- **Grid is a REBUILD, not an add.** The current row is a fixed `grid-cols-12` (`productName col-4 / qty col-2 / unitPrice col-3 / lineDiscount col-2 / 🗑`). Adding combobox + Type + SKU requires re-laying the grid (and the wider dialog from §6.1 buys the room).

### 6.3 Detail editor (`quotes/[id]/page.tsx`)
Add the same Product-picker + Type + SKU per row. **Note:** the existing `<table>` already has near-full fixed widths (product 30% + qty 80px + 3×110px + 40px), so this is a **column-width redesign**, not a simple add — inserting Type + SKU will overflow narrow viewports unless the widths are re-apportioned (or the table goes horizontally scrollable). Picker per row; disabled when the quote status is terminal (existing `isTerminal` guard preserved).

## 7. API

- `lineItemSchema` (POST `/api/v1/quotes` + PATCH `/api/v1/quotes/[id]`): add
  - `sku: z.string().max(64).nullable().optional()`
  - `productType: z.enum(["hardware","license","subscription","service","other"]).optional()` (default `other` applied on write)
  - quantity refine → conditional by `productType` (§5).
- Persist `sku` / `productType` on create + update. When `productId` is provided, snapshot `sku`/`productType`/`productName`/`unitPrice` from the product if the line didn't supply them.
- `GET /api/v1/products` — **not currently consumed by any picker** (the picker is net-new, §6.2). Today it is a bare `findMany({ where: { organizationId } })` with **no `select` and no `isActive` filter** → it over-fetches and would list archived products. The plan must: add `where: { isActive: true }`, add a `select` projecting only picker fields (`id, name, sku, productType, price, currency`), and confirm `sku`/`productType` are included post-migration.

## 8. i18n

Type labels (Hardware / License / Subscription / Service / Other) + the new field labels (Type, SKU/Part number, Product) added to `messages/{en,ru,az}.json` under a `quotes.lineType.*` namespace. No hardcoded English in the dialog or detail editor.

## 9. Testing

- **Route tests are NET-NEW files** — no `api-quotes*.test.ts` exists today (`src/__tests__/` has only `lib-cpq-*` unit tests). The plan must create a route test file for the quotes POST/PATCH schemas.
- **Route validation:** `service` line with `quantity: 2.5` → 200; `hardware` line with `2.5` → 400; `hardware` with `0` → 400; integer accepted for all.
- **Snapshot:** a line created with a `productId` copies `sku`/`productType`/`unitPrice` from the product.
- **Totals:** `lib-cpq-totals` math unchanged (still decimal-capable) — existing tests stay green.
- `tsc` clean; architect review.

## 10. Key decisions & risks

- **Decision:** `productType` is String + `z.enum` validation, not a Prisma enum — flexibility + matches existing patterns.
- **Decision:** `category` (existing) kept separate from the new `productType` — different purpose; avoids breaking existing category usage.
- **Decision:** quantity column stays `Decimal` — no migration risk; type-conditional enforcement at validation layer.
- **Risk:** the new `Dialog` width prop must default to the current `max-w-[40rem]` so the 80+ other dialogs are untouched — guaranteed by the default value; spot-check one unrelated dialog post-change.
- **Reconciliation:** this turn's outcome supersedes the blanket-integer constraint shipped in `fb027446` with the type-conditional rule.
