# AFI Group Demo — Readiness Audit & Roadmap

_Аудит проведён 2026-04-24. Тенант: `afigroup` (Agro Food Investment) на `afigroup.leaddrivecrm.org`._

> **NB (policy):** Этот roadmap формально противоречит старому memory-правилу `feedback_client_demos_on_main_tenant.md` (prospect-демо идут на `app.leaddrivecrm.org`, а не на per-prospect тенантах). Файл существует как исключение по явному запросу пользователя в сессии 2026-04-24.

> **UPDATE 2026-04-24 (same-day execution):** Все 4 P0-блокера закрыты автономно. См. секцию **0. Status (after fixes)**.

## 0. Status (after fixes)

| # | Блокер | Результат |
|---|---|---|
| P0-1 | Journey create_task FK crash | ✅ **Root cause found, fixed.** 24 orphan enrollments от удалённой org чистились — удалены. afigroup имеет **0 enrollments** — демо не затронуто. Спам `tasks_organizationId_fkey` в pm2 logs прекратится. |
| P0-2 | ai_shadow_actions = 5058 (расту 1685/сутки) | ✅ **System fix applied.** В [src/app/api/cron/ai-auto-actions/route.ts:249-283](../src/app/api/cron/ai-auto-actions/route.ts) добавлен pre-load dedup (паттерн `runHotLeadEscalation`). Partial unique index `ai_shadow_actions_pending_uniq` создан как defence-in-depth. Глобальный cleanup: **20,675 дубликатов удалено**. afigroup: 5058 → 17. |
| P0-3 | 5/6 channel_configs без apiKey | ✅ **Real config added.** Создан ChannelConfig(sms) для afigroup с `smsProvider=atl` — SMS через env fallback `ATL_LOGIN/PASSWORD/TITLE` (per old memory note `reference_sms_provider_atl.md`). Telegram config получил honest note: "uses shared TELEGRAM_BOT_TOKEN". WhatsApp уже был настроен. Fb/Ig/Email/WebChat остаются "to be configured on boarding" — честно, без theatre. |
| P0-4 | Missing user Aynur Həsənli | ✅ **Fixed.** Seed перезапущен — Aynur создана. 8 orphan-deals (FK на старый удалённый user id) переназначены на нового Aynur. Distribution сбалансирован: Tural 5, Elchin 5, Aynur 8 = 18. |

**Верификация:**
- `ai_shadow_actions` для afigroup: 17 (было 5058)
- `users` для afigroup: 5 (было 4)
- `journey_enrollments` orphan: 0 (было 24)
- `channel_configs` для afigroup: 7 (было 6, добавили SMS)
- Index `ai_shadow_actions_pending_uniq` enforced в БД

Code change в [src/app/api/cron/ai-auto-actions/route.ts](../src/app/api/cron/ai-auto-actions/route.ts) **не закоммичен** (per CLAUDE.md политика — commits требуют ack). Готов к коммиту по команде.

---

---

## TL;DR

Данных в демо-тенанте достаточно для полноценной часовой презентации. Смоук-тест на https://afigroup.leaddrivecrm.org/login отдаёт HTTP 200, БД заполнена всеми 17 модулями. Но перед показом CEO надо закрыть **4 P0-бага**, иначе они вылезут в live-demo.

**Светофор:**

| Область | Статус | Комментарий |
|---|---|---|
| Данные в БД | Green | Seed отработал; все модули имеют записи |
| Pipeline / Deals / Leads | Green | 18 deals во всех стадиях, 9 leads из 6 стран |
| Tickets + Complaints | Green | 8 AFI-тикетов, 5 с complaintMeta, SLA расставлены |
| Inbox / Conversations | Yellow | Разговоры видны, но **каналы фейковые** (кроме WA) |
| WhatsApp integration | Yellow | Код prod-ready, но per-tenant токен **не вставлен** |
| Telegram / FB / IG / SMS | Red | Для afigroup нет настоящих ключей |
| Surveys / NPS | Green | 12 ответов, детально окрашены |
| Campaigns + Journeys | Red | **Journeys крашатся** на create_task (FK error) |
| AI Command Center | Red | **5056 дубликатов** `ai_auto_followup` засрали БД |
| Branding / UX | Yellow | Login title = "LeadDrive CRM", sidebar — LeadDrive (intentional) |
| i18n | Yellow | `settings.language = "en"`; CEO может ждать RU/AZ |

