# ИНСТРУКЦИЯ: Устранение захардкоженных строк в LeadDrive CRM v2

## Что уже сделано
- Проведён полный аудит всех 90 page.tsx и 86+ компонентов
- Найдено **200+ захардкоженных мест** в 86 файлах
- Добавлены недостающие ключи переводов в `messages/en.json`, `messages/az.json`, `messages/ru.json`:
  - `budgeting.cashFlowChartTitle`, `cashFlowInflow`, `cashFlowExpense`, `cashFlowGap`, `cashFlowInflows`, `cashFlowExpenses`, `cashFlowBalance`, `cashFlowSuffix_M`, `cashFlowSuffix_K`
  - `budgeting.changesTitle`, `changesJustNow`, `changesMinAgo`, `changesHrAgo`, `changesYesterday`, `changesDayAgo`, `changesUnknown`, `changesBadgeNew`, `changesBadgeDel`, `changesUndo`, `changesRevertConfirm`, `changesHide`, `changesShow`, `changesShowLess`, `changesShowMore`
  - `budgeting.versionDiffTitle`, `versionDiffLoading`, `versionDiffAdded/Removed/Changed/Same`, `versionDiffCol*`, `versionDiffUnchangedLine/Lines`
  - `budgeting.deptAccessSelectDepartment`, `deptAccessSelectUser`, `deptAccessAdminNote`
  - `budgeting.csvImportColumns`, `deviationLabel`, `actualVsPlan`, `shareLabel`
  - `invoices.chartDebt`, `chartRevenue`, `chartCollections`, `chartPaymentStatus`, `chartNoData`, `chartInvoiceUnit`, `autoInvoices`, `activeLabel`, `nextLabel`, `noRecurring`
  - `deals.chartWon`, `chartLost`, `chartOngoing`, `stageShortLead/Qualified/Proposal/Negotiation/Won/Lost`

## Что нужно сделать

Проект использует `next-intl`. Переводы лежат в `messages/en.json`, `messages/az.json`, `messages/ru.json`. В компонентах используется хук `useTranslations("секция")` и функция `t("ключ")`.

Уже существующие ключи переводов, которые компоненты НЕ используют (хардкодят вместо этого):
- `budgeting.monthsShort` = "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec" (разделённые запятой)
- `invoices.status.*` = draft, sent, viewed, partially_paid, paid, overdue, cancelled, refunded
- `deals.stageLead/stageQualified/stageProposal/stageNegotiation/stageWon/stageLost`
- `invoices.tabAnalytics`, `invoices.tabList`
- `invoices.freqDaily/freqWeekly/freqMonthly/freqQuarterly/freqYearly`

---

## ФАЗА 2: CRITICAL — AZ строки в компонентах (заменить на t())

### Задача 2.1: Budget компоненты — заменить AZ месяцы и лейблы

**Паттерн замены месяцев** (одинаковый для 7 файлов):

Было (хардкод AZ):
```tsx
const MONTH_NAMES = ["Yan","Fev","Mar","Apr","May","İyn","İyl","Avq","Sen","Okt","Noy","Dek"]
```

Должно стать:
```tsx
import { useTranslations } from "next-intl"
// внутри компонента:
const t = useTranslations("budgeting")
const MONTH_NAMES = t("monthsShort").split(",")
```

**Файлы с MONTH_NAMES (все в `src/components/`):**

#### 1. `budget-cash-flow-chart.tsx`
- **Строка ~28**: `MONTH_NAMES` массив на AZ → `t("monthsShort").split(",")`
- **Строка ~31-32**: `"M"`, `"K"` → `t("cashFlowSuffix_M")`, `t("cashFlowSuffix_K")`
- **Строка ~52**: `"Pul axını — {year}"` → `t("cashFlowChartTitle", { year })`
- **Строка ~56**: `"Daxilolma:"` → `t("cashFlowInflow")`
- **Строка ~59**: `"Xərc:"` → `t("cashFlowExpense")`
- **Строка ~62**: `"Kassa boşluğu"` → `t("cashFlowGap")`
- **Строка ~77**: `"Xərclər"` → `t("cashFlowExpenses")`
- **Строка ~81**: `"Daxilolmalar"` → `t("cashFlowInflows")`
- **Строка ~89**: `"Balans"` → `t("cashFlowBalance")`
- ВАЖНО: `MONTH_NAMES` и форматтеры сейчас объявлены ВНЕ компонента. Нужно перенести внутрь (т.к. `t()` работает только внутри React компонента) или передавать через props.

