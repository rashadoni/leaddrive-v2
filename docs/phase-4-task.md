# Фаза 4: Scale — Enterprise Readiness

## Контекст
Фаза 4 roadmap (3.7 → 4.1). Enterprise-grade features. 6 задач, ~20 недель.
Каждая задача разбита на подзадачи. Выполнять последовательно, каждая подзадача — отдельный коммит.

**Перед началом**: прочитай `CLAUDE.md` (защита UI, деплой правила).

---

## Задача 1: Field-Level Permissions + Sharing Rules (P2) — 3 недели

### Цель
Контроль видимости и редактирования каждого поля по ролям. Enterprise-клиенты не купят без granular permissions. Сейчас только module-level (companies: full/edit/view/none).

### Текущее состояние (аудит кода)

**Роли**: 5 системных (admin, manager, sales, support, viewer) + custom. Хранятся как строка `User.role`.

**Permissions library**: `src/lib/permissions.ts` (244 строки)
- Hardcoded RBAC матрица: role × module × action
- `checkPermission(role, module, action): boolean`
- 26 модулей, 5 actions (read, write, delete, export, admin)
- НЕТ field-level проверок

**API auth**: `src/lib/api-auth.ts`
- `requireAuth()` проверяет role-based permissions, но используется только в **24 из 218 API routes** (11%)
- `getOrgId()` используется в остальных — только tenant isolation

**Settings**: `src/app/api/v1/settings/roles/route.ts`
- Permissions хранятся в `Organization.settings` (JSON): `{ [roleId]: { [module]: "full"|"edit"|"view"|"none" } }`

**Custom Fields**: `prisma/schema.prisma` строки 1339-1356
- Нет полей `visibleToRoles`, `editableByRoles`

**Record-level access**: ❌ Нет. Deal.assignedTo, Lead.assignedTo существуют, но не используются для контроля доступа.

### Подзадача 1.1: Модель FieldPermission + миграция

В `prisma/schema.prisma`:

```prisma
model FieldPermission {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  roleId         String        // "admin", "manager", "sales", "support", "viewer", or custom role ID
  entityType     String        // "company", "contact", "deal", "lead", "ticket", "task"
  fieldName      String        // "phone", "email", "revenue", "salary", etc.
  access         String        // "visible" | "editable" | "hidden"
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, roleId, entityType, fieldName])
  @@index([organizationId, roleId, entityType])
  @@map("field_permissions")
}

model SharingRule {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  entityType     String        // "deal", "lead", "company", "contact"
  name           String
  description    String?
  ruleType       String        // "owner" | "role" | "team" | "all"
  sourceRole     String?       // Роль, чьи записи расшариваются
  targetRole     String?       // Роль, кому расшариваются
  accessLevel    String        // "read" | "readwrite"
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())

  @@index([organizationId, entityType])
  @@map("sharing_rules")
}
```

Миграция:
```bash
npx prisma migrate dev --name add_field_permissions_and_sharing_rules
```

**Чеклист подзадачи 1.1:**
- [ ] FieldPermission и SharingRule модели созданы
- [ ] Миграция применена
- [ ] `npx prisma generate` выполнен

### Подзадача 1.2: API для управления field permissions

Создать `src/app/api/v1/settings/field-permissions/route.ts`:

```typescript
// GET — матрица: { [entityType]: { [fieldName]: { [roleId]: access } } }
// Для каждого entityType возвращает ВСЕ поля с текущими permissions
// Поля без explicit permission → default "editable" (для admin), "visible" (для viewer)

// PUT — bulk update: принимает массив { roleId, entityType, fieldName, access }
// Валидация: admin всегда "editable" (нельзя скрыть от admin)
```

**Поля по entity** (определить в `src/lib/entity-fields.ts`):

```typescript
export const ENTITY_FIELDS: Record<string, { name: string; label: string; sensitive?: boolean }[]> = {
  company: [
    { name: "name", label: "Company Name" },
    { name: "industry", label: "Industry" },
    { name: "phone", label: "Phone", sensitive: true },
    { name: "email", label: "Email", sensitive: true },
    { name: "website", label: "Website" },
    { name: "address", label: "Address" },
    { name: "revenue", label: "Revenue", sensitive: true },
    { name: "employeeCount", label: "Employee Count" },
    { name: "leadScore", label: "Lead Score" },
    { name: "leadTemperature", label: "Lead Temperature" },
    { name: "notes", label: "Notes" },
  ],
  contact: [
    { name: "firstName", label: "First Name" },
    { name: "lastName", label: "Last Name" },
    { name: "email", label: "Email", sensitive: true },
    { name: "phone", label: "Phone", sensitive: true },
    { name: "position", label: "Position" },
    { name: "department", label: "Department" },
    { name: "notes", label: "Notes" },
  ],
  deal: [
    { name: "name", label: "Deal Name" },
    { name: "value", label: "Value", sensitive: true },
    { name: "expectedCloseDate", label: "Expected Close Date" },
    { name: "probability", label: "Probability" },
    { name: "notes", label: "Notes" },
    { name: "lossReason", label: "Loss Reason" },
  ],
  lead: [
    { name: "name", label: "Lead Name" },
    { name: "email", label: "Email", sensitive: true },
    { name: "phone", label: "Phone", sensitive: true },
    { name: "company", label: "Company" },
    { name: "estimatedValue", label: "Estimated Value", sensitive: true },
    { name: "score", label: "Score" },
    { name: "notes", label: "Notes" },
  ],
  ticket: [
    { name: "subject", label: "Subject" },
    { name: "description", label: "Description" },
    { name: "priority", label: "Priority" },
    { name: "category", label: "Category" },
    { name: "tags", label: "Tags" },
    { name: "satisfactionRating", label: "CSAT Rating" },
  ],
}
```

Также `src/app/api/v1/settings/sharing-rules/route.ts`:
```typescript
// GET — список sharing rules организации
// POST — создать правило
// PUT /[id] — обновить
// DELETE /[id] — удалить
```

**Чеклист подзадачи 1.2:**
- [ ] Field permissions GET/PUT API работает
- [ ] Sharing rules CRUD работает
- [ ] Admin нельзя ограничить (всегда editable)
- [ ] Entity fields definition создан

### Подзадача 1.3: Middleware для фильтрации полей в API responses

Создать `src/lib/field-filter.ts`:

```typescript
import { prisma } from "@/lib/prisma"

// Кэш permissions per request (чтобы не запрашивать БД для каждого поля)
const permissionCache = new Map<string, Record<string, string>>()

export async function getFieldPermissions(orgId: string, roleId: string, entityType: string) {
  const cacheKey = `${orgId}:${roleId}:${entityType}`
  if (permissionCache.has(cacheKey)) return permissionCache.get(cacheKey)!

  const permissions = await prisma.fieldPermission.findMany({
    where: { organizationId: orgId, roleId, entityType },
  })

  const map: Record<string, string> = {}
  for (const p of permissions) {
    map[p.fieldName] = p.access
  }

  permissionCache.set(cacheKey, map)
  // Очищать кэш каждые 60 секунд
  setTimeout(() => permissionCache.delete(cacheKey), 60000)

  return map
}

export function filterEntityFields<T extends Record<string, any>>(
  entity: T,
  permissions: Record<string, string>,
  role: string
): Partial<T> {
  if (role === "admin") return entity // admin видит всё

  const filtered: any = {}
  for (const [key, value] of Object.entries(entity)) {
    const access = permissions[key]
    // Нет explicit permission → visible по умолчанию
    if (!access || access === "visible" || access === "editable") {
      filtered[key] = value
    }
    // access === "hidden" → skip field
  }
  return filtered
}

export function filterWritableFields(
  data: Record<string, any>,
  permissions: Record<string, string>,
  role: string
): Record<string, any> {
  if (role === "admin") return data

  const filtered: any = {}
  for (const [key, value] of Object.entries(data)) {
    const access = permissions[key]
    if (!access || access === "editable") {
      filtered[key] = value
    }
    // "visible" or "hidden" → reject write
  }
  return filtered
}
```

Интегрировать в ключевые API routes:

```typescript
// В GET /api/v1/companies/route.ts:
const permissions = await getFieldPermissions(orgId, role, "company")
const filtered = companies.map(c => filterEntityFields(c, permissions, role))
return Response.json(filtered)

// В PUT /api/v1/companies/[id]/route.ts:
const permissions = await getFieldPermissions(orgId, role, "company")
const allowedData = filterWritableFields(body, permissions, role)
await prisma.company.update({ where: { id }, data: allowedData })
```

**Применить к следующим routes** (приоритетные):
- `src/app/api/v1/companies/route.ts` (GET, POST)
- `src/app/api/v1/companies/[id]/route.ts` (GET, PUT)
- `src/app/api/v1/contacts/route.ts` (GET, POST)
- `src/app/api/v1/contacts/[id]/route.ts` (GET, PUT)
- `src/app/api/v1/deals/route.ts` (GET, POST)
- `src/app/api/v1/deals/[id]/route.ts` (GET, PUT)
- `src/app/api/v1/leads/route.ts` (GET, POST)
- `src/app/api/v1/leads/[id]/route.ts` (GET, PUT)
- `src/app/api/v1/tickets/route.ts` (GET, POST)
- `src/app/api/v1/tickets/[id]/route.ts` (GET, PUT)