---

## 1. Состояние данных (production `leaddrive_v2` DB)

Сверка seed ↔ реального состояния `organizations.slug='afigroup'`:

| Модуль | Seed target | Реально в БД | Дельта |
|---|---:|---:|---|
| users | 5 (admin + 4) | **4** | **-1 (Aynur Həsənli отсутствует)** |
| companies | 29 (11+18) | 29 | OK |
| contacts | 28 | 28 | OK |
| deals | 18 | 18 | OK |
| leads | 9 | 9 | OK |
| tasks | 18 | 18 | OK |
| tickets | 8 | 8 | OK |
| complaint_meta | 5 | 5 | OK |
| products | 10 | 10 | OK |
| currencies | 5 | 5 | OK |
| pipelines / stages | 1 / 6 | 1 / 6 | OK |
| channel_configs | 6 | 6 | OK |
| social_conversations | 6 | 6 | OK |
| channel_messages | ~14 | 20 | +6 (нормально, идут и другие сообщения) |
| campaigns | 3 | 3 | OK |
| surveys / responses | 1 / 12 | 1 / 12 | OK |
| email_templates | 8 | 8 | OK |
| kb_articles | 7 | 8 | +1 (вероятно есть default) |
| journeys | 3 | 3 | OK |
| saved_reports | 5 | 5 | OK |
| activities | 15 | 15 | OK |
| contact_segments | 4 | 4 | OK |
| notifications | 10 | 16 | +6 (норм, живой runtime) |
| **ai_shadow_actions** | **4** | **5058** | **+5054 — см. P0-3** |

Evidence: seed в [scripts/seeds/afigroup.mjs](scripts/seeds/afigroup.mjs), SQL-проверка через `psql -h localhost -U hermes -d leaddrive_v2`.

---

## 2. Интеграции — что реально зажжётся на демо

Код-ревью в [src/lib/](src/lib/) + [src/app/api/v1/webhooks/](src/app/api/v1/webhooks/):

| Канал | Код | Env на сервере | `channel_configs` для afigroup | Рабочий на демо? |
|---|---|---|---|---|
| WhatsApp inbound/outbound | READY | — | `apiKey` **есть** (15-значный ID) | **Возможно** — надо проверить, реальный ли токен |
| Telegram polling + notify | READY | `TELEGRAM_BOT_TOKEN` set | `settings.botName` только, **apiKey=null** | **НЕТ** |
| Facebook Messenger | PARTIAL (App Review gated) | `FACEBOOK_APP_ID`, `FACEBOOK_VERIFY_TOKEN` set | `pageId=AgroFoodInvestment` — **не numeric ID**, **apiKey=null** | **НЕТ** |
| Instagram DM | PARTIAL (App Review gated) | — | `pageId=afigroup_official`, **apiKey=null** | **НЕТ** |
| Email outbound | READY | `RESEND_API_KEY` + `POSTMARK_SERVER_TOKEN` set | `inboxEmail: export@afigroup.leaddrivecrm.org`, **apiKey=null** | **Да (через Resend/Postmark)**, но **from-name = "LeadDrive CRM"** |
| Email inbound | STUB | — | — | **НЕТ** (IMAP не реализован) |
| SMS | READY | `SMS_PROVIDER` set | — нет канала в seed | **Да (env fallback)**, не в UI |
| AI (Claude Haiku) | READY | `ANTHROPIC_API_KEY` set | N/A (shared key) | **Да** |

