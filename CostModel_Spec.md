# Спецификация модуля «Рентабельность» (Cost Model)

## Обзор

Модуль рентабельности — ключевой аналитический раздел, который вычисляет полную себестоимость IT-услуг, распределяет накладные расходы по 7 типам сервисов, считает маржу по каждому клиенту. Основан на логике Excel-калькулятора GT_Pricing_Calculator_v2.xlsx.

---

## 1. Вычислительный движок

### 1.1. Входные данные

Все параметры берутся из таблицы `pricing_parameters` (1 строка):
```
vat_rate             = ставка ƏDV (НДС), по умолчанию 0.18
employer_tax_rate    = налог работодателя, по умолчанию 0.175
risk_rate            = коэффициент риска, по умолчанию 0.05
misc_expense_rate    = коэффициент доп. расходов (Əlavə), по умолчанию 0.01
fixed_overhead_ratio = доля фиксированных затрат, по умолчанию 0.25
total_users          = общее кол-во пользователей (используется как fallback)
total_employees      = общее кол-во сотрудников (для расчёта страховки и мобильной связи)
```

### 1.2. Шаг 1 — Обработка накладных расходов

Для КАЖДОГО элемента из таблицы `overhead_costs` выполнить пересчёт в месячную сумму:
```
amt = amount                              // базовая сумма из БД

// ШАГ A: Годовые → месячные (ПЕРВЫМ!)
if is_annual == 1:
    amt = amt / 12

// ШАГ B: Добавить НДС
if has_vat == 1:
    amt = amt × (1 + vat_rate)            // vat_rate из pricing_parameters

// ШАГ C: Умножить на кол-во сотрудников (ТОЛЬКО для страховки и мобильной!)
if category == "insurance" OR category == "mobile":
    amt = amt × total_employees           // total_employees из pricing_parameters

monthly_amount = ROUND(amt, 2)
```

**ПОРЯДОК ВАЖЕН:** сначала делим на 12, потом умножаем на (1+НДС), потом на сотрудников.

Затем классификация:
```
if is_admin == 1:
    admin_overhead += monthly_amount      // пойдёт в аллокацию по headcount
else:
    tech_infra_total += monthly_amount    // пойдёт напрямую на сервис через target_service
```

**ИЗВЕСТНЫЙ БАГ В ДАННЫХ:** Элемент "Treninqlər" (training) имеет has_vat=1 в БД, но заметка говорит "ƏDV yoxdur" (нет НДС). При миграции решить: оставить как в БД (has_vat=1) для совместимости результатов, или исправить на has_vat=0 по логике.

### 1.3. Шаг 2 — Расчёт зарплат сотрудников

Для КАЖДОГО элемента из таблицы `cost_employees`:
```
income_tax_rate = 0.14                     // ЗАХАРДКОЖЕН! НЕ из параметров!
employer_tax_rate = из pricing_parameters   // по умолчанию 0.175

gross      = net_salary / (1 - income_tax_rate)      // = net / 0.86
super_gross = gross × (1 + employer_tax_rate)         // = gross × 1.175
total_labor_cost = count × super_gross
```

Распределение по категориям (проверяется ДВА поля: department и in_overhead):
```
if department == "BackOffice":
    back_office_cost += total_labor_cost
    // BackOffice ВСЕГДА идёт в overhead, независимо от in_overhead

elif in_overhead == 1:
    grc_direct_cost += total_labor_cost
    // Сейчас только GRC имеет in_overhead=1 (кроме BackOffice)

else:
    dept_costs[department] += total_labor_cost
    // IT, InfoSec, HelpDesk, ERP, PM — прямые затраты на сервис
```

### 1.4. Шаг 3 — Формирование admin overhead

```
// Section F: admin items + BackOffice (БЕЗ GRC!)
admin_for_f = admin_overhead + back_office_cost

// Section G: admin items + BackOffice + GRC
admin_for_g = admin_overhead + back_office_cost + grc_direct_cost

// Общий overhead для отображения:
total_overhead = admin_for_g + tech_infra_total
```

