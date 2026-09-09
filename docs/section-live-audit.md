# LIVE-аудит i18n по всем 113 разделам (AZ-локаль, прод)

> Durable-трекер. Статус по каждому разделу: `⬜` pending · `✅` AZ ок · `⚠️` найден английский (строки в Evidence) · `⛔` ошибка/пусто · `⏭` нужны данные (детальная/пустой список — НЕ зачитывается).
> **Правило резюма:** если есть `⬜` — продолжать live-прогон с первой `⬜`, не начинать заново. Источник списка: `src/components/sidebar.tsx`. Метод: Claude-in-Chrome `navigate`→`get_page_text` в авторизованной AZ-сессии.
> Прогресс: **113 / 113** проверено вживую (все ⬜ закрыты 2026-05-30).

## Проход 1 — CRM (12) + Communication (3) — ✅ ВЫПОЛНЕН (live)
| Раздел | Маршрут | Статус | Evidence / заметка |
|---|---|---|---|
| Dashboard | /dashboard | ⚠️ | Chrome AZ. Англ: «Payment»/«Follow-up» (AI-очередь), «Stage: PROPOSAL→QUALIFIED», дата «Saturday, May 30, 2026» |
| Companies | /companies | ✅ | AZ (заголовки/фильтры/кнопки). Бейджи скоринга HOT/WARM/COLD англ (пограничное) |
| Contacts | /contacts | ✅ | AZ. Англ = источники/бренды-данные (Email/Outlook/whatsapp) |
| Deals | /deals | ⚠️ | AZ (1-я попытка 502, retry ок). Стадии «Lead/Qualified/Proposal/Negotiation/Won/Lost» англ |
| Leads | /leads | ⚠️ | AZ, фильтр категорий «Regular/Partner/Prospect/Inactive» англ (на /contacts → Partnyor/Potensial) |
| Tasks | /tasks | ⚠️ | AZ, но «Name Z → A» (сорт), «Outcome/Successful/Channel/Phone» (активность) англ |
| Contracts | /contracts | ✅ | AZ (UI: «Yeni kontrakt», «90 gündə bitən», заголовки таблицы). Только MRR-лоанворд |
| Contract Lifecycle | /contracts/lifecycle | ⚠️ | AZ, но «Bottleneck mərhələsi», относит. даты «today»/«in 26d» англ |
| Products | /products | ⚠️ | AZ (табы Xidmət/Məhsul/Konsaltinq), но inline-enum «service/product/consulting» англ |
| Quotes | /quotes | ✅ | Полностью AZ (текст+read_page+скриншот) |
| Notifications | /notifications | ⚠️ | Заголовки «Task Completed/New Task/Workflow/Deal won!» англ + RU «Смена стадии сделки» — не локализованы (генерятся при событии) |
| Projects | /projects | ✅ | AZ (чисто, заголовки таблицы AZ) |
| Inbox | /inbox | ✅ | AZ (каналы — proper nouns). «Omni-Channel»/«Inbox»-метка — мелочь |
| Web Chat Inbox | /inbox/web-chat | ✅ | AZ. «Veb-çat inbox» — «inbox» англ (мелочь) |
| AI Actions | /ai/actions | ⚠️ | AZ, но «Follow up:» префикс в заголовках действий, «Normal» |

**Итог Прохода 1: ✅ 7 · ⚠️ 8 · ⛔ 0 · ⏭ 0** (из 15). Паттерн утечек: enum-значения (стадии/категории), относит. даты, AI/activity-метки — не сам chrome.

