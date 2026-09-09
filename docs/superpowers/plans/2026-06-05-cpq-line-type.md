# CPQ Line Item Type + SKU + Catalog Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CPQ quote line items a `productType` (hardware/license/subscription/service/other) that drives integer-vs-decimal quantity, a `sku`/part-number, and a searchable catalog product picker — superseding the blanket-integer quantity constraint shipped in `fb027446`.

**Architecture:** A single source of truth (`src/lib/cpq/line-types.ts`) defines the type list + the decimal rule, consumed by both the API (Zod) and the UI (type dropdown, quantity input). Schema adds nullable/defaulted columns (no backfill); quantity stays `Decimal` and is enforced conditionally at the validation layer. UI gets a net-new `ProductCombobox` + a shared `QuantityInput`, used by both the New Quote dialog (grid rebuilt) and the quote detail table (column widths redesigned). The shared `Dialog` gains a default-safe width prop so only the quote dialog widens.

**Tech Stack:** Next.js 16 App Router, Prisma (PostgreSQL), Zod, next-intl (en/ru/az), Tailwind v4, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-06-05-cpq-line-type-design.md`

**Standing constraints (every task):** commit per task with explicit pathspec — NEVER `git add -A`/`git add .`; the concurrent Marketing-paywall WIP (`src/lib/modules.ts`, `src/lib/plan-config.ts`, `scripts/backfill-base-modules.mjs`, `src/__tests__/lib-workflow-permissions.test.ts`, `scripts/cron-customer-insights-snapshot.sh`, `*.xlsx`) is NOT ours — never stage it. `tsc` runs with `NODE_OPTIONS="--max-old-space-size=8192"`. Deploy only after explicit user ack of which client (read `clients/registry.json`). Architect-gate each substantive turn.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/cpq/line-types.ts` | Create | Single source: `LINE_TYPES` list, `LineType`, `isDecimalLineType()` |
| `src/__tests__/lib-cpq-line-types.test.ts` | Create | Unit tests for the constants/helper |
| `prisma/schema.prisma` | Modify | `Product` +`sku`/`productType`; `QuoteLineItem` +`sku`/`productType` |
| `prisma/migrations/.../migration.sql` | Create (via `migrate dev`) | Additive columns |
| `src/app/api/v1/products/route.ts` | Modify | GET: `isActive` filter + `select`; POST: accept `sku`/`productType` |
| `src/app/api/v1/quotes/route.ts` | Modify | lineItemSchema +`sku`/`productType`; conditional qty refine; snapshot |
| `src/app/api/v1/quotes/[id]/route.ts` | Modify | Same as above (PATCH) |
| _(no separate route test)_ | — | Quantity rule covered by `lib-cpq-line-types.test.ts` (Task 1) + a grep proving both routes call it |
| `messages/{en,ru,az}.json` | Modify | `quotes.lineType.*` labels |
| `src/components/ui/dialog.tsx` | Modify | Optional `widthClassName` prop (default `max-w-[40rem]`) |
| `src/components/cpq/quantity-input.tsx` | Create | Conditional integer/decimal qty input |
| `src/components/cpq/product-combobox.tsx` | Create | Net-new searchable product picker |
| `src/components/cpq/quote-create-dialog.tsx` | Modify | Rebuild line row: combobox + type + sku + QuantityInput |
| `src/app/(dashboard)/quotes/[id]/page.tsx` | Modify | Add Type/SKU columns + combobox + QuantityInput; redesign widths |
| `src/app/(dashboard)/products/page.tsx` | Modify | Product create form: +sku/type |
| `src/app/(dashboard)/products/[id]/page.tsx` | Modify | Product edit form: +sku/type |

---

## Task 1: Shared line-type constants