### 1.5. Шаг 4 — Назначение tech items на сервисы

Tech infrastructure items (is_admin=0) назначаются на конкретные сервисы.
В БД должна быть колонка `target_service`, но она может отсутствовать.
Используется fallback на hardcoded маппинг:

```
TECH_DEPT_FALLBACK = {
    "cloud": "cloud",
    "cloud_servers": "cloud",
    "cortex": "infosec",
    "fw_amort": "infosec",
    "firewall_amort": "infosec",
    "fw_license": "infosec",
    "palo_alto": "infosec",
    "pam": "infosec",
    "ms_license": "permanent_it",
    "service_desk": "permanent_it",
}

// Для каждого overhead item:
target = item.target_service (если колонка есть и не пустая)
         ИЛИ TECH_DEPT_FALLBACK[item.category]
if target существует:
    svc_tech_costs[target] += item.monthly_amount
```

**Защита от двойного счёта:**
Некоторые items с is_admin=1 ТАКЖЕ имеют target_service (пример: fw_amort).
Их нужно вычесть из admin аллокации:
```
tech_in_admin = 0
for each overhead_item:
    target = item.target_service OR fallback
    if item.is_admin == 1 AND target существует:
        tech_in_admin += item.monthly_amount

admin_for_g_adjusted = admin_for_g - tech_in_admin
```

### 1.6. Шаг 5 — Section F (Ядро Maya)

Section F — «ядро себестоимости». Включает только core-инженеров (IT + InfoSec).
```
core_labor = dept_costs["IT"] + dept_costs["InfoSec"]
// IT включает: SysAdmin(8чел) + NetAdmin(8чел) + Zəng Mərkəzi(4чел) = 20 чел
// Zəng Mərkəzi — отдельная запись в cost_employees, но department="IT"
// InfoSec = 12 чел

section_f_subtotal = admin_for_f + tech_infra_total + core_labor

misc = section_f_subtotal × misc_expense_rate
// misc_expense_rate из pricing_parameters (по умолчанию 0.01 = 1%)

risk_cost = (section_f_subtotal + misc) × risk_rate
// risk_rate из pricing_parameters (по умолчанию 0.05 = 5%)

grand_total_f = section_f_subtotal + misc + risk_cost
```

### 1.7. Шаг 6 — Section G (Полная себестоимость)

Section G распределяет admin overhead пропорционально headcount по всем 7 сервисам.
```
SERVICE_DEPT_MAP = {
    "permanent_it": ["IT"],
    "infosec":      ["InfoSec"],
    "erp":          ["ERP"],
    "grc":          ["GRC"],
    "projects":     ["PM"],
    "helpdesk":     ["HelpDesk"],
    "cloud":        [],          // нет прямого персонала!
}

// Headcount: все сотрудники КРОМЕ BackOffice
all_dept_employees = employees WHERE department != "BackOffice"
total_headcount = SUM(count) по all_dept_employees

// Для каждого сервиса:
for service, depts in SERVICE_DEPT_MAP:
    direct_labor = SUM(dept_costs[d]) для d in depts
    dept_headcount = SUM(count) сотрудников в depts
    ratio = dept_headcount / total_headcount   // если total_headcount == 0, ratio = 0
    admin_share = admin_for_g_adjusted × ratio
    tech_direct = svc_tech_costs[service] или 0
    service_costs[service] = ROUND(direct_labor + admin_share + tech_direct, 2)

grand_total_g = SUM(service_costs)             // сумма по всем 7 сервисам
grand_total = grand_total_g
```

**cloud получает admin_share=0** (нет персонала, ratio=0), но получает tech_direct.
**Section G НЕ включает misc и risk** (в отличие от Section F).

### 1.8. Шаг 7 — Total Users