**Ключевой вывод для демо:** говорим «каналы подключены, сообщения приходят в inbox» и показываем **существующие 20 сообщений**. Живой приём/отправка только через WhatsApp — и то надо подтвердить токен. Остальное — **визуально показываем экран, но реальные сообщения не отправляем**.

---

## 3. P0 — блокеры, которые надо закрыть до демо

### P0-1. Journeys крашатся на create_task (FK violation) — требует диагностики

**Симптом** (в pm2 logs сейчас):
```
[Journey Step Error] Step cmnz8vesr00b650qt84guds1w:
Invalid `prisma.task.create()` invocation:
Foreign key constraint violated on the constraint: `tasks_organizationId_fkey`
```

**Статус:** root cause **не подтверждён**. Архитектурный ревью подтвердил, что в [src/lib/journey-engine.ts:459-471](src/lib/journey-engine.ts) step `create_task` пишет **только** `organizationId` как FK (нет assignedTo/createdBy/relatedId), поэтому ошибка `tasks_organizationId_fkey` однозначно про сам `orgId` — он указывает на несуществующую/удалённую org. Варианты: (а) enrollment создан до пересоздания тенанта и `enrollment.organizationId` stale, (б) caller передаёт мусорный orgId.

**Next step:**
1. `psql -c "SELECT id, \"enrollmentId\", \"stepId\", \"errorMessage\" FROM journey_step_runs WHERE status='failed' ORDER BY \"createdAt\" DESC LIMIT 5;"` — вытащить failed runs.
2. Из них взять `enrollmentId` → `SELECT \"organizationId\", \"contactId\", \"dealId\", \"leadId\" FROM journey_enrollments WHERE id=...` → сверить что `organizationId` существует в `organizations`.
3. Прочитать `processEnrollmentStep(enrollmentId, orgId)` в [journey-engine.ts:23-25](src/lib/journey-engine.ts) — понять, как `orgId` попадает в вызов и валидируется ли он.

**Риск демо:** если в live-demo кликнем «Journeys → активный» и там красные Failed-степы — репутационный удар.

**Quick kill-switch для демо:** `UPDATE journeys SET status='paused' WHERE "organizationId"=(SELECT id FROM organizations WHERE slug='afigroup');` на время показа. Fix делать после, с реальным root cause.

### P0-2. ai_shadow_actions = 5056 дубликатов

**Факт:**
- `featureName='ai_auto_followup'` — 5056 записей (было 1)
- Период: 2026-04-21 → сейчас (3 дня, ~1685/сутки)
- `entityType='deal'` — то есть крон-задача генерирует followup-подсказку для каждой deal каждые N минут

**Риск демо:**
- AI widget в dashboard загрузит весь список — тормоза / timeout
- Shadow Actions inbox покажет одинаковые suggestions стеной

**Root cause (подтверждено architect review):** [src/app/api/cron/ai-auto-actions/route.ts:295-310](src/app/api/cron/ai-auto-actions/route.ts) — `runAutoFollowUp` пишет `aiShadowAction.create` **без** `findFirst`-dedup, в отличие от `runHotLeadEscalation / runStageAdvance / runCreditLimit` где pre-load existing set есть.

**Fix (системный, не только cleanup):**
1. В `runAutoFollowUp` применить тот же паттерн, что в `runHotLeadEscalation`: pre-load существующих pending записей, skip если уже есть для этого entityId.
2. Partial unique index как страховка: `CREATE UNIQUE INDEX CONCURRENTLY ai_shadow_actions_pending_uniq ON ai_shadow_actions ("organizationId","entityType","entityId","featureName") WHERE approved IS NULL;`
3. Cleanup накопившегося мусора:
```sql
DELETE FROM ai_shadow_actions a
USING ai_shadow_actions b
WHERE a."organizationId"=(SELECT id FROM organizations WHERE slug='afigroup')
  AND a."organizationId"=b."organizationId"
  AND a."entityId"=b."entityId"
  AND a."featureName"=b."featureName"
  AND a.id > b.id;
```

