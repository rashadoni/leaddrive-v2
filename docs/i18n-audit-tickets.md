# i18n Audit — Полный аудит ВСЕХ разделов + атомарные тикеты

> Дата: 2026-03-30 | Языки: ru, en, az | Страниц: 83 | ~530 hardcoded строк найдено

---

## СТАТИСТИКА

| Категория | Файлов | Hardcoded строк |
|-----------|--------|-----------------|
| Без i18n вообще | 4 | ~170 |
| Тяжёлый hardcode (>20 строк) | 8 | ~230 |
| Умеренный (5-20 строк) | 12 | ~100 |
| Минорный (1-4 строки) | 11 | ~30 |
| Чисто (OK) | ~48 | 0 |

---

## АТОМАРНЫЕ ТИКЕТЫ (по приоритету)

### ГРУППА A: КРИТИЧНО — Сырые ключи (t("key") без перевода)

#### T-001: emailTemplates namespace — 22 missing keys
- **Файл:** `src/components/email-template-form.tsx`
- **Ключи:** errorNameSubject, editorHint, tabEditor, tabPreview, fontSize, fontSmall, fontNormal, fontLarge, fontHeading, textColor, clientData, varClientName, varClientEmail, varCompany, varService, varNewServices, varImprovements, varUpcoming, varDate, varMonth, varYear, editorPlaceholder
- **Действие:** Добавить в ru/en/az.json

#### T-002: events namespace — 11 missing keys
- **Файл:** `src/components/event-form.tsx`
- **Ключи:** stepBasicInfo, stepLocationTime, stepBudgetTags, eventName, onlineEvent, meetingUrl, locationPlaceholder, expectedRevenue, addTag, summary, untitled

#### T-003: workflows namespace — 8 missing keys
- **Файл:** `src/components/workflow-actions-modal.tsx`
- **Ключи:** taskTitlePlaceholder, taskDescription, taskPriority, priorityLow/Medium/High/Urgent, assignTo

#### T-004: journeys namespace — 1 missing key
- **Файл:** `src/components/journey-form.tsx`
- **Ключ:** trigger

#### T-005: auth namespace — 6 missing keys
- **Файл:** `src/app/(auth)/login/verify-2fa/page.tsx`
- **Ключи:** invalidCode, verify2faTitle, verify2faSubtitle, enterCode, backupCodeHint, verifyCode

#### T-006: leads namespace — 30+ missing keys (AI modal)
- **Файл:** `src/app/(dashboard)/leads/[id]/page.tsx`
- **Ключи:** modalDetails, modalSentiment, modalTasks, modalAiText, modalAiScoring, modalAnalyzing, modalAnalyzeSentiment, modalSentimentDesc, modalSentimentLabel, modalTrend, modalTrendImproving, modalRisk, modalConfidence, modalSummary, modalGenerating, modalGenerateTasks, modalTasksDesc, modalStrategy, modalCreateAllTasks, modalRegenerate, modalTextType, modalTone, modalProfessional, modalExtraInstructions, modalExtraInstructionsPlaceholder, modalGenerateText, modalSubject, modalText, modalCopy, modalSent, modalSending, modalSendEmail, modalAiAnalysis, modalRecalculating, modalRecalculate, modalGrade, modalScore, modalConversion

---

### ГРУППА B: БЕЗ i18n ВООБЩЕ — Страницы без useTranslations

#### T-007: /support/agent-desktop — 30+ EN строк, нет i18n
- **Файл:** `src/app/(dashboard)/support/agent-desktop/page.tsx`
- **Строки:** "Agent Desktop", "Open Cases", "My Cases", "Avg Response", "CSAT", "Team KPIs", "Resolved", "SLA", "Open by Priority", "View all", "No open cases", "Subject", "Priority", "Status", "Created", "Untitled", "Agent Leaderboard", "No data", "Agent", "Avg Time"
- **Действие:** Добавить useTranslations("agentDesktop"), создать namespace

#### T-008: /support/calendar — 40+ EN строк, нет i18n
- **Файл:** `src/app/(dashboard)/support/calendar/page.tsx`
- **Строки:** "Agent Calendar", "Today", "Tickets/Tasks/Events/Activities", "Mon-Sun", "ALL DAY", "Loading calendar...", "Legend", "No items for today", "All Day", "Scheduled", "open tickets/tasks", "critical/high/medium/low", TYPE_CONFIG labels (Ticket/Task/Event/Call/Email/Meeting/Note)

#### T-009: /finance — 7 RU строк, нет i18n
- **Файл:** `src/app/(dashboard)/finance/page.tsx`
- **Строки:** "Финансы", "Обзор", "Дебиторка (A/R)", "Кредиторка (A/P)", "Фонды", "Платёжки", "Реестр"

