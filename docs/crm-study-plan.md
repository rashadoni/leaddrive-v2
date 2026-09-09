# LeadDrive CRM — Deep Study Plan

## Цель
Полностью изучить каждую страницу, компонент, API, модель данных CRM.
Результат: полное понимание всех фич для маркетингового сайта.

---

## PHASE 1: CRM (Sales Core) — 15 тикетов

### S-001: Dashboard — KPI карточки
- Какие метрики показываются (Monthly Revenue, Pipeline, Clients, Open Tickets)
- Как считаются (API endpoint, SQL)
- Что кликабельно

### S-002: Dashboard — AI Risk Alerts
- Low margin alert (как считается порог)
- Unprofitable clients alert (логика подсчёта)
- Overdue tasks alert
- Как alerts генерируются и обновляются

### S-003: Dashboard — Revenue by Service chart
- Откуда данные (invoices? deals?)
- Группировка по сервисам
- Формат отображения

### S-004: Dashboard — Sales Pipeline funnel
- Стадии pipeline (Lead → Qualified → Proposal → Negotiation → Won → Lost)
- Как считаются суммы по стадиям
- Визуализация (funnel bars + counts)

### S-005: Dashboard — Recent Activities feed
- Типы активностей (note, meeting, call, email, task)
- Связи с компаниями/контактами
- Сортировка, пагинация

### S-006: Companies — список и фильтры
- Поля в таблице (name, industry, employees, revenue, status)
- Фильтры и сортировка
- Поиск
- CRUD (создание, редактирование)

### S-007: Companies — карточка (detail page + tabs)
- Overview tab — основные данные
- Contacts tab — связанные контакты
- Deals tab — сделки компании
- Activities tab — история взаимодействий
- Invoices tab — счета
- Custom fields

### S-008: Contacts — список, карточка, связи
- Поля (name, email, phone, company, role, tags)
- Связь с компанией
- Contact detail page + tabs
- CRUD

### S-009: Deals — Pipeline/Kanban view
- Kanban board (drag & drop между стадиями)
- List view
- Фильтры (stage, owner, date range)
- Создание deal

### S-010: Deals — карточка (detail page + все табы)
- Overview — основные поля, стадия, сумма
- Activities — timeline
- Engagement — email opens, page views
- Products/Services — привязанные продукты
- Offers — коммерческие предложения
- Contact Roles — stakeholder mapping
- Invoices — связанные счета
- Next Steps — заметки и следующие действия
- **Next Best Offers** — AI рекомендации

### S-011: Leads — список, scoring, статусы
- Lead statuses (new, contacted, qualified, converted, lost)
- Source tracking (web, phone, referral, event...)
- Lead conversion to Contact + Deal
- Manual vs auto scoring

### S-012: Tasks — список, создание, календарь
- Task types, priorities, statuses
- Due date tracking, overdue alerts
- Calendar view API
- Assignment to users

### S-013: Contracts — создание, файлы, статусы
- Contract fields (start/end date, value, status)
- File attachments
- Link to company/deal
- Status workflow

### S-014: Invoices — полный цикл
- Invoice creation (manual, from deal, from offer)
- Line items (products, discounts, custom columns)
- VAT/tax calculation
- PDF generation (HTML template)
- Sending via email
- Payment tracking
- Recurring invoices
- Invoice chaining
- Act (акт) generation
- Invoice statuses (draft → sent → paid → overdue)

### S-015: Offers + Products
- Offer creation from deal
- Line items, discounts
- Offer sending via email
- Conversion to invoice
- Products catalog — CRUD, pricing

---

## PHASE 2: Marketing & Campaigns — 8 тикетов

### S-016: Campaigns — создание и flow editor
- Campaign types
- Multi-step flow editor
- Channel selection (email, SMS, Telegram, WhatsApp)
- Template selection per step
- Recipient selection (segments)
- Scheduling

### S-017: Campaigns — отправка и трекинг
- Send API logic
- Delivery tracking
- Open/click tracking
- Error handling

### S-018: Campaign ROI
- ROI calculation logic
- Conversion attribution
- Cost per lead/conversion
- Charts and metrics

### S-019: Segments — condition builder
- Dynamic vs static segments
- Condition types (company, source, role, tags, dates, fields)
- Operators (equals, contains, not_empty, before/after)
- Preview API (live count)
- Segment in campaign targeting

### S-020: Journeys — visual builder + engine
- Trigger types (lead creation, contact creation, deal stage change, manual)
- Step types:
  - Send email (template)
  - Send SMS
  - Send Telegram
  - Send WhatsApp
  - Wait/delay
  - Conditional branch
  - Create task
  - Update field
- Journey engine processing (batch API)
- Enrollment management
- Statistics (entries, active, completed)