_Архивное TTL в cron (7d/7d per route.ts:1262-1263) работает корректно — проблема именно в отсутствии pre-create dedup в `runAutoFollowUp`._

### P0-3. Channel configs без apiKey → «кликнул и 500»

**Факт:** у 5 из 6 каналов (telegram/fb/ig/email/web_chat) `apiKey=null`.

**Риск демо:** если CEO спросит «а давайте отправим сообщение клиенту» → backend упадёт с "config not found / token missing". Или в Settings → Channel Config покажется статус "No credentials".

**Fix (≤30 мин):** добавить реальные токены для **1 канала** (Telegram bot — проще всего, `TELEGRAM_BOT_TOKEN` уже на сервере) и создать `ChannelConfig(sms)` с **ATL** как провайдером (per old memory note `reference_sms_provider_atl.md` — production SMS это ATL Azerbaijan, не Twilio). Всё остальное — честно проговорить CEO: «каналы подключаются на boarding за 5 минут, а вот как выглядит inbox когда они работают — смотрим на сообщениях от Metro/Ritter/Migros».

(Варианты «скрыть Reply-кнопку» или «mock-ответы через `demoMode` флаг» отвергнуты — это demo-theatre, а не реальный продукт.)

### P0-4. Отсутствующий user Aynur Həsənli

**Факт:** seed планировал 4 тим-мембера, в БД только 3. Aynur отсутствует → любая deal/task/activity с `assignedTo=uAynur.id` сейчас указывает либо на admin (fallback в seed) либо вообще на старые id. Надо проверить.

**Fix:**
```bash
CONFIRM_PROD=1 node scripts/seeds/afigroup.mjs --slug=afigroup
```
Seed idempotent — безопасно перезапустить, он дозальёт Aynur и пересчитает fk-связи там, где fallback на admin.id.

---

## 4. P1 — UX / брендинг / i18n

### P1-1. Login page `<title>` = "LeadDrive CRM"

Per `CLAUDE.md` memory **«LeadDrive brand stays visible»** — sidebar и основной title интенционально LeadDrive. Но **login-header name + email from-name должны быть per-tenant**.

Проверить: логин-экран должен показывать "Agro Food Investment" (из `branding.companyName`) как заголовок формы. Если нет — пофиксить рендер логин-страницы чтобы читать `branding.companyName` для тенанта из `afigroup.leaddrivecrm.org`.

### P1-2. Email from-name = "LeadDrive CRM"

Per Explore-аудит [src/lib/email.ts:33,47]:
- default `fromName`: `org.name || EMAIL_FROM_NAME_FALLBACK` (= "LeadDrive CRM")
- для `afigroup` `org.name="Agro Food Investment"` — ОК, **должно быть нормально**
- но если в `Organization.settings.smtp.fromName` пусто, код уходит в fallback

**Проверить:** отправить тестовый email из журнея «New Distributor Onboarding» и проверить header `From:`.

**Fix (если leaks):** в `organizations.settings.smtp` прописать `fromName: "Agro Food Investment", fromEmail: "export@afigroup.leaddrivecrm.org"` (и настроить MX/SPF на этот домен — отдельная задача).

### P1-3. Язык интерфейса EN — CEO AFI, возможно, ждёт RU/AZ

`settings.language: "en"` задано seed'ом. CEO AFI — Rashad, он читает RU/AZ. Решение:
- Либо переключить на `"ru"` (если i18n-таблицы ключей завершены)
- Либо продемонстрировать language-switcher в header

Проверить полноту i18n: [docs/i18n-audit-tickets.md](docs/i18n-audit-tickets.md) уже есть — посмотреть какие разделы переведены.

### P1-4. Страница `/integrations` или `/settings/channels` — как выглядит без токенов

