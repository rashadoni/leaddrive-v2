# Roadmap: LeadDrive v2 -> Уровень Salesforce
### Подробный план по каждой категории | Апрель 2026
### Основан на аудите кода + анализе пробелов

> **Июль 2026:** дополнение по итогам анализа релиза Creatio 10X — см. `docs/creatio-10x-gap-roadmap.md`
> (AI Trust Pack, метрики AI по каналам, web-трекинг, MEDDPICC, Sequences 2.0, конструктор агентов, MTM offline).

---

## Сводная таблица

| Категория | Сейчас | Цель | Разрыв | Усилия (Фазы 1-4) | Усилия (Фаза 5) |
|---|:---:|:---:|:---:|---|---|
| Sales & CRM | 3.4 | 4.6 | +1.2 | ~10-14 недель | +5 недель |
| Маркетинг | 2.3 | 4.6 | +2.3 | ~14-20 недель | +7 недель |
| Поддержка | 3.0 | 4.6 | +1.6 | ~8-12 недель | +5 недель |
| Коммуникации | 2.8 | 3.5 | +0.7 | ~4-6 недель | +3 недели |
| AI | 2.1 | 4.7 | +2.6 | ~16-24 недели | +7 недель |
| Финансы | 4.0 | 5.0 | +1.0 | ~4-6 недель | +5 недель |
| Платформа | 2.6 | 4.6 | +2.0 | ~16-22 недели | +9 недель |
| **ИТОГО** | **2.9** | **4.5** | | **Фазы 1-4: ~9 мес** | **Фаза 5: ~5 мес** |

> Параллельная работа 2-3 разработчиков: **Фазы 1-4 = 9 месяцев (до 4.1)**, **Фаза 5 = ещё 5 месяцев (до 4.5)**. Итого **~14 месяцев**.

---

## Категория 1: Sales & CRM (3.4 -> 4.6)

### Текущее состояние (аудит кода)
- Pipeline: 1 фиксированный pipeline с 6 стадиями (hardcoded)
- Deals: CRUD, kanban, timeline, команда, конкуренты, продукты
- Leads: CRUD + конвертация (Company -> Contact -> Deal)
- Прогнозирование: SalesForecast модель есть, но не связана с pipeline
- Мобильное приложение: отсутствует полностью

### План достижения 4.6

#### S1. Множественные Pipeline (+0.3 балла)
**Что**: Возможность создавать несколько pipeline (Enterprise, SMB, Renewal и т.д.)
**Зачем**: Salesforce позволяет разные воронки для разных типов продаж
**Как**:
- Добавить модель `Pipeline` (name, stages[], isDefault, orgId)
- Убрать hardcoded стадии из deals page
- Привязать Deal -> Pipeline (один ко многим)
- UI: управление pipeline в настройках + переключатель в deals
- Dashboard: фильтр по pipeline

**Файлы**: `prisma/schema.prisma`, `src/app/(dashboard)/deals/page.tsx`, `src/app/(dashboard)/deals/[id]/page.tsx`, `src/app/api/v1/deals/`, `src/app/(dashboard)/settings/`
**Усилия**: 2 недели
**Приоритет**: P0

#### S2. Weighted Pipeline + Прогнозирование (+0.4 балла)
**Что**: Вероятность закрытия по стадиям + revenue forecast на основе pipeline
**Зачем**: Einstein прогнозирует доход из вероятностей сделок
**Как**:
- Добавить `probability` per stage (настраиваемое, например: Proposal=40%, Negotiation=70%)
- Weighted pipeline = SUM(deal.value * stage.probability)
- Forecast dashboard: текущий квартал expected vs committed vs best case
- Quota model: `SalesQuota` (userId, period, amount) + vs actual tracking
- Rep-level forecast rollup

**Файлы**: schema, deals page, new `/forecast` page, API routes
**Усилия**: 3 недели
**Приоритет**: P0

#### S3. Sales Sequences / Cadences (+0.2 балла)
**Что**: Автоматические цепочки follow-up для лидов (email day 1 -> call day 3 -> email day 7)
**Зачем**: Salesforce Sales Engagement (бывший HVS) автоматизирует follow-up
**Как**:
- Новая модель `SalesSequence` (name, steps[])
- `SequenceStep` (type: email/call/task, delay_days, template)
- `SequenceEnrollment` (leadId/contactId, currentStep, status)
- Cron job для выполнения шагов
- UI: конструктор последовательностей + enrollment с deal/lead page

**Файлы**: schema, new pages, cron route
**Усилия**: 3 недели
**Приоритет**: P1

#### S4. Территории и квоты (+0.1 балла)
**Что**: Назначение аккаунтов на территории + квоты по менеджерам
**Зачем**: Enterprise-клиенты с 50+ продавцами нуждаются в территориях
**Как**:
- `Territory` модель (name, rules, assignedUsers)
- Автоматическое назначение по стране/размеру/отрасли
- `SalesQuota` (userId, period, amount, actual)
- Dashboard: quota attainment by rep

**Усилия**: 2 недели
**Приоритет**: P2

#### S5. PWA / Мобильное приложение (+0.2 балла)
**Что**: Progressive Web App с push-уведомлениями
**Зачем**: Salesforce mobile app — основной инструмент полевых продавцов
**Как**:
- next-pwa конфигурация (manifest.json, service worker)
- Responsive адаптация критических страниц (deals, contacts, tasks, calendar)
- Push notifications (Web Push API)
- Offline-first для просмотра контактов/сделок

**Усилия**: 3-4 недели
**Приоритет**: P0

---

## Категория 2: Маркетинг (2.3 -> 4.6)

