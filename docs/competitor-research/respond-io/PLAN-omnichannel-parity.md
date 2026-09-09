# Omni-channel паритет с respond.io — карта «аудит → эпики E1–E5» + net-new

> Дата: 2026-06-23
> **Это НЕ второй план.** Канонический план имплементации — [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) (эпики **E1–E5**, заземлён по коду, E1 уже в работе). Этот документ — **слой сверху**: берёт ПОЛНЫЙ аудит [`FULL-APP-AUDIT-2026-06-23.md`](FULL-APP-AUDIT-2026-06-23.md) (шире, чем исходные 7 gaps из промо-видео) и отвечает на запрос «сравни наш omni-channel модуль с respond.io, всё чего нет → в план, UI где лучше → ввести»:
> 1. **Coverage map** — каждый пробел respond.io → какой существующий эпик его закрывает, **или NET-NEW** (нашёл только полный аудит, в E1–E5 нет).
> 2. **UI-дельты** — где их UI лучше.
> 3. **Корректировка архитектуры** — выровнено с решением E1 (не «extend journey-engine»).
> База: аудит + карта нашего модуля по коду + **живой прод-UI** `app.leaddrivecrm.org` (130 реальных диалогов).

---

## 0. Канонический план уже существует — E1–E5 (статус)

| Эпик | Закрывает | Приоритет | Статус сейчас |
|---|---|---|---|
| **E1 — Conversation Automation Engine** | визуальный flow-builder, auto-routing, AI auto-update/categorize | P0 | **E1.1a ЗАЛЕНДИЛ** — `executeConversationAction` (`src/lib/inbox/conversation-actions.ts`: assign/categorize/close/create_ticket/notify/add_participant, tenant-guarded, 11 tests) + модели `ConversationFlow`/`ConversationFlowRun` (schema:3735/3758). **E1.1b задекларирован** (`memory/deferred_findings.md:30`): runner + channel/AI-действия (send_reply/ai_reply/handoff) + event-wiring |
| **E2 — Messaging Broadcasts** | WhatsApp/Telegram bulk re-engage | P1 | план готов (E2.1 adapter refactor → E2.2 WA/TG → E2.3 UX) |
| **E3 — Agent Productivity** | AI Assist composer + snippets «/»+`{{var}}` | P1 | **в основном ОТГРУЖЕНО** — прод-UI уже имеет AI-assist (rewrite/shorten/polite/translate/suggest) + snippet-picker «/» + `{{vars}}` (`lib/inbox/ai-assist.ts`, `MessageSnippet`) |
| **E4 — Voice inline channel** | Chats\|Calls вкладки, click-to-call, call-события в треде | P2 | план готов; VoIP-провайдеры (Twilio prod, 3CX/Asterisk untested) есть, `initiateCall()` никто не зовёт |
| **E5 — Ecosystem** | integrations marketplace, mobile app, inline catalog | P3 | spike-only |

**Архитектурные решения E1 (уже приняты, выровнять весь omni-channel на них):** event-driven (не cron), **отдельный** движок ConversationFlow (не Journeys, не journey-engine), **общий** action-executor, **reuse `@xyflow/react`** из `journey-flow-editor.tsx` (генерализовать конвертеры), reuse `generateChannelAiReply()` + `AiAgentConfig`, reuse `matchChatbotRule()` для keyword-триггеров.

### 0.1 Что у нас УЖЕ есть (исправленный inventory)
Инбокс v2 (`/inbox`, 10 каналов, views/статусы/folders/search/SSE) · композер (snippets+`{{vars}}`, AI-assist 5 действий, вложения, заметки+@mentions) · AI-агент инбокса (`/inbox/ai-agent`: персона Gobustone, авто-ответ toggle, channel-reply matrix, escalation, 24h follow-up) · авто-ответы бота (`/inbox/chatbot-rules`) · аналитика (FRT/SLA/aging/heatmap/CSV) · **ConversationFlow executor E1.1a** · **визуальный canvas Journeys** (`journey-flow-editor.tsx` @xyflow — marketing) · **KB-RAG** (`searchKbByVector`, питает ticket-AI) · звонки (Twilio+3CX, запись+транскрипция).