**Files:**
- Create: `src/lib/cpq/line-types.ts`
- Test: `src/__tests__/lib-cpq-line-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib-cpq-line-types.test.ts
import { describe, it, expect } from "vitest"
import { LINE_TYPES, isDecimalLineType, isValidLineQuantity } from "@/lib/cpq/line-types"

describe("cpq line types", () => {
  it("exposes the five types in order", () => {
    expect(LINE_TYPES).toEqual(["hardware", "license", "subscription", "service", "other"])
  })
  it("only service is decimal", () => {
    expect(isDecimalLineType("service")).toBe(true)
    for (const t of ["hardware", "license", "subscription", "other"]) {
      expect(isDecimalLineType(t)).toBe(false)
    }
  })
  it("treats null/undefined/unknown as integer (non-decimal)", () => {
    expect(isDecimalLineType(null)).toBe(false)
    expect(isDecimalLineType(undefined)).toBe(false)
    expect(isDecimalLineType("bogus")).toBe(false)
  })
})

describe("isValidLineQuantity (the route + UI rule)", () => {
  it("allows decimal > 0 for service", () => {
    expect(isValidLineQuantity("service", 2.5)).toBe(true)
    expect(isValidLineQuantity("service", "0.75")).toBe(true)
    expect(isValidLineQuantity("service", 3)).toBe(true)
  })
  it("rejects decimal, zero and empty-string for non-service", () => {
    for (const t of ["hardware", "license", "subscription", "other"]) {
      expect(isValidLineQuantity(t, 2.5)).toBe(false)
      expect(isValidLineQuantity(t, 0)).toBe(false)
      expect(isValidLineQuantity(t, "")).toBe(false)
    }
  })
  it("rejects zero / empty / non-finite even for service (no silent zero)", () => {
    expect(isValidLineQuantity("service", 0)).toBe(false)
    expect(isValidLineQuantity("service", "")).toBe(false)
    expect(isValidLineQuantity("service", "abc")).toBe(false)
  })
  it("accepts integers everywhere and undefined/null (defaults to 1)", () => {
    expect(isValidLineQuantity("hardware", 3)).toBe(true)
    expect(isValidLineQuantity("hardware", undefined)).toBe(true)
    expect(isValidLineQuantity("hardware", null)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib-cpq-line-types.test.ts`
Expected: FAIL — cannot resolve `@/lib/cpq/line-types`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/cpq/line-types.ts
/** Single source of truth for CPQ quote line-item product types.
 * Used by both the API (Zod enum + conditional quantity validation) and
 * the UI (type dropdown + conditional quantity input). */
export const LINE_TYPES = ["hardware", "license", "subscription", "service", "other"] as const
export type LineType = (typeof LINE_TYPES)[number]

export const DEFAULT_LINE_TYPE: LineType = "other"

/** Only `service` allows a fractional quantity (hours, prorated months).
 * Everything else is a discrete count → integer ≥ 1. */
export function isDecimalLineType(t: string | null | undefined): boolean {
  return t === "service"
}

/** True when `quantity` is acceptable for the given line type. undefined/null
 *  → true (defaults to 1 downstream). `service` allows any finite value > 0;
 *  all other types require an integer ≥ 1. `""` → Number("")=0 → rejected
 *  (no silent zero). Single source imported by BOTH quote routes AND the UI
 *  so the rule cannot drift. */