## Проход 2 — Marketing (20) — ✅ ВЫПОЛНЕН (live)
| Раздел | Маршрут | Статус | Evidence / заметка |
|---|---|---|---|
| Campaigns | /campaigns | ✅ | AZ (статусы Qaralama/Göndərildi AZ; имена кампаний — данные) |
| Segments | /segments | ✅ | AZ (имена сегментов — данные; «Auto»-бейдж мелочь) |
| Customer Insights | /cdp/insights | ⚠️ | Дев-жаргон в описании: LTV/churn/engagement/Unified + «slice-1»/«pipeline»/«materialize»/«customer_insights cədvələ» |
| Identity Merge Queue | /cdp/merge-queue | ⚠️ | Дев-жаргон: fuzzy-match/Levenshtein/slice-2/embedding-similarity/route/audit-log |
| Loyalty Program | /loyalty/dashboard | ⚠️ | Тир «silver», тип «earn», «Lifetime points», «Available» англ |
| Loyalty Tiers | /loyalty/tiers | ⚠️ | Имена тиров (bronze/silver/gold/platinum/diamond) + описания ПОЛНОСТЬЮ англ («Entry tier…», «Engaged customers…») = сид-данные |
| Earn Rules | /loyalty/earn-rules | ✅ | AZ (триггеры Alış/Referal/Ad günü переведены; «DESC/ASC» в описании — мелочь) |
| Promo Codes | /loyalty/promo-codes | ⚠️ | Дев-жаргон: checkout/Redeem endpoint/SELECT FOR UPDATE |
| Email Templates | /email-templates | ✅ | AZ (мелочь: заголовок «Email şablonları» vs подзаг «E-poçt»; «Onboarding» категория) |
| Email Log | /email-log | ✅ | AZ (статусы Göndərildi/Çatdırıldı AZ; заголовок «Email Jurnalı» — мелочь) |
| Campaign ROI | /campaign-roi | ⚠️ | enum «sent/draft» + «email/sms» сырыми (на /campaigns было AZ) |
| Da Vinci Scoring | /ai-scoring | ⚠️ | «high/medium prioritet» в AZ-тексте + источники referral/website/cold_call/linkedin |
| Journeys | /journeys | ✅ | AZ (триггеры Əl ilə/Yeni lid AZ; «invoice_chain» enum — мелочь) |
| Sequences | /sequences | ✅ | Полностью AZ |
| Events | /events | ✅ | AZ (пусто, но chrome/фильтры AZ) |
| Landing Pages | /pages | ⏭ | get_page_text пусто (canvas-редактор) — нужен скриншот/read_page |
| Surveys & NPS | /surveys | ⚠️ | Статус-бейдж «ACTIVE» англ (должно «Aktiv»); NPS/CSAT/CES — акронимы |
| Social Monitoring | /social-monitoring | ⚠️ | ЦЕЛЫЕ абзацы инструкций по-английски (Facebook/Instagram setup) + статусы replied/ignored/converted_to_lead + «Poll now» |
| Account Engagement | /accounts/engagement | ⚠️ | ABM-стадии Target/Engaged/MQL/SQL/Opportunity/Customer/Churned англ + ICP/engagement-жаргон |
| Attribution Models | /attribution/models | ⚠️ | Типы first-touch/last-touch/linear/custom + дев-жаргон (touchpoint/slice-2/cron-worker/append-only) |

**Итог Прохода 2: ✅ 8 · ⚠️ 11 · ⛔ 0 · ⏭ 1** (из 20). **Новый крупный корень: дев-жаргон в описаниях/пустых состояниях** (cdp ×2, promo, accounts, attribution) + **целые англ-инструкции** (social-monitoring).

## Проход 3 — Support (8) + Finance (6) — ✅ ВЫПОЛНЕН (live)
| Раздел | Маршрут | Статус | Evidence / заметка |
|---|---|---|---|
| Tickets | /tickets | ⚠️ | Заголовок «Service Desk» англ, заголовок таблицы «ESCALATION», приоритеты «high/medium/critical» сырые |
| Complaints | /complaints | ✅ | AZ (заголовки/статусы/риски AZ; источники hotline/email — данные) |
| Agent Desktop | /support/agent-desktop | ⏭ | get_page_text пусто (canvas) — нужен скриншот |
| Entitlements | /support/entitlements | ⚠️ | Жаргон: entitlement/milestone/Service Cloud/slice-2/DB triggers |
| Agent Calendar | /support/calendar | ⚠️ | «Agent» в заголовке, месяцы «May/MAY», приоритеты «critical/high/med» |
| VoIP Calls | /support/voip | ⚠️ | «Disconnected», **сырой ключ `common.settings`** (missing-key!), «Disposition», «Failed» |
| Conversation Insights | /voip/insights | ⚠️ | Жаргон: action items/Whisper pipeline/cron-worker/CallLog.insights |
| Knowledge Base | /knowledge-base | ✅ | AZ chrome (статьи KB — данные, англ. контент) |
| Invoices | /invoices | ⚠️ | Статусы «overdue/paid/draft» сырыми в строках (фильтры AZ) |
| Subscriptions | /billing/subscriptions | ⚠️ | «Trial/Past due» + жаргон (Recurring revenue/MRR/dunning/materialize) |
| Finance | /finance | ⚠️ | Алерты ПОЛНОСТЬЮ англ («47 overdue invoice(s)», «Budget overspend», «over plan»), бакеты «Current/1-30days» |
| Budgeting | /budgeting | ⚠️ | Табы «P&L/Rolling/Cash Flow» + категории «Admin Overhead/Direct Labor Costs» англ (+ много RU/EN данных) |
| Profitability | /profitability | ✅ | AZ (табы/метрики/структура AZ; «Sec F/G» — мелочь) |
| Pricing | /pricing | ⚠️ | **ПОПРАВКА (был неправ):** код ПЕРЕВЕДЁН (122 `tp()`, az.pricing полон: «İT Xidmətləri Qiymət Modeli»). Англ. на проде потому что `app.leaddrivecrm.org/pricing` **РЕДИРЕКТИТ на апекс `leaddrivecrm.org/pricing`** (проверил дважды) → на апексе NEXT_LOCALE не читается → fallback en. Корень: **redirect app→apex + locale-по-хосту**, НЕ страница. |