**Чеклист подзадачи 1.3:**
- [ ] `filterEntityFields` скрывает hidden поля в GET responses
- [ ] `filterWritableFields` блокирует запись в read-only поля
- [ ] Кэш permissions работает (не делает query на каждый request)
- [ ] 10 основных API routes интегрированы
- [ ] Admin всегда видит и редактирует все поля

### Подзадача 1.4: Record-Level Sharing Rules Engine

Создать `src/lib/sharing-rules.ts`:

```typescript
import { prisma } from "@/lib/prisma"

export async function applyRecordFilter(
  orgId: string,
  userId: string,
  role: string,
  entityType: string,
  baseWhere: any
) {
  if (role === "admin" || role === "manager") return baseWhere // Видят всё

  const rules = await prisma.sharingRule.findMany({
    where: { organizationId: orgId, entityType, isActive: true },
  })

  // Если нет правил → по умолчанию видишь только свои записи
  if (rules.length === 0) {
    return { ...baseWhere, OR: [{ assignedTo: userId }, { createdBy: userId }] }
  }

  // Применить правила
  const orConditions: any[] = [
    { assignedTo: userId },
    { createdBy: userId },
  ]

  for (const rule of rules) {
    if (rule.ruleType === "all") {
      return baseWhere // Полный доступ для всех
    }
    if (rule.ruleType === "role" && rule.targetRole === role) {
      // Эта роль видит записи sourceRole
      if (rule.sourceRole) {
        const sourceUsers = await prisma.user.findMany({
          where: { organizationId: orgId, role: rule.sourceRole },
          select: { id: true },
        })
        orConditions.push({
          OR: [
            { assignedTo: { in: sourceUsers.map(u => u.id) } },
            { createdBy: { in: sourceUsers.map(u => u.id) } },
          ],
        })
      }
    }
  }

  return { ...baseWhere, OR: orConditions }
}
```

Интегрировать в GET list routes для deals, leads, companies, contacts.

**Чеклист подзадачи 1.4:**
- [ ] Sharing rules engine создан
- [ ] Sales видит только свои записи по умолчанию (если нет правил)
- [ ] Admin/Manager видит все записи
- [ ] Правило "role → role" работает (sales видит записи других sales)
- [ ] 4+ entity list routes интегрированы

### Подзадача 1.5: Settings UI — Permission Matrix

Создать `src/app/(dashboard)/settings/field-permissions/page.tsx`:

```
┌─────────────────────────────────────────────────────────────┐
│ Field Permissions                                            │
├─────────────────────────────────────────────────────────────┤
│ Entity: [Companies ▼]                                        │
│                                                              │
│ Field          │ Admin   │ Manager │ Sales   │ Support│ View │
│ ─────────────────────────────────────────────────────────── │
│ Company Name   │ ✏️ Edit │ ✏️ Edit │ ✏️ Edit │ 👁 View│ 👁   │
│ Industry       │ ✏️ Edit │ ✏️ Edit │ ✏️ Edit │ 👁 View│ 👁   │
│ Phone          │ ✏️ Edit │ ✏️ Edit │ ✏️ Edit │ 🚫 Hide│ 🚫   │
│ Email          │ ✏️ Edit │ ✏️ Edit │ ✏️ Edit │ 🚫 Hide│ 🚫   │
│ Revenue        │ ✏️ Edit │ ✏️ Edit │ 👁 View │ 🚫 Hide│ 🚫   │
│ Employee Count │ ✏️ Edit │ ✏️ Edit │ ✏️ Edit │ 👁 View│ 👁   │
│                                                              │
│                                    [Reset Defaults] [Save]   │
├─────────────────────────────────────────────────────────────┤
│ Sharing Rules                                  [+ New Rule]  │
│ ─────────────────────────────────────────────────────────── │
│ "Sales team sees all sales deals"                            │
│ Rule: sales → sales | Access: Read/Write | ● Active         │
│                                                              │
│ "Support sees assigned tickets only"                         │
│ Rule: owner only | Access: Read | ● Active                   │
└─────────────────────────────────────────────────────────────┘
```

Каждая ячейка матрицы — dropdown с 3 опциями: Editable / Visible / Hidden.
Admin колонка заблокирована (всегда Editable, нельзя изменить).

**Чеклист подзадачи 1.5:**
- [ ] Permission matrix рендерится для каждого entityType
- [ ] Dropdown работает: editable/visible/hidden
- [ ] Admin столбец заблокирован
- [ ] Bulk save сохраняет все изменения
- [ ] Sharing rules CRUD работает через UI
- [ ] `npm run build` проходит без ошибок

### Подзадача 1.6: Frontend hook для conditional field rendering

Создать `src/hooks/use-field-permissions.ts`:

```typescript
"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState } from "react"

export function useFieldPermissions(entityType: string) {
  const { data: session } = useSession()
  const [permissions, setPermissions] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!entityType) return
    fetch(`/api/v1/settings/field-permissions?entityType=${entityType}`)
      .then(r => r.json())
      .then(data => {
        const role = session?.user?.role ?? "viewer"
        const rolePerms: Record<string, string> = {}
        for (const [field, roles] of Object.entries(data)) {
          rolePerms[field] = (roles as any)[role] ?? "editable"
        }
        setPermissions(rolePerms)
      })
  }, [entityType, session])

  return {
    permissions,
    isVisible: (field: string) => permissions[field] !== "hidden",
    isEditable: (field: string) => permissions[field] === "editable" || !permissions[field],
    isHidden: (field: string) => permissions[field] === "hidden",
  }
}
```

Использование в формах/деталях:
```tsx
const { isVisible, isEditable } = useFieldPermissions("company")

{isVisible("revenue") && (
  <div>
    <Label>Revenue</Label>
    <Input value={company.revenue} disabled={!isEditable("revenue")} />
  </div>
)}
```

**Чеклист подзадачи 1.6:**
- [ ] Hook возвращает permissions для текущего юзера
- [ ] `isVisible`, `isEditable`, `isHidden` работают корректно
- [ ] Скрытые поля не рендерятся
- [ ] Read-only поля показываются как disabled
- [ ] Как минимум 2 страницы (company detail, contact detail) используют hook

---

## Задача 2: Advanced Journey Editor (M3) — 4 недели

### Цель
Multi-branch conditions, A/B splits, goal tracking, pause/resume enrollments. Текущий journey editor — линейный с fake branching.

### Текущее состояние (аудит кода)

**Journey модели**: `prisma/schema.prisma` строки 1032-1086
- Journey: name, status (draft/active/paused/completed), triggerType, counters
- JourneyStep: stepType (8 типов), config (JSON), **yesNextStep/noNextStep** (Int, ❌ не используются!)
- JourneyEnrollment: contactId/leadId, currentStepId, status, nextActionAt

**8 step types**: send_email, sms, wait, condition, create_task, send_telegram, send_whatsapp, update_field

**Flow editor**: `src/components/journey-flow-editor.tsx` (299 строк)
- @xyflow/react, condition nodes имеют 2 handles (yes/no)
- НО: `flowToSteps()` линеаризирует через DFS — branching НЕ сохраняется
- Edges не несут metadata (какой handle: yes/no)

**Engine**: `src/lib/journey-engine.ts` (644 строки)
- Condition evaluation: field match → onTrue/onFalse actions (continue/skip/restart/stop)
- НЕТ реального branching: next step = stepOrder + 1
- `yesNextStep`/`noNextStep` поля в schema не используются

**Execution**: Cron каждые 60 сек, 50 enrollments per batch

### Подзадача 2.1: Расширить модели для branching + goals

В `prisma/schema.prisma` обновить JourneyStep:

```prisma
model JourneyStep {
  id             String   @id @default(cuid())
  journeyId      String
  journey        Journey  @relation(fields: [journeyId], references: [id], onDelete: Cascade)
  stepOrder      Int
  stepType       String   // send_email, sms, wait, condition, create_task,
                          // send_telegram, send_whatsapp, update_field,
                          // ab_split, goal_check, webhook  ← НОВЫЕ
  config         Json     @default("{}")
  // Branching — ИСПОЛЬЗОВАТЬ (были но игнорировались)
  yesNextStepId  String?  // ID следующего шага для true/default path
  noNextStepId   String?  // ID следующего шага для false path
  // A/B split
  splitPaths     Json?    // [{ percentage: 50, nextStepId: "..." }, { percentage: 50, nextStepId: "..." }]
  // Stats
  statsEntered   Int      @default(0)
  statsCompleted Int      @default(0)
  createdAt      DateTime @default(now())

  @@index([journeyId])
  @@map("journey_steps")
}
```

Добавить goal fields в Journey:

