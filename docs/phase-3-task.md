# Фаза 3: Marketing & Platform — Детальная задача

## Контекст
Фаза 3 roadmap (3.4 → 3.7). Маркетинг + интеграции + поддержка. 5 задач, ~14 недель.
Выполнять последовательно, каждая — отдельный коммит.

**Перед началом**: прочитай `CLAUDE.md` (защита UI, деплой правила).

---

## Задача 1: Visual Email Editor (M1) — 3 недели

### Цель
Заменить примитивный `contentEditable` редактор на полноценный drag-and-drop email конструктор. Стандарт рынка — HubSpot/Salesforce имеют визуальные билдеры.

### Текущее состояние (аудит кода)

**Редактор шаблонов**: `src/components/email-template-form.tsx` (450+ строк)
- Используется `contentEditable` + `document.execCommand()` (устаревший API)
- Простой toolbar: bold/italic/underline, размер текста, цвет, списки, ссылки
- 3 режима: Editor / Preview / Split (HTML + preview)
- Переменные: `{{client_name}}`, `{{company}}` и т.д. (строки 395-408)
- HTML санитизация через DOMPurify (`src/lib/sanitize.ts`)

**Модель EmailTemplate**: `prisma/schema.prisma` строки 918-935
```
htmlBody    String?    // Raw HTML — сюда сохраняется результат
textBody    String?
variables   String[]   @default([])
```

**Кампании**: `src/app/(dashboard)/campaigns/page.tsx` — выбор шаблона по `templateId`

**Отправка**: `src/lib/email.ts` — nodemailer + `renderTemplate()` (замена `{{key}}` → value)

**Campaign Flow Editor**: `src/components/campaign-flow-editor.tsx` — использует `@xyflow/react` для визуального потока кампании (это НЕ email editor, не путать)

### Что сделать

#### 1.1 Установить React Email Editor (Unlayer)

```bash
npm install react-email-editor
```

> Unlayer — бесплатный open-source email drag-and-drop editor. Альтернатива: GrapesJS (более сложный, для страниц). Для email-шаблонов Unlayer лучше.

#### 1.2 Обновить модель EmailTemplate

В `prisma/schema.prisma` добавить поле для JSON-дизайна:

```prisma
model EmailTemplate {
  // ... существующие поля ...
  htmlBody       String?   @db.Text    // Rendered HTML для отправки
  textBody       String?   @db.Text
  designJson     Json?                  // НОВОЕ: Unlayer design JSON для редактирования
  editorType     String    @default("visual")  // НОВОЕ: "visual" | "html" (legacy)
  thumbnailUrl   String?                // НОВОЕ: preview thumbnail
  // ...
}
```

Миграция:
```bash
npx prisma migrate dev --name add_email_template_design_json
```

#### 1.3 Создать компонент визуального редактора

Создать `src/components/email-visual-editor.tsx`:

```typescript
"use client"

import { useRef, useCallback } from "react"
import EmailEditor, { EditorRef, EmailEditorProps } from "react-email-editor"

interface Props {
  designJson?: object | null
  onChange: (design: object, html: string) => void
}

export function EmailVisualEditor({ designJson, onChange }: Props) {
  const editorRef = useRef<EditorRef>(null)

  const onReady: EmailEditorProps["onReady"] = (unlayer) => {
    // Загрузить сохранённый дизайн
    if (designJson) {
      unlayer.loadDesign(designJson as any)
    }

    // Merge tags (переменные шаблона)
    unlayer.setMergeTags([
      { name: "Client Name", value: "{{client_name}}" },
      { name: "Client Email", value: "{{client_email}}" },
      { name: "Company", value: "{{company}}" },
      { name: "Service", value: "{{service}}" },
      { name: "Date", value: "{{date}}" },
      { name: "Month", value: "{{month}}" },
      { name: "Year", value: "{{year}}" },
    ])
  }

  const exportHtml = useCallback(() => {
    editorRef.current?.editor?.exportHtml((data) => {
      const { design, html } = data
      onChange(design, html)
    })
  }, [onChange])

  return (
    <div className="border rounded-lg overflow-hidden">
      <EmailEditor
        ref={editorRef}
        onReady={onReady}
        minHeight={600}
        options={{
          locale: "ru-RU",
          appearance: { theme: "modern_light" },
          features: { stockImages: { enabled: true, safeSearch: true } },
          tools: {
            image: { enabled: true },
            button: { enabled: true },
            divider: { enabled: true },
            html: { enabled: true },
            social: { enabled: true },
            video: { enabled: true },
          },
          mergeTags: {
            client_name: { name: "Client Name", value: "{{client_name}}" },
            company: { name: "Company", value: "{{company}}" },
          },
        }}
      />
      <div className="flex justify-end p-3 bg-muted/50">
        <Button onClick={exportHtml}>Save Template</Button>
      </div>
    </div>
  )
}
```

#### 1.4 Обновить email-template-form.tsx

В `src/components/email-template-form.tsx` добавить переключатель между визуальным и HTML-редактором:

```typescript
// Вверху формы — переключатель режима
<Tabs value={editorType} onValueChange={setEditorType}>
  <TabsList>
    <TabsTrigger value="visual">Visual Editor</TabsTrigger>
    <TabsTrigger value="html">HTML Editor</TabsTrigger>
  </TabsList>

  <TabsContent value="visual">
    <EmailVisualEditor
      designJson={template?.designJson}
      onChange={(design, html) => {
        setDesignJson(design)
        setHtmlBody(html)
      }}
    />
  </TabsContent>

  <TabsContent value="html">
    {/* Существующий contentEditable editor — оставить как legacy */}
  </TabsContent>
</Tabs>
```

#### 1.5 Обновить API для сохранения designJson

В `src/app/api/v1/email-templates/route.ts` (POST) и `[id]/route.ts` (PUT):

```typescript
// Добавить в schema валидации:
designJson: z.any().optional(),
editorType: z.enum(["visual", "html"]).optional(),

// В create/update:
await prisma.emailTemplate.create({
  data: {
    ...data,
    designJson: body.designJson ?? undefined,
    editorType: body.editorType ?? "visual",
  },
})
```

#### 1.6 Создать библиотеку pre-built шаблонов

Создать `src/lib/email-templates-library.ts` — 5-7 готовых шаблонов:

```typescript
export const EMAIL_TEMPLATE_LIBRARY = [
  {
    id: "welcome",
    name: "Welcome Email",
    category: "onboarding",
    thumbnail: "/templates/welcome-thumb.png",
    designJson: { /* Unlayer JSON */ },
  },
  {
    id: "newsletter",
    name: "Monthly Newsletter",
    category: "marketing",
    thumbnail: "/templates/newsletter-thumb.png",
    designJson: { /* Unlayer JSON */ },
  },
  {
    id: "follow-up",
    name: "Sales Follow-up",
    category: "sales",
    thumbnail: "/templates/followup-thumb.png",
    designJson: { /* Unlayer JSON */ },
  },
  {
    id: "proposal",
    name: "Proposal",
    category: "sales",
    thumbnail: "/templates/proposal-thumb.png",
    designJson: { /* Unlayer JSON */ },
  },
  {
    id: "ticket-resolved",
    name: "Ticket Resolved",
    category: "support",
    thumbnail: "/templates/resolved-thumb.png",
    designJson: { /* Unlayer JSON */ },
  },
]
```

На странице email-templates добавить кнопку "Start from template" → модал с preview-карточками → при выборе загружает designJson в редактор.

#### 1.7 Preview: Desktop + Mobile

В `EmailVisualEditor` добавить toggle для preview режимов:

```typescript
// Unlayer поддерживает нативно:
editorRef.current?.editor?.showPreview("desktop")
editorRef.current?.editor?.showPreview("mobile")
```

### Файлы для изменения
| Файл | Действие |
|------|----------|
| `prisma/schema.prisma` | Добавить `designJson`, `editorType`, `thumbnailUrl` в EmailTemplate |
| `src/components/email-visual-editor.tsx` | СОЗДАТЬ — Unlayer wrapper |
| `src/components/email-template-form.tsx` | Добавить переключатель visual/html |
| `src/lib/email-templates-library.ts` | СОЗДАТЬ — pre-built шаблоны |
| `src/app/api/v1/email-templates/route.ts` | Добавить designJson в POST |
| `src/app/api/v1/email-templates/[id]/route.ts` | Добавить designJson в PUT |
| `src/app/(dashboard)/email-templates/page.tsx` | Добавить "Start from template" UI |

### Чеклист
- [ ] `npm install react-email-editor` установлен
- [ ] Миграция для `designJson`, `editorType` применена
- [ ] Визуальный editor рендерится и загружает/сохраняет дизайн
- [ ] Переменные (merge tags) работают в визуальном editor
- [ ] HTML export сохраняется в `htmlBody` для отправки
- [ ] Старый HTML-редактор доступен через переключатель
- [ ] Preview desktop + mobile работает
- [ ] Библиотека шаблонов отображается и шаблоны загружаются
- [ ] `npm run build` проходит без ошибок

---

## Задача 2: Zapier + Google + Slack интеграции (P3) — 3 недели

### Цель
Базовая экосистема интеграций. Без неё CRM — изолированная система.

### Текущее состояние (аудит кода)

**Webhook модель**: `prisma/schema.prisma` строки 168-179 — ЕСТЬ, но:
- Нет CRUD API endpoints (`/api/v1/webhooks/` не существует)
- `src/lib/webhooks.ts` использует in-memory Map вместо Prisma (не персистентно!)

**Workflow engine**: `src/lib/workflow-engine.ts` — вызывается из 8+ API routes при create/update сущностей. Webhook action = stub (не реализован).

**Google OAuth**: `src/lib/auth.ts` строки 65-69 — Google provider для SSO login. НЕТ scopes для Calendar/Gmail API. НЕТ пакета `googleapis`.

**API Keys**: `src/app/api/v1/api-keys/` — полный CRUD, SHA256 hash, scopes (`read:companies`, `write:deals`). Готов для внешнего доступа.

**Slack**: 0 упоминаний в коде.

**Accounting integrations**: `src/app/api/budgeting/integrations/route.ts` — CRUD для csv/1c/quickbooks/xero, но без реального синка.

### Что сделать

#### 2.1 Webhook Management API (для Zapier)

Создать `src/app/api/v1/webhooks/manage/route.ts`:

```typescript
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  // Допустимые события:
  // contact.created, contact.updated, contact.deleted
  // deal.created, deal.updated, deal.stage_changed, deal.won, deal.lost
  // lead.created, lead.updated, lead.converted
  // ticket.created, ticket.updated, ticket.resolved
  // task.created, task.completed
  // invoice.created, invoice.paid
  // company.created, company.updated
})

export async function GET(req: Request) {
  const orgId = await getOrgId(req)
  const webhooks = await prisma.webhook.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  })
  return Response.json(webhooks)
}

export async function POST(req: Request) {
  const orgId = await getOrgId(req)
  const body = webhookSchema.parse(await req.json())
  const secret = crypto.randomUUID()

  const webhook = await prisma.webhook.create({
    data: {
      organizationId: orgId,
      url: body.url,
      events: body.events,
      secret,
      isActive: true,
    },
  })

  return Response.json({ ...webhook, secret }) // Secret показывается ТОЛЬКО при создании
}
```

Также `[id]/route.ts` для PUT (update events/url/isActive) и DELETE.

#### 2.2 Переписать src/lib/webhooks.ts на Prisma

Текущий `src/lib/webhooks.ts` использует in-memory Map. Переписать:

```typescript
import { prisma } from "@/lib/prisma"
import crypto from "crypto"

export async function fireWebhooks(orgId: string, event: string, payload: object) {
  const webhooks = await prisma.webhook.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      events: { has: event },
    },
  })

  for (const webhook of webhooks) {
    // Fire-and-forget
    dispatchWebhook(webhook.url, webhook.secret, event, payload).catch(console.error)
  }
}

async function dispatchWebhook(url: string, secret: string, event: string, payload: object) {
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() })
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex")

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature,
      "X-Webhook-Event": event,
    },
    body,
    signal: AbortSignal.timeout(10000), // 10s timeout
  })

  // Логировать результат (опционально)
  if (!response.ok) {
    console.error(`Webhook ${url} failed: ${response.status}`)
  }
}
```

#### 2.3 Интегрировать webhooks в workflow engine

В `src/lib/workflow-engine.ts` найти stub для webhook action и реализовать:

```typescript
case "webhook":
  await fireWebhooks(orgId, `${entityType}.${triggerType}`, {
    entityType,
    entityId: entity.id,
    ...entity,
  })
  break
```

Также добавить прямые вызовы `fireWebhooks()` в ключевые API routes:
- `src/app/api/v1/contacts/route.ts` — POST (contact.created)
- `src/app/api/v1/deals/route.ts` — POST (deal.created)
- `src/app/api/v1/deals/[id]/route.ts` — PUT (deal.updated, deal.stage_changed)
- `src/app/api/v1/leads/route.ts` — POST (lead.created)
- `src/app/api/v1/tickets/route.ts` — POST (ticket.created)
- `src/app/api/v1/tickets/[id]/route.ts` — PUT (ticket.updated, ticket.resolved)

