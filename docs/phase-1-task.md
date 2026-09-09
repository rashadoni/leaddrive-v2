# Фаза 1: Foundation — детальная задача для Codex

## Контекст
Это первая фаза roadmap по достижению уровня Salesforce (2.9 → 3.1).
5 задач, ~11 недель. Выполнять последовательно (каждая задача — отдельный коммит).

**ВАЖНО**: Перед началом прочитать `CLAUDE.md` — там правила защиты UI, деплоя, и т.д.

---

## Задача 1: SSO / OAuth Providers (P1) — 2 недели

### Цель
Добавить вход через Google и Microsoft (Azure AD) помимо email/password. Без SSO enterprise-клиенты не купят CRM.

### Текущее состояние
- **NextAuth v5** (beta.30): `src/lib/auth.ts` — только Credentials provider
- **JWT стратегия**: 8-часовые сессии, cookie с domain handling
- **Middleware**: `src/middleware.ts` — проверяет auth, инжектит orgId/role
- **User модель**: `prisma/schema.prisma` строки 104-135 — нет Account модели для OAuth
- **2FA**: TOTP уже реализован (totpSecret, totpEnabled, backupCodes)

### Что сделать

#### 1.1 Prisma: добавить Account модель
```prisma
// Добавить в prisma/schema.prisma ПОСЛЕ модели User

model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String  // "oauth" | "credentials"
  provider          String  // "google" | "microsoft" | "credentials"
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("accounts")
}
```
И добавить в User модель:
```prisma
model User {
  // ... существующие поля ...
  accounts  Account[]  // ДОБАВИТЬ
}
```

Затем:
```bash
npx prisma migrate dev --name add-oauth-accounts
```

#### 1.2 NextAuth: добавить Google + Microsoft providers
**Файл**: `src/lib/auth.ts`

```typescript
import Google from "next-auth/providers/google"
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"

export const authOptions = {
  adapter: PrismaAdapter(prisma),  // ДОБАВИТЬ — сохраняет Account в БД
  providers: [
    // СУЩЕСТВУЮЩИЙ Credentials provider — оставить как есть
    Credentials({ ... }),

    // ДОБАВИТЬ:
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,  // чтобы Google + Credentials с одним email работали
    }),

    MicrosoftEntraId({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: process.env.MICROSOFT_TENANT_ID || "common",
      allowDangerousEmailAccountLinking: true,
    }),
  ],

  // ИЗМЕНИТЬ session strategy:
  // При OAuth adapter использует "database" strategy по умолчанию,
  // но нам нужен JWT чтобы сохранить orgId/role в токене
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },

  // ДОБАВИТЬ в callbacks.signIn:
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" || account?.provider === "microsoft-entra-id") {
        // Найти или создать пользователя + организацию
        const existing = await prisma.user.findFirst({
          where: { email: user.email! },
        })
        if (!existing) {
          // Первый вход через OAuth — создать org + user
          const org = await prisma.organization.create({
            data: { name: `${user.name}'s Organization`, plan: "starter" },
          })
          await prisma.user.create({
            data: {
              email: user.email!,
              name: user.name || user.email!.split("@")[0],
              role: "admin",
              organizationId: org.id,
              passwordHash: "",  // OAuth user — без пароля
            },
          })
        }
        return true
      }
      return true  // Credentials — обработка уже есть
    },

    // СУЩЕСТВУЮЩИЕ jwt и session callbacks — оставить,
    // но добавить fallback для OAuth users:
    async jwt({ token, user, account }) {
      if (user) {
        const dbUser = await prisma.user.findFirst({
          where: { email: token.email! },
          include: { organization: true },
        })
        if (dbUser) {
          token.role = dbUser.role
          token.organizationId = dbUser.organizationId
          token.organizationName = dbUser.organization?.name || ""
          token.plan = dbUser.organization?.plan || "starter"
        }
      }
      return token
    },
    // session callback — оставить как есть
  },
}
```

#### 1.3 Login page: добавить кнопки OAuth
**Файл**: `src/app/(auth)/login/page.tsx`

Добавить после формы email/password:
```tsx
<div className="relative my-6">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-border" />
  </div>
  <div className="relative flex justify-center text-xs">
    <span className="bg-background px-2 text-muted-foreground">или</span>
  </div>
