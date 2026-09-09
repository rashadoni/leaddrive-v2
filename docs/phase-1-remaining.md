# Фаза 1: Недоделанные задачи (3 из 5)

## Контекст
Из 5 задач Фазы 1 выполнены 2: SSO/OAuth и Multiple Pipelines.
Остались 3 задачи. Выполняй последовательно, каждая — отдельный коммит.

**Перед началом**: прочитай `CLAUDE.md` и `docs/phase-1-task.md` (там полные детали).

---

## Задача 1: PWA / Мобильное приложение (S5)

### Что проверено и подтверждено отсутствует
- `public/manifest.json` — НЕТ
- `src/app/layout.tsx` — нет manifest metadata, нет viewport export
- `next.config.ts` — нет PWA plugin
- `package.json` — нет serwist, next-pwa, workbox
- Service worker — НЕТ (ни `src/sw.ts`, ни `public/sw.js`)

### Что сделать

#### 1. Установить serwist (замена deprecated next-pwa)
```bash
npm install @serwist/next serwist
```

#### 2. Создать `public/manifest.json`
```json
{
  "name": "LeadDrive CRM",
  "short_name": "LeadDrive",
  "description": "CRM с финансовым управлением для IT-аутсорсинга",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F3F4F7",
  "theme_color": "#001E3C",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

#### 3. Генерировать иконки
Из `public/apple-touch-icon.png` или логотипа создать 4 файла в `public/icons/`:
- `icon-192.png` (192x192)
- `icon-512.png` (512x512)
- `icon-maskable-192.png` (192x192, с padding для safe zone)
- `icon-maskable-512.png` (512x512, с padding для safe zone)

Можно использовать sharp или canvas для генерации, либо просто resize существующего apple-touch-icon.

#### 4. Обновить `src/app/layout.tsx`
Добавить manifest в metadata и экспортировать viewport:
```typescript
import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  // ... существующее ...
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LeadDrive CRM",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#001E3C",
}
```

#### 5. Настроить serwist в `next.config.ts`
```typescript
import withSerwistInit from "@serwist/next"

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
})

// Обернуть существующий config в withSerwist()
```

**ВАЖНО**: если serwist конфликтует с `output: "standalone"` или next-intl plugin, попробовать:
- Вариант A: отключить serwist и использовать только manifest.json (минимальный PWA)
- Вариант B: написать minimal service worker вручную без serwist

#### 6. Создать `src/sw.ts`
```typescript
import { defaultCache } from "@serwist/next/worker"
import { Serwist } from "serwist"

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
})

