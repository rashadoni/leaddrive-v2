# Фаза 2: Intelligence — Детальная задача

## Контекст
Фаза 2 roadmap (2.9 → 3.4). AI + прогнозирование. 4 задачи, ~14 недель.
Выполнять последовательно, каждая — отдельный коммит.

**Перед началом**: прочитай `CLAUDE.md` (защита UI, деплой правила).

---

## Задача 1: Autonomous AI Actions (A1) — 4 недели

### Цель
AI агенты могут ВЫПОЛНЯТЬ действия в CRM (создавать задачи, сделки, отправлять email), а не только генерировать текст. Это главное отличие от "AI as copilot" → "AI as agent".

### Текущее состояние (аудит кода)
- **AI Chat**: `src/app/api/v1/ai/chat/route.ts` — Claude Sonnet, READ-ONLY доступ к pipeline summary, company/ticket/lead counts. **НЕТ tool_use**, только text generation. Ответ = `{ reply: string }`.
- **AI Actions**: `src/app/api/v1/ai/route.ts` — 3 action типа:
  - `sentiment` → анализ, возвращает JSON (НЕ сохраняет)
  - `tasks` → предлагает задачи, возвращает JSON (НЕ создаёт в БД)
  - `text` → генерирует email/SMS текст (НЕ отправляет)
- **AI Command Center**: `src/app/(dashboard)/ai-command-center/page.tsx` — конфиг агентов с `toolsEnabled` полем, но инструменты **не реализованы**
- **Claude SDK**: `@anthropic-ai/sdk` используется в 9 файлах
- **Portal Chat**: `src/app/api/v1/public/portal-chat/route.ts` — отдельный чат для клиентов

### Что сделать

#### 1.1 Создать Tool Definitions для Claude

Создать `src/lib/ai/tools.ts` — определения инструментов:

```typescript
import type { Tool } from "@anthropic-ai/sdk/resources/messages"

// Уровни риска: low = auto-execute, medium = confirm, high = require approval
export type RiskLevel = "low" | "medium" | "high"

export interface CrmTool extends Tool {
  metadata: { riskLevel: RiskLevel; category: string }
}

export const CRM_TOOLS: CrmTool[] = [
  // LOW RISK — автоматическое выполнение
  {
    name: "add_note",
    description: "Add a note to a contact, company, or deal",
    input_schema: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["contact", "company", "deal"] },
        entityId: { type: "string" },
        content: { type: "string", description: "Note text" },
      },
      required: ["entityType", "entityId", "content"],
    },
    metadata: { riskLevel: "low", category: "notes" },
  },
  {
    name: "log_activity",
    description: "Log a call, meeting, or email activity",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["call", "meeting", "email", "note"] },
        subject: { type: "string" },
        description: { type: "string" },
        contactId: { type: "string" },
        relatedType: { type: "string", enum: ["deal", "ticket", "lead"] },
        relatedId: { type: "string" },
      },
      required: ["type", "subject"],
    },
    metadata: { riskLevel: "low", category: "activity" },
  },

  // MEDIUM RISK — требует подтверждения одним кликом
  {
    name: "create_task",
    description: "Create a task assigned to a user",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignedTo: { type: "string", description: "User ID or 'me'" },
        dueDate: { type: "string", description: "ISO date string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        relatedType: { type: "string", enum: ["deal", "contact", "company", "lead", "ticket"] },
        relatedId: { type: "string" },
      },
      required: ["title"],
    },
    metadata: { riskLevel: "medium", category: "tasks" },
  },
  {
    name: "update_deal_stage",
    description: "Move a deal to a different pipeline stage",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string" },
        stage: { type: "string", description: "Stage name (e.g. QUALIFIED, PROPOSAL)" },
      },
      required: ["dealId", "stage"],
    },
    metadata: { riskLevel: "medium", category: "deals" },
  },
  {
    name: "create_ticket",
    description: "Create a support ticket",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        category: { type: "string" },
        contactId: { type: "string" },
        companyId: { type: "string" },
      },
      required: ["subject"],
    },
    metadata: { riskLevel: "medium", category: "tickets" },
  },

  // HIGH RISK — требует явного одобрения
  {
    name: "send_email",
    description: "Send an email to a contact",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Email address" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body (HTML)" },
        contactId: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
    metadata: { riskLevel: "high", category: "email" },
  },
  {
    name: "create_deal",
    description: "Create a new deal in the pipeline",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        valueAmount: { type: "number" },
        currency: { type: "string", default: "AZN" },
        companyId: { type: "string" },
        contactId: { type: "string" },
        stage: { type: "string" },
        pipelineId: { type: "string" },
      },
      required: ["name"],
    },
    metadata: { riskLevel: "high", category: "deals" },
  },
  {
    name: "update_contact",
    description: "Update contact fields",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        fields: {
          type: "object",
          description: "Key-value pairs to update (e.g. phone, email, position)",
        },
      },
      required: ["contactId", "fields"],
    },
    metadata: { riskLevel: "high", category: "contacts" },
  },
]

// Фильтр по включённым инструментам из agent config
export function getEnabledTools(toolsEnabled: string[]): Tool[] {
  if (!toolsEnabled.length) return []
  return CRM_TOOLS.filter(t => toolsEnabled.includes(t.name))
}
```