```prisma
model Journey {
  // ... существующие поля ...
  goalType         String?   // "deal_created" | "ticket_resolved" | "status_change" | "custom"
  goalConditions   Json?     // { field: "status", value: "converted" }
  goalTarget       Int?      // Target число конверсий
  exitOnGoal       Boolean   @default(true)  // Завершить enrollment при достижении goal
  maxEnrollmentDays Int?     // Auto-exit после N дней
}
```

Обновить JourneyEnrollment:

```prisma
model JourneyEnrollment {
  // ... существующие поля ...
  goalReachedAt    DateTime?
  exitReason       String?   // "completed" | "goal_reached" | "max_days" | "manual" | "condition_exit"
}
```

Миграция:
```bash
npx prisma migrate dev --name journey_branching_goals
```

**Чеклист подзадачи 2.1:**
- [ ] Новые stepTypes: ab_split, goal_check, webhook
- [ ] yesNextStepId / noNextStepId используют String (step ID, не order)
- [ ] splitPaths JSON для A/B split
- [ ] Goal fields в Journey
- [ ] ExitReason в Enrollment
- [ ] Миграция применена

### Подзадача 2.2: Переписать Flow Editor для реального branching

В `src/components/journey-flow-editor.tsx`:

**Ключевое изменение**: `flowToSteps()` должен сохранять edge metadata.

```typescript
function flowToSteps(nodes: Node[], edges: Edge[]): JourneyStepData[] {
  const steps: JourneyStepData[] = []

  for (const node of nodes) {
    if (node.id === "trigger-1") continue

    const step: JourneyStepData = {
      id: node.id,
      stepType: node.data.type,
      config: node.data.config ?? {},
      stepOrder: 0, // будет пересчитан
      yesNextStepId: null,
      noNextStepId: null,
      splitPaths: null,
    }

    // Найти edges выходящие из этого node
    const outEdges = edges.filter(e => e.source === node.id)

    if (node.data.type === "condition") {
      // yes handle = sourceHandle "yes", no handle = sourceHandle "no"
      const yesEdge = outEdges.find(e => e.sourceHandle === "yes")
      const noEdge = outEdges.find(e => e.sourceHandle === "no")
      step.yesNextStepId = yesEdge?.target ?? null
      step.noNextStepId = noEdge?.target ?? null
    } else if (node.data.type === "ab_split") {
      step.splitPaths = outEdges.map((e, i) => ({
        percentage: node.data.config?.percentages?.[i] ?? Math.floor(100 / outEdges.length),
        nextStepId: e.target,
      }))
    } else {
      // Обычный step: один output
      step.yesNextStepId = outEdges[0]?.target ?? null
    }

    steps.push(step)
  }

  // Пересчитать stepOrder через BFS от trigger
  assignStepOrders(steps, edges)

  return steps
}
```

**Добавить edge labels**: Для condition edges показывать "Yes" (зелёный) и "No" (красный).

**Добавить новые node types**:
- `ab_split`: 2-4 output handles с процентами
- `goal_check`: special node с описанием goal condition
- `webhook`: send HTTP POST to URL

**Чеклист подзадачи 2.2:**
- [ ] flowToSteps сохраняет yesNextStepId/noNextStepId из edges
- [ ] Condition nodes: edge labels "Yes" / "No"
- [ ] A/B split node: 2-4 выхода с процентами
- [ ] Goal check node добавлен
- [ ] Webhook node добавлен
- [ ] stepsToFlow корректно восстанавливает branching из DB

### Подзадача 2.3: Обновить Journey Engine для branching

В `src/lib/journey-engine.ts` изменить логику перехода:

```typescript
async function getNextStep(currentStep: JourneyStep, conditionResult?: boolean) {
  if (currentStep.stepType === "condition") {
    const nextId = conditionResult ? currentStep.yesNextStepId : currentStep.noNextStepId
    if (!nextId) return null // End of branch
    return prisma.journeyStep.findUnique({ where: { id: nextId } })
  }

  if (currentStep.stepType === "ab_split" && currentStep.splitPaths) {
    const paths = currentStep.splitPaths as { percentage: number; nextStepId: string }[]
    // Random selection weighted by percentage
    const rand = Math.random() * 100
    let cumulative = 0
    for (const path of paths) {
      cumulative += path.percentage
      if (rand <= cumulative) {
        return prisma.journeyStep.findUnique({ where: { id: path.nextStepId } })
      }
    }
    return prisma.journeyStep.findUnique({ where: { id: paths[paths.length - 1].nextStepId } })
  }

  // Default: follow yesNextStepId (single path)
  if (currentStep.yesNextStepId) {
    return prisma.journeyStep.findUnique({ where: { id: currentStep.yesNextStepId } })
  }

  // Fallback: stepOrder + 1 (backward compatibility)
  return prisma.journeyStep.findFirst({
    where: { journeyId: currentStep.journeyId, stepOrder: currentStep.stepOrder + 1 },
  })
}
```

**Добавить step types**:
- `ab_split`: random routing по percentages
- `goal_check`: проверить condition → если true, завершить enrollment с goalReachedAt
- `webhook`: POST to config.url с payload (fire-and-forget)

**Чеклист подзадачи 2.3:**
- [ ] Condition branching: yes path / no path по step ID
- [ ] A/B split: random weighted routing
- [ ] Goal check: evaluate condition + mark enrollment
- [ ] Webhook step: HTTP POST с payload
- [ ] Backward compatibility: stepOrder fallback для старых journeys

### Подзадача 2.4: Goal Tracking + Auto-Exit

В cron process route (`src/app/api/v1/journeys/process/route.ts`) добавить:

```typescript
// Перед обработкой каждого enrollment — проверить goals
if (journey.goalType && journey.exitOnGoal) {
  const goalReached = await checkGoal(enrollment, journey)
  if (goalReached) {
    await prisma.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: "completed",
        exitReason: "goal_reached",
        goalReachedAt: new Date(),
        completedAt: new Date(),
      },
    })
    await prisma.journey.update({
      where: { id: journey.id },
      data: { conversionCount: { increment: 1 }, activeCount: { decrement: 1 } },
    })
    continue // Skip step processing
  }
}

// Проверить max enrollment days
if (journey.maxEnrollmentDays) {
  const enrolledDays = (Date.now() - enrollment.enrolledAt.getTime()) / 86400000
  if (enrolledDays > journey.maxEnrollmentDays) {
    await prisma.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "completed", exitReason: "max_days", completedAt: new Date() },
    })
    continue
  }
}
```

Goal check function:
```typescript
async function checkGoal(enrollment: any, journey: any): Promise<boolean> {
  const conditions = journey.goalConditions as any
  if (!conditions) return false

  switch (journey.goalType) {
    case "deal_created":
      const dealCount = await prisma.deal.count({
        where: { contactId: enrollment.contactId, createdAt: { gte: enrollment.enrolledAt } },
      })
      return dealCount > 0

    case "status_change":
      if (enrollment.leadId) {
        const lead = await prisma.lead.findUnique({ where: { id: enrollment.leadId } })
        return lead?.status === conditions.value
      }
      return false

    case "ticket_resolved":
      const resolved = await prisma.ticket.count({
        where: { contactId: enrollment.contactId, status: "resolved", updatedAt: { gte: enrollment.enrolledAt } },
      })
      return resolved > 0

    default:
      return false
  }
}
```

**Чеклист подзадачи 2.4:**
- [ ] Goal check выполняется перед каждым step processing
- [ ] Goal reached → enrollment completed, conversionCount++
- [ ] Max days → auto-exit
- [ ] exitReason записывается корректно
- [ ] Journey UI показывает goal progress (conversionCount / goalTarget)

### Подзадача 2.5: Pause/Resume + Enrollment Management

Создать `src/app/api/v1/journeys/enrollments/[id]/route.ts`:

```typescript
// PATCH — pause, resume, cancel enrollment
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { action } = await req.json() // "pause" | "resume" | "cancel"

  switch (action) {
    case "pause":
      await prisma.journeyEnrollment.update({
        where: { id: params.id },
        data: { status: "paused", nextActionAt: null },
      })
      break
    case "resume":
      await prisma.journeyEnrollment.update({
        where: { id: params.id },
        data: { status: "active", nextActionAt: new Date() },
      })
      break
    case "cancel":
      await prisma.journeyEnrollment.update({
        where: { id: params.id },
        data: { status: "completed", exitReason: "manual", completedAt: new Date() },
      })
      break
  }
}
```

В journey page UI — табличка enrollments с actions: Pause / Resume / Cancel.

**Чеклист подзадачи 2.5:**
- [ ] Pause stops processing (nextActionAt = null)
- [ ] Resume restarts processing (nextActionAt = now)
- [ ] Cancel terminates with exitReason "manual"
- [ ] UI показывает enrollments с action buttons
- [ ] Journey analytics показывает: active, paused, completed (by exitReason)
- [ ] `npm run build` проходит без ошибок

---

## Задача 3: Multi-Agent Orchestration (A6) — 3 недели

### Цель
Несколько AI агентов с разной специализацией + intent classifier + handoff. Сейчас — один "Da Vinci" agent для всего.

### Текущее состояние (аудит кода)

