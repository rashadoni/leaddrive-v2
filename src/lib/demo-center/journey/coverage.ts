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
      { id: "campaigns.stats", label: "Карточки статусов (черновик … отправлено)", included: true, kind: "observe" },
      { id: "campaigns.list", label: "Список кампаний: получатели, отправлено", included: true, kind: "interactive" },
      { id: "campaigns.detail", label: "Карточка кампании: статус, аудитория, канал", included: true, kind: "interactive" },
      { id: "campaigns.analytics", label: "Вкладка аналитики: открытия / клики", included: true, kind: "observe" },
      { id: "campaigns.funnel", label: "Воронка кампании: получатели → лиды → сделки → выигранные", included: true, kind: "observe" },
      { id: "campaigns.roi", label: "Деньги кампании: бюджет, выручка, ROI", included: true, kind: "observe" },
      { id: "campaigns.editor", label: "Создание / редактирование кампании", included: false, reason: "Демо ничего не рассылает; редактор кампании — работа администратора, а не часть истории лида." },
    ],
  },
  {
    area: "inbox",
    title: "Communication → Gələnlər qutusu",
    routes: ["/inbox"],
    sections: [
      { id: "inbox.views", label: "Представления: Все / Мои / Без ответственного / Чат-бот …", included: true, kind: "observe" },
      { id: "inbox.status-tabs", label: "Вкладки Открытые / Закрытые / Отложенные", included: true, kind: "observe" },
      { id: "inbox.filters", label: "Фильтры канала, папки, этапа, тегов", included: true, kind: "observe" },
      { id: "inbox.conversations", label: "Список диалогов с каналом и непрочитанными", included: true, kind: "interactive" },
      { id: "inbox.thread", label: "Лента сообщений, значок «ответ AI»", included: true, kind: "interactive" },
      { id: "inbox.composer", label: "Композер: ответ / внутренняя заметка, сниппеты, AI-помощь", included: true, kind: "interactive" },
      { id: "inbox.ai-draft", label: "Панель черновика AI: проверить, отправить, отклонить", included: true, kind: "interactive" },
      { id: "inbox.contact-panel", label: "Правая панель: контакт, теги, этап, связанный лид", included: true, kind: "observe" },
      { id: "inbox.calls", label: "Вкладка звонков и управление WhatsApp-звонком", included: false, reason: "Телефония выключена до Phase D; показывать кнопку звонка без возможности позвонить — обман." },
      { id: "inbox.bulk", label: "Массовые действия над диалогами", included: false, reason: "С одним диалогом клиента массовые действия бессмысленны." },
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
      { id: "leads.card.tasks", label: "Вкладка Задачи", included: true, kind: "observe" },
      { id: "leads.card.ai-text", label: "Вкладка Da Vinci Text (генерация писем)", included: false, reason: "Генерация текста требует вызова модели из публичной сессии; отложено до решения по возможности «assistant»." },
      { id: "leads.card.ai-scoring", label: "Вкладка Da Vinci Scoring", included: true, kind: "interactive" },
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
      { id: "tasks.board-card", label: "Карточка задачи: срок, исполнитель, клиент", included: true, kind: "interactive" },
      { id: "tasks.board-card-menu", label: "Быстрое меню карточки", included: true, kind: "observe" },
      { id: "tasks.board-reports", label: "Отчёты доски: WIP, пропускная способность, нагрузка, просрочки (с одной задачей — честно почти пусто)", included: true, kind: "observe" },
      { id: "tasks.board-settings", label: "Настройки доски: колонки, доступ", included: false, reason: "Администрирование доски; клиент в демо — не администратор." },
      { id: "tasks.detail.info", label: "Модал задачи: ответственный, срок, приоритет, связь с лидом", included: true, kind: "interactive" },
      { id: "tasks.detail.status", label: "Статус задачи (выполнить)", included: true, kind: "interactive" },
      { id: "tasks.detail.comments", label: "Комментарии к задаче", included: true, kind: "observe" },
      { id: "tasks.detail.extras", label: "Чек-лист, вложения, пользовательские поля", included: false, reason: "Не участвуют в задаче-напоминании; вложения и кастомные поля требуют настройки организации." },
    ],
  },
  {
    area: "deals",
    title: "Sales → Sövdələşmələr (доска и карточка)",
    routes: ["/deals", "/deals/[id]"],
    sections: [
      { id: "deals.board.header", label: "Шапка: канбан / список / аналитика, выбор воронки, «Новая сделка»", included: true, kind: "observe" },
      { id: "deals.board.summary", label: "Сводка воронки: полоса стадий, поиск, фильтр по предложениям", included: true, kind: "observe" },
      { id: "deals.board.kanban", label: "Канбан: карточки, перетаскивание между стадиями", included: true, kind: "interactive" },
      { id: "deals.board.list", label: "Список сделок с инлайн-правкой", included: true, kind: "observe" },
      { id: "deals.board.analytics", label: "Вкладка аналитики сделок", included: false, reason: "Агрегаты по одной сделке пусты; выдуманные суммы недопустимы." },
      { id: "deals.board.davinci", label: "Кнопка и карточка ответа Da Vinci на доске", included: false, reason: "Живой вызов модели из публичной сессии; отложено до решения по возможности «assistant»." },
      { id: "deals.board.detail-sheet", label: "Быстрый просмотр сделки (обзор / история / активности / команда)", included: true, kind: "observe" },
      { id: "deals.card.stage-progress", label: "Полоса стадий и чек-лист стадии", included: true, kind: "interactive" },
      { id: "deals.card.sidebar", label: "Боковая панель: сумма, вероятность, дата, ответственный, контакт, команда", included: true, kind: "interactive" },
      { id: "deals.card.kpi-chips", label: "KPI-чипы: дней в воронке / на стадии, письма, звонки", included: true, kind: "observe" },
      { id: "deals.card.customer-details", label: "Детали клиента", included: true, kind: "observe" },
      { id: "deals.card.quick-actions", label: "Быстрые действия: письмо, звонок, встреча, заметка", included: true, kind: "interactive" },
      { id: "deals.card.timeline", label: "Единая лента активности", included: true, kind: "observe" },
      { id: "deals.card.ai-prediction", label: "AI-прогноз сделки", included: true, kind: "observe" },
      { id: "deals.card.ai-suggestions", label: "AI-подсказки следующего шага", included: true, kind: "observe" },
      { id: "deals.card.next-best-offers", label: "Следующие лучшие предложения", included: true, kind: "observe" },
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
      { id: "quotes.detail.summary", label: "Итоги и срок действия", included: true, kind: "interactive" },
      { id: "quotes.detail.rejection", label: "Отклонение с причиной", included: false, reason: "История идёт по ветке принятия; отказ — альтернативная ветка, не первое знакомство." },
      { id: "quotes.detail.advisor-risk", label: "Виджет Advisor risk", included: false, reason: "Считается фоновыми прогонами Advisor; статичное значение было бы выдуманной метрикой." },
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