#### 2. `budget-cash-flow-alerts.tsx`
- **Строка ~25**: `MONTH_NAMES` → аналогично

#### 3. `budget-cash-flow-table.tsx`
- **Строка ~20**: `MONTH_NAMES` → аналогично

#### 4. `budget-rolling-forecast.tsx`
- **Строка ~31**: `MONTH_NAMES` → аналогично

#### 5. `budget-chart-tooltip.tsx`
- **Строка ~65**: `"Kənarlaşma"` → `t("deviationLabel")`
- **Строка ~86**: `"Fakt vs Plan"` → `t("actualVsPlan")`
- **Строка ~97**: `"Pay"` → `t("shareLabel")`

#### 6. `budget-change-history.tsx`
- **Строка ~12**: `"₼"` → убрать хардкод валюты (использовать из данных или пропсов)
- **Строка ~25**: `"Just now"` → `t("changesJustNow")`
- **Строка ~26**: `"${diffMin}m ago"` → `t("changesMinAgo", { n: diffMin })`
- **Строка ~27**: `"${diffHrs}h ago"` → `t("changesHrAgo", { n: diffHrs })`
- **Строка ~28**: `"Yesterday"` → `t("changesYesterday")`
- **Строка ~29**: `"${diffDays}d ago"` → `t("changesDayAgo", { n: diffDays })`
- **Строка ~44**: `"Unknown"` → `t("changesUnknown")`
- **Строка ~78**: `"NEW"` → `t("changesBadgeNew")`
- **Строка ~87**: `"DEL"` → `t("changesBadgeDel")`
- **Строка ~106**: `"Undo"` → `t("changesUndo")`
- **Строка ~133**: `"Revert this change?"` → `t("changesRevertConfirm")`
- **Строка ~145**: `"Budget Changes"` → `t("changesTitle")`
- **Строка ~158**: `"Hide"` / `"Show"` → `t("changesHide")` / `t("changesShow")`
- **Строка ~187**: `"Show less"` / `"Show ${n} more changes"` → `t("changesShowLess")` / `t("changesShowMore", { count: n })`

#### 7. `budget-version-diff.tsx`
- **Строка ~31-35**: `"Added"`, `"Removed"`, `"Changed"`, `"Same"` → `t("versionDiffAdded/Removed/Changed/Same")`
- **Строка ~47**: `"Loading diff..."` → `t("versionDiffLoading")`
- **Строка ~63**: `"Version Comparison"` → `t("versionDiffTitle")`
- **Строки ~74-80**: Заголовки таблицы `"Category"`, `"Dept"`, `"Type"`, `"Plan A"`, `"Plan B"`, `"Delta"`, `"Status"` → `t("versionDiffCol*")`
- **Строка ~109**: `"unchanged line"` / `"unchanged lines"` → `t("versionDiffUnchangedLine/Lines")`

#### 8. `budget-department-access.tsx`
- **Строка ~87**: `"Select department"` → `t("deptAccessSelectDepartment")`
- **Строка ~101**: `"Select user"` → `t("deptAccessSelectUser")`
- **Строка ~174**: HTML заметка `"Admin and Manager..."` → `t("deptAccessAdminNote")`

#### 9. `budget-csv-import.tsx`
- **Строка ~116**: `"Колонки: ..."` → `t("csvImportColumns")`

---

### Задача 2.2: Invoices компоненты

#### 1. `invoices/recurring-invoices-list.tsx`
- **Строки ~16-19**: Частоты `{ daily: "Gündəlik", weekly: "Həftəlik", monthly: "Aylıq", quarterly: "Rüblük" }` → Использовать `t("freqDaily")`, `t("freqWeekly")`, `t("freqMonthly")`, `t("freqQuarterly")` из `useTranslations("invoices")`
- **Строка ~29**: `"Avto-fakturalar"` → `t("autoInvoices")`
- **Строка ~31**: `"aktiv"` → `t("activeLabel")`
- **Строка ~41**: `"Növbəti:"` → `t("nextLabel")`
- **Строка ~46**: Тернарник с `"₼"`, `"$"`, `"€"` → использовать данные о валюте из записи
- **Строка ~54**: `"Təkrarlanan faktura yoxdur"` → `t("noRecurring")`