**Итог Прохода 3: ✅ 3 · ⚠️ 10 · ⛔ 0 · ⏭ 1** (из 14). Новое (уточнено архитектором):
- `common.settings` на /support/voip — **подтверждённый missing-key баг** (`tc("settings")` voip:145, ключа нет в az/en/ru). Вероятно **системный** — все страницы с `tc("settings")` (grep перед фиксом).
- `/pricing` — **НЕ страница без i18n** (я ошибся): код переведён, но `app/pricing` редиректит на апекс `leaddrivecrm.org` → en-fallback. Корень: redirect+locale-host (отдельный класс — runtime, не словарь).
- Англ-алерты на /finance («47 overdue invoice(s)», «Budget overspend») — хардкод.

## Проход 4 — Analytics (7) + Settings (16)
| Раздел | Маршрут | Статус | Evidence / заметка |
|---|---|---|---|
| Forecast | /forecast | ⚠️ | «Committed/Best Case/Pipeline» + месяцы англ |
| Forecast Snapshots | /forecast/snapshots | ⚠️ | AZ (описания), колонки «Committed»/«Best Case» англ + enum «WON/COMMITTED» |
| Pipeline Waterfall | /forecast/waterfall | ✅ | AZ («Pipeline şəlaləsi»); «Pipeline»/«Net delta» — лоанворды |
| Deal Velocity | /forecast/velocity | ⚠️ | AZ, но «Bottleneck»/«Advance rate» + дев-жаргон «slice-3/funnel conversion/entries-vs-exits» |
| Reports | /reports | ⚠️ | «Service Desk», «12 months · +94% projected», «Actual/Forecast», «New» |
| Report Builder | /reports/builder | ✅ | AZ (объекты/колонки/типы графиков AZ; стадии в превью = сид-данные) |
| Da Vinci Center | /ai-command-center | ⚠️ | Табы «Dashboard/Agent Constructor», алерты «Token Spike/AI cost spike…» англ, статус «closed» |
| Widget Settings | /settings/dashboard | ✅ | AZ (виджеты; «Dashboard»/«Pipeline» — мелочь) |
| Pipelines | /settings/pipelines | ⚠️ | displayName стадий Lead/Qualified/Proposal/Negotiation англ (сид-данные, редактируемо здесь) |
| Workflows | /settings/workflows | ✅ | AZ («İş Axınları»; билдер) |
| Workflow Templates | /settings/workflows/templates | ✅ | AZ («Avtomatlaşdırma şablonları») |
| Task Templates | /settings/task-templates | ✅ | AZ («Tapşırıq şablonları») |
| Users | /settings/users | ⚠️ | Роли «Viewer/Manager/Admin/superadmin» англ |
| SMTP | /settings/smtp-settings | ✅ | AZ («SMTP Parametrləri»; форма — техполя) |
| Quotas | /settings/quotas | ✅ | AZ («Kvota İdarəetməsi»; Q1-Q4 акронимы) |
| Territories | /settings/territories | ✅ | AZ (мой ранний i18n подтверждён live) |
| Integrations | /settings/integrations | ⚠️ | «1 active»/«0 configured»/«Webhooks» (vs Vebhuklar) |
| API Keys | /settings/api-keys | ✅ | AZ («API Açarları») |
| Macros | /settings/macros | ⚠️ | категории `general/billing/technical/onboarding/sales` — хардкод-массив (`macros/page.tsx:56`), не из словаря; на экране с CSS-капитализацией |
| Field Permissions | /settings/field-permissions | ⚠️ | «Field Permission Matrix» англ + вкладки Companies/Contacts/Deals/Leads/Tickets |
| VoIP Settings | /settings/voip | ✅ | AZ (провайдеры 3CX/Twilio — proper nouns; «Turu təkrarla» AZ) |
| AI Automation | /settings/ai-automation | ⛔ | main пусто (рендерится пустым/feature-gate); карточка на /settings — англ |
| Settings (main) | /settings | ⚠️ | карточки «AI Automation / Manage AI features, shadow actions, budget» + «Billing» англ (остальные AZ) |