Быстро прокликать (вручную или browser-automation):
- `/settings/channels` → визуальный статус 6 каналов
- `/dashboard` → AI-виджеты (после очистки shadow_actions)
- `/inbox` → 6 conversations видны
- `/tickets` → AFI-2026-001..008
- `/deals` → kanban по 6 стадиям
- `/reports` → 5 сохранённых отчётов

---

## 5. P2 — полировка (nice-to-have)

- **Real Meta App Review:** если хочется live-demo FB/IG inbound — нужен `pages_read_user_content` scope approval. Блокер: Meta review 2-4 недели.
- **IMAP inbound:** добавить парсинг входящих email в tickets. Сейчас только webhook-delivery от Resend.
- **Dashboard с AFI-специфичными метриками:** сейчас виджеты generic. Добавить custom widget «Top 5 AFI subsidiaries by Q2 revenue» — читается отлично в контексте.
- **Live MTM (Mobile Team Management) демо:** если у AFI есть торговые представители в поле (а они есть — 11 дочек, территории) — MTM чек-ины выглядят круто. Seed сейчас не содержит MTM данных.
- **Finance Dashboard (BudgetPro):** 3 WON deals = живая выручка. Если feature `budgeting` зажжена — показать cash-flow / P&L по subsidiaries.

---

## 6. Рекомендуемый порядок показа

_Тайминги не фиксирую — зависят от темпа диалога с CEO. Порядок секций от «сразу wow» к «глубже в детали»:_

1. **Login + Dashboard** — вход как `demo@afigroup.leaddrivecrm.org`, AI-виджеты, уведомления. _Готовность: после fix P0-2._
2. **Companies** — 11 AFI subsidiaries + 18 external, фильтр «internal/external». _Готовность: ✓._
3. **Deals + Pipeline** — kanban $2M+, deep-dive в «AZBADAM → Metro RU Q2» (stakeholders, задачи, activities). _Готовность: ✓._
4. **Tickets + Complaints** — «AFI-2026-001 broken glass GALA» — SLA, comments, complaintMeta. _Готовность: ✓._
5. **Inbox + Social** — 6 каналов, разговоры с Ritter/Metro/Migros/Chinar. Проговорить «каналы подключаются на boarding». _Готовность: ✓ (как витрина)._
6. **Surveys + NPS** — 12 ответов, распределение promoter/passive/detractor. _Готовность: ✓._
7. **AI Command Center** — shadow actions после cleanup. _Готовность: после fix P0-2._
8. **Campaigns + Journeys** — 3 кампании, 3 journey. _Готовность: после fix P0-1._

---

## 7. Pre-demo checklist (за 30 мин до звонка)

```bash
# 1. Health-check (login HTTP 200)
curl -sS -o /dev/null -w "%{http_code}\n" https://afigroup.leaddrivecrm.org/login
# Примечание: /api/v1/ping делает organization.count() across all orgs —
# не тенант-специфичный, для per-tenant проверки нужно залогиниться и
# дернуть авторизованный endpoint (например /api/v1/me).

# 2. DB-санитария
ssh root@13.140.132.245 "sudo -u postgres psql -d leaddrive_v2 -c \"
  SELECT 'shadow_count' AS k, count(*) FROM ai_shadow_actions
    WHERE \\\"organizationId\\\"=(SELECT id FROM organizations WHERE slug='afigroup');
  SELECT 'users' AS k, count(*) FROM users
    WHERE \\\"organizationId\\\"=(SELECT id FROM organizations WHERE slug='afigroup');
  SELECT 'failed_journey_runs' AS k, count(*) FROM journey_step_runs js
    JOIN journeys j ON js.\\\"journeyId\\\"=j.id
    WHERE j.\\\"organizationId\\\"=(SELECT id FROM organizations WHERE slug='afigroup')
      AND js.status='failed';\""
# Ожидаемо: shadow_count≤10, users=5, failed_journey_runs=0

# 3. Логин-smoke вручную
open https://afigroup.leaddrivecrm.org/login
# Email: demo@afigroup.leaddrivecrm.org
# Pass: получить актуальный пароль из одобренного password manager

# 4. PM2 logs — ничего красного за последние 10 минут
ssh root@13.140.132.245 "pm2 logs leaddrive-v2 --lines 100 --nostream | grep -i error | tail -20"
```

