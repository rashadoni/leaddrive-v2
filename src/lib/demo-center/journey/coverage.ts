/**
 * Coverage inventory — the explicit list of meaningful sections on every
 * real LeadDrive page the journey shows, with an included/excluded decision
 * and the reason for each exclusion. The 80 % rule from the handoff is
 * computed from this list, never from the number of coach marks.
 *
 * A «section» is a region a user can name: a tab, a card group, a panel, a
 * dialog. Controls inside a region (a search box, a sort menu, a button) are
 * part of that region, not sections of their own. Regions that only make
 * sense with many records or with background jobs (aggregate analytics,
 * advisor risk runs, bulk bars) are excluded with that reason rather than
 * faked with invented numbers — inventing numbers is what got the previous
 * demo rejected.
 *
 * `kind` records how the included section is covered: `interactive` = the
 * prospect acts on it, `observe` = a coach mark explains it, `video` = a
 * clip covers it in addition to a coach mark.
 */
import type { DemoJourneyArea } from "./types"

export type DemoCoverageKind = "interactive" | "observe" | "video"

export interface DemoCoverageSection {
  /** `<area>.<section>` — referenced by `DemoJourneyStep.covers`. */
  readonly id: string
  readonly label: string
  readonly included: boolean
  readonly kind?: DemoCoverageKind
  /** Required when `included` is false. */
  readonly reason?: string
}

export interface DemoCoverageArea {
  readonly area: DemoJourneyArea
  readonly title: string
  readonly routes: readonly string[]
  readonly sections: readonly DemoCoverageSection[]
}

export const DEMO_COVERAGE_TARGET_PERCENT = 80