### Текущее состояние (аудит кода)
- Кампании: только email, single-channel, базовые метрики
- Journey editor: 8 типов шагов, yes/no branching, cron-driven
- Сегменты: dynamic + static, 9 условий, AND/OR логика
- Шаблоны: raw HTML, без визуального редактора
- Лендинги: НЕТ (только web-to-lead form)
- A/B тесты: НЕТ

### План достижения 4.6

#### M1. Визуальный Email Editor (+0.5 балла)
**Что**: Drag-and-drop email конструктор вместо raw HTML
**Зачем**: HubSpot/Salesforce имеют визуальные билдеры — это стандарт
**Как**:
- Интеграция `react-email-editor` (unlayer) или `grapesjs` (open-source)
- Компоненты: header, text, image, button, columns, divider, social
- Сохранение как JSON + рендер в HTML для отправки
- Preview: desktop + mobile режимы
- Библиотека готовых шаблонов (5-10 pre-built)

**Усилия**: 3 недели
**Приоритет**: P0

#### M2. A/B Тестирование кампаний (+0.3 балла)
**Что**: Тест 2-4 вариантов темы/контента, автоматический выбор победителя
**Зачем**: Salesforce Marketing Cloud тестирует subject, content, send time
**Как**:
- `CampaignVariant` модель (campaignId, variantName, subject, templateId, percentage)
- Отправка: split аудитории по вариантам
- Метрики per variant: opens, clicks, conversions
- Auto-winner: после N часов отправить победителя остальным
- UI: variant tabs в кампании

**Усилия**: 2 недели
**Приоритет**: P1

#### M3. Расширенный Journey Editor (+0.4 балла)
**Что**: Multi-branch conditions, A/B splits, goal tracking, engagement scoring
**Зачем**: Salesforce Journey Builder имеет десятки типов нод
**Как**:
- Новые типы шагов: `ab_split` (рандом N%), `goal` (условие завершения), `exit` (условие выхода)
- Multi-branch: вместо yes/no — несколько выходов из condition ноды
- Wait по событию (а не только по времени): "wait until email opened"
- Real-time triggers: webhook-based enrollment (не только cron)
- Goal tracking: конверсия = enrollment дошёл до goal-шага
- Journey analytics: funnel visualization per step

**Усилия**: 4 недели
**Приоритет**: P1

#### M4. Поведенческая сегментация (+0.3 балла)
**Что**: Сегменты на основе действий (opened email, visited page, clicked link)
**Зачем**: Salesforce/HubSpot сегментируют по поведению, не только по полям
**Как**:
- Tracking events table: `ContactEvent` (contactId, eventType, metadata, timestamp)
- Events: email_opened, email_clicked, page_visited, form_submitted, deal_created
- Segment conditions: "opened campaign X in last 30 days", "clicked link Y"
- Engagement score = weighted sum of events (open=1pt, click=3pt, reply=5pt)
- Segment builder UI: add behavioral conditions alongside field conditions

**Усилия**: 3 недели
**Приоритет**: P1

#### M5. Landing Page Builder (+0.3 балла)
**Что**: Визуальный конструктор landing pages с формами
**Зачем**: HubSpot landing pages — один из основных lead-gen инструментов
**Как**:
- `LandingPage` модель (name, slug, htmlContent, formId, isPublished)
- GrapesJS-based page editor (open-source, drag-and-drop)
- Компоненты: hero, features, testimonials, CTA, form embed
- Публикация на subdomain или path: `/p/landing-slug`
- Конверсионная аналитика: visits, submissions, conversion rate
- Responsive preview

**Усилия**: 4 недели
**Приоритет**: P2

#### M6. Multi-channel кампании (+0.2 балла)
**Что**: Одна кампания = email + SMS + WhatsApp
**Зачем**: Salesforce Marketing Cloud объединяет каналы
**Как**:
- Campaign channels: массив каналов вместо одного типа
- Per-channel шаблоны в одной кампании
- Отправка: orchestrator выбирает канал по предпочтениям контакта
- Метрики per channel в одной кампании

**Усилия**: 2 недели
**Приоритет**: P2

#### M7. Campaign ROI и Attribution (+0.2 балла)
**Что**: Полная ROI-аналитика: затраты -> лиды -> сделки -> доход
**Зачем**: Salesforce Campaign Influence отслеживает multi-touch attribution
**Как**:
- Link campaigns -> leads -> deals (через contact touchpoints)
- First-touch и multi-touch attribution models
- ROI = (deal revenue from campaign - campaign cost) / campaign cost
- Dashboard: top performing campaigns by ROI, pipeline influenced

**Усилия**: 2 недели
**Приоритет**: P1

---

## Категория 3: Поддержка (3.0 -> 4.6)

### Текущее состояние (аудит кода)
- Тикеты: CRUD + SLA поля + авто-назначение (least loaded)
- SLA: политики с response/resolution time, но нет автоэскалации
- Agent Desktop: KPI дашборд + таблица тикетов + leaderboard
- Portal: создание тикетов + KB + чат
- CSAT: поля в схеме, нет автоматических опросов

### План достижения 4.6

#### T1. Skill-based Routing + Очереди (+0.3 балла)
**Что**: Назначение тикетов на основе навыков агента, не только загрузки
**Зачем**: Salesforce Omni-Channel routing учитывает навыки и capacity
**Как**:
- `AgentSkill` модель (userId, skill: string, proficiency: 1-5)
- `TicketQueue` модель (name, skills[], priority, autoAssign)
- Маршрутизация: match ticket.category -> queue.skills -> agent с минимальной загрузкой среди квалифицированных
- Round-robin как альтернатива least-loaded
- Agent availability status (online/busy/offline)
- UI: управление очередями и навыками в settings