#### 1.2 Создать Tool Executor

Создать `src/lib/ai/tool-executor.ts`:

```typescript
import { prisma } from "@/lib/prisma"

interface ToolResult {
  success: boolean
  data?: any
  error?: string
  requiresApproval?: boolean
}

export async function executeTool(
  toolName: string,
  input: Record<string, any>,
  orgId: string,
  userId: string
): Promise<ToolResult> {
  switch (toolName) {
    case "add_note":
      return executeAddNote(input, orgId, userId)
    case "log_activity":
      return executeLogActivity(input, orgId, userId)
    case "create_task":
      return executeCreateTask(input, orgId, userId)
    case "update_deal_stage":
      return executeUpdateDealStage(input, orgId, userId)
    case "create_ticket":
      return executeCreateTicket(input, orgId, userId)
    case "send_email":
      return { success: false, requiresApproval: true, data: input }
    case "create_deal":
      return executeCreateDeal(input, orgId, userId)
    case "update_contact":
      return { success: false, requiresApproval: true, data: input }
    default:
      return { success: false, error: `Unknown tool: ${toolName}` }
  }
}

async function executeAddNote(input: any, orgId: string, userId: string): Promise<ToolResult> {
  // Маппинг entityType → prisma model + create note/activity
  const activity = await prisma.activity.create({
    data: {
      organizationId: orgId,
      type: "note",
      subject: "AI Note",
      description: input.content,
      userId,
      relatedType: input.entityType,
      relatedId: input.entityId,
    },
  })
  return { success: true, data: { activityId: activity.id } }
}

async function executeCreateTask(input: any, orgId: string, userId: string): Promise<ToolResult> {
  const task = await prisma.task.create({
    data: {
      organizationId: orgId,
      title: input.title,
      description: input.description || "",
      assignedTo: input.assignedTo === "me" ? userId : (input.assignedTo || userId),
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      priority: input.priority || "medium",
      status: "todo",
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      createdBy: userId,
    },
  })
  return { success: true, data: { taskId: task.id, title: task.title } }
}

// ... аналогично для остальных tools (updateDealStage, createTicket, createDeal, logActivity)
// Каждая функция: валидация → prisma create/update → audit log → return result
```

#### 1.3 Обновить AI Chat для tool_use

**Файл**: `src/app/api/v1/ai/chat/route.ts`

Основные изменения:
1. Импортировать tools и executor
2. Загрузить agent config из БД (toolsEnabled)
3. Передать tools в Claude API call
4. Обработать tool_use response → execute → вернуть результат
5. Поддержать multi-turn: tool result → Claude → final answer