### S-021: Email Templates — конструктор
- Template creation (HTML/text)
- Variable system ({{firstName}}, {{company}}, etc.)
- Template categories
- Preview

### S-022: Email Log — отправки и трекинг
- Send/receive history
- Open tracking pixels
- Click tracking
- Bounce handling
- Delivery status

### S-023: Events — создание и публичная регистрация
- Event creation (name, date, location, description)
- Public registration page (/events/[id]/register)
- Participant tracking
- Web-to-lead via events
- Calendar integration

---

## PHASE 3: Communication — 3 тикета

### S-024: Inbox — unified multi-channel
- Channel list (WhatsApp, Telegram, Facebook, Instagram, Email, SMS, VK)
- Conversation threading by contact
- Two-way messaging (reply through same channel)
- Contact mapping across channels
- Message history
- Attachment handling

### S-025: Channel Configuration
- WhatsApp Cloud API setup (Phone ID, WABA ID, token)
- Telegram Bot (token, webhook)
- Facebook/Instagram (Page ID, App ID, token)
- Email (SMTP)
- SMS provider
- Channel activation/deactivation

### S-026: Webhook handlers
- Telegram updates handler
- WhatsApp webhook (verify + messages)
- Facebook messenger webhook
- VKontakte updates
- Message routing to inbox

---

## PHASE 4: Support — 5 тикетов

### S-027: Tickets — список, создание, карточка
- Ticket fields (subject, description, priority, status, assignee)
- Status workflow (new → in_progress → waiting → resolved → closed)
- Priority levels (critical, high, medium, low)
- Comments (internal vs external)
- WhatsApp reply integration
- AI assistance (Claude suggestions)
- Satisfaction rating

### S-028: Agent Desktop — KPI и метрики
- Circular gauges (open cases, my cases, avg response, CSAT)
- Priority distribution chart
- Status breakdown
- Agent leaderboard
- Quick ticket access
- SLA compliance tracking
- FCR (First Contact Resolution)

### S-029: SLA Policies — правила и эскалация
- SLA rule creation
- Response time targets
- Resolution time targets
- Priority-based rules
- Escalation on breach
- SLA tracking in tickets

### S-030: Knowledge Base — статьи и поиск
- Article creation (title, body, category)
- Category management
- Full-text search
- Portal integration (customer-facing)
- AI integration (KB articles used in AI responses)

### S-031: Support Calendar
- Agent availability
- Shift management
- Calendar API

---

## PHASE 5: Analytics & Finance — 8 тикетов

### S-032: Profitability — Cost Model Engine
- 6 табов: Analytics, Services, Clients, Overhead, Employees, Parameters
- Analytics tab — KPI cards, cost composition donut, service cost vs revenue bars
- Services tab — service list with costs/margins
- Clients tab — per-client profitability
- Overhead tab — 18 overhead categories
- Employees tab — salary, benefits, allocation
- Parameters tab — pricing parameters

### S-033: Budgeting — Workspace + P&L tabs
- Budget plan creation (annual, quarterly)
- P&L tab — revenue, expenses, margin
- Workspace tab — budget lines by department
- KPI cards (expenses, revenue, margin)
- Execution gauges

### S-034: Budgeting — Waterfall + Matrix + Advanced tabs
- Waterfall analysis chart (variance step-by-step)
- Matrix grid (department × category)
- Forecast tab
- Comparison tab
- Plan-Fact dashboard
- Rolling forecast (13-week)
- ODDS report (optimistic/realistic/pessimistic)

### S-035: Budgeting — Cash Flow + Approvals
- Cash flow projections
- Cash flow alerts (low cash warnings)
- Variance analysis
- Approval workflow (multi-level)
- Department owner access
- Comment history
- Version history + diff + time machine

### S-036: Finance module — A/R, A/P, Funds
- Overview tab — cash flow, revenue trends
- Accounts Receivable — invoice aging, overdue tracking
- Accounts Payable — bill tracking, payment scheduling
- Fund Manager — multi-fund, transactions, allocation rules

### S-037: Dynamic Pricing Engine
- Pricing groups (professional services, infrastructure, etc.)
- Categories per group
- Unit pricing with adjustments
- Interactive sliders (-50% to +50%)
- Per-company pricing profiles
- Real-time calculation
- Won deal / additional sales tracking
- Multi-currency

### S-038: Reports — executive dashboard
- Company/Contact/Deal/Lead/Task/Ticket counts
- Revenue analysis (total, won deals, avg deal size, top companies)
- Pipeline analysis by stage
- Task completion metrics + funnel
- Ticket resolution rate
- Lead conversion funnel (new → contacted → qualified → converted)
- CSAT tracking
- Circular gauges + funnel visualization

