# CLM Slice 4b-1: Contract Tags + Full-Text Search + Advanced Filters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-scoped contract tags (many-to-many), extend the contracts GET endpoint with full-text search across 5 fields + 6 new filters, and surface tag management + an advanced-filter panel in the contracts list UI.

**Architecture:** New `ContractTag` model + implicit Prisma m2m join table (Prisma auto-manages `_ContractToContractTag`). Tag CRUD lives at `/api/v1/contract-tags` + `[id]`. Tag assignment extends the existing `PUT /api/v1/contracts/[id]`. The GET `/api/v1/contracts` is widened in-place. The UI adds a tag filter, advanced-filter popover, tag chips on rows, and a tag-management inline form — all in the existing `contracts/page.tsx`.

**Tech Stack:** Prisma 5 (schema + raw migration SQL), Next.js App Router route handlers, Zod, Vitest, next-intl (en/ru/az surgical).

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `prisma/schema.prisma` | Modify | Add `ContractTag` model + `tags ContractTag[]` to `Contract` + `contracts Contract[]` to `ContractTag` |
| `prisma/migrations/20260607220000_contract_tags/migration.sql` | Create | SQL for `contract_tags` table + `_ContractToContractTag` join table |
| `src/app/api/v1/contracts/route.ts` | Modify | Extend GET: full-text OR search + tagIds/valueMin/valueMax/startFrom/startTo/endFrom/endTo/type filters; include tags in response |
| `src/app/api/v1/contracts/[id]/route.ts` | Modify | Extend PUT: accept `tagIds?: string[]`, validate same-org, connect/disconnect via `tags.set`; include tags in GET |
| `src/app/api/v1/contract-tags/route.ts` | Create | GET (list with contract counts) + POST (create tag) |
| `src/app/api/v1/contract-tags/[id]/route.ts` | Create | PUT (rename/recolor) + DELETE |
| `src/app/(dashboard)/contracts/page.tsx` | Modify | Tag filter, advanced filter popover, tag chips on rows, tag-management inline UI |
| `messages/en.json` | Modify | Add contract-tag i18n keys (surgical, inside `"contracts": {}`) |
| `messages/ru.json` | Modify | Same keys in Russian |
| `messages/az.json` | Modify | Same keys in Azerbaijani |
| `src/__tests__/api-contract-tags.test.ts` | Create | Tag CRUD tests |
| `src/__tests__/api-contracts-search.test.ts` | Create | Extended GET filter tests |
| `memory/deferred_findings.md` | Modify | Append [P3] note about renderedBody ILIKE perf |

---

## Task 1: Schema — ContractTag model + m2m

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add ContractTag model and wire m2m to Contract**

Open `prisma/schema.prisma`. Find the `Contract` model (line ~1367). Inside the relation list (after `intakeSubmission` around line 1449), add one line:

```prisma
  tags                   ContractTag[]
```

After the closing `}` of the `Contract` model, the file continues with `ContractFile`. Find the end of all the CLM models. After `ContractIntakeSubmission` model (or near the end of the CLM section), add the following new model. A good place is right before the line `// 5-step ASC 606` or after `ContractIntakeSubmission`. Append:

```prisma
// CLM Slice 4b-1: organisation-scoped tags for contracts.
// Prisma implicit m2m — the join table `_ContractToContractTag` is auto-managed.
model ContractTag {
  id             String     @id @default(cuid())
  organizationId String
  name           String
  color          String?    // optional hex string e.g. "#4f46e5"
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  contracts      Contract[]

  @@unique([organizationId, name])
  @@index([organizationId])
  @@map("contract_tags")
}
```

- [ ] **Step 2: Validate schema**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
npx prisma validate
```

Expected: no errors printed. If schema syntax errors appear, fix them before proceeding.

---

## Task 2: Migration SQL

**Files:**
- Create: `prisma/migrations/20260607220000_contract_tags/migration.sql`

- [ ] **Step 1: Create migration directory**

```bash
mkdir -p /Users/rashadrahimov/Documents/leaddrive-v2/prisma/migrations/20260607220000_contract_tags
```

- [ ] **Step 2: Write migration SQL**

Create `/Users/rashadrahimov/Documents/leaddrive-v2/prisma/migrations/20260607220000_contract_tags/migration.sql` with this content:

```sql
-- CLM Slice 4b-1: contract_tags + implicit m2m join table
-- Additive only — no existing tables are altered.

CREATE TABLE "contract_tags" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "color"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_tags_pkey" PRIMARY KEY ("id")
);

-- Implicit Prisma m2m join table. Column names A/B are Prisma convention
-- (lexicographic order of model names: Contract < ContractTag → A=contractId, B=tagId).
CREATE TABLE "_ContractToContractTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- Unique pair + individual index on B (Prisma implicit m2m standard shape).
CREATE UNIQUE INDEX "_ContractToContractTag_AB_unique" ON "_ContractToContractTag"("A", "B");
CREATE INDEX "_ContractToContractTag_B_index" ON "_ContractToContractTag"("B");

-- Unique name per org.
CREATE UNIQUE INDEX "contract_tags_organizationId_name_key" ON "contract_tags"("organizationId", "name");

-- Index for org-scoped list queries.
CREATE INDEX "contract_tags_organizationId_idx" ON "contract_tags"("organizationId");

-- Foreign keys.
ALTER TABLE "contract_tags" ADD CONSTRAINT "contract_tags_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ContractToContractTag" ADD CONSTRAINT "_ContractToContractTag_A_fkey"
    FOREIGN KEY ("A") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ContractToContractTag" ADD CONSTRAINT "_ContractToContractTag_B_fkey"
    FOREIGN KEY ("B") REFERENCES "contract_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Run prisma generate**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