```typescript
import { getEnabledTools, CRM_TOOLS } from "@/lib/ai/tools"
import { executeTool } from "@/lib/ai/tool-executor"

// В POST handler:
// 1. Загрузить config агента
const agentConfig = await prisma.aiConfig.findFirst({
  where: { organizationId: orgId, configName: "sales_assistant", isActive: true },
})
const tools = getEnabledTools(agentConfig?.toolsEnabled || [])

// 2. Вызвать Claude с tools
const response = await anthropic.messages.create({
  model: agentConfig?.model || "claude-sonnet-4-20250514",
  max_tokens: agentConfig?.maxTokens || 1024,
  system: systemPrompt,
  tools: tools.length > 0 ? tools : undefined,
  messages: [...history, { role: "user", content: userMessage }],
})

// 3. Обработать tool_use
const toolResults: any[] = []
for (const block of response.content) {
  if (block.type === "tool_use") {
    const toolDef = CRM_TOOLS.find(t => t.name === block.name)
    const riskLevel = toolDef?.metadata?.riskLevel || "high"

    if (riskLevel === "high") {
      // Вернуть pending approval вместо выполнения
      toolResults.push({
        tool: block.name,
        input: block.input,
        status: "pending_approval",
        riskLevel,
      })
    } else {
      // Выполнить
      const result = await executeTool(block.name, block.input as any, orgId, userId)
      toolResults.push({
        tool: block.name,
        input: block.input,
        status: result.success ? "executed" : "failed",
        result: result.data,
        error: result.error,
      })
    }
  }
}

// 4. Если были tool calls — сделать second pass для финального ответа
// (Claude получает tool results и генерирует human-friendly summary)

// 5. Вернуть ответ с actions
return NextResponse.json({
  reply: textReply,
  actions: toolResults,  // UI покажет кнопки "Approve" для pending
})
```

#### 1.4 Обновить AI Chat UI — показ actions

**Файл**: `src/components/ai-assistant-panel.tsx` (или где рендерится чат)

Добавить после текстового ответа:
- Для `status: "executed"` → зелёный badge "Выполнено: создана задача X"
- Для `status: "pending_approval"` → жёлтая карточка с кнопками "Одобрить" / "Отклонить"
- При клике "Одобрить" → POST `/api/v1/ai/approve-action` → выполнить tool

#### 1.5 API: Approve Action endpoint

Создать `src/app/api/v1/ai/approve-action/route.ts`:
- POST: `{ toolName, input, sessionId }`
- Выполнить executeTool
- Записать в audit log: "AI action approved by user X"

#### 1.6 Audit: логирование AI actions

В каждом executeTool после успешного выполнения:
```typescript
await prisma.auditLog.create({
  data: {
    organizationId: orgId,
    userId,
    action: "ai_action",
    entityType: toolName,
    entityId: result.data?.id,
    entityName: `AI: ${toolName}`,
    newValue: JSON.stringify(input),
  },
})
```

### Файлы
- `src/lib/ai/tools.ts` — НОВЫЙ (tool definitions)
- `src/lib/ai/tool-executor.ts` — НОВЫЙ (execution logic)
- `src/app/api/v1/ai/chat/route.ts` — добавить tool_use
- `src/app/api/v1/ai/approve-action/route.ts` — НОВЫЙ
- `src/components/ai-assistant-panel.tsx` — UI для actions
- Возможно `src/app/(dashboard)/ai-command-center/page.tsx` — toolsEnabled реально работает

### Коммит
```
feat: autonomous AI actions with tool_use, risk levels, and approval flow
```

---

## Задача 2: Predictive Analytics Engine (A2) — 4 недели

### Цель
Win probability per deal, revenue forecast на основе pipeline, churn risk scoring, deal velocity analysis.

### Текущее состояние (аудит кода)
- **SalesForecast/ExpenseForecast** модели: существуют в schema (строки 2042-2080), но **пустые, нет логики заполнения**
- **Deal.probability**: поле есть, берётся из PipelineStage.probability при создании
- **Lead scoring**: Claude AI вычисляет `conversionProb` per lead — **работает**
- **Dashboard forecast**: `src/app/api/v1/dashboard/executive/route.ts` строки 287-309 — простая линейная проекция (avg 3 мес + pipeline / 6), **НЕ учитывает probability**
- **Revenue trend**: `src/components/dashboard/revenue-trend.tsx` — показывает actual vs projected

### Что сделать

#### 2.1 Deal Win Probability Model

Создать `src/lib/ai/predictive.ts`:

```typescript
interface DealPrediction {
  winProbability: number   // 0-100
  expectedCloseDate: Date | null
  riskFactors: string[]
  confidence: number       // 0-100, based on data availability
}

export async function predictDealWin(dealId: string, orgId: string): Promise<DealPrediction> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      activities: true,
      contacts: true,
      pipeline: { include: { stages: true } },
    },
  })

  // Факторы:
  const stageProbability = deal.pipeline?.stages.find(s => s.name === deal.stage)?.probability || 0
  const daysSinceLastActivity = daysSince(deal.activities[0]?.createdAt)
  const activityCount = deal.activities.length
  const hasNextStep = !!deal.nextStep
  const dealAge = daysSince(deal.createdAt)

  // Исторические данные для калибровки
  const historicalDeals = await prisma.deal.findMany({
    where: { organizationId: orgId, stage: { in: ["WON", "LOST"] } },
    select: { stage: true, valueAmount: true, probability: true, createdAt: true, updatedAt: true },
  })

  const wonCount = historicalDeals.filter(d => d.stage === "WON").length
  const totalClosed = historicalDeals.length

  // Heuristic model (когда мало данных):
  let score = stageProbability

  // Activity engagement bonus/penalty
  if (daysSinceLastActivity > 14) score -= 15  // stale deal
  if (daysSinceLastActivity > 30) score -= 25
  if (activityCount > 5) score += 10
  if (activityCount > 10) score += 5
  if (!hasNextStep) score -= 10

  // Deal age penalty (too old = less likely)
  if (dealAge > 90) score -= 10
  if (dealAge > 180) score -= 20

  // Historical win rate calibration
  if (totalClosed > 10) {
    const historicalWinRate = (wonCount / totalClosed) * 100
    score = score * 0.7 + historicalWinRate * 0.3  // blend
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  const riskFactors: string[] = []
  if (daysSinceLastActivity > 14) riskFactors.push("Нет активности > 14 дней")
  if (!hasNextStep) riskFactors.push("Не указан следующий шаг")
  if (dealAge > 90) riskFactors.push("Сделка старше 90 дней")
  if (activityCount < 3) riskFactors.push("Мало взаимодействий")

  return {
    winProbability: score,
    expectedCloseDate: deal.expectedCloseDate,
    riskFactors,
    confidence: totalClosed > 20 ? 80 : totalClosed > 5 ? 50 : 30,
  }
}
```

#### 2.2 Revenue Forecast Engine

В том же `src/lib/ai/predictive.ts`:

```typescript
interface ForecastData {
  month: string
  committed: number    // deals in WON/CONTRACT stage
  bestCase: number     // committed + deals with prob > 70%
  pipeline: number     // all weighted: SUM(deal.value * deal.probability / 100)
  actual: number       // invoices paid
}

export async function generateRevenueForecast(orgId: string, months: number = 6): Promise<ForecastData[]> {
  const now = new Date()
  const forecast: ForecastData[] = []

  for (let i = 0; i < months; i++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0)
    const monthLabel = monthStart.toLocaleDateString("ru", { month: "short", year: "2-digit" })

    // Committed: deals closing this month with stage = WON or probability >= 90
    const committedDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        expectedCloseDate: { gte: monthStart, lte: monthEnd },
        OR: [{ stage: "WON" }, { probability: { gte: 90 } }],
      },
      select: { valueAmount: true },
    })
    const committed = committedDeals.reduce((s, d) => s + (d.valueAmount || 0), 0)

    // Best case: committed + deals with prob > 70
    const bestCaseDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        expectedCloseDate: { gte: monthStart, lte: monthEnd },
        probability: { gte: 70 },
        stage: { notIn: ["WON", "LOST"] },
      },
      select: { valueAmount: true },
    })
    const bestCase = committed + bestCaseDeals.reduce((s, d) => s + (d.valueAmount || 0), 0)

    // Pipeline: all open deals weighted by probability
    const pipelineDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        expectedCloseDate: { gte: monthStart, lte: monthEnd },
        stage: { notIn: ["WON", "LOST"] },
      },
      select: { valueAmount: true, probability: true },
    })
    const pipeline = pipelineDeals.reduce((s, d) => s + (d.valueAmount || 0) * ((d.probability || 0) / 100), 0)

    // Actual: invoices paid this month
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: "paid",
        paidAt: { gte: monthStart, lte: monthEnd },
      },
      select: { totalAmount: true },
    })
    const actual = invoices.reduce((s, inv) => s + (inv.totalAmount || 0), 0)

    forecast.push({ month: monthLabel, committed, bestCase, pipeline: committed + pipeline, actual })
  }

  return forecast
}
```