```
portfolio_users = SELECT SUM(user_count) FROM companies
                  WHERE category='client' AND user_count > 0

// ТЕКУЩАЯ ЛОГИКА (total_users_manual ИГНОРИРУЕТСЯ в коде):
total_users = portfolio_users > 0 ? portfolio_users : total_users_param
```

### 1.9. Шаг 8 — Загрузка дохода из pricing_data.json

```
// Для каждой компании в pricing_data.json:
//   Общий доход = SUM(category.total) по всем категориям
//   Привязка к CRM через pricing_crm_mapping.json (code → name, case-insensitive)

// СПЕЦИАЛЬНАЯ ОБРАБОТКА "HelpDesk və Texniki Dəstək":
for service in hd_category.services:
    svc_total = service.qty × service.price
    if "HelpDesk Level" в service.name:     → helpdesk_revenue
    elif "ITAM" в service.name:             → helpdesk_revenue
    elif "Informational Systems Support"
         или "İnformational Systems Support" → erp_from_hd_revenue
    // остальные остаются в общем итоге категории
```

### 1.10. Шаг 9 — Маржа по клиентам

```
// Активные клиенты = UNION(клиенты с db_revenue > 0, клиенты в pricing_data.json)
total_active_clients = COUNT(union)
if total_active_clients == 0: total_active_clients = MAX(1, total_clients)

fixed_ratio = fixed_overhead_ratio            // по умолчанию 0.25
variable_ratio = 1.0 - fixed_ratio            // = 0.75

// Для КАЖДОГО клиента:
fixed_cost    = grand_total_g × fixed_ratio / total_active_clients
variable_cost = total_users > 0 ? (grand_total_g × variable_ratio × user_count / total_users) : 0
total_cost    = fixed_cost + variable_cost

// Два источника дохода (pricing_data.json приоритетнее):
effective_revenue = pricing_revenue > 0 ? pricing_revenue : db_revenue
margin     = effective_revenue - total_cost
margin_pct = effective_revenue > 0 ? (margin / effective_revenue × 100) : null

core_revenue = effective_revenue - helpdesk_revenue - erp_from_hd_revenue
core_margin  = core_revenue - total_cost

// Статусы:
if margin_pct == null:   "no_revenue"
elif margin_pct >= 15:   "good"
elif margin_pct >= 0:    "low"
else:                    "loss"
```

### 1.11. Шаг 10 — Аналитика по сервисам

```
// ВАЖНО: revenue берётся ТОЛЬКО из client_services таблицы, НЕ из pricing_data.json!
for each service:
    revenue = SUM(monthly_revenue) FROM client_services WHERE service_type=X AND is_active=1
    clients = COUNT(DISTINCT company_id) WHERE service_type=X AND monthly_revenue > 0
    balance = revenue - service_costs[service]
```

### 1.12. Cost Per User

```
cost_per_user_f = grand_total_f / total_users   // ← KPI карточка показывает ЭТО
cost_per_user   = grand_total_g / total_users
// Фронтенд: d.cost_per_user_f || d.cost_per_user
```

---

## 2. База данных — 6 таблиц

### 2.1. pricing_parameters
```sql
CREATE TABLE pricing_parameters (
    id                    INTEGER PRIMARY KEY DEFAULT 1,
    total_users           INTEGER DEFAULT 4500,
    total_users_manual    INTEGER DEFAULT 0,
    total_employees       INTEGER DEFAULT 137,
    technical_staff       INTEGER DEFAULT 107,
    back_office_staff     INTEGER DEFAULT 30,
    monthly_work_hours    INTEGER DEFAULT 160,
    vat_rate              REAL DEFAULT 0.18,
    employer_tax_rate     REAL DEFAULT 0.175,
    risk_rate             REAL DEFAULT 0.05,
    misc_expense_rate     REAL DEFAULT 0.01,
    fixed_overhead_ratio  REAL DEFAULT 0.25,
    updated_at            TEXT DEFAULT (datetime('now')),
    updated_by            INTEGER
);
```

