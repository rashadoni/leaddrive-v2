# Configurable Plans + Wizard Scaffolding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tenant tier-plans from the hardcoded `TENANT_PLANS` const into a DB-backed, superadmin-editable `PlanTemplate` catalog (so new tariffs can be added from the UI), and let the tenant-creation wizard customize the seeded scaffolding (pipeline stages / task types / event types / currencies).

**Architecture:** New global `PlanTemplate` table is the source of truth for provisioning defaults; a new **server-only** module `src/lib/plan-templates.ts` reads it (async) with a bounded fallback to the existing `TENANT_PLANS` const for the 3 legacy keys, and hard-fails on unknown keys. `tenant-plans.ts` stays pure data (client-safe). The runtime access gate (`hasModule` on `Organization.features`) and the live limit checks (`checkUserLimit`/`checkContactLimit`, already DB-backed) are **untouched** — custom plans are just named bundles of `features`/`addons`/limits materialized onto `Organization` at provisioning.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 + PostgreSQL, Zod, Vitest, bcryptjs.

---

## Verified runtime blast radius (read before starting)

Spec §2.1 listed ~8 plan-name consumers. Verified runtime status (grep evidence in session):

| Consumer | Status | Action |
|---|---|---|
| `src/app/api/v1/admin/tenants/route.ts:91` `validPlans` allowlist | **LIVE** — blocks new tariffs at API | **Task 8 (fix)** |
| `src/app/api/v1/admin/tenants/route.ts:126` `PLAN_LABELS[…]` welcome email | **LIVE** — cosmetic, degrades to slug | **Task 8 (fix)** |
| `src/app/admin/tenants/new/page.tsx:46,85,89` wizard defaults from `TENANT_PLANS` | **LIVE** — defaults won't load for custom key | **Task 10 (fix)** |
| `src/lib/tenant-provisioning.ts:146` MTM seed `plan === "enterprise"` | **LIVE** | **Task 5 (fix)** |
| `getPlanDefaults` (tenant-plans.ts) | **LIVE** (sole caller: provisioning) | **Task 4 (fix)** |
| `src/lib/plan-limits.ts` `checkLimit`/`getLimit` (zero-on-unknown) | **DEAD at runtime** — test-only (`lib-lead-segment-contact.test.ts`); live checks use DB-backed `checkUserLimit`/`checkContactLimit` | **Task 14 (optional cleanup, NOT a blocker)** |
| `src/lib/plan-config.ts` `canAccessModule`/`isSidebarItemAccessible` | **DEAD** — only ref is commented-out import in `middleware.ts:5` | No action (leave; note in Task 14) |

**Principle:** never branch on the plan *name* at runtime; rely on materialized `Organization.features`/`addons`/`maxUsers`/`maxContacts`.

## File structure

**Create:**
- `src/lib/plan-catalog.ts` — `FEATURE_CATALOG`, `ADDON_CATALOG` (allowed keys) + helpers.
- `src/lib/plan-templates.ts` — **server-only**: async `getPlanDefaults`, `listActivePlans`, CRUD helpers (imports `prisma`).
- `prisma/migrations/<ts>_add_plan_templates/migration.sql` — generated.
- `scripts/seed-plan-templates.mjs` — idempotent, non-destructive seed of legacy 3.
- `src/app/api/v1/admin/plans/route.ts` — GET (list) + POST (create).
- `src/app/api/v1/admin/plans/[id]/route.ts` — PATCH + DELETE (atomic guard).
- `src/app/admin/plans/page.tsx` + `src/app/admin/plans/plans-client.tsx` — superadmin UI.
- `src/__tests__/lib-plan-catalog.test.ts`, `src/__tests__/lib-plan-templates.test.ts`, `src/__tests__/api-admin-plans.test.ts`.

**Modify:**
- `prisma/schema.prisma` — add `PlanTemplate` model + `@@index([plan])` on `Organization`.
- `src/lib/tenant-plans.ts` — keep const + `PLAN_LABELS`; **remove** the sync `getPlanDefaults` (moves to plan-templates.ts).
- `src/lib/tenant-provisioning.ts` — async `getPlanDefaults` import; MTM effective-modules; optional scaffolding params.
- `src/app/api/v1/admin/tenants/route.ts` — DB plan validation; `PLAN_LABELS` fallback to `PlanTemplate.name`; pass scaffolding through.
- `src/app/admin/tenants/new/page.tsx` — plans from API; remove `as TenantPlan`; scaffolding editor (Phase 2).

---

# PHASE 1 — Configurable plans

### Task 1: Feature/addon catalog + drift guard

**Files:**
- Create: `src/lib/plan-catalog.ts`
- Test: `src/__tests__/lib-plan-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/lib-plan-catalog.test.ts
import { describe, it, expect } from "vitest"
import { FEATURE_CATALOG, ADDON_CATALOG, isKnownFeature, isKnownAddon } from "@/lib/plan-catalog"
import { TENANT_PLANS } from "@/lib/tenant-plans"

describe("plan-catalog", () => {
  it("every TENANT_PLANS feature is in FEATURE_CATALOG (drift guard)", () => {
    for (const plan of Object.values(TENANT_PLANS)) {
      for (const f of plan.features) expect(FEATURE_CATALOG).toContain(f)
    }
  })
  it("every TENANT_PLANS addon is in ADDON_CATALOG (drift guard)", () => {
    for (const plan of Object.values(TENANT_PLANS)) {
      for (const a of plan.addons) expect(ADDON_CATALOG).toContain(a)
    }
  })
  it("validators reject unknown keys", () => {
    expect(isKnownFeature("deals")).toBe(true)
    expect(isKnownFeature("nope")).toBe(false)
    expect(isKnownAddon("ai")).toBe(true)
    expect(isKnownAddon("nope")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib-plan-catalog.test.ts`