#### 2.3 Churn Risk Scoring

```typescript
interface ChurnRisk {
  contactId: string
  companyId?: string
  riskScore: number       // 0-100 (higher = more risk)
  factors: string[]
  lastActivity: Date | null
}

export async function calculateChurnRisk(orgId: string): Promise<ChurnRisk[]> {
  // Все компании с последней активностью
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 1 },
      tickets: { where: { status: { notIn: ["closed", "resolved"] } }, select: { id: true } },
      deals: { where: { stage: { notIn: ["WON", "LOST"] } }, select: { id: true } },
    },
  })

  return companies.map(company => {
    let risk = 0
    const factors: string[] = []
    const lastActivity = company.activities[0]?.createdAt || null
    const daysSinceActivity = lastActivity ? daysSince(lastActivity) : 999

    if (daysSinceActivity > 60) { risk += 40; factors.push("Нет активности > 60 дней") }
    else if (daysSinceActivity > 30) { risk += 20; factors.push("Нет активности > 30 дней") }

    if (company.tickets.length > 3) { risk += 20; factors.push(`${company.tickets.length} открытых тикетов`) }
    if (company.deals.length === 0) { risk += 15; factors.push("Нет активных сделок") }

    return {
      contactId: company.id,
      companyId: company.id,
      riskScore: Math.min(100, risk),
      factors,
      lastActivity,
    }
  }).filter(r => r.riskScore > 20)
    .sort((a, b) => b.riskScore - a.riskScore)
}
```

#### 2.4 Deal Velocity Analysis

```typescript
export async function dealVelocityAnalysis(orgId: string) {
  // Средние дни по стадиям для закрытых сделок
  // ... GROUP BY stage, AVG(дни в стадии)
  // Bottleneck: стадия с наибольшим средним временем
  // Trend: ускоряется или замедляется pipeline
}
```

#### 2.5 API endpoints

Создать `src/app/api/v1/analytics/forecast/route.ts`:
- GET: generateRevenueForecast(orgId, months)

Создать `src/app/api/v1/analytics/churn-risk/route.ts`:
- GET: calculateChurnRisk(orgId)

Создать `src/app/api/v1/analytics/deal-velocity/route.ts`:
- GET: dealVelocityAnalysis(orgId)

Обновить `src/app/api/v1/deals/[id]/route.ts`:
- GET: добавить `prediction` поле из predictDealWin()

#### 2.6 UI: обновить Dashboard forecast

**Файл**: `src/app/api/v1/dashboard/executive/route.ts`
- Заменить простой linear forecast на вызов `generateRevenueForecast()`
- Вернуть committed / bestCase / pipeline вместо single projected

**Файл**: `src/components/dashboard/revenue-trend.tsx`
- Обновить chart: 3 линии (committed, best case, pipeline) вместо одной projected
- Добавить confidence band

#### 2.7 UI: Win Probability на deal card

**Файл**: `src/app/(dashboard)/deals/page.tsx`
- На каждой deal card показать probability badge с цветом:
  - > 70% = green, 40-70% = yellow, < 40% = red
- Tooltip с risk factors

**Файл**: `src/app/(dashboard)/deals/[id]/page.tsx`
- Секция "AI Prediction": win probability, risk factors, confidence
- Кнопка "Обновить прогноз"

#### 2.8 UI: Churn Risk Dashboard Widget

Добавить виджет на dashboard или отдельную страницу:
- Top 10 at-risk клиентов
- Risk score badge + factors
- Quick action: "Создать задачу на check-in"