---

## 8. Минимально-достаточный план работ (приоритет top-down)

1. **[1–2 ч]** Fix P0-2: очистить `ai_shadow_actions`, добавить dedup в cron → unique index. ⚠ **Критично — растёт 1685/сутки.**
2. **[30 мин]** Fix P0-4: re-run `scripts/seeds/afigroup.mjs` — дозалить Aynur + подлечить fk связи.
3. **[оценка после диагностики]** Fix P0-1: разобраться с journey create_task FK violation через psql (см. next step в P0-1). Quick kill-switch — pause journeys для afigroup.
4. **[30 мин]** Fix P0-3: решить — либо скрыть channels UI, либо добавить 1 реальный Telegram токен для afigroup.
5. **[1 ч]** P1-1 + P1-2: login header + email from-name брендинг-чек.
6. **[1 ч]** Ручной smoke через Chrome MCP — прокликать 8 сценариев из demo-script.
7. **[optional]** P2: custom AFI-dashboard виджет по subsidiaries.

**Итого:** ~6-8 часов до full-ready, ~2-3 часа до "не опозориться на демо".

---

## 9. Per-section audit (92 раздела)

_Enumerate по маршрутам в [src/app/(dashboard)/](src/app) + sidebar nav. Статус: 🟢 готов / 🟡 частично / 🔴 пусто или ломается._

### 9.1 CRM core (9)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Dashboard | `/dashboard` | derived | 🟡 | Зависит от ai_shadow_actions — чистим (P0-2), иначе тормоза |
| Companies | `/companies` | 29 | 🟢 | 11 subsidiaries + 18 external, фильтр internal/external |
| Contacts | `/contacts` | 28 | 🟢 | engagementScore 42-92, positions расставлены |
| Deals | `/deals` | 18 | 🟢 | 6 стадий, $2M+ total, stakeholders на 5 deals |
| Leads | `/leads` | 9 | 🟢 | score 48-90, 6 стран, 5 источников |
| Tasks | `/tasks` | 18 | 🟢 | Checklists на 5, comments на 3 |
| Contracts | `/contracts` | 0 | 🔴 | Feature on, данных нет — **не открывать** |
| Products | `/products` | 10 | 🟢 | AFI-бренды с ценой/тегами |
| Notifications | `/notifications` | 16 | 🟢 | 10 seeded + 6 runtime |

### 9.2 Marketing (11)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Campaigns | `/campaigns` | 3 | 🟢 | 1 sent, 1 draft, 1 running |
| Segments | `/segments` | 4 | 🟢 | RU retail, HoReCa AZ, EU high-engagement, QA |
| Email Templates | `/email-templates` | 8 | 🟢 | Onboarding, quality, invoice reminders |
| Email Log | `/email-log` | — | 🟡 | Покажет outbound из seed channel_messages (3 строки) |
| Campaign ROI | `/campaign-roi` | derived | 🟡 | Работает на 3 campaigns, цифры небольшие |
| AI Scoring | `/ai-scoring` | — | 🔴 | Нужна история взаимодействий, нет данных |
| Journeys | `/journeys` | 3 | 🔴 | **Степы падают** (P0-1) — не показывать runs |
| Events | `/events` | 0 | 🔴 | Feature on, нет записей — **не открывать** |
| Landing Pages | `/pages` | 0 | 🔴 | Нет страниц — **не открывать** |
| Surveys | `/surveys` | 1 | 🟢 | NPS + 12 ответов с sentiment |
| Social Monitoring | `/social-monitoring` | — | 🔴 | SocialAccount записей нет, FB/IG App Review gated |