**Усилия**: 2 недели
**Приоритет**: P0

#### T2. Автоматическая эскалация на SLA breach (+0.3 балла)
**Что**: При нарушении SLA — автоматическое уведомление менеджера, повышение приоритета, reassignment
**Зачем**: Salesforce Entitlement Process автоматически эскалирует
**Как**:
- `EscalationRule` модель (slaPolicyId, triggerAfterMinutes, actions[])
- Actions: notify_manager, increase_priority, reassign_to_queue, send_email
- Cron job: каждые 5 мин проверяет SLA breach и запускает эскалацию
- Multi-level escalation: Level 1 (уведомление) -> Level 2 (reassign) -> Level 3 (руководство)
- Dashboard: SLA breach trend, at-risk tickets

**Усилия**: 2 недели
**Приоритет**: P0

**Связанный детальный план**: `docs/support-entitlements-roadmap.md` — дорожная карта по customer support terms: создание условий поддержки по компаниям, milestone-конструктор, привязка к тикетам, эскалации, отчеты и права.

#### T3. Полноценный Agent Desktop (+0.3 балла)
**Что**: Единое рабочее место агента с контекстом клиента, макросами, таймером
**Зачем**: Salesforce Service Console — рабочее место с 360-degree customer view
**Как**:
- Customer context sidebar: компания, контакты, история тикетов, сделки, активность
- Quick actions: reply, assign, escalate, merge, close
- Macros (шаблоны быстрых ответов): `TicketMacro` модель (name, actions[], category)
- Handle time tracking: автоматический таймер при открытии тикета
- Keyboard shortcuts: R=reply, A=assign, E=escalate, C=close
- Next ticket button: автоматически открывает следующий тикет из очереди

**Усилия**: 3 недели
**Приоритет**: P1

#### T4. CSAT Surveys автоматические (+0.2 балла)
**Что**: Автоотправка опроса после закрытия тикета
**Зачем**: Salesforce отправляет CSAT/NPS автоматически
**Как**:
- `SurveyTemplate` модель (name, questions[], channel: email/portal)
- Trigger: при статусе ticket = "resolved" -> send survey через 1 час
- Survey page: `/portal/survey/[token]` — 1-5 звёзд + текст
- Dashboard: CSAT trend, по агентам, по категориям

**Усилия**: 1.5 недели
**Приоритет**: P1

#### T5. Omnichannel Conversation Merge (+0.2 балла)
**Что**: Объединение WhatsApp -> Email -> Chat в одну conversation
**Зачем**: Salesforce Omni-Channel объединяет все каналы в один customer timeline
**Как**:
- `ConversationThread` модель (contactId, messages from all channels)
- Merge logic: по contactId + email/phone matching
- Agent view: единый timeline всех каналов
- Customer identity resolution: WhatsApp phone = contact phone -> same thread

**Усилия**: 2 недели
**Приоритет**: P1

#### T6. Knowledge Base улучшения (+0.1 балла)
**Что**: Article versioning, feedback loop, AI suggested articles
**Как**:
- Article versioning (draft -> published -> archived)
- "Was this helpful?" UI в портале (helpfulCount уже в schema)
- AI: при создании тикета — автоматически предложить релевантные статьи
- Internal vs External articles (visibility control)

**Усилия**: 1.5 недели
**Приоритет**: P2

---

## Категория 4: Коммуникации (2.8 -> 3.3)

### Текущее состояние (аудит кода)
- Email SMTP: полностью работает (send/receive/log)
- WhatsApp, Telegram, VK, Facebook: webhook-based ingestion
- Omnichannel inbox: есть, но без единой маршрутизации
- VoIP: отсутствует полностью

### План достижения 3.3

#### C1. VoIP интеграция (+0.3 балла)
**Что**: Интеграция с VoIP-провайдером (Twilio, Asterisk, Zadarma)
**Зачем**: Salesforce CTI — стандарт для звонков из CRM
**Как**:
- Twilio/Zadarma SDK интеграция
- Click-to-call из карточки контакта/лида
- Call logging: автоматическое создание Activity (type: call)
- Call recording link (если провайдер поддерживает)
- Incoming call popup: показать карточку контакта при входящем звонке
- Settings: API ключ провайдера, номера

**Усилия**: 3 недели
**Приоритет**: P1

#### C2. Unified Channel Routing (+0.2 балла)
**Что**: Единая маршрутизация сообщений из всех каналов
**Как**:
- Все входящие сообщения (email, WhatsApp, Telegram, SMS) -> единая очередь
- Маршрутизация по правилам: канал, язык, категория -> конкретная очередь/агент
- Agent presence: online/away/offline статус
- Round-robin внутри очереди

**Усилия**: 2 недели
**Приоритет**: P1

---

## Категория 5: AI и автоматизация (2.1 -> 4.7)

### Текущее состояние (аудит кода)
- Lead scoring: Claude API, 5 факторов, grade A-F — РАБОТАЕТ
- AI Chat: Da Vinci чат, read-only доступ к CRM данным, создание тикетов
- AI Support: генерация ответов на тикеты, KB context injection
- Workflow engine: rule-based, 7 типов actions, без AI
- Predictive: SalesForecast модель в schema, но 0 логики
- AI Command Center: конфигурация агентов, но не оркестрация

### План достижения 4.7

#### A1. Autonomous AI Actions (+0.5 балла)
**Что**: AI агенты могут ВЫПОЛНЯТЬ действия, не только читать/отвечать
**Зачем**: Agentforce = автономные агенты. Главное отличие от "AI as copilot"
**Как**:
- Tool framework: каждое CRM-действие = tool для Claude
  - `create_deal`, `update_deal`, `assign_task`, `send_email`, `schedule_meeting`
  - `create_contact`, `update_contact`, `add_note`, `create_offer`