### Файлы
- `src/lib/ai/predictive.ts` — НОВЫЙ (вся predict/forecast логика)
- `src/app/api/v1/analytics/forecast/route.ts` — НОВЫЙ
- `src/app/api/v1/analytics/churn-risk/route.ts` — НОВЫЙ
- `src/app/api/v1/analytics/deal-velocity/route.ts` — НОВЫЙ
- `src/app/api/v1/dashboard/executive/route.ts` — обновить forecast
- `src/components/dashboard/revenue-trend.tsx` — 3 линии
- `src/app/(dashboard)/deals/page.tsx` — probability badge
- `src/app/(dashboard)/deals/[id]/page.tsx` — prediction section

### Коммит
```
feat: predictive analytics — win probability, revenue forecast, churn risk
```

---

## Задача 3: Weighted Pipeline + Forecast Dashboard (S2) — 3 недели

### Цель
Pipeline value взвешенный по probability. Quota management per rep. Forecast dashboard.

### Текущее состояние (аудит кода)
- **PipelineStage.probability**: поле СУЩЕСТВУЕТ (schema строка 586)
- **Deal.probability**: поле СУЩЕСТВУЕТ, берётся из stage при создании
- **Weighted calculation**: НЕ реализован — pipeline показывает raw сумму
- **SalesQuota**: модель НЕ существует
- **Forecast page**: НЕТ (только виджет на dashboard)

### Что сделать

#### 3.1 Prisma: SalesQuota модель

```prisma
model SalesQuota {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  user           User     @relation(fields: [userId], references: [id])
  year           Int
  quarter        Int      // 1-4
  amount         Float    // quota target
  currency       String   @default("AZN")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([organizationId, userId, year, quarter])
  @@index([organizationId])
  @@map("sales_quotas")
}
```

Добавить в User: `quotas SalesQuota[]`

#### 3.2 API: Weighted Pipeline

Обновить `src/app/api/v1/deals/route.ts` GET — добавить в response:
```typescript
// После загрузки deals, вычислить:
const pipelineSummary = {
  total: deals.reduce((s, d) => s + (d.valueAmount || 0), 0),
  weighted: deals.reduce((s, d) => s + (d.valueAmount || 0) * ((d.probability || 0) / 100), 0),
  byStage: stages.map(stage => ({
    name: stage.name,
    count: deals.filter(d => d.stage === stage.name).length,
    value: deals.filter(d => d.stage === stage.name).reduce((s, d) => s + (d.valueAmount || 0), 0),
    weighted: deals.filter(d => d.stage === stage.name).reduce((s, d) => s + (d.valueAmount || 0) * ((d.probability || 0) / 100), 0),
  })),
}
```

#### 3.3 UI: Deals page — weighted pipeline bar

**Файл**: `src/app/(dashboard)/deals/page.tsx`

Добавить над kanban:
```
┌────────────────────────────────────────────────┐
│ Pipeline: 1,250,000 ₼  │  Weighted: 487,500 ₼ │
│ ████████ LEAD (20%)     │  ███ QUALIFIED (35%)  │
│ ██████ PROPOSAL (50%)   │  ████ NEGO (70%)      │
└────────────────────────────────────────────────┘
```

#### 3.4 Forecast Page

Создать `src/app/(dashboard)/forecast/page.tsx`:

Структура:
```
┌──────────────────────────────────────────────────┐
│ Revenue Forecast                    Q2 2026 ▼    │
├──────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │Committed │ │Best Case │ │Pipeline  │          │
│ │ 125,000  │ │ 340,000  │ │ 580,000  │          │
│ └──────────┘ └──────────┘ └──────────┘          │
├──────────────────────────────────────────────────┤
│ [Chart: 3 lines — committed/bestCase/pipeline]   │
├──────────────────────────────────────────────────┤
│ By Rep:                                          │
│ Rashad    ████████████  85%  125K / 150K quota  │
│ Kamran    ██████        52%   78K / 150K quota  │
│ Nigar     ████████████████ 110%  165K / 150K    │
├──────────────────────────────────────────────────┤
│ By Pipeline:                                     │
│ Enterprise  340K weighted  │  SMB  140K weighted │
└──────────────────────────────────────────────────┘
```