### 2.2. overhead_costs
```sql
CREATE TABLE overhead_costs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    category       TEXT NOT NULL,
    label          TEXT NOT NULL,
    amount         REAL DEFAULT 0,
    is_annual      INTEGER DEFAULT 0,
    has_vat        INTEGER DEFAULT 0,
    is_admin       INTEGER DEFAULT 1,
    target_service TEXT DEFAULT '',
    sort_order     INTEGER DEFAULT 0,
    notes          TEXT DEFAULT ''
);
```

### 2.3. cost_employees
```sql
CREATE TABLE cost_employees (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    department   TEXT NOT NULL,
    position     TEXT NOT NULL,
    count        INTEGER DEFAULT 1,
    net_salary   REAL DEFAULT 0,
    gross_salary REAL DEFAULT 0,
    super_gross  REAL DEFAULT 0,
    in_overhead  INTEGER DEFAULT 0,
    notes        TEXT DEFAULT ''
);
```

### 2.4. client_services
```sql
CREATE TABLE client_services (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
    company_code    TEXT NOT NULL,
    service_type    TEXT NOT NULL,
    monthly_revenue REAL DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    notes           TEXT DEFAULT ''
);
```

### 2.5. cost_model_log
```sql
CREATE TABLE cost_model_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT, record_id INTEGER, action TEXT,
    old_value TEXT, new_value TEXT,
    changed_by INTEGER, changed_at TEXT DEFAULT (datetime('now'))
);
```

### 2.6. cost_model_snapshots
```sql
-- В оригинале баг: SERIAL PRIMARY KEY (PostgreSQL). Для SQLite использовать:
CREATE TABLE cost_model_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_month      TEXT NOT NULL UNIQUE,
    total_cost REAL, total_revenue REAL, margin REAL, margin_pct REAL,
    overhead_total REAL, employee_cost REAL,
    profitable_clients INTEGER, loss_clients INTEGER,
    data_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
```

### 2.7. Зависимые колонки в companies
```sql
ALTER TABLE companies ADD COLUMN user_count INTEGER DEFAULT 0;
ALTER TABLE companies ADD COLUMN cost_code TEXT DEFAULT '';
```

---

## 3. API Endpoints (22)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/cost-model/analytics | Полный расчёт |
| GET | /api/cost-model/client-analytics/{id} | Маржа одного клиента |
| GET | /api/cost-model/client-costs | Лёгкая карта затрат |
| GET | /api/cost-model/parameters | Параметры |
| PUT | /api/cost-model/parameters | Обновить параметры |
| GET | /api/cost-model/overhead | Список накладных |
| POST | /api/cost-model/overhead | Добавить |
| PUT | /api/cost-model/overhead/{id} | Обновить |
| DELETE | /api/cost-model/overhead/{id} | Удалить |
| GET | /api/cost-model/employees | Список сотрудников |
| POST | /api/cost-model/employees | Добавить (дубли dept+position запрещены) |
| PUT | /api/cost-model/employees/{id} | Обновить (пересчёт gross/super_gross) |
| DELETE | /api/cost-model/employees/{id} | Удалить |
| GET | /api/cost-model/client-services/{id} | Сервисы клиента |
| PUT | /api/cost-model/client-services/{id} | Upsert сервисов |
| POST | /api/cost-model/sync-pricing-services | Sync из pricing_data.json |
| POST | /api/cost-model/seed-clients | Bulk import клиентов |
| POST | /api/cost-model/snapshot | Сохранить снимок (SINGULAR!) |
| GET | /api/cost-model/snapshots | Список снимков |
| GET | /api/cost-model/snapshots/{month} | Загрузить снимок по месяцу |
| POST | /api/cost-model/ai-analysis | AI анализ (body: {tab, lang, force?}) |
| GET | /api/cost-model/log | Аудит лог (100 последних) |

---

## 4. Фронтенд — 6 вкладок

