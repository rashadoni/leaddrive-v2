# LeadDrive CRM v2 — Complete Deep Study

> Generated: March 27, 2026
> Purpose: Full technical audit of every module, feature, API, and data model

---

## Table of Contents
1. [Dashboard (Executive Panel)](#1-dashboard)
2. [Companies](#2-companies)
3. [Contacts](#3-contacts)
4. [Deals (Pipeline)](#4-deals)
5. [Leads](#5-leads)
6. [Tasks](#6-tasks)
7. [Contracts](#7-contracts)
8. [Invoices](#8-invoices)
9. [Offers & Products](#9-offers--products)
10. [Campaigns](#10-campaigns)
11. [Segments](#11-segments)
12. [Journeys](#12-journeys)
13. [Email Templates](#13-email-templates)
14. [Email Log](#14-email-log)
15. [Events](#15-events)
16. [Inbox (7-Channel)](#16-inbox)
17. [Channel Configuration](#17-channel-configuration)
18. [Webhooks](#18-webhooks)
19. [Tickets](#19-tickets)
20. [Agent Desktop](#20-agent-desktop)
21. [SLA Policies](#21-sla-policies)
22. [Knowledge Base](#22-knowledge-base)
23. [Da Vinci Command Center](#23-ai-command-center)
24. [Da Vinci Ticket Copilot](#24-ai-ticket-copilot)
25. [Da Vinci Lead Scoring](#25-ai-lead-scoring)
26. [Da Vinci General Chat](#26-ai-general-chat)
27. [Da Vinci Financial Analysis](#27-ai-financial-analysis)
28. [Da Vinci Guardrails](#28-ai-guardrails)
29. [Profitability (Cost Model)](#29-profitability)
30. [Budgeting](#30-budgeting)
31. [Finance Module](#31-finance)
32. [Dynamic Pricing Engine](#32-pricing-engine)
33. [Reports](#33-reports)
34. [Sales Forecast](#34-sales-forecast)
35. [Customer Portal](#35-portal)
36. [Users & Roles](#36-users--roles)
37. [Audit Log](#37-audit-log)
38. [Security & 2FA](#38-security--2fa)
39. [Custom Fields](#39-custom-fields)
40. [Workflows](#40-workflows)
41. [Lead Rules & Web-to-Lead](#41-lead-rules)
42. [Currencies, SMTP, Dashboard Config](#42-currencies-smtp-dashboard)
43. [Billing & Plan Gating](#43-billing--plan-gating)
44. [Prisma Schema](#44-prisma-schema)
45. [Middleware & Auth](#45-middleware--auth)
46. [i18n](#46-i18n)
47. [API Routes Overview](#47-api-routes)

---

## 1. Dashboard

**Files:** `src/app/(dashboard)/page.tsx`, `src/app/api/v1/dashboard/executive/route.ts`, `src/app/api/v1/dashboard/widget-config/route.ts`

### KPI Cards
| Metric | Source | Calculation |
|--------|--------|-------------|
| Monthly Revenue | Cost model `loadAndCompute()` | Aggregate `ClientService.monthlyRevenue` |
| Pipeline Value | `Deal.aggregate` | Sum `valueAmount` where stage NOT IN [WON, LOST] |
| Total Clients | `Company.count` | Where `category = "client"` |
| Open Tickets | `Ticket.count` | Where status IN [new, in_progress, waiting] |

### Da Vinci Risk Alerts (5 types)
1. **Low Margin** — Trigger: `marginPct < 5%` AND `totalRevenue > 0`. Target: 15%
2. **Unprofitable Clients** — Trigger: `lossClients > profitableClients * 0.5`
3. **SLA Breached** — Trigger: tickets where `slaDueAt < now` AND status IN [new, in_progress, waiting]
4. **Overdue Tasks** — Trigger: tasks with `status != completed` AND `dueDate < now` > 3
5. **At-Risk Deals** — Trigger: deals with predictive score < 40%. Formula: `predictive = (confidenceLevel * 0.85) + (stageProbability * 0.15)`

### Revenue by Service Chart
- Source: `prisma.clientService.groupBy` by `serviceType`
- 7 service types: permanent_it, infosec, erp, grc, projects, helpdesk, cloud
- Horizontal bar chart sorted by revenue DESC

### Sales Pipeline Funnel
- Stages: LEAD(10%) → QUALIFIED(20%) → PROPOSAL(50%) → NEGOTIATION(75%) → WON(100%) / LOST(0%)
- Deals grouped by stage with `_count` and `_sum { valueAmount }`

### Recent Activities
- Last 8 activities ordered by `createdAt DESC`
- Types: call(📞), email(📧), meeting(🤝), note(📝), task(✅)
- Relations: contact, company, deal, ticket

### Sales Forecast
- Last 6 months actual + next 6 months projected
- Formula: `projected = avgMonthly + (pipelineVal/6) * (1 - i*0.1)`

### Client Health
- Profitable / Loss-making / No Revenue breakdown
- Top 5 clients by revenue with margin %

---

## 2. Companies

**Files:** `src/app/(dashboard)/companies/page.tsx`, `src/app/(dashboard)/companies/[id]/page.tsx`, `src/app/api/v1/companies/route.ts`

### Model Fields
`id, organizationId, name, industry, website, phone, email, address, city, country, employeeCount, annualRevenue, description, status, category, leadStatus, leadScore, leadTemperature, userCount, costCode, voen, slaPolicyId`

### List View
- Columns: Name, Industry, Status badge, Lead Temperature (hot/warm/cold), Contact Count, Deals Count
- Filters: Status (active/prospect/inactive), Lead Temperature
- Stats Cards: Total, Active, Total Contacts, Total Users

### Detail Tabs (5)
1. **Overview** — company info, metrics, custom fields, SLA policy
2. **Contacts** — linked contacts with portal access status
3. **Deals** — deals by stage with value
4. **Activities** — timeline (calls, emails, meetings, notes, tasks)
5. **Invoices** — by status (draft/sent/paid/overdue)

### Custom Fields Support
- Defined via `CustomField` model (entityType = "company")
- Values in `CustomFieldValue` table (entityId = companyId)

---

## 3. Contacts

**Files:** `src/app/(dashboard)/contacts/page.tsx`, `src/app/(dashboard)/contacts/[id]/page.tsx`, `src/app/api/v1/contacts/route.ts`

### Model Fields
`id, organizationId, companyId, fullName, email, phone, phones[], position, department, avatar, source, tags[], isActive, lastContactAt, portalPasswordHash, portalAccessEnabled, portalVerificationToken, portalVerificationExpires`

### Features
- Pagination: 20/page, bulk selection, bulk delete (`/api/v1/contacts/bulk-delete`)
- Search: fullName, email, phone, company name
- Source tracking: website, referral, cold_call, linkedin, email
- Portal access fields: `portalAccessEnabled`, `portalPasswordHash`, `portalLastLoginAt`

---

## 4. Deals

**Files:** `src/app/(dashboard)/deals/page.tsx`, `src/components/deals/kanban-board.tsx`, `src/app/(dashboard)/deals/[id]/page.tsx`

### Pipeline Stages
LEAD(10%) → QUALIFIED(20%) → PROPOSAL(50%) → NEGOTIATION(75%) → WON(100%) / LOST(0%)

### Kanban Board
- Drag-and-drop between columns
- Cards: deal name, company, value, assigned user, probability
- Stage change updates `stageChangedAt`, auto-adjusts probability

### Detail Tabs (9)
1. **Overview** — stage chevron, value, KPIs (days in funnel, days at stage, confidence)
2. **Activities** — timeline of calls/emails/meetings
3. **Engagement** — stakeholder influence mapping via DealContactRole
4. **Products/Services** — from related Offer items
5. **Offers** — status (draft/sent/approved/rejected)
6. **Contact Roles** — influence (Low/Med/High), decision factors, loyalty (Detractor/Neutral/Promoter)
7. **Invoices** — linked invoice status
8. **Next Steps** — follow-ups, milestones
9. **Next Best Offers** — Da Vinci recommendations via Claude API

### Team Members
- `DealTeamMember` junction: dealId, userId, role (owner/member)

### Contact Roles
- `DealContactRole`: contactId, role, influence, decisionFactor, loyalty, isPrimary
- Decision factors: Product, Price, Service, Support, Ease of Use, Stability, Vendor

### Confidence Level
- Separate from stage probability
- Used in at-risk detection: `predictive = confidence * 0.85 + probability * 0.15`

---

## 5. Leads

**Files:** `src/app/(dashboard)/leads/page.tsx`, `src/app/api/v1/leads/route.ts`, `src/app/api/v1/leads/[id]/convert/route.ts`

### Statuses
new → contacted → qualified → converted / lost

### Scoring (0-100)
- Grade: A(80-100), B(60-79), C(40-59), D(20-39), F(0-19)
- `scoreDetails` JSON: factors, conversionProb, grade, reasoning, aiPowered flag
- See [Da Vinci Lead Scoring](#25-ai-lead-scoring) for full details

### Conversion Flow
- POST `/api/v1/leads/{id}/convert`
- Creates: Contact + Deal in single transaction
- Sets: `Lead.status = "converted"`, `convertedAt = now()`

---

## 6. Tasks

**Files:** `src/app/(dashboard)/tasks/page.tsx`, `src/app/api/v1/tasks/route.ts`, `src/app/api/v1/tasks/calendar/route.ts`

### Model
`id, organizationId, title, description, status(pending/in_progress/completed/cancelled), priority(low/medium/high/urgent), dueDate, assignedTo, relatedType, relatedId, completedAt, createdBy`

### Views
1. **List** — filters by status/priority/assignee, overdue highlighting
2. **Kanban** — columns: Pending, In Progress, Completed, Cancelled
3. **Calendar** — month view with color coding by priority

### Calendar Integration
- iCalendar feed: `/api/v1/calendar/feed/[token]`
- Token-based public access for Google Calendar/Outlook subscriptions

---

## 7. Contracts

**Files:** `src/app/(dashboard)/contracts/page.tsx`, `src/app/(dashboard)/contracts/[id]/page.tsx`

### Model
`id, organizationId, contractNumber, companyId, title, type, status, startDate, endDate, valueAmount, currency, notes`

### Types
service_agreement, nda, maintenance, license, sla, other

### Statuses
draft → sent → signed → active → expiring → expired → renewed

### File Management
- `ContractFile`: fileName, originalName, fileSize, mimeType
- Upload/download via `/api/v1/contracts/{id}/files`
- Auto-flag "expiring" if endDate within 30 days

---

## 8. Invoices

**Files:** `src/app/(dashboard)/invoices/page.tsx`, `create/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `recurring/page.tsx`

### Status Lifecycle
```
draft → sent → viewed → partially_paid → paid
              → overdue → paid (late)
              → cancelled → refunded
```

### Financial Calculations
```
subtotal = SUM(qty * unitPrice - discount)
discountAmount = percentage ? subtotal * rate/100 : fixed
taxAmount = (subtotal - discountAmount) * taxRate/100
totalAmount = subtotal - discountAmount + taxAmount
balanceDue = totalAmount - paidAmount
```

### Custom Columns
- `customColumns` JSON: `[{ key: "unit", label: "Ölçü vahidi" }]`
- Per-invoice dynamic line item columns (Azerbaijan tax requirements)

### Recurring Invoices
- Frequency: monthly/quarterly/yearly, dayOfMonth trigger
- `autoSend` flag, `maxOccurrences` limit
- Title template: `"IT Хидмәтләри — {month} {year}"`

### Invoice Chain (Journey)
- `chainJourneyId` — dedicated Journey for automatic payment reminders
- Tracks engagement (open, click, payment)

### Act (Акт) Generation
- Azerbaijan-specific: Act of Work Completion
- POST `/api/v1/invoices/{id}/act` → PDF

### Payment Tracking
- Multiple `InvoicePayment` records per invoice
- Methods: bank_transfer, cash, card, check
- Auto-status: balanceDue = 0 → "paid", > 0 → "partially_paid"

### Public View
- `viewToken`: unique shareable link at `/portal/invoices/{token}`

---

## 9. Offers & Products

**Files:** `src/app/(dashboard)/offers/page.tsx`, `src/app/(dashboard)/products/page.tsx`

### Offer Types
commercial, invoice, equipment, services

### Offer → Invoice Conversion
- POST `/api/v1/invoices/from-offer?offerId={id}`
- Copies items, preserves company/contact/deal links

### Products Catalog
- Fields: name, description, category (service/product/addon/consulting), price, features[], tags[]

---

## 10. Campaigns

**Files:** `src/app/(dashboard)/campaigns/page.tsx`, `src/components/campaign-form.tsx`, `src/app/api/v1/campaigns/[id]/send/route.ts`

### Recipient Modes (6)
- `all` — all contacts + leads
- `contacts` — only contacts
- `leads` — only leads
- `segment` — dynamic/static segment
- `source` — by contact source
- `manual` — hand-picked

### Tracking Metrics
totalRecipients, totalSent, totalOpened, totalClicked, totalBounced, totalUnsubscribed, totalSpam

### Lifecycle
Draft → Scheduled → Sending → Sent (read-only with stats)

---

## 11. Segments

**Files:** `src/app/(dashboard)/segments/page.tsx`, `src/lib/segment-conditions.ts`

### Condition Operators
| Field | Operator |
|-------|----------|
| company | contains (insensitive) |
| source | equals (website/referral/cold_call/email/social/event) |
| role/position | contains |
| tag | has (array) |
| createdAfter/Before | gte/lte date |
| hasEmail/hasPhone | not null |

### Types
- **Dynamic** — auto-updating contact count
- **Static** — fixed set at creation

### Preview API
POST `/api/v1/segments/preview` → real-time count estimation

---

## 12. Journeys

**Files:** `src/app/(dashboard)/journeys/page.tsx`, `src/lib/journey-engine.ts`

### Trigger Types
lead_created, contact_created, deal_stage_change, manual

### Step Types (8)
| Type | Config |
|------|--------|
| send_email | subject, body |
| send_sms | message |
| send_telegram | message, chatId (HTML support) |
| send_whatsapp | message (template) |
| wait | days, unit (minutes/hours/days/weeks) |
| condition | field, operator, value → yesNextStep / noNextStep |
| create_task | title, description, dueDate |
| update_field | field, value |

### Template Variables
`{{contact_name}}`, `{{company_name}}`, `{{email}}`, `{{phone}}`, `{{invoice_number}}`, `{{amount}}`, `{{due_date}}`, `{{balance_due}}`, `{{invoice_url}}`

### Statistics
entryCount, activeCount, completedCount, conversionCount, per-step statsEntered/statsCompleted

---

## 13. Email Templates

**Files:** `src/app/(dashboard)/email-templates/page.tsx`

### Categories
general, welcome, onboarding, notification, marketing, follow_up, proposal

### Languages
az (🇦🇿), ru (🇷🇺), en (🇬🇧)

### Features
HTML + plain text body, dynamic variables, active/inactive toggle

---

## 14. Email Log

**Files:** `src/app/(dashboard)/email-log/page.tsx`

### Model
`direction (outbound/inbound), fromEmail, toEmail, subject, body, status (pending/sent/delivered/failed/bounced), errorMessage, campaignId, templateId`

### Stats
Total emails, Outbound, Inbound, Sent, Failed, Bounced

---

## 15. Events

**Files:** `src/app/(dashboard)/events/page.tsx`, `src/app/api/v1/public/events/[id]/register/route.ts`

### Event Lifecycle
Planned → Registration Open → In Progress → Completed / Cancelled

### Public Registration
- No auth required: GET/POST `/api/v1/public/events/{id}/register`
- Auto-create/link contact by email
- Sends confirmation email with `.ics` calendar attachment
- Duplicate prevention by email

### Participant Roles
attendee, speaker, sponsor, organizer, vip

### Participant Statuses
registered, confirmed, attended, cancelled, no_show

---

## 16. Inbox (7-Channel)

**Files:** `src/app/(dashboard)/inbox/page.tsx`, `src/app/api/v1/inbox/route.ts`

### Channels
Email, Telegram, SMS, WhatsApp, Facebook, Instagram, VKontakte

### Features
- Unified thread view grouped by contact
- Contact auto-resolution from email/phone/chatId
- Reply via same or different channel
- Compose new message with contact picker
- Auto-polling every 5 seconds
- Media support: text, image, video, audio, document

### Models
- `ChannelMessage`: direction, channelType, contactId, body, mediaUrl, messageType
- `SocialConversation`: platform, contactName, unreadCount, lastMessage, assignedTo

---

## 17. Channel Configuration

**Files:** `src/app/(dashboard)/settings/channels/page.tsx`

| Channel | Required Fields |
|---------|----------------|
| Telegram | botToken |
| WhatsApp | apiKey (Bearer), phoneNumber (phone_number_id) |
| SMS | settings: `{ smsProvider, <provider-specific non-secrets> }` + `apiKey` column = provider secret (masked on GET) |
| Email | SMTP settings |
| Facebook | appId, appSecret, pageId |
| Instagram | appId, appSecret, pageId |
| VKontakte | botToken, appId |

---

## 18. Webhooks

**Files:** `src/app/api/v1/webhooks/{telegram,whatsapp,facebook,vkontakte}/route.ts`

### Telegram
- Finds ChannelConfig by botToken
- Extracts chatId, message text, sender name
- Contact matching: previous chatId → username fallback
- Creates ChannelMessage + upserts SocialConversation

### WhatsApp
- GET verification (hub.challenge)
- Handles: text, image, video, audio, document, sticker, location
- Status updates: sent → delivered → read
- **Da Vinci Auto-Reply**: Claude responds, KB context, escalation detection ([ESCALATE] marker)
- **Auto-Reopen Tickets**: closed tickets reopen within 7 days
- **Session memory**: 1-hour conversation context

### Facebook & VKontakte
- Similar message handling, postback support (Facebook)

---

## 19. Tickets

**Files:** `src/app/(dashboard)/tickets/page.tsx`, `src/app/(dashboard)/tickets/[id]/page.tsx`

### Model
`ticketNumber (TK-XXXX auto-sequential), subject, description, priority (low/medium/high/critical), status (new/open/in_progress/waiting/resolved/closed), category (general/technical/billing/feature_request), contactId, companyId, assignedTo`

### SLA Fields
`slaDueAt, slaFirstResponseDueAt, slaPolicyName, firstResponseAt, resolvedAt, closedAt`

### Satisfaction
`satisfactionRating (0-5), satisfactionComment`

### Comments
- `TicketComment`: comment, isInternal (agent-only vs customer-visible)

### SLA Calculation on Create
1. Check company SLA policy
2. Fallback to priority-based SLA
3. `slaDueAt = now + resolutionHours`, `slaFirstResponseDueAt = now + firstResponseHours`

### SLA Status
- none (no SLA), done (resolved/closed), breached (due < now), warning (< 2h remaining), ok

### List Features
- Auto-refresh every 20 seconds
- Status filter tabs
- SLA countdown with colored indicators

---

## 20. Agent Desktop

**Files:** `src/app/(dashboard)/support/agent-desktop/page.tsx`

### KPI Cards (4)
Open Cases, My Cases, Avg Response (2h 15m mock), CSAT (avg rating × 20)

### Team KPIs (SVG Circular Gauges)
- Resolved % (green)
- SLA Compliance % (indigo, 85% mock)
- CSAT % (amber)
- Open by Priority breakdown

### Agent Leaderboard
Rank with medals (#1-5), resolved count, avg time, CSAT %

---

## 21. SLA Policies

**Files:** `src/components/sla-policy-form.tsx`

### Model
`name, priority, firstResponseHours (default 4), resolutionHours (default 24), businessHoursOnly, isActive, isDefault`

### Application Logic
1. Company-specific SLA (Company.slaPolicy)
2. Priority-based fallback
3. `firstResponseAt` set on first non-internal comment

---

## 22. Knowledge Base

**Files:** `src/app/(dashboard)/knowledge-base/page.tsx`

### Model
`title, content (markdown/HTML), categoryId, status (draft/published), viewCount, helpfulCount, tags[]`

### Categories
general, technical, billing, faq, onboarding, api, security, uncategorized

### Portal Integration
- Only "published" articles shown to portal users
- View counts tracked per article
- Used in Da Vinci responses (KB context injection)

---

## 23. Da Vinci Command Center

**Files:** `src/app/api/v1/ai-configs/route.ts`, `src/components/ai-config-form.tsx`

### AiAgentConfig Model
`configName, model (default: claude-haiku-4-5-20251001), maxTokens (1024), temperature (1.0), systemPrompt, toolsEnabled[], escalationEnabled, escalationRules[], kbEnabled, kbMaxArticles (3), isActive, version`

### Models Supported
- claude-haiku-4-5-20251001 (tickets, scoring, financial analysis)
- claude-sonnet-4-20250514 (general chat)

### Token Pricing (Haiku)
prompt: $0.00025/1K tokens, completion: $0.00125/1K tokens

### Interaction Logging
`AiInteractionLog`: sessionId, userMessage, aiResponse, latencyMs, promptTokens, completionTokens, costUsd, model, toolsCalled[], kbArticlesUsed[], qualityScore, isCopilot

---

## 24. Da Vinci Ticket Copilot

**Files:** `src/app/api/v1/tickets/ai/route.ts`

### Actions (3)
1. **reply** — Da Vinci reply generation with KB context
2. **summary** — 2-3 sentence ticket summary
3. **steps** — 3-5 concrete resolution steps

### KB Integration
- Keyword search: split query > 3 chars, search title + content
- Top 3 published articles injected into system prompt
- UI shows `kbUsed: true` flag

### Language Support
ru → RUSSIAN, az → AZERBAIJANI, en → ENGLISH (forced in system prompt)

### Fallback
If no ANTHROPIC_API_KEY: static templates with KB article titles

---

## 25. Da Vinci Lead Scoring

**Files:** `src/app/(dashboard)/ai-scoring/page.tsx`, `src/app/api/v1/lead-scoring/route.ts`

### Rule-Based Scoring (Fallback)
| Factor | Points |
|--------|--------|
| Email present | +15 |
| Phone present | +10 |
| Company name | +10 |
| Source: referral | +20 |
| Source: website | +15 |
| Priority: high | +15 |
| Has estimated value | +10 |
| Status: converted | +20 |
| Notes present | +5 |
ConversionProb = score × 0.85

### Da Vinci Scoring (Claude Sonnet)
- Context: lead fields + last 10 activities + 5 related deals
- Output: score (0-100), conversionProb, factors breakdown, reasoning
- Grade: A(80+), B(60+), C(40+), D(20+), F(0-19)

### UI
- Grade distribution cards (A/B/C/D/F with counts)
- Summary bar: avg score, avg conversion, total scored
- "Da Vinci" badge when Da Vinci-powered
- Per-lead re-score + batch re-score

---

## 26. Da Vinci General Chat

**Files:** `src/app/api/v1/ai/chat/route.ts`

### Input
message, context (page URL), history (previous messages), locale

### Process
1. Gather: deal count, company count, ticket count, lead count
2. Build pipeline summary by stage
3. Count open tickets by status
4. Call Claude Sonnet with CRM overview
5. Force language via locale

---

## 27. Da Vinci Financial Analysis

**Files:** `src/app/api/v1/ai-observations/route.ts`

### Tabs Supported
analytics, services, clients, overhead

### Output
JSON array: `[{ type: insight|warning|opportunity, title, description }]`

---

## 28. Da Vinci Guardrails

**Files:** `src/app/api/v1/ai-guardrails/route.ts`

### Model
`ruleName, ruleType (restriction/filter/validation), description, promptInjection (pattern), isActive`

---

## 29. Profitability (Cost Model)

**Files:** `src/app/(dashboard)/profitability/page.tsx`, `src/lib/cost-model/compute.ts`, `src/lib/cost-model/types.ts`

### 6 Tabs
1. **Analytics** — KPI cards, pie chart (cost composition), bar chart (service cost vs revenue)
2. **Services** — 8 service cards with margin %, staff, clients
3. **Clients** — sortable profitability table (revenue, cost, margin, status)
4. **Overhead** — CRUD for 18 categories with VAT/amortization
5. **Employees** — by department (7 depts), per-position salary tiers
6. **Parameters** — 11 editable settings (users, tax rates, allocation ratios)

### 18 Overhead Categories
cloud_servers, office_rent, insurance, mobile, ms_license, cortex, palo_alto, pam, lms, trainings, ai_licenses, car_amort, car_expenses, firewall_amort, laptops, internet, team_building, waf_service

### 7 Departments
IT, InfoSec, ERP, GRC, PM, HelpDesk, BackOffice

### 8 Service Types
permanent_it, infosec, erp, grc, projects, helpdesk, cloud, waf

### 6-Stage Computation
1. Parse overhead (18 categories → monthly with VAT + amortization)
2. Employee costs by dept (net → gross 14% → superGross 17.5%)
3. Section F (Admin + Tech + Direct Labor, excludes GRC overhead)
4. Section G (Section F + GRC direct)
5. Service allocation (proportional by headcount)
6. Per-client profitability (PricingProfile revenue vs allocated costs)

### Client Margin Statuses
good (margin > 15%), low (0-15%), loss (< 0%), no_revenue

---

## 30. Budgeting

**Files:** `src/app/(dashboard)/budgeting/page.tsx` (4100+ lines), `src/lib/budgeting/hooks.ts` (34 functions)

### 11 Tabs
1. **Workspace** — plan selector + quick add
2. **P&L** — revenue/COGS/expense with KPI cards + execution gauges
3. **Forecast** — forecasted vs planned with variance
4. **Comparison** — 3-way: Planned vs Forecast vs Actual
5. **Plans** — CRUD for budget plans
6. **Sales Forecast** — 12-month grid by department
7. **Expense Forecast** — expense projections by category
8. **Integrations (CSV)** — import/export
9. **Rolling Forecast** — 12-month rolling with close/reopen
10. **Cash Flow** — daily/weekly projections + ODDS report
11. **Configuration** — departments, cost types, access control

### Budget Plan Statuses (9)
draft, pending_approval, approved, rejected, closed + amendment chains

### Default Categories
- Expense (11): Salaries, Back-office, IT infra, Overhead, Risk, Travel, Marketing, Office rent, Software, Commanding, GRC
- Revenue (6): Service revenue, Daimi IT, InfoSec, ERP, HelpDesk, Other

### Key Features
- **Auto-Planned**: lines linked to cost model keys compute automatically
- **Auto-Actual**: pulls monthly cost from cost model × elapsed months
- **Version Control**: snapshots, diff viewer, amendment chains
- **Approval Workflow**: multi-level via BudgetDepartmentOwner
- **ODDS Report**: Optimistic/Realistic/Pessimistic 3-scenario sensitivity
- **Cash Flow Alerts**: low cash balance warnings
- **Da Vinci Narrative**: Claude-generated budget commentary
- **Department Access Control**: owners see only their data

### 45 API Endpoints
Plans CRUD, Lines CRUD, Analytics, Actuals, Sync, Versions, Diff, CSV Import, Rolling Forecast, Cash Flow, ODDS, Comments, Departments, Cost Types

---

## 31. Finance Module

**Files:** `src/app/(dashboard)/finance/page.tsx`, `src/components/finance/*`

### 4 Tabs
1. **Overview** — KPIs (6), revenue trend, expense breakdown, A/R aging, cash flow projection, alerts
2. **A/R** — invoice aging buckets (current/30/60/90+ days), top debtors, overdue invoices
3. **A/P** — bill tracking, payment scheduling, top vendors
4. **Funds** — multi-fund dashboard, transactions, allocation rules

### Fund Manager Features
- Create/edit/delete funds with target amounts
- Transaction types: deposit, withdrawal, transfer, auto-allocation
- Allocation rules: trigger-based (% or fixed amount)
- Balance tracking: current vs target progress

### Alert Types
overdue_invoice, low_cash, budget_overspend, upcoming_payment

---

## 32. Dynamic Pricing Engine

**Files:** `src/app/(dashboard)/pricing/page.tsx`, `src/lib/pricing.ts`

### 3 Tabs
1. **Model** — pricing matrix (companies × categories), interactive sliders (-50% to +50%)
2. **Edit** — per-company price overrides
3. **Sales** — additional sales tracking, won deal integration

### Constants
- 7 company groups, 7 board categories, maps to 11 internal categories
- Date-based adjustments: global/group/category/company levels
- Multi-currency support
- Excel export with 3 format options

---

## 33. Reports

**Files:** `src/app/(dashboard)/reports/page.tsx` (587 lines)

### 12 Report Panels
1. Financial Overview (won revenue, contracts, pipeline)
2. Deal Pipeline (by stage with values)
3. Lead Funnel (pyramid: new → contacted → qualified → converted)
4. Task Summary (circular gauge, overdue count)
5. Top Clients (revenue ranking)
6. Sales Forecast (6-month projection)
7. Ticket SLA (resolution gauge)
8. Lead Conversion (rate %)
9. CSAT (average + distribution 1-5)
10. Deal Revenue (won count + avg size)
11. Overview Stats (6-card: companies, contacts, deals, leads, tasks, tickets)

### Custom Visualizations
- `CircularGauge()`: SVG radial progress
- `FunnelPyramid()`: lead conversion with drop-off %

---

## 34. Sales Forecast

**Files:** `src/app/(dashboard)/settings/sales-forecast/page.tsx`

### Features
- 12-month grid (departments × months)
- Only revenue-enabled departments
- VAT toggle (store netto, display with/without 18%)
- Excel import/export
- Year selector (2025-2028)

---

## 35. Customer Portal

**Files:** `src/app/portal/*`

### Auth System
- Separate from dashboard (localStorage-based)
- Login, Register, Set-Password (token validation)
- Contact model: portalAccessEnabled, portalPasswordHash

### Pages
- **Tickets**: list, create, search, detail with comments
- **Knowledge Base**: published articles, category browsing
- **Da Vinci Chat**: Claude integration, auto-escalation to ticket, session tracking
- **Chat Widget**: embedded in portal layout

### Public API
`/api/v1/public/portal-auth`, `/portal-tickets`, `/portal-kb`, `/portal-chat`

---

## 36. Users & Roles

**Files:** `src/app/(dashboard)/settings/users/page.tsx`, `src/app/(dashboard)/settings/roles/page.tsx`

### User Model
`email, name, passwordHash, role, phone, department, totpSecret, totpEnabled, require2fa, backupCodes, lastLogin, loginCount, isActive`

### Roles
System: admin, manager, sales, support, viewer + custom roles (12 colors)

### Permission Matrix
12 modules × 4 access levels (full/edit/view/none)

### Modules
companies, contacts, deals, leads, tasks, tickets, contracts, offers, campaigns, reports, ai, settings

---

## 37. Audit Log

**Files:** `src/app/(dashboard)/settings/audit-log/page.tsx`

### Model
`userId, action (create/update/delete/login/export), entityType, entityId, entityName, oldValue (JSON), newValue (JSON), ipAddress, userAgent`

### Logging Utility
`logAudit(orgId, action, entityType, entityId, entityName, { oldValue, newValue })` in `src/lib/prisma.ts`

---

## 38. Security & 2FA

**Files:** `src/app/(dashboard)/settings/security/page.tsx`

### TOTP Implementation
- Algorithm: TOTP via `otplib`
- QR code + manual secret entry
- 10 single-use backup codes
- Disable requires code verification

### Auth Flow
- `totpEnabled && !totpCode` → "2FA_REQUIRED"
- Verify: `verifySync({ token, secret })` or check backup codes
- Middleware: `needs2fa=true` → redirect `/login/verify-2fa`
- Admin can force: `require2fa`, reset TOTP

---

## 39. Custom Fields

**Files:** `src/app/(dashboard)/settings/custom-fields/page.tsx`

### Field Types (13)
text, textarea, number, decimal, date, datetime, select, multiselect, checkbox, email, url, phone, currency

### Multi-Entity
Supported on: Company, Contact, Deal, Ticket, etc.

### Storage
- `CustomField`: entityType, fieldName, fieldType, label, options (JSON), required, order
- `CustomFieldValue`: customFieldId, entityId, value

---

## 40. Workflows

**Files:** `src/app/(dashboard)/settings/workflows/page.tsx`

### Trigger Events
- Deal: created, updated, status_changed, stage_changed, assigned
- Lead: created, qualified, converted
- Contact: created, company_changed
- Ticket: created, status_changed, assigned
- Task: created, assigned, completed
- Company: created, status_changed

### Action Types (7)
send_email, create_task, update_field, send_notification, auto_assign, webhook, notify

### Multi-Action Chains
Sequential execution with `actionOrder`, conditions (future)

---

## 41. Lead Rules & Web-to-Lead

**Files:** `src/app/(dashboard)/settings/lead-rules/page.tsx`, `src/app/(dashboard)/settings/web-to-lead/page.tsx`

### Lead Rules
Route by source, attributes, round-robin or specific team member

### Web-to-Lead
- Generates embeddable HTML form
- Customizable fields, redirect URL
- POST `/api/v1/public/leads` (no auth)
- Auto-creates Lead + Contact

---

## 42. Currencies, SMTP, Dashboard Config

### Currencies
- Code, name, symbol, exchange rate, isBase flag
- CurrencyRateHistory for historical tracking

### SMTP
- Presets: Gmail, Yandex, Mail.ru, Outlook
- Test email functionality
- Stored in Organization.settings JSON

### Dashboard Config
9 toggleable widgets: statCards, revenueChart, dealPipeline, forecast, clientHealth, activityFeed, taskSummary, ticketSummary, leadFunnel

---

## 43. Billing & Plan Gating

**Files:** `src/lib/plan-config.ts`, `src/app/(dashboard)/settings/billing/page.tsx`

### Plan Tiers
| Plan | Price | Users | Contacts |
|------|-------|-------|----------|
| Starter | $29/mo | 3 | 500 |
| Business | $79/mo | 10 | 2,000 |
| Professional | $199/mo | 25 | 10,000 |
| Enterprise | Custom | Unlimited | Unlimited |

### Always Accessible
`/`, `/dashboard`, `/settings`, `/settings/billing`, `/settings/security`, `/settings/users`, `/settings/audit-log`, `/notifications`, `/ai-command-center`

### Middleware
`canAccessModule(plan, pathname)` → redirect to `/settings/billing?upgrade=true`

---

## 44. Prisma Schema

**File:** `prisma/schema.prisma` (2,218 lines)

### 98 Models Total

#### Categories
- Core CRM: Organization, User, Company, Contact, Deal, Lead, Task
- Support: Ticket, TicketComment, SlaPolicy, KbArticle, KbCategory
- Marketing: Campaign, EmailTemplate, ContactSegment, Journey, Event
- AI: AiAgentConfig, AiChatSession, AiChatMessage, AiAlert, AiInteractionLog, AiGuardrail
- Communication: ChannelConfig, ChannelMessage, EmailLog, SocialConversation
- Finance: Invoice, InvoiceItem, InvoicePayment, RecurringInvoice, Bill, BillPayment, Fund
- Cost Model: CostEmployee, CostModelSnapshot, OverheadCost, PricingParameters
- Budgeting: BudgetPlan, BudgetLine, BudgetActual, BudgetSection, CashFlowEntry
- Pricing: PricingGroup, PricingProfile, PricingCategory, PricingService
- Platform: WorkflowRule, CustomField, DashboardLayout, AuditLog, Currency

### Multi-Tenant Pattern
ALL models have `organizationId` field with indexes

---

## 45. Middleware & Auth

**Files:** `src/middleware.ts`, `src/lib/auth.ts`

### NextAuth.js v5
- Provider: Credentials (email + password)
- Strategy: JWT + Session
- bcrypt password hashing
- 2FA: TOTP verification + backup codes

### Middleware Flow
1. Public paths → pass through
2. Unauthenticated → redirect to login
3. 2FA check → redirect to verify/setup
4. Inject headers: x-organization-id, x-user-id, x-user-role, x-locale
5. Admin-only: /settings/* requires role=admin
6. Plan gating: canAccessModule check

---

## 46. i18n

**Files:** `messages/en.json`, `messages/ru.json`, `messages/az.json`

### Coverage
- Russian: 153 KB (2400+ keys)
- English: 108 KB (2300+ keys)
- Azerbaijani: 118 KB (2200+ keys)

### Namespaces
common, dashboard, companies, contacts, deals, leads, tasks, tickets, kb, campaigns, segments, settings, billing, security, workflows, ai, portal, reports, finance, budgeting

### Usage
`const t = useTranslations("namespace")` via next-intl library
Locale from `NEXT_LOCALE` cookie → middleware `x-locale` header

---

## 47. API Routes Overview

### Total: 167+ Endpoints

### Public (No Auth)
- Portal: auth, tickets, KB, chat
- Web-to-lead, event registration
- Calendar feed (token-based)
- Journey processor
- Webhooks (Telegram, WhatsApp, Facebook, VK)

### CRM Core
Companies, Contacts, Deals, Leads, Tasks, Tickets, Contracts, Offers — full CRUD

### Invoicing
CRUD, PDF generation, email sending, payments, from-offer, recurring, act, stats, overdue

### Marketing
Campaigns (CRUD + send), Templates, Segments (+ preview), Journeys (+ enroll + process), Events

### Finance
Dashboard, Receivables, Payables (+ payments), Funds (+ transactions + rules)

### Budgeting (45 routes)
Plans, Lines, Actuals, Analytics, Versions, Diff, CSV, Rolling, Cash Flow, ODDS, Comments

### Cost Model
Analytics, Overhead, Employees, Parameters, Snapshots

### Pricing
Data, Groups, Categories, Profiles, Services, Export/Import, Additional Sales

### Da Vinci
Sessions, Configs, Alerts, Guardrails, Chat, Observations, Lead Scoring, Ticket Da Vinci

### Settings
Users, Roles, Permissions, SMTP, Currencies, Custom Fields, Workflows, SLA, Channels, Dashboard Layout, Lead Rules, Billing

---

## Unique Features Summary

1. **5-Stage Cost Model Engine** — per-client, per-service profitability (18 overhead categories, 7 departments)
2. **13-Tab Budgeting** — P&L, Waterfall, Matrix, ODDS, Rolling Forecast, Cash Flow Alerts, Multi-level Approvals
3. **7-Channel Inbox** — Email, SMS, Telegram, WhatsApp, Facebook, Instagram, VK in unified thread view
4. **Da Vinci Copilot** — ticket reply/summary/steps with KB context, 3-language support
5. **Da Vinci Lead Scoring** — Claude-powered with grade system (A-F), conversion probability, reasoning
6. **Invoice Chain Journeys** — automatic payment reminder sequences per invoice
7. **Dynamic Pricing Engine** — interactive sliders, per-company profiles, multi-currency
8. **Deal Stakeholder Mapping** — influence, decision factors, loyalty tracking per contact
9. **Customer Portal** — self-service tickets, KB, Da Vinci chat with auto-escalation
10. **Act Generation** — Azerbaijan-specific work completion documents
11. **WhatsApp Da Vinci Auto-Reply** — with session memory, KB context, auto-ticket escalation
12. **Custom Invoice Columns** — per-invoice dynamic line item fields
13. **Web-to-Lead** — embeddable form generator with auto-contact creation
14. **Calendar Integration** — iCalendar feed for external calendar subscriptions
15. **Event Public Registration** — with .ics attachment confirmation emails