#### 3.5 API: Quotas CRUD

Создать `src/app/api/v1/sales-quotas/route.ts`:
- GET: all quotas for org (with user names, actuals)
- POST: set quota (userId, year, quarter, amount)

Создать `src/app/api/v1/sales-quotas/[id]/route.ts`:
- PATCH, DELETE

#### 3.6 Settings: Quota Management

Создать `src/app/(dashboard)/settings/quotas/page.tsx`:
- Таблица: User | Q1 | Q2 | Q3 | Q4 | Annual
- Inline edit amounts
- Comparison: quota vs actual (from won deals)

### Файлы
- `prisma/schema.prisma` — SalesQuota модель
- `src/app/api/v1/deals/route.ts` — weighted pipeline summary
- `src/app/api/v1/sales-quotas/route.ts` — НОВЫЙ
- `src/app/api/v1/sales-quotas/[id]/route.ts` — НОВЫЙ
- `src/app/(dashboard)/deals/page.tsx` — weighted pipeline bar
- `src/app/(dashboard)/forecast/page.tsx` — НОВЫЙ
- `src/app/(dashboard)/settings/quotas/page.tsx` — НОВЫЙ

### Коммит
```
feat: weighted pipeline, revenue forecast dashboard, quota management
```

---

## Задача 4: Next Best Action Engine (A3) — 3 недели

### Цель
Контекстные рекомендации: "позвони клиенту", "отправь follow-up", "обнови deal stage".

### Текущее состояние (аудит кода)
- **Product recommendations**: `src/app/api/v1/ai/recommend/route.ts` — rule-based scoring, Claude explanations. **Работает**.
- **Next Best Offers widget**: `src/components/deals/next-best-offers.tsx` — top 3 products на deal detail. **Работает**.
- **Top scored leads**: виджет на dashboard. **Работает**.
- **AI deal recommendations**: НЕТ — нет "next step should be..." suggestions
- **Chat-based actions**: НЕТ — чат read-only

### Что сделать

#### 4.1 Next Best Action Logic

Создать `src/lib/ai/next-best-action.ts`:

```typescript
interface NextAction {
  type: "call" | "email" | "meeting" | "task" | "update_stage" | "send_offer"
  title: string
  reason: string
  priority: "high" | "medium" | "low"
  entityType: "deal" | "contact" | "lead" | "company"
  entityId: string
  entityName: string
  suggestedDate?: string
}

export async function generateNextBestActions(orgId: string, userId: string, limit: number = 10): Promise<NextAction[]> {
  const actions: NextAction[] = []
  const now = new Date()

  // 1. Stale deals — нет активности > 7 дней
  const staleDeals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      stage: { notIn: ["WON", "LOST"] },
      assignedTo: userId,
    },
    include: {
      activities: { orderBy: { createdAt: "desc" }, take: 1 },
      contacts: { take: 1 },
    },
  })

  for (const deal of staleDeals) {
    const lastActivity = deal.activities[0]?.createdAt
    const daysSince = lastActivity ? Math.floor((now.getTime() - lastActivity.getTime()) / 86400000) : 999

    if (daysSince > 14) {
      actions.push({
        type: "call",
        title: `Позвонить по сделке "${deal.name}"`,
        reason: `Нет активности ${daysSince} дней. Сделка может быть потеряна.`,
        priority: "high",
        entityType: "deal",
        entityId: deal.id,
        entityName: deal.name,
      })
    } else if (daysSince > 7) {
      actions.push({
        type: "email",
        title: `Follow-up по "${deal.name}"`,
        reason: `${daysSince} дней без контакта. Отправьте email чтобы поддержать momentum.`,
        priority: "medium",
        entityType: "deal",
        entityId: deal.id,
        entityName: deal.name,
      })
    }
  }

  // 2. Deals ready for next stage
  // ... deals с > 3 activities в текущей стадии и probability > stage threshold

  // 3. Leads с высоким score без follow-up
  const hotLeads = await prisma.lead.findMany({
    where: {
      organizationId: orgId,
      status: { notIn: ["converted", "lost"] },
      score: { gte: 70 },
    },
    include: { activities: { orderBy: { createdAt: "desc" }, take: 1 } },
  })

  for (const lead of hotLeads) {
    const daysSince = lead.activities[0] ? Math.floor((now.getTime() - lead.activities[0].createdAt.getTime()) / 86400000) : 999
    if (daysSince > 3) {
      actions.push({
        type: "call",
        title: `Горячий лид: ${lead.name}`,
        reason: `Score ${lead.score}/100, но нет контакта ${daysSince} дней. Конвертируйте пока горячий.`,
        priority: "high",
        entityType: "lead",
        entityId: lead.id,
        entityName: lead.name || lead.email || "Unknown",
      })
    }
  }

  // 4. Overdue tasks
  // 5. Tickets approaching SLA
  // 6. Deals with expectedCloseDate this week without next step

  return actions
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 }
      return p[a.priority] - p[b.priority]
    })
    .slice(0, limit)
}
```

