# Roadmap: закрытие гэпов после анализа Creatio 10X (июль 2026)

### Основано на: разбор релиза Creatio 10X Unlimited (15.07.2026) + аудит нашего кода
### Связанные документы: `docs/roadmap-to-salesforce-level.md`, `docs/crm-comparison-audit-2026.md`
### Источники: creatio.com/page/10x-release, academy.creatio.com → 10X Unlimited release notes

---

## Сводная таблица

| Эпик | Что даёт | Усилия | Приоритет | Фаза |
|---|---|:---:|:---:|:---:|
| A. AI Trust Pack (inbox/email) | Безопасно включить автоответы AI на 100% | ~3-4 нед | P0 | 1 |
| B. Метрики AI по каналам | Витрина эффективности AI для владельца | ~1-1.5 нед | P0 | 1 |
| C. Live web-трекинг + бэкфилл | Поведение посетителей сайта в карточке контакта | ~3 нед | P1 | 2 |
| D. MEDDPICC на сделке | Enterprise-квалификация сделок | ~1 нед | P1 | 2 |
| E. Sequences 2.0 | Полноценный холодный аутрич (треды, реакции, отписка) | ~3-4 нед | P1 | 3 |
| F. Конструктор AI-агентов | Клиент сам собирает агентов без кода | ~4-6 нед | P2 | 4 |
| G. MTM Offline (PWA) | Полевые агенты работают без сети | ~4-6 нед | P2 | 4 |
| H. UI-фиделити 1:1 под Creatio | Раскладка карточек сделки/лида как в референсе | ~1-1.5 нед | P1 | UI-трек |

> Один разработчик: Фазы 1-3 ≈ 3 месяца. Фаза 4 — отдельные кварталы, по решению после Фазы 3.
> Все оценки — чистое время разработки без записи help-video и перевода i18n (az/en/ru ≈ +10% на эпик).

---

## Статус выполнения (для автономных сессий: бери первый неотмеченный пункт)

Порядок: UI-трек → Фаза 1 → Фаза 2 → Фаза 3 → Фаза 4.
Правило отметки: ставить `[x]` только после: реализовано + typecheck +
i18n:check + браузерная проверка на стенде leaddrive-uxtest + коммит.
Блокеры записывать сюда же строкой под задачей.

- [x] H1. Сделка: чипы+Customer details внутрь правой колонки (d6620d7a4)
- [x] H2. Сделка: вкладки правой колонки
- [x] H3. Лид: Lead details во вкладку + карточки клиента
- [x] H4. Правая AI-рейка на xl
- [x] H5. Journeys: AI-лаунчер в конструкторе
- [x] H6. Цветовая калибровка по референсу (чипы; журнальные лейблы совпадали)
  - Примечание сессии 16.07: полный tsc даёт 25 ошибок, ВСЕ предсуществующие
    (mtm-код ветки ждёт prisma generate; тесты api-pages ссылаются на удалённые
    landing-pages роуты). В файлах эпика H ошибок нет. Полный tsc гонять с
    NODE_OPTIONS=8192 и exclude .next (dev-сервер раздувает типы до OOM).
- [x] A1. Quality scoring AI-ответов
  - Примечание сессии 16.07: судья `src/lib/ai/response-scorer.ts` встроен в
    social ai-autoreply (FB/IG/TG/VK/TikTok + flow ai_reply), WhatsApp Da Vinci
    и web-chat; скор в AiInteractionLog.qualityScore + metadata.aiQuality
    исходящего сообщения; isClarifyingQuestion сохраняется (принудительный
    черновик — в A2 вместе с draft-инфраструктурой). В rules-бот
    (chatbot-autoreply.ts) НЕ встроен осознанно: там фиксированный текст
    правила, LLM-судья не даёт сигнала. Проверка на стенде uxtest: e2e по
    живому HTTP (web-chat, виджет a1testkey) + БД; второй next dev из той же
    папки невозможен (Next 16 dev-lock), фича backend-only.
- [x] A2. Режимы Draft/Autoreply + пороги
  - Готово 17.07 (8fd2dddc6 backend + 6d7f9b7a7 UI): гейт `ai-reply-gate.ts`
    (draftMode / aiThreshold, fail-closed при сбое судьи, эскалация мимо
    гейта), драфты в SocialConversation.metadata.aiDraft + нотификация,
    операторский API send/discard, review-панель в треде инбокса, режим «AI:
    черновики» + пресеты порога в матрице каналов И в настройках web-chat
    (колонки aiDraftMode/aiThreshold на виджете, expand-миграция). Блокеры
    сняты: Whelp-WIP закоммичен (8be103782), браузерная проверка на стенде
    uxtest пройдена end-to-end (визитёр → драфт → панель → отправка).
    Дефолт: политика не задана → отправлять всё (поведение до A2).
- [x] A3. Audience rollout %
  - Готово 17.07 (d4408c29e): isInAiRollout (FNV-1a по conversationId, 0..99
    бакет, монотонно при повышении доли) в ai-reply-gate; проверка ДО
    генерации во всех путях (social/WA/web-chat) — исключённые не жгут
    токены (проверено на стенде: rollout 0% → лог расхода не растёт).
    Селект доли в матрице каналов и настройках web-chat; null = все.
    Flow ai_reply осознанно не гейтится (явная автоматизация ≠ аудитория
    автоответа).
- [x] A4. Тег «AI-generated»
  - Готово 17.07 (acd1403d0): бейдж «✨ AI» в мета-строке сообщения треда по
    metadata.aiAutoReply / aiGenerated (пишутся всеми AI-путями с A1/A2;
    правка оператором при аппруве драфта снимает флаг — семантика «после
    правки бейдж снимается» уже была в A2). WA Da Vinci: sendWhatsAppMessage
    получил extraMetadata — исходящий лог помечается + скор для A5. В
    карточке тикета AI-реплики уже маркированы префиксом «[Da Vinci Bot]».
    Проверено на стенде: бейдж только на AI-ответе.