- Approval modes: auto-execute (low risk) vs confirm (high risk)
  - Low risk: create note, add tag, log activity
  - Medium risk: create task, assign ticket -> confirm with 1 click
  - High risk: send email, create deal, update price -> require explicit approval
- Action audit log: все AI-действия записываются с reasoning

**Файлы**: `src/app/api/v1/ai/chat/route.ts`, new tool definitions
**Усилия**: 4 недели
**Приоритет**: P0

#### A2. Predictive Analytics Engine (+0.5 балла)
**Что**: Win probability, revenue forecast, churn risk — на основе данных
**Зачем**: Einstein Prediction Builder строит модели на исторических данных
**Как**:
- **Deal Win Probability**: логистическая регрессия на stage + age + activity count + deal size
  - Обучение: на исторических won/lost сделках
  - Обновление: daily cron
  - UI: probability badge на каждой сделке в pipeline
- **Revenue Forecast**: weighted pipeline (deal.value * probability) + seasonal adjustment
  - Dashboard: forecast by month/quarter, committed vs best case vs pipeline
- **Churn Risk**: scoring контактов по активности (no activity 30d = risk)
  - Alerts: при risk > 70% -> notify account manager
- **Deal Velocity**: avg days per stage, bottleneck detection

**Усилия**: 4 недели
**Приоритет**: P0

#### A3. Next Best Action Engine (+0.4 балла)
**Что**: Контекстные рекомендации: "позвони этому клиенту", "отправь follow-up"
**Зачем**: Einstein Next Best Action — ключевая фича для продавцов
**Как**:
- Scoring model: для каждого контакта/лида — ranked list of actions
- Inputs: last activity date, deal stage, email engagement, ticket history
- Actions: call, email, meeting, send_offer, escalate
- Context: "Deal X не двигался 14 дней, последний email без ответа -> рекомендация: позвонить"
- UI: виджет на dashboard + deal detail page + notification
- Learning: track which recommendations were accepted vs ignored

**Усилия**: 3 недели
**Приоритет**: P1

#### A4. AI Email Intelligence (+0.3 балла)
**Что**: Анализ email переписки: sentiment, intent, urgency
**Зачем**: Einstein Email Insights анализирует intent/sentiment
**Как**:
- При получении email: Claude анализирует sentiment (positive/negative/neutral)
- Intent detection: question, complaint, request, payment_issue, churn_signal
- Urgency scoring: 1-5 на основе tone + keywords
- Auto-tagging: email получает теги (intent + urgency)
- Dashboard: email sentiment trend per client
- Alert: negative sentiment spike -> notify account manager

**Усилия**: 2 недели
**Приоритет**: P1

#### A5. AI-Driven Workflows (+0.3 балла)
**Что**: Workflow actions с AI decision-making (не только if/then)
**Зачем**: Salesforce Flow + Einstein = AI-driven automation
**Как**:
- Новый action type: `ai_decision` — Claude оценивает контекст и выбирает branch
- Пример: "если email от VIP клиента с негативным sentiment -> высокий приоритет + notify manager"
- AI condition: вместо field == value -> "содержит жалобу" (NLP)
- Adaptive routing: AI выбирает лучшего агента на основе истории успешных решений

**Усилия**: 2 недели
**Приоритет**: P2

#### A6. Multi-Agent Orchestration (+0.4 балла)
**Что**: Несколько AI агентов с разной специализацией + оркестратор
**Зачем**: Agentforce = fleet of specialized agents
**Как**:
- Agent types: Sales Agent, Support Agent, Marketing Agent, Data Agent
- Orchestrator: intent classification -> route to specialized agent
- Each agent has different system prompt + available tools + data access
- Agent handoff: Sales Agent -> Support Agent при обнаружении тикет-запроса
- Performance tracking: per-agent resolution rate, CSAT, cost
- Agent collaboration: один агент может вызвать другого

**Усилия**: 3 недели
**Приоритет**: P2

#### A7. Real-time Sales Coaching (+0.2 балла)
**Что**: AI подсказки во время работы с клиентом (battlecards, objection handling)
**Зачем**: Einstein Conversation Insights дает coaching в real-time
**Как**:
- При открытии deal -> AI генерирует battlecard (competitor strengths/weaknesses)
- При создании email -> tone suggestions, key points to mention
- Post-call summary: AI анализирует заметки к звонку и предлагает next steps
- Objection library: частые возражения + рекомендованные ответы

**Усилия**: 2 недели
**Приоритет**: P2

---

## Категория 6: Финансы (4.0 -> 5.0)

### Текущее состояние
Уже лидер среди CRM. Надо довести до идеала.

### План достижения 5.0

#### F1. Расширенная аналитика отчётов (+0.4 балла)
**Что**: Custom report builder с drag-and-drop
**Как**:
- Report builder: выбор entity -> fields -> filters -> grouping -> chart type
- Saved reports с расписанием (email report weekly)
- Cross-entity reports: deals + contacts + activities в одном отчёте
- Export: PDF, Excel, CSV

**Усилия**: 3 недели
**Приоритет**: P1

#### F2. Forecast Accuracy Tracking (+0.3 балла)
**Что**: Forecast vs Actual по месяцам, отслеживание точности прогнозов
**Как**:
- Snapshot monthly forecast -> compare with actual revenue
- Accuracy metric: |forecast - actual| / actual
- Trend: улучшается ли точность прогнозов со временем
- Per-rep accuracy comparison