**AI Chat**: `src/app/api/v1/ai/chat/route.ts`
- ONE agent: загружает первый `aiAgentConfig` с `isActive: true`
- Hard-coded имя "Da Vinci" в system prompt
- Все 8 CRM tools доступны любому запросу
- 5 rounds max tool_use

**AI Agent Config**: `prisma/schema.prisma` строки 1112-1133
- Существует модель AiAgentConfig
- НЕТ полей: agentType, department, priority, handoffTargets

**Portal Chat**: `src/app/api/v1/public/portal-chat/route.ts` — отдельный prompt, но та же архитектура

**Ticket AI**: `src/app/api/v1/tickets/ai/route.ts` — hardcoded Haiku, отдельный prompt

**Tools**: `src/lib/ai/tools.ts` — 8 tools, все в одном массиве CRM_TOOLS

**Interaction Log**: agentConfigId поле? — нужно проверить

### Подзадача 3.1: Расширить AiAgentConfig + новые модели

В `prisma/schema.prisma`:

```prisma
model AiAgentConfig {
  // ... существующие поля ...
  agentType        String    @default("general")  // "sales", "support", "marketing", "analyst", "general"
  department       String?
  priority         Int       @default(0)     // Higher = preferred
  handoffTargets   String[]  @default([])    // Agent config IDs this can handoff to
  intents          String[]  @default([])    // Intents this agent handles: ["sales_inquiry", "pricing", "demo_request"]
  greeting         String?                   // Custom greeting message
  maxToolRounds    Int       @default(5)
}

model AgentHandoff {
  id             String   @id @default(cuid())
  organizationId String
  sessionId      String   // AI session ID
  fromAgentId    String   // AiAgentConfig ID
  toAgentId      String   // AiAgentConfig ID
  reason         String
  context        Json     // Conversation summary for target agent
  status         String   @default("pending") // pending, accepted, completed
  createdAt      DateTime @default(now())
  resolvedAt     DateTime?

  @@index([organizationId, sessionId])
  @@map("agent_handoffs")
}
```

Обновить AiInteractionLog (добавить agentConfigId если ещё нет):
```prisma
model AiInteractionLog {
  // ... существующие поля ...
  agentConfigId  String?
  agentType      String?
}
```

**Чеклист подзадачи 3.1:**
- [ ] agentType, intents, handoffTargets добавлены в AiAgentConfig
- [ ] AgentHandoff модель создана
- [ ] AiInteractionLog имеет agentConfigId
- [ ] Миграция применена

### Подзадача 3.2: Intent Classifier

Создать `src/lib/ai/intent-classifier.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk"

const INTENT_CATEGORIES = [
  "sales_inquiry",    // Вопросы о продуктах, ценах, скидках
  "support_request",  // Проблемы, баги, жалобы
  "billing_question", // Оплата, счета, подписки
  "marketing_info",   // Маркетинговые отчёты, кампании
  "data_analysis",    // Аналитика, прогнозы, дашборды
  "general",          // Общие вопросы, приветствия
] as const

export type Intent = typeof INTENT_CATEGORIES[number]

export async function classifyIntent(message: string): Promise<{
  intent: Intent
  confidence: number
}> {
  const client = new Anthropic()

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001", // Haiku для быстрой классификации
    max_tokens: 100,
    system: `You are an intent classifier for a CRM system. Classify the user message into ONE of these categories:
${INTENT_CATEGORIES.join(", ")}

Respond ONLY with JSON: {"intent": "category", "confidence": 0.0-1.0}`,
    messages: [{ role: "user", content: message }],
  })

  try {
    const text = response.content[0].type === "text" ? response.content[0].text : ""
    return JSON.parse(text)
  } catch {
    return { intent: "general", confidence: 0.5 }
  }
}
```

**Чеклист подзадачи 3.2:**
- [ ] Classifier использует Haiku (быстро + дёшево)
- [ ] 6 категорий intents
- [ ] Возвращает intent + confidence
- [ ] Fallback на "general" при ошибке

### Подзадача 3.3: Agent Router

Создать `src/lib/ai/agent-router.ts`:

```typescript
import { prisma } from "@/lib/prisma"
import { classifyIntent, Intent } from "./intent-classifier"

// Маппинг intent → agentType
const INTENT_TO_AGENT: Record<Intent, string> = {
  sales_inquiry: "sales",
  support_request: "support",
  billing_question: "support",
  marketing_info: "marketing",
  data_analysis: "analyst",
  general: "general",
}

export async function routeToAgent(orgId: string, message: string, previousAgentId?: string) {
  const { intent, confidence } = await classifyIntent(message)

  const preferredType = INTENT_TO_AGENT[intent]

  // 1. Найти специализированного агента
  let agent = await prisma.aiAgentConfig.findFirst({
    where: {
      organizationId: orgId,
      isActive: true,
      agentType: preferredType,
    },
    orderBy: { priority: "desc" },
  })

  // 2. Fallback: general agent
  if (!agent) {
    agent = await prisma.aiAgentConfig.findFirst({
      where: { organizationId: orgId, isActive: true, agentType: "general" },
    })
  }

  // 3. Fallback: any active agent
  if (!agent) {
    agent = await prisma.aiAgentConfig.findFirst({
      where: { organizationId: orgId, isActive: true },
    })
  }

  return {
    agent,
    intent,
    confidence,
    isHandoff: previousAgentId ? agent?.id !== previousAgentId : false,
  }
}
```

**Чеклист подзадачи 3.3:**
- [ ] Intent → agentType маппинг
- [ ] Fallback: specialized → general → any
- [ ] Определяет нужен ли handoff (agent changed)

### Подзадача 3.4: Обновить AI Chat Route

В `src/app/api/v1/ai/chat/route.ts`:

```typescript
// БЫЛО:
const agentConfig = await prisma.aiAgentConfig.findFirst({
  where: { organizationId: orgId, isActive: true },
})

// СТАЛО:
import { routeToAgent } from "@/lib/ai/agent-router"
import { getEnabledToolsForAgent } from "@/lib/ai/tools"

const { agent: agentConfig, intent, confidence, isHandoff } = await routeToAgent(
  orgId,
  body.message,
  body.previousAgentId
)

// Если handoff — создать запись
if (isHandoff && body.previousAgentId) {
  await prisma.agentHandoff.create({
    data: {
      organizationId: orgId,
      sessionId: body.sessionId ?? crypto.randomUUID(),
      fromAgentId: body.previousAgentId,
      toAgentId: agentConfig.id,
      reason: `Intent changed to ${intent}`,
      context: { lastMessages: body.messages?.slice(-3) },
    },
  })
}

// Tools per agent type
const tools = getEnabledToolsForAgent(agentConfig)
```

В `src/lib/ai/tools.ts` добавить tool sets по agentType:

```typescript
const AGENT_TOOL_SETS: Record<string, string[]> = {
  sales: ["create_deal", "update_deal_stage", "log_activity", "add_note", "send_email", "create_task"],
  support: ["create_ticket", "add_note", "log_activity", "create_task"],
  marketing: ["log_activity", "add_note", "create_task"],
  analyst: ["add_note"],
  general: ["add_note", "log_activity", "create_task"],
}

export function getEnabledToolsForAgent(config: any) {
  const allowedNames = config.toolsEnabled?.length > 0
    ? config.toolsEnabled
    : AGENT_TOOL_SETS[config.agentType] ?? AGENT_TOOL_SETS.general

  return CRM_TOOLS.filter(t => allowedNames.includes(t.name))
}
```

**Чеклист подзадачи 3.4:**
- [ ] Chat route использует routeToAgent вместо findFirst
- [ ] Handoff записывается в AgentHandoff table
- [ ] Tools фильтруются по agentType
- [ ] agentConfigId записывается в AiInteractionLog
- [ ] System prompt берётся из config (не hardcoded)

### Подзадача 3.5: AI Command Center — Multi-Agent Dashboard

Обновить `src/app/(dashboard)/ai-command-center/page.tsx`:

Добавить секции:
1. **Agent Cards** — карточка для каждого активного агента (тип, имя, модель, stats)
2. **Per-Agent Metrics** — CSAT, latency, cost, interactions breakdown по agentType
3. **Handoff Log** — таблица handoffs с from/to/reason
4. **Intent Distribution** — pie chart: какие intents приходят чаще

```
┌─ Active Agents ────────────────────────────────────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │🔵 Sales  │ │🟢 Support│ │🟣 Market │ │⚪ Gen  │ │
│ │ Sonnet 4 │ │ Haiku 4  │ │ Haiku 4  │ │ Sonnet │ │
│ │ 234 msgs │ │ 189 msgs │ │ 45 msgs  │ │ 67 msg │ │
│ │ $12.30   │ │ $2.10    │ │ $0.45    │ │ $5.20  │ │
│ └──────────┘ └──────────┘ └──────────┘ └────────┘ │
├────────────────────────────────────────────────────┤
│ Recent Handoffs                                     │
│ Sales → Support  "Customer reported bug"  2min ago  │
│ General → Sales  "Pricing question"      15min ago  │
└────────────────────────────────────────────────────┘
```