</div>

<div className="grid gap-3">
  <Button
    variant="outline"
    className="w-full"
    onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
  >
    <GoogleIcon className="mr-2 h-4 w-4" />
    Войти через Google
  </Button>
  <Button
    variant="outline"
    className="w-full"
    onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/dashboard" })}
  >
    <MicrosoftIcon className="mr-2 h-4 w-4" />
    Войти через Microsoft
  </Button>
</div>
```

#### 1.4 Settings: страница управления OAuth
**Файл**: создать `src/app/(dashboard)/settings/security/page.tsx` (или добавить секцию в существующий)

- Показать привязанные аккаунты (Google, Microsoft)
- Кнопки "Привязать" / "Отвязать"
- Если user создан через OAuth и нет passwordHash — показать "Установить пароль"

#### 1.5 Environment variables
Добавить в `.env`:
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
```

#### 1.6 Middleware: обновить для OAuth callbacks
**Файл**: `src/middleware.ts`

Добавить в publicPaths:
```typescript
const publicPaths = [
  // ... существующие ...
  "/api/auth/callback/google",
  "/api/auth/callback/microsoft-entra-id",
]
```

### Файлы для изменения
- `prisma/schema.prisma` — Account модель + User relation
- `src/lib/auth.ts` — providers, adapter, callbacks
- `src/app/(auth)/login/page.tsx` — OAuth кнопки
- `src/middleware.ts` — public paths
- `.env` / `.env.example` — новые переменные
- Создать: `src/app/(dashboard)/settings/security/page.tsx`

### Тест
```bash
npx prisma migrate dev --name add-oauth-accounts
npm run build
# Проверить: login page показывает кнопки Google/Microsoft
# Без реальных OAuth credentials кнопки будут, но redirect не сработает
```

---

## Задача 2: Множественные Pipelines (S1) — 2 недели

### Цель
Заменить hardcoded 6 стадий на динамические pipeline из БД. Каждая организация может создать N pipeline (Enterprise, SMB, Renewal).

### Текущее состояние
- **Hardcoded стадии**: `src/app/(dashboard)/deals/page.tsx` строки 51-58 — массив STAGES
- **Deal detail**: `src/app/(dashboard)/deals/[id]/page.tsx` строки 24-31 — STAGE_STYLES
- **API**: `src/app/api/v1/deals/route.ts` строка 81 — default `stage: "LEAD"`
- **Schema**: PipelineStage модель УЖЕ СУЩЕСТВУЕТ (строки 532-549) но НЕ ИСПОЛЬЗУЕТСЯ
- **Deal модель**: `stage String @default("LEAD")` — просто строка, нет связи с PipelineStage

### Что сделать

#### 2.1 Prisma: добавить Pipeline модель + связать с Deal
```prisma
model Pipeline {
  id             String          @id @default(cuid())
  organizationId String
  name           String          // "Enterprise Sales", "SMB", "Renewal"
  isDefault      Boolean         @default(false)
  isActive       Boolean         @default(true)
  sortOrder      Int             @default(0)
  createdAt      DateTime        @default(now())
  stages         PipelineStage[]
  deals          Deal[]

  @@index([organizationId])
  @@map("pipelines")
}
```

Обновить PipelineStage (уже существует, добавить связь):
```prisma
model PipelineStage {
  // ... существующие поля ...
  pipelineId String           // ДОБАВИТЬ
  pipeline   Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)  // ДОБАВИТЬ
}
```