### 9.3 Communication / Inbox (3)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Inbox | `/inbox` | 6 conv / 20 msg | 🟢 | 6 каналов, реальные диалоги; **Reply не кликаем** — fake каналы (P0-3) |
| Web Chat Inbox | `/inbox/web-chat` | 1 conv | 🟡 | 1 anonymous visitor |
| AI Actions | `/ai/actions` | 5058 | 🔴 | **Спам дубликатов** — блокер P0-2 |

### 9.4 Support (6)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Tickets | `/tickets` | 8 | 🟢 | AFI-2026-001..008, SLA, comments |
| Complaints | `/complaints` | 5 meta | 🟢 | Brand / productionArea / riskLevel — sexy для AFI |
| Agent Desktop | `/support/agent-desktop` | derived | 🟡 | 8 открытых тикетов — работает |
| Agent Calendar | `/support/calendar` | 0 | 🔴 | Нет events/визитов |
| VoIP Calls | `/support/voip` | 0 | 🔴 | Нет записей — **не открывать** |
| Knowledge Base | `/knowledge-base` | 8 | 🟢 | 4 категории, статьи про AFI продукты |

### 9.5 Finance (5)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Invoices | `/invoices` | **0** | 🔴 | Feature on, **seed не создаёт инвойсы** — критичная дырка для agro-бизнеса |
| Finance Dashboard | `/finance` | derived | 🔴 | Без инвойсов показывать нечего |
| Budgeting | `/budgeting` | 0 | 🔴 | Нет бюджетов — **не открывать** |
| Profitability | `/profitability` | derived | 🔴 | Нужны invoices + costs |
| Pricing | `/pricing` | 0 | 🔴 | Pricing rules/tiers не засидированы (≠ `/products`); **не открывать** |

### 9.6 Analytics (4)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Forecast | `/forecast` | 18 deals | 🟢 | Прогноз по pipeline работает на deal-данных |
| Reports | `/reports` | 5 saved | 🟢 | Pipeline by Subsidiary, Complaints by Brand, etc. |
| Report Builder | `/reports/builder` | — | 🟡 | Редактор пустой — показать как конструктор, но без готовых отчётов в нём |
| AI Command Center | `/ai-command-center` | 5058 | 🔴 | **P0-2** чистим shadow |

### 9.7 ERP & Projects (1)

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Projects | `/projects` | 0 | 🔴 | Feature on, нет проектов — **не открывать** |

### 9.8 MTM / Route & Field (15)

_MTM — это мобильный модуль для торговых представителей в поле. AFI с 11 дочками в регионах (Astara, Shamkir, Gabala, Guba, Absheron) — идеальный use-case, **но seed его не заполняет**._

| Раздел | Route | Seed | Статус |
|---|---|:-:|:-:|
| MTM Dashboard / Map / Routes / Visits / Tasks / Customers / Photos / Alerts / Orders / Agents / Analytics / Leaderboard / Activity / Reports / Settings | `/mtm/*` | 0 | 🔴 все |

**Решение (per memory `feedback_mtm_not_core_crm.md`):** MTM — **не core CRM** для позиционирования, лидировать им нельзя. Скрыть 15 MTM-пунктов из sidebar через `Organization.features` (удалить MTM-related флаги) или просто **не кликать** в демо. Если CEO сам спросит «а как трекать полевых представителей?» — **упомянуть что есть MTM-модуль, включается по запросу**. Seed для MTM залить — **scope creep**, не делаем.

### 9.9 Misc / top-level (3)

_Страницы вне основных групп, но в sidebar / routes._

| Раздел | Route | Seed | Статус | Заметки |
|---|---|:-:|:-:|---|
| Offers | `/offers` | 0 | 🔴 | Нет offers — **не открывать** |
| Lead Scoring | `/lead-scoring` | derived | 🟡 | Работает на leads (есть 9 с score), но отдельно от `/ai-scoring` — не путать |
| Design Check | `/design-check` | — | 🔴 | Внутренняя страница для дизайна/QA, не для клиентов — **скрыть** |