**Усилия**: 1.5 недели
**Приоритет**: P1

#### F3. Financial Dashboard Improvements (+0.3 балла)
**Что**: Cashflow projection, waterfall charts, variance analysis
**Как**:
- Cashflow 12-month projection based on recurring revenue + expected invoices
- Waterfall: revenue -> COGS -> gross margin -> overhead -> net profit
- Variance analysis: budget vs actual by category with drill-down
- Automated alerts: if actual > 110% budget -> notify

**Усилия**: 2 недели
**Приоритет**: P2

---

## Категория 7: Платформа (2.6 -> 4.6)

### Текущее состояние (аудит кода)
- Custom fields: basic (text, select), любой entity, нет formula/lookup
- Roles: 5 built-in + custom, module-level (не field-level)
- API: 186 routes, v1, API keys + rate limiting
- Workflows: 7 action types, trigger-based, нет time-based
- Audit: CRUD-level, нет field-level tracking
- SSO: НЕТ (только credentials)
- Webhooks: incoming работают (TG/WA/FB/VK), outgoing в schema но нет UI
- Marketplace: НЕТ (0 интеграций)

### План достижения 4.6

#### P1. SSO / OAuth Providers (+0.4 балла)
**Что**: Google, Microsoft, SAML для enterprise
**Зачем**: Без SSO enterprise не купит. Это блокер #1
**Как**:
- NextAuth providers: Google, Microsoft Azure AD, generic SAML
- Settings page: configure OAuth client ID/secret per org
- Auto-provisioning: при первом SSO login создаётся user с viewer role
- Domain verification: только email с @company.com могут SSO

**Файлы**: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, settings
**Усилия**: 2 недели
**Приоритет**: P0

#### P2. Field-Level Permissions + Sharing Rules (+0.3 балла)
**Что**: Контроль видимости полей по ролям + sharing rules для записей
**Зачем**: Salesforce profiles контролируют видимость каждого поля
**Как**:
- `FieldPermission` модель (roleId, entityType, fieldName, access: read/edit/hidden)
- UI: матрица полей x ролей в настройках
- Sharing rules: owner team sees all, others see only assigned
- Record-level: `recordVisibility` (owner, team, organization)

**Усилия**: 3 недели
**Приоритет**: P1

#### P3. Marketplace / Integrations (+0.4 балла)
**Что**: Хотя бы 10-15 базовых интеграций
**Зачем**: 0 интеграций = изолированная система
**Как реализовать постепенно**:
1. **Zapier integration** (2 дня) — expose triggers + actions через Zapier developer platform -> даёт доступ к 5000+ apps
2. **1C integration** (1 неделя) — export invoices/payments в формат 1C (критично для СНГ)
3. **Google Workspace** (3 дня) — Calendar sync, Gmail sync, Google Drive attachments
4. **Microsoft 365** (3 дня) — Outlook sync, OneDrive
5. **Slack** (2 дня) — notifications + slash commands
6. **Telegram Bot** (уже есть) — добавить создание сделок/контактов через бот
7. **WhatsApp Business API** (уже есть) — углубить: media messages, templates
8. **n8n / Make.com webhooks** (1 день) — document webhook API

**Усилия**: 4-6 недель (постепенно)
**Приоритет**: P0 (Zapier), P1 (1C, Google, Slack), P2 (остальные)

#### P4. Advanced Custom Fields (+0.2 балла)
**Что**: Formula fields, lookup fields, rollup summaries
**Как**:
- Formula field: вычисляемое значение (например: total = quantity * price)
- Lookup field: ссылка на другую сущность (например: contact -> company.industry)
- Rollup summary: агрегация child records (например: deal.total = SUM(offer_items.amount))
- Field types: date, number, currency, percentage, URL, email (сейчас только text + select)

**Усилия**: 3 недели
**Приоритет**: P1

#### P5. Time-Based Workflows (+0.2 балла)
**Что**: Workflows с задержками и расписанием (не только trigger-based)
**Как**:
- Schedule trigger: "run every Monday at 9am"
- Time-based: "if deal.stage = Proposal AND days_since_update > 7 -> send follow-up"
- Delay action: "wait 3 days, then execute next action"
- Cron-driven execution engine (уже есть для journeys -> reuse)

**Усилия**: 2 недели
**Приоритет**: P1

#### P6. API Documentation + Developer Portal (+0.2 балла)
**Что**: Публичная API документация с examples
**Как**:
- Swagger/OpenAPI spec автогенерация из route handlers
- Developer portal page: `/developers` с docs
- Code examples: cURL, Python, JavaScript
- Rate limit documentation
- Webhook event catalog

**Усилия**: 2 недели
**Приоритет**: P1

#### P7. Field-Level Audit Trail (+0.1 балла)
**Что**: Отслеживание изменений по каждому полю, не только CRUD
**Как**:
- При update: diff oldValue vs newValue -> store per-field changes
- `AuditFieldChange` модель (auditLogId, fieldName, oldValue, newValue)
- UI: timeline показывает "status changed from Open to Resolved"
- Retention policy: auto-delete audit records older than X days

**Усилия**: 1.5 недели
**Приоритет**: P2

---

## Timeline: Рекомендуемый порядок выполнения

### Фаза 1: Foundation (Месяц 1-2) — Критические блокеры
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 1 | SSO / OAuth (P1) | Платформа | 2 нед | Разблокирует enterprise |
| 2 | Multiple Pipelines (S1) | Sales | 2 нед | Базовая enterprise потребность |
| 3 | PWA (S5) | Sales | 3 нед | Закрывает мобильный gap |
| 4 | Skill-based Routing (T1) | Поддержка | 2 нед | Базовая service потребность |
| 5 | SLA Auto-escalation (T2) | Поддержка | 2 нед | Критично для SLA |