export const DEMO_JOURNEY_COVERAGE: readonly DemoCoverageArea[] = [
  {
    area: "campaigns",
    title: "Marketing → Kampaniyalar",
    routes: ["/campaigns", "/campaigns/[id]"],
    sections: [
      { id: "campaigns.tabs", label: "Переключатель Список / Аналитика (+ поиск)", included: true, kind: "observe" },
      { id: "campaigns.stats", label: "Карточки статусов (черновик, запланирована, отправляется, отправлена, отменена)", included: true, kind: "observe" },
      { id: "campaigns.list", label: "Список кампаний команды: статус, тип, получатели, отправлено / бюджет", included: true, kind: "interactive" },
      { id: "campaigns.detail", label: "Карточка кампании: статус, аудитория, канал", included: true, kind: "interactive" },
      { id: "campaigns.analytics", label: "Открываемость и кликабельность (только у e-mail; у остальных «—»)", included: true, kind: "observe" },
      { id: "campaigns.funnel", label: "Воронка кампании: получатели → отправлено → открыли → кликнули → сделки → выигранные", included: true, kind: "observe" },
      { id: "campaigns.roi", label: "Деньги кампании: бюджет, выручка, ROI", included: true, kind: "observe" },
      { id: "campaigns.editor", label: "Создание / редактирование кампании", included: false, reason: "Демо ничего не рассылает; редактор кампании — работа администратора, а не часть истории лида." },
    ],
  },
  {
    area: "inbox",
    title: "Communication → Gələnlər qutusu və AI agent",
    routes: ["/inbox", "/inbox/ai-agent"],
    sections: [
      { id: "inbox.views", label: "Представления: Все / Мои / Без ответственного / Чат-бот …", included: true, kind: "observe" },
      { id: "inbox.channels", label: "Каналы в рейке со счётчиками: клик оставляет диалоги одного канала", included: true, kind: "interactive" },
      { id: "inbox.assign", label: "Назначение диалога коллеге", included: true, kind: "interactive" },
      { id: "inbox.status-tabs", label: "Вкладки Открытые / Закрытые / Отложенные", included: true, kind: "observe" },
      { id: "inbox.filters", label: "Фильтры канала, папки, этапа, тегов", included: true, kind: "observe" },
      { id: "inbox.conversations", label: "Список диалогов с каналом и непрочитанными", included: true, kind: "interactive" },
      { id: "inbox.thread", label: "Лента сообщений, значок «ответ AI»", included: true, kind: "interactive" },
      { id: "inbox.composer", label: "Композер: ответ / внутренняя заметка, сниппеты, AI-помощь", included: true, kind: "interactive" },
      { id: "inbox.ai-draft", label: "Панель черновика AI: проверить, отправить, отклонить", included: true, kind: "interactive" },
      { id: "inbox.contact-panel", label: "Правая панель: контакт, теги, этап, связанный лид", included: true, kind: "observe" },
      { id: "inbox.calls", label: "Вкладка звонков и управление WhatsApp-звонком", included: false, reason: "Телефония выключена до Phase D; показывать кнопку звонка без возможности позвонить — обман." },
      { id: "inbox.bulk", label: "Массовые действия над диалогами", included: false, reason: "С одним диалогом клиента массовые действия бессмысленны." },
      { id: "inbox.ai-agent.reply-matrix", label: "AI agent: кто отвечает в каждом канале — Человек / Черновик / AI агент", included: true, kind: "interactive" },
      { id: "inbox.ai-agent.master-switch", label: "AI agent: главный переключатель «AI отвечает автоматически»", included: true, kind: "observe" },
      { id: "inbox.ai-agent.prompt", label: "AI agent: системный промпт (роль, цель, правила) со стилем общения в конце", included: true, kind: "observe" },
      { id: "inbox.ai-agent.knowledge", label: "AI agent: база знаний — факты отдельно от правил", included: true, kind: "observe" },
      { id: "inbox.ai-agent.settings", label: "AI agent: модель, язык ответа, температура", included: true, kind: "observe" },
      { id: "inbox.ai-agent.sources", label: "AI agent: опубликованные статьи базы знаний, из которых отвечает AI", included: true, kind: "observe" },
      { id: "inbox.ai-agent.persona-extras", label: "AI agent: приветствие, «Передать человеку», «Автономная работа», экспорт и импорт", included: false, reason: "Показаны как в продукте, но гид их не разбирает: демо-агент в WhatsApp не использует ни приветствие, ни передачу человеку; автономная работа в живом аккаунте создаёт лиды и задачи; экспорт и импорт — перенос файла администратором." },
      { id: "inbox.ai-agent.tiktok-cards", label: "AI agent: карточки дожимов и стоп-слов", included: false, reason: "Работают только для TikTok через Chatwoot, отвечать в TikTok сегодня нельзя; обе карточки читают сессию тенанта — в демо не показаны." },
    ],
  },
  {
    area: "leads",
    title: "Sales → Lidlər (список и карточка)",
    routes: ["/leads", "/leads/[id]"],
    sections: [
      { id: "leads.list.header", label: "Шапка: вкладки Рабочее пространство / Аналитика, инсайты, «Новый лид»", included: true, kind: "observe" },
      { id: "leads.list.stats", label: "Статистика лидов", included: true, kind: "observe" },
      { id: "leads.list.status-pills", label: "Фильтр по статусу", included: true, kind: "observe" },
      { id: "leads.list.toolbar", label: "Поиск, категория, источник, сортировка, вид", included: true, kind: "observe" },
      { id: "leads.list.kanban", label: "Канбан лидов по статусам", included: true, kind: "interactive" },
      { id: "leads.list.table", label: "Таблица лидов с сохранёнными видами", included: true, kind: "observe" },
      { id: "leads.list.analytics", label: "Вкладка аналитики и поздние перезвоны", included: false, reason: "Агрегаты по одному лиду ничего не показывают; поздние перезвоны относятся к AI-звонкам (Phase D)." },
      { id: "leads.card.header", label: "Шапка карточки: Конвертировать, Редактировать, звонок", included: true, kind: "interactive" },
      { id: "leads.card.status-bar", label: "Полоса статусов лида", included: true, kind: "interactive" },
      { id: "leads.card.overview", label: "Обзор: оценка, evaluation, стат-боксы", included: true, kind: "observe" },
      { id: "leads.card.voice-permission", label: "Согласие на AI-звонок", included: true, kind: "observe" },
      { id: "leads.card.ai-call", label: "Звонок AI из карточки лида", included: true, kind: "interactive" },
      { id: "leads.card.call-result", label: "Результат звонка в карточке: длительность, итог, заметка", included: true, kind: "observe" },
      { id: "leads.card.advisor-risk", label: "Виджет Advisor risk", included: false, reason: "Считается фоновыми прогонами Advisor; статичное значение было бы выдуманной метрикой." },
      { id: "leads.card.kpi", label: "KPI-карточки: оценка, приоритет", included: true, kind: "observe" },
      { id: "leads.card.details", label: "Вкладка Детали: данные лида, клиента, заметки", included: true, kind: "interactive" },
      { id: "leads.card.activities", label: "Вкладка Активности", included: true, kind: "observe" },
      { id: "leads.card.timeline", label: "Вкладка Лента (единая хронология)", included: true, kind: "interactive" },
      { id: "leads.card.sentiment", label: "Вкладка Настроение", included: true, kind: "observe" },
      { id: "leads.card.tasks", label: "Вкладка Задачи: Da Vinci предлагает шаги и создаёт задачи", included: true, kind: "observe" },
      { id: "leads.card.ai-text", label: "Вкладка Da Vinci Text: что она делает (сама генерация — в живом аккаунте)", included: true, kind: "observe" },
      { id: "leads.card.ai-scoring", label: "Вкладка Da Vinci Scoring: балл по правилам, «Пересчитать с Da Vinci» — пояснение и вероятность", included: true, kind: "interactive" },
      { id: "leads.card.convert-dialog", label: "Диалог конвертации в сделку", included: true, kind: "interactive" },
    ],
  },
  {
    // `/tasks` was deliberately removed from the sidebar (nav-items.ts): boards
    // are the primary task surface, and the task detail opens from a card.
    area: "tasks",
    title: "Основная → Lövhələr (доски задач)",
    routes: ["/boards", "/boards/[divisionId]"],
    sections: [
      { id: "tasks.boards-index", label: "Список досок: по отделам и отдельные", included: true, kind: "interactive" },
      { id: "tasks.board-header", label: "Шапка доски: название, обновить, настройки", included: true, kind: "observe" },
      { id: "tasks.board-tabs", label: "Переключатель Доска / Отчёты", included: true, kind: "observe" },
      { id: "tasks.board-toolbar", label: "Тулбар: «мои», «созданные мной», поиск", included: true, kind: "observe" },
      { id: "tasks.board-columns", label: "Колонки по стадиям, перетаскивание карточек", included: true, kind: "interactive" },
      { id: "tasks.board-card", label: "Карточка задачи: номер, клиент, срок, чек-лист, исполнитель", included: true, kind: "interactive" },
      { id: "tasks.board-card-menu", label: "Быстрое меню карточки", included: true, kind: "observe" },
      { id: "tasks.board-reports", label: "Отчёты доски: WIP, пропускная способность, нагрузка, просрочки (в демо на доске одна задача)", included: true, kind: "observe" },
      { id: "tasks.board-settings", label: "Настройки доски: колонки, доступ", included: false, reason: "Администрирование доски; клиент в демо — не администратор." },
      { id: "tasks.detail.info", label: "Модал задачи: ответственный, срок, приоритет, связь с лидом", included: true, kind: "interactive" },
      { id: "tasks.detail.status", label: "Статус задачи (выполнить)", included: true, kind: "interactive" },
      { id: "tasks.detail.comments", label: "Комментарии к задаче", included: true, kind: "observe" },
      { id: "tasks.detail.ai-brief", label: "Что AI записал в задачу из переписки: описание и чек-лист", included: true, kind: "observe" },
      { id: "tasks.detail.extras", label: "Вложения, пользовательские поля", included: false, reason: "Требуют настройки организации; в задаче из переписки их нет." },
    ],
  },
  {
    area: "deals",
    title: "Sales → Sövdələşmələr (доска и карточка)",
    routes: ["/deals", "/deals/[id]"],
    sections: [
      { id: "deals.board.header", label: "Шапка: аналитика / канбан / список, «Новая сделка» (выбор воронки — только при нескольких)", included: true, kind: "observe" },
      { id: "deals.board.summary", label: "Сводка воронки: стоимость, взвешенная, выиграно, проиграно, полоса стадий", included: true, kind: "observe" },
      { id: "deals.board.kanban", label: "Канбан: карточки, перетаскивание между стадиями", included: true, kind: "interactive" },
      { id: "deals.board.list", label: "Список сделок с инлайн-правкой", included: true, kind: "observe" },
      { id: "deals.board.analytics", label: "Вкладка аналитики сделок", included: false, reason: "Агрегаты по одной сделке пусты; выдуманные суммы недопустимы." },
      { id: "deals.board.davinci", label: "Кнопка и карточка ответа Da Vinci на доске", included: false, reason: "Живой вызов модели из публичной сессии; отложено до решения по возможности «assistant»." },
      { id: "deals.card.stage-progress", label: "Полоса стадий: смена стадии на странице сделки", included: true, kind: "interactive" },
      { id: "deals.card.sidebar", label: "Боковая панель: сумма, вероятность, дата, ответственный, стадия, кампания", included: true, kind: "interactive" },
      { id: "deals.card.kpi-chips", label: "KPI-чипы: дней в воронке / на стадии, письма, звонки", included: true, kind: "observe" },
      { id: "deals.card.customer-details", label: "Детали клиента", included: true, kind: "observe" },
      { id: "deals.card.quick-actions", label: "Быстрые действия: письмо, звонок, встреча, заметка", included: true, kind: "interactive" },
      { id: "deals.card.timeline", label: "Единая лента активности", included: true, kind: "observe" },
      { id: "deals.card.ai-prediction", label: "AI-прогноз сделки", included: true, kind: "observe" },
      { id: "deals.card.ai-suggestions", label: "AI-подсказки следующего шага", included: true, kind: "observe" },
      { id: "deals.card.next-best-offers", label: "Рекомендуемые товары из каталога", included: true, kind: "observe" },
      { id: "deals.card.meddpicc", label: "Вкладка MEDDPICC", included: false, reason: "Методология квалификации для зрелых команд; в первом знакомстве перегружает." },
    ],
  },
  {
    area: "quotes",
    title: "Sales → Kommersiya təklifləri",
    routes: ["/quotes", "/quotes/[id]"],
    sections: [
      { id: "quotes.list.header", label: "Шапка списка и «Новое КП»", included: true, kind: "interactive" },
      { id: "quotes.list.filters", label: "Поиск и фильтр по статусу", included: true, kind: "observe" },
      { id: "quotes.list.table", label: "Таблица: номер, сделка, статус, позиции, итог, срок", included: true, kind: "observe" },
      { id: "quotes.create-dialog", label: "Диалог создания: сделка, товар, количество", included: true, kind: "interactive" },
      { id: "quotes.detail.header", label: "Шапка КП: номер, статус, сделка, действия (PDF, сохранить)", included: true, kind: "observe" },
      { id: "quotes.detail.customer", label: "Блок клиента", included: true, kind: "observe" },
      { id: "quotes.detail.line-items", label: "Позиции КП", included: true, kind: "interactive" },
      { id: "quotes.detail.summary", label: "Итоги (подытог, скидка, итого), срок действия, отметки времени", included: true, kind: "interactive" },
      { id: "quotes.detail.contract", label: "Черновик договора, созданный из принятого КП", included: true, kind: "observe" },
      { id: "quotes.detail.rejection", label: "Отклонение с причиной", included: false, reason: "История идёт по ветке принятия; отказ — альтернативная ветка, не первое знакомство." },
      { id: "quotes.detail.advisor-risk", label: "Виджет Advisor risk", included: false, reason: "Считается фоновыми прогонами Advisor; статичное значение было бы выдуманной метрикой." },
    ],
  },
  {
    // A module of its own (owner, 2026-10-13): an invented service company's
    // morning queue, its SLA dates from the product's working-hours clock.
    area: "support",
    title: "Service Desk (поддержка клиентов)",
    routes: ["/tickets", "/tickets/[id]", "/settings/sla-policies", "/settings/escalation", "/support/agent-desktop"],
    sections: [
      { id: "support.nav", label: "Меню модуля: Service Desk, рабочее место агента, база знаний, SLA, эскалации, макросы", included: true, kind: "observe" },
      { id: "support.queue.kpis", label: "Счётчики очереди: новые, без исполнителя, SLA", included: true, kind: "observe" },
      { id: "support.queue.next", label: "«Следующий приоритет» и «Взять следующий»", included: true, kind: "interactive" },
      { id: "support.queue.list", label: "Список: остаток SLA, уровень эскалации, время ответа, исполнитель", included: true, kind: "observe" },
      { id: "support.queue.numbering", label: "Префиксы номеров WA / DV / TK и общая нумерация", included: true, kind: "observe" },
      { id: "support.queue.kanban", label: "Канбан по статусам", included: false, reason: "Те же тикеты в другом виде; в первом знакомстве достаточно списка." },
      { id: "support.queue.reports", label: "Отчёты Service Desk", included: false, reason: "Сводные отчёты имеют смысл на месяцах настоящих тикетов; показаны личные цифры агента, посчитанные продуктом." },
      { id: "support.ticket.status", label: "Полоса статуса и факты: клиент, канал, исполнитель, срок", included: true, kind: "observe" },
      { id: "support.ticket.transcript", label: "Сообщения клиента из WhatsApp в ленте тикета (тикет открыт первым сообщением)", included: true, kind: "observe" },
      { id: "support.ticket.ai-draft", label: "Da Vinci: черновик ответа по базе знаний", included: true, kind: "interactive" },
      { id: "support.ticket.reply", label: "Ответ клиенту: WhatsApp и портал, без e-mail; внутренняя заметка", included: true, kind: "interactive" },
      { id: "support.ticket.sla", label: "Карточка SLA: первый ответ, срок решения", included: true, kind: "observe" },
      { id: "support.ticket.kb", label: "Статьи базы знаний на тикете", included: true, kind: "observe" },
      { id: "support.ticket.closure", label: "Запрос подтверждения закрытия, автозакрытие через 7 дней", included: true, kind: "interactive" },
      { id: "support.ticket.customer-side", label: "Что получает клиент: два сообщения в WhatsApp и страница подтверждения закрытия", included: true, kind: "interactive" },
      { id: "support.ticket.customer360", label: "Контекст клиента (Customer 360)", included: false, reason: "Нужна история клиента в CRM; у выдуманного магазина её нет." },
      { id: "support.sla.matrix", label: "Политики SLA по приоритетам, рабочие часы", included: true, kind: "observe" },
      { id: "support.escalation", label: "Правила эскалации и когда они сработают (в демо три уровня)", included: true, kind: "observe" },
      { id: "support.agent.metrics", label: "Рабочее место агента: очередь и показатели за 30 дней", included: true, kind: "observe" },
    ],
  },
  {
    // A module of its own (owner, 2026-10-13), on the company's own PBX
    // (2026-10-17) and only what every seller has («только то, что у всех»).
    area: "voip",
    title: "Call Center (звонки из CRM)",
    routes: ["/inbox/voip", "/leads/[id]", "/leads"],
    sections: [
      { id: "voip.connection", label: "Состояние телефонии: «VoIP настроен»", included: true, kind: "observe" },
      { id: "voip.summary", label: "Итоги за 30 дней: всего, входящие, исходящие, пропущенные, средняя длительность", included: true, kind: "observe" },
      { id: "voip.timeline", label: "Журнал звонков: направление, номер, клиент, статус, итог, запись", included: true, kind: "observe" },
      { id: "voip.filter", label: "Фильтр «Входящие / Исходящие» пересчитывает и итоги", included: true, kind: "interactive" },
      { id: "voip.row-actions", label: "У звонка: «Перезвонить», «К контакту», «Детали»", included: true, kind: "observe" },
      { id: "voip.click-to-call", label: "Звонок с карточки лида одной кнопкой (свой PBX)", included: true, kind: "interactive" },
      { id: "voip.provider-picker", label: "Выбор службы звонка перед набором", included: true, kind: "interactive" },
      { id: "voip.widget", label: "Окно звонка: статус, время, «Завершить»", included: true, kind: "interactive" },
      { id: "voip.disposition", label: "Итог звонка из списка", included: true, kind: "interactive" },
      { id: "voip.callback-task", label: "«Перезвонить» со временем: задача продавцу и запись в истории лида", included: true, kind: "interactive" },
      { id: "voip.escalation", label: "Просроченное обещание: напоминание продавцу, через 45 минут — руководителям", included: true, kind: "observe" },
      { id: "voip.late-callbacks", label: "Отчёт «Опоздавшие звонки клиентам» за 7 дней", included: true, kind: "observe" },
      { id: "voip.recordings", label: "Запись разговора и её прослушивание", included: false, reason: "Запись остаётся на диске станции, в CRM не попадает — журнал честно пишет «Записи нет»." },
      { id: "voip.incoming-popup", label: "Окно входящего звонка, ответ в браузере и очередь пропущенных", included: false, reason: "Ответ в браузере — пилот, очередь — только руководителям; владелец, 2026-10-17: показывать то, что есть у всех." },
      { id: "voip.ai", label: "ИИ-звонки, расшифровка и анализ разговора", included: false, reason: "Пилот, не у всех клиентов; в демо звонков ИИ нет." },
    ],
  },
  {
    // A module of its own (owner, 2026-10-17): the product's MTM components
    // drawn from an invented field team, beside the lead story.
    area: "mtm",
    title: "Route & Field (MTM)",
    routes: ["/mtm", "/mtm/routes/plan", "/mtm/map", "/mtm/visits", "/mtm/routes", "/mtm/analytics"],
    sections: [
      { id: "mtm.nav", label: "Меню модуля: Сегодня / Маршруты / Календарь / Карта / Визиты / Результаты", included: true, kind: "observe" },
      { id: "mtm.home.kpis", label: "«Сегодня»: в поле, план дня, неделя, ждёт решения", included: true, kind: "observe" },
      { id: "mtm.home.attention", label: "«Ждёт решения»: заявки агентов, неопубликованные маршруты, фото", included: true, kind: "observe" },
      { id: "mtm.home.team", label: "«Команда · эта неделя»: посещено / план по дням", included: true, kind: "observe" },
      { id: "mtm.plan.map", label: "Планирование: клиенты на карте, «не были в этом месяце»", included: true, kind: "interactive" },
      { id: "mtm.plan.suggest", label: "«Предложить маршрут»", included: true, kind: "interactive" },
      { id: "mtm.plan.route-panel", label: "Маршрут дня: точки, время, километры", included: true, kind: "interactive" },
      { id: "mtm.plan.publish", label: "Публикация маршрута агенту", included: true, kind: "interactive" },
      { id: "mtm.live.map", label: "Живая карта команды", included: true, kind: "observe" },
      { id: "mtm.live.roster", label: "Список сотрудников со статусами и исполнением маршрута", included: true, kind: "interactive" },
      { id: "mtm.live.day-steps", label: "«День по шагам»: план и факт выбранного агента", included: true, kind: "interactive" },
      { id: "mtm.live.nearest", label: "«Кто ближе»: расстояние от клиента до каждого, ближайший первым", included: true, kind: "interactive" },
      { id: "mtm.visit.place", label: "Визит: в зоне ли агент и на каком расстоянии", included: true, kind: "observe" },
      { id: "mtm.visit.photos", label: "Визит: фото, презентация, подпись", included: true, kind: "observe" },
      { id: "mtm.visit.left-open", label: "«Не закрыт агентом» и «Напомнить агенту»", included: true, kind: "interactive" },
      { id: "mtm.place-request", label: "«Клиент здесь»: было / предлагает, решение руководителя", included: true, kind: "interactive" },
      { id: "mtm.history.track", label: "История дня: трек по дорогам, километры, остановки, визиты", included: true, kind: "interactive" },
      { id: "mtm.history.trip", label: "День по участкам: ехал / стоял / перерыв — у перерыва только длительность", included: true, kind: "observe" },
      { id: "mtm.results.team", label: "Результаты: план и факт по агентам", included: true, kind: "interactive" },
      { id: "mtm.calendar", label: "Календарь команды", included: false, reason: "Повторяет маршруты по дням; первое знакомство идёт по одному дню." },
      { id: "mtm.photos.review", label: "Проверка фото пакетом", included: false, reason: "Отдельный экран для потока фото; в демо фото показаны в карточке визита." },
      { id: "mtm.settings", label: "Настройки: правила визита, «Что может агент»", included: false, reason: "Работа администратора; в первом знакомстве перегружает." },
      { id: "mtm.mobile-app", label: "Приложение агента: отметка с GPS, съёмка, офлайн", included: false, reason: "Нужен телефон агента; демо показывает то, что приложение присылает руководителю." },
    ],
  },
  {
    // A module of its own (owner, 2026-10-13): an invented service company's
    // contracts, from the quote's draft to the signature and the reminders.
    area: "contracts",
    title: "Müqavilə nəzarəti (договоры)",
    routes: ["/contracts", "/contracts/[id]", "/contracts/lifecycle", "/sign/[token]"],
    sections: [
      { id: "contracts.nav", label: "Меню модуля: договоры, жизненный цикл, шаблоны, формы, запросы, правила, делегирование, этапы, аналитика", included: true, kind: "observe" },
      { id: "contracts.list.kpis", label: "Шесть цифр списка: всего, активные, сумма, MRR, средняя, скоро истекают", included: true, kind: "observe" },
      { id: "contracts.list.filters", label: "Вкладки по статусам и «истекают в 90 дней»", included: true, kind: "observe" },
      { id: "contracts.list.table", label: "Таблица: номер, имя, компания, тип, сумма, статус, дата окончания", included: true, kind: "observe" },
      { id: "contracts.from-quote", label: "Черновик договора, созданный принятым КП", included: true, kind: "interactive" },
      { id: "contracts.detail.kpis", label: "Карточка: дни в силе, сумма, тип, дней осталось", included: true, kind: "observe" },
      { id: "contracts.approval.submit", label: "Отправка на согласование с этапами, ролями и SLA", included: true, kind: "interactive" },
      { id: "contracts.approval.chain", label: "Цепочка согласования: уровни, режим, SLA, статусы", included: true, kind: "observe" },
      { id: "contracts.approval.decide", label: "Решение по этапу: «Утвердить» / «Отклонить»", included: true, kind: "interactive" },
      { id: "contracts.approval.escalation", label: "Просроченный этап: напоминание руководителям", included: true, kind: "observe" },
      { id: "contracts.esign.send", label: "Отправка на подпись: тема, подписант, ссылка на 30 дней", included: true, kind: "interactive" },
      { id: "contracts.esign.customer", label: "Страница подписанта: текст и подпись (набрать или нарисовать)", included: true, kind: "interactive" },
      { id: "contracts.esign.active", label: "После подписи договор «Активен», конверт «Завершён»", included: true, kind: "observe" },
      { id: "contracts.lifecycle.renewals", label: "Жизненный цикл: напоминания о продлении за 90 дней", included: true, kind: "observe" },
      { id: "contracts.lifecycle.approvals", label: "Очередь согласования и узкий этап", included: true, kind: "observe" },
      { id: "contracts.renewal-alert", label: "Напоминание в колокольчике руководителей", included: true, kind: "observe" },
      { id: "contracts.setup", label: "Шаблоны и пункты, формы запроса, правила маршрута, делегирование", included: false, reason: "Настройка администратора; в первом знакомстве перегружает." },
      { id: "contracts.editor", label: "Редактор, импорт .docx, версии, отклонения от пунктов", included: false, reason: "Работа юриста над текстом; глава показывает путь договора, а не его вёрстку." },
      { id: "contracts.ai", label: "ИИ: извлечение пунктов, риск, редлайн, черновик пункта, поиск", included: false, reason: "Выключено по умолчанию и включается только платформой — показывать нельзя." },
      { id: "contracts.analytics", label: "Аналитика, этапы исполнения, признание выручки, счёт по договору", included: false, reason: "Нужна история договоров; доля продлений всегда «—» — продление не отдельный статус; выручка и счета — модуль Финансы." },
    ],
  },
  {
    // A module of its own (owner, 2026-10-17): the product's timesheet
    // builder over an invented company's phone facts.
    area: "personnel",
    title: "Kadr uçotu (учёт рабочего дня)",
    routes: ["/mtm/attendance", "/mtm/attendance/timesheet", "/mtm/attendance/review", "/mtm/attendance/reports"],
    sections: [
      { id: "personnel.nav", label: "Меню раздела: Сегодня / Табель / Сотрудники / Отчёты / Настройки", included: true, kind: "observe" },
      { id: "personnel.today.kpis", label: "«Сегодня»: пришли, опоздали, не пришли, без ухода", included: true, kind: "observe" },
      { id: "personnel.today.now", label: "«Сейчас»: на работе, на перерыве, ушли, ещё не пришли", included: true, kind: "observe" },
      { id: "personnel.privacy", label: "Без биометрии; перерыв — только время, без места", included: true, kind: "observe" },
      { id: "personnel.today.requests", label: "Заявки, ждущие решения: одобрить / отклонить", included: true, kind: "interactive" },
      { id: "personnel.today.explanations", label: "Объяснительные: запросить, прочитать ответ, принять", included: true, kind: "interactive" },
      { id: "personnel.today.week", label: "Неделя по дням", included: true, kind: "observe" },
      { id: "personnel.timesheet.grid", label: "Табель месяца буквами видов дня", included: true, kind: "observe" },
      { id: "personnel.timesheet.day-card", label: "Карточка дня: «было → стало», кто одобрил", included: true, kind: "interactive" },
      { id: "personnel.risk", label: "Подозрительные отметки: проверить, два времени, причина, закрыть", included: true, kind: "interactive" },
      { id: "personnel.n1t", label: "Табель N-1t для бухгалтерии", included: true, kind: "observe" },
      { id: "personnel.month-close", label: "Закрытие месяца", included: true, kind: "interactive" },
      { id: "personnel.setup", label: "Сотрудники, филиалы, правила дня, графики, праздники", included: false, reason: "Настройка администратора; в первом знакомстве перегружает." },
      { id: "personnel.mobile", label: "Приложение сотрудника: отметка, перерыв, заявки, объяснительные", included: false, reason: "Нужен телефон сотрудника; демо показывает то, что видит отдел кадров." },
      { id: "personnel.location", label: "Место отметки, «вне филиала», QR в филиале", included: false, reason: "Сбор места выключен до утверждённого текста согласия; QR не проверен камерой на телефоне." },
    ],
  },
]

export interface DemoCoverageResult {
  readonly area: DemoJourneyArea
  readonly included: number
  readonly total: number
  readonly percent: number
}

export function computeCoverage(area: DemoCoverageArea): DemoCoverageResult {
  const total = area.sections.length
  const included = area.sections.filter((section) => section.included).length
  const percent = total === 0 ? 0 : Math.round((included / total) * 100)
  return { area: area.area, included, total, percent }
}

export function coverageAreaFor(area: DemoJourneyArea): DemoCoverageArea | undefined {
  return DEMO_JOURNEY_COVERAGE.find((entry) => entry.area === area)
}