export function isValidLineQuantity(productType: string | null | undefined, quantity: unknown): boolean {
  if (quantity === undefined || quantity === null) return true
  const n = typeof quantity === "string" ? Number(quantity) : (quantity as number)
  if (!Number.isFinite(n)) return false
  return isDecimalLineType(productType) ? n > 0 : Number.isInteger(n) && n >= 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib-cpq-line-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cpq/line-types.ts src/__tests__/lib-cpq-line-types.test.ts
git commit -m "feat(cpq): line-type constants + decimal-quantity rule (single source)"
```

---

## Task 2: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (Product ~2857, QuoteLineItem ~12450)
- Create: `prisma/migrations/<timestamp>_add_cpq_line_type/migration.sql` (generated)

- [ ] **Step 1: Add columns to `Product`**

In `model Product` (after `category` line), add:

```prisma
  sku            String?  // S6 CPQ — part number / SKU; null for service-only catalog entries
  productType    String   @default("other") // hardware | license | subscription | service | other
```

- [ ] **Step 2: Add columns to `QuoteLineItem`**

In `model QuoteLineItem` (after the `productName` snapshot block), add:

```prisma
  /// Snapshot of Product.sku (or ad-hoc part number). Null when none.
  sku String?

  /// Snapshot of Product.productType (or ad-hoc choice). Drives whether
  /// `quantity` is integer (hardware/license/subscription/other) or
  /// decimal (service). Default "other" = integer.
  productType String @default("other")
```

(Leave `quantity Decimal @default(1) @db.Decimal(18, 4)` UNCHANGED — integer/decimal is a validation concern, not a column change.)

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name add_cpq_line_type`
Expected: creates `prisma/migrations/<ts>_add_cpq_line_type/migration.sql` with four additive `ADD COLUMN` statements (products.sku, products.productType DEFAULT 'other', quote_line_items.sku, quote_line_items.productType DEFAULT 'other'), then runs `prisma generate`. No data loss prompt (all nullable/defaulted).

> If `migrate dev` reports drift from pre-existing history, do NOT reset. Instead create the migration folder by hand and write the four `ALTER TABLE ... ADD COLUMN` statements (matching the `@@map` table names `products` and the QuoteLineItem table), then `npx prisma generate`.

- [ ] **Step 4: Verify the client typechecks**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit`
Expected: exit 0 (new fields available on the Prisma client; nothing references them yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cpq): add sku + productType to Product and QuoteLineItem (additive)"
```

---

## Task 3: Products API — active-only GET + accept sku/productType

**Files:**
- Modify: `src/app/api/v1/products/route.ts`

- [ ] **Step 1: Update the `GET` query (active-only + projected select)**

Replace the `findMany` (lines ~22-25) with:

```ts
  const products = await prisma.product.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      productType: true,
      price: true,
      currency: true,
      category: true,
    },
    orderBy: { name: "asc" },
  })
```

- [ ] **Step 2: Accept sku/productType on create**

In `createSchema` (after `category`), add:

```ts
  sku: z.string().max(64).nullable().optional(),
  productType: z.enum(["hardware", "license", "subscription", "service", "other"]).default("other"),
```

(Import is local to the schema — reuse the literal list; do NOT import `LINE_TYPES` into a `z.enum` as a value, Zod needs a literal tuple. Keeping the tuple inline here is acceptable; the canonical list lives in `line-types.ts` and is asserted equal in Task 4's test.)

- [ ] **Step 3: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/products/route.ts
git commit -m "feat(cpq): products GET returns active-only projected fields; POST accepts sku/type"
```

---

## Task 4: Quote API — conditional quantity + sku/productType (BOTH routes)

> This supersedes `fb027446`. The blanket `asPositiveInteger(li.quantity)` refine becomes type-conditional in **both** `route.ts` (POST) and `[id]/route.ts` (PATCH).

**Files:**
- Modify: `src/app/api/v1/quotes/route.ts` (lineItemSchema ~47-70, write sites ~202/245)
- Modify: `src/app/api/v1/quotes/[id]/route.ts` (lineItemSchema ~58-77, write sites ~204/296)
- (No new test file — the conditional-quantity rule lives in `isValidLineQuantity` and is unit-tested in Task 1.)

- [ ] **Step 1: (No new test) — the quantity rule is unit-tested in Task 1**

`isValidLineQuantity` is the single source for the conditional-quantity rule and is fully covered by `src/__tests__/lib-cpq-line-types.test.ts` (Task 1: service decimal `>0` ok; non-service decimal/zero/`""` rejected; undefined/null → default). A route-level integration test needs auth + DB mocks and no such harness exists, so coverage here = the Task 1 unit tests **plus** the Step 4 grep proving BOTH routes call `isValidLineQuantity`. No separate test file.

- [ ] **Step 2: (folded into Step 1)** — proceed to wiring the routes.

- [ ] **Step 3a: Update `route.ts` lineItemSchema (POST)**

Add `sku`/`productType` to the `.object` (after `productName`):

```ts
    sku: z.string().max(64).nullable().optional(),
    productType: z.enum(["hardware", "license", "subscription", "service", "other"]).optional(),
```

Import the shared rule (no local helper — keeps both routes in lockstep with Task 1, and the rule is already unit-tested there):

```ts
import { isValidLineQuantity } from "@/lib/cpq/line-types"
```

Replace the existing quantity refine line:

```ts
// before:
.refine((li) => asPositiveInteger(li.quantity), { message: "quantity must be a whole number ≥ 1" })
// after:
.refine((li) => isValidLineQuantity(li.productType, li.quantity), { message: "quantity must be a whole number ≥ 1 (or > 0 for service)" })
```

(Leave the local `asPositive`/`asPositiveInteger` helpers in place — they're still used for `unitPrice`/discount refines.)

- [ ] **Step 3b: Persist sku/productType on write (`route.ts`)**

The routes snapshot `productName` from the **request body** (`li.productName`) — there is NO `product` object loaded at the write sites (confirmed: route.ts:248-259). The dialog already autofills sku/type/price client-side, so persist the body values (do NOT reference a non-existent `product`):

```ts
        sku: li.sku ?? null,
        productType: li.productType ?? "other",
```

Add these next to the existing `productName: li.productName` at BOTH write sites in `route.ts` (the create-map ~202 and the inner `create` ~245).

- [ ] **Step 3c: Apply the identical changes to `[id]/route.ts` (PATCH)**

Repeat Steps 3a + 3b in `src/app/api/v1/quotes/[id]/route.ts`: add `sku`/`productType` to its lineItemSchema (~63), add the `isValidLineQuantity` import + swap the refine (~76) to use it, and persist `sku`/`productType` at its write sites (~204, ~296).

- [ ] **Step 4: Verify reconciliation + typecheck + tests**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.
Run: `npx vitest run src/__tests__/lib-cpq-*.test.ts` → PASS.
Grep to confirm reconciliation: `grep -rn "asPositiveInteger(li.quantity)" src/app/api/v1/quotes/` → **no matches**; `grep -rln "isValidLineQuantity" src/app/api/v1/quotes/` → **both** route files. (Supersedes fb027446.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/quotes/route.ts "src/app/api/v1/quotes/[id]/route.ts"
git commit -m "feat(cpq): type-conditional quantity validation + sku/type persist (both routes); supersede fb027446 blanket rule"
```

---

## Task 5: i18n labels

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/az.json`

- [ ] **Step 1: Add a `lineType` subtree under the existing `quotes` namespace**

In each file, inside `"quotes": { ... }`, add:

```jsonc
"lineType": {
  "label": "Type",            // ru: "Тип" | az: "Növ"
  "hardware": "Hardware",     // ru: "Оборудование" | az: "Avadanlıq"
  "license": "License",       // ru: "Лицензия" | az: "Lisenziya"
  "subscription": "Subscription", // ru: "Подписка" | az: "Abunəlik"
  "service": "Service",       // ru: "Услуга" | az: "Xidmət"
  "other": "Other",           // ru: "Прочее" | az: "Digər"
  "sku": "SKU / Part #",      // ru: "SKU / Артикул" | az: "SKU / Hissə №"
  "product": "Product",       // ru: "Товар" | az: "Məhsul"
  "searchProducts": "Search catalog…" // ru: "Поиск по каталогу…" | az: "Kataloqda axtar…"
}
```

Use the real translated strings shown in the comments for ru.json and az.json respectively (drop the comments — JSON has none).

- [ ] **Step 2: Verify the three files stay valid JSON + key-parallel**

Run: `for f in en ru az; do node -e "JSON.parse(require('fs').readFileSync('messages/$f.json','utf8'))" && echo "$f ok"; done`
Expected: `en ok` / `ru ok` / `az ok`.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/ru.json messages/az.json
git commit -m "i18n(cpq): line-type + sku + product labels (en/ru/az)"
```

---

## Task 6: Shared Dialog width prop

**Files:**
- Modify: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Add an optional `widthClassName` prop, defaulting to current width**

Change the `Dialog` signature + wrapper:

```tsx
interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  /** Tailwind max-width for the dialog box. Defaults to the standard width;
   *  pass e.g. "max-w-5xl" for wide forms. */
  widthClassName?: string
}

export function Dialog({ open, onOpenChange, children, widthClassName = "max-w-[40rem]" }: DialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className={`relative bg-background rounded-lg shadow-lg w-full ${widthClassName} max-h-[85vh] overflow-hidden flex flex-col [&>form]:flex [&>form]:flex-col [&>form]:flex-1 [&>form]:min-h-0 [&>form]:overflow-hidden`} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + spot-check one unrelated dialog is unchanged**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.
Confirm default preserved: `grep -n 'widthClassName = "max-w-\[40rem\]"' src/components/ui/dialog.tsx` → 1 match. (Other 80+ dialogs pass no prop → unchanged.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat(ui): optional widthClassName on Dialog (default unchanged)"
```

---

## Task 7: QuantityInput component (conditional integer/decimal)

**Files:**
- Create: `src/components/cpq/quantity-input.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/cpq/quantity-input.tsx
"use client"
import { Input } from "@/components/ui/input"
import { isDecimalLineType } from "@/lib/cpq/line-types"

interface QuantityInputProps {
  productType: string | null | undefined
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  title?: string
  "aria-label"?: string
}

/** Integer-only (digit-sanitized) for discrete types; decimal (step 0.01)
 *  for `service`. Keeps UI in lockstep with the API's isValidLineQuantity. */
export function QuantityInput({ productType, value, onChange, disabled, className, placeholder, title, ...aria }: QuantityInputProps) {
  if (isDecimalLineType(productType)) {
    return (
      <Input type="number" step="0.01" min="0.01" value={value} disabled={disabled}
        className={className} placeholder={placeholder} title={title} aria-label={aria["aria-label"]}
        onChange={(e) => onChange(e.target.value)} />
    )
  }
  return (
    <Input type="text" inputMode="numeric" pattern="[0-9]*" value={value} disabled={disabled}
      className={className} placeholder={placeholder} title={title} aria-label={aria["aria-label"]}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))} />
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/cpq/quantity-input.tsx
git commit -m "feat(cpq): QuantityInput — integer/decimal by line type"
```

---

## Task 8: ProductCombobox component (net-new picker)

**Files:**
- Create: `src/components/cpq/product-combobox.tsx`

- [ ] **Step 1: Write the searchable combobox**

```tsx
// src/components/cpq/product-combobox.tsx
"use client"
import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"

export interface CatalogProduct {
  id: string
  name: string
  sku: string | null
  productType: string
  price: number
  currency: string
}

interface ProductComboboxProps {
  /** Current free-text product name (controlled). */
  value: string
  /** Fired on every keystroke (ad-hoc typing). */
  onNameChange: (name: string) => void
  /** Fired when a catalog product is picked. */
  onSelect: (p: CatalogProduct) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** Free-text input + filtered catalog dropdown. Typing = ad-hoc line;
 *  picking an item = catalog line (parent autofills sku/type/price). */
export function ProductCombobox({ value, onNameChange, onSelect, disabled, placeholder, className }: ProductComboboxProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    fetch("/api/v1/products")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => { if (active) setProducts(Array.isArray(j.data) ? j.data : []) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const q = value.trim().toLowerCase()
  const matches = q
    ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)).slice(0, 8)
    : products.slice(0, 8)

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onNameChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && !disabled && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onSelect(p); setOpen(false) }}
              >
                <span className="truncate">{p.name}</span>
                {p.sku && <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/cpq/product-combobox.tsx
git commit -m "feat(cpq): ProductCombobox — searchable catalog picker (net-new)"
```

---

## Task 9: Quote create dialog — rebuild the line row

**Files:**
- Modify: `src/components/cpq/quote-create-dialog.tsx`

- [ ] **Step 1: Extend `LineDraft` + `emptyLine` (top of file)**

```ts
interface LineDraft {
  productId: string | null
  productName: string
  productType: string
  sku: string
  description: string
  quantity: string
  unitPrice: string
  lineDiscountAmount: string
}

function emptyLine(): LineDraft {
  return { productId: null, productName: "", productType: "other", sku: "", description: "", quantity: "1", unitPrice: "", lineDiscountAmount: "" }
}
```

- [ ] **Step 2: Widen the dialog**

Change `<DialogContent className="max-w-2xl">`'s parent `<Dialog ...>` to pass the width, and drop the now-dead `max-w-2xl`:

```tsx
<Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-5xl">
  <DialogContent>
```

- [ ] **Step 3: Replace the line-item row**

Swap the current `grid-cols-12` row (lines ~163-177) for a wider grid with the combobox + type + sku + QuantityInput. Add imports at top:

```tsx
import { ProductCombobox, type CatalogProduct } from "@/components/cpq/product-combobox"
import { QuantityInput } from "@/components/cpq/quantity-input"
import { LINE_TYPES } from "@/lib/cpq/line-types"
```

Row JSX:

```tsx
<div key={i} className="grid grid-cols-12 gap-2 items-center">
  <ProductCombobox
    className="col-span-3"
    value={l.productName}
    placeholder={t("dialog.productName")}
    onNameChange={(name) => updateLine(i, { productName: name, productId: null })}
    onSelect={(p: CatalogProduct) => updateLine(i, {
      productId: p.id, productName: p.name, sku: p.sku ?? "",
      productType: p.productType, unitPrice: String(p.price),
    })}
  />
  <select
    className="col-span-2 h-9 rounded-md border bg-background px-2 text-sm"
    value={l.productType}
    aria-label={t("lineType.label")}
    onChange={(e) => updateLine(i, { productType: e.target.value })}
  >
    {LINE_TYPES.map((lt) => <option key={lt} value={lt}>{t(`lineType.${lt}`)}</option>)}
  </select>
  <Input className="col-span-2" placeholder={t("lineType.sku")} title={t("lineType.sku")} aria-label={t("lineType.sku")}
    value={l.sku} onChange={(e) => updateLine(i, { sku: e.target.value })} />
  <QuantityInput className="col-span-1" productType={l.productType} value={l.quantity}
    title={t("dialog.qty")} aria-label={t("dialog.qty")} placeholder={t("dialog.qty")}
    onChange={(v) => updateLine(i, { quantity: v })} />
  <Input className="col-span-2" type="number" step="0.01" placeholder={t("dialog.unitPriceShort")} title={t("dialog.unitPrice")} aria-label={t("dialog.unitPrice")}
    value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
  <Input className="col-span-1" type="number" step="0.01" placeholder={t("dialog.lineDiscountShort")} title={t("dialog.lineDiscount")} aria-label={t("dialog.lineDiscount")}
    value={l.lineDiscountAmount} onChange={(e) => updateLine(i, { lineDiscountAmount: e.target.value })} />
  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => removeLine(i)} disabled={lines.length === 1} title={t("dialog.removeLine")}>
    <Trash2 className="h-4 w-4" />
  </Button>
</div>
```

- [ ] **Step 4: Change `updateLine` to a patch-merge signature**

Replace the single-key `updateLine(i, key, value)` with a patch object (the row above calls it with partials):

```ts
function updateLine(i: number, patch: Partial<LineDraft>) {
  setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
}
```

(Update the other call sites — discount/notes — to pass objects, e.g. `updateLine(i, { lineDiscountAmount: e.target.value })`. Grep `updateLine(` in this file and fix each.)

- [ ] **Step 5: Send sku/productType/productId in the POST body**

In `handleSubmit`'s `lineItems` map (~96-106), add to each `item`:

```ts
          productType: l.productType,
          ...(l.productId ? { productId: l.productId } : {}),
          ...(l.sku.trim() ? { sku: l.sku.trim() } : {}),
```

Also relax the `validLines` filter: a line is valid if it has a name AND a price (unchanged), but ad-hoc lines keep working.

- [ ] **Step 6: (grid uses only repo-proven classes — nothing to add)**

The row uses `grid-cols-12` with `col-span-3/2/2/1/2/1/1` (= 12). All of these (`col-span-1/2/3`) are already in the codebase (the original row used `col-span-4/2/3/2`), so Tailwind JIT will emit them — no arbitrary `grid-cols-[repeat(...)]` utility and no unproven `col-span-7`. The `max-w-5xl` dialog (~1024px) gives ~85px per track; the combobox/type/sku/price get 2-3 tracks, qty/discount 1.

- [ ] **Step 7: Typecheck + manual smoke**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.
Manual (after deploy, Task 12): pick a hardware product → qty rejects decimals; switch type to Service → qty accepts `2.5`; type a custom name → ad-hoc line still submits.

- [ ] **Step 8: Commit**

```bash
git add src/components/cpq/quote-create-dialog.tsx
git commit -m "feat(cpq): New Quote dialog — catalog picker + type + sku + conditional qty (wide row)"
```

---

## Task 10: Quote detail editor — add Type/SKU columns

**Files:**
- Modify: `src/app/(dashboard)/quotes/[id]/page.tsx`

- [ ] **Step 1: Add Type + SKU table headers; re-apportion widths**

In the `<thead>` (~472-477), insert after the product header and adjust widths so the row fits (drop product to `w-[22%]`, add `Type w-[120px]`, `SKU w-[110px]`):

```tsx
<th className="px-4 py-2 font-medium w-[22%]">{t("col.product")}</th>
<th className="px-4 py-2 font-medium w-[120px]">{t("lineType.label")}</th>
<th className="px-4 py-2 font-medium w-[110px]">{t("lineType.sku")}</th>
<th className="px-4 py-2 font-medium">{t("col.description")}</th>
<th className="px-4 py-2 font-medium w-[80px]">{t("col.qty")}</th>
...
```

Wrap the `<table>` in `<div className="overflow-x-auto">` so it scrolls rather than overflows on narrow viewports.

- [ ] **Step 2: Add the Type `<select>` + SKU `<Input>` + swap qty to `QuantityInput`**

In the `<tbody>` row, after the product `<td>` (the product cell becomes a `ProductCombobox` like Task 9), add cells. Import `QuantityInput`, `ProductCombobox`, `LINE_TYPES`. Replace the qty cell (line ~491) with:

```tsx
<td className="px-2 py-1">
  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={String(l.productType ?? "other")}
    disabled={isTerminal} onChange={(e) => updateLine(i, "productType", e.target.value)}>
    {LINE_TYPES.map((lt) => <option key={lt} value={lt}>{t(`lineType.${lt}`)}</option>)}
  </select>
</td>
<td className="px-2 py-1">
  <Input value={String(l.sku ?? "")} disabled={isTerminal} onChange={(e) => updateLine(i, "sku", e.target.value)} />
</td>
```

And the qty cell:

```tsx
<td className="px-2 py-1">
  <QuantityInput productType={String(l.productType ?? "other")} value={String(l.quantity)}
    disabled={isTerminal} onChange={(v) => updateLine(i, "quantity", v)} />
</td>
```

(This page's `updateLine(i, key, value)` is key-based — keep that signature here; pass `"productType"`/`"sku"`/`"quantity"`.)

- [ ] **Step 3: Wire load + SAVE of the new fields (critical — easy to miss)**

The GET quote serializer uses `include: { lineItems }` (full pass-through), so `productType`/`sku` auto-surface on load after the migration — no GET change needed. But the **PATCH submit map silently drops them** unless you edit three spots:

1. The `LineItem` interface (~page.tsx:39-50): add `productType?: string` and `sku?: string | null`.
2. `emptyLine()` (~page.tsx:117): add `productType: "other"` and `sku: ""`.
3. The submit `lineItems` map (~page.tsx:186-198) — add to each `item`:

```ts
        productType: l.productType ?? "other",
        ...(l.sku && String(l.sku).trim() ? { sku: String(l.sku).trim() } : {}),
```

Without spot 3 the Type/SKU columns edit + display but never persist (the architect's P2).

- [ ] **Step 4: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/quotes/[id]/page.tsx"
git commit -m "feat(cpq): quote detail editor — Type/SKU columns + picker + conditional qty"
```

---

## Task 11: Products management form — sku/type fields

**Files:**
- Modify: `src/app/(dashboard)/products/page.tsx` (create form)
- Modify: `src/app/(dashboard)/products/[id]/page.tsx` (edit form)

- [ ] **Step 1: Add SKU input + Type `<select>` to the product create form**

In `products/page.tsx`'s create form state + JSX, add a `sku` text input and a `productType` `<select>` (options from `LINE_TYPES`, labels `t("lineType.*")`), and include both in the POST body to `/api/v1/products` (Task 3 accepts them).

- [ ] **Step 2: Same for the edit form**

In `products/[id]/page.tsx`, surface `sku` + `productType` (prefill from the loaded product) and send them on save.

- [ ] **Step 3: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/products/page.tsx" "src/app/(dashboard)/products/[id]/page.tsx"
git commit -m "feat(cpq): product create/edit forms — sku + productType"
```

---

## Task 12: Full verification + deploy

- [ ] **Step 1: Full typecheck + test suite**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` → exit 0.
Run: `npx vitest run src/__tests__/lib-cpq-*.test.ts` → all PASS.
Confirm the existing CPQ totals tests still pass: `npx vitest run src/__tests__/lib-cpq-totals.test.ts`.

- [ ] **Step 2: Codex self-review**

Review the full diff against the task scope; resolve any correctness, UX, or safety finding before deploy.

- [ ] **Step 3: Deploy (ASK FIRST)**

Read `clients/registry.json`, ask the user which client(s). On ack: `git push origin main` → CI. Verify the run goes green in the GitHub Actions tab and `/api/v1/ping` is healthy.

- [ ] **Step 4: Manual prod verification (Chrome)**

On the chosen tenant: open New Quote → pick a hardware product (autofills name/sku/type/price; qty rejects decimals) → switch a line to Service (qty accepts `2.5`) → type a custom name (ad-hoc line submits) → save → reopen in the detail editor (Type/SKU columns populated, qty mode matches type). Confirm an unrelated dialog (e.g. a settings dialog) is still the old width.

- [ ] **Step 5: Reconcile the deferred-findings note**

The integer-quantity P3 (`asPositive` route tightening) raised earlier is now fully resolved by this feature — close it in `memory/deferred_findings.md` if it was logged.

---

## Self-Review

**Spec coverage:** §3 taxonomy → Task 1; §4 data model → Task 2; §5 conditional quantity + reconciliation → Task 4 (+ Task 7 UI); §6.1 dialog width → Task 6; §6.2 combobox + row rebuild → Tasks 8/9; §6.3 detail table → Task 10; §7 API (both routes + products GET) → Tasks 3/4; §8 i18n → Task 5; §9 tests → Tasks 1/4; product catalog populating sku/type → Task 11. All sections mapped.

**Placeholder scan:** No "TBD/TODO"; every code step has concrete code. Two spots delegate to grep-and-match existing patterns (Task 4 snapshot site, Task 10 GET serializer) — these are "match the existing productName snapshot at the same line" instructions, not placeholders, because the exact sibling code is named.

**Type consistency:** `LINE_TYPES`/`isDecimalLineType` (Task 1) reused verbatim in Tasks 3/4/7/9/10/11; `LineDraft` patch-merge `updateLine` (Task 9) is internally consistent; `CatalogProduct` shape (Task 8) matches the products GET `select` (Task 3) and the create dialog `onSelect` (Task 9).