Обновить Deal:
```prisma
model Deal {
  // ... существующие поля ...
  pipelineId    String?          // ДОБАВИТЬ (nullable для обратной совместимости)
  pipeline      Pipeline? @relation(fields: [pipelineId], references: [id])  // ДОБАВИТЬ
  stageId       String?          // ДОБАВИТЬ — ссылка на PipelineStage
  // stage String — ОСТАВИТЬ для обратной совместимости, но постепенно мигрировать
}
```

#### 2.2 Миграция: создать default pipeline из текущих стадий
```bash
npx prisma migrate dev --name add-pipelines
```

Затем создать seed-скрипт или миграцию данных:
```typescript
// scripts/migrate-pipeline.ts
// 1. Для каждой организации создать Pipeline "Default" с isDefault=true
// 2. Создать 6 PipelineStage (LEAD, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST)
// 3. Обновить все Deal: pipelineId = default pipeline, stageId = matching stage
```

#### 2.3 API: CRUD для Pipeline
Создать `src/app/api/v1/pipelines/route.ts`:
- **GET**: все pipelines для org (с stages)
- **POST**: создать pipeline + stages

Создать `src/app/api/v1/pipelines/[id]/route.ts`:
- **GET**: pipeline с stages
- **PATCH**: обновить name, stages (add/remove/reorder)
- **DELETE**: удалить pipeline (если нет deals)

#### 2.4 API: обновить Deals
**Файл**: `src/app/api/v1/deals/route.ts`
- GET: добавить фильтр `?pipelineId=xxx`
- POST: принимать `pipelineId` + `stageId` вместо `stage` string
- Fallback: если `pipelineId` не указан — использовать default pipeline

#### 2.5 UI: deals page — динамические стадии
**Файл**: `src/app/(dashboard)/deals/page.tsx`

- Убрать hardcoded `STAGES` массив (строки 51-58)
- Fetch стадии из API: `GET /api/v1/pipelines?default=true` или `GET /api/v1/pipelines/[id]`
- Добавить переключатель pipeline (dropdown сверху страницы)
- Kanban board: колонки = stages из выбранного pipeline
- Create deal dialog: выбор pipeline + начальная стадия

#### 2.6 UI: deals detail — динамические стадии
**Файл**: `src/app/(dashboard)/deals/[id]/page.tsx`

- Убрать hardcoded `STAGE_STYLES` (строки 24-31)
- Загрузить стадии pipeline текущей сделки
- Stage progress bar: динамический из pipeline.stages

#### 2.7 Settings: управление pipelines
Создать `src/app/(dashboard)/settings/pipelines/page.tsx`:
- Список pipelines
- Создание/редактирование pipeline
- Drag-and-drop порядок стадий
- Настройка: name, color, probability, isWon, isLost per stage
- Кнопка "Set as default"

### Файлы для изменения
- `prisma/schema.prisma` — Pipeline модель, PipelineStage update, Deal update
- `src/app/api/v1/pipelines/route.ts` — НОВЫЙ
- `src/app/api/v1/pipelines/[id]/route.ts` — НОВЫЙ
- `src/app/api/v1/deals/route.ts` — фильтр по pipeline
- `src/app/(dashboard)/deals/page.tsx` — убрать hardcode, fetch stages
- `src/app/(dashboard)/deals/[id]/page.tsx` — убрать hardcode
- `src/app/(dashboard)/settings/pipelines/page.tsx` — НОВЫЙ
- `scripts/migrate-pipeline.ts` — НОВЫЙ (seed default pipeline)

### Тест
```bash
npx prisma migrate dev --name add-pipelines
npx tsx scripts/migrate-pipeline.ts
npm run build
# Проверить: deals page показывает стадии из БД
# Проверить: создание deal работает с pipeline
# Проверить: settings/pipelines показывает управление
```

---

## Задача 3: PWA / Мобильное приложение (S5) — 3 недели

### Цель
Сделать CRM доступным как PWA на мобильных устройствах с push-уведомлениями и базовым offline.