#### 4.2 API endpoint

Создать `src/app/api/v1/ai/next-actions/route.ts`:
- GET: generateNextBestActions(orgId, userId)

#### 4.3 UI: Dashboard widget "Recommended Actions"

**Файл**: `src/app/(dashboard)/page.tsx`

Добавить виджет:
```
┌──────────────────────────────────────────────────┐
│ 🎯 Рекомендуемые действия                        │
├──────────────────────────────────────────────────┤
│ 🔴 Позвонить по сделке "PASHA Bank"              │
│    Нет активности 18 дней                [Звонок]│
├──────────────────────────────────────────────────┤
│ 🟡 Follow-up "Azerconnect"                       │
│    9 дней без контакта                   [Email] │
├──────────────────────────────────────────────────┤
│ 🔴 Горячий лид: Kamran Aliyev (score 85)         │
│    Нет контакта 5 дней               [Позвонить] │
└──────────────────────────────────────────────────┘
```

Quick action кнопки: при клике → открыть форму создания activity/task или compose email.

#### 4.4 UI: Deal detail — AI Insights section

**Файл**: `src/app/(dashboard)/deals/[id]/page.tsx`

Добавить секцию после existing content:
- Win probability (из A2)
- Risk factors
- Next recommended action
- Кнопка "Выполнить" → создать task/activity

#### 4.5 AI Chat integration

В AI Chat system prompt добавить context:
- Текущие next best actions для user
- Claude может сказать "Рекомендую позвонить по сделке X — нет активности 14 дней"
- С autonomous actions (A1) Claude может сразу создать задачу

### Файлы
- `src/lib/ai/next-best-action.ts` — НОВЫЙ
- `src/app/api/v1/ai/next-actions/route.ts` — НОВЫЙ
- `src/app/(dashboard)/page.tsx` — виджет recommended actions
- `src/app/(dashboard)/deals/[id]/page.tsx` — AI insights section

### Коммит
```
feat: next best action engine with dashboard widget and deal insights
```

---

## Порядок выполнения

```
1. Autonomous AI Actions (A1)       → "feat: autonomous AI actions with tool_use and approval flow"
2. Predictive Analytics (A2)        → "feat: predictive analytics — win probability, forecast, churn risk"
3. Weighted Pipeline + Forecast (S2)→ "feat: weighted pipeline, forecast dashboard, quota management"
4. Next Best Action (A3)            → "feat: next best action engine with dashboard widget"
```

Каждая задача — `npx prisma migrate dev` (если schema changes) + `npm run build` + коммит.
После всех 4: `git push origin main` (auto-deploy).

## Проверка после Фазы 2
- [ ] AI Chat: Claude может создать задачу, залогировать activity (low risk = auto)
- [ ] AI Chat: send_email и create_deal требуют approve кнопку
- [ ] Deals page: probability badge на каждой карточке (green/yellow/red)
- [ ] Deals page: weighted pipeline bar сверху
- [ ] Forecast page: 3 линии (committed, best case, pipeline)
- [ ] Forecast page: quota vs actual per rep
- [ ] Dashboard: "Рекомендуемые действия" виджет с quick actions
- [ ] Deal detail: AI Insights section с win probability + risk factors
- [ ] `npm run build` проходит без ошибок