serwist.addEventListeners()
```

#### 7. Responsive проверка
Проверить мобильную адаптацию ключевых страниц:
- Dashboard — KPI cards должны быть в 1 колонку на mobile
- Deals — kanban горизонтальный scroll на mobile
- Sidebar — должен быть collapsible (проверить что уже работает)

### Коммит
```
feat: add PWA support with manifest and service worker
```

### Тест
```bash
npm run build  # должен пройти
# Lighthouse: PWA audit > 90
# Chrome DevTools > Application > Manifest — иконки и name корректны
```

---

## Задача 2: Skill-based Routing тикетов (T1)

### Что проверено и подтверждено отсутствует
- `prisma/schema.prisma` — User модель НЕ имеет `skills` поля
- `prisma/schema.prisma` — TicketQueue модель НЕ существует
- `src/app/api/v1/tickets/[id]/route.ts` — ТОЛЬКО least-loaded алгоритм (ищет users с role in ["admin","manager","agent"], считает открытые тикеты, назначает на минимально загруженного)
- `src/app/api/v1/ticket-queues/` — НЕ существует
- `src/app/(dashboard)/settings/ticket-queues/` — НЕ существует

### Что сделать

#### 1. Prisma: добавить в User и создать TicketQueue

В User модель добавить 3 поля:
```prisma
model User {
  // ... после существующих полей ...
  skills        String[]  @default([])       // ["billing", "technical", "onboarding"]
  maxTickets    Int       @default(20)       // max concurrent open tickets
  isAvailable   Boolean   @default(true)     // online/offline для routing
}
```

Новая модель TicketQueue:
```prisma
model TicketQueue {
  id             String   @id @default(cuid())
  organizationId String
  name           String                       // "Billing Support", "Technical"
  skills         String[]                     // required skills
  priority       Int      @default(0)         // higher = checked first
  autoAssign     Boolean  @default(true)
  assignMethod   String   @default("least_loaded")  // "least_loaded" | "round_robin"
  lastAssignedTo String?                      // for round-robin
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@map("ticket_queues")
}
```

```bash
npx prisma migrate dev --name add-ticket-queues-skills
```

#### 2. API: Новый алгоритм auto-assign в `src/app/api/v1/tickets/[id]/route.ts`

Заменить текущий least-loaded блок (найти где ищутся users с role in [...] и сортируются по кол-ву тикетов). Новая логика:

```typescript
async function autoAssignTicket(ticketId: string, orgId: string, category: string) {
  // 1. Найти очередь по category тикета
  const queue = await prisma.ticketQueue.findFirst({
    where: {
      organizationId: orgId,
      isActive: true,
      skills: { hasSome: [category] },
    },
    orderBy: { priority: "desc" },
  })

  // 2. Найти агентов: доступных, с matching skills (или всех если нет очереди)
  const agents = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      role: { in: ["admin", "manager", "agent", "support"] },
      isAvailable: true,
      ...(queue ? { skills: { hasSome: queue.skills } } : {}),
    },
  })

  if (agents.length === 0) return null

  // 3. Подсчитать загрузку
  const openCounts = await prisma.ticket.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      status: { notIn: ["closed", "resolved"] },
      assignedTo: { in: agents.map(a => a.id) },
    },
    _count: true,
  })
  const countMap = Object.fromEntries(openCounts.map(c => [c.assignedTo, c._count]))

  // 4. Фильтровать по capacity
  const available = agents.filter(a => (countMap[a.id] || 0) < a.maxTickets)
  if (available.length === 0) return null

  // 5. Выбрать: round-robin или least-loaded
  let assignee: typeof agents[0]
  if (queue?.assignMethod === "round_robin") {
    const lastIdx = available.findIndex(a => a.id === queue.lastAssignedTo)
    assignee = available[(lastIdx + 1) % available.length]
    await prisma.ticketQueue.update({
      where: { id: queue.id },
      data: { lastAssignedTo: assignee.id },
    })
  } else {
    available.sort((a, b) => (countMap[a.id] || 0) - (countMap[b.id] || 0))
    assignee = available[0]
  }

  // 6. Назначить
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { assignedTo: assignee.id },
  })
  return assignee
}
```

Также обновить `src/app/api/v1/tickets/route.ts` — при POST (создание тикета) вызывать этот же autoAssignTicket.

#### 3. API: CRUD для очередей

Создать `src/app/api/v1/ticket-queues/route.ts`:
- **GET**: findMany где organizationId = orgId, orderBy priority desc
- **POST**: create с валидацией (name, skills, assignMethod)

Создать `src/app/api/v1/ticket-queues/[id]/route.ts`:
- **PATCH**: update name, skills, priority, assignMethod, isActive
- **DELETE**: delete

#### 4. UI: Settings — управление очередями

Создать `src/app/(dashboard)/settings/ticket-queues/page.tsx`:
- Таблица очередей: name, skills (badges), method, priority, active toggle
- Кнопка "Создать очередь" → dialog с формой
- Inline edit или dialog edit
- Skills ввод: multi-select или comma-separated tags

#### 5. UI: Settings — навыки агентов

В `src/app/(dashboard)/settings/users/page.tsx` добавить:
- Per-user: multi-select "Skills" (tags)
- Toggle "Доступен" (isAvailable)
- Input "Max тикетов" (maxTickets)

#### 6. UI: Agent Desktop — availability toggle

В `src/app/(dashboard)/support/agent-desktop/page.tsx` добавить:
- Toggle кнопка в header: "Доступен" / "Не доступен"
- PATCH `/api/v1/users/me` с `{ isAvailable: true/false }`

### Файлы для изменения
- `prisma/schema.prisma` — User (3 поля) + TicketQueue модель
- `src/app/api/v1/tickets/[id]/route.ts` — новый assign алгоритм
- `src/app/api/v1/tickets/route.ts` — auto-assign при создании
- `src/app/api/v1/ticket-queues/route.ts` — НОВЫЙ
- `src/app/api/v1/ticket-queues/[id]/route.ts` — НОВЫЙ
- `src/app/(dashboard)/settings/ticket-queues/page.tsx` — НОВЫЙ
- `src/app/(dashboard)/settings/users/page.tsx` — skills UI
- `src/app/(dashboard)/support/agent-desktop/page.tsx` — availability toggle

### Коммит
```
feat: skill-based ticket routing with queues and agent availability
```

### Тест
```bash
npx prisma migrate dev --name add-ticket-queues-skills
npm run build
```

---

## Задача 3: SLA Auto-Escalation (T2)

### Что проверено и подтверждено отсутствует
- `prisma/schema.prisma` — EscalationRule модель НЕ существует
- `prisma/schema.prisma` — Ticket НЕ имеет `escalationLevel` поля
- `src/app/api/cron/sla-escalation/` — НЕ существует
- `src/app/api/v1/escalation-rules/` — НЕ существует
- `src/app/(dashboard)/settings/escalation/` — НЕ существует
- `Notification` модель — УЖЕ СУЩЕСТВУЕТ (можно использовать)

### Текущее состояние SLA
- SlaPolicy модель: `firstResponseHours`, `resolutionHours`, `businessHoursOnly`
- Ticket поля: `slaDueAt`, `slaFirstResponseDueAt`, `firstResponseAt`
- `getSlaStatus()` в tickets page: вычисляет breached/warning/ok
- При создании тикета SLA dueAt рассчитывается автоматически
- **НО**: при breach ничего не происходит — нет уведомлений, нет эскалации

### Что сделать

#### 1. Prisma: EscalationRule + Ticket.escalationLevel

```prisma
model EscalationRule {
  id              String   @id @default(cuid())
  organizationId  String
  name            String                        // "First Response Breach"
  triggerType     String                        // "first_response_breach" | "resolution_breach" | "resolution_warning"
  triggerMinutes  Int      @default(0)          // минуты после breach (0 = сразу)
  level           Int      @default(1)          // уровень: 1, 2, 3
  actions         Json                          // [{"type":"notify","target":"manager"}, {"type":"increase_priority"}]
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  @@index([organizationId])
  @@map("escalation_rules")
}
```

В Ticket модель добавить:
```prisma
model Ticket {
  // ... существующие поля ...
  escalationLevel    Int       @default(0)
  lastEscalatedAt    DateTime?
}
```

```bash
npx prisma migrate dev --name add-escalation-rules
```

#### 2. API: Cron endpoint `src/app/api/cron/sla-escalation/route.ts`

Логика:
1. Проверить CRON_SECRET (как в существующем `/api/v1/journeys/process`)
2. Найти все open тикеты где `slaDueAt < now` ИЛИ (`slaFirstResponseDueAt < now` И `firstResponseAt = null`)
3. Для каждого breached тикета:
   - Определить triggerType (first_response_breach или resolution_breach)
   - Найти EscalationRule для следующего уровня (`level = ticket.escalationLevel + 1`)
   - Проверить что прошло triggerMinutes после breach time
   - Выполнить actions:
     - `"notify"` → создать Notification для manager/admin
     - `"increase_priority"` → low→medium→high→critical
     - `"reassign_queue"` → вызвать autoAssignTicket (из задачи 2)
     - `"send_email"` → пока TODO (оставить комментарий)
   - Обновить ticket: `escalationLevel = rule.level`, `lastEscalatedAt = now`
   - Записать в AuditLog
4. Также найти warning тикеты (slaDueAt в пределах 2 часов) и отправить warning notifications

**ВАЖНО**: использовать существующую Notification модель для уведомлений.

#### 3. Cron schedule

Создать `scripts/cron-sla.sh`:
```bash
#!/bin/bash
curl -s -X POST -H "x-cron-secret: ${CRON_SECRET}" http://localhost:3001/api/cron/sla-escalation
```

Добавить в crontab на сервере:
```
*/5 * * * * /opt/leaddrive-v2/scripts/cron-sla.sh
```

#### 4. API: CRUD для правил эскалации

`src/app/api/v1/escalation-rules/route.ts`:
- **GET**: все правила для org, orderBy level asc
- **POST**: создать (name, triggerType, triggerMinutes, level, actions, isActive)

`src/app/api/v1/escalation-rules/[id]/route.ts`:
- **PATCH**: обновить
- **DELETE**: удалить

#### 5. UI: Settings — правила эскалации

Создать `src/app/(dashboard)/settings/escalation/page.tsx`:

Структура страницы:
```
┌──────────────────────────────────────────────────────────┐
│ Правила эскалации SLA                        [+ Добавить] │
├──────────────────────────────────────────────────────────┤
│ Level 1 │ First Response Breach          │ Сразу          │
│         │ → Уведомить менеджера          │ [Вкл] [Ред]   │
│         │ → Повысить приоритет           │                │
├──────────────────────────────────────────────────────────┤
│ Level 2 │ Resolution Breach              │ Сразу          │
│         │ → Уведомить менеджера          │ [Вкл] [Ред]   │
│         │ → Переназначить                │                │
├──────────────────────────────────────────────────────────┤
│ Level 3 │ Critical Escalation            │ +60 мин        │
│         │ → Уведомить руководство        │ [Вкл] [Ред]   │
│         │ → Email уведомление            │                │
└──────────────────────────────────────────────────────────┘
```

Форма создания/редактирования:
- name (text)
- triggerType (select: "Нарушение первого ответа", "Нарушение решения", "Предупреждение")
- triggerMinutes (number: "Минут после нарушения")
- level (number: 1-5)
- actions (multi-select checkboxes):
  - Уведомить менеджера
  - Повысить приоритет
  - Переназначить тикет
  - Отправить email (TODO)

#### 6. UI: Tickets page — индикатор эскалации

В `src/app/(dashboard)/tickets/page.tsx`:
- Добавить badge для эскалированных тикетов:
  - `escalationLevel === 1` → желтый badge "L1"
  - `escalationLevel === 2` → оранжевый badge "L2"
  - `escalationLevel >= 3` → красный badge "L3"
- Добавить фильтр: "Только эскалированные"

### Файлы для изменения
- `prisma/schema.prisma` — EscalationRule модель + Ticket (2 поля)
- `src/app/api/cron/sla-escalation/route.ts` — НОВЫЙ
- `src/app/api/v1/escalation-rules/route.ts` — НОВЫЙ
- `src/app/api/v1/escalation-rules/[id]/route.ts` — НОВЫЙ
- `src/app/(dashboard)/settings/escalation/page.tsx` — НОВЫЙ
- `src/app/(dashboard)/tickets/page.tsx` — escalation badges + filter
- `scripts/cron-sla.sh` — НОВЫЙ

### Коммит
```
feat: automatic SLA escalation with rules and cron monitoring
```

### Тест
```bash
npx prisma migrate dev --name add-escalation-rules
npm run build
# Создать escalation rule: level=1, triggerType="resolution_breach", actions=[notify, increase_priority]
# Создать тикет с SLA
# Руками обновить slaDueAt в прошлое (через Prisma Studio)
# Вызвать: curl -X POST -H "x-cron-secret: xxx" http://localhost:3000/api/cron/sla-escalation
# Проверить: escalationLevel=1, priority повышен, notification создан
```

---

## Порядок выполнения

```
1. PWA (S5)                   → коммит: "feat: add PWA support with manifest and service worker"
2. Skill-based Routing (T1)   → коммит: "feat: skill-based ticket routing with queues"
3. SLA Auto-escalation (T2)   → коммит: "feat: automatic SLA escalation with rules and cron"
```

Каждая задача — отдельный `npx prisma migrate dev` + `npm run build` + коммит.
После всех 3: деплой через `git push origin main`.

## Проверка после завершения
- [ ] PWA: `public/manifest.json` существует, layout.tsx имеет manifest metadata
- [ ] PWA: `npm run build` проходит (если serwist конфликтует — допустимо без service worker, но manifest обязателен)
- [ ] Routing: TicketQueue модель в schema, API `/api/v1/ticket-queues` работает
- [ ] Routing: User.skills поле есть, auto-assign учитывает skills
- [ ] SLA: EscalationRule модель в schema, cron endpoint существует
- [ ] SLA: Settings/escalation page показывает правила
- [ ] SLA: Tickets page показывает escalation badges
- [ ] `npm run build` проходит без ошибок