Создать endpoint `src/app/api/v1/ai-configs/stats/route.ts`:
```typescript
// Возвращает per-agent metrics:
// { agentConfigId, agentType, totalInteractions, avgLatency, totalCost, avgCsat }
```

**Чеклист подзадачи 3.5:**
- [ ] Agent cards показывают тип, модель, количество interactions, cost
- [ ] Per-agent metrics из interaction logs
- [ ] Handoff log таблица
- [ ] Seed: создать 4 default agent configs (sales, support, marketing, general)
- [ ] `npm run build` проходит без ошибок

---

## Задача 4: VoIP Integration (C1) — 3 недели

### Цель
Click-to-call из CRM, автоматическая запись звонков, call logging. Сейчас — только `tel:` ссылки.

### Текущее состояние (аудит кода)

**Calls**: Activity model с type "call" — ручное логирование
**Phone fields**: Contact.phone, Contact.phones[], Company.phone
**Click-to-call**: `<a href="tel:">` — открывает системный dialer
**VoIP SDK**: ❌ Нет Twilio, Asterisk, Zadarma, SIP
**ChannelConfig**: поддерживает telegram, whatsapp, sms, facebook — нет voip
**SMS**: Twilio SDK для SMS уже используется в journey-engine.ts

### Подзадача 4.1: Установить Twilio + модели

```bash
npm install twilio
```

> Twilio выбран потому что SMS уже через Twilio (journey-engine), unified billing.

Новые модели в `prisma/schema.prisma`:

```prisma
model CallLog {
  id             String    @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  callSid        String?   @unique  // Twilio Call SID
  direction      String    // "outbound" | "inbound"
  fromNumber     String
  toNumber       String
  status         String    @default("initiated")  // initiated, ringing, in-progress, completed, busy, no-answer, failed
  duration       Int?      // seconds
  recordingUrl   String?
  transcription  String?   @db.Text
  contactId      String?
  contact        Contact?  @relation(fields: [contactId], references: [id])
  companyId      String?
  dealId         String?
  userId         String?   // Agent who made/received the call
  activityId     String?   // Linked Activity record
  notes          String?   @db.Text
  startedAt      DateTime?
  endedAt        DateTime?
  createdAt      DateTime  @default(now())

  @@index([organizationId, contactId])
  @@index([callSid])
  @@map("call_logs")
}
```

Добавить VoIP fields в ChannelConfig (уже поддерживает channelType = "voip"):
```prisma
// ChannelConfig.channelType теперь включает "voip"
// settings JSON: { accountSid, authToken, twilioNumber, recordCalls: true }
```

**Чеклист подзадачи 4.1:**
- [ ] `npm install twilio` выполнен
- [ ] CallLog модель создана
- [ ] Миграция применена

### Подзадача 4.2: Call Initiation API

Создать `src/app/api/v1/calls/route.ts`:

```typescript
import twilio from "twilio"

// POST — инициировать звонок
export async function POST(req: Request) {
  const orgId = await getOrgId(req)
  const { toNumber, contactId, companyId, dealId } = await req.json()

  // Загрузить VoIP config
  const voipConfig = await prisma.channelConfig.findFirst({
    where: { organizationId: orgId, channelType: "voip", isActive: true },
  })
  if (!voipConfig) return Response.json({ error: "VoIP not configured" }, { status: 400 })

  const settings = voipConfig.settings as any
  const client = twilio(settings.accountSid, settings.authToken)

  // Создать запись в CallLog
  const callLog = await prisma.callLog.create({
    data: {
      organizationId: orgId,
      direction: "outbound",
      fromNumber: settings.twilioNumber,
      toNumber,
      status: "initiated",
      contactId,
      companyId,
      dealId,
      userId,
      startedAt: new Date(),
    },
  })

  // Инициировать через Twilio
  const call = await client.calls.create({
    to: toNumber,
    from: settings.twilioNumber,
    url: `${process.env.NEXTAUTH_URL}/api/v1/calls/twiml`,
    statusCallback: `${process.env.NEXTAUTH_URL}/api/v1/calls/webhook`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    record: settings.recordCalls ?? false,
  })

  await prisma.callLog.update({
    where: { id: callLog.id },
    data: { callSid: call.sid },
  })

  return Response.json({ callLogId: callLog.id, callSid: call.sid })
}

// GET — список звонков
export async function GET(req: Request) {
  const orgId = await getOrgId(req)
  const calls = await prisma.callLog.findMany({
    where: { organizationId: orgId },
    include: { contact: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  })
  return Response.json(calls)
}
```

**Чеклист подзадачи 4.2:**
- [ ] POST /api/v1/calls инициирует Twilio звонок
- [ ] CallLog создаётся с callSid
- [ ] GET /api/v1/calls возвращает историю звонков

### Подзадача 4.3: Webhook для статусов + Recording

Создать `src/app/api/v1/calls/webhook/route.ts`:

```typescript
// POST — Twilio status callback (public, verified by Twilio signature)
export async function POST(req: Request) {
  const formData = await req.formData()
  const callSid = formData.get("CallSid") as string
  const status = formData.get("CallStatus") as string
  const duration = formData.get("CallDuration") as string
  const recordingUrl = formData.get("RecordingUrl") as string

  const callLog = await prisma.callLog.findUnique({ where: { callSid } })
  if (!callLog) return new Response("Not found", { status: 404 })

  const updateData: any = { status }

  if (duration) updateData.duration = parseInt(duration)
  if (recordingUrl) updateData.recordingUrl = recordingUrl
  if (status === "completed" || status === "busy" || status === "no-answer" || status === "failed") {
    updateData.endedAt = new Date()

    // Auto-create Activity record
    await prisma.activity.create({
      data: {
        organizationId: callLog.organizationId,
        type: "call",
        subject: `${callLog.direction === "outbound" ? "Outbound" : "Inbound"} call (${duration ?? 0}s)`,
        description: `Call to ${callLog.toNumber}. Status: ${status}. Duration: ${duration ?? 0}s`,
        contactId: callLog.contactId,
        companyId: callLog.companyId,
        createdBy: callLog.userId,
        completedAt: new Date(),
      },
    })

    // Track contact event
    if (callLog.contactId) {
      await trackContactEvent(callLog.organizationId, callLog.contactId, "call_logged", {
        direction: callLog.direction, duration, status,
      })
    }
  }

  await prisma.callLog.update({ where: { callSid }, data: updateData })

  return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } })
}
```

Создать `src/app/api/v1/calls/twiml/route.ts`:
```typescript
// TwiML для Twilio — что делать при подключении
export async function POST() {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Number>{{To}}</Number>
  </Dial>
</Response>`
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } })
}
```

**Чеклист подзадачи 4.3:**
- [ ] Webhook обновляет status, duration, recordingUrl
- [ ] Auto-создаёт Activity record при завершении
- [ ] Contact event tracking при звонке
- [ ] TwiML endpoint работает

### Подзадача 4.4: Click-to-Call UI

В `src/app/(dashboard)/contacts/[id]/page.tsx` и company detail:

Заменить `<a href="tel:">` на кнопку с VoIP:

```typescript
async function handleClickToCall(phone: string) {
  setCallStatus("calling")
  const res = await fetch("/api/v1/calls", {
    method: "POST",
    body: JSON.stringify({ toNumber: phone, contactId: contact.id }),
  })
  const data = await res.json()
  setActiveCallId(data.callLogId)
  // Poll status every 2 seconds
  pollCallStatus(data.callLogId)
}
```

Компонент `src/components/call-widget.tsx`:

```
┌─ Active Call ──────────────────────┐
│ 📞 Calling John Smith...          │
│ +1 555-0123                       │
│ Duration: 2:34                    │
│                                   │
│ [🔴 End Call]  [📝 Add Note]     │
└───────────────────────────────────┘
```

Floating widget в углу экрана при активном звонке.

**Чеклист подзадачи 4.4:**
- [ ] Click-to-call кнопка рядом с каждым phone number
- [ ] Call widget показывает статус и duration
- [ ] Можно добавить заметку во время звонка
- [ ] End call работает

### Подзадача 4.5: Call History + VoIP Settings

Добавить вкладку "Calls" в contact detail page (рядом с Activity timeline):

```
┌─ Call History ──────────────────────────────────┐
│ Date        │ Direction│ Duration│ Status│ Agent │
│ Apr 5, 14:30│ Outbound │ 3:45   │ ✅    │ Admin │
│ Apr 3, 10:15│ Inbound  │ 1:20   │ ✅    │ Sales │
│ Apr 1, 09:00│ Outbound │ 0:00   │ ❌ NA │ Admin │
└─────────────────────────────────────────────────┘
```

VoIP Settings: `src/app/(dashboard)/settings/voip/page.tsx`:

```
┌─ VoIP Configuration ────────────────────────────┐
│ Provider: Twilio                                 │
│ Account SID: [AC...]                            │
│ Auth Token: [••••••••]                          │
│ Phone Number: [+1...]                           │
│ Record Calls: ☑ Yes                             │
│                                                  │
│ [Test Connection]  [Save]                        │
└──────────────────────────────────────────────────┘
```

**Чеклист подзадачи 4.5:**
- [ ] Call history таблица на contact/company detail
- [ ] VoIP settings page с конфигурацией Twilio
- [ ] Test connection проверяет credentials
- [ ] Calls доступны в inbox (как канал)
- [ ] `npm run build` проходит без ошибок

---

## Задача 5: Custom Report Builder (F1) — 3 недели

### Цель
Drag-and-drop конструктор отчётов с выбором entity, полей, фильтров, группировок и визуализаций. Сохранение + scheduled email.

### Текущее состояние (аудит кода)

**Reports page**: `src/app/(dashboard)/reports/page.tsx` — 10 hardcoded отчётов (financial, pipeline, funnel, tasks, SLA, CSAT, etc.)
**Charts**: recharts v3.8.0 (Area, Bar, Composed, Pie, Line + custom SVG)
**Export**: exceljs + jspdf установлены, но экспорт только для pricing module
**Saved reports**: ❌ Нет модели SavedReport
**Dashboard**: Widget config system (toggle widgets, DashboardLayout model)
**Cross-entity**: Executive API aggregates 10+ entities, но hardcoded queries
**Scheduled reports**: ❌ Нет

### Подзадача 5.1: Модель SavedReport + миграция

```prisma
model SavedReport {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  description    String?
  entityType     String          // "deals", "contacts", "companies", "leads", "tickets", "tasks", "activities"
  columns        Json            // [{ field: "name", label: "Name" }, { field: "value", aggregate: "sum" }]
  filters        Json    @default("[]")  // [{ field: "status", op: "eq", value: "won" }]
  groupBy        String?         // Field to group by
  sortBy         String?         // Field to sort by
  sortOrder      String  @default("desc")
  chartType      String? @default("table")  // "table", "bar", "line", "pie", "area", "funnel"
  chartConfig    Json?           // Chart-specific settings
  isShared       Boolean @default(false)
  createdBy      String
  scheduleFreq   String?         // "daily", "weekly", "monthly", null = no schedule
  scheduleEmails String[] @default([])  // Recipients for scheduled reports
  lastRunAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId])
  @@map("saved_reports")
}
```

**Чеклист подзадачи 5.1:**
- [ ] SavedReport модель создана
- [ ] Миграция применена

### Подзадача 5.2: Report Query Engine

Создать `src/lib/report-engine.ts`:

```typescript
import { prisma } from "@/lib/prisma"