npx prisma generate
```

Expected: "Generated Prisma Client" with no errors.

---

## Task 3: Extend GET /api/v1/contracts — full-text search + new filters

**Files:**
- Modify: `src/app/api/v1/contracts/route.ts`

The existing GET handler has a single `title` ILIKE and only `status`/`companyId` filters. We replace the `where` construction and add `tagIds`, `valueMin`, `valueMax`, `startFrom`, `startTo`, `endFrom`, `endTo`, `type`. We also add `tags` to the `include`.

- [ ] **Step 1: Replace the GET handler body in route.ts**

Open `src/app/api/v1/contracts/route.ts`. The GET function currently reads (lines 23-65). Replace the entire `GET` export with:

```typescript
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const status = searchParams.get("status")
  const companyId = searchParams.get("companyId")
  const type = searchParams.get("type") || undefined
  const sortBy = searchParams.get("sortBy") || "date_desc"

  // tagIds: comma-separated list of ContractTag ids
  const tagIdsRaw = searchParams.get("tagIds")
  const tagIds = tagIdsRaw ? tagIdsRaw.split(",").filter(Boolean) : []

  // value range — ignore if not valid numbers
  const valueMinRaw = searchParams.get("valueMin")
  const valueMaxRaw = searchParams.get("valueMax")
  const valueMin = valueMinRaw && !isNaN(Number(valueMinRaw)) ? Number(valueMinRaw) : undefined
  const valueMax = valueMaxRaw && !isNaN(Number(valueMaxRaw)) ? Number(valueMaxRaw) : undefined

  // date range helpers — ignore invalid dates
  function parseDate(raw: string | null): Date | undefined {
    if (!raw) return undefined
    const d = new Date(raw)
    return isNaN(d.getTime()) ? undefined : d
  }
  const startFrom = parseDate(searchParams.get("startFrom"))
  const startTo = parseDate(searchParams.get("startTo"))
  const endFrom = parseDate(searchParams.get("endFrom"))
  const endTo = parseDate(searchParams.get("endTo"))

  // Sort map — extend the existing 6 modes
  const orderBy = (() => {
    switch (sortBy) {
      case "date_asc": return { createdAt: "asc" as const }
      case "value_desc": return { valueAmount: "desc" as const }
      case "value_asc": return { valueAmount: "asc" as const }
      case "expiry": return { endDate: "asc" as const }
      case "company": return { company: { name: "asc" as const } }
      default: return { createdAt: "desc" as const } // date_desc
    }
  })()

  try {
    const where: any = {
      organizationId: orgId,
      // Full-text: OR across title, contractNumber, notes, renderedBody, company.name
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { contractNumber: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
              { renderedBody: { contains: search, mode: "insensitive" } },
              { company: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(companyId ? { companyId } : {}),
      ...(type ? { type } : {}),
      // Tag filter: contract must have ANY of the specified tags
      ...(tagIds.length > 0
        ? { tags: { some: { id: { in: tagIds }, organizationId: orgId } } }
        : {}),
      // Value range
      ...(valueMin !== undefined || valueMax !== undefined
        ? {
            valueAmount: {
              ...(valueMin !== undefined ? { gte: valueMin } : {}),
              ...(valueMax !== undefined ? { lte: valueMax } : {}),
            },
          }
        : {}),
      // Start date range
      ...(startFrom !== undefined || startTo !== undefined
        ? {
            startDate: {
              ...(startFrom ? { gte: startFrom } : {}),
              ...(startTo ? { lte: startTo } : {}),
            },
          }
        : {}),
      // End date range
      ...(endFrom !== undefined || endTo !== undefined
        ? {
            endDate: {
              ...(endFrom ? { gte: endFrom } : {}),
              ...(endTo ? { lte: endTo } : {}),
            },
          }
        : {}),
    }

    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
        include: {
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, name: true } },
          contact: { select: { id: true, fullName: true } },
          tags: { select: { id: true, name: true, color: true } },
        },
      }),
      prisma.contract.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      data: { contracts: contracts.map(normalizeContractRow), total, page, limit, search },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check (no new errors)**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit 2>&1 | grep -v "chatbot-autoreply\|mtm/photos\|social/enable-inbox" | head -30
```

Expected: no new errors from the contracts routes.

---

## Task 4: Extend PUT /api/v1/contracts/[id] — tag assignment + include tags in GET

**Files:**
- Modify: `src/app/api/v1/contracts/[id]/route.ts`

The PUT handler needs to accept an optional `tagIds` array, validate all tag ids belong to the same org, then do `tags: { set: [...] }` (which replaces the full set). The GET handler needs to include tags.

- [ ] **Step 1: Extend updateContractSchema to accept tagIds**

In `src/app/api/v1/contracts/[id]/route.ts`, the `updateContractSchema` starts at line 9. Add `tagIds` to it:

```typescript
const updateContractSchema = z.object({
  contractNumber: z.string().optional(),
  title: z.string().optional(),
  companyId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  type: z.string().optional(),
  status: z.enum(["draft", "sent", "signed", "active", "expiring", "expired", "renewed"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  valueAmount: z.number().optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
})
```

- [ ] **Step 2: Update GET handler to include tags**

In the GET handler's `prisma.contract.findFirst` call (around line 40), add `tags: { select: { id: true, name: true, color: true } }` to the `include`:

```typescript
    const contract = await prisma.contract.findFirst({
      where: { id, organizationId: orgId },
      include: {
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, name: true } },
        contact: { select: { id: true, fullName: true } },
        tags: { select: { id: true, name: true, color: true } },
        approvalStages: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            label: true,
            status: true,
            assigneeUserId: true,
            assigneeRole: true,
            slaHours: true,
            dueAt: true,
            escalationLevel: true,
            decidedAt: true,
            decidedBy: true,
          },
        },
      },
    })
