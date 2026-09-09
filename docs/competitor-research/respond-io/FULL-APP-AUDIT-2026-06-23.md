# respond.io — полный аудит приложения vs LeadDrive CRM v2

> Дата: 2026-06-23
> Источник: живой аккаунт respond.io (space 435085, Growth Plan trial), `app.respond.io`
> Метод: ручной проход по ВСЕМ модулям и подразделам настроек через Chrome (скрины — инлайн в agent-сессии).
> Сторона LeadDrive: evidence-grounded инвентаризация по коду (Explore-агент, ссылки на пути в `src/`/`prisma/`).
> Caveat: аккаунт respond.io пустой (trial, каналы не подключены, 0 контактов) — поэтому видны empty-states, но **структура и набор фич видны полностью**.

---

## 1. Карта разделов respond.io

### Главные модули (левый рельс)
| Модуль | URL | Что это |
|---|---|---|
| Onboarding | `/onboarding` | Стартовый чеклист (0/4: Connect Channels / Lifecycle / AI Agents / …) + Resources (Watch intro, Contact support, Book a demo, Help center, Video guides) + help-чат-виджет |
| Dashboard | `/dashboard` | Воронка Lifecycle (каждая стадия — 3 метрики: конверсия %, среднее время, кол-во контактов), Contacts (Open/Assigned/Unassigned), Team Members (фильтр по статусу), таймзона |
| Inbox | `/inbox` | Единый омниканальный инбокс: вкладки **Chats** + **Calls** (звонки рядом с чатами); фильтры All/Mine/Unassigned/Incoming Calls; сортировка **Open, Newest** + тумблер **Unreplied**; **Team Inbox** и **Custom Inbox**; Lifecycle-фильтры; "Create AI Agent" прямо из инбокса |
| Contacts | `/contact` | Список контактов, Lifecycle Stages + Lost Stages, **Segments** (преднастроенные: created<7d, inactive>3, with tags, Country/Language known), **Blocked Contacts**, Add segment, Import, Add contact |
| AI Agents | `/ai-agents` | Автономные AI-агенты (AI Agent / AI Sales / AI Support): отвечают 24/7, авто-обновляют Lifecycle и поля контакта, ассайнят разговоры людям/командам/другим AI, отвечают из **knowledge sources**. Есть **AI-ассистент-билдер** («tell me what you need and I'll set up an AI Agent») — собирает агента за тебя |
| Broadcasts | `/broadcast` | Массовые one-time рассылки по сегментам; виды **Table** + **Calendar** (помесячная сетка запланированных); статусы Draft/Scheduled/In Progress/Completed/Failed |
| Workflows | `/workflows` | **Визуальный node-канвас** (trigger → условия → действия): триггеры (**Shortcut**-кнопка, Conversation Opened, …), ветвление **Success/Failure** на каждом шаге, action-ноды (Assign to Team, Send message, Summary Note, …), pan/zoom/fit, лимит **100 шагов**/workflow. Start from scratch / **из шаблона** (~35 шаблонов) |
| Reports | `/reports` | **11 типов отчётов** (Lifecycle/Calls/Conversations/Responses/Resolutions/Messages/Contacts/Assignments/**Leaderboard**/Users/Broadcasts) + фильтры по дате |

Внизу рельса — утилиты: **Notification Center** (колокольчик), **Help** (?), лого respond.io.

### Настройки воркспейса (Workspace settings)
General info · User settings · Team settings · **Channels** · **Integrations** · **Growth widgets** · Contact fields · Lifecycle · Conversations · Snippets · Tags · **AI Assist** · **AI Prompts** · Calls · Files · Contacts import · **Data export**

### Настройки организации (Organization settings) — отдельный уровень над воркспейсами
Доступ через переключатель воркспейса («M» вверху) → шестерёнка у организации. URL `/organization/{id}/...`. Структура: **одна организация → много воркспейсов**.

| Раздел | Что это |
|---|---|
| Account info | Имя организации, телефон, сайт |
| Admin settings | Org-уровень пользователи/админы (Add User, роль Admin) |
| **Security** | **SAML SSO** (Configure + enable-тумблер), **Enforce 2FA на всех пользователей**, «Grant respond.io team access for support» |
| Workspaces | Список воркспейсов (Name / No. of Users / No. of Contacts), Add Workspace |
| WhatsApp fees | Баланс WABA по номеру канала |
| **Billing & usage** | План **Growth (Trial)**, биллинг по **MAC — Monthly Active Contacts** (0/1000), Users 1/10, Subscribe to plan, способы оплаты, история счетов, MAC On-Demand |

---

## 2. Каталог каналов (Channel Catalog)

Сгруппирован по вкладкам: All / Business Messaging / Calls / SMS / Email / Live Chat.

| Категория | Каналы |
|---|---|
| **Business Messaging (10)** | WhatsApp Business Platform (API) ⭐, TikTok (Beta), Facebook Messenger ⭐, Instagram, Telegram, Viber, LINE, WeChat, WhatsApp Cloud API, **Custom Channel** |
| **Calls (2)** | Telnyx (VoIP+SMS), **WhatsApp Business Platform (API) — голосовые звонки** (WhatsApp Business Calling) ⭐ |
| **SMS (5)** | Twilio, MessageBird, Vonage, Custom Channel (SMS), Telnyx |
| **Email (4)** | Google Workspace, Gmail (SMTP), Yahoo (SMTP), Other Email (SMTP) |
| **Live Chat (2)** | Website Chat, Custom Channel (Live Chat) |

Ключевое: **Custom Channel** во всех категориях — подключить любой канал, которого нет нативно (API-мост).

---

## 3. Интеграции (Settings → Integrations) — 12 нативных

| Интеграция | Назначение |
|---|---|
| Salesforce | Просмотр Salesforce-полей контакта в respond.io (требует Upgrade) |
| HubSpot | Просмотр HubSpot-свойств контакта |
| Cal.com (New) | Отправка booking-ссылок, просмотр встреч |
| Developer API | Access-токены для REST API |
| Google Sheets | Создание строки в таблице из Workflow |
| n8n | Low-code автоматизация |
| Webhooks | Уведомление внешнего приложения о событиях |
| SDK | Кастомные интеграции через SDK |
| **MCP (Model Context Protocol)** | Подключить свой LLM к respond.io, NL-управление + триггер любых действий через API |
| TikTok ads accounts | Привязка рекламы TikTok, трекинг конверсий |
| Meta Business accounts | Meta ad accounts + **Conversions API** (события обратно в Meta) |
| Dialogflow | Google NLU-бот |

---

## 4. Библиотека Workflow-шаблонов (~35, по категориям)

Каждый шаблон открывается в том же **визуальном node-канвасе** и редактируется перед применением. Пример «Shift Transfer»: **Shortcut**-триггер → «1st/2nd/3rd Shift Transfer Period» (условия по бизнес-часам) с ветвлением **Success/Failure** → «Assign to N-th Shift Team» + «Transfer Summary Note».

- **Auto-Responder:** Welcome Message (+ ask email / phone / по каналу), Away Message (+ по бизнес-часам)
- **Routing & Assignment:** Round Robin (+ только онлайн), Least Open Contacts, Unassign after close, New vs Returning, By Language (+ спросить язык), Multi-Team (выбор / по сменам), VIP Contacts, Shift Transfer
- **Business Processes:** Multi-Level Chat Menu (Main/Sub — по сути **IVR/меню**), Simple Chat Menu, Request Consent: Privacy, Unsubscribe from Broadcasts, Appointment Scheduling (Cal)
- **Supervision & Reporting:** Sales Call Report, Issue Escalation, **CSAT** → Google Sheets / Data Warehouse
- **Meta Click-to-Chat Ads:** CTC Assignment, Share Product Info + Route to Sales, Send CAPI for Converted Leads
- **TikTok Messaging Ads:** Report new leads, Conversion Tracker, Lead Qualification/Disqualification + событие назад в TikTok

---

## 5. AI-возможности (важно для позиционирования)

| Фича | Что делает |
|---|---|
| **AI Agents** | Автономный агент, ведёт разговоры целиком; типы AI Sales / AI Support; авто-апдейт Lifecycle и полей; ассайнмент; ответы из knowledge sources; handoff людям |
| **AI Assist** | Генерация ответа на базе knowledge sources; **персона бренда** (промпт); тумблеры "отвечать вне базы знаний (как ChatGPT)" и "использовать сниппеты как источник"; Test AI Assist; Manage Knowledge Sources (загрузка документов + ссылок) |
| **AI Prompts** | Готовые: Change tone / Translate / Fix grammar / Simplify + кастомные |
| **Auto closing notes** | При закрытии разговора AI выбирает категорию и генерит summary |
| **MCP / Dialogflow** | Подключение внешних LLM/ботов |

---

## 6. Reports — 11 типов

Lifecycle (воронка: conversion rate, time-to-conversion, drop-off rate, time-to-drop-off, Journey Funnel by Source) · Calls · Conversations · Responses · Resolutions · Messages · Contacts · Assignments · **Leaderboard** · Users · Broadcasts.

---

## 7. Прочие настройки

- **Contact fields:** типы Text/Number/Email/Image/**MultiValue**, кастомные поля, валидация телефона, видимость, Customize View.
- **Lifecycle:** настраиваемый pipeline — Lifecycle Stages (по умолчанию New Lead→Hot Lead→Payment→Customer) + **Lost Stages** (Cold Lead), drag-reorder, эмодзи, описания, show/hide.
- **Conversations:** авто-закрытие после N дней; **AI auto-generate closing notes** (категория + summary); управляемые **категории разговоров** (General Inquiry / Sales Inquiry / Payment Issue / Others); Advanced settings.
- **Snippets:** canned-ответы для Inbox/Broadcasts/Workflows, фильтр по темам, импорт/экспорт.
- **Growth widgets:** встраиваемые на сайт виджеты для роста контактов (мульти-канальный chat-widget).
- **RBAC:** User settings (роли, Owner, invite, revoke) + Team settings (команды → инбоксы + назначение контактов).
- **Data:** Files (хранилище файлов для сообщений/рассылок/воркфлоу), Data export (Contacts/conversations/messages/failed), Contacts import (внутри модуля Contacts).
- **General:** имя воркспейса, таймзона, user inactivity timeout, **Weekly Recap Email** (еженедельный сводный отчёт на почту).

---

## 8. GAP-АНАЛИЗ vs LeadDrive

### 8A. 🔴 Чего у нас НЕТ (или существенно слабее) — приоритетные пробелы

| # | respond.io имеет | LeadDrive | Комментарий |
|---|---|---|---|
| 1 | **Визуальный canvas, водящий conversation/inbox-автоматизацию + ~35 шаблонов** | PARTIAL — визуальный node-canvas **У НАС ЕСТЬ** (Journeys: `journey-flow-editor.tsx` на `@xyflow/react` — палитра нод, рёбра, MiniMap, fitView; смонтирован `journeys/page.tsx:573`) + реальный runtime `journey-engine.ts` (11 step-types). **НО** он заточен под marketing-journeys (enrollments), **не под conversation-inbox**; inbox-автоматизация = rule-формы (`ChatbotRule`), а `campaign-flow-editor.tsx` — canvas, который рисует+сохраняет flowData, но runtime его не исполняет. Шаблонов 7 vs ~35 | respond.io's Workflows-canvas нативно водит **инбокс** (Shortcut/Conversation-триггеры, Success/Failure-ветвление, Assign/Send/Menu — firsthand `shift_transfer`). Реальный разрыв: **canvas не подключён к inbox-сценариям + меньше шаблонов**, а НЕ «canvas отсутствует». |
| 2 | **KB/RAG, подключённый к inbox AI** (ответы чат-агента из базы знаний + URL/doc-источники) | PARTIAL — KB-RAG **У НАС ЕСТЬ** (`KbArticle`/`KbCategory`/`KbEmbedding vector(512)`, auto-ingest `kb/route.ts`, vector-retrieval `searchKbByVector` в `lib/ai/embeddings.ts`) и **питает ticket-AI** (`tickets/ai/route.ts`) + semantic-поиск контрактов. **НО** не подключён к inbox AI Assist / chat-agent (`ai-assist.ts`/`chatbot-autoreply.ts` его не вызывают); ingest только title+content статьи, без URL/документов | respond.io: AI Assist/Agents отвечают из knowledge sources (доки+ссылки). Реальный разрыв: **KB-RAG не подключён к inbox-пути + нет URL/doc-ingest**, а НЕ «KB отсутствует». |
| 3 | **IVR / Multi-Level Chat Menu** (интерактивные меню в чате) | ABSENT — `ChatbotRule` только текст-триггер→текст | Нет древовидных меню самообслуживания. |
| 4 | **Round-robin/авто-ассайнмент входящих разговоров инбокса** | PARTIAL — round-robin/least-loaded есть для **Tickets** (`TicketQueue`/`auto-assign.ts`) и как workflow-экшен `auto_assign` для лидов, но **не для inbox-conversations** | Авто-распределение разговоров соц-каналов между агентами отсутствует. |
| 5 | **Away/Welcome авто-сообщения + бизнес-часы для соц-каналов** | PARTIAL — working hours/offline есть только в `WebChatWidget`, не в соц-инбоксе | Нет приветствия/«мы отошли» по бизнес-часам для WhatsApp/Telegram/etc. |
| 6 | **Native CRM-коннекторы: Salesforce, HubSpot** | ABSENT (live-коннектор) | У нас Google Calendar/Slack/Teams; SF-номенклатурный слой в `lib/*/types.ts` есть, но **two-way sync-коннектора нет**. |
| 7 | **MCP-сервер / публичный SDK / OpenAPI** | ABSENT — есть только `ApiKey`+`Webhook` | respond.io даёт подключить внешний LLM через MCP и публичный SDK. |
| 8 | **Авто closing-notes + AI-категоризация разговоров** | ABSENT для чатов (есть только `CallLog.insights` для звонков) | При закрытии чата у них AI ставит категорию и пишет summary. |
| 9 | **Каналы Viber / LINE / WeChat** | ABSENT (`ChannelConfig` = telegram/whatsapp/email/sms/facebook/instagram/vkontakte) | Эти 3 канала важны для части рынков. Наши не-mainstream живые каналы для контраста — **VK** нативно + **TikTok** через Chatwoot-мост. |
| 10 | **Meta Conversions API / TikTok ads события** (отправка конверсий обратно в рекламу) | ABSENT | Сильная фича для performance-маркетинга (атрибуция кликов в чат). |
| 11 | **QR-коды / click-to-chat ссылки** | ABSENT | Точки входа в чат (QR, ссылки) не генерируются. |
| 12 | **Cal.com / встроенный booking из чата** | ABSENT | Запись на встречу прямо из переписки. |
| 13 | **SAML Single Sign-On (SSO)** на org-уровне | ABSENT (auth на JWT-cookie; SAML/SSO-роута в коде нет) | Enterprise-требование крупных клиентов. 2FA у нас есть (8C), а SSO — нет. |
| 14 | **Org-уровень: enforce 2FA на всех + grant-support-access** | PARTIAL — 2FA есть по пользователю (8C), но нет org-тумблера «принудительно для всех» | Мелкий, но enterprise-губернанс. |
| 15 | **VoIP-звонки через WhatsApp Business** (WhatsApp Business Calling) | ABSENT — наш VoIP = **Twilio + 3CX** (`/api/v1/calls/twiml`, `calls/webhook/threecx`), голоса поверх WhatsApp-канала нет | respond.io делает голосовые звонки **через WhatsApp Business** (+ Telnyx VoIP). У нас звонки сильные (recording/transcription/insights, см. 8C), но через PSTN/SIP, не через WhatsApp. |

### 8B. 🟡 Паритет, но respond.io глубже / зрелее

| Область | respond.io | LeadDrive |
|---|---|---|
| Отчёты | 11 узких отчётов (Responses, Resolutions, Assignments, Leaderboard, Journey Funnel…) | DONE — есть `/reports` + `/inbox/analytics` (FRT, team, temporal), но набор уже |
| Broadcasts | сегменты + **Calendar-вид** + статусы | DONE — `Campaign` email/SMS по сегментам, но без календарного планировщика |
| CSAT | шаблоны + доставка в Google Sheets/Data Warehouse через Workflow | DONE — `Survey` (NPS/CSAT/CES) + sentiment, но без готовых workflow-экспортов |
| Custom Channel | вендор-агностик мост в любой категории | ABSENT — нет plug-in архитектуры для произвольного провайдера |

### 8C. 🟢 Где мы наравне или ВПЕРЕДИ (наши преимущества)

| Наша фича | Статус | Примечание |
|---|---|---|
| **VKontakte** как канал | DONE | respond.io этого **не имеет** — плюс для RU/CIS. |
| **TikTok** входящие | DONE (через Chatwoot-мост, прод-live на `leaddrive`) | У них TikTok в Beta; у нас работает двусторонне. |
| AI auto-reply в инбоксе (персона Gobustone) | DONE | `chatbot-autoreply.ts` + `AiAgentConfig`. |
| AI reply assist (rewrite/shorten/polite/translate/suggest) | DONE | `/inbox/ai-assist`. |
| Snippets с "/"-вставкой + `{{var}}` | DONE | паритет. |
| Web chat widget (AI + escalate to ticket, working hours) | DONE | `WebChatWidget` ≈ их Growth widget. |
| **Визуальный node-canvas (Journeys)** — `@xyflow/react` + runtime `journey-engine.ts` (11 step-types) | DONE | `journey-flow-editor.tsx` + `journeys/page.tsx:573`. **Паритет** с respond.io по визуальному билдеру — для marketing-journeys; разрыв только в покрытии inbox-сценариев (см. 8A#1). |
| Call/VoIP (**Twilio + 3CX**) + recording + **transcription + insights** | DONE | `CallLog` через `calls/twiml` (Twilio) + `calls/webhook/threecx`; sentiment/topics/action items/coaching. PSTN/SIP — но не голос через WhatsApp (см. 8A#15). |
| 24h авто-follow-up в инбоксе | DONE | `/api/cron/inbox-followup`. |
| **Полноценный CRM-слой** (Deals/Leads/Pipelines/Quotes/Forecast/Attribution/Finance) | DONE | respond.io — conversation-first, у него CRM тонкий. **Наше ядро глубже.** |
| Smart AI Search (NL→таблица), KPI Arena, Surveys closed-loop | DONE | фичи, которых у них нет. |
| **2FA: SMS + TOTP** (enable/verify/disable + middleware) | DONE | `auth/2fa`, `auth/totp/*`, `auth/sms-2fa/*` — у respond.io только org-тумблер «enforce 2FA», у нас полноценный 2FA на пользователя. |
| Биллинг-модель | — | respond.io тарифицирует по **MAC (Monthly Active Contacts)**, 0/1000 на Growth. Мы — B2B enterprise без self-serve-биллинга → аргумент в продажах: «не метрикуем вас по числу контактов». |

---

## 9. Рекомендации (приоритизация)

- **[P0] Распространить существующий visual-canvas (Journeys) на conversation-inbox.** Canvas + runtime у нас УЖЕ есть (`journey-flow-editor.tsx` xyflow + `journey-engine.ts`, 11 step-types, `journeys/page.tsx:573`) — но только для marketing-journeys. Нужно: (1) подключить тот же canvas к inbox/workflow-сценариям (away/welcome по бизнес-часам, routing, round-robin разговоров, chat-menu), (2) консолидировать UI-only `campaign-flow-editor.tsx` на этот runtime (см. `memory/project_campaign_flow_decision.md` — Journeys канонический, дубль-движок не строить), (3) нарастить шаблоны 7→~15. **Строить canvas с нуля НЕ нужно** — это расширение, а не greenfield. Самый высокий ROI.
- **[P0] Авто-ассайнмент разговоров (round-robin/least-open) для инбокса.** Переиспользовать логику `auto-assign.ts` (сейчас только tickets) на conversations.
- **[P1] Подключить существующий KB-RAG к inbox AI.** `searchKbByVector` (`lib/ai/embeddings.ts`) уже работает и питает ticket-AI — нужно вызвать его из `ai-assist.ts`/`chatbot-autoreply.ts` (ответы чат-агента из базы) + добавить URL/документ-ingest (сейчас ingest только title+content статьи). Инфраструктура (модель + embeddings + vector-search) есть — это подключение, не greenfield.
- **[P1] Away/Welcome авто-сообщения + бизнес-часы для соц-каналов.** Перенести `workingHours` из `WebChatWidget` на уровень канала.
- **[P1] AI closing-notes + категории разговоров.** Переиспользовать AI-инсайты звонков для чатов.
- **[P2] Meta Conversions API / TikTok ads события** (атрибуция клик→чат→конверсия) — синергия с нашим Attribution-модулем.
- **[P2] IVR / multi-level chat menu** как тип `ChatbotRule`.
- **[P2] Каналы Viber/LINE** (WeChat — нишево).
- **[P3] QR/click-to-chat генератор, Cal.com booking из чата, Salesforce/HubSpot read-коннекторы.**

---

## Заметка про скриншоты

Скрины всех разделов (обоих уровней — workspace и organization) сняты и показаны **инлайн в agent-сессии** (ты видишь их по ходу прохода). Записать их **файлами** в репозиторий из этого окружения не вышло: `screencapture` через shell заблокирован (у терминала нет Screen Recording permission), а MCP-скриншот-инструменты путь к файлу не возвращают — только прикрепляют картинку в чат.

> Примечание: 7 JPG в `docs/competitor-research/respond-io/frames/` — это кадры из более раннего анализа промо-**видео** respond.io (другой артефакт прошлой сессии), **не** скрины этого аудита.

Нужны именно PNG в `docs/competitor-research/respond-io/`? Варианты: (1) выдать терминалу Screen Recording в System Settings → Privacy — пересниму через shell прямо в папку; (2) выгрузить проход одним GIF в `~/Downloads`. Этот текстовый аудит покрывает всё содержимое скринов в структурированном виде.