#### 2. `invoices/payment-status-donut.tsx`
- **Строки ~21-29**: Маппинг статусов `{ draft: "Qaralama", sent: "Göndərildi", ... }` → Использовать `t("status.draft")`, `t("status.sent")` и т.д. из `useTranslations("invoices")`
- **Строка ~39**: `"Ödəniş Statusu"` → `t("chartPaymentStatus")`
- **Строка ~67**: `"faktura"` → `t("chartInvoiceUnit")`
- **Строка ~80**: `"Məlumat yoxdur"` → `t("chartNoData")`

#### 3. `invoices/aging-chart.tsx`
- Tooltip `"Borc"` → `t("chartDebt")`
- `"₼"` → убрать, использовать валюту из данных

#### 4. `invoices/revenue-trend-chart.tsx`
- **Строка ~44**: AZ месяцы → `t("monthsShort").split(",")` из `useTranslations("budgeting")` ИЛИ добавить `monthsShort` в `invoices` секцию
- Tooltip `"Gəlir"` → `t("chartRevenue")`
- `"₼"` → убрать

#### 5. `invoices/weekly-collections-chart.tsx`
- Tooltip `"Yığım"` → `t("chartCollections")`
- `"₼"` → убрать

#### 6. `invoices/currency-totals.tsx` — проверить на хардкод валют

---

### Задача 2.3: Deals компоненты

#### 1. `deals/deal-history.tsx`
- **Строка ~52**: Маппинг стадий `{ LEAD: "Lid", QUALIFIED: "Kvalif.", PROPOSAL: "Təklif", NEGOTIATION: "Danışıqlar", WON: "Qazanıldı", LOST: "İtirildi" }` → Использовать `t("stageShortLead")`, `t("stageShortQualified")` и т.д. из `useTranslations("deals")`

#### 2. `deals/win-loss-donut.tsx`
- **Строка ~21**: `["Qazanıldı", "İtirildi", "Davam edir"]` → `[t("chartWon"), t("chartLost"), t("chartOngoing")]` из `useTranslations("deals")`

#### 3. `deals/deal-velocity-chart.tsx`
- **Строка ~13**: `AZ_MONTHS` → `t("monthsShort").split(",")` из budgeting или добавить в deals

#### 4. `deals/revenue-projection-chart.tsx`
- **Строка ~10**: `AZ_MONTHS` → аналогично

---

### Задача 2.4: Остальные AZ хардкоды

#### 1. `campaigns/page.tsx`
- **Строка ~172**: `"Analitika"` → `t("tabAnalytics")` (ключ уже есть в campaigns секции!)
- **Строка ~179**: `"Siyahı"` → `t("tabList")` (ключ уже есть!)

#### 2. `data-table.tsx`
- **Строка ~176**: `"Hamısı"` → `t("all")` из `useTranslations("common")`

#### 3. `profitability/snapshots-tab.tsx`
- **Строка ~27**: AZ месяцы → `t("monthsShort").split(",")` из budgeting

#### 4. `dashboard/page.tsx` (главный дашборд)
- **Строки ~116, ~118**: Хардкод `"az"` для локали дат → использовать `useLocale()` из `next-intl`
- **Строки ~128, ~143, ~147**: `"₼"` → использовать валюту организации из данных

---

## ФАЗА 3: CRITICAL — RU строки в finance компонентах

Все файлы в `src/components/finance/`. Нужно добавить `useTranslations("payments")` или `useTranslations("finance")` и заменить русские строки на `t()`.

**ВАЖНО**: Перед заменой проверь, есть ли нужный ключ в `messages/en.json` в секции `payments` или `finance`. Если нет — добавь в ВСЕ 3 файла (en/az/ru).

### 1. `finance/payment-order-form.tsx` (~30 строк на RU)
- Все лейблы форм: `"Выберите неоплаченный счёт"`, `"— Выбрать счёт —"`, `"Расчётный счёт"`, `"SWIFT"`, `"VÖEN"` и т.д.
- Валюты: `"AZN"`, `"USD"`, `"EUR"`, `"RUB"`
- Ключи `payments.*` уже частично есть (bankName, bankSwift, voen, accountNumber и т.д.) — используй их