```

- [ ] **Step 3: Handle tagIds in PUT handler**

The PUT handler currently uses `prisma.contract.updateMany`. Since `updateMany` does not support relation writes (`tags.set`), we need to split: use `updateMany` for scalar fields (existing), then do a separate `update` if `tagIds` is present. Find the block around line 96 where `updateMany` is called. Replace the entire try block in the PUT handler with:

```typescript
  try {
    // Get old values for audit
    const oldContract = await prisma.contract.findFirst({ where: { id, organizationId: orgId } })
    if (!oldContract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Cross-tenant guard: if tagIds supplied, verify ALL belong to this org
    if (parsed.data.tagIds !== undefined) {
      if (parsed.data.tagIds.length > 0) {
        const tagCount = await prisma.contractTag.count({
          where: { id: { in: parsed.data.tagIds }, organizationId: orgId },
        })
        if (tagCount !== parsed.data.tagIds.length) {
          return NextResponse.json({ error: "One or more tags not found in this organization" }, { status: 400 })
        }
      }
    }

    // Separate scalar data from tagIds (updateMany doesn't support relation writes)
    const { tagIds: newTagIds, ...scalarData } = parsed.data

    const result = await prisma.contract.updateMany({
      where: { id, organizationId: orgId },
      data: {
        ...scalarData,
        companyId: scalarData.companyId === null ? null : scalarData.companyId || undefined,
        dealId: scalarData.dealId === null ? null : scalarData.dealId || undefined,
        contactId: scalarData.contactId === null ? null : scalarData.contactId || undefined,
        startDate: scalarData.startDate ? new Date(scalarData.startDate) : undefined,
        endDate: scalarData.endDate === null
          ? null
          : scalarData.endDate
          ? new Date(scalarData.endDate)
          : undefined,
      },
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Tag assignment — use update (not updateMany) to support relation writes
    if (newTagIds !== undefined) {
      await prisma.contract.update({
        where: { id },
        data: {
          tags: { set: newTagIds.map(tagId => ({ id: tagId })) },
        },
      })
    }

    const updated = await prisma.contract.findFirst({ where: { id, organizationId: orgId } })

    // Log changes to audit
    const changes: Record<string, { old: any; new: any }> = {}
    const fields = ["contractNumber", "title", "companyId", "dealId", "contactId", "type", "status", "currency", "notes"] as const
    for (const f of fields) {
      const oldVal = (oldContract as any)[f]
      const newVal = (updated as any)[f]
      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        changes[f] = { old: oldVal, new: newVal }
      }
    }
    const oldAmount = decimalToNumber(oldContract.valueAmount)
    const newAmount = decimalToNumber(updated?.valueAmount)
    if (oldAmount !== newAmount) {
      changes.valueAmount = { old: oldAmount, new: newAmount }
    }
    const oldStart = oldContract.startDate?.toISOString().split("T")[0] || ""
    const newStart = updated?.startDate?.toISOString().split("T")[0] || ""
    if (oldStart !== newStart) changes.startDate = { old: oldStart, new: newStart }
    const oldEnd = oldContract.endDate?.toISOString().split("T")[0] || ""
    const newEnd = updated?.endDate?.toISOString().split("T")[0] || ""
    if (oldEnd !== newEnd) changes.endDate = { old: oldEnd, new: newEnd }

    if (Object.keys(changes).length > 0) {
      await prisma.auditLog.create({
        data: {
          organizationId: orgId,
          action: "update",
          entityType: "contract",
          entityId: id,
          entityName: updated?.title || oldContract.title,
          oldValue: changes,
          newValue: parsed.data,
        },
      }).catch(() => {})
    }

    if ("endDate" in parsed.data && updated) {
      upsertRenewalAlerts(orgId, id, updated.endDate ?? null).catch((err) =>
        console.error("[contracts PUT] upsertRenewalAlerts failed:", err),
      )
    }

    return NextResponse.json({ success: true, data: updated ? normalizeContractRow(updated) : null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
```

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit 2>&1 | grep -v "chatbot-autoreply\|mtm/photos\|social/enable-inbox" | head -30
```

Expected: no new errors from the contracts [id] route.

---

## Task 5: ContractTag CRUD routes

**Files:**
- Create: `src/app/api/v1/contract-tags/route.ts`
- Create: `src/app/api/v1/contract-tags/[id]/route.ts`

### 5a — Collection route

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p /Users/rashadrahimov/Documents/leaddrive-v2/src/app/api/v1/contract-tags/\[id\]
```

- [ ] **Step 2: Create src/app/api/v1/contract-tags/route.ts**

```typescript
/**
 * CLM Slice 4b-1 — ContractTag CRUD (collection).
 *
 * GET  /api/v1/contract-tags    — org-scoped list with contract count per tag.
 * POST /api/v1/contract-tags    — create a tag (name required, unique per org, optional color).
 *
 * Auth: org-scoped via getOrgId; module gate: orgHasModule("contracts").
 * Write access: any authenticated org member (usability choice — tags are lightweight).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"

const createTagSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

async function resolveGuards(req: NextRequest): Promise<{ orgId: string } | NextResponse> {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const session = await getSession(req)
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  return { orgId }
}

export async function GET(req: NextRequest) {
  const guards = await resolveGuards(req)
  if (guards instanceof NextResponse) return guards
  const { orgId } = guards

  try {
    const tags = await prisma.contractTag.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { contracts: true } },
      },
    })

    return NextResponse.json({
      success: true,
      data: tags.map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
        contractCount: t._count.contracts,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guards = await resolveGuards(req)
  if (guards instanceof NextResponse) return guards
  const { orgId } = guards

  const body = await req.json()
  const parsed = createTagSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const tag = await prisma.contractTag.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        color: parsed.data.color,
      },
    })

    return NextResponse.json({ success: true, data: tag }, { status: 201 })
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

### 5b — Item route (PUT + DELETE)

- [ ] **Step 3: Create src/app/api/v1/contract-tags/[id]/route.ts**

```typescript
/**
 * CLM Slice 4b-1 — ContractTag CRUD (item).
 *
 * PUT    /api/v1/contract-tags/:id  — rename and/or recolor a tag.
 * DELETE /api/v1/contract-tags/:id  — delete tag + cascade-remove all assignments.
 *
 * Auth: org-scoped; module gate: orgHasModule("contracts").
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"

const updateTagSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
})

async function resolveGuards(req: NextRequest): Promise<{ orgId: string } | NextResponse> {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const session = await getSession(req)
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  return { orgId }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guards = await resolveGuards(req)
  if (guards instanceof NextResponse) return guards
  const { orgId } = guards
  const { id } = await params

  const body = await req.json()
  const parsed = updateTagSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const existing = await prisma.contractTag.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await prisma.contractTag.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A tag with this name already exists" }, { status: 409 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guards = await resolveGuards(req)
  if (guards instanceof NextResponse) return guards
  const { orgId } = guards
  const { id } = await params

  try {
    const existing = await prisma.contractTag.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Prisma cascades assignments via _ContractToContractTag FK on delete.
    await prisma.contractTag.delete({ where: { id } })

    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit 2>&1 | grep -v "chatbot-autoreply\|mtm/photos\|social/enable-inbox" | head -30
```

Expected: no errors in the new contract-tags routes.

---

## Task 6: i18n — surgical additions to en/ru/az

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/ru.json`
- Modify: `messages/az.json`

The `"contracts"` object in each file ends around key `"intakeFormTitle"` / `"esignReminderSent"`. We add new keys at the end of the contracts object before its closing `}`.

- [ ] **Step 1: Add keys to messages/en.json**

Find the closing `}` of the `"contracts": {` section (search for the block that has `"newContract"`, `"searchPlaceholder"`, etc., which ends before `"companies":` or another top-level key). Add these keys at the very end of the contracts block (before the closing `}`):

```json
    "tagFilterLabel": "Filter by tags",
    "tagFilterPlaceholder": "Select tags...",
    "tagChipAriaRemove": "Remove tag",
    "tagManageTitle": "Manage Tags",
    "tagCreateLabel": "New tag name",
    "tagCreatePlaceholder": "e.g. Priority, NDA, Renewal",
    "tagColorLabel": "Color (optional)",
    "tagCreateBtn": "Create tag",
    "tagCreateSuccess": "Tag created",
    "tagCreateError": "Failed to create tag",
    "tagDeleteConfirm": "Delete tag \"{name}\"? It will be unassigned from all contracts.",
    "tagDeleteSuccess": "Tag deleted",
    "tagNone": "No tags",
    "advancedFilters": "Advanced filters",
    "advancedFiltersClear": "Clear filters",
    "advancedFiltersApply": "Apply",
    "advancedFiltersActive": "{count} filter{count, plural, one {} other {s}} active",
    "filterValueMin": "Min value",
    "filterValueMax": "Max value",
    "filterStartFrom": "Start from",
    "filterStartTo": "Start to",
    "filterEndFrom": "End from",
    "filterEndTo": "End to",
    "filterType": "Contract type",
    "filterTypeAll": "All types",
    "searchLabelExtended": "Search (title, number, body, company)"
```

- [ ] **Step 2: Add keys to messages/ru.json**

Find the `"contracts"` block in `messages/ru.json` and add at the end before the closing `}`:

```json
    "tagFilterLabel": "Фильтр по тегам",
    "tagFilterPlaceholder": "Выберите теги...",
    "tagChipAriaRemove": "Удалить тег",
    "tagManageTitle": "Управление тегами",
    "tagCreateLabel": "Название нового тега",
    "tagCreatePlaceholder": "напр. Приоритет, NDA, Продление",
    "tagColorLabel": "Цвет (необязательно)",
    "tagCreateBtn": "Создать тег",
    "tagCreateSuccess": "Тег создан",
    "tagCreateError": "Не удалось создать тег",
    "tagDeleteConfirm": "Удалить тег \"{name}\"? Он будет снят со всех договоров.",
    "tagDeleteSuccess": "Тег удалён",
    "tagNone": "Нет тегов",
    "advancedFilters": "Расширенные фильтры",
    "advancedFiltersClear": "Сбросить",
    "advancedFiltersApply": "Применить",
    "advancedFiltersActive": "Активных фильтров: {count}",
    "filterValueMin": "Мин. сумма",
    "filterValueMax": "Макс. сумма",
    "filterStartFrom": "Начало с",
    "filterStartTo": "Начало до",
    "filterEndFrom": "Окончание с",
    "filterEndTo": "Окончание до",
    "filterType": "Тип договора",
    "filterTypeAll": "Все типы",
    "searchLabelExtended": "Поиск (название, номер, тело, компания)"
```

- [ ] **Step 3: Add keys to messages/az.json**

Find the `"contracts"` block in `messages/az.json` and add at the end before the closing `}`:

```json
    "tagFilterLabel": "Teqlərə görə filtr",
    "tagFilterPlaceholder": "Teq seçin...",
    "tagChipAriaRemove": "Teqi sil",
    "tagManageTitle": "Teqləri idarə et",
    "tagCreateLabel": "Yeni teq adı",
    "tagCreatePlaceholder": "məs. Prioritet, NDA, Yenilənmə",
    "tagColorLabel": "Rəng (isteğe bağlı)",
    "tagCreateBtn": "Teq yarat",
    "tagCreateSuccess": "Teq yaradıldı",
    "tagCreateError": "Teq yaratmaq alınmadı",
    "tagDeleteConfirm": "\"{name}\" teqini sil? Bütün müqavilələrdən çıxarılacaq.",
    "tagDeleteSuccess": "Teq silindi",
    "tagNone": "Teq yoxdur",
    "advancedFilters": "Ətraflı filtrlər",
    "advancedFiltersClear": "Sıfırla",
    "advancedFiltersApply": "Tətbiq et",
    "advancedFiltersActive": "{count} aktiv filtr",
    "filterValueMin": "Min məbləğ",
    "filterValueMax": "Maks məbləğ",
    "filterStartFrom": "Başlama: -dən",
    "filterStartTo": "Başlama: -ə qədər",
    "filterEndFrom": "Bitmə: -dən",
    "filterEndTo": "Bitmə: -ə qədər",
    "filterType": "Müqavilə növü",
    "filterTypeAll": "Bütün növlər",
    "searchLabelExtended": "Axtarış (ad, nömrə, mətn, şirkət)"
```

---

## Task 7: UI — tag filter, advanced filters, tag chips, tag management

**Files:**
- Modify: `src/app/(dashboard)/contracts/page.tsx`

This is the largest UI change. We add state for tags, the advanced-filter panel, and a tag-management inline section. The existing structure (stats, filter tabs, sort, DataTable, dialogs) remains untouched.

- [ ] **Step 1: Extend the Contract interface and add ContractTag interface**

At the top of `contracts/page.tsx`, after the existing `interface Contract { ... }` (ends around line 71), add:

```typescript
interface ContractTag {
  id: string
  name: string
  color?: string | null
}
```

And extend the `Contract` interface to include tags:

```typescript
interface Contract {
  id: string
  contractNumber: string
  title: string
  companyId?: string
  company?: { id: string; name: string } | null
  dealId?: string
  deal?: { id: string; name: string } | null
  contactId?: string
  contact?: { id: string; fullName?: string; name?: string } | null
  type?: string
  status: string
  startDate?: string
  endDate?: string
  valueAmount?: number
  currency: string
  notes?: string
  createdAt: string
  updatedAt: string
  history?: AuditEntry[]
  tags?: ContractTag[]
}
```

- [ ] **Step 2: Add tag + advanced-filter state**

In `ContractsPage()`, after the existing state declarations (around line 123), add:

```typescript
  // Tags
  const [orgTags, setOrgTags] = useState<ContractTag[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [tagManageOpen, setTagManageOpen] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [newTagColor, setNewTagColor] = useState("")
  const [tagCreating, setTagCreating] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)

  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [filterValueMin, setFilterValueMin] = useState("")
  const [filterValueMax, setFilterValueMax] = useState("")
  const [filterStartFrom, setFilterStartFrom] = useState("")
  const [filterStartTo, setFilterStartTo] = useState("")
  const [filterEndFrom, setFilterEndFrom] = useState("")
  const [filterEndTo, setFilterEndTo] = useState("")
  const [filterType, setFilterType] = useState("")

  // Count active advanced filters
  const advancedActiveCount = [filterValueMin, filterValueMax, filterStartFrom, filterStartTo, filterEndFrom, filterEndTo, filterType].filter(Boolean).length
```

- [ ] **Step 3: Add fetchOrgTags helper and call it on mount**

Add this function inside `ContractsPage` after `fetchContracts`:

```typescript
  const fetchOrgTags = async () => {
    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      const res = await fetch("/api/v1/contract-tags", { headers })
      const json = await res.json()
      if (json.success) setOrgTags(json.data)
    } catch { /* non-fatal */ }
  }
```

Then in the `useEffect` that calls `fetchContracts()`, also call `fetchOrgTags()`:

```typescript
  useEffect(() => { fetchContracts(); fetchOrgTags() }, [session])
```

- [ ] **Step 4: Extend fetchContracts to pass new filter params**

Replace the `fetchContracts` function body to pass the new filter params to the API:

```typescript
  const fetchContracts = async () => {
    try {
      const params = new URLSearchParams({ limit: "500" })
      if (selectedTagIds.length > 0) params.set("tagIds", selectedTagIds.join(","))
      if (filterValueMin) params.set("valueMin", filterValueMin)
      if (filterValueMax) params.set("valueMax", filterValueMax)
      if (filterStartFrom) params.set("startFrom", filterStartFrom)
      if (filterStartTo) params.set("startTo", filterStartTo)
      if (filterEndFrom) params.set("endFrom", filterEndFrom)
      if (filterEndTo) params.set("endTo", filterEndTo)
      if (filterType) params.set("type", filterType)

      const res = await fetch(`/api/v1/contracts?${params.toString()}`, {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setContracts(json.data.contracts)
        setTotal(json.data.total)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }
```

Note: The existing client-side `activeFilter` status tab still works because it filters the already-fetched list in memory.

- [ ] **Step 5: Add handleCreateTag function**

Add inside `ContractsPage`:

```typescript
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    setTagCreating(true)
    setTagError(null)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      }
      const body: Record<string, string> = { name: newTagName.trim() }
      if (newTagColor.match(/^#[0-9a-fA-F]{6}$/)) body.color = newTagColor
      const res = await fetch("/api/v1/contract-tags", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setTagError(json.error || t("tagCreateError")); return }
      toast.success(t("tagCreateSuccess"))
      setNewTagName("")
      setNewTagColor("")
      await fetchOrgTags()
    } catch {
      setTagError(t("tagCreateError"))
    } finally {
      setTagCreating(false)
    }
  }

  const handleDeleteTag = async (tagId: string, tagName: string) => {
    if (!confirm(t("tagDeleteConfirm", { name: tagName }))) return
    try {
      const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}
      await fetch(`/api/v1/contract-tags/${tagId}`, { method: "DELETE", headers })
      toast.success(t("tagDeleteSuccess"))
      setSelectedTagIds(prev => prev.filter(id => id !== tagId))
      await fetchOrgTags()
      fetchContracts()
    } catch { /* non-fatal */ }
  }
```

- [ ] **Step 6: Add Tag chips to the DataTable columns**

In the `columns` array, add a new column for tags AFTER the `status` column and BEFORE the `endDate` column:

```typescript
    {
      key: "tags",
      label: t("tagFilterLabel"),
      sortable: false,
      render: (item: any) => (
        <div className="flex flex-wrap gap-1">
          {item.tags && item.tags.length > 0
            ? item.tags.map((tag: ContractTag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={tag.color ? { backgroundColor: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}44` } : undefined}
                  title={tag.name}
                >
                  {!tag.color && <span className="w-2 h-2 rounded-full bg-primary/30 mr-1 inline-block" />}
                  {tag.name}
                </span>
              ))
            : <span className="text-muted-foreground text-xs">—</span>}
        </div>
      ),
    },
```

- [ ] **Step 7: Update search placeholder in DataTable call**

The current `DataTable` call (around line 603) uses `searchPlaceholder={t("searchPlaceholder")}`. Update it:

```typescript
      <DataTable
        columns={columns as any}
        data={filtered as any}
        searchPlaceholder={t("searchLabelExtended")}
        searchKey="title"
        onRowClick={openDetail as any}
      />
```

- [ ] **Step 8: Add tag filter row + advanced filter popover between the sort and DataTable**

Find the closing `</div>` of the sort section (around line 601) and insert after it, before the `<DataTable ...>` line:

```typescript
      {/* Tag filter */}
      {orgTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("tagFilterLabel")}:</span>
          {orgTags.map(tag => (
            <button
              key={tag.id}
              onClick={() => setSelectedTagIds(prev =>
                prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
              )}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                selectedTagIds.includes(tag.id)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-muted hover:border-muted-foreground"
              )}
              style={tag.color && !selectedTagIds.includes(tag.id) ? {
                borderColor: tag.color + "66",
                color: tag.color,
                backgroundColor: tag.color + "11",
              } : undefined}
            >
              {tag.name}
            </button>
          ))}
          {selectedTagIds.length > 0 && (
            <button
              onClick={() => setSelectedTagIds([])}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3 w-3" /> {t("advancedFiltersClear")}
            </button>
          )}
          <button
            onClick={() => setTagManageOpen(prev => !prev)}
            className="text-xs text-muted-foreground hover:text-foreground underline ml-auto"
          >
            {t("tagManageTitle")}
          </button>
        </div>
      )}

      {/* Advanced filter toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAdvancedOpen(prev => !prev)}
          className={cn(
            "text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors",
            advancedActiveCount > 0
              ? "border-primary text-primary bg-primary/5"
              : "border-muted text-muted-foreground hover:border-muted-foreground"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          {t("advancedFilters")}
          {advancedActiveCount > 0 && (
            <span className="ml-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full">
              {advancedActiveCount}
            </span>
          )}
        </button>
        {advancedActiveCount > 0 && (
          <button
            onClick={() => {
              setFilterValueMin(""); setFilterValueMax("")
              setFilterStartFrom(""); setFilterStartTo("")
              setFilterEndFrom(""); setFilterEndTo("")
              setFilterType("")
              fetchContracts()
            }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="h-3 w-3" /> {t("advancedFiltersClear")}
          </button>
        )}
      </div>

      {/* Advanced filter panel */}
      {advancedOpen && (
        <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterValueMin")}</Label>
              <Input type="number" value={filterValueMin} onChange={e => setFilterValueMin(e.target.value)} className="h-8 text-sm" placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterValueMax")}</Label>
              <Input type="number" value={filterValueMax} onChange={e => setFilterValueMax(e.target.value)} className="h-8 text-sm" placeholder="∞" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterStartFrom")}</Label>
              <Input type="date" value={filterStartFrom} onChange={e => setFilterStartFrom(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterStartTo")}</Label>
              <Input type="date" value={filterStartTo} onChange={e => setFilterStartTo(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterEndFrom")}</Label>
              <Input type="date" value={filterEndFrom} onChange={e => setFilterEndFrom(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("filterEndTo")}</Label>
              <Input type="date" value={filterEndTo} onChange={e => setFilterEndTo(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">{t("filterType")}</Label>
              <Select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full">
                <option value="">{t("filterTypeAll")}</option>
                <option value="service_agreement">{t("typeService")}</option>
                <option value="nda">{t("typeNda")}</option>
                <option value="maintenance">{t("typeMaintenance")}</option>
                <option value="license">{t("typeLicense")}</option>
                <option value="sla">{t("typeSla")}</option>
                <option value="other">{t("typeOther")}</option>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              setFilterValueMin(""); setFilterValueMax("")
              setFilterStartFrom(""); setFilterStartTo("")
              setFilterEndFrom(""); setFilterEndTo("")
              setFilterType("")
            }}>
              {t("advancedFiltersClear")}
            </Button>
            <Button size="sm" onClick={() => { setAdvancedOpen(false); fetchContracts() }}>
              {t("advancedFiltersApply")}
            </Button>
          </div>
        </div>
      )}

      {/* Tag management panel */}
      {tagManageOpen && (
        <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
          <h3 className="text-sm font-semibold">{t("tagManageTitle")}</h3>
          {/* Existing tags */}
          <div className="flex flex-wrap gap-2">
            {orgTags.length === 0 && <p className="text-xs text-muted-foreground">{t("tagNone")}</p>}
            {orgTags.map(tag => (
              <div key={tag.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-background">
                {tag.color && <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: tag.color }} />}
                <span>{tag.name}</span>
                <button
                  onClick={() => handleDeleteTag(tag.id, tag.name)}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                  aria-label={t("tagChipAriaRemove")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          {/* Create new tag */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("tagCreateLabel")}</Label>
              <Input
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                placeholder={t("tagCreatePlaceholder")}
                className="h-8 text-sm w-48"
                onKeyDown={e => { if (e.key === "Enter") handleCreateTag() }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("tagColorLabel")}</Label>
              <Input
                type="color"
                value={newTagColor || "#4f46e5"}
                onChange={e => setNewTagColor(e.target.value)}
                className="h-8 w-14 px-1 cursor-pointer"
              />
            </div>
            <Button size="sm" onClick={handleCreateTag} disabled={tagCreating || !newTagName.trim()}>
              {tagCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("tagCreateBtn")}
            </Button>
          </div>
          {tagError && <p className="text-xs text-destructive">{tagError}</p>}
        </div>
      )}
```

Note: the orgTags.length === 0 branch on initial load: when there are NO org tags yet, the tag filter bar is hidden. The tag-manage button appears in that bar — so for the very first tag, expose the manage panel via the advanced-filter area. Add a standalone "Manage tags" link next to the advanced filter button when orgTags.length === 0. Modify the "Advanced filter toggle" div:

```typescript
      {/* Advanced filter toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAdvancedOpen(prev => !prev)}
          className={cn(
            "text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors",
            advancedActiveCount > 0
              ? "border-primary text-primary bg-primary/5"
              : "border-muted text-muted-foreground hover:border-muted-foreground"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          {t("advancedFilters")}
          {advancedActiveCount > 0 && (
            <span className="ml-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full">
              {advancedActiveCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTagManageOpen(prev => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {t("tagManageTitle")}
        </button>
        {advancedActiveCount > 0 && (
          <button
            onClick={() => {
              setFilterValueMin(""); setFilterValueMax("")
              setFilterStartFrom(""); setFilterStartTo("")
              setFilterEndFrom(""); setFilterEndTo("")
              setFilterType("")
              fetchContracts()
            }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="h-3 w-3" /> {t("advancedFiltersClear")}
          </button>
        )}
      </div>
```

And remove the `{orgTags.length > 0 && ...}` condition on the tagManage button inside the tag filter bar (since manage is now always accessible from the standalone button).

- [ ] **Step 9: TypeScript check for UI**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit 2>&1 | grep -v "chatbot-autoreply\|mtm/photos\|social/enable-inbox" | grep "contracts/page\|contract-tags" | head -20
```

Expected: no errors from `contracts/page.tsx` or the new route files.

---

## Task 8: Tests — ContractTag CRUD

**Files:**
- Create: `src/__tests__/api-contract-tags.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// Mock Prisma — include contractTag model methods
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractTag: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    contract: {
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  orgHasModule: vi.fn(),
  moduleDisabledResponse: vi.fn(() =>
    new Response(JSON.stringify({ error: "Module disabled" }), { status: 403 })
  ),
}))

import { GET, POST } from "@/app/api/v1/contract-tags/route"
import { PUT, DELETE } from "@/app/api/v1/contract-tags/[id]/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, orgHasModule } from "@/lib/api-auth"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue({ role: "admin" } as any)
  vi.mocked(orgHasModule).mockResolvedValue(true)
})

// ─── GET /api/v1/contract-tags ───────────────────────────────────────

describe("GET /api/v1/contract-tags", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when module disabled", async () => {
    vi.mocked(orgHasModule).mockResolvedValue(false)
    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(res.status).toBe(403)
  })

  it("returns org-scoped tags with contract count", async () => {
    vi.mocked(prisma.contractTag.findMany).mockResolvedValue([
      { id: "t1", name: "Priority", color: "#ff0000", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(), _count: { contracts: 3 } },
    ] as any)

    const res = await GET(makeReq("http://localhost:3000/api/v1/contract-tags"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data[0].id).toBe("t1")
    expect(json.data[0].contractCount).toBe(3)

    const call = vi.mocked(prisma.contractTag.findMany).mock.calls[0][0] as any
    expect(call.where.organizationId).toBe("org-1")
  })
})

// ─── POST /api/v1/contract-tags ──────────────────────────────────────

describe("POST /api/v1/contract-tags", () => {
  it("creates a tag with name only", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t2", name: "NDA", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "NDA" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("NDA")
  })

  it("creates a tag with name and color", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t3", name: "Priority", color: "#4f46e5", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)

    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "Priority", color: "#4f46e5" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.data.color).toBe("#4f46e5")
  })

  it("returns 400 when name is missing", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ color: "#ff0000" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when color format is invalid", async () => {
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "MyTag", color: "red" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(400)
  })

  it("returns 409 on duplicate name (Prisma P2002)", async () => {
    vi.mocked(prisma.contractTag.create).mockRejectedValue({ code: "P2002" })
    const res = await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "NDA" }),
      headers: { "Content-Type": "application/json" },
    }))
    expect(res.status).toBe(409)
  })

  it("scopes creation to requesting org", async () => {
    vi.mocked(prisma.contractTag.create).mockResolvedValue({
      id: "t4", name: "Test", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await POST(makeReq("http://localhost:3000/api/v1/contract-tags", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
      headers: { "Content-Type": "application/json" },
    }))
    const createCall = vi.mocked(prisma.contractTag.create).mock.calls[0][0] as any
    expect(createCall.data.organizationId).toBe("org-1")
  })
})