#### 2.4 Google Calendar Sync

Установить:
```bash
npm install googleapis
```

Создать `src/lib/google-calendar.ts`:

```typescript
import { google } from "googleapis"

export function getGoogleOAuth2Client(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ access_token: accessToken })
  return oauth2Client
}

export async function syncTaskToGoogleCalendar(accessToken: string, task: {
  title: string
  description?: string
  dueDate: string
  attendees?: string[]
}) {
  const auth = getGoogleOAuth2Client(accessToken)
  const calendar = google.calendar({ version: "v3", auth })

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: task.title,
      description: task.description,
      start: { dateTime: task.dueDate },
      end: { dateTime: new Date(new Date(task.dueDate).getTime() + 3600000).toISOString() },
      attendees: task.attendees?.map(email => ({ email })),
    },
  })

  return event.data
}

export async function listGoogleCalendarEvents(accessToken: string, timeMin: string, timeMax: string) {
  const auth = getGoogleOAuth2Client(accessToken)
  const calendar = google.calendar({ version: "v3", auth })

  const events = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  })

  return events.data.items ?? []
}
```

**Важно**: Обновить Google OAuth scopes в `src/lib/auth.ts`:

```typescript
GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: "openid email profile https://www.googleapis.com/auth/calendar.events",
      access_type: "offline",
      prompt: "consent",
    },
  },
})
```

Сохранить `accessToken` и `refreshToken` в User model:

```prisma
model User {
  // ... существующие поля ...
  googleAccessToken   String?
  googleRefreshToken  String?
  googleTokenExpiry   DateTime?
}
```

Создать API endpoint `src/app/api/v1/integrations/google-calendar/route.ts`:
- GET — список событий за указанный период
- POST — создать событие (из задачи/встречи CRM)

#### 2.5 Slack Integration

Создать `src/lib/slack.ts`:

```typescript
export async function sendSlackNotification(webhookUrl: string, message: {
  text: string
  blocks?: object[]
}) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  })
}

export function formatDealNotification(deal: { name: string; value: number; stage: string; owner: string }) {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New Deal:* ${deal.name}\n*Value:* $${deal.value.toLocaleString()}\n*Stage:* ${deal.stage}\n*Owner:* ${deal.owner}`,
        },
      },
    ],
  }
}
```

**Модель для хранения Slack config**: Использовать существующую `ChannelConfig` модель (`prisma/schema.prisma` строки 1155-1178) с `channelType: "slack"`:

```typescript
// Сохранение Slack webhook URL:
await prisma.channelConfig.create({
  data: {
    organizationId: orgId,
    channelType: "slack",
    configName: "Sales Notifications",
    webhookUrl: slackWebhookUrl,
    settings: { channels: ["deals", "tickets"] },
    isActive: true,
  },
})
```

Создать `src/app/api/v1/integrations/slack/route.ts`:
- GET — список Slack конфигов организации
- POST — добавить Slack webhook URL
- PUT — обновить channels/settings
- DELETE — удалить интеграцию

**Интеграция**: В workflow engine добавить action `"slack_notify"`:
```typescript
case "slack_notify":
  const slackConfigs = await prisma.channelConfig.findMany({
    where: { organizationId: orgId, channelType: "slack", isActive: true },
  })
  for (const config of slackConfigs) {
    if (config.webhookUrl) {
      await sendSlackNotification(config.webhookUrl, {
        text: `[${entityType}] ${action.message ?? JSON.stringify(entity)}`,
      })
    }
  }
  break