- [x] A5. Debug view AI-ответа
  - Готово 17.07 (1ef9733b6): клик по бейджу «✨ AI» (admin/manager) → drawer
    «Как сформирован ответ»: оси судьи цветными барами, вердикт доставки
    (авто/причина драфта), источники БЗ (kbArticlesUsed теперь пишется),
    инструменты, модель/токены/стоимость/latency, обмен клиент↔ассистент.
    Связка через metadata.aiLogId на всех путях; GET
    /api/v1/ai-interaction-logs/[id] (роль+org scoped). На стенде drawer
    сразу показал пойманную судьёй галлюцинацию (grounded 0.30 без БЗ).
- [x] A6. Гранулярные лимиты AI
  - Готово 17.07: settings.aiLimits (диалог/контакт-день/токены), проверка ДО
    генерации во всех путях, fail-open (USD-бюджет — страховка), приветствие
    web-chat не считается; UI в карточке бюджета ai-automation; стенд: кап=1
    → второй вопрос молча к человеку. ЭПИК A ЗАКРЫТ ЦЕЛИКОМ.
- [x] B1. API агрегатов по каналам
  - Готово 17.07: GET /api/v1/inbox/stats/channels?days=7|30 — volume/FRT/
    resolved/aiResolved/effectiveness%/escalation% на канал; один SQL-проход
    (CTE как во frt-роуте), web-chat из своих таблиц, обе эры close-данных;
    0 resolved → null (не 0%). Дизайн Codex. Стенд: закрытие 2 bot-only
    сессий → effectiveness null→100%. Для B2: platform='inbox' (якоря
    email/sms) отдаётся как есть — витрине решать, как маппить.