### Текущее состояние
- **Root layout**: `src/app/layout.tsx` — metadata без manifest
- **Next config**: `next.config.ts` — standalone output, нет PWA plugin
- **Public**: favicon.ico, favicon.svg, apple-touch-icon.png — НЕТ manifest.json
- **Package.json**: нет pwa-related пакетов

### Что сделать

#### 3.1 Установить next-pwa (или serwist)
```bash
npm install @serwist/next serwist
```

> `serwist` — современная замена `next-pwa` (который deprecated). Работает с Next.js 16 + App Router.

#### 3.2 Создать manifest.json
**Файл**: `public/manifest.json`
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

#### 3.3 Генерировать иконки
Из существующего `public/apple-touch-icon.png` или логотипа — сгенерировать:
- `public/icons/icon-192.png` (192x192)
- `public/icons/icon-512.png` (512x512)
- `public/icons/icon-maskable-192.png` (с padding для maskable)
- `public/icons/icon-maskable-512.png`

#### 3.4 Обновить root layout metadata
**Файл**: `src/app/layout.tsx`
```typescript
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

#### 3.5 Настроить serwist в next.config.ts
**Файл**: `next.config.ts`
```typescript
import withSerwistInit from "@serwist/next"

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
})

// Обернуть существующий config:
export default withSerwist(nextConfig)
```

#### 3.6 Создать Service Worker
**Файл**: `src/sw.ts`
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

#### 3.7 Responsive адаптация ключевых страниц
Проверить и исправить мобильную адаптацию:
- Dashboard (`src/app/(dashboard)/page.tsx`) — KPI cards в 1 колонку на mobile
- Deals (`src/app/(dashboard)/deals/page.tsx`) — kanban scroll horizontal на mobile
- Contacts/Companies — таблицы с horizontal scroll
- Tasks — calendar view → list view на mobile
- Sidebar (`src/components/sidebar.tsx`) — collapsible на mobile (возможно уже есть)

#### 3.8 Push Notifications (базовый)
- Subscription API: `src/app/api/v1/push-subscribe/route.ts`
- Store subscription в `PushSubscription` модель (userId, endpoint, keys)
- Отправка: при assign ticket / new deal / task due → web-push notification
- UI: кнопка "Включить уведомления" в settings

### Файлы для изменения
- `package.json` — добавить @serwist/next, serwist
- `next.config.ts` — обернуть в withSerwist
- `public/manifest.json` — НОВЫЙ
- `public/icons/` — НОВЫЕ иконки
- `src/app/layout.tsx` — manifest + viewport metadata
- `src/sw.ts` — НОВЫЙ service worker
- `src/app/(dashboard)/page.tsx` — responsive fixes
- `src/app/(dashboard)/deals/page.tsx` — responsive fixes
- `prisma/schema.prisma` — PushSubscription модель (если push)

### Тест
```bash
npm run build
# Проверить: Lighthouse PWA audit — should pass installability
# Проверить: mobile view responsive
# Проверить: Chrome DevTools > Application > Manifest — icon correct
```

---

## Задача 4: Skill-based Routing тикетов (T1) — 2 недели

### Цель
Тикеты назначаются на агентов по их навыкам + загрузке, а не только по наименьшей загрузке.

### Текущее состояние
- **Auto-assign**: `src/app/api/v1/tickets/[id]/route.ts` строки 170-196
  - Ищет users с role in ["admin", "manager", "agent"]
  - Считает открытые тикеты per agent
  - Назначает на least loaded
- **Ticket модель**: category field существует (`@default("general")`)
- **User модель**: НЕТ skills поля

### Что сделать

#### 4.1 Prisma: добавить skills + queues
```prisma
// Добавить в User модель:
model User {
  // ... существующие поля ...
  skills        String[]  @default([])       // ["billing", "technical", "onboarding"]
  maxTickets    Int       @default(20)       // capacity limit
  isAvailable   Boolean   @default(true)     // online/offline toggle
}