const ENTITY_CONFIGS: Record<string, {
  model: string
  fields: { name: string; label: string; type: "string" | "number" | "date" | "boolean" }[]
  relations?: { name: string; model: string; fields: string[] }[]
}> = {
  deals: {
    model: "deal",
    fields: [
      { name: "name", label: "Deal Name", type: "string" },
      { name: "value", label: "Value", type: "number" },
      { name: "status", label: "Status", type: "string" },
      { name: "stage", label: "Stage", type: "string" },
      { name: "probability", label: "Probability", type: "number" },
      { name: "expectedCloseDate", label: "Expected Close", type: "date" },
      { name: "createdAt", label: "Created", type: "date" },
      { name: "closedAt", label: "Closed", type: "date" },
    ],
    relations: [
      { name: "company", model: "company", fields: ["name", "industry"] },
      { name: "assignedToUser", model: "user", fields: ["name", "email"] },
    ],
  },
  contacts: {
    model: "contact",
    fields: [
      { name: "firstName", label: "First Name", type: "string" },
      { name: "lastName", label: "Last Name", type: "string" },
      { name: "email", label: "Email", type: "string" },
      { name: "phone", label: "Phone", type: "string" },
      { name: "position", label: "Position", type: "string" },
      { name: "engagementScore", label: "Engagement", type: "number" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "company", model: "company", fields: ["name", "industry"] },
    ],
  },
  // ... companies, leads, tickets, tasks, activities (аналогично)
}

export async function executeReport(orgId: string, config: {
  entityType: string
  columns: { field: string; aggregate?: "count" | "sum" | "avg" | "min" | "max" }[]
  filters: { field: string; op: string; value: any }[]
  groupBy?: string
  sortBy?: string
  sortOrder?: string
  limit?: number
}) {
  const entityConfig = ENTITY_CONFIGS[config.entityType]
  if (!entityConfig) throw new Error("Unknown entity type")

  // Build WHERE
  const where: any = { organizationId: orgId }
  for (const f of config.filters) {
    switch (f.op) {
      case "eq": where[f.field] = f.value; break
      case "neq": where[f.field] = { not: f.value }; break
      case "gt": where[f.field] = { gt: f.value }; break
      case "lt": where[f.field] = { lt: f.value }; break
      case "gte": where[f.field] = { gte: f.value }; break
      case "lte": where[f.field] = { lte: f.value }; break
      case "contains": where[f.field] = { contains: f.value, mode: "insensitive" }; break
      case "in": where[f.field] = { in: Array.isArray(f.value) ? f.value : [f.value] }; break
      case "between":
        if (f.value.from && f.value.to) {
          where[f.field] = { gte: new Date(f.value.from), lte: new Date(f.value.to) }
        }
        break
    }
  }

  // GroupBy aggregation
  if (config.groupBy) {
    const aggregates: any = {}
    for (const col of config.columns) {
      if (col.aggregate) {
        aggregates[`_${col.aggregate}`] = { [col.field]: true }
      }
    }

    const result = await (prisma as any)[entityConfig.model].groupBy({
      by: [config.groupBy],
      where,
      ...aggregates,
      _count: { id: true },
      orderBy: config.sortBy
        ? { [config.sortBy]: config.sortOrder ?? "desc" }
        : { _count: { id: "desc" } },
      take: config.limit ?? 100,
    })

    return { type: "grouped", data: result, groupBy: config.groupBy }
  }

  // Flat query
  const select: any = {}
  const include: any = {}

  for (const col of config.columns) {
    if (col.field.includes(".")) {
      // Relation field: "company.name"
      const [rel, field] = col.field.split(".")
      include[rel] = { select: { [field]: true } }
    } else {
      select[col.field] = true
    }
  }

  const result = await (prisma as any)[entityConfig.model].findMany({
    where,
    select: Object.keys(select).length > 0 ? { ...select, id: true } : undefined,
    include: Object.keys(include).length > 0 ? include : undefined,
    orderBy: config.sortBy ? { [config.sortBy]: config.sortOrder ?? "desc" } : { createdAt: "desc" },
    take: config.limit ?? 500,
  })

  return { type: "flat", data: result }
}

export function getEntityConfigs() {
  return ENTITY_CONFIGS
}
```

**Чеклист подзадачи 5.2:**
- [ ] Report engine поддерживает 7 entity types
- [ ] Фильтры: eq, neq, gt, lt, contains, in, between
- [ ] GroupBy с агрегатами (count, sum, avg)
- [ ] Relation fields (company.name)
- [ ] Sort + limit

### Подзадача 5.3: Report Builder API

Создать `src/app/api/v1/reports/builder/route.ts`:

```typescript
// GET — список сохранённых отчётов пользователя
// POST — создать/сохранить отчёт
```

`src/app/api/v1/reports/builder/[id]/route.ts`:
```typescript
// GET — загрузить отчёт + выполнить query
// PUT — обновить конфиг отчёта
// DELETE — удалить
```

`src/app/api/v1/reports/builder/preview/route.ts`:
```typescript
// POST — выполнить query без сохранения (preview)
```

`src/app/api/v1/reports/builder/export/route.ts`:
```typescript
// POST — export report as CSV or Excel
import ExcelJS from "exceljs"

// Для CSV:
const csv = data.map(row => columns.map(c => row[c.field]).join(",")).join("\n")

