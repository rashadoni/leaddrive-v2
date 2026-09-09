# Dashboard Redesign Plan — LeadDrive CRM v2

## Цель
Переделать CRM dashboard (`src/app/(dashboard)/page.tsx`) в стиле маркетингового preview (`src/components/marketing/dashboard-preview.tsx`) — плотный, информативный, Creatio-style layout с максимумом данных на одном экране.

---

## Текущее состояние

**Файл:** `src/app/(dashboard)/page.tsx` (~500 строк)
**API:** `GET /api/v1/dashboard/executive` — уже возвращает все нужные данные
**Widget config:** `GET /api/v1/dashboard/widget-config` — role-based visibility
**Библиотеки:** recharts (AreaChart, BarChart, PieChart), useCountUp, next-intl

**Текущие виджеты (9):**
1. Header (greeting + date)
2. 4 KPI карточки (Revenue, Pipeline, Clients, Tickets)
3. Risks Banner (alerts)
4. Revenue by Service (bar chart) + Pipeline Funnel
5. Sales Forecast + Client Health + Activity Feed (3 колонки)
6. At-Risk Deals + Quick Summary

**Проблемы:**
- KPI только 4, нужно 6
- Виджеты растянуты, много пустого пространства
- Нет Lead Sources donut
- Нет Campaign metrics
- Нет Events section
- Нет Weekly mini charts (SLA/CSAT/Response)

---

## Целевой layout (4 ряда × 3-6 колонок)

### Ряд 1: 6 KPI карточек (grid-cols-6)
| # | Метрика | Источник данных | Иконка |
|---|---------|----------------|--------|
| 1 | Gəlir (ay) — ₼247.8K, +18% | `financial.monthlyRevenue` | DollarSign |
| 2 | Aktiv Lidlər — 142, +24 | `leads.total` (новое поле) или count из Prisma | UserCheck |
| 3 | Açıq Sövdələşmələr — 38, ₼384K | `pipeline.open` + `financial.pipelineValue` | Target |
| 4 | Konversiya — 32.4%, +5.1% | `pipeline.conversionRate` (рассчитать: won/total) | TrendingUp |
| 5 | Açıq Tiketlər — 15, 2h orta cavab | `operations.openTickets` + `operations.avgResponseTime` | Headphones |
| 6 | Aktiv Kampaniyalar — 4, 68% açılma | Новый запрос: count Campaign where status=ACTIVE | Megaphone |

### Ряд 2: 3 виджета (grid-cols-3)
| # | Виджет | Содержание |
|---|--------|-----------|
| 1 | **Satış Pipeline** | Horizontal bar funnel: Yeni→Kvalifikasiya→Təklif→Danışıq→Qazanıldı. Данные из `pipeline.stages[]` |
| 2 | **Gəlir Trendi** | Line/Area chart (recharts). 12 месяцев. Данные из `forecast.actual[]` |
| 3 | **Lid Mənbələri** | Donut chart (recharts PieChart). Данные: группировка leads по source. Новое поле в API |

### Ряд 3: 3 виджета (grid-cols-3)
| # | Виджет | Содержание |
|---|--------|-----------|
| 1 | **Son Sövdələşmələr** | 5 последних deals. Из `pipeline.recentDeals[]` или новый запрос. Показать: name, company, value, stage, hot badge |
| 2 | **AI Lid Skorinq** | 5 top лидов с AI оценкой A-F. Из leads с сортировкой по score DESC. Новый запрос |
| 3 | **Son Fəaliyyət** | 5 последних activities. Из `activity.recent[]` (уже есть). Иконки по типу |

### Ряд 4: 3 виджета (grid-cols-3)
| # | Виджет | Содержание |
|---|--------|-----------|
| 1 | **Kampaniyalar** | 2 активных кампании: sent, open rate, click rate. Новый запрос к Campaign model |
| 2 | **Tədbirlər** | 3 ближайших мероприятия. Из Event model. Новый запрос |
| 3 | **Həftəlik Metriklər** | Mini bar charts: Yeni lidlər (7 дней), Tiketlər (7 дней) + SLA%, CSAT, Ort. cavab |