```

#### 2.6 Settings UI — Integrations Hub

Создать `src/app/(dashboard)/settings/integrations/page.tsx`:

```
┌─────────────────────────────────────────────────┐
│ Integrations                                     │
├─────────────────────────────────────────────────┤
│                                                  │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│ │ Webhooks │  │  Google   │  │  Slack   │       │
│ │ 3 active │  │ Calendar  │  │ Connected│       │
│ │ Configure│  │ Connected │  │ Configure│       │
│ └──────────┘  └──────────┘  └──────────┘       │
│                                                  │
│ ┌──────────┐  ┌──────────┐                      │
│ │  Zapier  │  │   1C     │                      │
│ │ API Docs │  │  Export  │                      │
│ │ View Keys│  │ Configure│                      │
│ └──────────┘  └──────────┘                      │
│                                                  │
│ ── Webhooks Management ──────────────────────── │
│ URL: https://hooks.zapier.com/...               │
│ Events: deal.created, deal.won                  │
│ Status: ● Active     [Edit] [Delete]            │
│                                                  │
│ [+ Add Webhook]                                  │
└─────────────────────────────────────────────────┘
```

### Файлы для изменения
| Файл | Действие |
|------|----------|
| `src/app/api/v1/webhooks/manage/route.ts` | СОЗДАТЬ — Webhook CRUD |
| `src/app/api/v1/webhooks/manage/[id]/route.ts` | СОЗДАТЬ — Webhook update/delete |
| `src/lib/webhooks.ts` | ПЕРЕПИСАТЬ — Prisma вместо in-memory |
| `src/lib/workflow-engine.ts` | Добавить webhook + slack_notify actions |
| `src/lib/google-calendar.ts` | СОЗДАТЬ — Google Calendar SDK |
| `src/lib/slack.ts` | СОЗДАТЬ — Slack notifications |
| `src/lib/auth.ts` | Добавить Google Calendar scopes |
| `prisma/schema.prisma` | Добавить google token fields в User |
| `src/app/api/v1/integrations/google-calendar/route.ts` | СОЗДАТЬ |
| `src/app/api/v1/integrations/slack/route.ts` | СОЗДАТЬ |
| `src/app/(dashboard)/settings/integrations/page.tsx` | СОЗДАТЬ — Integration Hub |
| 6+ entity API routes | Добавить `fireWebhooks()` вызовы |

### Чеклист
- [ ] Webhook CRUD API работает (create/list/update/delete)
- [ ] `src/lib/webhooks.ts` использует Prisma (не in-memory)
- [ ] Webhooks срабатывают при создании/обновлении contacts, deals, leads, tickets
- [ ] HMAC подпись генерируется для каждого webhook call
- [ ] Google Calendar: `googleapis` установлен, scopes добавлены
- [ ] Google Calendar: можно создать событие из CRM задачи
- [ ] Slack: можно добавить webhook URL и получать уведомления
- [ ] Settings → Integrations страница отображается с карточками
- [ ] `npm run build` проходит без ошибок

---

## Задача 3: A/B Testing кампаний (M2) — 2 недели

### Цель
A/B тестирование 2-4 вариантов subject/content кампании с автоматическим выбором победителя.

### Текущее состояние (аудит кода)

**Campaign модель**: `prisma/schema.prisma` строки 884-916
- Нет полей для вариантов (`variantCount`, `isAbTest`, `splitPercentage`)
- Метрики агрегированные: `totalOpened`, `totalClicked` — одно число на всю кампанию
- Нет модели `CampaignVariant`

**Отправка**: `src/app/api/v1/campaigns/[id]/send/route.ts`
- Линейная отправка: ВСЕ контакты получают ОДИН и тот же subject + template
- Нет split logic

**EmailLog**: `prisma/schema.prisma` строки 1208-1229
- Есть `campaignId`, но нет `variantId`

**Campaign Flow Editor**: `src/components/campaign-flow-editor.tsx` строка 47
- Node type `"split"` (A/B Split) существует визуально, но не исполняется backend

### Что сделать

#### 3.1 Новые модели

В `prisma/schema.prisma`:

```prisma
model CampaignVariant {
  id           String   @id @default(cuid())
  campaignId   String
  campaign     Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  name         String   // "Variant A", "Variant B"
  subject      String?  // Тема письма (null = использовать campaign.subject)
  templateId   String?  // Шаблон (null = использовать campaign.templateId)
  percentage   Int      @default(50)  // % аудитории для этого варианта
  totalSent    Int      @default(0)
  totalOpened  Int      @default(0)
  totalClicked Int      @default(0)
  totalBounced Int      @default(0)
  isWinner     Boolean  @default(false)
  createdAt    DateTime @default(now())

  @@index([campaignId])
  @@map("campaign_variants")
}
```

Обновить Campaign модель:
```prisma
model Campaign {
  // ... существующие поля ...
  isAbTest         Boolean   @default(false)
  abTestType       String?   // "subject" | "content" | "send_time"
  testPercentage   Int?      @default(20)  // % аудитории на тест (остальные получат победителя)
  testDurationHours Int?     @default(4)   // Часов до выбора победителя
  winnerCriteria   String?   @default("open_rate")  // "open_rate" | "click_rate"
  winnerSelectedAt DateTime?
  variants         CampaignVariant[]
}
```

Обновить EmailLog:
```prisma
model EmailLog {
  // ... существующие поля ...
  variantId    String?   // НОВОЕ: какой вариант был отправлен
}
```

#### 3.2 API: Управление вариантами

Создать `src/app/api/v1/campaigns/[id]/variants/route.ts`:

```typescript
// GET — список вариантов кампании
// POST — создать вариант (name, subject, templateId, percentage)
```

Создать `src/app/api/v1/campaigns/[id]/variants/[variantId]/route.ts`:
```typescript
// PUT — обновить вариант
// DELETE — удалить вариант
```

#### 3.3 Обновить Send Route с A/B Split

В `src/app/api/v1/campaigns/[id]/send/route.ts`:

```typescript
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { variants: true },
  })

  // ... загрузка контактов (существующий код) ...

  if (campaign.isAbTest && campaign.variants.length >= 2) {
    // === A/B TEST MODE ===
    const testSize = Math.floor(contacts.length * (campaign.testPercentage ?? 20) / 100)
    const testContacts = shuffle(contacts).slice(0, testSize)
    const remainingContacts = contacts.filter(c => !testContacts.includes(c))

    // Разделить test-контакты по вариантам
    let offset = 0
    for (const variant of campaign.variants) {
      const variantSize = Math.floor(testContacts.length * variant.percentage / 100)
      const variantContacts = testContacts.slice(offset, offset + variantSize)
      offset += variantSize

      const template = variant.templateId
        ? await prisma.emailTemplate.findUnique({ where: { id: variant.templateId } })
        : campaignTemplate

      for (const contact of variantContacts) {
        await sendEmail({
          to: contact.email,
          subject: variant.subject ?? campaign.subject,
          html: renderTemplate(template.htmlBody, { ... }),
          campaignId: campaign.id,
          variantId: variant.id,
          contactId: contact.id,
        })
      }

      // Обновить variant stats
      await prisma.campaignVariant.update({
        where: { id: variant.id },
        data: { totalSent: variantSize },
      })
    }

    // Запланировать выбор победителя через testDurationHours
    // (через setTimeout или cron endpoint)
    // remainingContacts будут отправлены победителю позже

  } else {
    // === NORMAL MODE (существующий код) ===
  }
}
```

#### 3.4 Cron: Выбор победителя

Создать `src/app/api/cron/ab-test-winner/route.ts`:

```typescript
export async function POST(req: Request) {
  // Verify CRON_SECRET
  const campaigns = await prisma.campaign.findMany({
    where: {
      isAbTest: true,
      status: "testing",  // Новый статус
      winnerSelectedAt: null,
      sentAt: { lte: new Date(Date.now() - 4 * 3600 * 1000) }, // 4+ часов назад
    },
    include: { variants: true },
  })

  for (const campaign of campaigns) {
    // Подсчитать метрики per variant из EmailLog
    const variantStats = await Promise.all(
      campaign.variants.map(async (v) => {
        const sent = await prisma.emailLog.count({ where: { variantId: v.id } })
        const opened = await prisma.emailLog.count({ where: { variantId: v.id, status: "opened" } })
        const clicked = await prisma.emailLog.count({ where: { variantId: v.id, status: "clicked" } })
        return { ...v, sent, opened, clicked, openRate: sent > 0 ? opened / sent : 0, clickRate: sent > 0 ? clicked / sent : 0 }
      })
    )

    // Выбрать победителя
    const criteria = campaign.winnerCriteria ?? "open_rate"
    const sorted = variantStats.sort((a, b) =>
      criteria === "click_rate" ? b.clickRate - a.clickRate : b.openRate - a.openRate
    )
    const winner = sorted[0]

    // Отправить победителя оставшимся контактам
    // ... (аналогично обычной отправке, но с winner.subject и winner.templateId)

    await prisma.campaignVariant.update({
      where: { id: winner.id },
      data: { isWinner: true },
    })
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { winnerSelectedAt: new Date(), status: "sent" },
    })
  }
}
```

#### 3.5 UI: A/B Test Configuration

В `src/components/campaign-form.tsx` добавить:

```
┌─────────────────────────────────────────────────┐
│ Campaign: Q2 Newsletter                          │
├─────────────────────────────────────────────────┤
│ □ Enable A/B Test                                │
│                                                  │
│ Test type: [Subject Line ▼]                      │
│ Test audience: [20%] of recipients               │
│ Test duration: [4 hours] before sending winner   │
│ Winner criteria: [Open Rate ▼]                   │
│                                                  │
│ ┌─ Variant A ─────────────────────┐              │
│ │ Subject: "Exciting Q2 Updates"  │              │
│ │ Template: [Default ▼]          │  [50%]       │
│ └─────────────────────────────────┘              │
│                                                  │
│ ┌─ Variant B ─────────────────────┐              │
│ │ Subject: "Your Q2 Recap"        │              │
│ │ Template: [Default ▼]          │  [50%]       │
│ └─────────────────────────────────┘              │
│                                                  │
│ [+ Add Variant]                                  │
└─────────────────────────────────────────────────┘
```

#### 3.6 UI: Результаты A/B теста

В `src/app/(dashboard)/campaigns/[id]/page.tsx` добавить секцию сравнения вариантов:

```
┌─────────────────────────────────────────────────┐
│ A/B Test Results                                 │
├──────────┬──────────┬───────────┬───────────────┤
│          │ Variant A│ Variant B │ Winner        │
├──────────┼──────────┼───────────┼───────────────┤
│ Sent     │ 500      │ 500       │               │
│ Opened   │ 215      │ 180       │               │
│ Open Rate│ 43%      │ 36%       │ ★ Variant A   │
│ Clicked  │ 87       │ 62        │               │
│ CTR      │ 17.4%    │ 12.4%     │ ★ Variant A   │
└──────────┴──────────┴───────────┴───────────────┘
│ Winner sent to remaining 4,000 contacts          │
└─────────────────────────────────────────────────┘
```

### Файлы для изменения
| Файл | Действие |
|------|----------|
| `prisma/schema.prisma` | CampaignVariant модель, A/B fields в Campaign, variantId в EmailLog |
| `src/app/api/v1/campaigns/[id]/variants/route.ts` | СОЗДАТЬ — CRUD вариантов |
| `src/app/api/v1/campaigns/[id]/variants/[variantId]/route.ts` | СОЗДАТЬ |
| `src/app/api/v1/campaigns/[id]/send/route.ts` | Добавить A/B split logic |
| `src/app/api/cron/ab-test-winner/route.ts` | СОЗДАТЬ — автоматический выбор победителя |
| `src/components/campaign-form.tsx` | Добавить A/B test UI |
| `src/app/(dashboard)/campaigns/[id]/page.tsx` | Добавить variant comparison |
| `src/lib/email.ts` | Добавить variantId в sendEmail + EmailLog |

### Чеклист
- [ ] CampaignVariant модель создана, миграция применена
- [ ] Можно создать кампанию с 2+ вариантами через UI
- [ ] Отправка разделяет аудиторию по вариантам
- [ ] EmailLog записывает variantId
- [ ] Cron endpoint выбирает победителя по open/click rate
- [ ] Победитель отправляется оставшимся контактам
- [ ] UI показывает сравнение вариантов на странице кампании
- [ ] `npm run build` проходит без ошибок

---

## Задача 4: Agent Desktop v2 (T3) — 3 недели

### Цель
Единое рабочее место агента поддержки с полным контекстом клиента, макросами, горячими клавишами и навигацией между тикетами.

### Текущее состояние (аудит кода)

**Ticket Detail**: `src/app/(dashboard)/tickets/[id]/page.tsx` (857 строк)
- Полная информация о тикете: subject, description, tags, SLA таймеры
- Comments thread с internal notes (isInternal + amber highlight)
- AI reply suggestions
- Sidebar: status, priority, category, company name, contact ID, SLA, CSAT, KB articles
- Quick actions: reply, assign to me, auto-assign, escalate, close

**Что НЕТ**:
- ❌ TicketMacro модель (нет шаблонов быстрых ответов)
- ❌ Keyboard shortcuts
- ❌ "Next ticket" кнопка
- ❌ Handle time tracking (только days-open)
- ❌ Customer 360: нет полного контекста (сделки, другие тикеты, история активности)

**TicketComment модель**: `prisma/schema.prisma` строки 790-800
```
model TicketComment {
  id        String   @id @default(cuid())
  ticketId  String
  ticket    Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  userId    String?
  comment   String   @db.Text
  isInternal Boolean @default(false)
  createdAt DateTime @default(now())
}
```

### Что сделать

#### 4.1 Модель TicketMacro

В `prisma/schema.prisma`:

```prisma
model TicketMacro {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  description    String?
  category       String   @default("general")  // billing, technical, onboarding, general
  actions        Json     // [{ type: "reply", text: "..." }, { type: "status", value: "resolved" }, { type: "tag", value: "..." }]
  shortcut       String?  // "Ctrl+1", "Ctrl+2"
  usageCount     Int      @default(0)
  isActive       Boolean  @default(true)
  createdBy      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId])
  @@map("ticket_macros")
}
```

#### 4.2 API: Macros CRUD

Создать `src/app/api/v1/ticket-macros/route.ts`:

```typescript
// GET — список макросов организации (с фильтром по category)
// POST — создать макрос (name, category, actions[], shortcut)
```

`src/app/api/v1/ticket-macros/[id]/route.ts`:
```typescript
// PUT — обновить макрос
// DELETE — удалить
// POST — применить макрос к тикету (execute actions)
```

Endpoint для применения макроса к тикету:

```typescript
// POST /api/v1/ticket-macros/[id]/apply
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ticketId } = await req.json()
  const macro = await prisma.ticketMacro.findUnique({ where: { id: params.id } })

  for (const action of macro.actions as any[]) {
    switch (action.type) {
      case "reply":
        await prisma.ticketComment.create({
          data: { ticketId, comment: action.text, userId: userId, isInternal: false },
        })
        break
      case "internal_note":
        await prisma.ticketComment.create({
          data: { ticketId, comment: action.text, userId: userId, isInternal: true },
        })
        break
      case "status":
        await prisma.ticket.update({ where: { id: ticketId }, data: { status: action.value } })
        break
      case "priority":
        await prisma.ticket.update({ where: { id: ticketId }, data: { priority: action.value } })
        break
      case "tag":
        // Добавить tag к существующим
        break
      case "assign":
        await prisma.ticket.update({ where: { id: ticketId }, data: { assignedTo: action.value } })
        break
    }
  }

  // Increment usage count
  await prisma.ticketMacro.update({ where: { id: params.id }, data: { usageCount: { increment: 1 } } })
}
```

#### 4.3 Customer 360 Sidebar

В `src/app/(dashboard)/tickets/[id]/page.tsx` расширить sidebar:

Текущий sidebar показывает только company name и contact ID. Добавить полный контекст:

```typescript
// Загрузить при открытии тикета:
const customerContext = await fetch(`/api/v1/tickets/${ticketId}/context`)