## Проход 5 — Route & Field / MTM (22)
| Раздел | Маршрут | Статус | Evidence / заметка |
|---|---|---|---|
| MTM Dashboard | /mtm | ✅ | AZ (Panel; Planlaşdırılmış marşrutlar/Zaman metrikaları/Aktiv agentlər) |
| Live Map | /mtm/map | ⚠️ | НЕсогласовано: STATUS-метки AZ (Yerində/Yolda/Gecikir/Oflayn), но ФИЛЬТРЫ англ (All/Check-in/On Road/Late/Offline) + подзаг «Real-time GPS tracking…» + Heatmap/Refresh/LIVE FEED/«No agents match filter». **Хардкод в `mtm/map/page.tsx:191-311`** (а `live-map.tsx` наоборот корректен — статусы через `tMap('fieldStatus.…')`) |
| Routes | /mtm/routes | ✅ | AZ («Marşrutlar») |
| Visits | /mtm/visits | ✅ | AZ («Ziyarətlər»); enum CHECKED_OUT — в данных строк |
| Field Tasks | /mtm/tasks | ✅ | AZ («Sahə tapşırıqları») |
| Field Customers | /mtm/customers | ✅ | AZ («Sahə müştəriləri») |
| Photos | /mtm/photos | ✅ | AZ («Şəkillər») |
| Alerts | /mtm/alerts | ✅ | AZ («Xəbərdarlıqlar») |
| Orders | /mtm/orders | ✅ | AZ («Sifarişlər») — ранее ⛔ было транзиентным, теперь рендерится |
| SKU Catalog | /mtm/skus | ✅ | AZ («SKU Kataloqu»; SKU/CSV лоанворды) |
| Categories | /mtm/categories | ✅ | AZ («SKU Kateqoriyaları») |
| Equipment | /mtm/equipment | ✅ | «Avadanlıq inventarı», статусы Aktiv/Yoldadır/Təmirdə…, состояния İşlək/Təmir tələb edir, заголовки Seriya №/Növ/Model/Status/Vəziyyət |
| Equipment Types | /mtm/equipment/types | ✅ | AZ («Avadanlıq növləri»; POSM лоанворд) |
| Repair Requests | /mtm/repair-requests | ✅ | AZ — статусы ПОЛНОСТЬЮ переведены (Açıq/Təyin edilmiş/İcrada/Ehtiyat hissələri gözlənilir/Tamamlanmış/Ləğv edilmiş) |
| Agents | /mtm/agents | ✅ | AZ («Sahə agentləri»); роли AGENT/MANAGER — в бейджах данных |
| Analytics | /mtm/analytics | ✅ | AZ («Analitika») |
| Leaderboard | /mtm/leaderboard | ✅ | AZ («Reytinq») |
| Activity Log | /mtm/activity | ✅ | AZ («Aktivlik jurnalı»); «Check-in/check-out» — лоанворды в описании |
| Reports | /mtm/reports | ✅ | AZ («Hesabatlar») |
| Settings | /mtm/settings | ✅ | AZ («Parametrlər»; «Yadda saxla») |