**Аналитика:** 5 KPI (grand_total_g, total_revenue, total_margin, profitable_clients, cost_per_user_f) + Donut chart (5 сегментов) + Horizontal bars (7 сервисов maya vs gəlir) + HelpDesk profitability + Top loss clients.

**Услуги:** Таблица 7 сервисов (cost, revenue, balance, %, employees, clients, status).

**Клиенты:** Таблица с сортировкой, модалка CRUD, sync кнопка.

**Накладные:** CRUD таблица, группировка admin/tech.

**Сотрудники:** CRUD таблица, фильтр по департаментам, backend считает gross/super_gross.

**Параметры:** Форма настроек, total_users readonly.

**Общее:** Snapshot save/load, AI Analysis под каждой вкладкой (кроме Параметры).

---

## 5. Маппинг категорий pricing_data.json

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
"HelpDesk və Texniki Dəstək"   → "helpdesk" (с разделением внутри по имени сервиса)
```

---

## 6. Известные баги оригинала

1. **cost_model_snapshots** — SERIAL PRIMARY KEY (PostgreSQL), таблица не создаётся в SQLite
2. **target_service** — колонка может отсутствовать, код fallback'ится на TECH_DEPT_FALLBACK
3. **total_users_manual** — флаг есть но не используется в логике расчёта
4. **Treninqlər** — has_vat=1 в БД, заметка "ƏDV yoxdur" (противоречие)

---

## 7. Проверка корректности

```
grand_total_f < grand_total_g
SUM(service_costs) == grand_total_g
cost_per_user_f × total_users ≈ grand_total_f
total_margin == total_revenue - grand_total_g
client.total_cost == client.fixed_cost + client.variable_cost
cloud.direct_labor == 0
SUM(admin_share по 7 сервисам) ≈ admin_for_g_adjusted
```

---

## 8. AI-аналитика (Claude Integration)

### 8.1. Обзор

Каждая вкладка (кроме «Параметры») имеет кнопку **«AI Анализ»**, которая вызывает Claude API с контекстом текущих данных cost model. Результат — структурированный финансовый анализ с разделами: Оценка, Риски, Рекомендации, Наблюдения.

### 8.2. API Endpoint

```
POST /api/cost-model/ai-analysis
Body: {
  "tab": "analytics" | "services" | "clients" | "overhead" | "employees",
  "lang": "ru" | "en" | "az",
  "force": false   // true = игнорировать кеш
}
Response: {
  "data": {
    "analysis": "текст анализа (markdown)",
    "thinking": "текст размышления модели (extended thinking)",
    "cached": true/false
  }
}
```

### 8.3. Кеширование

- In-memory кеш, ключ: `"{tab}_{lang}"` (например `"analytics_ru"`, `"clients_en"`)
- Возвращает кешированный ответ если `force != true`
- **Инвалидация**: кеш полностью очищается при ЛЮБОМ изменении данных cost model:
  - PUT/POST/DELETE overhead_costs
  - PUT/POST/DELETE cost_employees
  - PUT pricing_parameters
  - PUT/POST client_services
  - POST sync-pricing-services
  - POST seed-clients
- Реализация: вызов `_invalidate_ai_cache()` (или аналог) в каждом мутирующем эндпоинте

### 8.4. Сбор данных для промпта

При каждом вызове (не из кеша) собираются ВСЕ данные cost model из БД:

```
1. pricing_parameters → params (1 строка)
2. cost_employees → emp_data[] (department, position, count, net_salary, in_overhead)
3. overhead_costs → oh_data[] (category, name, amount, is_annual, has_vat)
4. companies (category='client') LEFT JOIN client_services → client_list[]
   - Для каждого клиента: name, user_count, services{type: revenue}, db_revenue
5. pricing_data.json → pricing_rev_by_id{company_id: total_revenue}
   - Через pricing_crm_mapping.json для связки pricing_code → crm_company_name
   - effective_revenue = pricing_rev если > 0, иначе db_revenue (fallback)
