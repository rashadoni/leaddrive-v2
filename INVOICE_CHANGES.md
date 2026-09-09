# Invoice Module Changes (Session Mar 24, 2026)

## Summary of all changes made this session

### 1. PDF — Multilingual support + payment terms label fix
**File:** `src/app/api/v1/invoices/[id]/pdf/route.ts`
- Added `LABELS` dictionary with full AZ/RU/EN label sets
- `invoice.documentLanguage` field used to select language (az/ru/en)
- All hardcoded AZ strings replaced with `L.*` variables
- Payment terms label: "Şərtlər" → "Ödəniş şərtləri"
- Payment terms values: "net30" → "30 gün" / "30 дней" / "Net 30"
- Stamp size increased to 185px

### 2. Invoice List page — icon buttons
**File:** `src/app/(dashboard)/invoices/page.tsx`
- Replaced text "Bax/Sil" buttons with icon buttons (Eye/Pencil/Download/Trash)
- Each button has tooltip (title attribute)
- Pencil navigates to `/invoices/[id]/edit`
- Download opens PDF directly in new tab

### 3. Invoice Detail page — translations fixed
**File:** `src/app/(dashboard)/invoices/[id]/page.tsx`
- Status key format fixed: `status_${stage}` → `status.${stage}`
- Payment terms display: raw DB value (`net30`) → translated (`t(invoice.paymentTerms)`)
- Edit button navigates to full edit page `/invoices/[id]/edit`

### 4. Full Invoice Edit page (NEW)
**File:** `src/app/(dashboard)/invoices/[id]/edit/page.tsx` (new file)
- Pre-loads invoice data via GET, fills all fields
- Full items table: add/remove/edit (name, desc, qty, price, discount)
- "From Products" catalog button
- Live summary sidebar: subtotal, discount, VAT, total (sticky, `items-start` on grid)
- Saves via PUT `/api/v1/invoices/[id]`, redirects to detail page on success

### 5. Create Invoice page — layout fixed
**File:** `src/app/(dashboard)/invoices/create/page.tsx`
- Removed right sidebar (summary moved to BOTTOM of page)
- Full-width `space-y-6` layout (no grid columns)
- Summary + Actions cards appear at the bottom after all content

### 6. Translation keys added
**Files:** `messages/az.json`, `messages/en.json`, `messages/ru.json`

Added to `invoices` section in all 3 files:
- `tabOverview`, `tabItems`, `tabPayments`, `tabActivity`, `tabPreview`
- `totalAmount`, `send`, `invoiceDetails`, `notFound`, `daysOverdue`, `days`
- `paidDate`, `linkedDeal`, `discountTotal`, `paymentHistory`, `noPayments`, `noItems`
- `clientInfo`, `system`, `referencePlaceholder`, `amount`, `method`, `reference`
- `sending`, `subject`, `message`, `messagePlaceholder`
- `paymentMethod_bank_transfer/cash/card/check/other`
- `noActivity`, `activityCreated/Sent/Viewed/Paid/PaymentRecorded`
- `colServiceName`, `colQuantity`, `colAmountCurrency`

## Current production state
- All invoice pages work at `v2.leaddrivecrm.org/invoices`
- Create: full-width, summary at bottom
- Edit: 3-col grid with sticky sidebar on right
- Detail: all tabs/labels translated, no raw keys
- PDF: multilingual (az/ru/en), correct payment terms labels