---

## 1. Coverage map: пробел respond.io → эпик E1–E5 / NET-NEW

### Закрыто существующими эпиками (план есть — не дублировать)
Легенда: `8A#N` = пункт из аудита §8A; остальные — из исходных 7 gaps промо-видео (`IMPLEMENTATION-PLAN.md`).

| Пробел | Эпик | Reuse-якорь |
|---|---|---|
| 8A#1 визуальный inbox-canvas | **E1.3** | clone `@xyflow` из `journey-flow-editor.tsx`, генерализовать `stepsToFlow`/`flowToSteps` (НЕ extend journey-engine) |
| 8A#4 auto-routing разговоров | **E1.2** | `TeamQueue`+`routeConversation`; reuse `User.skills/maxTickets/isAvailable` + assign write-path `conversations/[id]/route.ts:55` |
| 8A#8 AI closing-notes + auto-categorize | **E1.4** + executor `categorize` (E1.1a) | `generateChannelAiReply()`, `update_field` allow-list |
| Broadcasts: WA/Telegram bulk | **E2** | `CampaignChannelAdapter`, `sendWhatsAppText/Template`, lift `sendTelegramText` |
| AI Assist + snippets | **E3 (DONE)** | уже в проде |
| Voice: Chats\|Calls, click-to-call | **E4** | `VoipProvider.initiateCall()`, bridge `CallLog↔SocialConversation` |
| 8A#7 MCP/SDK/marketplace | **E5** | outbound webhook + Zapier-триггер как дешёвый слайс |