```

Вычисляемые агрегаты:
```
total_revenue      = SUM(client.effective_revenue)
total_users        = SUM(client.user_count)
total_salary       = SUM(emp.count × emp.net_salary)
total_overhead     = SUM( (oh.amount/12 если annual, иначе oh.amount) × (1+vat_rate если has_vat, иначе 1.0) )
burden             = employer_tax_rate × 100
total_salary_burdened = total_salary × (1 + burden/100)
dept_summary       = {dept: {headcount, salary_cost}} — группировка по департаментам
clients_sorted     = клиенты отсортированные по total_revenue DESC
top_clients        = первые 10
zero_revenue       = клиенты с total_revenue == 0
paying_clients     = кол-во клиентов с total_revenue > 0
```

### 8.5. Базовый контекст (общий для всех вкладок)

Каждый промпт начинается с `base_data` — бизнес-описание + ключевые показатели:

```
Бизнес-контекст:
- IT-аутсорсинговая компания «LeadDrive Inc.»
- Основной продукт: HelpDesk, SysAdmin, InfoSec, ERP, GRC, PM для внешних клиентов
- В 2026 году цены подняты на 15%
- BackOffice (17 чел.) — in_overhead, расходы распределяются на клиентов
- HelpDesk: 56 в таблице = 52 на клиентах + 4 call center

Ключевые показатели (подставляются из вычисленных агрегатов):
- Активные клиенты: {len(client_list)} (из них {paying_clients} с доходом)
- Общий доход/мес: {total_revenue} ₼
- ФОТ (с нагрузкой {burden}%): {total_salary_burdened} ₼
- Накладные расходы/мес: {total_overhead} ₼
- Себестоимость/мес: {total_salary_burdened + total_overhead} ₼
- Маржа/мес: {total_revenue - total_salary_burdened - total_overhead} ₼ ({margin_pct}%)
- Сотрудников: {total_headcount} | Пользователей клиентов: {total_users}
```

### 8.6. Пять вкладочных промптов

Каждый промпт = роль + base_data + вкладочные данные + lang_instruction + 4-секционная структура.

**Роль** для всех: `"Ты — финансовый аналитик IT-аутсорсинговой компании."`

**Язык**: `"Напиши анализ на {РУССКОМ|АНГЛИЙСКОМ|АЗЕРБАЙДЖАНСКОМ} языке."`

#### 8.6.1. analytics (по умолчанию)

Дополнительные данные:
- Распределение по отделам (dept_summary)
- Топ-10 клиентов (name, revenue, user_count, услуги)
- Клиенты без дохода (имена, до 15 шт.)
- Накладные расходы топ-10 (name, category, monthly_amt)

Структура ответа:
```
1. 📊 Общая оценка — здоровье бизнеса (2-3 предложения)
2. ⚠️ Ключевые риски — что беспокоит (2-4 пункта)
3. 💡 Рекомендации — конкретные действия для улучшения маржи (3-5 пунктов)
4. 🔍 Интересные наблюдения — паттерны в данных (2-3 пункта)
```
Лимит: 400 слов.

#### 8.6.2. services

Дополнительные данные:
- Сервисные направления: для каждого service_type → SUM(revenue), COUNT(clients)
  (агрегация из client_list[].services)
- Отделы → затраты: для каждого department → headcount, ФОТ burdened

Структура ответа:
```
1. 📊 Оценка направлений — прибыльные/убыточные направления (2-3 предложения)
2. ⚠️ Риски по направлениям — зависимость от одного, недозагруженные команды (2-3 пункта)
3. 💡 Рекомендации — оптимизация микса услуг, инвестиции (3-4 пункта)
4. 🔍 Наблюдения — паттерны (2 пункта)
```
Лимит: 350 слов.

#### 8.6.3. clients

Дополнительные данные:
- Топ-20 клиентов (name, revenue, user_count, список услуг)
- Клиенты без дохода (до 15 имён с user_count)
- Средний доход на клиента = total_revenue / paying_clients
- Средний доход на пользователя = total_revenue / total_users

Структура ответа:
```
1. 📊 Портфель клиентов — концентрация дохода, зависимости (2-3 предложения)
2. ⚠️ Риски — нулевой доход, высокая концентрация, недооцененные клиенты (2-4 пункта)
3. 💡 Рекомендации — upsell, cross-sell, ценообразование (3-4 пункта)
4. 🔍 Наблюдения — паттерны в клиентской базе (2 пункта)
```
Лимит: 350 слов.

#### 8.6.4. overhead

Дополнительные данные:
- Все overhead items отсортированные по monthly_amt DESC:
  name, category, monthly_amt, пометки "(illik÷12)" если annual, "(+ƏDV)" если has_vat
- Группировка по категориям: {category: SUM(monthly_amt)}
- Overhead как % от дохода = total_overhead / total_revenue × 100
- Overhead на сотрудника = total_overhead / total_headcount

Структура ответа:
```
1. 📊 Оценка расходов — общий уровень overhead, адекватность (2-3 предложения)
2. ⚠️ Риски — завышенные статьи, отсутствующие расходы, ƏDV нагрузка (2-3 пункта)
3. 💡 Рекомендации — оптимизация, сокращение (3-4 пункта)
4. 🔍 Наблюдения — аномалии, паттерны (2 пункта)
```
Лимит: 350 слов.

#### 8.6.5. employees

Дополнительные данные:
- Полное штатное расписание: department, position, count, net_salary, burdened_salary, total_cost, пометка [OVERHEAD] если in_overhead
- По отделам: headcount, ФОТ burdened
- Общий ФОТ (net) и (burdened)
- Средняя зарплата net = total_salary / total_headcount
- Доход на сотрудника = total_revenue / total_headcount

Структура ответа:
```
1. 📊 Оценка штата — эффективность, баланс между отделами (2-3 предложения)
2. ⚠️ Риски — перегруженные/недозагруженные отделы, зарплатные перекосы (2-3 пункта)
3. 💡 Рекомендации — оптимизация штата, пересмотр зарплат (3-4 пункта)
4. 🔍 Наблюдения — паттерны (2 пункта)
```
Лимит: 350 слов.

### 8.7. Конфигурация Claude API

```
SDK:          @anthropic-ai/sdk (AsyncAnthropic в Python, Anthropic в TS)
Model:        env MANAGER_MODEL || "claude-sonnet-4-5-20250929"
max_tokens:   16000
thinking:     { type: "enabled", budget_tokens: 10000 }
HTTP client:  httpx.AsyncClient (verify=false, timeout=300s) — для Python
              В Next.js: стандартный fetch через SDK