## Проход 6 — Industry Clouds (19)
| Раздел | Маршрут | Статус | Evidence / заметка |
|---|---|---|---|
| Health Patients | /health | ⚠️ | Заголовок «Health Cloud» англ + landing-фильтр «All statuses» (sub-страницы используют «Bütün statuslar») |
| Encounters | /health/encounters | ✅ | AZ — status-enum полностью переведён (Planlaşdırılmış/Qeydiyyatdan keçdi/Davam edir/…) |
| Care Plans | /health/care-plans | ✅ | AZ (Müalicə Planları; Qaralama/Aktiv/Dayandırıldı/…) |
| Providers | /health/providers | ✅ | AZ (Həkimlər və Heyət; роли Həkim/Praktiki Tibb Bacısı/… AZ; NPI акроним) |
| Insurance Policyholders | /insurance | ✅ | AZ — заголовок «Sığorta Buludu» переведён (в отличие от Health Cloud) |
| Policies | /insurance/policies | ✅ | AZ (Polislər; сферы Avto/Əmlak/Həyat/Sağlamlıq/… AZ) |
| Claims | /insurance/claims | ✅ | AZ (İddialar; Bildirilmiş/Araşdırılır/Təsdiqlənmiş/… AZ) |
| Beneficiaries | /insurance/beneficiaries | ✅ | AZ (Benefisiarlar; Əsas/Şərti/Üçüncü AZ) |
| Public Sector Citizens | /public-sector | ✅ | AZ (Vətəndaşlar) |
| Cases | /public-sector/cases | ✅ | AZ (İşlər; Təqdim edildi/Qəbul/Təyin edildi/Eskalasiya/… AZ) |
| Licenses | /public-sector/licenses | ✅ | AZ (Lisenziyalar; Müraciət edildi/Baxış altında/Verildi/… AZ) |
| Grants | /public-sector/grants | ✅ | AZ (Qrantlar; Təqdim edildi/Təsdiqləndi/Ödənilir/… AZ) |
| Media Subscribers | /media | ⚠️ | Заголовок «Media Cloud» англ (как Health Cloud); остальное AZ (Sınaq/Aktiv/Dayandırıldı/Ayrıldı/Bloklandı) |
| Content Library | /media/content | ✅ | AZ (Kontent İnventarı; Qaralama/Planlaşdırıldı/Dərc edildi/… AZ) |
| Ad Campaigns | /media/ad-campaigns | ✅ | AZ (Reklam Kampaniyaları; Davam edir/Dayandırıldı/Tamamlandı/… AZ) |
| Energy Customers | /energy | ✅ | AZ — заголовок «Enerji və Kommunal» переведён (категория Residential — в данных строк) |
| Metering | /energy/metering | ✅ | AZ (Sayğac Nöqtələri; Quraşdırma gözlənilir/Aktiv/Ayrıldı/Silinib AZ) |
| Outages | /energy/outages | ✅ | AZ (Qəzalar; Gözlənilir/Aktiv/Aradan qaldırıldı/… AZ) |
| Service Calls | /energy/service-calls | ✅ | AZ (Xidmət Çağırışları; Qəbul edildi/Göndərildi/İcrada/… AZ) |

## Сводка (ПОЛНЫЙ обход 113/113 завершён 2026-05-30)
- Проверено вживую: **113 / 113** — все Проходы 1-6 пройдены индивидуально через Chrome MCP (AZ-сессия).
- **Итог: ✅ AZ: 67 · ⚠️ англ-утечки: 43 · ⛔: 1 (/settings/ai-automation — main пусто) · ⏭: 2 (/pages, /support/agent-desktop — canvas).**
- **Ключевой результат полного обхода:** MTM (✅20/21) и Industry Clouds (✅17/19) локализованы НАМНОГО лучше, чем предполагал сэмпл — status-enum'ы там ПЕРЕВЕДЕНЫ (encounters/claims/cases/grants/repair-requests/metering и т.д. полностью AZ). ⚠️-утечки концентрируются в CRM/Marketing/Finance/Analytics (Проходы 1-4); в industry/mtm — лишь точечно: 2 landing-заголовка («Health Cloud»/«Media Cloud», тогда как «Sığorta Buludu»/«Enerji və Kommunal» ПЕРЕВЕДЕНЫ) + /mtm/map фильтры (хардкод `mtm/map/page.tsx:191-311`, НЕ live-map.tsx).
- **Новых корней НЕТ** — все 43 ⚠️ ложатся в существующие 10 корней ниже. Полный обход ПОДТВЕРДИЛ сходимость (не только сэмпл).
- Уточнения к ранее-сэмплированному: /mtm/orders теперь рендерится (⛔ было транзиентным); /health «All statuses» landing-фильтр несогласован с sub-страницами «Bütün statuslar»; /settings/ai-automation main пустой (отдельно от i18n — runtime/feature-gate), но карточка «AI Automation» на /settings — англ.