- [x] B2. Витрина метрик в inbox
  - Готово 18.07 (PR #371): карточка «Эффективность каналов» на /inbox/analytics
    поверх B1-API — строка на канал: объём / первый ответ / доля закрытых AI
    (бар + n из m) / эскалации; окна 7 и 30 дней, карточка следует фильтру
    периода страницы, тренд-стрелка при отклонении 7д от 30д на ≥3 п.п.
    (channelAiTrend в lib/inbox-analytics.ts, юнит-тесты). platform='inbox'
    подписан «Email / SMS». Канальный фильтр страницы учитывается, под
    агент-фильтром карточка скрывается (у API нет per-agent разреза).
    Стенд uxtest 7/7. Попутно починен деплой-пайплайн: сборке на раннере
    не хватало памяти — добавлен swap на /mnt (3 падения 17.07 разобраны
    в коммитах eb6b766f6/7089c4a57).
- [x] C1. Скрипт трекинга + ingest
  - Готово 17.07 (ветка feat/c1-web-tracking): public/ldtrack.js (first-party
    cookie _ldv 400д, авто-pageview + SPA-хуки pushState, ldTrack('event'),
    батчи sendBeacon text/plain без preflight, GDPR-режим data-requires-consent
    → буфер без cookie до ldTrack('consent')); POST /api/v1/public/web-tracking
    (бот-фильтр C5, publicKey→org через bypass как у web-chat, origin-whitelist,
    rate-limit 60 батч/мин на key+IP, IP не хранится); модели WebTrackingConfig/
    WebSession/WebAction с FORCE RLS; сессия = 30 мин неактивности, first-touch
    UTM на сессии; карточка «Web-трекинг» в settings/integrations (сниппет,
    домены, retention); ночной крон web-tracking-cleanup (retentionDays,
    сшитые с контактом сессии не трогает). Стенд: сайт на :8077 → cookie,
    2 батча, 1 сессия (UTM newsletter/july, 3 действия) в БД; headless-Chrome
    пойман бот-фильтром (пришлось подменять UA в тесте — фильтр работает).
    tsc 0, RLS-gaps 0, i18n parity, route-тест 10/10. В matcher middleware
    добавлено исключение ldtrack.js (иначе 307 на /login).
- [x] C2. Склейка личности + бэкфилл
  - Готово 17.07 (PR #370): identify-endpoint (email/подписанный `_ldi`-токен,
    непрозрачный 200 против энумерации), токен в редиректах click/sms-click/
    ad-click (HMAC, TTL 15 мин, срезается сниппетом из адресной строки),
    `ldTrack('identify', email)`, cross-domain linker `_ldv` на hosted-формы
    `/f/…` + приём в виджете/сабмите; stitchVisitorToContact — идемпотентно,
    только анонимные сессии окна 30 дней. Ревью-фиксы: email-матч регистро-
    независимый (mode: insensitive), гонка первого визита закрыта (клиент
    flush→identify + серверный stub-session и re-claim), consent-режим не
    течёт токеном в pageview. Стенд uxtest e2e 15/15 (`.probe-c2-browser-check.mjs`,
    вкл. сценарий нового визитёра из клика и mixed-case email). ВАЖНО: при
    мерже параллельно въехал 8a52131b1 (isOriginAllowed 2-arg) — интеграцию
    поправили follow-up-коммитом на main. Долг: WebSession.contactId живёт
    мимо CDP merge-queue (при мерже контактов история не переезжает) —
    вынесено в отдельную задачу.
- [x] C3. Web-активность на карточке контакта
  - Готово 18.07 (PR #372): ленивая вкладка «Сайт» на карточке контакта —
    сессии C2 (дата/длительность/страницы/first-touch UTM/реферер), внутри
    визита пути страниц и события; hot-страницы подсвечены через ЕДИНЫЙ
    классификатор classifyPageUrl (account-engagement/track-pixel) —
    список HIGH_INTENT_PATH_PATTERNS расширен ru-слагами с decode
    кириллицы. GET /contacts/[id]/web-activity (withRls, капы 30/50,
    aggregate для totalSessions+totalPageViews). Тесты 12; стенд 8/8.
    Для C4: триггерить по web-действию можно тем же классификатором.
- [x] C4. Триггеры journeys по web-действию
  - Готово 18.07 (PR #373): ingest при батче на склеенной сессии выстреливает
    правила воркфлоу (contact / web_activity, fire-and-forget в tenant-скоупе).
    Сущность: поля контакта + pageUrl/eventName/isHighIntent (единый
    classifyPageUrl) + точные счётчики pageViews7d / highIntentViews7d.
    Шаблон hot-website-interest (посетил цены ≥2 раза за 7 дн. → задача high).
    Защиты по ревью: гейт по наличию правил (орги без правил платят один
    indexed count), кулдаун 6ч на контакт ПОСЛЕ совпадения (executeWorkflows
    теперь возвращает число совпавших правил; пустая оценка кулдаун не жжёт).
    Реализовано через workflows (общий механизм автоматизаций) — enrollment
    в journeys как отдельный action можно добавить позже одним case.
    Стенд e2e: клик из письма → /pricing → задача «Follow up: Alice C2».
- [x] D1. Вкладка MEDDPICC на сделке
  - Готово 18.07 (PR #374): вкладка MEDDPICC в правой колонке карточки —
    8 блоков (скор 1–5 + «почему» + «что дальше», хелпер на блок), сводный
    бейдж (не оценено/под угрозой/пробелы/квалифицирована + n/40) на лету;
    неоценённый блок ограничивает статус жёлтым. Deal.meddpicc JSONB
    (expand-миграция 20260718003000), форма в src/lib/meddpicc.ts
    (parseMeddpicc нормализует любой вход), PUT принимает поле, при
    отрезании field-permissions показывается честный тост, а не «сохранено».
    Стенд 9/9; юниты порогов/парсера.
- [x] D2. MEDDPICC-колонка в списках
  - Готово 18.07 (PR #374, вместе с D1): колонка в списке сделок + чипы на
    канбан-карточках (8 букв, красный 1–2/жёлтый 3/зелёный 4–5, тултипы;
    на канбане скрыты до первой оценки, в списке серые = «не оценено»),
    сортировка по общему скору (мемоизированная Map). D3 (AI-заполнение)
    остаётся опциональным P2. ФАЗА 2 ЗАКРЫТА ЦЕЛИКОМ (C1–C4, D1–D2).
    Примечание для следующих сессий: на стенде uxtest досеян дефолтный
    пайплайн «Продажи» (без него /deals висит в скелетоне) и сделка
    «D1 probe deal»; probe-скрипты .probe-c2/c3/c4/d1-browser-check.mjs
    в корне репо, идемпотентные.
- [x] D3. AI-заполнение MEDDPICC (опц.) — advisor читает переписку по сделке
    (Activity сделки + EmailLog её контактов), Haiku (strict-JSON, PiiMasker,
    cost в aiInteractionLog) предлагает черновые блоки {score 1-5, note, next};
    `parseMeddpicc` клампит вывод. Кнопка «Предложить из переписки» на вкладке
    MEDDPICC заполняет ТОЛЬКО пустые блоки (не затирает ручной ввод),
    помечает их бейджем «✨ AI» (снимается при правке), менеджер сохраняет
    обычным PUT (field-perms применяются). evidenceCount 0 → пустое состояние
    без вызова LLM. POST /deals/[id]/meddpicc/suggest (withRls): 200/404/502.
    Стенд 8/8 (нет переписки → 0; 2 активности+письмо → реальный черновик с
    валидными оценками; UI-кнопка). Юниты роут+хелпер. **Фаза 2 закрыта.**
- [x] E1. Email threading в sequences
  - Готово 18.07 (PR #376): follow-up письма каденции приходят в тот же тред —
    свои RFC Message-ID (<seq.…@reply-domain>, EMAIL_REPLY_DOMAIN — общая
    константа с email-reply-address), цепочка per enrollment
    (SequenceEnrollment.threading JSONB, кап 20), In-Reply-To/References +
    принудительное «Re: <тема первого письма>» при threadMode=continue;
    селектор «Тред: продолжить/новый» на email-шагах ≥2 в билдере (значение
    переживает edit round-trip). Ответ получателя перехватывает якорь:
    входящие персистят email_logs.inReplyTo (нормализация firstRfcMessageId —
    первый безопасный <id>-токен, отравленный id не может заблокировать
    follow-up'ы; dedup по нормализованному id). Стенд: e2e через реальный
    SMTP-захват (синк lvh.me:2525) 16/16 — msg2 In-Reply-To=msg1 + MIME «Re:»,
    msg3 заякорился на ответ получателя. Для E2: матчить входящие по
    email_logs.inReplyTo ∈ threading.messageIds.
    ПРОВЕРЕНО 18.07.2026 (тест через прод Resend-ключ → одноразовый ящик
    mail.tm, разбор сырых .eml): Resend (шлёт через Amazon SES) **переписывает
    кастомный Message-ID** на свой `<…@eu-west-1.amazonses.com>` — наш
    `<seq.…>` исчезает бесследно; но `In-Reply-To`/`References` доставляются
    дословно, а настоящий RFC-id отдаётся через `GET /emails/:id` (поле
    `message_id`, доступно сразу после отправки, совпало с доставленным).
    Следствие для орг на глобальном Resend-ключе: в threading.messageIds
    лежат id, которых не существует в ящике получателя → тредингу по
    References Gmail не на что опереться (спасает только эвристика по «Re:
    +тема», ненадёжно), и E2-матчинг ответов (inReplyTo ∈ messageIds) не
    сработает вовсе. ФИКС (СРОЧНО — E2 уже в проде, для Resend-орг реакции
    на ответы сейчас не срабатывают; чип создан): в sendViaResend после
    успешной отправки дёргать `GET /emails/:id`, возвращать из sendEmail
    фактический rfcMessageId; в send-email роуте подменять им минченый id
    в plan.nextThreading перед персистом (fallback при недоступности —
    минченый id, как сейчас). Порядок провайдеров не менять (деливерабилити
    Resend важнее); SMTP доказан на стенде, Postmark уважает Message-ID по
    докам. Комментарий «providers honor an explicit Message-ID header» в
    sequence-threading.ts устарел — поправить при фиксе.
- [x] E2. Реакции на ответы
  - Готово 18.07 (PR #378): реакция per sequence — SalesSequence.replyReaction
    stop/pause/continue (null = легаси exitOnReply; правило в
    resolveReplyReaction, селектор «При ответе:» в билдере). Пауза сохраняет
    nextStepAt (resume реактивирует). Каждый ответ — ОДНА high-задача
    владельцу «Client replied — …» с дедупом по открытой задаче (болтливый
    тред/N цепочек не заливают очередь). Третье лицо в треде (From ≠ email
    участника, per-enrollment проверка — «третье лицо» может быть контактом
    орга со своими цепочками; участник без email = unverifiable → тоже
    alert-only) — warning владельцу, цепочка живёт, repliedAt не ставится.
    fromEmail проброшен через email-inbound И омниканальный inbox-хук
    (senderEmail в emitConversationIngestEvents). Стенд через реальный
    inbound-роут: 12/12 (+9/9 после ревью-фиксов). Юниты 45 в s3-cadence.
- [x] E3. Unsubscribe / opt-out
  - Готово 18.07 (PR #382): каждое sequence-письмо — футер «Отписаться /
    Unsubscribe» + RFC 8058 (List-Unsubscribe + One-Click POST). Suppression =
    глобальная SurveyUnsubscribe (surveyId=null) — та же, что у маркетинга:
    одна отписка глушит кампании И каденции; send-путь проверяет ПЕРЕД каждой
    отправкой (transactional обходит маркетинг-чек) → 422 + стоп enrollment
    (opted_out). Отписка гасит все контакты/лиды с тем же email
    (регистронезависимо). Страница /unsubscribe?o&e&t (HMAC на org+email,
    exact-путь в middleware) — ВАЖНО: GET ничего не мутирует (почтовые
    сканеры ходят по ссылкам — отписка только по кнопке/Server Action; GET
    one-click endpoint'а 303-редиректит на подтверждение, мутация только
    POST по RFC 8058). Opt-out по звонку: исход «Opt-out» в очереди касаний
    (кнопка Ban) — стоп + suppression, `suppressed` в ответе честный.
    Стенд e2e через SMTP-захват: 17/17 (вкл. «сканер-GET пишет НИЧЕГО»).
    Юниты 11 + 3 route-кейса. Долг (в тик E-эпика): suppression-чек жил бы
    лучше опцией respectSuppression в sendEmail — при появлении новых
    transactional-отправителей каденций перенести туда.
- [x] E4. Дневной лимит отправки
  - Готово 18.07 (PR #383): per-org дневной лимит sequence-писем
    (Organization.settings.sequenceDailyEmailLimit; null = без лимита). Send-route
    проверяет ПЕРЕД отправкой → 429 без advance/stop (касание остаётся due,
    излишек на завтра). Счёт = EmailLog.sequenceId (новая метка), созданные с
    начала UTC-суток, реально ушедшие. sendEmail получил опциональный sequenceId
    во всех путях лога — фундамент для E5. GET/PATCH /api/v1/sequences/settings
    (PATCH manager/admin), бейдж «N/лимит за сегодня» + inline-редактор в шапке
    очереди, композер показывает «лимит достигнут» в локали. Expand-миграция:
    nullable EmailLog.sequenceId + индекс (org, sequenceId, createdAt). Стенд
    e2e через SMTP-захват 9/9 (лимит=1 → вторая отправка 429, письмо не ушло,
    enrollment не продвинут; поднятие капа разблокирует). Юниты 13.
- [x] E5. Live-статистика шагов + skip + reorder
  - Готово 18.07 (PR #385): skip уже был (SkipForward → outcome skipped).
    Добавлено: funnel-аналитика отдаёт activeHere на шаг (active-only
    groupBy(sequenceId, currentStep)) — сколько активных участников СЕЙЧАС на
    шаге, отдельно от кумулятивного reached; чип «N здесь» в UI. Reorder шагов
    в билдере (кнопки вверх/вниз, перенумеровывают stepOrder). Каверза
    (задокументирована): currentStep позиционный, редактирование порядка шагов
    у идущей секвенции переезжает «следующий шаг» активных enrollment — та же
    природа, что у removeStep/toggle isActive. Стенд 5/5 (activeHere=[1,1,0],
    reorder переставил #3→#1 в БД, skip продвигает). Юниты аналитики обновлены.
- [x] E6. Запрет двойного enrollment — org-настройка
    `settings.sequenceSingleActiveEnrollment` (по умолчанию выкл, opt-in): когда
    включено, контакт/лид может быть активен/на паузе не более чем в ОДНОЙ
    цепочке. `enrollOne` получил guard (findFirst по org+entity, `sequenceId != this`,
    status in active/paused) → новый исход `blocked_other_sequence`; single-enroll
    отдаёт 409 `{ blockedByOtherSequence }`, bulk считает в сводке, auto-enroll
    записывает лид только в первую подходящую цепочку. Тумблер для менеджера в
    шапке очереди; диалог записи показывает блок. Стенд 10/10 (вкл→A 201→B 409, без
    2-й записи; выкл→B 201, обе активны; UI-тумблер). Юниты: политика/роут/settings.
    Каверза: guard — мягкая политика без DB-constraint (partial unique нельзя —
    сломал бы opt-in), поэтому теоретический TOCTOU при гонке двух запросов; в
    ручном/последовательном (bulk, auto) UX пренебрежимо. **Эпик E закрыт.**
- [x] F. Конструктор AI-агентов — F1 (модель+рантайм) и F2 (UI-конструктор) уже
    были в кодовой базе: модель `AiAgentConfig` (persona/tone, systemPrompt,
    tool-whitelist, KB, лимиты, каналы, версии, isActive), рантайм-резолвинг
    `agent-router.ts`, CRUD `/api/v1/ai-configs`, редактор `AiConfigForm` в
    ai-command-center. Достроены недостающие срезы:
    F4 (PR #411) — экспорт/импорт переносимых определений: envelope без
    org/identity-полей, `GET /ai-configs/[id]/export` (attachment),
    `POST /ai-configs/import` (создаёт НЕактивный черновик v1, суффикс имени при
    коллизии, inbox→general, неизвестная модель→дефолт); кнопки Экспорт/Импорт.
    Стенд 12/12. F3 (PR #415) — тест-песочница: `POST /ai-configs/[id]/test`
    гоняет модель+персону БЕЗ инструментов и без записи данных (side-effect free),
    возвращает ответ+трейс (токены/стоимость/latency); диалог с кнопкой «Тест».
    Стенд 8/8 (task count не меняется). Юниты обоих срезов. **Эпик F закрыт.**
- [x] G. MTM Offline PWA — офлайн для веб-PWA полевого агента (существующий
    `mtm/mobile/sync/push` уже был; здесь — веб-слой поверх той
    же idempotent-модели `MtmSyncOperation`). Слайсы:
    G1 (#417) веб-outbox (IndexedDB) + `POST /mtm/sync/push` session-auth,
    офлайн чек-аут через `completeMtmVisit`. G2 (#420) push при
    переназначении/отмене визита не самим агентом (createNotification push).
    G3 (#422) офлайн чек-ин (guard «один открытый визит», reuse
    createVisitRequirementSnapshot). G4 (#426) офлайн опросы/визит-экшены
    (visit_action, гейт CHECKED_IN + снапшот). G5 (#428) read-cache маршрута дня
    в IndexedDB (SW в dev отключён → IDB, network-fail-only fallback, баннер).
    G6 (#430) офлайн фото — Blob в IndexedDB, аплоад на реконнекте с
    clientPhotoId (идемпотентно). Гейт «нельзя действия до чек-ина» уже был в
    `visits/[id]/actions`. Все слайсы: юниты + стенд-пробы (идемпотентность
    проверена — реплей не создаёт дублей). **Эпик G закрыт. ДОРОЖНАЯ КАРТА ЗАКРЫТА.**

---

## Фаза 1 (недели 1-4): доверие к AI — включаем автоматизацию на полную

### Эпик A: AI Trust Pack для inbox/email (P0, ~3-4 недели)

Фундамент уже есть: `src/lib/chatbot-autoreply.ts`, `src/lib/social/ai-autoreply.ts`,
`src/lib/ai/budget.ts`, `src/lib/ai/pii-masker.ts`, `src/lib/ai/prompt-safety.ts`,
API `ai-interaction-logs`, `ai-guardrails`. Не хватает слоя контроля качества и постепенного раскатывания.

#### A1. Quality scoring AI-ответов (1 неделя)
**Что**: перед отправкой AI-ответ оценивается LLM-судьёй по 3 осям: grounded (опирается на факты/KB), complete (полный ответ), accurate (не противоречит контексту). Итоговый скор 0-1 сохраняется с ответом.
**Зачем**: авто-отправка только уверенных ответов; всё остальное — черновик оператору. Это блокер для смелого включения автоответов.
**Как**:
- Новый модуль `src/lib/ai/response-scorer.ts`: один дешёвый LLM-вызов (haiku-класс), вход — вопрос клиента + контекст + сгенерированный ответ, выход — `{grounded, complete, accurate, total}`.
- Встроить в `chatbot-autoreply.ts` и в email-ветку inbox перед отправкой.
- Скор писать в metadata сообщения + в `ai-interaction-logs`.
- Если ответ содержит уточняющий вопрос — принудительно в черновик (как у Creatio Smart auto-reply).

**Файлы**: `src/lib/ai/response-scorer.ts` (новый), `src/lib/chatbot-autoreply.ts`, `src/lib/social/ai-autoreply.ts`, `prisma/schema.prisma` (metadata достаточно, миграция не нужна)
**Приоритет**: P0

#### A2. Режимы Draft-for-review / Autoreply + пороги (1 неделя)
**Что**: per-канал настройка: AI выключен / черновики / автоответ. Для автоответа — порог уверенности: Cautious 0.85 / Balanced 0.70 (default) / Bold 0.55, редактируемый.
**Зачем**: у каждого канала своя цена ошибки (WhatsApp клиенту ≠ анонимный веб-чат).
**Как**:
- Расширить конфиг канала (модель канала/`webChatWidget` и inbox-каналы): `aiMode: off|draft|auto`, `aiThreshold: float`.
- Ниже порога → создаётся черновик в диалоге со статусом «ожидает проверки», оператор может отправить/править.
- UI: вкладка «AI-автоматизация» в настройках канала (`settings/channels`, `settings/web-chat`, `settings/ai-automation` — объединить в один паттерн).

**Файлы**: `prisma/schema.prisma`, `src/app/(dashboard)/settings/ai-automation/`, `src/app/(dashboard)/settings/web-chat/page.tsx`, `src/app/api/v1/inbox/*`, `src/lib/chatbot-autoreply.ts`
**Приоритет**: P0

#### A3. Audience rollout % (2-3 дня)
**Что**: слайдер 0-100% — какая доля входящих диалогов обрабатывается AI; остальные сразу к людям.
**Зачем**: включать AI постепенно и смотреть на метрики (эпик B), прежде чем расширять.
**Как**: детерминированный hash(conversationId) % 100 < rollout — чтобы диалог не «мигал» между AI и человеком; поле в конфиге канала; учитывать в chatbot-autoreply до генерации (не жечь токены на исключённых).
**Файлы**: `src/lib/chatbot-autoreply.ts`, конфиг канала, UI настроек канала
**Приоритет**: P0

#### A4. Тег «AI-generated» (2-3 дня)
**Что**: бейдж на сообщении в таймлайне диалога, пока текст не отредактирован человеком; после правки бейдж снимается.
**Зачем**: оператор мгновенно видит, что перед ним текст робота, и перечитывает перед отправкой.
**Как**: флаг `aiGenerated` в message metadata, сбрасывать при edit; бейдж в UI inbox + в карточке тикета.
**Файлы**: `src/app/(dashboard)/inbox/page.tsx`, message-компоненты, API сообщений
**Приоритет**: P1

#### A5. Debug view AI-ответа (3-4 дня)
**Что**: кнопка «Как сформирован ответ» (только для админов): промпт, использованные источники KB, вызванные инструменты, скоринг, причина draft/auto.
**Зачем**: разбор жалоб «AI ответил ерунду» за минуты, а не раскопки логов.
**Как**: мы уже пишем `ai-interaction-logs` — расширить запись (контекст, tools, скор), сделать drawer в диалоге с выборкой по messageId; доступ через существующие роли (`settings/roles`).
**Файлы**: `src/app/api/v1/ai-interaction-logs/`, inbox UI drawer
**Приоритет**: P1

#### A6. Гранулярные лимиты AI (2-3 дня)
**Что**: max AI-черновиков на контакт/день, max на диалог/кейс, max AI-реплик в одном диалоге (default 50), max output tokens на ответ.
**Зачем**: защита от «клиент-флудер сжёг месячный AI-бюджет за день». Месячный бюджет уже есть (`src/lib/ai/budget.ts`) — нужны счётчики уровнем ниже.
**Как**: счётчики в budget.ts (redis/db), при достижении — передача человеку или fallback-сообщение; настройки в `settings/budget-config`.
**Файлы**: `src/lib/ai/budget.ts`, `src/app/(dashboard)/settings/budget-config/`
**Приоритет**: P1

### Эпик B: Метрики AI по каналам (P0, ~1-1.5 недели)

#### B1. API агрегатов по каналам (3 дня)
**Что**: по каждому каналу за 7/30 дней: объём диалогов, first response time, **AI effectiveness** (доля диалогов, закрытых AI без участия человека), доля эскалаций.
**Как**: агрегирующий endpoint поверх существующих conversations/messages; outcome диалога у нас уже есть (закрытие с исходом из Whelp-редизайна) — добавить признак «закрыт AI vs человеком vs таймаут».
**Файлы**: `src/app/api/v1/inbox/` (новый route `stats/channels`), `src/lib/inbox/conversation-actions.ts`
**Приоритет**: P0

#### B2. Витрина в inbox (3-4 дня)
**Что**: блок «Эффективность каналов» — строка на канал: volume / FRT / AI% + мини-тренд; фильтр по периоду.
**Зачем**: владелец видит «WhatsApp: AI закрывает 60%, почта: 20%» и решает, где крутить rollout из A3.
**Как**: секция в inbox (или `ai-command-center`), переиспользовать компоненты advisor-center-widgets.
**Файлы**: `src/app/(dashboard)/inbox/page.tsx` или `src/app/(dashboard)/ai-command-center/page.tsx`, `src/components/ai/advisor-center-widgets.tsx`
**Приоритет**: P0

---

## Фаза 2 (недели 5-8): продавать умнее

### Эпик C: Live web-трекинг + бэкфилл (P1, ~3 недели)

Сейчас `src/app/api/v1/tracking/` умеет только open/click/sms-click/ad-click. CDP (`cdp/`) и attribution есть — веб-поведение станет для них топливом.

#### C1. Скрипт трекинга + ingest (1 неделя)
**Что**: JS-сниппет для сайта клиента: анонимный visitorId (first-party cookie), pageview + события, батч-отправка.
**Как**: публичный endpoint `api/v1/public/web-tracking` (rate-limit, allowed domains как у web-chat), новая модель `WebSession`/`WebAction` (visitorId, url, referrer, utm, ts); настройка доменов в `settings/integrations`.
**Безопасность/приватность**: согласие (не ставить cookie до consent), анонимизация IP, TTL сырых событий.
**Файлы**: `prisma/schema.prisma`, `src/app/api/v1/public/` (новый), `public/` (скрипт), `settings/integrations`
**Приоритет**: P1

#### C2. Склейка личности + бэкфилл 30 дней (1 неделя)
**Что**: при сабмите формы (web-to-lead/forms) или клике из рассылки (`tracking/click` уже знает контакт) visitorId привязывается к контакту, и вся его история за 30 дней подклеивается к карточке.
**Как**: событие идентификации → merge в CDP (у нас уже есть `cdp/merge-queue` — использовать его паттерн); backfill job по visitorId.
**Файлы**: `src/app/api/v1/tracking/click`, обработчики форм, `src/app/(dashboard)/cdp/`
**Приоритет**: P1

#### C3. Web-активность на карточке контакта (3 дня)
**Что**: блок «Активность на сайте»: сессии, просмотренные страницы, время. Особо подсветить страницы цен/продуктов.
**Файлы**: карточка контакта (`contacts/[id]`), новый компонент
**Приоритет**: P1

#### C4. Триггеры journeys/campaigns по web-действию (3-4 дня)
**Что**: «посетил /pricing дважды за неделю → задача менеджеру / включить в сегмент / письмо».
**Как**: событие web-action в существующий механизм триггеров (`journeys`, `settings/workflows`, `platform-events`).
**Файлы**: `src/app/(dashboard)/journeys/`, `src/app/api/v1/platform-events/`
**Приоритет**: P2 (после C1-C3)

### Эпик D: MEDDPICC на сделке (P1, ~1 неделя)

#### D1. Вкладка MEDDPICC (3-4 дня)
**Что**: 8 блоков (Metrics, Economic Buyer, Decision Criteria, Decision Process, Paper Process, Implicate the Pain, Champion, Competitor), каждый: скор 1-5 + «почему такой балл» + «что делать дальше»; общий статус пересчитывается на лету.
**Как**: JSON-поле `meddpicc` на Deal (без 8 таблиц), вкладка на карточке сделки, подсказки-хелперы к каждому блоку.
**Файлы**: `prisma/schema.prisma`, `src/app/(dashboard)/deals/[id]/`, API deals
**Приоритет**: P1

#### D2. Колонка в списках сделок (1-2 дня)
**Что**: колонка «MEDDPICC» — 8 букв, каждая цветом по скору (красный 1-2 / жёлтый 3 / зелёный 4-5); сортировка по общему скору.
**Файлы**: `src/app/(dashboard)/deals/page.tsx` (список/канбан)
**Приоритет**: P1

#### D3. AI-заполнение из переписки (опционально, 2-3 дня)
**Что**: advisor предлагает черновые оценки и заметки MEDDPICC из писем/звонков по сделке; менеджер подтверждает.
**Файлы**: `src/lib/ai/advisor/`, `src/lib/ai/next-best-action.ts`
**Приоритет**: P2

---

## Фаза 3 (недели 9-12): Sequences 2.0

Сейчас `src/lib/sequences.ts` — минимальный (email/call/task + delay + статусы enrollment). Для холодного аутрича этого мало.

#### E1. Email threading (1 неделя)
**Что**: follow-up-письма приходят получателю **в тот же тред** Gmail/Outlook (In-Reply-To/References + тот же subject «Re: …»). Режим per-шаг: «новый тред» / «продолжить предыдущий».
**Зачем**: цепочка выглядит как живая переписка, а не рассылка. Резко повышает reply rate.
**Как**: хранить messageId отправленных писем per enrollment; при отправке шага резолвить последний тред (если получатель ответил — тредить от его ответа); scope строго participant+sequence.
**Файлы**: `src/lib/sequences.ts`, `src/lib/email.ts`/`src/lib/emails/`, `prisma/schema.prisma` (threading-метаданные enrollment)
**Приоритет**: P1

#### E2. Реакции на ответы (1 неделя)
**Что**: получатель ответил → цепочка сама останавливается/паузится/продолжается (настройка per sequence) + задача владельцу «клиент ответил». Ответ третьего лица — алерт без остановки цепочки.
**Зачем**: главный позор аутрича — «вы мне не ответили», когда клиент уже ответил.
**Как**: у нас есть inbound email обработка (email-reply-address.ts) — матчить входящие по threading-метаданным E1 → событие reply → применить правило реакции + создать task.
**Файлы**: `src/lib/email-reply-address.ts`, `src/lib/sequences.ts`, cron обработки шагов
**Приоритет**: P1

#### E3. Unsubscribe / opt-out (0.5-1 неделя)
**Что**: ссылка отписки в каждом sequence-письме; отписка гасит **все контакты с тем же email**; страница подтверждения брендируется; opt-out также по результату звонка «Opt-out».
**Как**: suppression-таблица по email; проверка перед каждым send; публичная страница `/unsubscribe/[token]`.
**Файлы**: schema, отправка sequence-писем, публичный route
**Приоритет**: P1 (без этого аутрич — спам и жалобы)

#### E4. Дневной лимит отправки (2-3 дня)
**Что**: все sequence-письма через одну очередь с настраиваемым max/день; излишек — на завтра.
**Зачем**: защита домена от попадания в спам-списки.
**Файлы**: cron/queue отправки, `settings/` (лимит)
**Приоритет**: P1

#### E5. Live-статистика шагов + skip + reorder (0.5-1 неделя)
**Что**: на каждом шаге цепочки видно: сколько участников на шаге, доставка/ответы для email, исходы для звонков; кнопка «пропустить шаг» у оператора; drag-reorder шагов.
**Файлы**: `src/app/(dashboard)/sequences/page.tsx`, API sequences
**Приоритет**: P2

#### E6. Запрет двойного enrollment (1-2 дня)
**Что**: контакт не может состоять в двух активных цепочках одновременно (настраиваемо); при попытке — понятная ошибка.
**Файлы**: API enrollment
**Приоритет**: P2

---

## Фаза 4 (Later, по кварталам): большие стройки

### Эпик F: Конструктор AI-агентов (P2, ~4-6 недель)

**Что**: UI, где админ клиента собирает агента без кода: имя/персона/тон, инструкции текстом, whitelist инструментов (из наших `src/lib/ai/tools.ts` + read-tools), knowledge-scope (папки/теги KB как у Creatio «Customer support articles»), бюджет и лимиты, каналы, rollout %.
**Зачем**: сейчас агенты зашиты в код (support/social/advisor/contract). Конструктор превращает наш AI из фичи в платформу — главный козырь Creatio 10X.
**Почему реалистично**: runtime уже есть — `agent-router.ts`, `tool-executor.ts`, guardrails, budget, pii-masker, `agent/atlas` + `state-machine.ts`. Не хватает: модель `AgentDefinition` + резолвинг в рантайме + UI + песочница для теста + версии/публикация.
**Этапы**: F1 модель+рантайм (1.5 нед) → F2 UI-конструктор (2 нед) → F3 тест-песочница и превью (1 нед) → F4 экспорт/импорт определений (0.5 нед).
**Файлы**: `prisma/schema.prisma`, `src/lib/ai/agent-router.ts`, новый раздел `src/app/(dashboard)/ai/agents/`
**Приоритет**: P2 — начинать после того, как Фаза 1 докажет метриками, что AI-ответам доверяют.

### Эпик G: MTM Offline PWA (P2, ~4-6 недель)

**Что**: полевой модуль работает без сети: чек-ин/чек-аут, визиты, опросы (включая фото), просмотр маршрута — всё пишется локально и синхронизируется при появлении связи; push об изменениях маршрута.
**Зачем**: полевые агенты в подвалах ТЦ и регионах без 4G; у Creatio это козырь Field Sales.
**Как**:
- Service worker + IndexedDB: очередь мутаций (visit actions, survey answers, фото) с retry и разрешением конфликтов «last-write-wins + журнал».
- Кэш данных маршрута дня при утренней синхронизации.
- Push уже есть (`src/lib/push-send.ts`, `api/v1/push/subscribe`) — добавить события: визит добавлен/перенесён/отменён, лид назначен; только для изменений, сделанных не самим агентом.
- «Обязательные действия визита» (нельзя начать шаги до чек-ина) — правило в конфиге MTM.
**Файлы**: `src/app/(dashboard)/mtm/`, новый sw + offline-слой, `src/lib/push-send.ts`, `src/app/api/v1/mtm/`
**Приоритет**: P2

---

## UI-трек: Эпик H — фиделити 1:1 под Creatio (P1, ~1-1.5 недели)

**Контекст:** базовый Creatio-редизайн уже сделан и закоммичен (`beaaeaf8a`,
16.07.2026): заголовок-рекорд, градиентные KPI-чипы, Customer details,
рейка лида (Readiness/Interest/Engagement/Lead info), Agent Metrics,
горизонтальный journey-флоу. Проверен в light/dark и на прод-данных.
Эпик H доводит **раскладку** до референса — по скринам Creatio три блока
стоят не там, где у нас, и двух элементов нет вовсе.

#### H1. Сделка: перестановка в правую колонку (2-3 дня)
**Что**: KPI-чипы и блок Customer details перенести с полной ширины ВНУТРЬ
правой колонки — как у Creatio: сворачиваемые секции «Детали сделки»
(чипы) и «Данные клиента» над лентой. Левая колонка: Opportunity
information → Next best offers → AI-виджеты (порядок как в референсе).
**Файлы**: `src/app/(dashboard)/deals/[id]/page.tsx`
**Приоритет**: P1

#### H2. Сделка: вкладки правой колонки (1-2 дня)
**Что**: вкладки над контентом правой колонки как у Creatio
(SUMMARY | AI INSIGHTS | TIMELINE | QUOTES | HISTORY → у нас: Обзор |
Лента | История): Обзор = чипы + Customer details; Лента = композер +
таймлайн. Существующие виджеты не удалять — распределить по вкладкам.
**Файлы**: `deals/[id]/page.tsx`
**Приоритет**: P1

#### H3. Лид: Lead details внутри вкладки + карточки клиента (2 дня)
**Что**: стат-боксы (Задачи/Звонки/Создан) перенести под вкладки — секцией
«Lead details» внутри вкладки «Детали» (как у Creatio в Overview);
добавить в центр секцию «Customer details» с карточками контакта и
компании (реюз `deal-customer-details.tsx`, обобщить под лида).
**Файлы**: `src/app/(dashboard)/leads/[id]/page.tsx`,
`src/components/deals/deal-customer-details.tsx` → `src/components/crm/`
**Приоритет**: P1

#### H4. Правая AI-рейка на xl-экранах (2-3 дня)
**Что**: третья колонка справа на сделке и лиде (только xl+): Advisor /
Lead Evaluation с объяснением Readiness и кнопками действий (Assign,
Convert) — как AI-панель Creatio. На меньших экранах — как сейчас,
в потоке.
**Файлы**: `deals/[id]/page.tsx`, `leads/[id]/page.tsx`,
`src/components/ai/advisor-record-widget.tsx`
**Приоритет**: P2

#### H5. Journeys: AI-рейка в конструкторе (1 день)
**Что**: правая панель в модалке флоу — кнопка-лаунчер существующего
Da Vinci-ассистента (`davinci:open`) с journey-контекстом, как чат
Campaign Generation Agent у Creatio. Второй чат не строить.
**Файлы**: `src/app/(dashboard)/journeys/page.tsx`
**Приоритет**: P2

#### H6. Цветовая калибровка по референсу (1 день)
**Что**: цикл «скрин референса ↔ наш скрин»: зум фрагментов, список
расхождений (оттенки градиентов, размеры лейблов, радиусы), правка,
повторный скрин. 2-3 итерации на страницу (сделка, лид).
**Файлы**: `gradient-kpi-chip.tsx`, точечные правки страниц
**Приоритет**: P2

## Порядок и зависимости

```
Фаза 1: A1 → A2 → A3 (последовательно), A4-A6 параллельно; B1 → B2 (B можно параллельно с A)
Фаза 2: C1 → C2 → C3 → C4;  D1 → D2 (D независим, можно вторым разработчиком)
Фаза 3: E1 → E2 (E2 зависит от E1), E3/E4 параллельно, E5/E6 в конце
Фаза 4: F после метрик Фазы 1; G независим
UI-трек: H1 → H2 → H3 (база — коммит beaaeaf8a), H4-H6 после; независим от фаз,
         можно вклинить до Фазы 1 или параллельно с ней
```

## Что сознательно НЕ берём (и почему)

- **Landing Page Builder** — удалён 08.07.2026 из-за XSS/RBAC-дыры; кейс закрывают наши forms/web-to-lead + embedded-подход. Не возвращаем.
- **AI app development toolkit** (генерация приложений кодинг-агентами как фича продукта) — мы продукт, а не low-code платформа; наши клиенты не строят приложения.
- **Kubernetes on-site, Freedom UI Designer, мобильный SDK** — платформенные фичи вендора low-code, вне нашей модели SaaS.
- «Unlimited»-лицензирование — вопрос прайсинга, не разработки.