### 2. `finance/payment-orders-dashboard.tsx`
- **Строка ~370**: `"Отклонить платёжное поручение"` → `t("actions.reject")` + заголовок модалки
- **Строка ~374**: `"Причина отклонения *"` → `t("rejectionReason")`

### 3. `finance/payment-order-detail.tsx`
- Аналогично dashboard — те же строки отклонения

### 4. `finance/ap-dashboard.tsx`
- **Строка ~224**: `"Новый счёт"` → нужен ключ
- **Строка ~259**: `"Добавить оплату"` → нужен ключ

### 5. `finance/fund-manager.tsx`
- **Строка ~145**: `"Новый фонд"` → нужен ключ
- **Строка ~181**: `"Транзакции фонда"` → нужен ключ
- **Строки ~187-188**: `"Внесение"` / `"Списание"` → нужны ключи
- **Строка ~256**: `"Правила авто-распределения"` → нужен ключ
- **Строки ~263-265**: `"% от выручки"`, `"Фикс. ежемесячно"`, `"При оплате счёта"` → нужны ключи

### 6. `finance/bank-accounts-settings.tsx`
- **Строки ~117-171**: `"Управление банковскими реквизитами организации"` и другие RU лейблы
- Частично ключи есть в `payments.bankAccounts.*`

### 7. `finance/payment-notif-settings.tsx`
- **Строки ~145-147**: `"1 день"`, `"7 дней"`, `"14 дней"` → нужны ключи

---

## ФАЗА 4: HIGH — EN строки