### Фаза 2: Intelligence (Месяц 2-4) — AI + Прогнозирование
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 6 | Autonomous AI Actions (A1) | AI | 4 нед | Главный AI-gap |
| 7 | Predictive Analytics (A2) | AI | 4 нед | Win probability + forecast |
| 8 | Weighted Pipeline (S2) | Sales | 3 нед | Revenue forecasting |
| 9 | Next Best Action (A3) | AI | 3 нед | Salesforce-level coaching |

### Фаза 3: Marketing & Platform (Месяц 4-6) — Расширение
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 10 | Visual Email Editor (M1) | Маркетинг | 3 нед | Стандарт рынка |
| 11 | Zapier + Google + Slack (P3) | Платформа | 3 нед | Базовая экосистема |
| 12 | A/B Testing (M2) | Маркетинг | 2 нед | Campaign optimization |
| 13 | Agent Desktop v2 (T3) | Поддержка | 3 нед | Service console |
| 14 | Behavioral Segmentation (M4) | Маркетинг | 3 нед | Marketing maturity |

### Фаза 4: Scale (Месяц 6-9) — Enterprise readiness
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 15 | Field-Level Permissions (P2) | Платформа | 3 нед | Governance |
| 16 | Advanced Journey Editor (M3) | Маркетинг | 4 нед | Marketing automation |
| 17 | Multi-Agent Orchestration (A6) | AI | 3 нед | Agentforce parity |
| 18 | VoIP (C1) | Коммуникации | 3 нед | Telephony |
| 19 | Custom Report Builder (F1) | Финансы | 3 нед | Analytics maturity |
| 20 | Landing Page Builder (M5) | Маркетинг | 4 нед | Lead generation |

### Фаза 5: Финальный рывок (Месяц 9-14) — от 4.1 до 4.5

#### 5a: Sales + Support (Месяц 9-11)
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 21 | CPQ (S6) | Sales | 3 нед | +0.2 к Sales |
| 22 | Auto Activity Logging (S7) | Sales | 2 нед | +0.1 к Sales |
| 23 | Advanced Macros (T7) | Поддержка | 1.5 нед | +0.1 к Support |
| 24 | Cobrowse / Screen Share (T8) | Поддержка | 2 нед | +0.1 к Support |
| 25 | Proactive Service (T9) | Поддержка | 1.5 нед | +0.1 к Support |

#### 5b: AI + Communications (Месяц 10-12)
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 26 | Conversation Intelligence (A8) | AI | 4 нед | +0.3 к AI |
| 27 | Adaptive AI Models (A9) | AI | 3 нед | +0.2 к AI |
| 28 | SMS Provider Integration (C3) | Коммуникации | 1 нед | +0.1 к Comms |
| 29 | Call Transcription + Analysis (C4) | Коммуникации | 2 нед | +0.1 к Comms |

#### 5c: Marketing + Finance (Месяц 11-13)
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 30 | Engagement Scoring (M8) | Маркетинг | 2 нед | +0.1 к Marketing |
| 31 | Advanced Campaign Orchestrator (M9) | Маркетинг | 3 нед | +0.2 к Marketing |
| 32 | Content Performance AI (M10) | Маркетинг | 2 нед | +0.1 к Marketing |
| 33 | No-Code Report Builder (F4) | Финансы | 3 нед | +0.2 к Finance |
| 34 | Scenario Modeling (F5) | Финансы | 2 нед | +0.2 к Finance |

#### 5d: Platform (Месяц 12-14)
| # | Задача | Категория | Усилия | Эффект |
|---|---|---|---|---|
| 35 | No-Code Form Builder (P8) | Платформа | 3 нед | +0.2 к Platform |
| 36 | App Marketplace Foundation (P9) | Платформа | 4 нед | +0.3 к Platform |
| 37 | No-Code Page Builder (P8+) | Платформа | 2 нед | +0.05 к Platform |

---

## Детали задач Фазы 5

### Sales: S6. Configure-Price-Quote (CPQ) — 3 недели
**Что**: Конфигуратор продуктов + правила ценообразования + approval chain
**Как**:
- Product bundles (пакеты из нескольких продуктов)
- Pricing rules: volume discounts, tiered pricing, partner pricing
- Approval chain: discount > 20% -> manager approval -> director approval
- One-click: Offer -> Invoice -> Payment tracking
- Guided selling: AI предлагает cross-sell/upsell на основе профиля клиента

### Sales: S7. Automatic Activity Logging — 2 недели
**Что**: Email/Calendar sync -> автоматические Activity записи
**Как**:
- Email sync: при отправке/получении email через SMTP -> auto-create Activity
- Calendar sync (после Google/Outlook из P3) -> auto-log meetings
- Unified timeline: все activities (manual + auto) в хронологическом порядке
- Activity analytics: "deal имеет 3 touchpoints за 30 дней, avg для won = 8 -> рекомендация: увеличить engagement"

### Support: T7. Advanced Macros System — 1.5 недели
**Что**: Macro = цепочка действий: reply template + change status + assign tag + add note
**Как**:
- `TicketMacro` модель (name, actions[], category)
- Macro categories: по типу тикета (billing, technical, onboarding)
- Keyboard shortcuts per macro (Ctrl+1, Ctrl+2...)
- Macro analytics: какие макросы используются чаще, экономия времени