// API: src/app/api/v1/tickets/[id]/context/route.ts
// Возвращает:
{
  company: { name, industry, leadScore, totalDeals, totalRevenue },
  contact: { name, email, phone, position },
  recentTickets: [{ id, subject, status, createdAt }],  // Последние 5 тикетов этого контакта
  openDeals: [{ id, name, value, stage }],               // Открытые сделки компании
  recentActivity: [{ type, subject, createdAt }],         // Последние 10 активностей
  lifetimeValue: number,                                   // Общая сумма выигранных сделок
}
```

UI layout в sidebar:

```
┌─ Customer Context ─────────────┐
│ Company: Acme Corp              │
│ Industry: IT Services           │
│ Lead Score: ★★★★☆ (82)         │
│ LTV: $124,500                   │
│                                 │
│ Contact: John Smith             │
│ Position: CTO                   │
│ Email: john@acme.com            │
│ Phone: +1 555-0123              │
├─────────────────────────────────┤
│ Recent Tickets (3)              │
│ • #T-045 Login issue  [Open]   │
│ • #T-031 API error    [Closed] │
│ • #T-022 Setup help   [Closed] │
├─────────────────────────────────┤
│ Open Deals (1)                  │
│ • Enterprise Plan - $45,000     │
│   Stage: Negotiation            │
├─────────────────────────────────┤
│ Recent Activity                 │
│ • Email sent (2 days ago)       │
│ • Call logged (5 days ago)      │
│ • Meeting (1 week ago)          │
└─────────────────────────────────┘
```

#### 4.4 Keyboard Shortcuts

Создать `src/hooks/use-ticket-shortcuts.ts`:

```typescript
"use client"