### S-039: Sales Forecast
- Forecast configuration
- Trend analysis
- Sales forecast settings page

---

## PHASE 6: AI — 4 тикета

### S-040: AI Command Center — конфигурация
- Model selector (Claude Opus 4.6, Sonnet 4.6, Haiku 4.5)
- Agent configuration constructor
- System prompts, token limits, temperature
- Knowledge base integration (article selection)
- Guardrails engine (prompt injection rules)

### S-041: AI Command Center — sessions и метрики
- Session management, message history
- Interaction logging (latency, tokens, cost)
- Quality scoring (1-10)
- Escalation handling
- Dashboard metrics (sessions, deflection rate, CSAT, FCR, cost)

### S-042: Lead Scoring — dual engine
- AI scoring (Claude API call)
- Rule-based fallback
- Grade system (A/B/C/D/F)
- Score factors (contact completeness, source, engagement, deal potential, recency)
- Conversion probability
- Estimated lead value
- Batch re-scoring
- Score reasoning

### S-043: Portal AI Chat
- Customer-facing chatbot
- Claude integration
- Session tracking
- Auto-escalation to tickets
- Guardrails
- Message logging

---

## PHASE 7: Platform & Config — 10 тикетов

### S-044: Customer Portal — architecture
- Separate auth system
- Portal layout
- Set-password flow
- Portal user management

### S-045: Portal — tickets + KB
- Self-service ticket creation
- Ticket status tracking
- Customer comments
- Public KB browsing
- Article search

### S-046: Settings — Users & Roles
- User management (create, edit, deactivate)
- Role creation with permission matrix
- Module-based permissions
- Default roles

### S-047: Settings — Audit Log
- Full action trail
- User tracking
- Timestamp + change details (before/after)
- Search and filter

### S-048: Settings — Security & 2FA
- Password change
- TOTP setup (QR code, backup codes)
- 2FA verify/disable
- Session management

### S-049: Custom Fields
- Field types (text, number, select, date, etc.)
- Multi-entity (Company, Contact, Deal, Lead)
- Field values storage
- Display in forms

### S-050: Workflows — rule engine
- Triggers (deal stage change, contact creation, ticket creation)
- Actions (create task, send email, update field, notification)
- Multi-action chains
- Conditional execution

### S-051: Lead Rules + Web-to-Lead
- Auto-assignment rules
- Lead distribution logic
- Public lead capture form
- Auto-create leads from web

### S-052: Currencies + SMTP + Dashboard Config
- Currency management, FX rates, history
- SMTP config, test email
- Dashboard widget layout customization

### S-053: Billing & Plan Gating
- Plan tiers (Starter, Business, Professional, Enterprise)
- Module access per plan
- Feature limits
- Upgrade flow
- Middleware plan-gating logic

---

## PHASE 8: Infrastructure — 5 тикетов

### S-054: Prisma Schema — все модели
- 94+ моделей
- Связи между моделями
- Уникальные constraints
- Индексы
- Multi-tenant (organizationId на каждой таблице)

### S-055: Middleware — auth, plan-gating, locale
- Public paths
- Auth check flow
- Plan module gating (canAccessModule)
- Locale injection from cookie
- Admin-only routes

### S-056: API Routes — обзор всех 167+ endpoints
- CRUD endpoints
- Complex operations (lead conversion, invoice PDF, campaign send)
- Public endpoints (web-to-lead, event registration, portal)
- Integration endpoints (webhooks, calendar feed)

### S-057: i18n — 3 языка
- Translation key structure
- Coverage по модулям (en, ru, az)
- Language switcher logic
- Hints system

### S-058: Deployment & Scripts
- Standalone build
- PM2 config
- Nginx setup
- Deploy script
- Import scripts (v1→v2)
- Screenshot capture script

---

## Итого: 58 атомарных тикетов

| Phase | Тикетов | Описание |
|-------|---------|----------|
| 1. CRM Sales | 15 | Dashboard, Companies, Contacts, Deals, Leads, Tasks, Contracts, Invoices, Offers |
| 2. Marketing | 8 | Campaigns, Segments, Journeys, Templates, Events |
| 3. Communication | 3 | Inbox, Channels, Webhooks |
| 4. Support | 5 | Tickets, Agent Desktop, SLA, KB, Calendar |
| 5. Analytics | 8 | Profitability, Budgeting, Finance, Pricing, Reports, Forecast |
| 6. AI | 4 | Command Center, Lead Scoring, Portal Chat |
| 7. Platform | 10 | Portal, Settings, Roles, Audit, Security, Custom Fields, Workflows |
| 8. Infrastructure | 5 | Schema, Middleware, API, i18n, Deploy |
| **Всего** | **58** | |