#### T-010: /projects/[id] — 60+ AZ строк, нет i18n
- **Файл:** `src/app/(dashboard)/projects/[id]/page.tsx`
- **Строки:** STATUS_LABELS, PRIORITY_LABELS, TASK_STATUS_LABELS, MS_STATUS_LABELS, ROLE_LABELS + все лейблы форм, табов, кнопок, пустых состояний

---

### ГРУППА C: ТЯЖЁЛЫЙ HARDCODE (>20 строк)

#### T-011: /pricing — 50+ RU строк
- **Файл:** `src/app/(dashboard)/pricing/page.tsx`
- **Табы:** "Модель цен", "Редактировать цены", "Допродажи"
- **KPI:** "Общий ежемесячный доход", "Прогнозируемый", "Годовой эффект"
- **Таблицы:** "Компания", "Группа", "Базовая ₼", "Новая ₼", "Разница ₼", "%"
- **Кнопки:** "Экспорт в Excel", "Скачать", "Сбросить", "Удалить"
- **Формы:** "Название услуги", "Цена", "Название категории"

#### T-012: /journeys — 80+ RU/AZ строк (хаотично)
- **Файл:** `src/app/(dashboard)/journeys/page.tsx`
- **Проблема:** Смесь русского и азербайджанского без i18n
- **Включает:** getStepSummary(), condition scenarios, condition actions/fields/operators, journey cards, steps modal, add step dialog, enroll dialog

#### T-013: /settings/invoice-settings — 40+ EN/AZ строк
- **Файл:** `src/app/(dashboard)/settings/invoice-settings/page.tsx`

#### T-014: /settings/budget-config — 30+ RU строк
- **Файл:** `src/app/(dashboard)/settings/budget-config/page.tsx`

#### T-015: /settings/users — 30+ RU строк
- **Файл:** `src/app/(dashboard)/settings/users/page.tsx`

#### T-016: /settings/security — 25+ EN строк
- **Файл:** `src/app/(dashboard)/settings/security/page.tsx`

#### T-017: /settings/smtp-settings — 25+ EN строк
- **Файл:** `src/app/(dashboard)/settings/smtp-settings/page.tsx`

#### T-018: /settings/web-to-lead — 20+ EN строк
- **Файл:** `src/app/(dashboard)/settings/web-to-lead/page.tsx`

---

### ГРУППА D: УМЕРЕННЫЙ HARDCODE (5-20 строк)

#### T-019: /settings/email-templates — 15+ EN строк
- **Файл:** `src/app/(dashboard)/settings/email-templates/page.tsx`
- **Строки:** "Email Templates", "New Template", "Total Templates", "Languages", "Categories", column headers, "Delete Template"

#### T-020: /settings/channels — 12+ EN строк
- **Файл:** `src/app/(dashboard)/settings/channels/page.tsx`
- **Строки:** "Channel", "Total Channels", "No channels configured", "WhatsApp Test Message", "Token/Webhook configured", "Delete Channel"

#### T-021: /settings/sales-forecast — 15+ RU строк
- **Файл:** `src/app/(dashboard)/settings/sales-forecast/page.tsx`

#### T-022: /settings/custom-fields — 15+ AZ строк
- **Файл:** `src/app/(dashboard)/settings/custom-fields/page.tsx`

#### T-023: /contacts/[id] — 20+ EN строк
- **Файл:** `src/app/(dashboard)/contacts/[id]/page.tsx`
- **Строки:** engagement tab ("Calls/Emails/Meetings/Notes/Tasks", "Open Rate", "Click Rate", "Email Nurturing", "Activity Timeline"), info tab ("Department", "Active/Inactive"), AI tab ("Da Vinci Рекомендации")

#### T-024: /campaigns/[id] — 12+ EN строк
- **Файл:** `src/app/(dashboard)/campaigns/[id]/page.tsx`
- **Строки:** "Bounces", "Unsubscribes", "Spam", "Flow", "Delivery Rates", "Open/Click/Bounce rate", "Financial"

#### T-025: /tickets/[id] — 12+ RU строк
- **Файл:** `src/app/(dashboard)/tickets/[id]/page.tsx`
- **Строки:** "Назад", "Days open", "Дедлайн:", "Приоритет:", "Осталось:", "Комментарии", SLA labels

#### T-026: /campaign-roi — 10+ RU строк
- **Файл:** `src/app/(dashboard)/campaign-roi/page.tsx`
- **Строки:** "Нет кампаний для анализа", "Доход:", "Стоимость:", "Сделки:", "Выиграно:", "Лиды:"

#### T-027: /portal/tickets/[id] — 20+ EN строк
- **Файл:** `src/app/portal/tickets/[id]/page.tsx`
- **Строки:** STATUS_LABELS, CSAT labels, conversation UI

#### T-028: /portal/chat — 9+ EN строк
- **Файл:** `src/app/portal/chat/page.tsx`

#### T-029: /login/setup-2fa — 8+ RU строк (hardcoded без i18n)
- **Файл:** `src/app/(auth)/login/setup-2fa/page.tsx`
- **Строки:** "Подготовка...", "2FA включена!", "Настройка 2FA", "Подтвердить и включить", etc.