// ─── PUT /api/v1/contract-tags/[id] ──────────────────────────────────

describe("PUT /api/v1/contract-tags/[id]", () => {
  it("returns 404 when tag not found in org", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue(null)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/t99", {
        method: "PUT",
        body: JSON.stringify({ name: "Renamed" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("t99"),
    )
    expect(res.status).toBe(404)
  })

  it("renames and recolors a tag (org-scoped)", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue({
      id: "t1", name: "Old", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    vi.mocked(prisma.contractTag.update).mockResolvedValue({
      id: "t1", name: "Renamed", color: "#00ff00", organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)

    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/t1", {
        method: "PUT",
        body: JSON.stringify({ name: "Renamed", color: "#00ff00" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.name).toBe("Renamed")
    expect(json.data.color).toBe("#00ff00")

    // Verify findFirst was called with orgId guard
    const findCall = vi.mocked(prisma.contractTag.findFirst).mock.calls[0][0] as any
    expect(findCall.where.organizationId).toBe("org-1")
  })

  it("blocks cross-tenant: tag from org-2 returns 404 for org-1 request", async () => {
    // findFirst returns null (org-scoped — org-2 tag won't match)
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue(null)
    const res = await PUT(
      makeReq("http://localhost:3000/api/v1/contract-tags/other-org-tag", {
        method: "PUT",
        body: JSON.stringify({ name: "Stolen" }),
        headers: { "Content-Type": "application/json" },
      }),
      makeParams("other-org-tag"),
    )
    expect(res.status).toBe(404)
  })
})

// ─── DELETE /api/v1/contract-tags/[id] ───────────────────────────────

describe("DELETE /api/v1/contract-tags/[id]", () => {
  it("deletes tag and returns 200", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue({
      id: "t1", name: "Obsolete", color: null, organizationId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    } as any)
    vi.mocked(prisma.contractTag.delete).mockResolvedValue({} as any)

    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-tags/t1", { method: "DELETE" }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.deleted).toBe("t1")
  })

  it("returns 404 for cross-tenant tag", async () => {
    vi.mocked(prisma.contractTag.findFirst).mockResolvedValue(null)
    const res = await DELETE(
      makeReq("http://localhost:3000/api/v1/contract-tags/not-mine", { method: "DELETE" }),
      makeParams("not-mine"),
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the new tests**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
npx vitest run src/__tests__/api-contract-tags.test.ts
```

Expected: all tests pass.

---

## Task 9: Tests — Extended GET /contracts (search + filters)

**Files:**
- Create: `src/__tests__/api-contracts-search.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({ getSession: vi.fn(), getOrgId: vi.fn() }))

import { GET } from "@/app/api/v1/contracts/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(prisma.contract.findMany).mockResolvedValue([])
  vi.mocked(prisma.contract.count).mockResolvedValue(0)
})

function getWhereArg() {
  return (vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any).where
}
function getIncludeArg() {
  return (vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any).include
}
function getOrderByArg() {
  return (vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any).orderBy
}

// ─── Full-text search ────────────────────────────────────────────────

describe("GET /contracts — full-text search", () => {
  it("no search param → no OR clause", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    const where = getWhereArg()
    expect(where.OR).toBeUndefined()
    expect(where.organizationId).toBe("org-1")
  })

  it("search param builds OR across 5 fields", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?search=acme"))
    const where = getWhereArg()
    expect(where.OR).toHaveLength(5)
    const fields = where.OR.map((c: any) => Object.keys(c)[0])
    expect(fields).toContain("title")
    expect(fields).toContain("contractNumber")
    expect(fields).toContain("notes")
    expect(fields).toContain("renderedBody")
    expect(fields).toContain("company")
    // company is nested
    const companyClause = where.OR.find((c: any) => c.company)
    expect(companyClause.company.name.contains).toBe("acme")
    // all are case-insensitive
    for (const clause of where.OR) {
      const val = Object.values(clause)[0] as any
      const nested = val?.name ?? val
      expect(nested.mode).toBe("insensitive")
    }
  })

  it("org-scoping always present", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?search=test"))
    expect(getWhereArg().organizationId).toBe("org-1")
  })
})

// ─── Tag filter ──────────────────────────────────────────────────────

describe("GET /contracts — tagIds filter", () => {
  it("no tagIds → no tags filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(getWhereArg().tags).toBeUndefined()
  })

  it("single tagId builds some filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?tagIds=t1"))
    const where = getWhereArg()
    expect(where.tags).toEqual({ some: { id: { in: ["t1"] }, organizationId: "org-1" } })
  })

  it("multiple tagIds are all passed in the IN list", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?tagIds=t1,t2,t3"))
    const where = getWhereArg()
    expect(where.tags.some.id.in).toEqual(["t1", "t2", "t3"])
  })
})