### NET-NEW — нашёл только ПОЛНЫЙ аудит (в E1–E5 нет; добавить в план)
| # | Пробел (аудит) | Куда вписать | Приоритет |
|---|---|---|---|
| **N1** | **KB-RAG → inbox AI** (8A#2) — ответы агента из базы знаний | расширить **E1.4** + AI-агент: вызвать `searchKbByVector` (`lib/ai/embeddings.ts`) из `generateChannelAiReply`/`ai-assist.ts`, инжектить top-K; **B:** URL/doc-ingest (сейчас ingest только title+content) | **P1** |
| **N2** | **Away/Welcome + бизнес-часы** соц-каналов (8A#5) | новый слайс **E1.x**: модель `BusinessHours` (per org/channel) + away/welcome как ConversationFlow-шаблоны | **P1** |
| **N3** | **Contact-level lifecycle + теги на разговоре в инбоксе** (аудит: Inbox/Dashboard, вне §8A) | **net-new data:** `lifecycleStage` у нас только на `MarketingAccount` (account-level ABM) + Pipeline для сделок — **contact-level lifecycle как у respond.io отсутствует**; нужно поле на `Contact` (или join) + conversation-level теги + показ в списке/панели/rail | **P1** |
| **N4** | **IVR / multi-level chat menu** (8A#3) | новый node-type `menu` в билдере **E1.3** + шаблоны Main/Sub | **P2** |
| **N5** | **Каналы Viber / LINE** (8A#9; WeChat нишево) | новые адаптеры (reuse `CampaignChannelAdapter` из E2.1 + inbox channel-libs) | **P2** |
| **N6** | **Custom Channel** vendor-agnostic (8A) | generic inbound+outbound webhook channel + маппинг | **P2** |
| **N7** | **Meta Conversions API / TikTok ads-события** (8A#10) | action-node `send CAPI/event` в **E1** (синергия с Attribution C9) | **P2** |
| **N8** | **QR / click-to-chat ссылки** (8A#11) — точки входа в чат | генератор entry-point (deep-link + QR) — omni-channel, был silent-drop | **P3** |
| **N9** | **Cal.com booking из чата** (8A#12) | composer-action / E1-node | **P3** |
| **N10** | **Salesforce/HubSpot read-коннектор** (8A#6) | под **E5** (read-only) | **P3** |

---

## 2. UI-дельты (где respond.io лучше) → ввести

| # | UI-дельта | У нас сейчас | Действие | Связь |
|---|---|---|---|---|
| **U1** | сорт «Open, Newest» + тумблер **Unreplied** | сорт хардкод, Unreplied нет | добавить контролы в список (мелко, высокий эффект) — net-new UI | — |
| **U2** | lifecycle-стадия + теги в инбоксе | нет | бейдж в item + панель + rail-фильтр | N3 |
| **U3** | визуальный canvas для inbox-автоматизации (Success/Failure, zoom/fit, step-counter) | inbox-UI = sentence-rules | canvas из Journeys в inbox-режиме | E1.3 |
| **U4** | **Manage Knowledge Sources** + тумблер «отвечать вне базы» | `/inbox/ai-agent` персона есть, KB-источников нет | вкладка KB-источников | N1 |
| **U5** | **Chats \| Calls** вкладки | voip read-only без вкладки | Calls-вкладка | E4.2 |
| **U6** | **Channel Catalog** (grouped Connect-карточки + категории + поиск) | «Каналы» проще | привести к каталогу | — |
| **U7** | AI-agent-builder ассистент («опиши — соберу агента») | нет | опционально, онбординг | — |
| **U8** | **Team / Custom Inbox** (сохранённые отфильтрованные виды) | folders (name+color, без фильтров) | folders → сохранённые фильтры | — |

---

## 3. Архитектура — ВЫРОВНЕНО с E1 (исправление)

> ⚠️ Ранняя версия этого документа рекомендовала «extend journey-engine для conversation-триггеров» — **снято как неверное**. Решение уже принято в `IMPLEMENTATION-PLAN.md` §22 + реализуется в E1.1a:
> - **Отдельный** event-driven движок на `ConversationFlow`/`ConversationFlowRun` (НЕ journey-engine — тот enrollment/cron-scoped, `processEnrollmentStep`), чтобы не плодить дубль (см. `memory/project_campaign_flow_decision.md`).
> - **Reuse executor** `executeConversationAction` (E1.1a готов) — следующий шаг **E1.1b** (`deferred_findings.md:30`): runner (event→match→nodes→executor, org-trust boundary) + channel/AI-действия (`send_reply`/`ai_reply`/`handoff`, обязан чтить `aiReplyClaimedAt`) + event-wiring из ingest-пути.
> - **Reuse `@xyflow` canvas** из `journey-flow-editor.tsx` (генерализовать конвертеры) для UI билдера (E1.3).

Net-new модели только для N1/N2/N3: `BusinessHours` (per org/channel; N2), **contact-level lifecycle-поле на `Contact`** + conversation-level теги (N3), URL/doc KB-источник (N1).

## 4. Последовательность (поверх канонической из IMPLEMENTATION-PLAN.md)
Каноническая: **E3 (quick win, уже ~готов) → E1 (headline) → E2 (revenue) → E4 → E5.**
Вставки из аудита: **N1 (KB→inbox)** и **N3 (lifecycle/теги + U1/U2)** — в Phase 1 рядом с E1; **N2 (away/welcome+бизнес-часы)** — после E1.1b; **N4 (IVR), N5–N7 (каналы/CAPI)** — Phase 2–3; **N8–N10** — P3.

## 5. Верификация
`npx tsc --noEmit` + unit (E1.1b runner, N1 KB-retrieval в inbox, N3 теги) + API-smoke + прод-проверка на leaddrive-тенанте (130 диалогов) + Codex self-review against the active slice scope. Регрессионный инвариант E1: чтить `aiReplyClaimedAt` (фикс `483e4ca8`), не дублить ответы.

## 6. Out-of-scope / отдельные треки
- **SAML SSO + org enforce-2FA** (8A#13/#14) — enterprise-трек, не omni-channel.
- **WhatsApp Business voice calling** (8A#15) — backlog (Meta API; наш VoIP = Twilio+3CX).
- **MAC-биллинг** — мы B2B без self-serve.
- **WeChat** — нишево. Каналы у нас = их набор **+ VKontakte** (наш плюс).
- Замена Journeys — нет (marketing-движок остаётся; inbox-движок отдельный, чат-only).