#### T-030: Dashboard (/) — 12+ AZ hardcoded строк
- **Файл:** `src/app/(dashboard)/page.tsx`
- **Строки:** "Idarə Paneli", "GALIR", "LIDLAR", "SOVDALASMALR", "KONVERSIYA", "TIKETLAR", "KAMPANIYALAR", timeAgo() function

---

### ГРУППА E: МИНОРНЫЙ HARDCODE (1-4 строки)

#### T-031: /settings/currencies — 4 EN строки
- "Code", "Symbol", "Exchange Rate", "Base"

#### T-032: /settings/sla-policies — 5 EN column labels
- "Policy Name", "Priority", "1st Response", "Resolution", "Business Hours"

#### T-033: /settings/audit-log — 3 EN строки
- "Action", "Entity", "User"/"System"

#### T-034: /settings/billing — 1 EN строка ("Cancel")

#### T-035: /settings/roles — 12 color labels + placeholder

#### T-036: /ai-scoring — 1 RU строка ("Пересчитать")

#### T-037: /register — 2 EN строки

#### T-038: /reset-password — 2 EN строки

#### T-039: /portal/login — 3 EN строки

#### T-040: /portal/set-password — 3 EN строки

#### T-041: /portal/knowledge-base — 1 EN строка ("{n} views")

#### T-042: /contacts (список) — 5 EN строк
- "CSV Import", "Portal", "Pending", source values

#### T-043: /companies/[id] — 9 RU/EN строк
- "Employees", "Annual revenue", table headers ("Услуга", "Единица", "Кол-во", "Цена", "Итого", "Тип", "Название", "Дата", "Статус")

#### T-044: /deals — 3 AZ строк
- "gun", "Kanban", "Analitika"

#### T-045: /deals/[id] — 5 EN строк
- Placeholder texts, InfoHint texts, raw role values

#### T-046: /tasks/[id] — 4 EN строк
- "d overdue", "h left", "d h left", "d left"

#### T-047: /tickets (список) — 2 строки
- "ч"/"м" hardcoded Russian time units

#### T-048: /lead-scoring — 5 RU строк
- Grade descriptions ("Горячие (80-100)" through "Мертвые (0-19)")

#### T-049: /budgeting — 3 EN строки
- Cash flow empty state

#### T-050: /segments — 3 RU строки
- "из", "от базы", "Удалить сегмент"

#### T-051: /email-templates (dashboard) — 3 RU строки
- "ЯЗЫК:", "ТИП:", "Пустой шаблон"

#### T-052: /knowledge-base/[id] — raw status
- Badge shows "published"/"draft" untranslated

#### T-053: /inbox — 2 EN строки
- "Live", "Paused"

#### T-054: /invoices — 3 AZ строки
- "Analitika", "Siyahi", "gun"

---

### ГРУППА F: КРОСС-СЕКЦИОННЫЕ ПРОБЛЕМЫ

#### T-055: Hardcoded locale "ru-RU" в форматировании дат
- **Файлы:** Dashboard, companies/[id], tasks, tasks/[id]
- **Действие:** Заменить на useLocale() из next-intl

#### T-056: Error messages не переведены
- **Строки:** "Failed to delete", "Failed to send", "Network error"
- **Файлы:** companies, contacts, campaigns/[id], tasks/[id], leads/[id]

#### T-057: Raw enum values без перевода
- contact.source ("website", "cold_call") — contacts page
- article.status ("published", "draft") — KB detail
- campaign.status/type — campaigns/[id]
- member.role ("owner", "member") — deals/[id]

---

## ЧИСТЫЕ СТРАНИЦЫ (OK, не требуют изменений)

- /settings (главная), /settings/workflows, /settings/portal-users
- /profitability, /projects (список)
- /login, /forgot-password, /verify-2fa (после T-005)
- /notifications, /knowledge-base (список)
- /events, /events/[id], /contracts, /contracts/[id]
- /offers, /offers/[id], /products, /products/[id]
- /invoices/create, /invoices/[id]/edit, /invoices/recurring, /invoices/[id]
- /leads (список), /tasks (список)
- /portal (redirect), /portal/register

---

## ПОРЯДОК ВЫПОЛНЕНИЯ

**Фаза 1 — Сырые ключи (T-001 → T-006):** ~40 мин
**Фаза 2 — Страницы без i18n (T-007 → T-010):** ~2 часа
**Фаза 3 — Тяжёлый hardcode (T-011 → T-018):** ~3 часа
**Фаза 4 — Умеренный (T-019 → T-030):** ~2 часа
**Фаза 5 — Минорный (T-031 → T-054):** ~2 часа
**Фаза 6 — Кросс-секционные (T-055 → T-057):** ~1 час

**Итого: ~57 тикетов, ~10 часов работы**