// ─── Value range ─────────────────────────────────────────────────────

describe("GET /contracts — value range filters", () => {
  it("valueMin alone sets gte", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMin=1000"))
    const where = getWhereArg()
    expect(where.valueAmount.gte).toBe(1000)
    expect(where.valueAmount.lte).toBeUndefined()
  })

  it("valueMax alone sets lte", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMax=50000"))
    const where = getWhereArg()
    expect(where.valueAmount.lte).toBe(50000)
    expect(where.valueAmount.gte).toBeUndefined()
  })

  it("both valueMin and valueMax set gte+lte", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMin=500&valueMax=10000"))
    const where = getWhereArg()
    expect(where.valueAmount.gte).toBe(500)
    expect(where.valueAmount.lte).toBe(10000)
  })

  it("invalid valueMin (NaN) is ignored — no valueAmount filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?valueMin=abc"))
    const where = getWhereArg()
    expect(where.valueAmount).toBeUndefined()
  })
})

// ─── Date range filters ───────────────────────────────────────────────

describe("GET /contracts — date range filters", () => {
  it("startFrom + startTo sets startDate range", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?startFrom=2025-01-01&startTo=2025-12-31"))
    const where = getWhereArg()
    expect(where.startDate.gte).toBeInstanceOf(Date)
    expect(where.startDate.lte).toBeInstanceOf(Date)
  })

  it("endFrom + endTo sets endDate range", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?endFrom=2026-01-01&endTo=2026-12-31"))
    const where = getWhereArg()
    expect(where.endDate.gte).toBeInstanceOf(Date)
    expect(where.endDate.lte).toBeInstanceOf(Date)
  })

  it("invalid date string is ignored — no startDate filter", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?startFrom=not-a-date"))
    const where = getWhereArg()
    expect(where.startDate).toBeUndefined()
  })
})