// Для Excel:
const workbook = new ExcelJS.Workbook()
const sheet = workbook.addWorksheet("Report")
sheet.addRow(columns.map(c => c.label))
for (const row of data) {
  sheet.addRow(columns.map(c => row[c.field]))
}
const buffer = await workbook.xlsx.writeBuffer()
```

**Чеклист подзадачи 5.3:**
- [ ] CRUD API для saved reports
- [ ] Preview endpoint выполняет query без сохранения
- [ ] Export CSV/Excel работает

### Подзадача 5.4: Report Builder UI

Создать `src/app/(dashboard)/reports/builder/page.tsx`:

```
┌─────────────────────────────────────────────────────────────┐
│ Report Builder                              [Save] [Export]  │
├──────────────────────┬──────────────────────────────────────┤
│ Configuration        │ Preview                               │
│                      │                                       │
│ Entity: [Deals ▼]   │ ┌─────────────────────────────────┐  │
│                      │ │    Deal Pipeline by Stage        │  │
│ Columns:             │ │    ┌──┐                          │  │
│ ☑ Deal Name          │ │    │  │ ┌──┐                    │  │
│ ☑ Value              │ │    │  │ │  │ ┌──┐               │  │
│ ☑ Stage              │ │ ───┤  ├─┤  ├─┤  ├── ─ ─        │  │
│ ☑ Company Name       │ │   Lead Prop Nego Won             │  │
│ □ Expected Close     │ │                                   │  │
│ □ Assigned To        │ │ Total: $2.4M | Avg: $48K         │  │
│                      │ └─────────────────────────────────┘  │
│ Filters:             │                                       │
│ Status = active      │ ┌──────────────────────────────────┐ │
│ Value > 10000        │ │ Name    │ Value   │ Stage │ Co.  │ │
│ [+ Add Filter]       │ │ Deal A  │ $50,000 │ Nego  │ Acme │ │
│                      │ │ Deal B  │ $35,000 │ Prop  │ Beta │ │
│ Group By: [Stage ▼]  │ │ Deal C  │ $22,000 │ Lead  │ Corp │ │
│ Sort: [Value ▼] desc │ └──────────────────────────────────┘ │
│                      │                                       │
│ Chart: [Bar ▼]       │                                       │
│                      │                                       │
│ ── Saved Reports ──  │                                       │
│ • Pipeline by Stage  │                                       │
│ • Monthly Revenue    │                                       │
│ • Lead Sources       │                                       │
└──────────────────────┴──────────────────────────────────────┘
```

Left panel: конфигурация (entity, columns checkboxes, filters, groupBy, chart type).
Right panel: live preview (обновляется при изменении конфига).

**Чеклист подзадачи 5.4:**
- [ ] Entity selector с 7 типами
- [ ] Column picker (checkboxes) с relation fields
- [ ] Filter builder (field + op + value)
- [ ] GroupBy dropdown
- [ ] Chart type selector (table, bar, line, pie, area)
- [ ] Live preview обновляется при изменении
- [ ] Save/Load отчётов

### Подзадача 5.5: Scheduled Reports (Email)

Создать `src/app/api/cron/scheduled-reports/route.ts`:

```typescript
// POST — cron каждый день в 8:00
// Находит reports с scheduleFreq != null и lastRunAt < threshold
// Выполняет query, генерирует Excel, отправляет email через sendEmail()

export async function POST(req: Request) {
  // Verify CRON_SECRET
  const now = new Date()

  const reports = await prisma.savedReport.findMany({
    where: {
      scheduleFreq: { not: null },
      scheduleEmails: { isEmpty: false },
    },
  })

  for (const report of reports) {
    const shouldRun = checkSchedule(report.scheduleFreq, report.lastRunAt, now)
    if (!shouldRun) continue

    const result = await executeReport(report.organizationId, {
      entityType: report.entityType,
      columns: report.columns as any,
      filters: report.filters as any,
      groupBy: report.groupBy ?? undefined,
      sortBy: report.sortBy ?? undefined,
    })

    // Generate Excel
    const buffer = await generateExcelBuffer(result.data, report.columns as any)

    // Send to each recipient
    for (const email of report.scheduleEmails) {
      await sendEmail({
        to: email,
        subject: `[LeadDrive] Report: ${report.name}`,
        html: `<p>Automated report "${report.name}" attached.</p>`,
        attachments: [{ filename: `${report.name}.xlsx`, content: buffer }],
        organizationId: report.organizationId,
      })
    }

    await prisma.savedReport.update({
      where: { id: report.id },
      data: { lastRunAt: now },
    })
  }
}
```

**Чеклист подзадачи 5.5:**
- [ ] Cron находит scheduled reports
- [ ] Daily/weekly/monthly расписание работает
- [ ] Excel attachment генерируется
- [ ] Email отправляется через sendEmail
- [ ] lastRunAt обновляется
- [ ] `npm run build` проходит без ошибок

---

## Задача 6: Landing Page Builder (M5) — 4 недели

### Цель
Визуальный конструктор landing pages с формами, публикация по URL, конверсионная аналитика.

### Текущее состояние (аудит кода)

**Page builder**: ❌ Нет. Нет GrapesJS или аналогов.
**Email builder**: Unlayer (`react-email-editor`) уже установлен для email шаблонов — паттерн известен.
**Web-to-lead**: `src/app/api/v1/public/leads/route.ts` — public POST endpoint, CORS enabled.
**Public routes**: Middleware позволяет: /landing, /marketing, /home, /pricing, /features, /demo, /about, /blog
**File upload**: Только contracts (local FS, 10MB max). Нет image upload для страниц.
**Domain**: leaddrivecrm.org (marketing) + app.leaddrivecrm.org (CRM). Нет custom subdomains.
**Event registration**: `/api/v1/public/events/[id]/register` — публичная форма, работает.
**Portal**: `/portal/` — авторизованный доступ для клиентов.

### Подзадача 6.1: Модели + GrapesJS установка

```bash
npm install grapesjs grapesjs-preset-webpage grapesjs-blocks-basic
```

> GrapesJS выбран вместо Unlayer потому что Unlayer — email-only. GrapesJS — полноценный page builder (drag-and-drop, responsive, компоненты).

В `prisma/schema.prisma`:

```prisma
model LandingPage {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  slug           String           // URL slug: /p/my-landing-page
  description    String?
  gjsData        Json?            // GrapesJS project data (components + styles + assets)
  htmlContent    String?  @db.Text // Rendered HTML for serving
  cssContent     String?  @db.Text // Rendered CSS
  formId         String?          // Linked lead capture form config
  formConfig     Json?            // { fields: [...], successMessage: "...", redirectUrl: "..." }
  status         String   @default("draft")  // "draft" | "published" | "archived"
  publishedAt    DateTime?
  // Analytics
  totalViews     Int      @default(0)
  totalSubmissions Int    @default(0)
  // SEO
  metaTitle      String?
  metaDescription String?
  ogImage        String?
  createdBy      String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, slug])
  @@index([organizationId])
  @@map("landing_pages")
}

model PageView {
  id             String   @id @default(cuid())
  landingPageId  String
  landingPage    LandingPage @relation(fields: [landingPageId], references: [id], onDelete: Cascade)
  visitorIp      String?
  userAgent      String?
  referrer       String?
  utmSource      String?
  utmMedium      String?
  utmCampaign    String?
  createdAt      DateTime @default(now())

  @@index([landingPageId, createdAt])
  @@map("page_views")
}

model FormSubmission {
  id             String   @id @default(cuid())
  organizationId String
  landingPageId  String?
  landingPage    LandingPage? @relation(fields: [landingPageId], references: [id])
  formData       Json            // { name: "...", email: "...", phone: "..." }
  leadId         String?         // Created lead ID
  source         String?         // UTM source
  ipAddress      String?
  createdAt      DateTime @default(now())

  @@index([organizationId, landingPageId])
  @@map("form_submissions")
}
```

**Чеклист подзадачи 6.1:**
- [ ] GrapesJS + presets установлены
- [ ] LandingPage, PageView, FormSubmission модели созданы
- [ ] Миграция применена

### Подзадача 6.2: GrapesJS Editor Page

Создать `src/app/(dashboard)/pages/[id]/edit/page.tsx`:

```typescript
"use client"

import { useEffect, useRef, useState } from "react"
import grapesjs, { Editor } from "grapesjs"
import "grapesjs/dist/css/grapes.min.css"