### Support: T8. Cobrowse / Screen Share — 2 недели
**Что**: Agent может предложить screen share session через портал
**Как**:
- WebRTC-based: без установки ПО
- Highlight/draw annotations на экране клиента
- Session recording для quality assurance
- Ссылка на session сохраняется в тикете

### Support: T9. Proactive Service — 1.5 недели
**Что**: Мониторинг здоровья клиентов + автоматические алерты
**Как**:
- Health score per client: ticket frequency + CSAT + SLA breaches
- Если 3+ тикета за неделю -> alert manager
- Auto-create "check-in" task при падении health score
- Dashboard: at-risk clients ranked by health score

### AI: A8. Conversation Intelligence Platform — 4 недели
**Что**: Анализ ВСЕХ коммуникаций с клиентом (emails + calls + chats)
**Как**:
- Topic extraction: о чём говорим с клиентом
- Competitor mentions tracker: alert при упоминании конкурента
- Deal risk signals: "клиент упомянул бюджетные ограничения 3 раза"
- Relationship map: кто с кем общается, key stakeholders
- AI summary per deal: "5 emails (positive), 2 calls (neutral), 1 risk signal"

### AI: A9. Adaptive AI Models — 3 недели
**Что**: A/B testing AI configs + feedback loop + cost optimization
**Как**:
- A/B test: какой system prompt даёт лучший CSAT
- Feedback loop: agent оценивает AI ответ -> модель учится
- Custom prompts per organization
- Smart routing: simple queries -> Haiku, complex -> Sonnet/Opus
- Model performance dashboard: accuracy, cost, latency per agent type

### Communications: C3. SMS Provider Integration — 1 неделя
**Что**: Two-way SMS через Twilio/MessageBird
**Как**:
- SMS API: отправка + приём ответов
- SMS templates с переменными
- SMS в campaign orchestrator
- Opt-in/opt-out management (compliance)

### Communications: C4. Call Transcription + Analysis — 2 недели
**Что**: Расшифровка звонков + AI-анализ
**Как**:
- Whisper API -> transcription после VoIP звонка
- Claude анализирует: topics, sentiment, action items, competitor mentions
- Auto-create summary note на deal/contact timeline
- Coaching: "вы не упомянули ценностное предложение X"

### Marketing: M8. Engagement Scoring — 2 недели
**Что**: Баллы за каждое действие контакта
**Как**:
- Scoring: open=1, click=3, reply=5, meeting=10, purchase=50
- Score decay: -10% в месяц без активности
- Segments: Hot (>80), Warm (40-80), Cold (<40)
- Auto-actions: cold -> re-engagement campaign, hot -> notify sales

### Marketing: M9. Advanced Campaign Orchestrator — 3 недели
**Что**: Одна кампания = email + SMS + WhatsApp + push
**Как**:
- Channel preference per contact: Telegram -> send there first
- Fallback: email не открыт 48ч -> fallback to SMS
- Cross-channel deduplication
- Unified metrics per campaign across all channels

### Marketing: M10. Content Performance AI — 2 недели
**Что**: AI анализирует эффективность контента
**Как**:
- Subject line analysis: "эта тема получила 45% open rate vs avg 22%"
- Send-time optimization: ML -> optimal send time per contact
- Content recommendations: "для сегмента X лучше короткие emails"

### Finance: F4. No-Code Report Builder — 3 недели
**Что**: Drag-and-drop конструктор отчётов
**Как**:
- Выбор entity -> поля -> фильтры -> группировка -> визуализация
- Chart types: bar, line, pie, funnel, scatter, heatmap
- Cross-entity joins: deals + contacts + activities
- Calculated fields (SUM, AVG, COUNT, formulas)
- Scheduled reports: email PDF/Excel по расписанию
- Report folders + sharing permissions

### Finance: F5. Scenario Modeling — 2 недели
**Что**: What-if анализ и Monte Carlo симуляция
**Как**:
- "Если увеличить цену на 10%, как изменится маржа?"
- Monte Carlo: revenue forecast с confidence intervals
- Sensitivity analysis: какие факторы больше всего влияют на прибыльность
- Scenario comparison: pessimistic / realistic / optimistic side-by-side

### Platform: P8. No-Code Form & Page Builder — 3+2 недели
**Что**: Конструктор форм (3 нед) + конструктор страниц (2 нед)
**Как**:
- **Формы (3 нед)**: drag-and-drop поля, conditions, validation rules
  - Типы: web-to-lead, тикеты, опросы, регистрация на ивенты
  - Embeddable iframe для вставки на внешний сайт
  - Form analytics: submissions, conversion rate
- **Страницы (2 нед)**: GrapesJS-based page builder
  - Landing pages, portal pages
  - Компоненты: hero, features, testimonials, CTA, form embed
  - Responsive preview

### Platform: P9. App Marketplace Foundation — 4 недели
**Что**: Plugin architecture + 5-10 first-party apps
**Как**:
- `App` модель (name, description, category, webhooks[], customFields[], uiWidgets[])
- Install/uninstall per organization
- 5 first-party apps: Google Calendar, Slack, Telegram Bot, WhatsApp Business, 1C Export
- App settings page per installed app
- Developer docs: как создать app (webhook-based)
- App catalog page в Settings

---

## Прогнозируемые оценки после каждой фазы