// ─── Type filter ──────────────────────────────────────────────────────

describe("GET /contracts — type filter", () => {
  it("passes type to where clause", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?type=nda"))
    expect(getWhereArg().type).toBe("nda")
  })

  it("no type param → no type in where", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    expect(getWhereArg().type).toBeUndefined()
  })
})

// ─── Include tags ─────────────────────────────────────────────────────

describe("GET /contracts — includes tags", () => {
  it("always includes tags in the findMany call", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts"))
    const include = getIncludeArg()
    expect(include.tags).toBeDefined()
    expect(include.tags.select).toEqual({ id: true, name: true, color: true })
  })
})

// ─── Existing filters still work ──────────────────────────────────────

describe("GET /contracts — existing filters still work", () => {
  it("status filter still applied", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?status=active"))
    expect(getWhereArg().status).toBe("active")
  })

  it("companyId filter still applied", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?companyId=comp-1"))
    expect(getWhereArg().companyId).toBe("comp-1")
  })

  it("sort by value_desc produces correct orderBy", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?sortBy=value_desc"))
    expect(getOrderByArg()).toEqual({ valueAmount: "desc" })
  })

  it("pagination still works", async () => {
    await GET(makeReq("http://localhost:3000/api/v1/contracts?page=3&limit=10"))
    const call = vi.mocked(prisma.contract.findMany).mock.calls[0][0] as any
    expect(call.skip).toBe(20)
    expect(call.take).toBe(10)
  })
})
```

- [ ] **Step 2: Run the new tests**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
npx vitest run src/__tests__/api-contracts-search.test.ts
```