```

Сообщение отправляется как `messages: [{ role: "user", content: system_prompt }]` — весь промпт идёт как user message (не system).

### 8.8. Парсинг ответа

Response содержит `content[]` — массив блоков:
```
for block in response.content:
    if block.type == "thinking" → thinking_text (цепочка рассуждений модели)
    if block.type == "text"     → analysis_text (финальный анализ, markdown)
```

Оба текста сохраняются в кеш и возвращаются клиенту.

### 8.9. Обработка ошибок

```
- Нет API ключа (ANTHROPIC_API_KEY)   → 500 "ANTHROPIC_API_KEY not configured"
- Claude API error (anthropic.APIError) → 502 "AI service unavailable"
- Любая другая ошибка                  → 500 "Analysis error"
```

### 8.10. Фронтенд интеграция

- Кнопка «AI Анализ» на каждой вкладке (кроме Параметры)
- При нажатии → POST /api/cost-model/ai-analysis с текущей вкладкой и языком
- Loading state с анимацией (запрос может занять 15-30 сек)
- Результат отображается в markdown-рендерере (поддержка bold, emoji, списков)
- Показывать `thinking` (свёрнуто по умолчанию, как expandable section)
- Показывать бейдж «Cached» если ответ из кеша
- Кнопка «Обновить» → force=true для принудительного пересчёта