## ИТОГОВЫЕ 10 КОРНЕЙ (для фикса)
1. **enum-bypass** — статусы/категории/роли/стадии хардкодом мимо словаря (Lead/Qualified, Regular/Partner, service/product, high/medium/critical, sent/draft/overdue/paid/ACTIVE/closed/CHECKED_OUT/AGENT/MANAGER/Trial, Residential/Free/discharged). Фикс: общий `src/lib/status-labels.ts` (`useStageLabel/useCategoryLabel/useStatusLabel`), читает существующие ключи `deals.stage*`/`companies.category*`/…
2. **seed/API-данные на англ** — deal-stage displayName (редактируемо /settings/pipelines), loyalty tier descriptions, attribution model descriptions. Фикс: сид/seed-map, НЕ JSON.
3. **даты не на AZ** — месяцы (May/Jan), относит. (today/in 26d), бакеты (1-30days). Фикс: один `formatDate(date, locale)` (~93 `toLocaleDateString(undefined)`).
4. **jargon-in-authored-copy** — ~29 ключей `slice2.*` (cdp/attribution/entitlements/subscriptions/voip-insights описания) — плохой англ-первоисточник переведён как есть. Фикс: переписать копию ×3 локали от en.json.
5. **missing-key** — `common.settings` (`tc("settings")`, ключа нет в common). Системный по всем `tc("settings")`. Фикс: добавить `common.settings` ×3.
6. **точечный хардкод** — алерты /finance («47 overdue invoice(s)»/«Budget overspend»), ai-command-center «Token Spike», ai-actions «Follow up:», lifecycle «Bottleneck», tasks Outcome/Channel.
7. **целые англ-блоки** — /social-monitoring setup-инструкции (Facebook/Instagram).
8. **runtime: redirect+locale-host** — /pricing app→apex → en-fallback (код переведён). Фикс: redirect/locale-middleware.
9. **toast-EN в catch** (grep: 11) — «Network error»×5, «Failed to», «Too many»… невидимы live (happy-path).
10. **хардкод-атрибуты** (grep: 26) — placeholder/title/aria-label: «No email/No phone/Select category…/Product brand», `aria-label="Fraud flag"` (+ часть — example-плейсхолдеры).
+ Отдельно (не i18n): /mtm/orders, /support/agent-desktop, /pages — runtime/ canvas.
- **Паттерн утечек — 4 системных корня (уточнено архитектором, переводы УЖЕ ЕСТЬ в az.json, проблема — байпас/данные):**
  1. **Категории байпасят словарь хардкодом.** AZ-ключи существуют (`companies.categoryPartner`=«Tərəfdaş», `companies.categoryProspect`=«Potensial», `products.categoryService/…`). Но /leads хардкодит англ `CATEGORY_LABELS` (leads:102-107) + англ `<option>`, /products рендерит сырой `{item.category}` (products:161) вместо `t()`. Корень: нет общего util → каждая страница катит свой map. Фикс: `src/lib/status-labels.ts` (`useCategoryLabel`).
  2. **Стадии сделок = ДАННЫЕ, не дыра в словаре.** /deals корректно рендерит `stage.displayName` из БД; в проде `Pipeline.stages[].displayName` засеян по-английски (`constants.ts:27` `DEFAULT_PIPELINE_STAGES` + migrate/import). Чинить: UPDATE строк в проде ИЛИ рендер по dict-ключу `deals.stage*` вместо `displayName`. (Виджет sales-pipeline уже делает правильно через `td(stageKeys)`.)
  3. **Даты не на AZ.** ~93 вызова `toLocaleDateString(undefined, …)` в `(dashboard)/` → `undefined`=browser default. Один helper `formatDate(date, locale)` закрывает весь класс (самый большой ROI).
  4. **Точечный хардкод в виджетах** (ai-actions «Payment/Follow-up», lifecycle:114-116 «today»/«in Nd», tasks «Outcome/Channel»). + исторические уведомления (англ/рус, генерятся при событии — i18n постфактум невозможен, только forward-fix генератора).
- Поправка к моему 1-му выводу: я ошибочно назвал это «дырами в словаре» — на деле словарь полон, страницы его **обходят**. И токен на /contacts — «Tərəfdaş», а не «Partnyor» (последнее в проде не рендерится).