Expected: all tests pass.

---

## Task 10: Run all existing contract tests to confirm no regressions

- [ ] **Step 1: Run the full contract test suite**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
npx vitest run src/__tests__/api-contracts.test.ts src/__tests__/api-contract-templates.test.ts src/__tests__/api-contract-versions.test.ts src/__tests__/api-contract-generate.test.ts src/__tests__/api-contract-amend.test.ts src/__tests__/api-contract-esign.test.ts src/__tests__/api-contract-intake-forms.test.ts src/__tests__/api-contract-intake-submit.test.ts src/__tests__/lib-contract-lifecycle.test.ts src/__tests__/contract-decimal.test.ts
```

Expected: all pass. Fix any failures before proceeding.

---

## Task 11: Add P3 note to deferred_findings.md + final tsc

**Files:**
- Modify: `memory/deferred_findings.md`

- [ ] **Step 1: Append P3 note**

At the end of `/Users/rashadrahimov/Documents/leaddrive-v2/memory/deferred_findings.md`, add:

```markdown
- **[P3]** CLM Slice 4b-1 — full-text ILIKE on `renderedBody` perf at scale — `src/app/api/v1/contracts/route.ts` GET now includes `renderedBody: { contains: search, mode: "insensitive" }` in the OR search. ILIKE on a large unindexed TEXT column can be slow at scale (10k+ contracts with large bodies). Acceptable now. Fix when needed: add a `tsvector` GIN index on `(organizationId, renderedBody)` and replace ILIKE with Prisma raw `to_tsvector` + `@@` query. Revisit at 10k+ contract scale. source: Slice 4b-1 spec note.
```

- [ ] **Step 2: Full TypeScript check**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit 2>&1 | grep -v "chatbot-autoreply\|mtm/photos\|social/enable-inbox" | head -30
```