### Risks Banner (условный, между Ряд 1 и Ряд 2)
Оставить как есть — scrollable alerts для critical/warning issues.

---

## Задачи по реализации

### Этап 1: API расширение (`src/app/api/v1/dashboard/executive/route.ts`)

**Задача 1.1:** Добавить в ответ API новые поля:
```typescript
// Новые поля в data response:
{
  leads: {
    total: number,          // уже есть
    activeCount: number,    // новое: count where status != CLOSED
    newThisMonth: number,   // новое: count created this month
    bySource: { source: string, count: number }[],  // НОВОЕ: для donut
    topScored: { id, name, company, score, source }[], // НОВОЕ: для AI Skorinq
  },
  pipeline: {
    recentDeals: { id, name, company, value, stage, isHot, createdAt }[], // НОВОЕ
    conversionRate: number, // НОВОЕ: (won / total) * 100
  },
  campaigns: {  // НОВЫЙ блок
    active: { id, name, sentCount, openRate, clickRate }[],
    totalActive: number,
    avgOpenRate: number,
  },
  events: {  // НОВЫЙ блок
    upcoming: { id, title, date, attendeeCount, type }[],
    thisMonth: number,
    totalAttendees: number,
  },
  weeklyMetrics: {  // НОВЫЙ блок
    leadsPerDay: number[],    // 7 дней
    ticketsPerDay: number[],  // 7 дней
    slaCompliance: number,    // %
    csat: number,             // 1-5
    avgResponseHours: number,
  },
}
```

**Задача 1.2:** Prisma queries для новых данных:
- `Lead.groupBy({ by: ['source'] })` — для lid mənbələri
- `Lead.findMany({ orderBy: { score: 'desc' }, take: 5 })` — для AI skorinq
- `Deal.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })` — для son sövdələşmələr
- `Campaign.findMany({ where: { status: 'ACTIVE' } })` — для kampaniyalar
- `Event.findMany({ where: { date: { gte: now } }, take: 3 })` — для tədbirlər
- Daily counts за 7 дней для leads и tickets

### Этап 2: Компоненты (`src/components/dashboard/`)

**Задача 2.1:** Создать новые компоненты:
```
src/components/dashboard/
├── kpi-row.tsx           — 6 KPI карточек в ряд
├── pipeline-funnel.tsx   — Horizontal bar funnel
├── revenue-trend.tsx     — Area/Line chart (recharts)
├── lead-sources.tsx      — Donut chart (recharts PieChart)
├── recent-deals.tsx      — Список 5 сделок
├── ai-lead-scoring.tsx   — Список 5 лидов с A-F badge
├── activity-feed.tsx     — Лента 5 активностей
├── campaign-stats.tsx    — 2 кампании с sent/open/click
├── upcoming-events.tsx   — 3 мероприятия с датами
├── weekly-metrics.tsx    — Mini bar charts + SLA/CSAT/Response
└── risks-banner.tsx      — Извлечь из page.tsx (уже есть)
```

**Задача 2.2:** Стиль каждого компонента:
- Белый bg с border и shadow-sm (как в marketing preview)
- Компактный padding: `p-3` max
- Font sizes: заголовки `text-sm font-semibold`, данные `text-xs`
- Цветные иконки в кружках (bg-{color}-50 border-{color}-200)
- Зелёные стрелки ↑ для положительных трендов

### Этап 3: Page layout (`src/app/(dashboard)/page.tsx`)