import { useEffect } from "react"

interface ShortcutActions {
  onReply: () => void
  onInternalNote: () => void
  onAssignToMe: () => void
  onEscalate: () => void
  onClose: () => void
  onNextTicket: () => void
  onPrevTicket: () => void
  macros: { shortcut: string; execute: () => void }[]
}

export function useTicketShortcuts(actions: ShortcutActions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Не перехватывать если focus в textarea/input
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return

      if (e.key === "r" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); actions.onReply() }
      if (e.key === "n" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); actions.onInternalNote() }
      if (e.key === "a" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); actions.onAssignToMe() }
      if (e.key === "e" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); actions.onEscalate() }
      if (e.key === "x" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); actions.onClose() }
      if (e.key === "j" || e.key === "ArrowRight") { e.preventDefault(); actions.onNextTicket() }
      if (e.key === "k" || e.key === "ArrowLeft") { e.preventDefault(); actions.onPrevTicket() }

      // Macros: Ctrl+1, Ctrl+2, ...
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1
        if (actions.macros[idx]) { e.preventDefault(); actions.macros[idx].execute() }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [actions])
}
```

В ticket detail page показать подсказку shortcuts:

```
┌─ Keyboard Shortcuts ─────┐
│ R — Reply                 │
│ N — Internal Note         │
│ A — Assign to Me          │
│ E — Escalate              │
│ X — Close Ticket          │
│ J/→ — Next Ticket         │
│ K/← — Previous Ticket     │
│ Ctrl+1-9 — Apply Macro    │
│ ? — Toggle this help      │
└───────────────────────────┘
```

#### 4.5 Next/Previous Ticket Navigation

В ticket detail page добавить навигацию:

```typescript
// При загрузке страницы — получить список ID соседних тикетов
const { prevTicketId, nextTicketId } = await fetch(`/api/v1/tickets/${id}/siblings`)