// Новая модель:
model TicketQueue {
  id             String   @id @default(cuid())
  organizationId String
  name           String                       // "Billing Support", "Technical"
  skills         String[]                     // required skills to handle
  priority       Int      @default(0)         // higher = prioritized
  autoAssign     Boolean  @default(true)
  assignMethod   String   @default("least_loaded")  // "least_loaded" | "round_robin"
  lastAssignedTo String?                      // for round-robin tracking
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@map("ticket_queues")
}
```

#### 4.2 API: обновить auto-assign алгоритм
**Файл**: `src/app/api/v1/tickets/[id]/route.ts`

Заменить текущий least-loaded алгоритм (строки 170-196):

```typescript
async function autoAssignTicket(ticketId: string, orgId: string, category: string) {
  // 1. Найти подходящую очередь по категории тикета
  const queue = await prisma.ticketQueue.findFirst({
    where: {
      organizationId: orgId,
      isActive: true,
      skills: { hasSome: [category] },
    },
    orderBy: { priority: "desc" },
  })

  // 2. Найти агентов с matching skills
  const agents = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      role: { in: ["admin", "manager", "agent", "support"] },
      isAvailable: true,
      ...(queue ? { skills: { hasSome: queue.skills } } : {}),
    },
  })

  if (agents.length === 0) return null

  // 3. Подсчитать текущую загрузку
  const openCounts = await prisma.ticket.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      status: { notIn: ["closed", "resolved"] },
      assignedTo: { in: agents.map(a => a.id) },
    },
    _count: true,
  })

  const countMap = Object.fromEntries(
    openCounts.map(c => [c.assignedTo, c._count])
  )

  // 4. Фильтровать по capacity
  const available = agents.filter(
    a => (countMap[a.id] || 0) < a.maxTickets
  )

  if (available.length === 0) return null

  // 5. Выбрать агента
  let assignee: typeof agents[0]

  if (queue?.assignMethod === "round_robin") {
    // Round-robin: следующий после lastAssignedTo
    const lastIdx = available.findIndex(a => a.id === queue.lastAssignedTo)
    assignee = available[(lastIdx + 1) % available.length]
    // Обновить lastAssignedTo
    await prisma.ticketQueue.update({
      where: { id: queue.id },
      data: { lastAssignedTo: assignee.id },
    })
  } else {
    // Least loaded
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

#### 4.3 API: CRUD для очередей
Создать `src/app/api/v1/ticket-queues/route.ts`:
- GET: все очереди для org
- POST: создать очередь (name, skills, priority, assignMethod)

Создать `src/app/api/v1/ticket-queues/[id]/route.ts`:
- PATCH: обновить
- DELETE: удалить

#### 4.4 UI: Settings — управление очередями и навыками
Создать `src/app/(dashboard)/settings/ticket-queues/page.tsx`:
- Список очередей с skills badges
- Создание/редактирование очереди
- Drag-and-drop приоритет

#### 4.5 UI: Settings — навыки агентов
Добавить в `src/app/(dashboard)/settings/users/page.tsx`:
- Per-user: multi-select "Skills" (billing, technical, onboarding, general...)
- Toggle: isAvailable (online/offline)
- Max tickets capacity slider

#### 4.6 UI: Agent Desktop — availability toggle
**Файл**: `src/app/(dashboard)/support/agent-desktop/page.tsx`
- Toggle кнопка "Доступен / Не доступен" в header
- При offline — не получает новые тикеты

### Файлы для изменения
- `prisma/schema.prisma` — User.skills, User.maxTickets, User.isAvailable, TicketQueue модель
- `src/app/api/v1/tickets/[id]/route.ts` — новый алгоритм assign
- `src/app/api/v1/tickets/route.ts` — auto-assign при создании
- `src/app/api/v1/ticket-queues/route.ts` — НОВЫЙ
- `src/app/api/v1/ticket-queues/[id]/route.ts` — НОВЫЙ
- `src/app/(dashboard)/settings/ticket-queues/page.tsx` — НОВЫЙ
- `src/app/(dashboard)/settings/users/page.tsx` — skills UI
- `src/app/(dashboard)/support/agent-desktop/page.tsx` — availability toggle

### Тест
```bash
npx prisma migrate dev --name add-ticket-queues-skills
npm run build
# Создать очередь "Technical" с skills: ["technical"]
# Назначить агенту skill "technical"
# Создать тикет category "technical" — должен попасть на этого агента
```

---

## Задача 5: SLA Auto-Escalation (T2) — 2 недели

### Цель
При нарушении SLA — автоматическое уведомление менеджера, повышение приоритета, переназначение.

### Текущее состояние
- **SLA Policy модель**: `prisma/schema.prisma` строки 750-766 — firstResponseHours, resolutionHours
- **Ticket SLA поля**: slaDueAt, slaFirstResponseDueAt, firstResponseAt
- **getSlaStatus()**: `src/app/(dashboard)/tickets/page.tsx` строки 42-50 — определяет breached/warning/ok
- **SLA API**: `src/app/api/v1/sla-policies/route.ts` — CRUD политик
- **НЕТ**: cron для проверки, правил эскалации, уведомлений

### Что сделать

#### 5.1 Prisma: модель правил эскалации
```prisma
model EscalationRule {
  id              String   @id @default(cuid())
  organizationId  String
  slaPolicyId     String?
  name            String                        // "First Response Breach - Notify Manager"
  triggerType     String                        // "first_response_breach" | "resolution_breach" | "resolution_warning"
  triggerMinutes  Int      @default(0)          // доп. минуты после breach (0 = сразу, 30 = через 30 мин)
  level           Int      @default(1)          // уровень эскалации (1, 2, 3)
  actions         Json                          // массив действий
  // actions пример: [
  //   { "type": "notify", "target": "manager" },
  //   { "type": "increase_priority" },
  //   { "type": "reassign_queue", "queueId": "xxx" }
  // ]
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  @@index([organizationId])
  @@map("escalation_rules")
}

// В Ticket модель добавить:
model Ticket {
  // ... существующие поля ...
  escalationLevel    Int       @default(0)      // текущий уровень эскалации
  lastEscalatedAt    DateTime?                   // когда последний раз эскалировали
}
```

#### 5.2 API: Cron endpoint для проверки SLA
Создать `src/app/api/cron/sla-escalation/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  // Проверка CRON_SECRET (как в journeys/process)
  const secret = req.headers.get("x-cron-secret")
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()

  // 1. Найти все тикеты с breached SLA (открытые)
  const breachedTickets = await prisma.ticket.findMany({
    where: {
      status: { notIn: ["closed", "resolved"] },
      OR: [
        // Resolution breach
        { slaDueAt: { lt: now } },
        // First response breach (без первого ответа)
        {
          slaFirstResponseDueAt: { lt: now },
          firstResponseAt: null,
        },
      ],
    },
    include: { organization: true },
  })

  for (const ticket of breachedTickets) {
    // 2. Определить тип breach
    const isFirstResponseBreach = ticket.slaFirstResponseDueAt && ticket.slaFirstResponseDueAt < now && !ticket.firstResponseAt
    const isResolutionBreach = ticket.slaDueAt && ticket.slaDueAt < now

    const triggerType = isFirstResponseBreach ? "first_response_breach" : "resolution_breach"

    // 3. Найти правила эскалации для этого уровня
    const rules = await prisma.escalationRule.findMany({
      where: {
        organizationId: ticket.organizationId,
        isActive: true,
        triggerType,
        level: ticket.escalationLevel + 1,  // следующий уровень
      },
    })

    for (const rule of rules) {
      // Проверить: прошло ли достаточно времени после breach
      const breachTime = isFirstResponseBreach ? ticket.slaFirstResponseDueAt! : ticket.slaDueAt!
      const escalateAfter = new Date(breachTime.getTime() + rule.triggerMinutes * 60 * 1000)

      if (now < escalateAfter) continue // ещё рано

      // 4. Выполнить действия
      const actions = rule.actions as Array<{ type: string; target?: string; queueId?: string }>

      for (const action of actions) {
        switch (action.type) {
          case "notify":
            // Найти менеджера и создать notification
            await createNotification(ticket, action.target || "manager")
            break

          case "increase_priority":
            const priorities = ["low", "medium", "high", "critical"]
            const currentIdx = priorities.indexOf(ticket.priority)
            if (currentIdx < priorities.length - 1) {
              await prisma.ticket.update({
                where: { id: ticket.id },
                data: { priority: priorities[currentIdx + 1] },
              })
            }
            break

          case "reassign_queue":
            // Переназначить через skill-based routing
            await autoAssignTicket(ticket.id, ticket.organizationId, ticket.category)
            break

          case "send_email":
            // Отправить email уведомление
            // TODO: интеграция с email service
            break
        }
      }

      // 5. Обновить уровень эскалации
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          escalationLevel: rule.level,
          lastEscalatedAt: now,
        },
      })

      // 6. Записать в audit log
      await prisma.auditLog.create({
        data: {
          organizationId: ticket.organizationId,
          action: "escalate",
          entityType: "ticket",
          entityId: ticket.id,
          entityName: ticket.subject,
          newValue: JSON.stringify({ level: rule.level, actions: actions.map(a => a.type) }),
        },
      })
    }
  }

  // 7. Также проверить warning (approaching breach)
  const warningTickets = await prisma.ticket.findMany({
    where: {
      status: { notIn: ["closed", "resolved"] },
      slaDueAt: {
        gt: now,
        lt: new Date(now.getTime() + 2 * 60 * 60 * 1000),  // в пределах 2 часов
      },
      escalationLevel: 0,
    },
  })

  // Создать warning notifications для approaching SLA
  for (const ticket of warningTickets) {
    const rules = await prisma.escalationRule.findMany({
      where: {
        organizationId: ticket.organizationId,
        isActive: true,
        triggerType: "resolution_warning",
      },
    })
    // ... аналогичная логика ...
  }

  return NextResponse.json({
    processed: breachedTickets.length,
    warnings: warningTickets.length,
  })
}
```

#### 5.3 Cron schedule
Вызывать `POST /api/cron/sla-escalation` каждые 5 минут.

Варианты:
- **Vercel Cron** (если на Vercel): `vercel.json` с cron config
- **PM2 cron** (текущий стек): добавить в PM2 ecosystem — `cron_restart: "*/5 * * * *"` или отдельный скрипт
- **External cron**: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://app.leaddrivecrm.org/api/cron/sla-escalation`

Рекомендация: добавить в `scripts/cron.sh`:
```bash
#!/bin/bash
# Run every 5 minutes via crontab
curl -s -X POST -H "x-cron-secret: ${CRON_SECRET}" http://localhost:3001/api/cron/sla-escalation
```

#### 5.4 API: CRUD для правил эскалации
Создать `src/app/api/v1/escalation-rules/route.ts`:
- GET: все правила для org
- POST: создать правило

Создать `src/app/api/v1/escalation-rules/[id]/route.ts`:
- PATCH: обновить
- DELETE: удалить

#### 5.5 UI: Settings — правила эскалации
Создать `src/app/(dashboard)/settings/escalation/page.tsx`:

```
┌─────────────────────────────────────────────────────┐
│ Правила эскалации SLA                    [+ Добавить] │
├─────────────────────────────────────────────────────┤
│ Level 1: First Response Breach                       │
│ Триггер: Первый ответ просрочен + 0 мин             │
│ Действия: Уведомить менеджера, Повысить приоритет    │
│                                          [Изменить]  │
├─────────────────────────────────────────────────────┤
│ Level 2: Resolution Breach                           │
│ Триггер: Решение просрочено + 0 мин                 │
│ Действия: Уведомить менеджера, Переназначить         │
│                                          [Изменить]  │
├─────────────────────────────────────────────────────┤
│ Level 3: Critical Escalation                         │
│ Триггер: Решение просрочено + 60 мин                │
│ Действия: Уведомить руководство, Email               │
│                                          [Изменить]  │
└─────────────────────────────────────────────────────┘
```

- Форма: name, triggerType (dropdown), triggerMinutes, level, actions (multi-select)
- Actions: notify_manager, increase_priority, reassign_queue, send_email

#### 5.6 UI: Tickets page — индикатор эскалации
**Файл**: `src/app/(dashboard)/tickets/page.tsx`

- Добавить badge "Escalated L1/L2/L3" для эскалированных тикетов
- Цвет: L1=yellow, L2=orange, L3=red
- Фильтр: "Показать только эскалированные"
- Column: "SLA Status" с countdown timer

#### 5.7 Notifications helper
Создать `src/lib/notifications.ts`:
```typescript
export async function createNotification(
  orgId: string,
  userId: string,
  title: string,
  body: string,
  link?: string
) {
  await prisma.notification.create({
    data: { organizationId: orgId, userId, title, body, link, isRead: false },
  })
  // Если есть push subscription — отправить web push
}
```

Если Notification модель не существует — создать:
```prisma
model Notification {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  title          String
  body           String
  link           String?
  isRead         Boolean  @default(false)
  createdAt      DateTime @default(now())

  @@index([organizationId, userId])
  @@map("notifications")
}
```

### Файлы для изменения
- `prisma/schema.prisma` — EscalationRule, Ticket.escalationLevel, Notification
- `src/app/api/cron/sla-escalation/route.ts` — НОВЫЙ (cron handler)
- `src/app/api/v1/escalation-rules/route.ts` — НОВЫЙ
- `src/app/api/v1/escalation-rules/[id]/route.ts` — НОВЫЙ
- `src/app/(dashboard)/settings/escalation/page.tsx` — НОВЫЙ
- `src/app/(dashboard)/tickets/page.tsx` — escalation badges + filters
- `src/lib/notifications.ts` — НОВЫЙ (helper)
- `scripts/cron.sh` — НОВЫЙ

### Тест
```bash
npx prisma migrate dev --name add-escalation-rules
npm run build
# Создать SLA policy с firstResponseHours: 1
# Создать тикет → подождать (или руками поставить slaDueAt в прошлое)
# Вызвать: curl -X POST -H "x-cron-secret: xxx" http://localhost:3000/api/cron/sla-escalation
# Проверить: тикет получил escalationLevel=1, notification создан
```

---

## Порядок выполнения

```
1. SSO / OAuth (P1)           → коммит: "feat: add Google + Microsoft OAuth login"
2. Multiple Pipelines (S1)    → коммит: "feat: dynamic pipelines for deals"
3. PWA (S5)                   → коммит: "feat: PWA support with manifest and service worker"
4. Skill-based Routing (T1)   → коммит: "feat: skill-based ticket routing with queues"
5. SLA Auto-escalation (T2)   → коммит: "feat: automatic SLA escalation rules"
```

Каждая задача — отдельный `npx prisma migrate dev` + `npm run build` + коммит.

После всех 5: деплой через `git push origin main` (auto-deploy).

---

## Проверка после Фазы 1
- [ ] Login page: кнопки Google + Microsoft видны
- [ ] Deals page: стадии загружаются из БД, не hardcoded
- [ ] Settings: управление pipelines работает
- [ ] PWA: Lighthouse > 90 PWA score, installable на mobile
- [ ] Tickets: создание → auto-assign по skills
- [ ] SLA breach → notification менеджеру + priority increase
- [ ] `npm run build` проходит без ошибок