### 1. `(public)/events/[id]/register/page.tsx` (~30 EN строк)
- Вся страница на английском без переводов
- `"Event Not Found"`, `"Register Now"`, `"Registration Closed"`, `"Full Name *"`, `"Email Address *"` и т.д.
- Нужно: добавить секцию `"eventRegistration"` в messages/*.json, подключить `useTranslations("eventRegistration")`

### 2. `budget-change-history.tsx` — уже описан в Фазе 2 (ключи добавлены)

### 3. `budget-version-diff.tsx` — уже описан в Фазе 2 (ключи добавлены)

### 4. `budget-department-access.tsx` — уже описан в Фазе 2 (ключи добавлены)

### 5. `admin/page.tsx`
- `"Super Admin Dashboard"`, `"System overview..."` — нет переводов
- Фейк данные компаний: `"Acme Corp"`, `"TechStart Inc"` — это OK для админки

### 6. `landing/page.tsx`
- `"LeadDrive CRM"`, `"Sell Better, Faster"`, `"Get Started Free"` — нет переводов

---

## ФАЗА 5: HIGH — Валюты и месяцы

### Валюты
Везде где хардкожена `"₼"` или `"$"`:
- Если данные содержат поле `currency` — использовать его
- Если нет — использовать org currency из контекста
- Создать маппинг: `{ AZN: "₼", USD: "$", EUR: "€", RUB: "₽" }`

Файлы: `dashboard/page.tsx`, `leads/page.tsx`, `invoices/aging-chart.tsx`, `invoices/revenue-trend-chart.tsx`, `invoices/weekly-collections-chart.tsx`, `budget-change-history.tsx`

### Месяцы
7 файлов с одинаковым `MONTH_NAMES` массивом → все должны использовать `t("monthsShort").split(",")` из `budgeting` секции.

---

## ФАЗА 6: MEDIUM — Marketing pages

### `(marketing)/demo/page.tsx` (~40 AZ строк)
- Вся страница на азербайджанском: форма, галерея, CTA
- Нужно: добавить секцию `"marketing"` или `"demo"` в messages/*.json

### `(marketing)/plans/page.tsx` (~50 AZ строк)
- Таблица сравнения планов, FAQ, CTA — всё на AZ
- Нужно: добавить секцию `"plans"` в messages/*.json

### `(marketing)/layout.tsx` (~10 строк)
- SEO метадата на AZ: title, description, keywords
- Нужно: мультиязычная метадата через `generateMetadata`

### `(marketing)/home/page.tsx` (~15 строк)
- JSON-LD structured data: `"LeadDrive CRM"`, `"LeadDrive Inc."`, `"Warsaw"`

---

## ФАЗА 7: MEDIUM — API error messages

API routes возвращают error messages на смеси языков. Это серверный код, `useTranslations` не работает. Варианты:
1. Оставить на английском (стандарт для API)
2. Использовать `getTranslations` из `next-intl/server` (если нужна локализация ошибок)

### Файлы:
- `api/v1/auth/register/route.ts` — EN messages
- `api/v1/auth/forgot-password/route.ts` — EN messages + HTML шаблон
- `api/v1/auth/reset-password/route.ts` — EN messages
- `api/v1/auth/2fa/route.ts` — EN messages
- `api/v1/public/leads/route.ts` — EN messages
- `api/v1/public/portal-auth/register/route.ts` — RU messages (INCONSISTENCY!)
- `api/v1/settings/smtp/route.ts` — RU messages (INCONSISTENCY!)
- `middleware.ts` — EN messages

**Рекомендация**: Привести все API error messages к единому английскому стандарту. Frontend должен сам показывать локализованные ошибки.

---

## ФАЗА 8: MEDIUM — Остальные компоненты

### 1. `lead-convert-dialog.tsx`
- `"Deal from ${lead.contactName}"` → нужен ключ с интерполяцией
- `"Failed to convert"` → `t("errorConvert")`
- Стадии с %: `"Lead (10%)"`, `"Qualified (25%)"` → использовать deals stage keys + %

### 2. `lead-detail-modal.tsx`
- Типы активности на RU: `"📝 Заметка"`, `"📞 Звонок"`, `"📧 Email"`, `"🤝 Встреча"` → нужны ключи
- Тоны: `"🏢 Профессиональный"`, `"😊 Дружелюбный"` → нужны ключи

### 3. `email-template-form.tsx`
- `"🇷🇺 Русский"`, `"🇦🇿 Azərbaycan"`, `"🇬🇧 English"` → нужны ключи для языковых лейблов

### 4. `contract-form.tsx`
- `"AZN (₼)"`, `"USD ($)"`, `"EUR (€)"`, `"RUB (₽)"` → маппинг валют
- `"Failed to save"` → `t("failedToSave")` из common

### 5. `contact-form.tsx`
- `"Website"` → уже есть `common.website`

### 6. `company-form.tsx`
- `"Prospect"` → нужен ключ

### 7. `ai/agent-builder.tsx`
- `"You are a helpful CRM assistant..."` → дефолтный промпт, можно оставить как есть (это не UI текст)

### 8. `profitability/employees-tab.tsx`
- `["BackOffice","IT","InfoSec","HelpDesk","ERP","GRC","PM"]` → это названия отделов из данных, можно оставить

---

## ФАЗА 9: LOW — URL и magic numbers

### URL → env переменные
- `"leaddrivecrm.org"` в middleware.ts → `process.env.NEXTAUTH_URL` или `process.env.APP_DOMAIN`
- `"https://leaddrivecrm.org"` в auth routes → `process.env.NEXTAUTH_URL`
- `"noreply@leaddrivecrm.org"` в email.ts → `process.env.SMTP_FROM` (уже должен быть в .env)
- `"app.leaddrivecrm.org"` в demo page → `process.env.NEXT_PUBLIC_APP_URL`

### Magic numbers — документировать
- `90` (дни до истечения контракта) → `const CONTRACT_EXPIRY_THRESHOLD_DAYS = 90`
- `8` (мин. длина пароля) → `const MIN_PASSWORD_LENGTH = 8`
- Rate limits в `rate-limit.ts` → уже OK, но можно вынести в env

---

## Технические правила

1. **Для client components** (`"use client"`): используй `useTranslations("секция")`
2. **Для server components**: используй `getTranslations("секция")` из `next-intl/server`
3. **Для API routes**: НЕ используй переводы, оставь EN (стандарт)
4. **Если MONTH_NAMES вне компонента**: перенеси внутрь или передай через props
5. **Проверяй**: `npm run build` после каждой фазы
6. **НЕ МЕНЯЙ layout/дизайн** — только текстовые строки
7. **НЕ УДАЛЯЙ компоненты** — только заменяй хардкод на t()

## Порядок работы

1. Открой файл → найди хардкоженные строки
2. Проверь есть ли ключ в messages/en.json → если нет, добавь в ВСЕ 3 файла
3. Добавь `import { useTranslations } from "next-intl"` если нет
4. Добавь `const t = useTranslations("секция")` если нет
5. Замени хардкод на `t("ключ")`
6. Для строк с переменными: `t("ключ", { var: value })`
7. `npm run build` для проверки