Expected: no new errors compared to pre-Slice-4b-1 baseline.

---

## Task 12: Commit

- [ ] **Step 1: Stage exactly the listed files**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
git add prisma/schema.prisma \
  "prisma/migrations/20260607220000_contract_tags/migration.sql" \
  "src/app/api/v1/contracts/route.ts" \
  "src/app/api/v1/contracts/[id]/route.ts" \
  "src/app/api/v1/contract-tags/route.ts" \
  "src/app/api/v1/contract-tags/[id]/route.ts" \
  "src/app/(dashboard)/contracts/page.tsx" \
  messages/en.json \
  messages/ru.json \
  messages/az.json \
  src/__tests__/api-contract-tags.test.ts \
  src/__tests__/api-contracts-search.test.ts \
  memory/deferred_findings.md
```

- [ ] **Step 2: Verify only expected files are staged**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
git diff --name-only --cached
```

Expected output — exactly these files (no WIP files):
```
messages/az.json
messages/en.json
messages/ru.json
memory/deferred_findings.md
prisma/migrations/20260607220000_contract_tags/migration.sql
prisma/schema.prisma
src/__tests__/api-contract-tags.test.ts
src/__tests__/api-contracts-search.test.ts
src/app/(dashboard)/contracts/page.tsx
src/app/api/v1/contract-tags/[id]/route.ts
src/app/api/v1/contract-tags/route.ts
src/app/api/v1/contracts/[id]/route.ts
src/app/api/v1/contracts/route.ts
```

If any WIP files appear (`.xlsx`, `cron-customer-insights-snapshot.sh`, `chatbot-autoreply.ts`, mtm/photos, social/enable-inbox, inbox/whatsapp/telegram, `dialog.tsx`, `status-labels.ts`, `contracts/templates/page.tsx`), run `git restore --staged <file>` for each.

- [ ] **Step 3: Commit**

```bash
cd /Users/rashadrahimov/Documents/leaddrive-v2
git commit -m "$(cat <<'EOF'
feat(clm): Slice 4b-1 — contract tags + full-text search + advanced filters

ContractTag (org-scoped, m2m) + tag CRUD + same-org-guarded assignment. GET
/contracts now full-text searches title/number/notes/renderedBody/company and
filters by tags, value range, date ranges, type. Repository UI: search, tag filter
+ chips, advanced filter panel, tag management. Additive migration.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] ContractTag schema (id, orgId, name, color, unique per org, m2m) — Task 1
- [x] Migration additive (contract_tags + `_ContractToContractTag`) — Task 2
- [x] GET /contracts: full-text OR across title/contractNumber/notes/renderedBody/company.name — Task 3
- [x] New filters: tagIds, valueMin/Max, startFrom/startTo, endFrom/endTo, type — Task 3
- [x] Include tags in GET /contracts response — Task 3
- [x] PUT /contracts/[id]: accepts tagIds, validates same-org, calls tags.set — Task 4
- [x] Include tags in GET /contracts/[id] — Task 4
- [x] GET /contract-tags: org-scoped list with contract count — Task 5a
- [x] POST /contract-tags: create, module gate, org-scoped, unique-per-org 409 — Task 5a
- [x] PUT /contract-tags/[id]: rename/recolor, cross-tenant 404 — Task 5b
- [x] DELETE /contract-tags/[id]: delete + cascade, cross-tenant 404 — Task 5b
- [x] UI: search label updated, tag filter bar, tag chips on rows — Task 7
- [x] UI: advanced filter panel (value, dates, type) + active count badge + clear — Task 7
- [x] UI: tag management panel (create + delete) — Task 7
- [x] i18n en/ru/az surgical additions — Task 6
- [x] Tests: api-contract-tags.test.ts — Task 8
- [x] Tests: api-contracts-search.test.ts — Task 9
- [x] Existing tests green — Task 10
- [x] P3 renderedBody perf note in deferred_findings — Task 11
- [x] Commit with exact pathspec — Task 12

**Type consistency:**
- `ContractTag` interface in page.tsx matches the API shape `{ id, name, color, contractCount, createdAt, updatedAt }` — the `contractCount` is only on the list endpoint; contract rows include `{ id, name, color }` only.
- `tags.set` takes `{ id: tagId }` objects — matches Prisma implicit m2m `set` syntax.
- `orgHasModule("contracts")` — matches the module name used in versions/esign/pdf routes.
