# Промпт для Claude Code — Модуль «Рентабельность» (Cost Model)

Скопируй всё между линиями `---` и вставь в Claude Code:

---

## Задача

Реализуй модуль «Рентабельность» (Cost Model) в проекте leaddrive-v2. Это самый критический модуль — каждая цена влияет на всё остальное.

**Спецификация**: `CostModel_Spec.md` в корне проекта — читай ПОЛНОСТЬЮ перед началом. Там 8 секций: вычислительный движок (12 шагов), БД (6 таблиц), 22 API endpoints, 6 вкладок фронтенда, маппинг категорий, баги оригинала, проверки, AI-аналитика.

**Данные для seed**: `cost_model_migration_data/` — 5 JSON файлов (pricing_parameters, overhead_costs, cost_employees, client_services, client_companies). Используй для Prisma seed.

## Стек

- Next.js (App Router) + React + TypeScript
- Prisma ORM (PostgreSQL)
- Tailwind CSS + Radix UI
- TanStack Query (react-query)
- @anthropic-ai/sdk (для AI-аналитики)

## Порядок реализации

### 1. Prisma Schema

Добавь в schema.prisma 6 таблиц из секции 2 спеки:
- `PricingParameters` (1 строка, singleton)
- `OverheadCost` (category, label, amount, is_annual, has_vat, is_admin, target_service, sort_order, notes)
- `CostEmployee` (department, position, count, net_salary, gross_salary, super_gross, in_overhead, notes)
- `ClientService` (company_id → Company, company_code, service_type, monthly_revenue, is_active, notes)
- `CostModelLog` (table_name, record_id, action, old_value, new_value, changed_by, changed_at)
- `CostModelSnapshot` (snapshot_month UNIQUE, total_cost, total_revenue, margin, margin_pct, overhead_total, employee_cost, profitable_clients, loss_clients, data_json)

Добавь к модели `Company`: user_count Int @default(0), cost_code String @default("")

### 2. Seed данных

Расширь seed.ts — загрузи все JSON из cost_model_migration_data/ и создай записи через prisma.

### 3. Вычислительный движок

Файл: `src/lib/cost-model/compute.ts`

Реализуй функцию `computeCostModel()` — строго по 12 шагам из секции 1 спеки. Ключевые правила:

**Накладные (шаг 1):**
```
Порядок обработки КАЖДОГО overhead item:
amt = amount
if (is_annual) amt = amt / 12
if (has_vat) amt = amt × (1 + vat_rate)
if (label содержит "Sığorta" или "Mobil") amt = amt × total_employees
→ monthly_effective
```

**Зарплаты (шаг 2):**
```
income_tax = 0.14  // HARDCODED, НЕ из параметров!
gross = net_salary / (1 - income_tax)  // = net / 0.86
super_gross = gross × (1 + employer_tax_rate)  // employer_tax_rate из params, обычно 0.175
dept_cost = count × super_gross
```

**Разделение admin/tech (шаг 3-4):**
- is_admin=1 → admin overhead (распределяется по headcount на 7 сервисов)
- is_admin=0 → tech infra (назначается напрямую на target_service)
- BackOffice salary всегда → admin
- Защита от двойного счёта: если item имеет is_admin=1 И target_service → вычесть из admin_for_g

**Section F (шаг 5):**
```
core_salary = SUM(IT + InfoSec super_gross × count)
section_f = (core_salary + admin_for_f + tech_for_f) × (1 + misc_rate) × (1 + risk_rate)
```

**Section G (шаг 6-8):**
```
Для каждого из 7 сервисов:
  direct_labor = SUM(dept super_gross × count) для этого сервиса
  admin_share = admin_for_g × (dept_headcount / total_headcount)
  tech_share = tech_for_service (через target_service)
  total = (direct_labor + admin_share + tech_share) × (1 + misc_rate) × (1 + risk_rate)
```

**Клиентская маржа (шаг 9-10):**
```
active_clients = клиенты с user_count > 0
fixed_cost = grand_total_g × fixed_overhead_ratio / active_clients
variable_cost = grand_total_g × (1 - fixed_overhead_ratio) × (client.user_count / total_users)
client_total_cost = fixed_cost + variable_cost
revenue = pricing_data.json (primary) → client_services (fallback)
margin = revenue - total_cost
```

**Revenue по сервисам (шаг 11):**
```
ВАЖНО: service revenue берётся ТОЛЬКО из client_services, НЕ из pricing_data.json!
```

**KPI (шаг 12):**
```
cost_per_user_f = grand_total_f / total_users  // ← это показывает KPI карточка
cost_per_user   = grand_total_g / total_users
```

### 4. API Routes (22 эндпоинта)

Создай в `src/app/api/cost-model/`:

```
GET    /analytics              — полный расчёт (computeCostModel)
GET    /client-analytics/[id]  — маржа одного клиента
GET    /client-costs           — лёгкая карта затрат
GET    /parameters             — текущие параметры
PUT    /parameters             — обновить (инвалидировать AI кеш!)
GET    /overhead               — список
POST   /overhead               — добавить
PUT    /overhead/[id]          — обновить
DELETE /overhead/[id]          — удалить
GET    /employees              — список
POST   /employees              — добавить (дубли dept+position запрещены!)
PUT    /employees/[id]         — обновить (пересчитать gross/super_gross на backend!)
DELETE /employees/[id]         — удалить
GET    /client-services/[id]   — сервисы клиента
PUT    /client-services/[id]   — upsert сервисов
POST   /sync-pricing-services  — sync из pricing_data.json
POST   /seed-clients           — bulk import
POST   /snapshot               — сохранить (путь SINGULAR!)
GET    /snapshots              — список
GET    /snapshots/[month]      — загрузить по месяцу
POST   /ai-analysis            — AI анализ
GET    /log                    — аудит лог (100 последних)
```

