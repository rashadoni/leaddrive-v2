# Sprint E-4: Date Range Filters for Finance Dashboard

**Priority**: Medium
**Estimate**: 5-6 hours
**Depends on**: All finance audit tickets (A/B/C/D/E groups) — DONE

## Goal
Add dateFrom/dateTo date range picker to the finance dashboard Overview tab so users can filter all KPIs, charts, and alerts by arbitrary period (not just by year).

## Current State
- Dashboard currently only supports `?year=YYYY` — full calendar year
- All Prisma queries filter by `plan.year` for budget data
- Registry/payments queries have no date filter on dashboard

## Tickets

### E-4.1: Backend — Refactor Dashboard API (2h)
**File**: `src/app/api/finance/dashboard/route.ts`

1. Accept new query params: `dateFrom`, `dateTo` (ISO strings)
2. If dateFrom/dateTo provided, override year-based logic:
   - Budget actuals: filter by `expenseDate BETWEEN dateFrom AND dateTo`
   - Invoices: filter by `issueDate` or `dueDate` in range
   - Bills: filter by `issueDate` or `dueDate` in range
   - Cash flow entries: filter by month range derived from dates
   - Registry: filter by `paymentDate` in range
3. Revenue trend: show only months within range (not always 12)
4. Keep backward compatibility: if no dateFrom/dateTo, use year param as before

### E-4.2: Frontend — Date Range Picker Component (1.5h)
**File**: `src/components/finance/finance-dashboard.tsx`

1. Add `DateRangePicker` component (use shadcn/ui `Calendar` + `Popover`)
2. State: `dateRange: { from: Date | null, to: Date | null }`
3. Presets: "Этот месяц", "Прошлый месяц", "Этот квартал", "Этот год", "YTD"
4. Place next to year selector (replace year selector when custom range active)
5. Pass dateFrom/dateTo to `useFinanceDashboard()` hook

### E-4.3: Hook & Types Update (0.5h)
**File**: `src/lib/finance/hooks.ts`, `src/lib/finance/types.ts`

1. Update `useFinanceDashboard()` to accept optional `dateFrom`, `dateTo`
2. Build query string with dateFrom/dateTo params
3. Update `FinanceDashboardData` if response shape changes

### E-4.4: Subpage Filters — A/R, A/P, Registry (1h)
**Files**:
- `src/app/api/finance/receivables/route.ts`
- `src/app/api/finance/payables/stats/route.ts`
- `src/components/finance/ar-dashboard.tsx`
- `src/components/finance/ap-dashboard.tsx`

1. Accept dateFrom/dateTo on stats endpoints
2. Add date picker to A/R and A/P tabs
3. Registry already has dateFrom/dateTo support

### E-4.5: Excel Export with Date Filters (0.5h)
**File**: `src/app/api/finance/dashboard/export/route.ts`

1. Accept dateFrom/dateTo params
2. Filter all export data by date range
3. Include period in filename: `finance-2026-Q1.xlsx`

## Dependencies
- shadcn/ui Calendar component (may need to install: `npx shadcn@latest add calendar`)
- date-fns for date manipulation

## Testing Checklist
- [ ] Default view (year only) still works unchanged
- [ ] Custom range filters all KPIs correctly
- [ ] Revenue trend shows correct months for range
- [ ] Aging buckets recalculate for date range
- [ ] Presets (YTD, this quarter, etc.) work
- [ ] Excel export respects date range
- [ ] URL params preserved on page reload