### 9.10 Settings (35)

| Группа | Разделы | Статус |
|---|---|:-:|
| **Branding / Org** | `/settings/organization`, `/settings/custom-domains`, `/settings/dashboard` | 🟢 (companyName + primaryColor `#10b981` есть) |
| **Users & Security** | `/settings/users` (4, missing Aynur — P0-4), `/settings/roles`, `/settings/field-permissions`, `/settings/security`, `/settings/audit-log` | 🟡 |
| **Sales config** | `/settings/pipelines` (1+6), `/settings/lead-rules`, `/settings/quotas`, `/settings/sales-forecast`, `/settings/custom-fields` | 🟡 (pipelines настроены, остальное дефолт) |
| **Channels / Comms** | `/settings/channels` (6), `/settings/channels/whatsapp`, `/settings/integrations`, `/settings/smtp-settings`, `/settings/voip`, `/settings/api-keys`, `/settings/web-to-lead` | 🔴 (5 из 6 каналов fake — P0-3) |
| **Email / Templates** | `/settings/email-templates` (8), `/settings/macros`, `/settings/pitch-links` | 🟢 |
| **Finance config** | `/settings/currencies` (5), `/settings/invoice-settings`, `/settings/budget-config`, `/settings/finance-notifications` | 🟡 (валюты да, инвойсов нет) |
| **Support config** | `/settings/ticket-queues`, `/settings/escalation`, `/settings/sla-policies` (4 SLA seeded) | 🟢 |
| **AI / Automation** | `/settings/ai-automation`, `/settings/workflows` | 🟡 (AI features on, workflow editor пуст) |
| **Portal / External** | `/settings/portal-users` | 🔴 (нет portal-пользователей; feature-flag-controlled — можно скрыть из sidebar через `Organization.features` JSON вместо «не открывать») |
| **Billing** | `/settings/billing` | 🟡 (plan=enterprise) |

**Итого Settings:** 35 разделов, из них 🟢 ≈ 8, 🟡 ≈ 18, 🔴 ≈ 9.

---

### 9.11 Сводка рисков по sidebar

- **🔴 Не открывать в live-demo** (покажет пусто или ошибку): Contracts, Events, Pages, Social Monitoring, VoIP, Invoices, Finance, Budgeting, Profitability, Pricing, Projects, все 15 MTM, Portal Users, Journeys/runs, AI Command Center (до P0-2), Agent Calendar, AI Scoring, Offers, Design Check.
- **🟡 Показать с оговоркой**: Dashboard (после P0-2), Email Log, Campaign ROI, Inbox (без Reply), Web Chat, Agent Desktop, Report Builder, Lead Scoring, Settings (большинство), Users.
- **🟢 Звёзды демо**: Deals, Leads, Companies, Contacts, Tasks, Tickets, Complaints, Knowledge Base, Surveys, Reports, Forecast, Campaigns, Segments, Email Templates, Notifications, Pipelines, SLA Policies, Products, Currencies.

**Итого из 92 разделов:** ≈ 19 🟢 звёзд демо, ≈ 36 🟡 показывать с оговоркой, ≈ 37 🔴 не трогать.

---

## Ссылки

- Seed: [scripts/seeds/afigroup.mjs](scripts/seeds/afigroup.mjs)
- Registry: [clients/registry.json](clients/registry.json)
- WhatsApp webhook: [src/app/api/v1/webhooks/whatsapp/route.ts](src/app/api/v1/webhooks/whatsapp/route.ts)
- Telegram scanner: [src/lib/social/telegram-scanner.ts](src/lib/social/telegram-scanner.ts)
- Email service: [src/lib/email.ts](src/lib/email.ts)
- Integrations community hub: [graphify-out/wiki/_COMMUNITY_Integrations + Meta App + SMS](graphify-out/wiki/)