export default function PageEditor({ params }: { params: { id: string } }) {
  const editorRef = useRef<Editor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = grapesjs.init({
      container: containerRef.current,
      height: "100vh",
      width: "auto",
      plugins: ["grapesjs-preset-webpage", "grapesjs-blocks-basic"],
      storageManager: false, // Manual save
      canvas: { styles: ["https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css"] },
    })

    // Добавить custom blocks
    editor.BlockManager.add("lead-form", {
      label: "Lead Capture Form",
      category: "Forms",
      content: `
        <form data-gjs-type="lead-form" class="p-6 bg-white rounded-lg shadow max-w-md mx-auto">
          <h3 class="text-xl font-bold mb-4">Get Started</h3>
          <input type="text" name="name" placeholder="Your Name" class="w-full p-3 border rounded mb-3" required />
          <input type="email" name="email" placeholder="Email" class="w-full p-3 border rounded mb-3" required />
          <input type="tel" name="phone" placeholder="Phone" class="w-full p-3 border rounded mb-3" />
          <input type="text" name="company" placeholder="Company" class="w-full p-3 border rounded mb-3" />
          <button type="submit" class="w-full p-3 bg-blue-600 text-white rounded font-semibold">Submit</button>
        </form>
      `,
    })

    editor.BlockManager.add("hero-section", {
      label: "Hero Section",
      category: "Sections",
      content: `
        <section class="py-20 px-6 bg-gradient-to-r from-blue-600 to-blue-800 text-white text-center">
          <h1 class="text-5xl font-bold mb-4">Your Headline Here</h1>
          <p class="text-xl mb-8 opacity-90">Subheadline with value proposition</p>
          <a href="#form" class="px-8 py-3 bg-white text-blue-800 rounded-lg font-semibold text-lg">Get Started</a>
        </section>
      `,
    })

    // Ещё blocks: features, testimonials, CTA, pricing, footer

    // Загрузить сохранённый дизайн
    fetch(`/api/v1/pages/${params.id}`)
      .then(r => r.json())
      .then(page => {
        if (page.gjsData) {
          editor.loadProjectData(page.gjsData)
        }
      })

    editorRef.current = editor
  }, [params.id])

  async function handleSave() {
    const editor = editorRef.current!
    const gjsData = editor.getProjectData()
    const html = editor.getHtml()
    const css = editor.getCss()

    await fetch(`/api/v1/pages/${params.id}`, {
      method: "PUT",
      body: JSON.stringify({ gjsData, htmlContent: html, cssContent: css }),
    })
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center justify-between p-3 border-b bg-background">
        <h2 className="font-semibold">Page Editor</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/pages")}>Back</Button>
          <Button onClick={handleSave}>Save</Button>
          <Button onClick={handlePublish}>Publish</Button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  )
}
```

**Чеклист подзадачи 6.2:**
- [ ] GrapesJS инициализируется и рендерится
- [ ] Custom blocks: lead form, hero, features, testimonials, CTA, footer
- [ ] Load/Save project data работает
- [ ] Tailwind CSS подключен в canvas

### Подзадача 6.3: Landing Page API + Public Serving

Создать `src/app/api/v1/pages/route.ts`:
```typescript
// GET — список landing pages организации
// POST — создать новую (name, slug)
```

`src/app/api/v1/pages/[id]/route.ts`:
```typescript
// GET — получить page с gjsData
// PUT — обновить (gjsData, htmlContent, cssContent, formConfig, status, meta*)
// DELETE — удалить
```

`src/app/api/v1/pages/[id]/publish/route.ts`:
```typescript
// POST — опубликовать (status = "published", publishedAt = now)
```

**Public serving** — создать `src/app/(public)/p/[slug]/page.tsx`:

```typescript
// Server component — renders published landing page HTML
export default async function PublicLandingPage({ params }: { params: { slug: string } }) {
  // Найти page по slug (без auth)
  const page = await prisma.landingPage.findFirst({
    where: { slug: params.slug, status: "published" },
  })

  if (!page) return notFound()

  // Track page view
  await prisma.pageView.create({
    data: {
      landingPageId: page.id,
      // IP, user agent, referrer from headers
    },
  })

  await prisma.landingPage.update({
    where: { id: page.id },
    data: { totalViews: { increment: 1 } },
  })

  return (
    <html>
      <head>
        <title>{page.metaTitle ?? page.name}</title>
        <meta name="description" content={page.metaDescription ?? ""} />
        {page.ogImage && <meta property="og:image" content={page.ogImage} />}
        <style dangerouslySetInnerHTML={{ __html: page.cssContent ?? "" }} />
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@3/dist/tailwind.min.css" rel="stylesheet" />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: page.htmlContent ?? "" }} />
        <script dangerouslySetInnerHTML={{ __html: formSubmissionScript(page.id, page.organizationId) }} />
      </body>
    </html>
  )
}

function formSubmissionScript(pageId: string, orgId: string) {
  return `
    document.querySelectorAll('[data-gjs-type="lead-form"]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        await fetch('/api/v1/public/form-submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId: '${pageId}', orgId: '${orgId}', ...data }),
        });
        form.innerHTML = '<p class="text-green-600 text-xl font-semibold p-8">Thank you! We will contact you soon.</p>';
      });
    });
  `
}
```

**Middleware update** — добавить `/p/` в publicPaths:
```typescript
// В src/middleware.ts, добавить в publicPaths:
"/p",
```

**Чеклист подзадачи 6.3:**
- [ ] CRUD API для landing pages
- [ ] Publish endpoint
- [ ] Public route `/p/[slug]` рендерит HTML
- [ ] Page view tracking
- [ ] Middleware позволяет public доступ к /p/

### Подзадача 6.4: Form Submission + Lead Creation

Создать `src/app/api/v1/public/form-submit/route.ts`:

```typescript
// POST — public, no auth required
export async function POST(req: Request) {
  const { pageId, orgId, name, email, phone, company, ...extra } = await req.json()

  // Найти landing page
  const page = await prisma.landingPage.findUnique({ where: { id: pageId } })
  if (!page || page.status !== "published") {
    return Response.json({ error: "Page not found" }, { status: 404 })
  }

  // Сохранить submission
  const submission = await prisma.formSubmission.create({
    data: {
      organizationId: page.organizationId,
      landingPageId: pageId,
      formData: { name, email, phone, company, ...extra },
      source: extra.utm_source ?? "landing_page",
    },
  })

  // Создать Lead
  const lead = await prisma.lead.create({
    data: {
      organizationId: page.organizationId,
      name: name ?? email,
      email,
      phone,
      company,
      source: "landing_page",
      notes: `From landing page: ${page.name}`,
      status: "new",
      priority: "medium",
    },
  })

  await prisma.formSubmission.update({
    where: { id: submission.id },
    data: { leadId: lead.id },
  })

  // Increment page submissions counter
  await prisma.landingPage.update({
    where: { id: pageId },
    data: { totalSubmissions: { increment: 1 } },
  })

  // Apply lead assignment rules
  await applyLeadAssignmentRules(page.organizationId, lead.id)

  return Response.json({ success: true })
}
```

**Чеклист подзадачи 6.4:**
- [ ] Form submission сохраняется в FormSubmission
- [ ] Lead автоматически создаётся
- [ ] Lead assignment rules применяются
- [ ] totalSubmissions инкрементируется

### Подзадача 6.5: Landing Pages Management UI + Analytics

Создать `src/app/(dashboard)/pages/page.tsx`:

```
┌─────────────────────────────────────────────────────────────┐
│ Landing Pages                                  [+ New Page]  │
├─────────────────────────────────────────────────────────────┤
│ ┌────────────────────┐  ┌────────────────────┐              │
│ │ [Preview Thumb]    │  │ [Preview Thumb]    │              │
│ │                    │  │                    │              │
│ │ Product Launch     │  │ Free Demo          │              │
│ │ /p/product-launch  │  │ /p/free-demo       │              │
│ │ Views: 1,234       │  │ Views: 567         │              │
│ │ Submissions: 89    │  │ Submissions: 34    │              │
│ │ Conv: 7.2%         │  │ Conv: 6.0%         │              │
│ │ ● Published        │  │ ○ Draft            │              │
│ │ [Edit] [Analytics] │  │ [Edit] [Publish]   │              │
│ └────────────────────┘  └────────────────────┘              │
├─────────────────────────────────────────────────────────────┤
│ Page Analytics: Product Launch                               │
│ ┌─────────────────────────────────────────┐                 │
│ │ Views ━━━━━━━━━━━━━━━━━━               │                 │
│ │ Submissions ━━━━━━━                     │                 │
│ │ Conv Rate: 7.2%                         │                 │
│ └─────────────────────────────────────────┘                 │
│                                                              │
│ Recent Submissions:                                          │
│ John Smith | john@acme.com | Apr 5 | → Lead #L-234          │
│ Jane Doe   | jane@beta.io  | Apr 4 | → Lead #L-231          │
└─────────────────────────────────────────────────────────────┘
```

**Чеклист подзадачи 6.5:**
- [ ] Page list с preview cards (name, slug, views, submissions, conversion)
- [ ] Create new page dialog (name + slug)
- [ ] Edit → opens GrapesJS editor
- [ ] Publish/Unpublish toggle
- [ ] Analytics: views/submissions chart, recent submissions table
- [ ] Click on submission → opens linked lead
- [ ] `npm run build` проходит без ошибок

---

## Общий порядок выполнения

```
Задача 1 (Field Permissions)   → 3 нед  (6 подзадач) — НЕЗАВИСИМАЯ
Задача 2 (Journey Editor)      → 4 нед  (5 подзадач) — НЕЗАВИСИМАЯ
Задача 3 (Multi-Agent)         → 3 нед  (5 подзадач) — НЕЗАВИСИМАЯ
Задача 4 (VoIP)                → 3 нед  (5 подзадач) — НЕЗАВИСИМАЯ
Задача 5 (Report Builder)      → 3 нед  (5 подзадач) — НЕЗАВИСИМАЯ
Задача 6 (Landing Pages)       → 4 нед  (5 подзадач) — НЕЗАВИСИМАЯ
```

Все задачи независимы друг от друга. Можно делать в любом порядке.
Рекомендуемый порядок: 1 → 3 → 5 → 2 → 4 → 6 (от самого impactful для enterprise).

## Финальная проверка после всех задач

```bash
npm run build
npx prisma generate
npx prisma studio     # Проверить все новые таблицы
```

Деплой:
```bash
git push origin main
```

Проверить:
1. Settings → Field Permissions → матрица ролей × полей работает
2. Journeys → condition branching yes/no path, A/B split, goals
3. AI Chat → разные агенты для sales/support вопросов, handoff log
4. Contacts → Click-to-call → Twilio звонок, call widget
5. Reports → Builder → выбрать entity, колонки, фильтры, chart → save → export Excel
6. Pages → создать landing page → GrapesJS editor → publish → /p/slug → form submission → lead created