**Задача 3.1:** Переписать layout:
```tsx
<div className="space-y-3">
  {/* Header */}
  <DashboardHeader greeting={...} date={...} />

  {/* 6 KPI */}
  <KpiRow data={data} />

  {/* Risks (условно) */}
  {risks?.length > 0 && <RisksBanner risks={risks} />}

  {/* Row 2: Pipeline + Revenue + Lead Sources */}
  <div className="grid grid-cols-3 gap-3">
    <PipelineFunnel stages={data.pipeline.stages} />
    <RevenueTrend data={data.forecast.actual} />
    <LeadSources data={data.leads.bySource} />
  </div>

  {/* Row 3: Deals + AI Leads + Activity */}
  <div className="grid grid-cols-3 gap-3">
    <RecentDeals deals={data.pipeline.recentDeals} />
    <AiLeadScoring leads={data.leads.topScored} />
    <ActivityFeed activities={data.activity.recent} />
  </div>

  {/* Row 4: Campaigns + Events + Weekly */}
  <div className="grid grid-cols-3 gap-3">
    <CampaignStats campaigns={data.campaigns} />
    <UpcomingEvents events={data.events} />
    <WeeklyMetrics metrics={data.weeklyMetrics} />
  </div>
</div>
```

**Задача 3.2:** Responsive fallback:
- На мобильном (`md:grid-cols-1`) — всё в 1 колонку
- На планшете (`md:grid-cols-2`) — 2 колонки
- На десктопе (`lg:grid-cols-3`) — 3 колонки
- KPI: `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`

### Этап 4: Widget config

**Задача 4.1:** Обновить widget-config API:
Добавить новые виджеты в defaults:
```typescript
campaigns: { enabled: true, roles: [] },
events: { enabled: true, roles: [] },
weeklyMetrics: { enabled: true, roles: [] },
leadSources: { enabled: true, roles: [] },
recentDeals: { enabled: true, roles: [] },
aiScoring: { enabled: true, roles: [] },
```

**Задача 4.2:** Settings UI — добавить toggle для новых виджетов в `/settings/dashboard`.

### Этап 5: i18n

**Задача 5.1:** Добавить переводы в словари (az, ru, en):
```json
{
  "dashboard": {
    "activLeads": "Aktiv Lidlər",
    "openDeals": "Açıq Sövdələşmələr",
    "conversion": "Konversiya",
    "campaigns": "Kampaniyalar",
    "recentDeals": "Son Sövdələşmələr",
    "aiScoring": "AI Lid Skorinq",
    "leadSources": "Lid Mənbələri",
    "revenueTrend": "Gəlir Trendi",
    "upcomingEvents": "Yaxınlaşan Tədbirlər",
    "weeklyMetrics": "Həftəlik Metriklər",
    "sla": "SLA",
    "csat": "CSAT",
    "avgResponse": "Ort. cavab"
  }
}
```

---

## Файлы для изменения

| Файл | Действие |
|------|----------|
| `src/app/api/v1/dashboard/executive/route.ts` | Расширить API ответ |
| `src/app/(dashboard)/page.tsx` | Полный переписать layout |
| `src/components/dashboard/*.tsx` | 11 новых компонентов |
| `src/app/api/v1/dashboard/widget-config/route.ts` | Добавить новые виджеты |
| `messages/az.json` | Переводы AZ |
| `messages/ru.json` | Переводы RU |
| `messages/en.json` | Переводы EN |

## Зависимости
- `recharts` — уже установлен ✅
- `useCountUp` hook — уже есть ✅
- `next-intl` — уже настроен ✅
- Prisma models: Lead, Deal, Campaign, Event, Ticket, Activity — все есть ✅

## Эталон дизайна
Файл-референс: `src/components/marketing/dashboard-preview.tsx`
- Светлая тема (bg-white, border-slate-200, shadow-sm)
- 6 KPI + 4 ряда × 3 колонки = 18 виджетов на экране
- Компактные gaps (gap-3), маленький padding (p-3)
- Animated numbers с useCountUp
- Цветные иконки в кружках

## Оценка
- **Время:** ~3-4 часа автономной работы
- **Сложность:** Средняя (API уже 80% данных отдаёт, нужно добавить ~20%)
- **Риск:** Низкий (старый layout сохранить в `page.tsx.bak` на случай отката)