| Категория | Сейчас | Ф1 | Ф2 | Ф3 | Ф4 | **Ф5** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Sales & CRM | 3.4 | 3.8 | 4.2 | 4.2 | 4.3 | **4.6** |
| Маркетинг | 2.3 | 2.3 | 2.3 | 3.4 | 4.2 | **4.6** |
| Поддержка | 3.0 | 3.6 | 3.6 | 4.1 | 4.3 | **4.6** |
| Коммуникации | 2.8 | 2.8 | 2.8 | 2.8 | 3.3 | **3.5** |
| AI | 2.1 | 2.1 | 3.6 | 3.6 | 4.2 | **4.7** |
| Финансы | 4.0 | 4.0 | 4.0 | 4.0 | 4.6 | **5.0** |
| Платформа | 2.6 | 3.0 | 3.0 | 3.6 | 4.1 | **4.6** |
| **ОБЩИЙ** | **2.9** | **3.1** | **3.4** | **3.5** | **4.1** | **4.5** |

---

## Полный перечень задач (37 задач, 5 фаз)

| # | Код | Задача | Категория | Фаза | Усилия |
|---|---|---|---|:---:|---|
| 1 | P1 | SSO / OAuth Providers | Платформа | 1 | 2 нед |
| 2 | S1 | Множественные Pipeline | Sales | 1 | 2 нед |
| 3 | S5 | PWA / Мобильное приложение | Sales | 1 | 3 нед |
| 4 | T1 | Skill-based Routing | Поддержка | 1 | 2 нед |
| 5 | T2 | SLA Auto-escalation | Поддержка | 1 | 2 нед |
| 6 | A1 | Autonomous AI Actions | AI | 2 | 4 нед |
| 7 | A2 | Predictive Analytics Engine | AI | 2 | 4 нед |
| 8 | S2 | Weighted Pipeline + Forecast | Sales | 2 | 3 нед |
| 9 | A3 | Next Best Action Engine | AI | 2 | 3 нед |
| 10 | M1 | Visual Email Editor | Маркетинг | 3 | 3 нед |
| 11 | P3 | Zapier + Google + Slack | Платформа | 3 | 3 нед |
| 12 | M2 | A/B Testing кампаний | Маркетинг | 3 | 2 нед |
| 13 | T3 | Agent Desktop v2 | Поддержка | 3 | 3 нед |
| 14 | M4 | Behavioral Segmentation | Маркетинг | 3 | 3 нед |
| 15 | P2 | Field-Level Permissions | Платформа | 4 | 3 нед |
| 16 | M3 | Advanced Journey Editor | Маркетинг | 4 | 4 нед |
| 17 | A6 | Multi-Agent Orchestration | AI | 4 | 3 нед |
| 18 | C1 | VoIP Integration | Коммуникации | 4 | 3 нед |
| 19 | F1 | Custom Report Builder | Финансы | 4 | 3 нед |
| 20 | M5 | Landing Page Builder | Маркетинг | 4 | 4 нед |
| 21 | S6 | CPQ (Configure-Price-Quote) | Sales | 5a | 3 нед |
| 22 | S7 | Auto Activity Logging | Sales | 5a | 2 нед |
| 23 | T7 | Advanced Macros System | Поддержка | 5a | 1.5 нед |
| 24 | T8 | Cobrowse / Screen Share | Поддержка | 5a | 2 нед |
| 25 | T9 | Proactive Service | Поддержка | 5a | 1.5 нед |
| 26 | A8 | Conversation Intelligence | AI | 5b | 4 нед |
| 27 | A9 | Adaptive AI Models | AI | 5b | 3 нед |
| 28 | C3 | SMS Provider Integration | Коммуникации | 5b | 1 нед |
| 29 | C4 | Call Transcription + Analysis | Коммуникации | 5b | 2 нед |
| 30 | M8 | Engagement Scoring | Маркетинг | 5c | 2 нед |
| 31 | M9 | Advanced Campaign Orchestrator | Маркетинг | 5c | 3 нед |
| 32 | M10 | Content Performance AI | Маркетинг | 5c | 2 нед |
| 33 | F4 | No-Code Report Builder | Финансы | 5d | 3 нед |
| 34 | F5 | Scenario Modeling | Финансы | 5d | 2 нед |
| 35 | P8 | No-Code Form Builder | Платформа | 5d | 3 нед |
| 36 | P9 | App Marketplace Foundation | Платформа | 5d | 4 нед |
| 37 | P8+ | No-Code Page Builder | Платформа | 5d | 2 нед |

---

## Честное предупреждение

1. **Salesforce строили 25 лет с тысячами инженеров**. Полный паритет невозможен для small team. Цель -- 90% функциональности за 10-20% цены.

2. **AI gap самый сложный**. Autonomous agents требуют не только кода, но и данных для обучения моделей. С малым объёмом данных (12 deals, 17 leads) предиктивные модели будут ненадёжными. Решение: начать с rule-based heuristics + Claude API, переходить к ML по мере накопления данных.

3. **0 тестов** означает что каждая новая фича может сломать существующие. **Рекомендация**: выделить 2-3 недели перед Фазой 1 на написание тестов для critical paths (auth, deals, leads, tickets, invoices).

4. **Marketplace** -- самая долгая задача. Zapier (Фаза 3) даёт quick win через 5000+ apps. Собственный marketplace (P9, Фаза 5) -- это фундамент, а не финал. Настоящая экосистема строится годами.

5. **Оценки субъективны**. 4.5 = "на уровне Salesforce по функционалу для SMB/mid-market". Enterprise (Fortune 500) всё равно выберет Salesforce из-за экосистемы, compliance, track record. Но для компаний 20-200 человек LeadDrive на 4.5 = конкурентоспособная альтернатива.

6. **14 месяцев -- оптимистичная оценка**. Реалистично с учётом багфиксов, tech debt, customer requests: **16-18 месяцев**. С одним разработчиком: **24-30 месяцев**.

---

*Документ основан на аудите исходного кода LeadDrive v2 + анализе функционала Salesforce Sales/Service/Marketing Cloud. Апрель 2026.*