Expected: FAIL — cannot import from `@/lib/plan-catalog` (module not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/plan-catalog.ts
import { MODULE_REGISTRY, ADDON_MODULES, SEPARATE_SUBSCRIPTIONS, PAID_ADDONS } from "@/lib/modules"

// Feature flags that gate UI/modules but are NOT in MODULE_REGISTRY (verified in TENANT_PLANS).
const EXTRA_FEATURE_FLAGS = ["whatsapp", "complaints_register"] as const

export const FEATURE_CATALOG: string[] = [
  ...Object.keys(MODULE_REGISTRY),
  ...EXTRA_FEATURE_FLAGS,
]

export const ADDON_CATALOG: string[] = Array.from(
  new Set([
    ...Object.keys(ADDON_MODULES),
    ...Object.keys(SEPARATE_SUBSCRIPTIONS),
    ...Object.keys(PAID_ADDONS),
    "voip", // used as an addon in TENANT_PLANS.enterprise but absent from the maps above
  ]),
)

export function isKnownFeature(key: string): boolean {
  return FEATURE_CATALOG.includes(key)
}
export function isKnownAddon(key: string): boolean {
  return ADDON_CATALOG.includes(key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib-plan-catalog.test.ts`
Expected: PASS (3 tests). If the drift guard fails, a real `TENANT_PLANS` key is missing from the catalog — add it to `EXTRA_FEATURE_FLAGS`/`ADDON_CATALOG`, don't loosen the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan-catalog.ts src/__tests__/lib-plan-catalog.test.ts
git commit -m "feat(plans): add feature/addon catalog with drift guard"
```

---

### Task 2: `PlanTemplate` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model near other org-level config; add index on `Organization`)

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

```prisma
model PlanTemplate {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  description String?
  features    String[] @default([])
  addons      String[] @default([])
  maxUsers    Int      @default(3)
  maxContacts Int      @default(500)
  isActive    Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([isActive, sortOrder])
  @@map("plan_templates")
}
```

- [ ] **Step 2: Add the in-use lookup index on `Organization`**

In `model Organization { … }`, add alongside the other `@@` lines:

```prisma
  @@index([plan])
```

- [ ] **Step 3: Create the migration (local dev DB)**

Run: `npx prisma migrate dev --name add_plan_templates`
Expected: creates `prisma/migrations/<ts>_add_plan_templates/migration.sql` with `CREATE TABLE "plan_templates"` + `CREATE INDEX … ON "organizations"("plan")`, and regenerates the client.

> If the local dev DB is unavailable/drifted (known issue per CLAUDE.md), instead run
> `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` to author the SQL, place it under a new migration folder, and apply on the server with `prisma migrate deploy` at rollout. Do NOT `migrate reset` a shared DB.

- [ ] **Step 4: Verify client types**

Run: `npx tsc --noEmit`
Expected: PASS — `prisma.planTemplate` is now typed.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(plans): add PlanTemplate model + Organization.plan index"
```

---

### Task 3: Idempotent, non-destructive seed of the 3 legacy plans

**Files:**
- Create: `scripts/seed-plan-templates.mjs`

- [ ] **Step 1: Write the seed script**

```javascript
// scripts/seed-plan-templates.mjs
// Idempotent + NON-DESTRUCTIVE: inserts the 3 legacy plans only if their key is absent.
// Never overwrites an operator-edited plan. Safe to run on every deploy.
// Usage: node scripts/seed-plan-templates.mjs
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// Mirror of TENANT_PLANS (src/lib/tenant-plans.ts) — keep in sync if the const changes.
const LEGACY = [
  { key: "starter", name: "Starter", features: [], addons: [], maxUsers: 3, maxContacts: 500, sortOrder: 0 },
  { key: "professional", name: "Professional", features: ["whatsapp", "ai", "complaints_register"], addons: ["ai", "channels"], maxUsers: 25, maxContacts: 10000, sortOrder: 1 },
  { key: "enterprise", name: "Enterprise", features: ["whatsapp", "ai", "voip", "portal", "events", "complaints_register"], addons: ["ai", "channels", "finance", "mtm", "voip"], maxUsers: -1, maxContacts: -1, sortOrder: 2 },
]

async function main() {
  for (const p of LEGACY) {
    const existing = await prisma.planTemplate.findUnique({ where: { key: p.key } })
    if (existing) {
      console.log(`skip ${p.key} (exists, not overwriting)`)
      continue
    }
    await prisma.planTemplate.create({ data: p })
    console.log(`created ${p.key}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Run it against local dev DB**

Run: `node scripts/seed-plan-templates.mjs`
Expected: `created starter` / `created professional` / `created enterprise` on first run; all `skip … (exists…)` on second run (proves idempotent + non-destructive).

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-plan-templates.mjs
git commit -m "feat(plans): idempotent non-destructive seed for legacy plan templates"
```

---

### Task 4: Server-only DB-backed `getPlanDefaults` (bounded fallback, hard-fail unknown)

**Files:**
- Create: `src/lib/plan-templates.ts`
- Modify: `src/lib/tenant-plans.ts` (remove sync `getPlanDefaults`; keep const + `PLAN_LABELS` + types)
- Modify: `src/lib/tenant-provisioning.ts:2,68` (import from new module; `await`)
- Test: `src/__tests__/lib-plan-templates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/lib-plan-templates.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { planTemplate: { findFirst: vi.fn(), findMany: vi.fn() } },
}))

import { getPlanDefaults } from "@/lib/plan-templates"
import { prisma } from "@/lib/prisma"

beforeEach(() => vi.clearAllMocks())

describe("getPlanDefaults", () => {
  it("returns the DB row when an active plan exists", async () => {
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({
      key: "pharma", maxUsers: 40, maxContacts: 9000, features: ["deals"], addons: ["ai"],
    } as any)
    const d = await getPlanDefaults("pharma")
    expect(d).toEqual({ maxUsers: 40, maxContacts: 9000, features: ["deals"], addons: ["ai"] })
  })
  it("falls back to the const for a legacy key when DB is empty", async () => {
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue(null)
    const d = await getPlanDefaults("starter")
    expect(d).toEqual({ maxUsers: 3, maxContacts: 500, features: [], addons: [] })
  })
  it("throws for an unknown/inactive key with no DB row", async () => {
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue(null)
    await expect(getPlanDefaults("ghost")).rejects.toThrow(/Unknown or inactive plan/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib-plan-templates.test.ts`
Expected: FAIL — `@/lib/plan-templates` not found.

- [ ] **Step 3: Create `src/lib/plan-templates.ts`**

```typescript
// src/lib/plan-templates.ts — SERVER ONLY (imports prisma). Do not import from client components.
import { prisma } from "@/lib/prisma"
import { TENANT_PLANS, type TenantPlan } from "@/lib/tenant-plans"

export interface PlanDefaults {
  maxUsers: number
  maxContacts: number
  features: string[]
  addons: string[]
}

const LEGACY_PLAN_KEYS = new Set<string>(["starter", "professional", "enterprise"])

export async function getPlanDefaults(key: string): Promise<PlanDefaults> {
  const row = await prisma.planTemplate.findFirst({ where: { key, isActive: true } })
  if (row) {
    return { maxUsers: row.maxUsers, maxContacts: row.maxContacts, features: row.features, addons: row.addons }
  }
  if (LEGACY_PLAN_KEYS.has(key)) {
    const d = TENANT_PLANS[key as TenantPlan]
    console.warn(`[plans] DB miss for legacy key "${key}" — using const fallback`)
    return { maxUsers: d.maxUsers, maxContacts: d.maxContacts, features: [...d.features], addons: [...d.addons] }
  }
  throw new Error(`Unknown or inactive plan "${key}"`)
}

export async function listActivePlans() {
  return prisma.planTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
}
```

- [ ] **Step 4: Remove the sync `getPlanDefaults` from `src/lib/tenant-plans.ts`**

Delete the `export function getPlanDefaults(...) { ... }` block (lines ~32-46). Keep `TENANT_PLANS`, `TenantPlan`, `PLAN_LABELS`. This keeps `tenant-plans.ts` free of `prisma` so it stays client-safe.

- [ ] **Step 5: Update the sole caller in `src/lib/tenant-provisioning.ts`**

Line 2 — change import:
```typescript
import { getPlanDefaults } from "@/lib/plan-templates"
```
Line 68 — `await` it:
```typescript
  const planDefaults = await getPlanDefaults(input.plan)
```
(`provisionTenant` is already `async`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/__tests__/lib-plan-templates.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests); no type errors. If `tsc` flags another importer of the removed `getPlanDefaults`, switch it to `@/lib/plan-templates` (none expected — verified sole caller).

- [ ] **Step 7: Commit**

```bash
git add src/lib/plan-templates.ts src/lib/tenant-plans.ts src/lib/tenant-provisioning.ts src/__tests__/lib-plan-templates.test.ts
git commit -m "feat(plans): DB-backed getPlanDefaults with bounded fallback (server-only)"
```

---

### Task 5: MTM agent seeding off effective modules (not plan name)

**Files:**
- Modify: `src/lib/tenant-provisioning.ts:144-157`
- Test: `src/__tests__/lib-tenant-provisioning-mtm.test.ts`

- [ ] **Step 1: Write the failing test** (pure helper, no DB)

Add an exported pure helper and test it:

```typescript
// src/__tests__/lib-tenant-provisioning-mtm.test.ts
import { describe, it, expect } from "vitest"
import { effectiveModulesEnableMtm } from "@/lib/tenant-provisioning"

describe("effectiveModulesEnableMtm", () => {
  it("true when features include mtm", () => {
    expect(effectiveModulesEnableMtm(["mtm"], [])).toBe(true)
  })
  it("true when an addon expands to mtm", () => {
    expect(effectiveModulesEnableMtm([], ["mtm"])).toBe(true)
  })
  it("false otherwise", () => {
    expect(effectiveModulesEnableMtm(["deals"], ["ai"])).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib-tenant-provisioning-mtm.test.ts`
Expected: FAIL — `effectiveModulesEnableMtm` not exported.

- [ ] **Step 3: Add the helper + use it**

At the top of `src/lib/tenant-provisioning.ts` add the import and helper:
```typescript
import { ADDON_MODULES } from "@/lib/modules"

export function effectiveModulesEnableMtm(features: string[], addons: string[]): boolean {
  const mods = new Set<string>(features)
  for (const a of addons) for (const m of ADDON_MODULES[a] ?? []) mods.add(m)
  return mods.has("mtm")
}
```
Replace the MTM block (lines ~144-157) condition:
```typescript
    // 6. Create MTM agent if the effective module set includes MTM (features ∪ addon→module)
    const features = input.features || planDefaults.features
    const addons = planDefaults.addons
    if (effectiveModulesEnableMtm(features, addons)) {
      await tx.mtmAgent.create({
        data: {
          organizationId: organization.id,
          name: input.adminName,
          email: input.adminEmail,
          role: "MANAGER",
          userId: user.id,
          passwordHash,
        },
      })
    }
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/__tests__/lib-tenant-provisioning-mtm.test.ts && npx tsc --noEmit`
Expected: PASS (3 tests); no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-provisioning.ts src/__tests__/lib-tenant-provisioning-mtm.test.ts
git commit -m "fix(plans): seed MTM agent off effective modules, not plan name"
```

---

### Task 6: Plans CRUD API — list + create

**Files:**
- Create: `src/app/api/v1/admin/plans/route.ts`
- Test: `src/__tests__/api-admin-plans.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api-admin-plans.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { planTemplate: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() }, organization: { count: vi.fn() }, $transaction: vi.fn() },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/superadmin-guard", () => ({ requireSuperAdmin: vi.fn() }))

import { GET, POST } from "@/app/api/v1/admin/plans/route"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"

const AUTH = { orgId: "org-1", userId: "user-1", role: "superadmin", email: "a@b.c", name: "A" }
const makeReq = (init?: any) => new NextRequest(new URL("http://localhost/api/v1/admin/plans"), init)

beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireSuperAdmin).mockResolvedValue(AUTH as any) })

describe("GET /api/v1/admin/plans", () => {
  it("lists plans for superadmin", async () => {
    vi.mocked(prisma.planTemplate.findMany).mockResolvedValue([{ id: "p1", key: "starter" }] as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(1)
  })
})

describe("POST /api/v1/admin/plans", () => {
  it("rejects an unknown feature key (400)", async () => {
    const res = await POST(makeReq({ method: "POST", body: JSON.stringify({ key: "pharma", name: "Pharma", features: ["nope"], addons: [], maxUsers: 10, maxContacts: 100 }) }))
    expect(res.status).toBe(400)
  })
  it("creates a valid plan (201)", async () => {
    vi.mocked(prisma.planTemplate.create).mockResolvedValue({ id: "p9", key: "pharma" } as any)
    const res = await POST(makeReq({ method: "POST", body: JSON.stringify({ key: "pharma", name: "Pharma", features: ["deals"], addons: ["ai"], maxUsers: 40, maxContacts: 9000 }) }))
    expect(res.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api-admin-plans.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/v1/admin/plans/route.ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { isKnownFeature, isKnownAddon } from "@/lib/plan-catalog"

const SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

const createSchema = z.object({
  key: z.string().regex(SLUG, "key must be a 3-30 char slug"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  features: z.array(z.string()).default([]).refine((a) => a.every(isKnownFeature), "unknown feature key"),
  addons: z.array(z.string()).default([]).refine((a) => a.every(isKnownAddon), "unknown addon key"),
  maxUsers: z.number().int().gte(-1),
  maxContacts: z.number().int().gte(-1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
})

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const plans = await prisma.planTemplate.findMany({ orderBy: { sortOrder: "asc" } })
  return NextResponse.json({ success: true, data: plans })
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const plan = await prisma.planTemplate.create({ data: parsed.data })
    logAudit(auth.orgId, "create", "plan_template", plan.id, plan.name, { newValue: parsed.data })
    return NextResponse.json({ success: true, data: plan }, { status: 201 })
  } catch (e: any) {
    if (e.code === "P2002") return NextResponse.json({ error: `Plan key "${parsed.data.key}" already exists` }, { status: 409 })
    console.error("[plans POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/api-admin-plans.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/admin/plans/route.ts src/__tests__/api-admin-plans.test.ts
git commit -m "feat(plans): superadmin plans list+create API with catalog validation"
```

---

### Task 7: Plans CRUD API — update + atomic delete guard

**Files:**
- Create: `src/app/api/v1/admin/plans/[id]/route.ts`
- Test: append to `src/__tests__/api-admin-plans.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```typescript
import { PATCH, DELETE } from "@/app/api/v1/admin/plans/[id]/route"
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe("DELETE /api/v1/admin/plans/[id]", () => {
  it("blocks delete when the plan is in use (409)", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.planTemplate.findUnique).mockResolvedValue({ id: "p1", key: "starter" } as any)
    vi.mocked(prisma.organization.count).mockResolvedValue(2)
    const res = await DELETE(makeReq({ method: "DELETE" }), makeParams("p1"))
    expect(res.status).toBe(409)
  })
  it("deletes when unused (200)", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
    vi.mocked(prisma.planTemplate.findUnique).mockResolvedValue({ id: "p1", key: "ghost" } as any)
    vi.mocked(prisma.organization.count).mockResolvedValue(0)
    vi.mocked(prisma.planTemplate.delete).mockResolvedValue({ id: "p1" } as any)
    const res = await DELETE(makeReq({ method: "DELETE" }), makeParams("p1"))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api-admin-plans.test.ts`
Expected: FAIL — `[id]/route` not found.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/v1/admin/plans/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { isKnownFeature, isKnownAddon } from "@/lib/plan-catalog"

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  features: z.array(z.string()).refine((a) => a.every(isKnownFeature), "unknown feature key").optional(),
  addons: z.array(z.string()).refine((a) => a.every(isKnownAddon), "unknown addon key").optional(),
  maxUsers: z.number().int().gte(-1).optional(),
  maxContacts: z.number().int().gte(-1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}) // NOTE: `key` is intentionally NOT updatable.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  try {
    const plan = await prisma.planTemplate.update({ where: { id }, data: parsed.data })
    logAudit(auth.orgId, "update", "plan_template", plan.id, plan.name, { newValue: parsed.data })
    return NextResponse.json({ success: true, data: plan })
  } catch (e: any) {
    if (e.code === "P2025") return NextResponse.json({ error: "Not found" }, { status: 404 })
    console.error("[plans PATCH]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  try {
    // Atomic: re-check in-use INSIDE the transaction so a concurrent provision can't slip through.
    const result = await prisma.$transaction(async (tx: any) => {
      const plan = await tx.planTemplate.findUnique({ where: { id } })
      if (!plan) return { status: 404 as const }
      const inUse = await tx.organization.count({ where: { plan: plan.key } })
      if (inUse > 0) return { status: 409 as const, key: plan.key, inUse }
      await tx.planTemplate.delete({ where: { id } })
      return { status: 200 as const, key: plan.key }
    })
    if (result.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (result.status === 409) return NextResponse.json({ error: `Plan "${result.key}" is used by ${result.inUse} tenant(s). Deactivate it instead.` }, { status: 409 })
    logAudit(auth.orgId, "delete", "plan_template", id, result.key, {})
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error("[plans DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/api-admin-plans.test.ts`
Expected: PASS (all tests, including the 2 new delete-guard cases).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/v1/admin/plans/[id]/route.ts" src/__tests__/api-admin-plans.test.ts
git commit -m "feat(plans): plan update + atomic in-use delete guard"
```

---

### Task 8: Tenants provisioning API — DB-driven plan validation + label fallback

**Files:**
- Modify: `src/app/api/v1/admin/tenants/route.ts:90-94` (validation) and `:126` (label)
- Test: append to `src/__tests__/api-admin.test.ts`

- [ ] **Step 1: Write the failing test** (append; the file already mocks `prisma`, `requireSuperAdmin`, `provisionTenant`)

Add `planTemplate: { findFirst: vi.fn() }` to the prisma mock object in `api-admin.test.ts` (top mock block), then:

```typescript
describe("POST /api/v1/admin/tenants — DB plan validation", () => {
  it("rejects a plan with no active PlanTemplate (400)", async () => {
    vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue(null)
    const res = await POST(makeReq("http://localhost/api/v1/admin/tenants", {
      method: "POST",
      body: JSON.stringify({ companyName: "X", slug: "xco", adminName: "A", adminEmail: "a@b.c", plan: "ghost" }),
    }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api-admin.test.ts`
Expected: FAIL — current code accepts/forwards `ghost` (no DB check) so status ≠ 400.

- [ ] **Step 3: Replace the hardcoded `validPlans` block (lines 90-94)**

```typescript
    // Validate plan against the active PlanTemplate catalog (DB-driven)
    const planKey = plan || "starter"
    const planRow = await prisma.planTemplate.findFirst({ where: { key: planKey, isActive: true } })
    if (!planRow) {
      return NextResponse.json({ error: `Invalid or inactive plan "${planKey}"` }, { status: 400 })
    }
```
Then set `plan: planKey` in the `input` object below (instead of `plan || "starter"`).

- [ ] **Step 4: Fix the welcome-email label (line 126)**

```typescript
      const planLabel = planRow.name || PLAN_LABELS[(result.organization.plan as TenantPlan)] || result.organization.plan
```
(`planRow` is in scope from Step 3; `PLAN_LABELS` import stays as a secondary fallback.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/api-admin.test.ts && npx tsc --noEmit`
Expected: PASS. The pre-existing provisioning tests must still pass — if any provisioned a non-legacy plan without mocking `planTemplate.findFirst`, add `vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({ key:"starter", name:"Starter" } as any)` to that test's setup.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/admin/tenants/route.ts src/__tests__/api-admin.test.ts
git commit -m "feat(plans): provisioning API validates plan against DB catalog + label fallback"
```

---

### Task 9: Superadmin `/admin/plans` UI

**Files:**
- Create: `src/app/admin/plans/page.tsx` (server component — superadmin gate + initial fetch)
- Create: `src/app/admin/plans/plans-client.tsx` (client component — list + editor)

- [ ] **Step 1: Server page with superadmin gate**

```tsx
// src/app/admin/plans/page.tsx
import { redirect } from "next/navigation"
import { isSuperAdminSession } from "@/lib/superadmin-guard"
import { listActivePlans } from "@/lib/plan-templates"
import { prisma } from "@/lib/prisma"
import { FEATURE_CATALOG, ADDON_CATALOG } from "@/lib/plan-catalog"
import { MODULE_REGISTRY } from "@/lib/modules"
import PlansClient from "./plans-client"

export default async function AdminPlansPage() {
  if (!(await isSuperAdminSession())) redirect("/dashboard")
  const plans = await prisma.planTemplate.findMany({ orderBy: { sortOrder: "asc" } })
  const featureOptions = FEATURE_CATALOG.map((id) => ({ id, name: (MODULE_REGISTRY as any)[id]?.name ?? id }))
  const addonOptions = ADDON_CATALOG.map((id) => ({ id, name: id }))
  return <PlansClient initialPlans={JSON.parse(JSON.stringify(plans))} featureOptions={featureOptions} addonOptions={addonOptions} />
}
```

- [ ] **Step 2: Client component — list + create/edit/delete**

```tsx
// src/app/admin/plans/plans-client.tsx
"use client"
import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Plan = { id: string; key: string; name: string; description?: string | null; features: string[]; addons: string[]; maxUsers: number; maxContacts: number; isActive: boolean; sortOrder: number }
type Opt = { id: string; name: string }

export default function PlansClient({ initialPlans, featureOptions, addonOptions }: { initialPlans: Plan[]; featureOptions: Opt[]; addonOptions: Opt[] }) {
  const [plans, setPlans] = useState<Plan[]>(initialPlans)
  const [editing, setEditing] = useState<Partial<Plan> | null>(null)
  const isNew = editing && !editing.id

  async function save() {
    if (!editing) return
    const url = isNew ? "/api/v1/admin/plans" : `/api/v1/admin/plans/${editing.id}`
    const method = isNew ? "POST" : "PATCH"
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) })
    const json = await res.json()
    if (!res.ok) { alert(json.error || "Save failed"); return }
    setPlans((prev) => isNew ? [...prev, json.data] : prev.map((p) => (p.id === json.data.id ? json.data : p)))
    setEditing(null)
  }
  async function remove(p: Plan) {
    if (!confirm(`Delete plan "${p.name}"?`)) return
    const res = await fetch(`/api/v1/admin/plans/${p.id}`, { method: "DELETE" })
    const json = await res.json()
    if (!res.ok) { alert(json.error); return } // 409 in-use → suggests deactivate
    setPlans((prev) => prev.filter((x) => x.id !== p.id))
  }
  function toggle(field: "features" | "addons", id: string) {
    setEditing((e) => {
      if (!e) return e
      const arr = new Set(e[field] ?? [])
      arr.has(id) ? arr.delete(id) : arr.add(id)
      return { ...e, [field]: Array.from(arr) }
    })
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Plans</h1>
        <Button onClick={() => setEditing({ key: "", name: "", features: [], addons: [], maxUsers: 3, maxContacts: 500, isActive: true, sortOrder: plans.length })}>Add plan</Button>
      </div>
      <p className="text-sm text-muted-foreground">Editing a plan changes defaults for <strong>newly-provisioned</strong> tenants only; existing tenants keep their current settings.</p>

      <div className="grid gap-3">
        {plans.map((p) => (
          <Card key={p.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{p.name} <span className="text-xs text-muted-foreground">({p.key})</span> {!p.isActive && <span className="text-xs text-amber-600">inactive</span>}</div>
              <div className="text-xs text-muted-foreground">{p.features.length} features · {p.addons.length} addons · users {p.maxUsers === -1 ? "∞" : p.maxUsers} · contacts {p.maxContacts === -1 ? "∞" : p.maxContacts}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}>Edit</Button>
              <Button variant="outline" size="sm" onClick={() => remove(p)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <Card className="p-4 space-y-3">
          <h2 className="font-medium">{isNew ? "New plan" : `Edit ${editing.name}`}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Key {isNew ? "" : "(immutable)"}</Label><Input value={editing.key ?? ""} disabled={!isNew} onChange={(e) => setEditing({ ...editing, key: e.target.value })} /></div>
            <div><Label>Name</Label><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div><Label>Max users (-1 = ∞)</Label><Input type="number" value={editing.maxUsers ?? 3} onChange={(e) => setEditing({ ...editing, maxUsers: parseInt(e.target.value) })} /></div>
            <div><Label>Max contacts (-1 = ∞)</Label><Input type="number" value={editing.maxContacts ?? 500} onChange={(e) => setEditing({ ...editing, maxContacts: parseInt(e.target.value) })} /></div>
          </div>
          <div>
            <Label>Features</Label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {featureOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(editing.features ?? []).includes(o.id)} onChange={() => toggle("features", o.id)} />{o.name}</label>
              ))}
            </div>
          </div>
          <div>
            <Label>Add-ons</Label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {addonOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(editing.addons ?? []).includes(o.id)} onChange={() => toggle("addons", o.id)} />{o.name}</label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />Active</label>
          <div className="flex gap-2"><Button onClick={save}>Save</Button><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add `/admin/plans` to the admin nav**

Find the admin nav (grep `admin/tenants` in the admin layout/nav component) and add a `Plans` link to `/admin/plans` next to `Tenants`, mirroring the existing entry's markup.

- [ ] **Step 4: Verify build + manual smoke**

Run: `npx tsc --noEmit && npx next build --webpack 2>&1 | tail -5`
Expected: compiles. Manual: log in as superadmin → `/admin/plans` lists the 3 seeded plans, "Add plan" creates one, edit/delete work, delete of an in-use plan shows the 409 message.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/plans
git commit -m "feat(plans): superadmin /admin/plans management UI"
```

---

### Task 10: Wizard reads plans from DB (remove `TENANT_PLANS` coupling)

**Files:**
- Modify: `src/app/admin/tenants/new/page.tsx` (lines ~15-16 imports, ~46 init, ~85-89 `handlePlanChange`)

- [ ] **Step 1: Fetch plans from the API on mount + drive the dropdown/defaults from them**

Replace the `TENANT_PLANS` import (line 16) and usages:
```tsx
// remove: import { TENANT_PLANS, type TenantPlan } from "@/lib/tenant-plans"
type PlanOpt = { key: string; name: string; features: string[]; maxUsers: number; maxContacts: number }
const [plans, setPlans] = useState<PlanOpt[]>([])

useEffect(() => {
  fetch("/api/v1/admin/plans").then((r) => r.json()).then((j) => {
    const active = (j.data ?? []).filter((p: any) => p.isActive)
    setPlans(active)
    // initialize form defaults from the first plan
    if (active[0]) setForm((f) => ({ ...f, plan: active[0].key, features: [...active[0].features] }))
  })
}, [])
```
Replace `handlePlanChange` (lines ~85-89) — drop the `as TenantPlan` cast:
```tsx
function handlePlanChange(key: string) {
  const p = plans.find((x) => x.key === key)
  setForm((prev) => ({ ...prev, plan: key, features: p ? [...p.features] : prev.features }))
}
```
Replace the plan `<Select>` options to map over `plans` (`{plans.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}`). Initialize `form.plan` to `""` (filled by the fetch effect) and `form.features` to `[]`.

- [ ] **Step 2: Verify build + typecheck**

Run: `npx tsc --noEmit && npx next build --webpack 2>&1 | tail -5`
Expected: no references to `TENANT_PLANS`/`TenantPlan` remain in this file; compiles.

- [ ] **Step 3: Manual smoke**

Log in as superadmin → `/admin/tenants/new`: the plan dropdown lists DB plans (incl. any custom `pharma` created in Task 9); selecting one pre-fills feature toggles; submit provisions successfully.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/tenants/new/page.tsx
git commit -m "feat(plans): tenant wizard reads plans from DB catalog"
```

---

# PHASE 2 — Wizard scaffolding customization

### Task 11: `provisionTenant` accepts optional custom scaffolding

**Files:**
- Modify: `src/lib/tenant-provisioning.ts` (`TenantInput` interface + transaction steps 3/3b/3c/5)
- Test: append to `src/__tests__/lib-tenant-provisioning-mtm.test.ts` (rename describe or add a new test file `lib-tenant-provisioning-scaffolding.test.ts` if you prefer DB mocking)

- [ ] **Step 1: Extend the `TenantInput` interface**

```typescript
export interface TenantInput {
  companyName: string
  slug: string
  plan: string
  adminName: string
  adminEmail: string
  branding?: { primaryColor?: string; logo?: string }
  features?: string[]
  provisionedBy: string
  // Phase 2 — optional custom scaffolding; absent → DEFAULT_* constants
  pipelineStages?: Array<{ name: string; displayName: string; color: string; probability: number; sortOrder: number; isWon?: boolean; isLost?: boolean }>
  taskTypes?: Array<{ name: string; displayName: string; color: string; sortOrder: number }>
  eventTypes?: Array<{ name: string; displayName: string; color: string; sortOrder: number }>
  currencies?: Array<{ code: string; name: string; symbol: string; exchangeRate: number; isBase?: boolean }>
}
```

- [ ] **Step 2: Use the provided arrays or fall back to defaults**

In the transaction, replace the constant references:
```typescript
    const stages = input.pipelineStages ?? DEFAULT_PIPELINE_STAGES
    for (const s of stages) {
      await tx.pipelineStage.create({ data: { organizationId: organization.id, pipelineId: defaultPipeline.id, ...s } })
    }
    const taskTypes = input.taskTypes ?? DEFAULT_TASK_TYPES
    for (const tt of taskTypes) await tx.taskType.create({ data: { organizationId: organization.id, ...tt } })
    const eventTypes = input.eventTypes ?? DEFAULT_EVENT_TYPES
    for (const et of eventTypes) await tx.eventType.create({ data: { organizationId: organization.id, ...et } })
    const currencies = input.currencies ?? INITIAL_CURRENCIES
    for (const c of currencies) await tx.currency.create({ data: { organizationId: organization.id, ...c } })
```
(SLA policies stay default-only — not in scope.)

- [ ] **Step 3: Test — absent scaffolding uses defaults, provided scaffolding is used**

Add a unit test that calls a small extracted pure resolver OR asserts via a mocked `tx`. Minimal pure helper to make this testable without a DB:
```typescript
export function resolveScaffolding(input: Pick<TenantInput, "pipelineStages"|"taskTypes"|"eventTypes"|"currencies">) {
  return {
    stages: input.pipelineStages ?? DEFAULT_PIPELINE_STAGES,
    taskTypes: input.taskTypes ?? DEFAULT_TASK_TYPES,
    eventTypes: input.eventTypes ?? DEFAULT_EVENT_TYPES,
    currencies: input.currencies ?? INITIAL_CURRENCIES,
  }
}
```
Test:
```typescript
import { resolveScaffolding } from "@/lib/tenant-provisioning"
import { DEFAULT_TASK_TYPES } from "@/lib/constants"
it("falls back to defaults when absent", () => {
  expect(resolveScaffolding({}).taskTypes).toEqual(DEFAULT_TASK_TYPES)
})
it("uses provided arrays", () => {
  const custom = [{ name: "x", displayName: "X", color: "#fff", sortOrder: 0 }]
  expect(resolveScaffolding({ taskTypes: custom }).taskTypes).toEqual(custom)
})
```
Then use `resolveScaffolding` inside the transaction (replaces the four `??` lines with one call).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/lib-tenant-provisioning-mtm.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-provisioning.ts src/__tests__/lib-tenant-provisioning-mtm.test.ts
git commit -m "feat(plans): provisionTenant accepts optional custom scaffolding"
```

---

### Task 12: Tenants API passes + validates scaffolding

**Files:**
- Modify: `src/app/api/v1/admin/tenants/route.ts` (POST body destructure + `input` + validation)

- [ ] **Step 1: Add a zod schema for scaffolding + parse**

Near the top of the POST handler, after parsing `body`:
```typescript
import { z } from "zod"
const scaffoldingSchema = z.object({
  pipelineStages: z.array(z.object({ name: z.string().min(1), displayName: z.string().min(1), color: z.string(), probability: z.number().int().min(0).max(100), sortOrder: z.number().int(), isWon: z.boolean().optional(), isLost: z.boolean().optional() })).optional(),
  taskTypes: z.array(z.object({ name: z.string().min(1), displayName: z.string().min(1), color: z.string(), sortOrder: z.number().int() })).optional(),
  eventTypes: z.array(z.object({ name: z.string().min(1), displayName: z.string().min(1), color: z.string(), sortOrder: z.number().int() })).optional(),
  currencies: z.array(z.object({ code: z.string().min(1), name: z.string().min(1), symbol: z.string(), exchangeRate: z.number().positive(), isBase: z.boolean().optional() })).refine((cs) => cs.filter((c) => c.isBase).length <= 1, "at most one base currency").optional(),
}).partial()

const scaffolding = scaffoldingSchema.safeParse(body)
if (!scaffolding.success) return NextResponse.json({ error: scaffolding.error.issues[0].message }, { status: 400 })
```
Add the four fields to the `input` object: `...scaffolding.data`.

- [ ] **Step 2: Test — invalid scaffolding rejected**

Append to `api-admin.test.ts`:
```typescript
it("rejects 2 base currencies (400)", async () => {
  vi.mocked(validateSlug).mockResolvedValue({ valid: true } as any)
  vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({ key: "starter", name: "Starter" } as any)
  const res = await POST(makeReq("http://localhost/api/v1/admin/tenants", { method: "POST", body: JSON.stringify({ companyName: "X", slug: "xco", adminName: "A", adminEmail: "a@b.c", plan: "starter", currencies: [{ code: "USD", name: "USD", symbol: "$", exchangeRate: 1, isBase: true }, { code: "EUR", name: "EUR", symbol: "€", exchangeRate: 0.9, isBase: true }] }) }))
  expect(res.status).toBe(400)
})
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npx vitest run src/__tests__/api-admin.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/admin/tenants/route.ts src/__tests__/api-admin.test.ts
git commit -m "feat(plans): provisioning API accepts + validates custom scaffolding"
```

---

### Task 13: Wizard scaffolding editor UI

**Files:**
- Modify: `src/app/admin/tenants/new/page.tsx`

- [ ] **Step 1: Seed editable scaffolding state from defaults**

Import the defaults and initialize editable rows:
```tsx
import { DEFAULT_PIPELINE_STAGES, DEFAULT_TASK_TYPES, DEFAULT_EVENT_TYPES, INITIAL_CURRENCIES } from "@/lib/constants"
const [stages, setStages] = useState(DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })))
const [taskTypes, setTaskTypes] = useState(DEFAULT_TASK_TYPES.map((t) => ({ ...t })))
const [eventTypes, setEventTypes] = useState(DEFAULT_EVENT_TYPES.map((t) => ({ ...t })))
const [currencies, setCurrencies] = useState(INITIAL_CURRENCIES.map((c) => ({ ...c })))
```

- [ ] **Step 2: Add collapsible editor sections**

Add four `<details>` sections (one per entity), each rendering its rows with editable `displayName`/`color` inputs, an "add row" button (push a blank row), and a remove button per row. Mirror the inline-row style of `src/components/boards/config-type-section.tsx` for task/event types. Keep it minimal but functional — each row maps to the schema fields from Task 11.

- [ ] **Step 3: Include the arrays in the submit body**

In the existing submit `fetch("/api/v1/admin/tenants", …)` body, add: `pipelineStages: stages, taskTypes, eventTypes, currencies`.

- [ ] **Step 4: Verify build + manual smoke**

Run: `npx tsc --noEmit && npx next build --webpack 2>&1 | tail -5`
Manual: `/admin/tenants/new` shows editable scaffolding pre-filled with defaults; editing a stage name/color then provisioning a throwaway tenant lands the custom values (verify via `/settings/pipelines` in the new tenant).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/tenants/new/page.tsx
git commit -m "feat(plans): wizard scaffolding editor (stages/task types/event types/currencies)"
```

---

# CLEANUP + VERIFICATION

### Task 14 (optional): annotate dead plan-name code

**Files:** `src/lib/plan-limits.ts`, `src/lib/plan-config.ts`

- [ ] **Step 1:** Add a top-of-file comment to `plan-limits.ts` noting `checkLimit`/`getLimit`/`getRemainingLimit`/`getPercentageUsed` are **test-only** (live enforcement uses `checkUserLimit`/`checkContactLimit`, which are DB-backed and custom-plan-safe). Do NOT change behavior — `lib-lead-segment-contact.test.ts` still imports them. Add a comment to `plan-config.ts` noting it is currently unused at runtime (only a commented-out import in `middleware.ts:5`); custom plan names therefore do not affect nav.
- [ ] **Step 2: Commit** `git commit -am "docs(plans): mark plan-name limit/nav helpers as dead/test-only"`

### Task 15: Full verification + manual E2E

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx tsc --noEmit && npm run test`
Expected: all green (incl. the pre-existing `lib-lead-segment-contact.test.ts` plan-limits tests).

- [ ] **Step 2: Build**

Run: `npx next build --webpack 2>&1 | tail -5`
Expected: success.

- [ ] **Step 3: Manual E2E on a THROWAWAY tenant (NOT zeytunpharm) or local**

1. `/admin/plans` → create `pharma` (features incl. `mtm`, addons `[ai]`, maxUsers 40).
2. `/admin/tenants/new` → `pharma` appears; pick it; customize one pipeline stage name; provision tenant `qa-pharma`.
3. Verify: `Organization` row has `plan=pharma`, `features`/`addons`/`maxUsers/maxContacts` materialized correctly; MTM agent created (because effective modules include `mtm`); custom stage present in `/settings/pipelines`; login shows expected nav; adding users respects `maxUsers` (DB-backed check).
4. `/admin/plans` → try delete `pharma` → 409 (in use) → deactivate instead → no longer offered in wizard.
5. Tear down the throwaway tenant via the existing admin delete flow.

- [ ] **Step 4: Rollout (when user approves deploy + target)**

Per `scripts/client.sh deploy <target>` flow: `git pull` → `prisma migrate deploy` (creates `plan_templates` + index) → **then** `node scripts/seed-plan-templates.mjs` (idempotent, absent-only) → build → restart. Repeat per server (shared box + each per-client). Confirm target with the user first (deploy-ask-target rule).

---

## Self-review (completed against the spec)

- **Spec coverage:** Phase 1 (§4-§7,§9-§10) → Tasks 1-10. Phase 2 (§7c,§9b) → Tasks 11-13. Catalog reconciliation (§2.2) → Task 1. Migration/seed (§10) → Tasks 2-3 + Task 15.4. Plan-name audit (§2.1) → Tasks 5,8,10 (+ Task 14 for the verified-dead ones). Snapshot semantics (§8) → Task 9 UI copy + Task 4 (no retro-apply). Testing (§11) → per-task TDD + Task 15.
- **Placeholder scan:** none — every code step has concrete code; UI tasks (9,13) give real logic + functional skeletons referencing existing components to mirror styling.
- **Type consistency:** `getPlanDefaults` returns `PlanDefaults` (Task 4) used in Task 5/8; `PlanTemplate` fields (Task 2) match the CRUD zod schemas (Tasks 6-7) and seed (Task 3); `TenantInput` scaffolding shape (Task 11) matches the API zod schema (Task 12) and `DEFAULT_*` constants.
- **Correction vs spec:** spec §2.1 implied `plan-limits.ts`/`plan-config.ts` were live risks; verified they are dead/test-only (see "Verified runtime blast radius") — downgraded to optional Task 14, not blockers.