// API: /api/v1/tickets/[id]/siblings/route.ts
// Логика: найти тикеты того же агента с тем же статусом, отсортированные по priority + createdAt
// Вернуть prev и next ID относительно текущего
```

UI в header тикета:
```
← Previous  |  Ticket #T-048  |  Next →
```

#### 4.6 Handle Time Tracking

Добавить в Ticket модель:
```prisma
model Ticket {
  // ... существующие поля ...
  handleTimeSeconds Int @default(0)   // Общее время работы агента над тикетом
}
```

В ticket detail page — простой таймер:
```typescript
// При открытии тикета агентом — начать таймер
const [timer, setTimer] = useState(ticket.handleTimeSeconds)
useEffect(() => {
  const interval = setInterval(() => setTimer(t => t + 1), 1000)
  return () => {
    clearInterval(interval)
    // Сохранить накопленное время
    fetch(`/api/v1/tickets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ handleTimeSeconds: timer }),
    })
  }
}, [])
```

#### 4.7 Macros Settings Page

Создать `src/app/(dashboard)/settings/macros/page.tsx`:

```
┌─────────────────────────────────────────────────┐
│ Ticket Macros                    [+ New Macro]   │
├─────────────────────────────────────────────────┤
│ Name            │ Category  │ Shortcut │ Uses   │
│ Quick Close     │ General   │ Ctrl+1   │ 342    │
│ Billing Ack     │ Billing   │ Ctrl+2   │ 189    │
│ Escalate Tech   │ Technical │ Ctrl+3   │ 67     │
└─────────────────────────────────────────────────┘

Macro Editor Dialog:
┌─────────────────────────────────────────────────┐
│ Macro: Quick Close                               │
│ Category: [General ▼]                            │
│ Shortcut: [Ctrl+1]                               │
│                                                  │
│ Actions:                                         │
│ 1. [Reply ▼] "Thank you for contacting us..."   │
│ 2. [Status ▼] → Resolved                        │
│ 3. [Tag ▼] → "resolved-quick"                   │
│                                                  │
│ [+ Add Action]                                   │
│                                                  │
│ [Cancel] [Save Macro]                            │
└─────────────────────────────────────────────────┘
```

### Файлы для изменения
| Файл | Действие |
|------|----------|
| `prisma/schema.prisma` | TicketMacro модель, handleTimeSeconds в Ticket |
| `src/app/api/v1/ticket-macros/route.ts` | СОЗДАТЬ — Macros CRUD |
| `src/app/api/v1/ticket-macros/[id]/route.ts` | СОЗДАТЬ — update/delete |
| `src/app/api/v1/ticket-macros/[id]/apply/route.ts` | СОЗДАТЬ — execute macro |
| `src/app/api/v1/tickets/[id]/context/route.ts` | СОЗДАТЬ — Customer 360 |
| `src/app/api/v1/tickets/[id]/siblings/route.ts` | СОЗДАТЬ — prev/next navigation |
| `src/app/(dashboard)/tickets/[id]/page.tsx` | Расширить sidebar + shortcuts + timer + navigation |
| `src/hooks/use-ticket-shortcuts.ts` | СОЗДАТЬ — keyboard shortcuts hook |
| `src/app/(dashboard)/settings/macros/page.tsx` | СОЗДАТЬ — macros management |

### Чеклист
- [ ] TicketMacro модель создана, миграция применена
- [ ] Macros CRUD работает (create/edit/delete/apply)
- [ ] При применении макроса выполняются все actions (reply + status + tag)
- [ ] Customer 360 sidebar показывает: company info, contact, recent tickets, deals, activity
- [ ] Keyboard shortcuts работают (R, N, A, E, X, J, K, Ctrl+1-9)
- [ ] Next/Previous навигация между тикетами работает
- [ ] Handle time таймер запускается при открытии и сохраняется при уходе
- [ ] Settings → Macros страница с CRUD
- [ ] `npm run build` проходит без ошибок

---

## Задача 5: Behavioral Segmentation (M4) — 3 недели

### Цель
Сегменты на основе поведения контактов (opens, clicks, activity), а не только полей. Это стандарт маркетинг-автоматизации.

### Текущее состояние (аудит кода)

**ContactSegment модель**: `prisma/schema.prisma` строки 937-950
- 9 условий: company, source, role, tag, name, createdAfter/Before, hasEmail, hasPhone
- Все условия — field-based. 0 поведенческих.
- `conditions` хранится как Json

**Segment builder**: `src/app/(dashboard)/segments/page.tsx`
- Простой grid фильтров + Advanced mode (AND/OR)

**Segment evaluation**: `src/lib/segment-conditions.ts` (41 строка)
- Конвертирует JSON conditions → Prisma WHERE clause
- Только field-based фильтры

**Email tracking**: Campaign модель имеет агрегированные `totalOpened`, `totalClicked`
- `EmailLog` модель: `status` поле = sent/delivered/opened/clicked/bounced
- `/api/v1/contacts/[id]/engagement/route.ts` — подсчёт opens/clicks per contact

**Activity модель**: `prisma/schema.prisma` строки 535-556
- Типы: call, email, meeting, note, task
- Привязка к contactId, companyId

**Lead scoring**: `score` (0-100) + `scoreDetails` (JSON) + Claude AI scoring

**Web tracking**: ❌ Нет. Нет пикселя, нет UTM, нет visitor tracking.

### Что сделать

#### 5.1 Модель ContactEvent

Для поведенческой сегментации нужна таблица событий. В `prisma/schema.prisma`:

```prisma
model ContactEvent {
  id             String   @id @default(cuid())
  organizationId String
  contactId      String
  contact        Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  eventType      String   // email_sent, email_opened, email_clicked, form_submitted,
                          // campaign_enrolled, page_visited, deal_created, ticket_created,
                          // call_logged, meeting_scheduled, note_added
  metadata       Json?    // { campaignId, url, formId, pageUrl, ... }
  source         String?  // "campaign", "manual", "automation", "portal"
  createdAt      DateTime @default(now())

  @@index([organizationId, contactId])
  @@index([organizationId, eventType, createdAt])
  @@index([contactId, eventType])
  @@map("contact_events")
}
```

Добавить engagement score в Contact:
```prisma
model Contact {
  // ... существующие поля ...
  engagementScore   Int       @default(0)
  lastActivityAt    DateTime?
  events            ContactEvent[]
}
```

#### 5.2 Записывать события из существующих flows

Создать `src/lib/contact-events.ts`:

```typescript
import { prisma } from "@/lib/prisma"

export async function trackContactEvent(
  orgId: string,
  contactId: string,
  eventType: string,
  metadata?: object,
  source?: string
) {
  await prisma.contactEvent.create({
    data: {
      organizationId: orgId,
      contactId,
      eventType,
      metadata: metadata ?? {},
      source: source ?? "system",
    },
  })

  // Обновить engagement score и lastActivityAt
  await recalculateEngagement(orgId, contactId)
}

const SCORE_WEIGHTS: Record<string, number> = {
  email_opened: 1,
  email_clicked: 3,
  email_replied: 5,
  form_submitted: 8,
  meeting_scheduled: 10,
  call_logged: 5,
  deal_created: 15,
  page_visited: 1,
  note_added: 2,
  ticket_created: 3,
}

async function recalculateEngagement(orgId: string, contactId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

  const events = await prisma.contactEvent.findMany({
    where: { contactId, createdAt: { gte: thirtyDaysAgo } },
    select: { eventType: true },
  })

  let score = 0
  for (const event of events) {
    score += SCORE_WEIGHTS[event.eventType] ?? 1
  }

  // Cap at 100
  score = Math.min(100, score)

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      engagementScore: score,
      lastActivityAt: new Date(),
    },
  })
}
```

Интегрировать в существующие flows:

| Файл | Событие |
|------|---------|
| `src/app/api/v1/campaigns/[id]/send/route.ts` | После отправки → `trackContactEvent(orgId, contactId, "email_sent", { campaignId })` |
| `src/lib/email.ts` | При статусе "opened" → `email_opened`; "clicked" → `email_clicked` |
| `src/app/api/v1/activities/route.ts` | POST → `call_logged`, `meeting_scheduled`, `note_added` |
| `src/app/api/v1/deals/route.ts` | POST → `deal_created` |
| `src/app/api/v1/tickets/route.ts` | POST → `ticket_created` |
| `src/app/api/v1/contacts/route.ts` | POST → `form_submitted` (если source = portal/form) |

#### 5.3 Расширить segment conditions

В `src/lib/segment-conditions.ts` добавить поведенческие условия:

```typescript
export function buildContactWhere(conditions: any) {
  const where: any = { AND: [] }

  // ... существующие field-based условия ...

  // === НОВЫЕ ПОВЕДЕНЧЕСКИЕ УСЛОВИЯ ===

  if (conditions.minEngagementScore) {
    where.AND.push({ engagementScore: { gte: parseInt(conditions.minEngagementScore) } })
  }

  if (conditions.maxEngagementScore) {
    where.AND.push({ engagementScore: { lte: parseInt(conditions.maxEngagementScore) } })
  }

  if (conditions.lastActivityAfter) {
    where.AND.push({ lastActivityAt: { gte: new Date(conditions.lastActivityAfter) } })
  }

  if (conditions.lastActivityBefore) {
    where.AND.push({ lastActivityAt: { lte: new Date(conditions.lastActivityBefore) } })
  }

  if (conditions.noActivityDays) {
    const cutoff = new Date(Date.now() - parseInt(conditions.noActivityDays) * 86400000)
    where.AND.push({
      OR: [
        { lastActivityAt: null },
        { lastActivityAt: { lt: cutoff } },
      ],
    })
  }

  // Event-based conditions (используют subquery через events relation)
  if (conditions.hasEventType) {
    where.AND.push({
      events: {
        some: {
          eventType: conditions.hasEventType,
          createdAt: conditions.hasEventAfter
            ? { gte: new Date(conditions.hasEventAfter) }
            : undefined,
        },
      },
    })
  }

  if (conditions.minEventCount) {
    // Prisma не поддерживает COUNT в WHERE напрямую — используем _count фильтр
    // Альтернатива: raw query или post-filter
    // Для MVP: фильтровать на уровне приложения
  }

  if (conditions.openedCampaign) {
    where.AND.push({
      events: {
        some: {
          eventType: "email_opened",
          metadata: { path: ["campaignId"], equals: conditions.openedCampaign },
        },
      },
    })
  }

  if (conditions.clickedCampaign) {
    where.AND.push({
      events: {
        some: {
          eventType: "email_clicked",
          metadata: { path: ["campaignId"], equals: conditions.clickedCampaign },
        },
      },
    })
  }

  return where
}
```

#### 5.4 Обновить Segment Builder UI

В `src/app/(dashboard)/segments/page.tsx` добавить новые условия в форму:

```
┌─ Segment Conditions ───────────────────────────┐
│                                                 │
│ ── Field Conditions (существующие) ──           │
│ Company contains [___]                          │
│ Source = [Website ▼]                            │
│ Has Email: ☑                                    │
│                                                 │
│ ── Engagement Conditions (НОВЫЕ) ──             │
│ Engagement Score: [40] to [100]                 │
│ Last Activity: [Within 30 days ▼]               │
│ No Activity for [60] days                       │
│                                                 │
│ ── Email Behavior (НОВЫЕ) ──                    │
│ Opened campaign: [Q1 Newsletter ▼]             │
│ Clicked campaign: [Any ▼]                       │
│ Email opens in last [30] days: ≥ [3]           │
│                                                 │
│ ── Activity (НОВЫЕ) ──                          │
│ Has event: [meeting_scheduled ▼]                │
│ Event after: [2026-03-01]                       │
│                                                 │
│ [Preview: 234 contacts match]    [Save Segment] │
└─────────────────────────────────────────────────┘
```

#### 5.5 Engagement Score Dashboard Widget

В `src/app/(dashboard)/page.tsx` (или contacts page) добавить виджет:

```
┌─ Engagement Overview ──────────────┐
│ Hot (80+):    ██████████ 45        │
│ Warm (40-79): ████████████ 128     │
│ Cold (<40):   ██████████████ 312   │
│                                    │
│ Avg Score: 52  |  Trend: ↑ +3.2   │
└────────────────────────────────────┘
```

#### 5.6 Cron: Score Decay

Создать `src/app/api/cron/engagement-decay/route.ts`:

```typescript
// Каждую неделю: снижать score на 10% для контактов без активности за последние 7 дней
export async function POST(req: Request) {
  // Verify CRON_SECRET
  const weekAgo = new Date(Date.now() - 7 * 86400000)

  // Найти контакты с score > 0 и без недавней активности
  const staleContacts = await prisma.contact.findMany({
    where: {
      engagementScore: { gt: 0 },
      OR: [
        { lastActivityAt: null },
        { lastActivityAt: { lt: weekAgo } },
      ],
    },
    select: { id: true, engagementScore: true },
  })

  for (const contact of staleContacts) {
    const newScore = Math.max(0, Math.floor(contact.engagementScore * 0.9))
    await prisma.contact.update({
      where: { id: contact.id },
      data: { engagementScore: newScore },
    })
  }

  return Response.json({ decayed: staleContacts.length })
}
```

### Файлы для изменения
| Файл | Действие |
|------|----------|
| `prisma/schema.prisma` | ContactEvent модель, engagementScore + lastActivityAt в Contact |
| `src/lib/contact-events.ts` | СОЗДАТЬ — event tracking + score calculation |
| `src/lib/segment-conditions.ts` | Добавить behavioral conditions |
| `src/app/(dashboard)/segments/page.tsx` | Добавить engagement/behavioral condition UI |
| `src/app/api/v1/campaigns/[id]/send/route.ts` | trackContactEvent после отправки |
| `src/lib/email.ts` | trackContactEvent при open/click |
| `src/app/api/v1/activities/route.ts` | trackContactEvent при создании |
| `src/app/api/v1/deals/route.ts` | trackContactEvent deal_created |
| `src/app/api/v1/tickets/route.ts` | trackContactEvent ticket_created |
| `src/app/api/cron/engagement-decay/route.ts` | СОЗДАТЬ — weekly score decay |
| `src/app/(dashboard)/page.tsx` | Engagement overview widget |

### Чеклист
- [ ] ContactEvent модель создана, миграция применена
- [ ] engagementScore и lastActivityAt добавлены в Contact
- [ ] События записываются при: email send/open/click, activity create, deal create, ticket create
- [ ] Engagement score пересчитывается при каждом событии (weighted sum, cap 100)
- [ ] Segment builder показывает поведенческие условия
- [ ] Условия работают: engagement score range, last activity, no activity days, opened/clicked campaign
- [ ] Score decay cron работает (−10% в неделю без активности)
- [ ] Preview segments показывает корректное число contacts
- [ ] `npm run build` проходит без ошибок

---

## Общий порядок выполнения

```
Задача 1 (Visual Email Editor)  →  3 недели
Задача 2 (Integrations)         →  3 недели
Задача 3 (A/B Testing)          →  2 недели  (зависит от Задачи 1: шаблоны)
Задача 4 (Agent Desktop)        →  3 недели  (независимая)
Задача 5 (Behavioral Segments)  →  3 недели  (зависит от Задачи 3: email tracking)
```

Задачи 1 и 4 можно делать параллельно. Задача 3 зависит от 1 (шаблоны). Задача 5 зависит от email tracking из Задачи 3.

## Финальная проверка после всех задач

```bash
npm run build          # Должен пройти без ошибок
npx prisma generate    # Регенерировать клиент
npx prisma studio      # Проверить новые таблицы
```

Деплой:
```bash
git push origin main   # Auto-deploy через GitHub Actions
```

Проверить на production:
1. Email Templates → Visual editor загружается, можно drag-and-drop
2. Settings → Integrations → можно создать webhook, подключить Slack
3. Campaigns → A/B test: создать кампанию с 2 вариантами
4. Tickets → Customer 360 sidebar, keyboard shortcuts (R, N, J, K)
5. Segments → Behavioral conditions, engagement score filter