Каждый мутирующий эндпоинт (POST/PUT/DELETE) должен:
1. Записать в cost_model_log (action, old_value, new_value)
2. Вызвать инвалидацию AI кеша

### 5. AI-аналитика (секция 8 спеки — ЧИТАЙ ПОЛНОСТЬЮ)

Файл: `src/lib/cost-model/ai-analysis.ts`

**Endpoint:** POST /api/cost-model/ai-analysis — body: `{tab, lang, force}`

**5 вкладочных промптов:**
- `analytics` — общий обзор: отделы, топ-10 клиентов, overhead топ, лимит 400 слов
- `services` — по сервисам: revenue по service_type, затраты отделов, лимит 350 слов
- `clients` — по клиентам: топ-20, zero-revenue, средние, лимит 350 слов
- `overhead` — накладные: все items sorted, по категориям, % от дохода, лимит 350 слов
- `employees` — штат: всё штатное расписание, по отделам, средние, лимит 350 слов

Каждый промпт включает:
1. **base_data** — бизнес-контекст LeadDrive Inc. + ключевые агрегаты (revenue, salary, overhead, margin, headcount)
2. **Tab-specific data** — дополнительные данные для конкретной вкладки
3. **lang_instruction** — язык ответа (ru/en/az)
4. **4-секционная структура ответа**: 📊 Оценка, ⚠️ Риски, 💡 Рекомендации, 🔍 Наблюдения

**Claude API конфигурация:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const model = process.env.MANAGER_MODEL || "claude-sonnet-4-5-20250929";

const response = await client.messages.create({
  model,
  max_tokens: 16000,
  thinking: { type: "enabled", budget_tokens: 10000 },
  messages: [{ role: "user", content: fullPrompt }]
});

// Парсинг: блоки type="thinking" → thinking_text, type="text" → analysis_text
```

**Кеширование:**
- In-memory Map, ключ: `"{tab}_{lang}"`
- Возврат из кеша если force !== true
- Инвалидация при ЛЮБОМ изменении данных (overhead, employees, parameters, client-services, sync, seed)

**Revenue в промптах:**
- effective_revenue = pricing_data.json (если > 0) → client_services fallback
- НЕ наоборот

### 6. Фронтенд

Страница: `src/app/(dashboard)/cost-model/page.tsx`

**6 вкладок** (Tabs через Radix UI):
1. **Аналитика** — 5 KPI карточек + Donut chart + Horizontal bars (7 сервисов: maya vs gəlir) + HelpDesk profitability + Top loss clients
2. **Услуги** — таблица 7 сервисов (cost, revenue, balance, %, employees, clients, status badge)
3. **Клиенты** — таблица с сортировкой + CRUD модалка + sync кнопка
4. **Накладные** — CRUD таблица, группировка admin/tech
5. **Сотрудники** — CRUD таблица, фильтр по департаментам, gross/super_gross считает backend
6. **Параметры** — форма настроек, total_users readonly (считается автоматом)

**KPI карточки:**
- Общая себестоимость (grand_total_g)
- Общий доход (total_revenue)
- Маржа (total_margin, цвет по знаку)
- Рентабельные клиенты (profitable_clients)
- Себестоимость на пользователя → `cost_per_user_f` (Section F / total_users, НЕ Section G!)

**Donut chart центр:** `(totalComposition / 1000).toFixed(0) + 'K ₼'`

**AI кнопка** под каждой вкладкой (кроме Параметры):
- POST /api/cost-model/ai-analysis с текущей вкладкой и языком
- Loading spinner (15-30 сек)
- Markdown рендер ответа
- Expandable section для thinking
- Бейдж «Cached» если из кеша
- Кнопка «Обновить» → force=true

**Data fetching:** TanStack Query, invalidateQueries после каждой мутации.

### 7. Маппинг категорий pricing_data.json → service_type

```
"İT İnfrastruktur"            → "permanent_it"
"Məlumat Bazası"               → "permanent_it"
"Bulud Xidmətləri"             → "cloud"
"Video, Monitorinq"            → "permanent_it"
"Avtomatlaşdırılmış Sistemlər" → "erp"
"SaaS Biznes Process"          → "erp"
"İnformasiya Təhlükəsizlik"    → "infosec"
"Təlim və Maarifləndirmə"      → "infosec"
"Konsaltinq və Layihə"         → "projects"
"Audit və Uyğunluq"            → "grc"
"HelpDesk və Texniki Dəstək"   → "helpdesk"
```

### 8. Проверки после реализации

```
grand_total_f < grand_total_g                          // F всегда меньше G
SUM(service_costs по 7 сервисам) == grand_total_g      // полное распределение
cost_per_user_f × total_users ≈ grand_total_f          // обратная проверка
total_margin == total_revenue - grand_total_g           // маржа
client.total_cost == client.fixed_cost + client.variable_cost
cloud.direct_labor == 0                                 // облако без прямых зарплат
SUM(admin_share по 7 сервисам) ≈ admin_for_g_adjusted  // полное распределение admin
```

### 9. Известные баги оригинала (не повторяй)

1. SERIAL PRIMARY KEY — используй Prisma autoincrement
2. target_service колонка может отсутствовать — в Prisma schema она есть, делай fallback
3. total_users_manual — флаг не используется, можно игнорировать
4. Treninqlər — has_vat=1 в данных, заметка "ƏDV yoxdur" (противоречие) — оставь как есть в seed

---
