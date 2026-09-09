/**
 * Help-article registry.
 *
 * Single source of truth for `slug → {locale → component, title}`.
 * When a new article ships, add an entry here and create the matching
 * `<slug>/{en,ru,az}.tsx` files.
 *
 * Convention: missing locales fall back to `en` (logged in dev). Don't
 * delete a locale entry once added — only update the component.
 */
import { ComponentType, lazy, LazyExoticComponent } from "react"
import type { Locale } from "@/i18n/routing"

/** Re-exported under a domain-specific alias so other help-system files
 * don't reach into i18n/routing directly. */
export type HelpLocale = Locale
export type HelpSlug =
  | "quotes"
  | "quote-detail"
  | "contracts"
  | "contracts-lifecycle"
  | "contracts-milestones"
  | "contracts-analytics"
  | "contracts-request"
  | "tasks"
  | "task-detail"
  | "leads"
  | "deals"
  | "contacts"
  | "companies"
  | "reports"
  | "report-builder"
  | "macros"
  | "campaign-orchestrator"
  | "energy-overview"
  | "health-overview"
  | "insurance-overview"
  | "media-overview"
  | "public-sector-overview"
  | "tickets"
  | "knowledge-base"
  | "skill-routing"
  | "sequences"
  | "crm-dashboard"
  | "campaigns"
  | "segments"
  | "campaign-roi"
  | "attribution-models"
  | "email-templates"
  | "email-log"
  | "loyalty-dashboard"
  | "loyalty-tiers"
  | "loyalty-earn-rules"
  | "loyalty-promo-codes"
  | "cdp-insights"
  | "cdp-merge-queue"
  | "ai-scoring"
  | "surveys"
  | "social-monitoring"
  | "account-engagement"
  | "ai-actions"
  | "projects"
  | "products"
  | "events"
  | "web-chat"
  | "inbox"
  | "inbox-automation"
  | "complaints"
  | "agent-desktop"
  | "entitlements"
  | "agent-calendar"
  | "voip"
  | "voip-insights"
  | "inbox-legacy"
  | "chatbot-rules"
  | "inbox-analytics"
  | "inbox-ai-agent"
  | "loyalty-builder"
  | "invoices"
  | "subscriptions"
  | "finance-overview"
  | "profitability"
  | "pricing"
  | "forecast"
  | "forecast-snapshots"
  | "forecast-waterfall"
  | "forecast-velocity"
  | "ai-command-center"
  | "mtm-overview"
  | "mtm-activity"
  | "mtm-leaderboard"
  | "mtm-map"
  | "mtm-alerts"
  | "mtm-photos"
  | "mtm-routes"
  | "mtm-promotions"
  | "mtm-tasks"
  | "mtm-visits"
  | "mtm-customers"
  | "mtm-agents"
  | "mtm-analytics"
  | "mtm-reports"
  | "mtm-settings"
  | "media-content"
  | "media-ad-campaigns"
  | "public-sector-cases"
  | "public-sector-grants"
  | "public-sector-licenses"
  | "notifications"
  | "settings-dashboard"
  | "workflow-templates"
  | "api-keys"
  | "energy-metering"
  | "energy-outages"
  | "energy-service-calls"
  | "health-providers"
  | "health-care-plans"
  | "health-encounters"
  | "insurance-policies"
  | "insurance-claims"
  | "insurance-beneficiaries"
  | "settings-overview"
  | "pipelines"
  | "settings-workflows"
  | "message-snippets"
  | "task-templates"
  | "users"
  | "field-permissions"
  | "roles"
  | "org-settings"
  | "security-settings"
  | "audit-log"
  | "portal-users"
  | "smtp"
  | "custom-fields"
  | "lead-rules"
  | "web-to-lead"
  | "intake-forms"
  | "forms"
  | "offers"
  | "billing"
  | "invoice-settings"
  | "finance-notifications"
  | "approval-rules"
  | "approval-delegates"
  | "sla-policies"
  | "channels"
  | "web-chat-settings"
  | "notification-settings"
  | "custom-domains"
  | "email-settings-templates"
  | "escalation"
  | "sales-forecast-settings"
  | "settings-leaderboard"
  | "boards"
  | "cobrowse"
  | "lead-scoring"
  | "leaderboard"
  | "marketplace"
  | "profile"
  | "invoice-create"
  | "invoices-recurring"
  | "complaint-new"
  | "complaints-import"
  | "whatsapp-channel"
  | "board-view"
  | "board-settings"
  | "lead-detail"
  | "deal-detail"
  | "contact-detail"
  | "company-detail"
  | "contacts-list"
  | "campaign-detail"
  | "ticket-detail"
  | "contract-detail"
  | "invoice-detail"
  | "offer-detail"
  | "product-detail"
  | "project-detail"
  | "event-detail"
  | "survey-detail"
  | "kb-article-detail"
  | "loyalty-account-detail"
  | "energy-customer-detail"
  | "health-patient-detail"
  | "insurance-holder-detail"
  | "media-subscriber-detail"
  | "cobrowse-session-detail"
  | "complaint-detail"
  | "contract-editor"
  | "form-detail"
  | "invoice-edit"
  | "quotas"
  | "territories"
  | "integrations"
  | "settings-voip"
  | "ai-automation"
  | "contract-templates"

type LocaleMap = Partial<Record<HelpLocale, LazyExoticComponent<ComponentType>>>

interface ArticleEntry {
  /** Localised display title shown in the drawer header. */
  title: Record<HelpLocale, string>
  /** Localised one-line subtitle shown under the title. */
  subtitle: Record<HelpLocale, string>
  /** Lazy-loaded content component per locale. */
  content: LocaleMap
}

export const HELP_REGISTRY: Record<HelpSlug, ArticleEntry> = {
  "skill-routing": {
    title: {
      en: "Skill Routing",
      ru: "Маршрутизация по навыкам",
      az: "Bacarıq marşrutlaşdırması",
    },
    subtitle: {
      en: "Assign agent skills and configure the queues that route tickets to them.",
      ru: "Назначайте навыки агентам и настраивайте очереди, которые направляют им тикеты.",
      az: "Agent bacarıqlarını təyin edin və biletləri onlara yönləndirən növbələri qurun.",
    },
    content: {
      en: lazy(() => import("./skill-routing/en")),
      ru: lazy(() => import("./skill-routing/ru")),
      az: lazy(() => import("./skill-routing/az")),
    },
  },
  inbox: {
    title: {
      en: "Inbox — Omni-Channel",
      ru: "Инбокс — омни-канал",
      az: "Gələnlər — omni-kanal",
    },
    subtitle: {
      en: "Every customer conversation — Email, Telegram, WhatsApp, SMS, social — in one place.",
      ru: "Все диалоги с клиентами — Email, Telegram, WhatsApp, SMS, соцсети — в одном месте.",
      az: "Bütün müştəri söhbətləri — E-poçt, Telegram, WhatsApp, SMS, sosial — bir yerdə.",
    },
    content: {
      en: lazy(() => import("./inbox/en")),
      ru: lazy(() => import("./inbox/ru")),
      az: lazy(() => import("./inbox/az")),
    },
  },
  "inbox-automation": {
    title: {
      en: "Inbox Automation",
      ru: "Автоматизация инбокса",
      az: "Inbox avtomatlaşdırması",
    },
    subtitle: {
      en: "Build safe routes for incoming messages: queues, scenarios, channel filters, replies, AI replies, and tests.",
      ru: "Собирайте безопасные маршруты для входящих сообщений: очереди, сценарии, каналы, ответы, AI-ответы и тесты.",
      az: "Gələn mesajlar üçün təhlükəsiz marşrutlar qurun: növbələr, ssenarilər, kanal filtrləri, cavablar, AI cavabları və testlər.",
    },
    content: {
      en: lazy(() => import("./inbox-automation/en")),
      ru: lazy(() => import("./inbox-automation/ru")),
      az: lazy(() => import("./inbox-automation/az")),
    },
  },
  quotes: {
    title: {
      en: "Quotes (CPQ)",
      ru: "Коммерческие предложения",
      az: "Kommersiya təklifləri (CPQ)",
    },
    subtitle: {
      en: "Configure, price, and quote — the offer document between deal and contract.",
      ru: "Документ между сделкой и контрактом: что продаёте, по какой цене, как долго цена действительна.",
      az: "Konfiqurasiya et, qiymət ver, təklif elə — satış və müqavilə arasındakı təklif sənədi.",
    },
    content: {
      en: lazy(() => import("./quotes/en")),
      ru: lazy(() => import("./quotes/ru")),
      az: lazy(() => import("./quotes/az")),
    },
  },
  "quote-detail": {
    title: { en: "Quote detail", ru: "Детали предложения", az: "Təklif detalı" },
    subtitle: {
      en: "Build, send, and track one quote's lifecycle — line items, discount, PDF, tracking pixel.",
      ru: "Соберите, отправьте и отследите жизненный цикл одного предложения — позиции, скидка, PDF, пиксель отслеживания.",
      az: "Bir təklifi qur, göndər və status həyat dövrünü izlə — sətirlər, endirim, PDF, izləmə pikseli.",
    },
    content: {
      en: lazy(() => import("./quote-detail/en")),
      ru: lazy(() => import("./quote-detail/ru")),
      az: lazy(() => import("./quote-detail/az")),
    },
  },
  contracts: {
    title: { en: "Contracts", ru: "Контракты", az: "Müqavilələr" },
    subtitle: {
      en: "The register of every agreement — create, filter, and open a contract.",
      ru: "Реестр всех договоров — создание, фильтры и открытие контракта.",
      az: "Bütün müqavilələrin reyestri — yaradın, süzün və müqaviləni açın.",
    },
    content: {
      en: lazy(() => import("./contracts/en")),
      ru: lazy(() => import("./contracts/ru")),
      az: lazy(() => import("./contracts/az")),
    },
  },
  "contracts-lifecycle": {
    title: { en: "Contract lifecycle", ru: "Жизненный цикл контрактов", az: "Müqavilə həyat dövrü" },
    subtitle: {
      en: "The board for approvals and renewals — what's pending, at-risk, and due.",
      ru: "Доска согласований и продлений — что в ожидании, под риском и к продлению.",
      az: "Təsdiqlər və yenilənmələr lövhəsi — gözləyən, riskdə və vaxtı çatan.",
    },
    content: {
      en: lazy(() => import("./contracts-lifecycle/en")),
      ru: lazy(() => import("./contracts-lifecycle/ru")),
      az: lazy(() => import("./contracts-lifecycle/az")),
    },
  },
  "contracts-milestones": {
    title: { en: "Contract milestones", ru: "Вехи контрактов", az: "Müqavilə mərhələləri" },
    subtitle: {
      en: "Track deliverables and payment milestones across contracts.",
      ru: "Отслеживайте поставки и платёжные вехи по контрактам.",
      az: "Müqavilələr üzrə təhvil və ödəniş mərhələlərini izləyin.",
    },
    content: {
      en: lazy(() => import("./contracts-milestones/en")),
      ru: lazy(() => import("./contracts-milestones/ru")),
      az: lazy(() => import("./contracts-milestones/az")),
    },
  },
  "contracts-analytics": {
    title: { en: "Contract analytics", ru: "Аналитика контрактов", az: "Müqavilə analitikası" },
    subtitle: {
      en: "Value, status mix, renewals and expirations across your contract book.",
      ru: "Стоимость, распределение статусов, продления и истечения по портфелю контрактов.",
      az: "Müqavilə portfeli üzrə dəyər, status payı, yenilənmələr və bitmələr.",
    },
    content: {
      en: lazy(() => import("./contracts-analytics/en")),
      ru: lazy(() => import("./contracts-analytics/ru")),
      az: lazy(() => import("./contracts-analytics/az")),
    },
  },
  "contracts-request": {
    title: { en: "Contract request", ru: "Запрос контракта", az: "Müqavilə sorğusu" },
    subtitle: {
      en: "Submit a request for a new contract to be drafted and approved.",
      ru: "Подайте запрос на создание и согласование нового контракта.",
      az: "Yeni müqavilənin hazırlanması və təsdiqi üçün sorğu göndərin.",
    },
    content: {
      en: lazy(() => import("./contracts-request/en")),
      ru: lazy(() => import("./contracts-request/ru")),
      az: lazy(() => import("./contracts-request/az")),
    },
  },
  tasks: {
    title: {
      en: "Tasks (recurring + templates)",
      ru: "Задачи (повторы + шаблоны)",
      az: "Tapşırıqlar (təkrarlar + şablonlar)",
    },
    subtitle: {
      en: "Track work that needs doing — plus power features for repeat workflows.",
      ru: "Отслеживайте работу — плюс мощные фичи для повторяющихся процессов.",
      az: "Görüləcək işləri izləyin — plus təkrarlanan proseslər üçün güclü funksiyalar.",
    },
    content: {
      en: lazy(() => import("./tasks/en")),
      ru: lazy(() => import("./tasks/ru")),
      az: lazy(() => import("./tasks/az")),
    },
  },
  "task-detail": {
    title: { en: "Task detail", ru: "Карточка задачи", az: "Tapşırıq detalları" },
    subtitle: {
      en: "Work a single task: status pipeline, assignee, checklist, attachments, comments, edit/delete.",
      ru: "Работа с одной задачей: конвейер статусов, исполнитель, чеклист, вложения, комментарии, ред./удаление.",
      az: "Bir tapşırığı işləmək: status xətti, icraçı, çek-list, qoşmalar, şərhlər, redaktə/silmə.",
    },
    content: {
      en: lazy(() => import("./task-detail/en")),
      ru: lazy(() => import("./task-detail/ru")),
      az: lazy(() => import("./task-detail/az")),
    },
  },
  leads: {
    title: { en: "Leads", ru: "Лиды", az: "Lidlər" },
    subtitle: {
      en: "Work the leads list — saved views, filters, bulk actions, and Da Vinci insights.",
      ru: "Работайте со списком лидов — виды, фильтры, массовые действия и подсказки Da Vinci.",
      az: "Lid siyahısı ilə işləyin — görünüşlər, filtrlər, kütləvi əməliyyatlar və Da Vinci anlayışları.",
    },
    content: {
      en: lazy(() => import("./leads/en")),
      ru: lazy(() => import("./leads/ru")),
      az: lazy(() => import("./leads/az")),
    },
  },
  deals: {
    title: { en: "Deals", ru: "Сделки", az: "Sövdələşmələr" },
    subtitle: {
      en: "Work the deals pipeline — list/board views, filters, and bulk stage moves.",
      ru: "Работайте с воронкой сделок — список/доска, фильтры и массовая смена стадий.",
      az: "Sövdə huni ilə işləyin — siyahı/lövhə görünüşləri, filtrlər və kütləvi mərhələ dəyişikliyi.",
    },
    content: {
      en: lazy(() => import("./deals/en")),
      ru: lazy(() => import("./deals/ru")),
      az: lazy(() => import("./deals/az")),
    },
  },
  contacts: {
    title: { en: "Contacts", ru: "Контакты", az: "Kontaktlar" },
    subtitle: {
      en: "Manage the contacts list — saved views, filters, and bulk actions.",
      ru: "Управляйте списком контактов — виды, фильтры и массовые действия.",
      az: "Kontakt siyahısını idarə edin — görünüşlər, filtrlər və kütləvi əməliyyatlar.",
    },
    content: {
      en: lazy(() => import("./contacts/en")),
      ru: lazy(() => import("./contacts/ru")),
      az: lazy(() => import("./contacts/az")),
    },
  },
  companies: {
    title: { en: "Companies", ru: "Компании", az: "Şirkətlər" },
    subtitle: {
      en: "Manage the companies list — saved views, filters, and bulk actions.",
      ru: "Управляйте списком компаний — виды, фильтры и массовые действия.",
      az: "Şirkət siyahısını idarə edin — görünüşlər, filtrlər və kütləvi əməliyyatlar.",
    },
    content: {
      en: lazy(() => import("./companies/en")),
      ru: lazy(() => import("./companies/ru")),
      az: lazy(() => import("./companies/az")),
    },
  },
  reports: {
    title: {
      en: "Reports (pre-built + No-Code builder)",
      ru: "Отчёты (готовые + No-Code конструктор)",
      az: "Hesabatlar (hazır + No-Code konstruktor)",
    },
    subtitle: {
      en: "Read the numbers, or build your own slice with the report builder.",
      ru: "Читайте цифры или соберите свою выборку конструктором отчётов.",
      az: "Rəqəmləri oxuyun, ya da hesabat konstruktoru ilə öz kəsiyinizi qurun.",
    },
    content: {
      en: lazy(() => import("./reports/en")),
      ru: lazy(() => import("./reports/ru")),
      az: lazy(() => import("./reports/az")),
    },
  },
  "voip-insights": {
    title: { en: "Conversation Intelligence", ru: "Аналитика разговоров", az: "Söhbət analitikası" },
    subtitle: {
      en: "AI insights across your calls — sentiment, action items, competitors, coaching.",
      ru: "ИИ-аналитика по звонкам — настроение, задачи, конкуренты, подсказки.",
      az: "Zənglər üzrə süni intellekt analitikası — əhval, tapşırıqlar, rəqiblər, təlim.",
    },
    content: {
      en: lazy(() => import("./voip-insights/en")),
      ru: lazy(() => import("./voip-insights/ru")),
      az: lazy(() => import("./voip-insights/az")),
    },
  },
  "inbox-legacy": {
    title: { en: "Inbox (legacy)", ru: "Инбокс (старый)", az: "Gələnlər (köhnə)" },
    subtitle: {
      en: "The classic single-column inbox view of customer conversations.",
      ru: "Классический одноколоночный вид входящих диалогов.",
      az: "Müştəri söhbətlərinin klassik tək-sütunlu görünüşü.",
    },
    content: {
      en: lazy(() => import("./inbox-legacy/en")),
      ru: lazy(() => import("./inbox-legacy/ru")),
      az: lazy(() => import("./inbox-legacy/az")),
    },
  },
  "chatbot-rules": {
    title: { en: "Chatbot rules", ru: "Правила чат-бота", az: "Çatbot qaydaları" },
    subtitle: {
      en: "Keyword auto-reply rules that the bot answers with before a human steps in.",
      ru: "Правила автоответа по ключевым словам, которыми бот отвечает до подключения человека.",
      az: "Bot insandan əvvəl cavab verən açar-söz avtocavab qaydaları.",
    },
    content: {
      en: lazy(() => import("./chatbot-rules/en")),
      ru: lazy(() => import("./chatbot-rules/ru")),
      az: lazy(() => import("./chatbot-rules/az")),
    },
  },
  "inbox-analytics": {
    title: { en: "Inbox analytics", ru: "Аналитика инбокса", az: "Gələnlər analitikası" },
    subtitle: {
      en: "Volume, response times, and channel mix across your inbox conversations.",
      ru: "Объём, время ответа и распределение по каналам по диалогам инбокса.",
      az: "Gələnlər söhbətləri üzrə həcm, cavab vaxtı və kanal payı.",
    },
    content: {
      en: lazy(() => import("./inbox-analytics/en")),
      ru: lazy(() => import("./inbox-analytics/ru")),
      az: lazy(() => import("./inbox-analytics/az")),
    },
  },
  "inbox-ai-agent": {
    title: { en: "Inbox AI agent", ru: "ИИ-агент инбокса", az: "Gələnlər süni intellekt agenti" },
    subtitle: {
      en: "Configure the AI persona, auto-reply, follow-up, and escalation for the inbox.",
      ru: "Настройте ИИ-персону, автоответ, фолоу-ап и эскалацию для инбокса.",
      az: "Gələnlər üçün süni intellekt personasını, avtocavabı, təqibi və eskalasiyanı qurun.",
    },
    content: {
      en: lazy(() => import("./inbox-ai-agent/en")),
      ru: lazy(() => import("./inbox-ai-agent/ru")),
      az: lazy(() => import("./inbox-ai-agent/az")),
    },
  },
  "loyalty-builder": {
    title: { en: "Loyalty Builder", ru: "Конструктор лояльности", az: "Loyallıq konstruktoru" },
    subtitle: {
      en: "Assemble your loyalty program end to end — tiers, earn rules, and rewards in one flow.",
      ru: "Соберите программу лояльности от и до — уровни, правила начисления и награды в одном потоке.",
      az: "Loyallıq proqramını başdan-sona qurun — səviyyələr, qazanma qaydaları və mükafatlar bir axında.",
    },
    content: {
      en: lazy(() => import("./loyalty-builder/en")),
      ru: lazy(() => import("./loyalty-builder/ru")),
      az: lazy(() => import("./loyalty-builder/az")),
    },
  },
  macros: {
    title: {
      en: "Macros (ticket automation)",
      ru: "Макросы (автоматизация тикетов)",
      az: "Makrolar (ticket avtomatlaşdırması)",
    },
    subtitle: {
      en: "Save a sequence of ticket actions, fire it in one click.",
      ru: "Сохраните цепочку действий над тикетом, запускайте одним кликом.",
      az: "Ticket əməliyyatları ardıcıllığını saxlayın, bir kliklə işə salın.",
    },
    content: {
      en: lazy(() => import("./macros/en")),
      ru: lazy(() => import("./macros/ru")),
      az: lazy(() => import("./macros/az")),
    },
  },
  "campaign-orchestrator": {
    title: {
      en: "Journeys (campaign orchestrator)",
      ru: "Журнеи (конструктор кампаний)",
      az: "Journey-lər (kampaniya orkestratoru)",
    },
    subtitle: {
      en: "Multi-step automations with goals, branches, and A/B splits.",
      ru: "Многошаговые автоматизации с целями, ветками и A/B-сплитами.",
      az: "Hədəfləri, qollanmaları və A/B bölmələri olan çoxaddımlı avtomatlaşdırmalar.",
    },
    content: {
      en: lazy(() => import("./campaign-orchestrator/en")),
      ru: lazy(() => import("./campaign-orchestrator/ru")),
      az: lazy(() => import("./campaign-orchestrator/az")),
    },
  },
  "energy-overview": {
    title: { en: "Energy & Utilities — landing", ru: "Энергетика и ЖКХ — стартовая", az: "Enerji və Kommunal — giriş" },
    subtitle: {
      en: "The vertical's landing: utility-customers list, stat cards, search + status filter, drill-down.",
      ru: "Стартовая страница вертикали: список клиентов ЖКХ, карточки, поиск + фильтр статуса, переход в карточку.",
      az: "Vertikalın giriş səhifəsi: kommunal müştərilər siyahısı, statistika kartları, axtarış + status filtri, detala keçid.",
    },
    content: {
      en: lazy(() => import("./energy-overview/en")),
      ru: lazy(() => import("./energy-overview/ru")),
      az: lazy(() => import("./energy-overview/az")),
    },
  },
  "health-overview": {
    title: { en: "Health Cloud — overview", ru: "Облако здравоохранения — стартовая", az: "Sağlamlıq Buludu — giriş" },
    subtitle: {
      en: "The Health Cloud landing: four stat cards, patient search/status filter, row-click into records.",
      ru: "Стартовая страница: четыре метрики, поиск пациентов/фильтр статуса, переход в карточку по строке.",
      az: "Health Cloud giriş: dörd statistika kartı, xəstə axtarışı/status filtri, sətirə klik ilə karta keçid.",
    },
    content: {
      en: lazy(() => import("./health-overview/en")),
      ru: lazy(() => import("./health-overview/ru")),
      az: lazy(() => import("./health-overview/az")),
    },
  },
  "insurance-overview": {
    title: { en: "Insurance Cloud — landing", ru: "Страховое облако — стартовая", az: "Sığorta Buludu — giriş" },
    subtitle: {
      en: "Policy holders list, four stat cards, search/status filter, table, drill-down into holder detail.",
      ru: "Список страхователей, четыре метрики, поиск/фильтр статуса, таблица, переход в карточку.",
      az: "Sığortalılar siyahısı, dörd statistika kartı, axtarış/status filtri, cədvəl, detala keçid.",
    },
    content: {
      en: lazy(() => import("./insurance-overview/en")),
      ru: lazy(() => import("./insurance-overview/ru")),
      az: lazy(() => import("./insurance-overview/az")),
    },
  },
  "media-overview": {
    title: { en: "Media Cloud — overview", ru: "Медиа Облако — обзор", az: "Media Buludu — ümumi baxış" },
    subtitle: {
      en: "Subscriber list, stat cards, search/status filter, and opening a subscriber's detail.",
      ru: "Список подписчиков, карточки статистики, поиск/фильтр статуса и переход в карточку подписчика.",
      az: "Abunəçilər siyahısı, statistika kartları, axtarış/status filtri və abunəçi detalına keçid.",
    },
    content: {
      en: lazy(() => import("./media-overview/en")),
      ru: lazy(() => import("./media-overview/ru")),
      az: lazy(() => import("./media-overview/az")),
    },
  },
  "public-sector-overview": {
    title: { en: "Public Sector — overview", ru: "Госсектор — обзор", az: "Dövlət sektoru — icmal" },
    subtitle: {
      en: "The Public Sector vertical's landing: citizen registry, stat cards, search, status filter.",
      ru: "Стартовая страница вертикали «Госсектор»: реестр граждан, карточки статистики, поиск, фильтр статуса.",
      az: "Dövlət sektoru vertikalının giriş səhifəsi: vətəndaş reyestri, statistika kartları, axtarış, status filtri.",
    },
    content: {
      en: lazy(() => import("./public-sector-overview/en")),
      ru: lazy(() => import("./public-sector-overview/ru")),
      az: lazy(() => import("./public-sector-overview/az")),
    },
  },
  tickets: {
    title: { en: "Tickets", ru: "Тикеты", az: "Dəstək Mərkəzi" },
    subtitle: {
      en: "Support ticket management with SLA tracking.",
      ru: "Управление тикетами поддержки с отслеживанием SLA.",
      az: "SLA izləmə ilə dəstək biletlərini idarə et.",
    },
    content: {
      en: lazy(() => import("./tickets/en")),
      ru: lazy(() => import("./tickets/ru")),
      az: lazy(() => import("./tickets/az")),
    },
  },
  "knowledge-base": {
    title: { en: "Knowledge Base", ru: "База знаний", az: "Bilik bazası" },
    subtitle: {
      en: "Create, categorize, publish, and search articles for customers and your team.",
      ru: "Создавайте, распределяйте по категориям, публикуйте и ищите статьи для клиентов и команды.",
      az: "Müştərilər və komanda üçün məqalələr yaradın, kateqoriyalara bölün, nəşr edin və axtarın.",
    },
    content: {
      en: lazy(() => import("./knowledge-base/en")),
      ru: lazy(() => import("./knowledge-base/ru")),
      az: lazy(() => import("./knowledge-base/az")),
    },
  },
  segments: {
    title: { en: "Segments", ru: "Сегменты", az: "Seqmentlər" },
    subtitle: {
      en: "Split contacts into named groups by criteria — for targeted campaigns and analytics.",
      ru: "Разбейте контакты на именованные группы по критериям — для целевых рассылок и аналитики.",
      az: "Kontaktları meyarlara görə adlı qruplara bölün — hədəfli kampaniyalar və analitika üçün.",
    },
    content: {
      en: lazy(() => import("./segments/en")),
      ru: lazy(() => import("./segments/ru")),
      az: lazy(() => import("./segments/az")),
    },
  },
  "campaign-roi": {
    title: { en: "Campaign ROI", ru: "ROI кампаний", az: "Kampaniya ROI" },
    subtitle: {
      en: "Read each email/SMS campaign's revenue and return on investment — cards, attribution, funnel, linked deals.",
      ru: "Читайте выручку и ROI каждой email/SMS-кампании — карточки, атрибуция, воронка, привязанные сделки.",
      az: "Hər email/SMS kampaniyasının gəlirini və ROI-nu oxuyun — kartlar, atribusiya, huni, əlaqəli sövdələr.",
    },
    content: {
      en: lazy(() => import("./campaign-roi/en")),
      ru: lazy(() => import("./campaign-roi/ru")),
      az: lazy(() => import("./campaign-roi/az")),
    },
  },
  "attribution-models": {
    title: { en: "Attribution models", ru: "Модели атрибуции", az: "Atribusiya modelləri" },
    subtitle: {
      en: "How a won deal's revenue is split across the campaigns that contributed.",
      ru: "Как выручка выигранной сделки распределяется между кампаниями, которые в неё вложились.",
      az: "Qazanılan sövdənin gəlirinin töhfə verən kampaniyalar arasında necə bölünməsi.",
    },
    content: {
      en: lazy(() => import("./attribution-models/en")),
      ru: lazy(() => import("./attribution-models/ru")),
      az: lazy(() => import("./attribution-models/az")),
    },
  },
  "email-templates": {
    title: { en: "Email templates", ru: "Email-шаблоны", az: "Email şablonları" },
    subtitle: {
      en: "Create and manage reusable email templates personalized with variables.",
      ru: "Создавайте и ведите многоразовые email-шаблоны с переменными.",
      az: "Dəyişənlərlə fərdiləşən təkrar istifadəli email şablonları yaradın və idarə edin.",
    },
    content: {
      en: lazy(() => import("./email-templates/en")),
      ru: lazy(() => import("./email-templates/ru")),
      az: lazy(() => import("./email-templates/az")),
    },
  },
  "email-log": {
    title: { en: "Email log", ru: "Журнал email", az: "Email Jurnalı" },
    subtitle: {
      en: "History and delivery status of all sent and received emails.",
      ru: "История и статус доставки всех отправленных и полученных писем.",
      az: "Bütün göndərilmiş və alınmış emaillərin tarixi və çatdırılma statusu.",
    },
    content: {
      en: lazy(() => import("./email-log/en")),
      ru: lazy(() => import("./email-log/ru")),
      az: lazy(() => import("./email-log/az")),
    },
  },
  "loyalty-dashboard": {
    title: { en: "Loyalty overview", ru: "Обзор лояльности", az: "Sadiqlik proqramı icmalı" },
    subtitle: {
      en: "Read program health: KPI cards, tier distribution, top members, recent transactions.",
      ru: "Читаем здоровье программы: KPI, уровни, топ-участники, последние транзакции.",
      az: "Proqramın sağlamlığı: KPI kartları, səviyyə paylanması, top üzvlər, son əməliyyatlar.",
    },
    content: {
      en: lazy(() => import("./loyalty-dashboard/en")),
      ru: lazy(() => import("./loyalty-dashboard/ru")),
      az: lazy(() => import("./loyalty-dashboard/az")),
    },
  },
  "loyalty-tiers": {
    title: { en: "Loyalty tiers", ru: "Уровни лояльности", az: "Sadiqlik səviyyələri" },
    subtitle: {
      en: "Set up the tier ladder — code, name, threshold and earn multiplier per tier.",
      ru: "Настройте лестницу уровней — код, название, порог и множитель начисления.",
      az: "Səviyyə pilləkənini qurun — hər səviyyəyə kod, ad, hədd və qazanma əmsalı.",
    },
    content: {
      en: lazy(() => import("./loyalty-tiers/en")),
      ru: lazy(() => import("./loyalty-tiers/ru")),
      az: lazy(() => import("./loyalty-tiers/az")),
    },
  },
  "loyalty-earn-rules": {
    title: { en: "Earn rules", ru: "Правила начисления", az: "Qazanma qaydaları" },
    subtitle: {
      en: "Define which events earn how many points, and the conditions that apply.",
      ru: "Задайте, какие события сколько баллов начисляют и при каких условиях.",
      az: "Hansı hadisələrin nə qədər xal qazandırdığını və hansı şərtlərlə təyin edin.",
    },
    content: {
      en: lazy(() => import("./loyalty-earn-rules/en")),
      ru: lazy(() => import("./loyalty-earn-rules/ru")),
      az: lazy(() => import("./loyalty-earn-rules/az")),
    },
  },
  "loyalty-promo-codes": {
    title: { en: "Promo codes", ru: "Промокоды", az: "Promo kodlar" },
    subtitle: {
      en: "Create discount / points promo codes and track redemption.",
      ru: "Создавайте промокоды на скидку / баллы и отслеживайте погашение.",
      az: "Endirim / xal promo kodları yaradın və istifadəni izləyin.",
    },
    content: {
      en: lazy(() => import("./loyalty-promo-codes/en")),
      ru: lazy(() => import("./loyalty-promo-codes/ru")),
      az: lazy(() => import("./loyalty-promo-codes/az")),
    },
  },
  sequences: {
    title: {
      en: "Sequences (automated follow-up cadences)",
      ru: "Цепочки (автоматические касания)",
      az: "Zəncirlər (avtomatik təqib ardıcıllıqları)",
    },
    subtitle: {
      en: "Build a multi-step email / call / task cadence and let the runner work every enrolled lead and contact.",
      ru: "Соберите многошаговую цепочку писем / звонков / задач, а раннер проведёт по ней каждого лида и контакт.",
      az: "Çoxaddımlı e-poçt / zəng / tapşırıq zənciri qurun, runner isə hər lid və kontaktı onunla aparsın.",
    },
    content: {
      en: lazy(() => import("./sequences/en")),
      ru: lazy(() => import("./sequences/ru")),
      az: lazy(() => import("./sequences/az")),
    },
  },
  "crm-dashboard": {
    title: {
      en: "Dashboard & Notifications",
      ru: "Дашборд и уведомления",
      az: "İdarə paneli və bildirişlər",
    },
    subtitle: {
      en: "Your one-screen executive overview, plus the alert feed for everything that needs you.",
      ru: "Обзорный экран бизнеса и лента уведомлений обо всём, что требует внимания.",
      az: "Biznesin tək ekranlıq icmalı və diqqət tələb edən hər şey üçün bildiriş lenti.",
    },
    content: {
      en: lazy(() => import("./crm-dashboard/en")),
      ru: lazy(() => import("./crm-dashboard/ru")),
      az: lazy(() => import("./crm-dashboard/az")),
    },
  },
  campaigns: {
    title: { en: "Campaigns", ru: "Кампании", az: "Kampaniyalar" },
    subtitle: {
      en: "Send an email/SMS campaign to an audience and track delivery + engagement.",
      ru: "Отправьте email/SMS-кампанию аудитории и отслеживайте доставку и вовлечённость.",
      az: "Auditoriyaya email/SMS kampaniyası göndərin, çatdırılma və cəlbi izləyin.",
    },
    content: {
      en: lazy(() => import("./campaigns/en")),
      ru: lazy(() => import("./campaigns/ru")),
      az: lazy(() => import("./campaigns/az")),
    },
  },
  "cdp-insights": {
    title: { en: "Customer Insights", ru: "Аналитика клиентов", az: "Müştəri analitikası" },
    subtitle: {
      en: "The unified customer view — KPI trends, segments, and who to act on.",
      ru: "Единый профиль клиента — тренды KPI, сегменты и с кем работать.",
      az: "Vahid müştəri görünüşü — KPI trendləri, seqmentlər və kiminlə işləmək.",
    },
    content: {
      en: lazy(() => import("./cdp-insights/en")),
      ru: lazy(() => import("./cdp-insights/ru")),
      az: lazy(() => import("./cdp-insights/az")),
    },
  },
  "cdp-merge-queue": {
    title: { en: "Identity Merge Queue", ru: "Очередь слияния профилей", az: "Profil birləşdirmə növbəsi" },
    subtitle: {
      en: "Review likely-duplicate profile pairs and merge them into one customer.",
      ru: "Просматривайте вероятные дубликаты профилей и объединяйте в одного клиента.",
      az: "Ehtimal olunan dublikat profil cütlərini nəzərdən keçirin və bir müştəridə birləşdirin.",
    },
    content: {
      en: lazy(() => import("./cdp-merge-queue/en")),
      ru: lazy(() => import("./cdp-merge-queue/ru")),
      az: lazy(() => import("./cdp-merge-queue/az")),
    },
  },
  "report-builder": {
    title: { en: "Report Builder", ru: "Конструктор отчётов", az: "Hesabat konstruktoru" },
    subtitle: {
      en: "Build a custom report with no code — pick a source, columns, filters, and chart.",
      ru: "Соберите отчёт без кода — выберите источник, колонки, фильтры и график.",
      az: "Kodsuz xüsusi hesabat qurun — mənbə, sütunlar, filtrlər və qrafik seçin.",
    },
    content: {
      en: lazy(() => import("./report-builder/en")),
      ru: lazy(() => import("./report-builder/ru")),
      az: lazy(() => import("./report-builder/az")),
    },
  },
  "ai-scoring": {
    title: {
      en: "Da Vinci Lead Scoring",
      ru: "Da Vinci: скоринг лидов",
      az: "Da Vinci lid skorinqi",
    },
    subtitle: {
      en: "How the AI ranks leads by conversion likelihood, and what drives the score.",
      ru: "Как ИИ ранжирует лидов по вероятности конверсии и что влияет на оценку.",
      az: "Süni intellektin lidləri konversiya ehtimalına görə necə sıraladığı və skoru nəyin formalaşdırdığı.",
    },
    content: {
      en: lazy(() => import("./ai-scoring/en")),
      ru: lazy(() => import("./ai-scoring/ru")),
      az: lazy(() => import("./ai-scoring/az")),
    },
  },
  surveys: {
    title: {
      en: "Surveys & NPS",
      ru: "Опросы и NPS",
      az: "Sorğular və NPS",
    },
    subtitle: {
      en: "Send surveys, collect responses, and track NPS / CSAT / CES over time.",
      ru: "Отправляйте опросы, собирайте ответы и отслеживайте NPS / CSAT / CES.",
      az: "Sorğu göndərin, cavab toplayın və NPS / CSAT / CES göstəricilərini izləyin.",
    },
    content: {
      en: lazy(() => import("./surveys/en")),
      ru: lazy(() => import("./surveys/ru")),
      az: lazy(() => import("./surveys/az")),
    },
  },
  "social-monitoring": {
    title: {
      en: "Social Monitoring",
      ru: "Мониторинг соцсетей",
      az: "Sosial media monitorinqi",
    },
    subtitle: {
      en: "Track mentions and messages across social channels and turn them into action.",
      ru: "Отслеживайте упоминания и сообщения в соцсетях и превращайте их в действия.",
      az: "Sosial kanallarda qeydləri və mesajları izləyin və onları əməliyyata çevirin.",
    },
    content: {
      en: lazy(() => import("./social-monitoring/en")),
      ru: lazy(() => import("./social-monitoring/ru")),
      az: lazy(() => import("./social-monitoring/az")),
    },
  },
  "account-engagement": {
    title: {
      en: "Account Engagement (ABM)",
      ru: "Вовлечённость аккаунтов (ABM)",
      az: "Hesab cəlbi (ABM)",
    },
    subtitle: {
      en: "An account-based view: engagement score, ICP grade, and 30-day intent signals.",
      ru: "ABM-вид: балл вовлечённости, ICP-оценка и сигналы намерения за 30 дней.",
      az: "ABM görünüşü: cəlb balı, ICP qiyməti və 30 günlük niyyət siqnalları.",
    },
    content: {
      en: lazy(() => import("./account-engagement/en")),
      ru: lazy(() => import("./account-engagement/ru")),
      az: lazy(() => import("./account-engagement/az")),
    },
  },
  "ai-actions": {
    title: {
      en: "AI Actions",
      ru: "AI-действия",
      az: "AI əməliyyatları",
    },
    subtitle: {
      en: "Advisor signals, evidence, approval queue, and execution history in one operating center.",
      ru: "Сигналы Advisor, доказательства, очередь согласования и история исполнения в одном операционном центре.",
      az: "Advisor siqnalları, sübutlar, təsdiq növbəsi və icra tarixçəsi vahid əməliyyat mərkəzində.",
    },
    content: {
      en: lazy(() => import("./ai-actions/en")),
      ru: lazy(() => import("./ai-actions/ru")),
      az: lazy(() => import("./ai-actions/az")),
    },
  },
  projects: {
    title: {
      en: "Projects",
      ru: "Проекты",
      az: "Layihələr",
    },
    subtitle: {
      en: "Plan and track delivery work as projects, separate from the sales pipeline.",
      ru: "Планируйте и отслеживайте проектную работу отдельно от воронки продаж.",
      az: "Layihə işini satış boru kəmərindən ayrı planlaşdırın və izləyin.",
    },
    content: {
      en: lazy(() => import("./projects/en")),
      ru: lazy(() => import("./projects/ru")),
      az: lazy(() => import("./projects/az")),
    },
  },
  products: {
    title: {
      en: "Products & Services",
      ru: "Продукты и услуги",
      az: "Məhsullar və Xidmətlər",
    },
    subtitle: {
      en: "Your reusable catalog of services, products, add-ons, and consulting — with price, currency, features, and tags.",
      ru: "Переиспользуемый каталог услуг, продуктов, дополнений и консалтинга — с ценой, валютой, возможностями и тегами.",
      az: "Xidmət, məhsul, əlavə və konsaltinqin təkrar istifadəli kataloqu — qiymət, valyuta, xüsusiyyətlər və teqlərlə.",
    },
    content: {
      en: lazy(() => import("./products/en")),
      ru: lazy(() => import("./products/ru")),
      az: lazy(() => import("./products/az")),
    },
  },
  events: {
    title: {
      en: "Events",
      ru: "Мероприятия",
      az: "Tədbirlər",
    },
    subtitle: {
      en: "Plan conferences and webinars, invite or let people self-register, then track attendance, budget, and ROI.",
      ru: "Планируйте конференции и вебинары, приглашайте или давайте регистрироваться самим, отслеживайте посещаемость, бюджет и ROI.",
      az: "Konfrans və vebinarları planlayın, dəvət edin və ya özünü-qeydiyyata icazə verin, sonra iştirakı, büdcəni və ROI-nı izləyin.",
    },
    content: {
      en: lazy(() => import("./events/en")),
      ru: lazy(() => import("./events/ru")),
      az: lazy(() => import("./events/az")),
    },
  },
  "web-chat": {
    title: {
      en: "Web Chat Inbox",
      ru: "Входящие веб-чата",
      az: "Veb-çat gələnləri",
    },
    subtitle: {
      en: "Reply to live website-chat visitors, take conversations over from the AI, and escalate to a ticket.",
      ru: "Отвечайте посетителям живого веб-чата, перехватывайте диалоги у ИИ и эскалируйте в тикет.",
      az: "Canlı veb-çat ziyarətçilərinə cavab verin, söhbətləri AI-dan öz üzərinizə götürün və biletə eskalasiya edin.",
    },
    content: {
      en: lazy(() => import("./web-chat/en")),
      ru: lazy(() => import("./web-chat/ru")),
      az: lazy(() => import("./web-chat/az")),
    },
  },
  complaints: {
    title: {
      en: "Complaints & Suggestions Register",
      ru: "Реестр жалоб и предложений",
      az: "Şikayət və təkliflər reyestri",
    },
    subtitle: {
      en: "Log every complaint or suggestion as a ticket — brand, product, risk, and department — with AI triage, history, and xlsx import/export.",
      ru: "Фиксируйте каждую жалобу или предложение как тикет — бренд, продукт, риск и подразделение — с ИИ-разбором, историей и импортом/экспортом xlsx.",
      az: "Hər şikayəti və ya təklifi ticket kimi qeyd edin — marka, məhsul, risk və şöbə — süni intellekt təsnifatı, tarixçə və xlsx idxal/ixracı ilə.",
    },
    content: {
      en: lazy(() => import("./complaints/en")),
      ru: lazy(() => import("./complaints/ru")),
      az: lazy(() => import("./complaints/az")),
    },
  },
  "agent-desktop": {
    title: {
      en: "Agent Desktop",
      ru: "Рабочий стол агента",
      az: "Agent Masaüstü",
    },
    subtitle: {
      en: "Your support home screen — availability toggle, live KPI cards, team gauges, open-cases queue, and the agent leaderboard.",
      ru: "Домашний экран поддержки — переключатель статуса, живые KPI-карточки, командные шкалы, очередь открытых обращений и рейтинг агентов.",
      az: "Dəstək ana ekranınız — əlçatanlıq açarı, canlı KPI kartları, komanda göstəriciləri, açıq müraciətlər növbəsi və agent reytinqi.",
    },
    content: {
      en: lazy(() => import("./agent-desktop/en")),
      ru: lazy(() => import("./agent-desktop/ru")),
      az: lazy(() => import("./agent-desktop/az")),
    },
  },
  entitlements: {
    title: {
      en: "Customer support terms",
      ru: "Условия поддержки клиентов",
      az: "Müştəri dəstək şərtləri",
    },
    subtitle: {
      en: "Create customer-level support terms, bind companies to SLA policies, and monitor granular milestone health beyond the headline first-response and resolution clocks.",
      ru: "Создавайте условия поддержки на уровне клиента, связывайте компании с SLA-политиками и отслеживайте здоровье вех сверх главных таймеров первого ответа и решения.",
      az: "Müştəri səviyyəli dəstək şərtləri yaradın, şirkətləri SLA siyasətlərinə bağlayın və ilk cavab/həll taymerlərindən əlavə mərhələ sağlamlığını izləyin.",
    },
    content: {
      en: lazy(() => import("./entitlements/en")),
      ru: lazy(() => import("./entitlements/ru")),
      az: lazy(() => import("./entitlements/az")),
    },
  },
  "agent-calendar": {
    title: {
      en: "Agent Calendar",
      ru: "Календарь агента",
      az: "Agent Təqvimi",
    },
    subtitle: {
      en: "A read-only weekly view that pulls your tickets, tasks, events, and activities into one timeline — click any item to open its source record.",
      ru: "Недельный режим только для чтения, который сводит ваши тикеты, задачи, мероприятия и активности в одну ленту — кликните элемент, чтобы открыть исходную запись.",
      az: "Tiketlərinizi, tapşırıqlarınızı, tədbirlərinizi və fəaliyyətlərinizi vahid xronologiyaya yığan yalnız-oxumaq həftəlik görünüş — mənbə qeydini açmaq üçün istənilən elementə klikləyin.",
    },
    content: {
      en: lazy(() => import("./agent-calendar/en")),
      ru: lazy(() => import("./agent-calendar/ru")),
      az: lazy(() => import("./agent-calendar/az")),
    },
  },
  voip: {
    title: {
      en: "Calls & Conversation Intelligence",
      ru: "Звонки и аналитика разговоров",
      az: "Zənglər və söhbət analitikası",
    },
    subtitle: {
      en: "Log every call against a contact, then let AI surface sentiment, action items, competitors, and coaching from the transcript.",
      ru: "Фиксируйте каждый звонок в контакте, а ИИ достаёт из расшифровки настроение, задачи, конкурентов и подсказки для разбора.",
      az: "Hər zəngi kontakta qeyd edin, süni intellekt isə transkriptdən əhval-ruhiyyəni, tapşırıqları, rəqibləri və təlim ipucularını çıxarsın.",
    },
    content: {
      en: lazy(() => import("./voip/en")),
      ru: lazy(() => import("./voip/ru")),
      az: lazy(() => import("./voip/az")),
    },
  },
  invoices: {
    title: { en: "Invoices", ru: "Счета", az: "Fakturalar" },
    subtitle: {
      en: "Bill a one-off invoice, take payment, and chase the late ones.",
      ru: "Выставьте разовый счёт, примите оплату и догоните просроченные.",
      az: "Birdəfəlik faktura kəsin, ödəniş qəbul edin və gecikənləri qovun.",
    },
    content: {
      en: lazy(() => import("./invoices/en")),
      ru: lazy(() => import("./invoices/ru")),
      az: lazy(() => import("./invoices/az")),
    },
  },
  subscriptions: {
    title: { en: "Subscriptions", ru: "Подписки", az: "Abunəliklər" },
    subtitle: {
      en: "Recurring-revenue health: status KPIs, MRR by plan, trials ending, past-due.",
      ru: "Здоровье регулярной выручки: KPI статусов, MRR по плану, истекающие пробные, просрочка.",
      az: "Təkrarlanan gəlirin sağlamlığı: status KPI-ları, plan üzrə MRR, bitən sınaqlar, gecikmiş.",
    },
    content: {
      en: lazy(() => import("./subscriptions/en")),
      ru: lazy(() => import("./subscriptions/ru")),
      az: lazy(() => import("./subscriptions/az")),
    },
  },
  "finance-overview": {
    title: { en: "Financial Overview", ru: "Финансовый обзор", az: "Maliyyə icmalı" },
    subtitle: {
      en: "Pick a period, read KPI cards, charts and the financial summary, export to Excel.",
      ru: "Выберите период, читайте KPI, графики и финансовую сводку, экспортируйте в Excel.",
      az: "Dövr seçin, KPI kartlarını, qrafikləri və maliyyə xülasəsini oxuyun, Excel-ə ixrac edin.",
    },
    content: {
      en: lazy(() => import("./finance-overview/en")),
      ru: lazy(() => import("./finance-overview/ru")),
      az: lazy(() => import("./finance-overview/az")),
    },
  },
  profitability: {
    title: { en: "Profitability", ru: "Прибыльность", az: "Gəlirlilik" },
    subtitle: {
      en: "Cost-model analytics: what each service and client really costs, and the margin.",
      ru: "Аналитика модели затрат: во сколько реально обходится сервис и клиент, и маржа.",
      az: "Xərc modeli analitikası: hər xidmət və müştəri nəyə başa gəlir və marja.",
    },
    content: {
      en: lazy(() => import("./profitability/en")),
      ru: lazy(() => import("./profitability/ru")),
      az: lazy(() => import("./profitability/az")),
    },
  },
  pricing: {
    title: { en: "Pricing model", ru: "Модель ценообразования", az: "Qiymət modeli" },
    subtitle: {
      en: "Build a revenue scenario with percentage adjustments, edit real prices, manage add-on sales.",
      ru: "Стройте сценарий дохода процентными корректировками, редактируйте цены, ведите допродажи.",
      az: "Faiz düzəlişləri ilə gəlir ssenarisi qurun, real qiymətləri redaktə edin, əlavə satışları idarə edin.",
    },
    content: {
      en: lazy(() => import("./pricing/en")),
      ru: lazy(() => import("./pricing/ru")),
      az: lazy(() => import("./pricing/az")),
    },
  },
  forecast: {
    title: { en: "Forecast", ru: "Прогноз", az: "Proqnoz" },
    subtitle: {
      en: "Project quarterly revenue: committed, best-case, and weighted pipeline at a glance.",
      ru: "Прогноз выручки на квартал: подтверждённое, лучший случай и взвешенная воронка.",
      az: "Rüblük gəlir proqnozu: təsdiqlənmiş, ən yaxşı hal və çəkili huni bir baxışda.",
    },
    content: {
      en: lazy(() => import("./forecast/en")),
      ru: lazy(() => import("./forecast/ru")),
      az: lazy(() => import("./forecast/az")),
    },
  },
  "forecast-snapshots": {
    title: { en: "Forecast Snapshots", ru: "Снимки прогноза", az: "Proqnoz anlıq görüntüləri" },
    subtitle: {
      en: "Freeze today's forecast as a snapshot, then measure accuracy when the period closes.",
      ru: "Зафиксируйте сегодняшний прогноз снимком и измерьте точность по закрытии периода.",
      az: "Bugünkü proqnozu anlıq görüntü kimi dondur, dövr bağlananda dəqiqliyi ölç.",
    },
    content: {
      en: lazy(() => import("./forecast-snapshots/en")),
      ru: lazy(() => import("./forecast-snapshots/ru")),
      az: lazy(() => import("./forecast-snapshots/az")),
    },
  },
  "forecast-waterfall": {
    title: { en: "Pipeline Waterfall", ru: "Воронка движений", az: "Satış boru xətti şəlaləsi" },
    subtitle: {
      en: "Read how your pipeline moved over the chosen period — bars per transition type, net delta, and a detailed table.",
      ru: "Читайте, как двигалась воронка за выбранный период — столбцы по типам перехода, чистое изменение и подробная таблица.",
      az: "Satış boru xəttinin seçilmiş dövrdə necə hərəkət etdiyini oxu — keçid tipləri üzrə sütunlar, xalis dəyişiklik və ətraflı cədvəl.",
    },
    content: {
      en: lazy(() => import("./forecast-waterfall/en")),
      ru: lazy(() => import("./forecast-waterfall/ru")),
      az: lazy(() => import("./forecast-waterfall/az")),
    },
  },
  "forecast-velocity": {
    title: { en: "Deal Velocity", ru: "Скорость сделок", az: "Sövdələşmə Sürəti" },
    subtitle: {
      en: "Read how long deals sit in each stage, spot p90-over-30-days bottlenecks, and see which stage slows your funnel most.",
      ru: "Узнайте, сколько сделки сидят на каждой стадии, найдите узкие места (p90 > 30 дней) и какая стадия тормозит воронку сильнее всего.",
      az: "Sövdələrin hər mərhələdə nə qədər ilişdiyini oxu, p90 > 30 gün darboğazları aşkar et və hansı mərhələnin hunini ən çox ləngitdiyini gör.",
    },
    content: {
      en: lazy(() => import("./forecast-velocity/en")),
      ru: lazy(() => import("./forecast-velocity/ru")),
      az: lazy(() => import("./forecast-velocity/az")),
    },
  },
  "ai-command-center": {
    title: {
      en: "AI Command Center (Da Vinci)",
      ru: "Центр управления Da Vinci",
      az: "Da Vinci İdarəetmə Mərkəzi",
    },
    subtitle: {
      en: "Monitor your AI agent's conversations, KPIs and traces on the Dashboard, then shape its behavior, escalation and guardrails in the Agent Constructor.",
      ru: "Следите за диалогами, KPI и трассировками ИИ-агента на Дашборде, затем настраивайте его поведение, эскалацию и ограничения в Конструкторе агента.",
      az: "Agentinizin söhbətlərini, KPI-larını və izləmələrini İdarə panelində izləyin, sonra onun davranışını, eskalasiyasını və məhdudiyyətlərini Agent Konstruktorunda formalaşdırın.",
    },
    content: {
      en: lazy(() => import("./ai-command-center/en")),
      ru: lazy(() => import("./ai-command-center/ru")),
      az: lazy(() => import("./ai-command-center/az")),
    },
  },
  "mtm-overview": {
    title: { en: "MTM Dashboard", ru: "Дашборд MTM", az: "MTM İdarə paneli" },
    subtitle: {
      en: "The Route & Field home screen — field KPIs at a glance and the entry point to the module.",
      ru: "Главный экран «Маршруты и поле» — полевые KPI с одного взгляда и точка входа в модуль.",
      az: "«Marşrutlar və saha» ana ekranı — saha KPI-ları bir baxışda və modula giriş nöqtəsi.",
    },
    content: {
      en: lazy(() => import("./mtm-overview/en")),
      ru: lazy(() => import("./mtm-overview/ru")),
      az: lazy(() => import("./mtm-overview/az")),
    },
  },
  "mtm-activity": {
    title: { en: "MTM Activity Journal", ru: "Журнал активности MTM", az: "MTM Fəaliyyət jurnalı" },
    subtitle: {
      en: "A live feed of field events — check-ins, visits, photos and actions across your team.",
      ru: "Живая лента полевых событий — чек-ины, визиты, фото и действия команды.",
      az: "Saha hadisələrinin canlı lenti — check-in-lər, ziyarətlər, fotolar və komandanın hərəkətləri.",
    },
    content: {
      en: lazy(() => import("./mtm-activity/en")),
      ru: lazy(() => import("./mtm-activity/ru")),
      az: lazy(() => import("./mtm-activity/az")),
    },
  },
  "mtm-leaderboard": {
    title: { en: "MTM Leaderboard", ru: "Рейтинг MTM", az: "MTM Reytinqi" },
    subtitle: {
      en: "Rank field agents by their field KPIs over a period.",
      ru: "Ранжируйте полевых агентов по их полевым KPI за период.",
      az: "Saha agentlərini dövr üzrə saha KPI-larına görə sıralayın.",
    },
    content: {
      en: lazy(() => import("./mtm-leaderboard/en")),
      ru: lazy(() => import("./mtm-leaderboard/ru")),
      az: lazy(() => import("./mtm-leaderboard/az")),
    },
  },
  "mtm-map": {
    title: { en: "MTM Live Map", ru: "Карта MTM", az: "MTM Canlı Xəritə" },
    subtitle: {
      en: "See agents and visited points live on the map with their status.",
      ru: "Смотрите агентов и посещённые точки на карте вживую с их статусом.",
      az: "Agentləri və ziyarət olunan nöqtələri statusu ilə xəritədə canlı görün.",
    },
    content: {
      en: lazy(() => import("./mtm-map/en")),
      ru: lazy(() => import("./mtm-map/ru")),
      az: lazy(() => import("./mtm-map/az")),
    },
  },
  "mtm-alerts": {
    title: { en: "MTM Alerts", ru: "Оповещения MTM", az: "MTM Bildirişləri" },
    subtitle: {
      en: "Review field alerts — GPS anomalies, late starts, missed visits and other route signals.",
      ru: "Просматривайте полевые оповещения — GPS-аномалии, поздние старты, пропущенные визиты и другие сигналы маршрутов.",
      az: "Saha bildirişlərini nəzərdən keçirin — GPS anomaliyaları, gec başlamalar, buraxılmış vizitlər və digər marşrut siqnalları.",
    },
    content: {
      en: lazy(() => import("./mtm-alerts/en")),
      ru: lazy(() => import("./mtm-alerts/ru")),
      az: lazy(() => import("./mtm-alerts/az")),
    },
  },
  "mtm-photos": {
    title: { en: "MTM Photos", ru: "Фото MTM", az: "MTM Fotolar" },
    subtitle: {
      en: "Browse visit photos captured in the field, filter and inspect them.",
      ru: "Просматривайте фото визитов с поля, фильтруйте и изучайте их.",
      az: "Sahədə çəkilmiş vizit fotolarını nəzərdən keçirin, filtrləyin və yoxlayın.",
    },
    content: {
      en: lazy(() => import("./mtm-photos/en")),
      ru: lazy(() => import("./mtm-photos/ru")),
      az: lazy(() => import("./mtm-photos/az")),
    },
  },
  "mtm-routes": {
    title: { en: "Routes", ru: "Маршруты", az: "Marşrutlar" },
    subtitle: {
      en: "Plan and track agent routes — daily routes, customer points, list/calendar views and the detail panel.",
      ru: "Планируйте и отслеживайте маршруты агентов — дневные маршруты, точки-клиенты, списки/календарь и панель деталей.",
      az: "Agent marşrutlarını planla və izlə — günlük marşrutlar, müştəri nöqtələri, siyahı/təqvim görünüşü və detal paneli.",
    },
    content: {
      en: lazy(() => import("./mtm-routes/en")),
      ru: lazy(() => import("./mtm-routes/ru")),
      az: lazy(() => import("./mtm-routes/az")),
    },
  },
  "mtm-promotions": {
    title: {
      en: "Pharmacy Promotions",
      ru: "Аптечные акции",
      az: "Aptek aksiyaları",
    },
    subtitle: {
      en: "Record pharmacy facts, review L1/L2 decisions and manage signed campaign rules without confusing previews with posted points.",
      ru: "Фиксируйте факты по аптекам, проверяйте решения L1/L2 и управляйте подписанными правилами кампаний, не путая расчёт с начисленными баллами.",
      az: "Aptek faktlarını qeyd edin, L1/L2 qərarlarını yoxlayın və hesablamanı yazılmış ballarla qarışdırmadan imzalanmış kampaniya qaydalarını idarə edin.",
    },
    content: {
      en: lazy(() => import("./mtm-promotions/en")),
      ru: lazy(() => import("./mtm-promotions/ru")),
      az: lazy(() => import("./mtm-promotions/az")),
    },
  },
  "mtm-tasks": {
    title: { en: "Field Tasks", ru: "Полевые задачи", az: "Sahə tapşırıqları" },
    subtitle: {
      en: "Assign tasks to field agents, track progress on a Kanban board, and close them by status.",
      ru: "Назначайте задачи полевым агентам, отслеживайте на доске Канбан и закрывайте по статусу.",
      az: "Sahə agentlərinə tapşırıq verin, gedişatı Kanban lövhəsində izləyin və status üzrə bağlayın.",
    },
    content: {
      en: lazy(() => import("./mtm-tasks/en")),
      ru: lazy(() => import("./mtm-tasks/ru")),
      az: lazy(() => import("./mtm-tasks/az")),
    },
  },
  "mtm-visits": {
    title: { en: "Visits", ru: "Визиты", az: "Ziyarətlər" },
    subtitle: {
      en: "The visit log — agent check-ins and check-outs at customer points.",
      ru: "Журнал визитов — чекины и чекауты агентов в точках-клиентах.",
      az: "Ziyarət jurnalı — agentlərin müştəri nöqtələrində giriş və çıxışları.",
    },
    content: {
      en: lazy(() => import("./mtm-visits/en")),
      ru: lazy(() => import("./mtm-visits/ru")),
      az: lazy(() => import("./mtm-visits/az")),
    },
  },
  "mtm-customers": {
    title: {
      en: "Field Customers",
      ru: "Точки",
      az: "Satış nöqtələri",
    },
    subtitle: {
      en: "The outlet directory the Route & Field module plans visits, routes and tasks against.",
      ru: "Справочник торговых точек, к которым модуль «Маршруты и поле» привязывает визиты, маршруты и задачи.",
      az: "«Marşrutlar və sahə» modulunun ziyarət, marşrut və tapşırığı bağladığı satış nöqtələri kataloqu.",
    },
    content: {
      en: lazy(() => import("./mtm-customers/en")),
      ru: lazy(() => import("./mtm-customers/ru")),
      az: lazy(() => import("./mtm-customers/az")),
    },
  },
  "mtm-agents": {
    title: {
      en: "Field Agents (MTM)",
      ru: "Полевые агенты (MTM)",
      az: "Sahə agentləri (MTM)",
    },
    subtitle: {
      en: "The roster of mobile field agents — roles, status, reporting line, and mobile-app login.",
      ru: "Реестр мобильных полевых агентов: роли, статус, линия подчинения и вход в мобильное приложение.",
      az: "Mobil sahə agentlərinin reyestri: rollar, status, tabeçilik xətti və mobil tətbiqə giriş.",
    },
    content: {
      en: lazy(() => import("./mtm-agents/en")),
      ru: lazy(() => import("./mtm-agents/ru")),
      az: lazy(() => import("./mtm-agents/az")),
    },
  },
  "mtm-analytics": {
    title: { en: "MTM Analytics", ru: "MTM Аналитика", az: "MTM Analitika" },
    subtitle: {
      en: "Field-force KPIs, Mars metrics, Trend and Weekly-Comparison charts, agent figures and Excel export.",
      ru: "KPI полевой команды, метрики Mars, графики Тренд и Сравнение по неделям, показатели агентов и экспорт в Excel.",
      az: "Sahə komandasının KPI-ları, Mars metrikaları, Trend və Həftəlik müqayisə qrafikləri, agent göstəriciləri və Excel ixracı.",
    },
    content: {
      en: lazy(() => import("./mtm-analytics/en")),
      ru: lazy(() => import("./mtm-analytics/ru")),
      az: lazy(() => import("./mtm-analytics/az")),
    },
  },
  "mtm-reports": {
    title: { en: "MTM Reports", ru: "Отчёты MTM", az: "MTM Hesabatlar" },
    subtitle: {
      en: "Review field activity by period: visits, agents, routes, GPS and photos.",
      ru: "Просмотр полевой активности по периодам: визиты, агенты, маршруты, GPS и фото.",
      az: "Sahə aktivliyini dövr üzrə nəzərdən keçirin: vizitlər, agentlər, marşrutlar, GPS və fotolar.",
    },
    content: {
      en: lazy(() => import("./mtm-reports/en")),
      ru: lazy(() => import("./mtm-reports/ru")),
      az: lazy(() => import("./mtm-reports/az")),
    },
  },
  "mtm-settings": {
    title: {
      en: "MTM Settings",
      ru: "Настройки MTM",
      az: "MTM Parametrləri",
    },
    subtitle: {
      en: "Tune your Route & Field team: GPS tracking, geofence, visit rules, working hours, alerts, Telegram bot, integrations, and reports — stored per organization.",
      ru: "Настройте команду «Маршруты и Поле»: GPS-трекинг, геозона, правила визитов, рабочие часы, оповещения, Telegram-бот, интеграции и отчёты — в рамках вашей организации.",
      az: "«Marşrut və Sahə» komandanızı tənzimləyin: GPS izləmə, geozona, ziyarət qaydaları, iş saatları, xəbərdarlıqlar, Telegram bot, inteqrasiyalar və hesabatlar — təşkilatınız daxilində.",
    },
    content: {
      en: lazy(() => import("./mtm-settings/en")),
      ru: lazy(() => import("./mtm-settings/ru")),
      az: lazy(() => import("./mtm-settings/az")),
    },
  },
  "health-providers": {
    title: { en: "Health — Providers", ru: "Здравоохранение — Поставщики", az: "Sağlamlıq — Təminatçılar" },
    subtitle: {
      en: "The provider roster — clinicians/facilities, their fields, search and lifecycle.",
      ru: "Реестр поставщиков — клиники/специалисты, их поля, поиск и жизненный цикл.",
      az: "Təminatçı reyestri — klinika/həkimlər, sahələri, axtarış və həyat dövrü.",
    },
    content: {
      en: lazy(() => import("./health-providers/en")),
      ru: lazy(() => import("./health-providers/ru")),
      az: lazy(() => import("./health-providers/az")),
    },
  },
  "health-care-plans": {
    title: { en: "Health — Care Plans", ru: "Здравоохранение — Планы ухода", az: "Sağlamlıq — Baxım planları" },
    subtitle: {
      en: "The care-plan roster tied to patient records — fields, lifecycle and search.",
      ru: "Реестр планов ухода, привязанных к карточкам пациентов — поля, жизненный цикл, поиск.",
      az: "Pasiyent qeydlərinə bağlı baxım planları reyestri — sahələr, həyat dövrü və axtarış.",
    },
    content: {
      en: lazy(() => import("./health-care-plans/en")),
      ru: lazy(() => import("./health-care-plans/ru")),
      az: lazy(() => import("./health-care-plans/az")),
    },
  },
  "health-encounters": {
    title: { en: "Health — Encounters", ru: "Здравоохранение — Приёмы", az: "Sağlamlıq — Qəbullar" },
    subtitle: {
      en: "The clinical-encounters roster on the patient record — fields, lifecycle, search.",
      ru: "Реестр клинических приёмов по карточке пациента — поля, жизненный цикл, поиск.",
      az: "Pasiyent qeydi üzrə klinik qəbullar reyestri — sahələr, həyat dövrü, axtarış.",
    },
    content: {
      en: lazy(() => import("./health-encounters/en")),
      ru: lazy(() => import("./health-encounters/ru")),
      az: lazy(() => import("./health-encounters/az")),
    },
  },
  "insurance-policies": {
    title: { en: "Insurance — Policies", ru: "Страхование — Полисы", az: "Sığorta — Polislər" },
    subtitle: {
      en: "The policy roster — coverage, status, search and the policy lifecycle.",
      ru: "Реестр полисов — покрытие, статус, поиск и жизненный цикл полиса.",
      az: "Polis reyestri — təminat, status, axtarış və polis həyat dövrü.",
    },
    content: {
      en: lazy(() => import("./insurance-policies/en")),
      ru: lazy(() => import("./insurance-policies/ru")),
      az: lazy(() => import("./insurance-policies/az")),
    },
  },
  "insurance-claims": {
    title: { en: "Insurance — Claims", ru: "Страхование — Убытки", az: "Sığorta — Tələblər" },
    subtitle: {
      en: "The claims filed against policies — status, amounts, search and lifecycle.",
      ru: "Убытки, заявленные по полисам — статус, суммы, поиск и жизненный цикл.",
      az: "Polislərə qarşı bildirilən tələblər — status, məbləğlər, axtarış və həyat dövrü.",
    },
    content: {
      en: lazy(() => import("./insurance-claims/en")),
      ru: lazy(() => import("./insurance-claims/ru")),
      az: lazy(() => import("./insurance-claims/az")),
    },
  },
  "insurance-beneficiaries": {
    title: { en: "Insurance — Beneficiaries", ru: "Страхование — Выгодоприобретатели", az: "Sığorta — Vərəsələr" },
    subtitle: {
      en: "Who gets paid — the beneficiary roster against policies, fields and search.",
      ru: "Кому выплачивается — реестр выгодоприобретателей по полисам, поля и поиск.",
      az: "Ödəniş kimə gedir — polislər üzrə vərəsə reyestri, sahələr və axtarış.",
    },
    content: {
      en: lazy(() => import("./insurance-beneficiaries/en")),
      ru: lazy(() => import("./insurance-beneficiaries/ru")),
      az: lazy(() => import("./insurance-beneficiaries/az")),
    },
  },
  "media-content": {
    title: { en: "Content Inventory", ru: "Инвентарь контента", az: "Kontent İnventarı" },
    subtitle: {
      en: "The single catalog of all media items — search, status filter and table (read-only).",
      ru: "Единый каталог всех медиаматериалов — поиск, фильтр статуса и таблица (только для чтения).",
      az: "Bütün media materiallarının vahid kataloqu — axtarış, status filtri və cədvəl (yalnız oxunaqlı).",
    },
    content: {
      en: lazy(() => import("./media-content/en")),
      ru: lazy(() => import("./media-content/ru")),
      az: lazy(() => import("./media-content/az")),
    },
  },
  "media-ad-campaigns": {
    title: { en: "Ad Campaigns", ru: "Рекламные кампании", az: "Reklam Kampaniyaları" },
    subtitle: {
      en: "The Media ad-campaigns list — stat cards, search/status filter, the campaign table, load more.",
      ru: "Список рекламных кампаний Media — карточки, поиск/фильтр статуса, таблица кампаний, загрузка ещё.",
      az: "Media reklam kampaniyaları siyahısı — statistika kartları, axtarış/status filtri, cədvəl, daha çox yüklə.",
    },
    content: {
      en: lazy(() => import("./media-ad-campaigns/en")),
      ru: lazy(() => import("./media-ad-campaigns/ru")),
      az: lazy(() => import("./media-ad-campaigns/az")),
    },
  },
  "public-sector-cases": {
    title: { en: "Cases (Public Sector)", ru: "Дела (Госсектор)", az: "İşlər (Dövlət sektoru)" },
    subtitle: {
      en: "The case register — benefit/complaint/appeal cases by status, priority and due date (read-only).",
      ru: "Реестр дел — льготы/жалобы/апелляции по статусу, приоритету и сроку (только просмотр).",
      az: "İş reyestri — müavinət/şikayət/apellyasiya işləri status, prioritet və son tarixə görə (yalnız baxış).",
    },
    content: {
      en: lazy(() => import("./public-sector-cases/en")),
      ru: lazy(() => import("./public-sector-cases/ru")),
      az: lazy(() => import("./public-sector-cases/az")),
    },
  },
  "public-sector-grants": {
    title: { en: "Grants register", ru: "Реестр грантов", az: "Qrantlar reyestri" },
    subtitle: {
      en: "Browse grant applications, filter by status, find a grant number — read-only.",
      ru: "Просмотр заявок на гранты, фильтр по статусу, поиск номера гранта — только просмотр.",
      az: "Qrant müraciətlərinə bax, statusa görə süz və qrant nömrəsini tap — yalnız oxumaq.",
    },
    content: {
      en: lazy(() => import("./public-sector-grants/en")),
      ru: lazy(() => import("./public-sector-grants/ru")),
      az: lazy(() => import("./public-sector-grants/az")),
    },
  },
  "public-sector-licenses": {
    title: { en: "Licenses", ru: "Лицензии", az: "Lisenziyalar" },
    subtitle: {
      en: "Read the licensing register, filter by status, search by number (read-only).",
      ru: "Читайте реестр лицензий, фильтруйте по статусу, ищите по номеру (только просмотр).",
      az: "Lisenziya reyestrini oxuyun, statusa görə süz və nömrə ilə axtar (yalnız oxumaq).",
    },
    content: {
      en: lazy(() => import("./public-sector-licenses/en")),
      ru: lazy(() => import("./public-sector-licenses/ru")),
      az: lazy(() => import("./public-sector-licenses/az")),
    },
  },
  notifications: {
    title: { en: "Notifications", ru: "Уведомления", az: "Bildirişlər" },
    subtitle: {
      en: "Read, filter and clear system alerts in one place.",
      ru: "Читайте, фильтруйте и разбирайте системные оповещения в одном месте.",
      az: "Sistem xəbərdarlıqlarını oxuyun, filtrləyin və oxunmuş işarələyin.",
    },
    content: {
      en: lazy(() => import("./notifications/en")),
      ru: lazy(() => import("./notifications/ru")),
      az: lazy(() => import("./notifications/az")),
    },
  },
  "settings-dashboard": {
    title: { en: "Dashboard Widgets", ru: "Блоки дашборда", az: "Dashboard Blokları" },
    subtitle: {
      en: "Toggle which widgets appear on the home dashboard — changes are saved automatically.",
      ru: "Включайте/выключайте блоки на главном дашборде — изменения сохраняются автоматически.",
      az: "Ana səhifədə hansı blokların görünəcəyini söndürün/yandırın — dəyişikliklər avtomatik saxlanılır.",
    },
    content: {
      en: lazy(() => import("./settings-dashboard/en")),
      ru: lazy(() => import("./settings-dashboard/ru")),
      az: lazy(() => import("./settings-dashboard/az")),
    },
  },
  "workflow-templates": {
    title: { en: "Workflow Templates", ru: "Шаблоны автоматизаций", az: "Avtomatlaşdırma şablonları" },
    subtitle: {
      en: "Start from a ready-made automation and customize it later.",
      ru: "Начните с готового сценария и настройте под себя.",
      az: "Hazır ssenaridən başlayın və sonra fərdiləşdirin.",
    },
    content: {
      en: lazy(() => import("./workflow-templates/en")),
      ru: lazy(() => import("./workflow-templates/ru")),
      az: lazy(() => import("./workflow-templates/az")),
    },
  },
  "api-keys": {
    title: { en: "API Keys", ru: "API Ключи", az: "API Açarları" },
    subtitle: {
      en: "Create a key, grant scopes, copy the raw key once, and revoke it when needed — admins only.",
      ru: "Создайте ключ, выдайте scope-ы, скопируйте сырой ключ один раз и отзовите при необходимости — только админы.",
      az: "Açar yaradın, scope verin, xam açarı bir dəfə kopyalayın və lazım olanda ləğv edin — yalnız adminlər.",
    },
    content: {
      en: lazy(() => import("./api-keys/en")),
      ru: lazy(() => import("./api-keys/ru")),
      az: lazy(() => import("./api-keys/az")),
    },
  },
  "energy-metering": {
    title: { en: "Energy — Metering", ru: "Энергетика — Учёт", az: "Enerji — Uçot" },
    subtitle: {
      en: "The meter register — metering points per account, readings, search and lifecycle.",
      ru: "Реестр счётчиков — точки учёта по лицевому счёту, показания, поиск и жизненный цикл.",
      az: "Sayğac reyestri — hesab üzrə uçot nöqtələri, göstərişlər, axtarış və həyat dövrü.",
    },
    content: {
      en: lazy(() => import("./energy-metering/en")),
      ru: lazy(() => import("./energy-metering/ru")),
      az: lazy(() => import("./energy-metering/az")),
    },
  },
  "energy-outages": {
    title: { en: "Energy — Outages", ru: "Энергетика — Отключения", az: "Enerji — Kəsintilər" },
    subtitle: {
      en: "Grid and supply outages — status, affected points, search and lifecycle.",
      ru: "Сетевые и поставочные отключения — статус, затронутые точки, поиск и жизненный цикл.",
      az: "Şəbəkə və təchizat kəsintiləri — status, təsirlənən nöqtələr, axtarış və həyat dövrü.",
    },
    content: {
      en: lazy(() => import("./energy-outages/en")),
      ru: lazy(() => import("./energy-outages/ru")),
      az: lazy(() => import("./energy-outages/az")),
    },
  },
  "energy-service-calls": {
    title: { en: "Energy — Service Calls", ru: "Энергетика — Сервисные заявки", az: "Enerji — Servis çağırışları" },
    subtitle: {
      en: "Field-dispatch service calls — status, assignment, search and lifecycle.",
      ru: "Выездные сервисные заявки — статус, назначение, поиск и жизненный цикл.",
      az: "Sahə servis çağırışları — status, təyinat, axtarış və həyat dövrü.",
    },
    content: {
      en: lazy(() => import("./energy-service-calls/en")),
      ru: lazy(() => import("./energy-service-calls/ru")),
      az: lazy(() => import("./energy-service-calls/az")),
    },
  },
  "settings-overview": {
    title: {
      en: "Settings",
      ru: "Настройки",
      az: "Tənzimləmələr",
    },
    subtitle: {
      en: "Your launcher into every configuration area — and the Dashboard Settings card that shows or hides home-screen widgets for the whole organization.",
      ru: "Запускатель во все разделы настройки — и карточка «Настройки дашборда», которая показывает или скрывает виджеты главного экрана для всей организации.",
      az: "Bütün konfiqurasiya sahələrinə başlanğıc nöqtəniz — və əsas ekran vidjetlərini bütün təşkilat üçün göstərən və ya gizlədən «Dashboard Tənzimləmələri» kartı.",
    },
    content: {
      en: lazy(() => import("./settings-overview/en")),
      ru: lazy(() => import("./settings-overview/ru")),
      az: lazy(() => import("./settings-overview/az")),
    },
  },
  pipelines: {
    title: {
      en: "Pipelines & Stages",
      ru: "Воронки и стадии",
      az: "Huni və Mərhələlər",
    },
    subtitle: {
      en: "Build sales pipelines, order and configure their stages, and gate stage transitions with validation rules.",
      ru: "Создавайте воронки продаж, упорядочивайте и настраивайте их стадии и ограничивайте переходы правилами валидации.",
      az: "Satış hunilərini qurun, mərhələlərini sıralayıb konfiqurasiya edin və mərhələ keçidlərini doğrulama qaydaları ilə məhdudlaşdırın.",
    },
    content: {
      en: lazy(() => import("./pipelines/en")),
      ru: lazy(() => import("./pipelines/ru")),
      az: lazy(() => import("./pipelines/az")),
    },
  },
  "settings-workflows": {
    title: {
      en: "Workflows & Templates",
      ru: "Сценарии и шаблоны",
      az: "İş axınları və şablonlar",
    },
    subtitle: {
      en: "No-code automation: build when-then rules from scratch, or apply a ready-made template in one click.",
      ru: "Автоматизация без кода: собирайте правила «когда — тогда» с нуля или применяйте готовый шаблон в один клик.",
      az: "Kodsuz avtomatlaşdırma: «nə vaxt — onda» qaydalarını sıfırdan qurun və ya hazır şablonu bir kliklə tətbiq edin.",
    },
    content: {
      en: lazy(() => import("./settings-workflows/en")),
      ru: lazy(() => import("./settings-workflows/ru")),
      az: lazy(() => import("./settings-workflows/az")),
    },
  },
  "task-templates": {
    title: {
      en: "Task Templates",
      ru: "Шаблоны задач",
      az: "Tapşırıq şablonları",
    },
    subtitle: {
      en: "A reusable library under Settings that pre-fills the New Task form — title, priority, due offset, custom fields, and a checklist, with variables and team sharing.",
      ru: "Библиотека переиспользуемых заготовок в Настройках, которая предзаполняет форму новой задачи — заголовок, приоритет, смещение срока, кастомные поля и чек-лист, с переменными и общим доступом для команды.",
      az: "Tənzimləmələrdə yeni tapşırıq formasını əvvəlcədən dolduran təkrar istifadəli kitabxana — başlıq, prioritet, son tarix sürüşməsi, fərdi sahələr və yoxlama siyahısı, dəyişənlər və komanda paylaşımı ilə.",
    },
    content: {
      en: lazy(() => import("./task-templates/en")),
      ru: lazy(() => import("./task-templates/ru")),
      az: lazy(() => import("./task-templates/az")),
    },
  },
  users: {
    title: { en: "Users", ru: "Пользователи", az: "İstifadəçilər" },
    subtitle: {
      en: "Create accounts, assign roles and departments, set phone and 2FA, manage status.",
      ru: "Создавайте аккаунты, назначайте роли и отделы, настраивайте телефон и 2FA, ведите статус.",
      az: "Hesab yaradın, rol və şöbə təyin edin, telefon və 2FA tənzimləyin, statusu idarə edin.",
    },
    content: {
      en: lazy(() => import("./users/en")),
      ru: lazy(() => import("./users/ru")),
      az: lazy(() => import("./users/az")),
    },
  },
  "field-permissions": {
    title: { en: "Field Permissions", ru: "Разрешения полей", az: "Sahə icazələri" },
    subtitle: {
      en: "Per-role field matrix (Edit / View / Hidden) and record-sharing rules across roles.",
      ru: "Матрица полей по ролям (Редактирование / Просмотр / Скрыто) и правила доступа между ролями.",
      az: "Rol üzrə sahə matrisi (Redaktə / Görünür / Gizli) və rollar arası qeyd paylaşma qaydaları.",
    },
    content: {
      en: lazy(() => import("./field-permissions/en")),
      ru: lazy(() => import("./field-permissions/ru")),
      az: lazy(() => import("./field-permissions/az")),
    },
  },
  roles: {
    title: { en: "Roles & Permissions", ru: "Роли и разрешения", az: "Rollar və icazələr" },
    subtitle: {
      en: "Manage system and custom roles; set each role's module access in the permission matrix.",
      ru: "Управляйте системными и пользовательскими ролями; задавайте доступ к модулям в матрице.",
      az: "Sistem və özəl rolları idarə edin; hər rolun modul girişini matrisdə təyin edin.",
    },
    content: {
      en: lazy(() => import("./roles/en")),
      ru: lazy(() => import("./roles/ru")),
      az: lazy(() => import("./roles/az")),
    },
  },
  "org-settings": {
    title: { en: "Organization Settings", ru: "Настройки организации", az: "Təşkilat parametrləri" },
    subtitle: {
      en: "Update the company name and logo, and view your plan and limits.",
      ru: "Обновите название и логотип компании, посмотрите тариф и лимиты.",
      az: "Şirkət adını və loqonu yeniləyin, tarif planını və limitləri görün.",
    },
    content: {
      en: lazy(() => import("./org-settings/en")),
      ru: lazy(() => import("./org-settings/ru")),
      az: lazy(() => import("./org-settings/az")),
    },
  },
  "security-settings": {
    title: { en: "Security settings", ru: "Настройки безопасности", az: "Təhlükəsizlik parametrləri" },
    subtitle: {
      en: "2FA (authenticator and SMS), login methods, linked accounts, and API keys.",
      ru: "2FA (authenticator и SMS), способы входа, привязанные аккаунты и API-ключи.",
      az: "2FA (authenticator və SMS), giriş üsulları, bağlı hesablar və API açarları.",
    },
    content: {
      en: lazy(() => import("./security-settings/en")),
      ru: lazy(() => import("./security-settings/ru")),
      az: lazy(() => import("./security-settings/az")),
    },
  },
  "audit-log": {
    title: { en: "Audit Log", ru: "Журнал аудита", az: "Audit Jurnalı" },
    subtitle: {
      en: "Browse, search and sort the read-only activity table.",
      ru: "Просмотр, поиск и сортировка журнала активности (только для чтения).",
      az: "Yalnız-oxunan fəaliyyət cədvəlinə baxış, axtarış və sıralama.",
    },
    content: {
      en: lazy(() => import("./audit-log/en")),
      ru: lazy(() => import("./audit-log/ru")),
      az: lazy(() => import("./audit-log/az")),
    },
  },
  "portal-users": {
    title: { en: "Portal Users", ru: "Пользователи портала", az: "Portal İstifadəçiləri" },
    subtitle: {
      en: "Manage client-portal access: enable/disable sign-in, reset passwords, clear chat, remove contacts.",
      ru: "Управляйте доступом к клиентскому порталу: вход, сброс паролей, очистка чата, удаление контактов.",
      az: "Müştəri portalına girişi idarə edin: girişi aç/bağla, şifrə sıfırla, söhbəti təmizlə, kontakt çıxar.",
    },
    content: {
      en: lazy(() => import("./portal-users/en")),
      ru: lazy(() => import("./portal-users/ru")),
      az: lazy(() => import("./portal-users/az")),
    },
  },
  smtp: {
    title: {
      en: "SMTP Settings (managed email, presets, own server, test)",
      ru: "Настройки SMTP (управляемая почта, пресеты, свой сервер, тест)",
      az: "SMTP parametrləri (idarə olunan e-poçt, hazır şablonlar, öz server, test)",
    },
    subtitle: {
      en: "LeadDrive sends email for you by default — connect your own SMTP server only if From must read as your domain, then send a test to verify.",
      ru: "LeadDrive отправляет почту за вас по умолчанию — подключайте свой SMTP-сервер, только если From должен выглядеть как ваш домен, затем проверьте тестовым письмом.",
      az: "LeadDrive e-poçtu standart olaraq sizin üçün göndərir — öz SMTP serverinizi yalnız From sizin domen kimi görünməli olduqda qoşun, sonra test məktubu ilə yoxlayın.",
    },
    content: {
      en: lazy(() => import("./smtp/en")),
      ru: lazy(() => import("./smtp/ru")),
      az: lazy(() => import("./smtp/az")),
    },
  },
  "custom-fields": {
    title: { en: "Custom Fields", ru: "Пользовательские поля", az: "Xüsusi sahələr" },
    subtitle: {
      en: "Create, edit and delete your own fields on CRM objects (Contact, Deal, Lead, Company).",
      ru: "Создавайте, редактируйте и удаляйте свои поля на объектах CRM (Контакт, Сделка, Лид, Компания).",
      az: "CRM obyektlərinə (Kontakt, Sövdə, Lid, Şirkət) öz sahələrinizi yaradın, redaktə edin və silin.",
    },
    content: {
      en: lazy(() => import("./custom-fields/en")),
      ru: lazy(() => import("./custom-fields/ru")),
      az: lazy(() => import("./custom-fields/az")),
    },
  },
  "lead-rules": {
    title: { en: "Lead Assignment Rules", ru: "Правила назначения лидов", az: "Lid təyinat qaydaları" },
    subtitle: {
      en: "Route leads to team members automatically by conditions or round-robin.",
      ru: "Направляйте лиды сотрудникам автоматически по условиям или по очереди.",
      az: "Lidləri şərtlərə və ya növbəyə (round-robin) görə avtomatik komanda üzvlərinə yönləndirin.",
    },
    content: {
      en: lazy(() => import("./lead-rules/en")),
      ru: lazy(() => import("./lead-rules/ru")),
      az: lazy(() => import("./lead-rules/az")),
    },
  },
  "message-snippets": {
    title: { en: "Message Snippets", ru: "Сниппеты сообщений", az: "Mesaj snippetləri" },
    subtitle: {
      en: "Create saved inbox replies that agents insert with a /shortcut.",
      ru: "Создавайте готовые ответы для инбокса, которые агенты вставляют через /ярлык.",
      az: "Agentlərin inbox-da /qısayol ilə daxil etdiyi hazır cavabları yaradın.",
    },
    content: {
      en: lazy(() => import("./message-snippets/en")),
      ru: lazy(() => import("./message-snippets/ru")),
      az: lazy(() => import("./message-snippets/az")),
    },
  },
  "web-to-lead": {
    title: { en: "Web-to-Lead", ru: "Web-to-Lead", az: "Web-to-Lead" },
    subtitle: {
      en: "Generate and embed a lead-capture form for your website.",
      ru: "Сгенерируйте и встройте форму захвата лидов для вашего сайта.",
      az: "Saytınız üçün lid toplama forması kodu yaradın və yerləşdirin.",
    },
    content: {
      en: lazy(() => import("./web-to-lead/en")),
      ru: lazy(() => import("./web-to-lead/ru")),
      az: lazy(() => import("./web-to-lead/az")),
    },
  },
  "intake-forms": {
    title: { en: "Contract Intake Forms", ru: "Формы запроса контрактов", az: "Müqavilə sorğu formaları" },
    subtitle: {
      en: "Build intake forms with questions, contract-field mapping, and default approval stages.",
      ru: "Создавайте формы запроса с вопросами, привязкой к полям контракта и этапами согласования.",
      az: "Suallar, müqavilə sahəsinə bağlama və standart təsdiq mərhələləri olan sorğu formaları qurun.",
    },
    content: {
      en: lazy(() => import("./intake-forms/en")),
      ru: lazy(() => import("./intake-forms/ru")),
      az: lazy(() => import("./intake-forms/az")),
    },
  },
  forms: {
    title: { en: "Forms", ru: "Формы", az: "Formalar" },
    subtitle: {
      en: "Create standalone forms with a public URL, track status and stats, and share them.",
      ru: "Создавайте самостоятельные формы с публичным URL, отслеживайте статус и статистику.",
      az: "Açıq URL-li müstəqil formalar yaradın, statusunu və statistikasını izləyin və paylaşın.",
    },
    content: {
      en: lazy(() => import("./forms/en")),
      ru: lazy(() => import("./forms/ru")),
      az: lazy(() => import("./forms/az")),
    },
  },
  offers: {
    title: { en: "Offers", ru: "Предложения", az: "Təkliflər" },
    subtitle: {
      en: "Build a commercial offer, compute line items/currency/VAT/discount, and track it by status.",
      ru: "Соберите коммерческое предложение, посчитайте позиции/валюту/НДС/скидку и отслеживайте по статусу.",
      az: "Kommersiya təklifi yaradın, mövqe/valyuta/ƏDV/endirimi hesablayın və statusa görə izləyin.",
    },
    content: {
      en: lazy(() => import("./offers/en")),
      ru: lazy(() => import("./offers/ru")),
      az: lazy(() => import("./offers/az")),
    },
  },
  billing: {
    title: { en: "Billing", ru: "Биллинг", az: "Hesablaşma" },
    subtitle: {
      en: "The landing page for plans, invoices and payment methods.",
      ru: "Точка входа для тарифов, счетов и методов оплаты.",
      az: "Tariflər, fakturalar və ödəniş üsulları üçün giriş səhifəsi.",
    },
    content: {
      en: lazy(() => import("./billing/en")),
      ru: lazy(() => import("./billing/ru")),
      az: lazy(() => import("./billing/az")),
    },
  },
  "invoice-settings": {
    title: { en: "Invoice Settings", ru: "Настройки счетов", az: "Hesab-faktura parametrləri" },
    subtitle: {
      en: "Set company details, invoice defaults, bank info, signature/stamp and email templates.",
      ru: "Реквизиты компании, значения счёта по умолчанию, банк, подпись/печать и шаблоны писем.",
      az: "Şirkət rekvizitləri, faktura defoltları, bank, imza/möhür və e-poçt şablonları.",
    },
    content: {
      en: lazy(() => import("./invoice-settings/en")),
      ru: lazy(() => import("./invoice-settings/ru")),
      az: lazy(() => import("./invoice-settings/az")),
    },
  },
  "finance-notifications": {
    title: { en: "Payment Notifications", ru: "Уведомления об оплатах", az: "Ödəniş Bildirişləri" },
    subtitle: {
      en: "Configure when/where financial alerts go — overdue, advance warning, payment orders, bills.",
      ru: "Настройте когда/куда идут финуведомления — просрочка, предупреждение, поручения, счета.",
      az: "Maliyyə bildirişlərinin vaxtını/kanalını qurun — gecikmə, xəbərdarlıq, ödəniş tapşırıqları.",
    },
    content: {
      en: lazy(() => import("./finance-notifications/en")),
      ru: lazy(() => import("./finance-notifications/ru")),
      az: lazy(() => import("./finance-notifications/az")),
    },
  },
  "approval-rules": {
    title: { en: "Approval Routing Rules", ru: "Правила маршрутизации согласований", az: "Təsdiq Marşrutu Qaydaları" },
    subtitle: {
      en: "Rules that conditionally add or skip approval-chain stages by contract attributes.",
      ru: "Правила, условно добавляющие или пропускающие этапы согласования по атрибутам договора.",
      az: "Müqavilə atributlarına görə təsdiq mərhələsini şərti əlavə edən/atlayan qaydalar.",
    },
    content: {
      en: lazy(() => import("./approval-rules/en")),
      ru: lazy(() => import("./approval-rules/ru")),
      az: lazy(() => import("./approval-rules/az")),
    },
  },
  "approval-delegates": {
    title: { en: "Approval Delegation", ru: "Делегирование согласований", az: "Təsdiqlə Nümayəndəlik" },
    subtitle: {
      en: "Route your contract approvals to a trusted colleague while out of office.",
      ru: "Перенаправьте согласования договоров доверенному коллеге на время отсутствия.",
      az: "İşdə olmadıqda müqavilə təsdiqlərini etibarlı həmkara yönləndirin.",
    },
    content: {
      en: lazy(() => import("./approval-delegates/en")),
      ru: lazy(() => import("./approval-delegates/ru")),
      az: lazy(() => import("./approval-delegates/az")),
    },
  },
  "sla-policies": {
    title: { en: "SLA Policies", ru: "SLA Политики", az: "SLA Siyasətləri" },
    subtitle: {
      en: "Set response and resolution time targets for tickets, split by priority.",
      ru: "Задайте целевые сроки ответа и решения для тикетов, разделив по приоритету.",
      az: "Biletlər üçün cavab və həll müddəti hədəfləri qurun, prioritetə görə bölün.",
    },
    content: {
      en: lazy(() => import("./sla-policies/en")),
      ru: lazy(() => import("./sla-policies/ru")),
      az: lazy(() => import("./sla-policies/az")),
    },
  },
  channels: {
    title: { en: "Channels", ru: "Каналы", az: "Kanallar" },
    subtitle: {
      en: "Connect messaging channels: Email, Telegram, WhatsApp Business messages, SMS, social. Regular phone providers live in VoIP; WhatsApp Business Calling is prepared from the Channels checklist and uses the WhatsApp API credentials.",
      ru: "Подключайте каналы сообщений: Email, Telegram, WhatsApp Business сообщения, SMS, соцсети. Обычные телефонные провайдеры живут в VoIP; WhatsApp Business Calling готовится через чеклист в Каналах и использует WhatsApp API credentials.",
      az: "Mesaj kanallarını qoşun: E-poçt, Telegram, WhatsApp Business mesajları, SMS, sosial. Adi telefon provayderləri VoIP-dədir; WhatsApp Business Calling Kanallardakı checklist ilə hazırlanır və WhatsApp API credentials istifadə edir.",
    },
    content: {
      en: lazy(() => import("./channels/en")),
      ru: lazy(() => import("./channels/ru")),
      az: lazy(() => import("./channels/az")),
    },
  },
  "web-chat-settings": {
    title: { en: "Web Chat Widget", ru: "Веб-чат виджет", az: "Veb Çat Vidceti" },
    subtitle: {
      en: "Enable the widget, copy the embed snippet, and tune appearance, behavior, hours, origins.",
      ru: "Включите виджет, скопируйте код встраивания и настройте вид, поведение, часы, домены.",
      az: "Vidceti aktivləşdirin, əlavə kodunu kopyalayın, görünüş, davranış, saatlar və mənbələri tənzimləyin.",
    },
    content: {
      en: lazy(() => import("./web-chat-settings/en")),
      ru: lazy(() => import("./web-chat-settings/ru")),
      az: lazy(() => import("./web-chat-settings/az")),
    },
  },
  "notification-settings": {
    title: { en: "Notification Preferences", ru: "Настройки уведомлений", az: "Bildiriş tənzimləmələri" },
    subtitle: {
      en: "Turn browser/in-app popups on or off per module and tune individual notification kinds.",
      ru: "Включайте/выключайте всплывающие уведомления по модулю и настраивайте отдельные типы.",
      az: "Modullar üzrə brauzer/tətbiq bildirişlərini aç/söndür və ayrı-ayrı növləri tənzimlə.",
    },
    content: {
      en: lazy(() => import("./notification-settings/en")),
      ru: lazy(() => import("./notification-settings/ru")),
      az: lazy(() => import("./notification-settings/az")),
    },
  },
  "custom-domains": {
    title: { en: "Custom Domains", ru: "Пользовательские домены", az: "Xüsusi Domenlər" },
    subtitle: {
      en: "Connect a domain, set the CNAME, verify DNS — so landing pages run on your branded domain.",
      ru: "Подключите домен, настройте CNAME, проверьте DNS — чтобы лендинги работали на вашем домене.",
      az: "Domen qoşun, CNAME qurun, DNS-i yoxlayın — açılış səhifələri öz brendli domeninizdə işləsin.",
    },
    content: {
      en: lazy(() => import("./custom-domains/en")),
      ru: lazy(() => import("./custom-domains/ru")),
      az: lazy(() => import("./custom-domains/az")),
    },
  },
  "email-settings-templates": {
    title: { en: "Email Templates", ru: "Email-шаблоны", az: "Email şablonları" },
    subtitle: {
      en: "Create and manage reusable email templates personalized with variables.",
      ru: "Создавайте и ведите многоразовые email-шаблоны с переменными.",
      az: "Dəyişənlərlə fərdiləşən təkrar istifadəli email şablonları yaradın və idarə edin.",
    },
    content: {
      en: lazy(() => import("./email-settings-templates/en")),
      ru: lazy(() => import("./email-settings-templates/ru")),
      az: lazy(() => import("./email-settings-templates/az")),
    },
  },
  escalation: {
    title: { en: "Escalation Rules", ru: "Правила эскалации", az: "Eskalasiya Qaydaları" },
    subtitle: {
      en: "Rules that auto-escalate tickets when SLA deadlines are breached.",
      ru: "Правила автоэскалации тикетов при нарушении сроков SLA.",
      az: "SLA müddətləri pozulduqda tiketləri avtomatik eskalə edən qaydalar.",
    },
    content: {
      en: lazy(() => import("./escalation/en")),
      ru: lazy(() => import("./escalation/ru")),
      az: lazy(() => import("./escalation/az")),
    },
  },
  "sales-forecast-settings": {
    title: { en: "Sales Forecast (Settings)", ru: "Прогноз продаж (Настройки)", az: "Satış Proqnozu (Tənzimləmələr)" },
    subtitle: {
      en: "Enter the monthly forecast per revenue service across a year, view with/without VAT, Excel.",
      ru: "Внесите помесячный прогноз по доходному сервису на год, смотрите с НДС и без, Excel.",
      az: "Hər gəlirli xidmət üzrə il boyu aylıq proqnozu daxil edin, ƏDV ilə/ƏDV-siz görün, Excel.",
    },
    content: {
      en: lazy(() => import("./sales-forecast-settings/en")),
      ru: lazy(() => import("./sales-forecast-settings/ru")),
      az: lazy(() => import("./sales-forecast-settings/az")),
    },
  },
  "settings-leaderboard": {
    title: { en: "KPI Arena Configuration", ru: "Настройка KPI Arena", az: "KPI Arena tənzimləməsi" },
    subtitle: {
      en: "Tune MTM weights and status thresholds with a live preview.",
      ru: "Настройте веса MTM и пороги статусов с живым просмотром.",
      az: "MTM çəkilərini və status həddlərini canlı önizləmə ilə tənzimləyin.",
    },
    content: {
      en: lazy(() => import("./settings-leaderboard/en")),
      ru: lazy(() => import("./settings-leaderboard/ru")),
      az: lazy(() => import("./settings-leaderboard/az")),
    },
  },
  boards: {
    title: { en: "Boards", ru: "Доски", az: "Lövhələr" },
    subtitle: {
      en: "Split team work into Kanban boards and manage access and columns.",
      ru: "Разбейте работу на канбан-доски и управляйте доступом и колонками.",
      az: "Komanda işini Kanban lövhələrinə bölün, giriş və sütunları idarə edin.",
    },
    content: {
      en: lazy(() => import("./boards/en")),
      ru: lazy(() => import("./boards/ru")),
      az: lazy(() => import("./boards/az")),
    },
  },
  cobrowse: {
    title: { en: "Cobrowse", ru: "Cobrowse", az: "Cobrowse" },
    subtitle: {
      en: "Create a session, send a join link, and watch the customer's screen live — Pause/Resume/End.",
      ru: "Создайте сессию, отправьте ссылку и смотрите экран клиента вживую — Pause/Resume/End.",
      az: "Sessiya yaradın, qoşulma linki göndərin və müştərinin ekranını canlı izləyin — Pause/Resume/End.",
    },
    content: {
      en: lazy(() => import("./cobrowse/en")),
      ru: lazy(() => import("./cobrowse/ru")),
      az: lazy(() => import("./cobrowse/az")),
    },
  },
  "lead-scoring": {
    title: { en: "Lead Scoring (Da Vinci)", ru: "Скоринг лидов (Da Vinci)", az: "Lid qiymətləndirmə (Da Vinci)" },
    subtitle: {
      en: "Score leads by points and A–F grade, find the hottest ones, and act from the list.",
      ru: "Оценивайте лидов по баллам и грейду A–F, находите горячих и действуйте из списка.",
      az: "Lidləri bal və A–F dərəcəsi üzrə qiymətləndirin, ən qaynarları tapın və siyahıdan hərəkət edin.",
    },
    content: {
      en: lazy(() => import("./lead-scoring/en")),
      ru: lazy(() => import("./lead-scoring/ru")),
      az: lazy(() => import("./lead-scoring/az")),
    },
  },
  leaderboard: {
    title: { en: "KPI Arena", ru: "KPI-арена", az: "KPI Arena" },
    subtitle: {
      en: "Live bubble leaderboard — department tabs, period, Bubbles/List views and the agent KPI drawer.",
      ru: "Живой рейтинг-пузыри — вкладки отделов, период, виды Пузыри/Список и панель KPI агента.",
      az: "Canlı qabarcıq reytinqi — şöbə tabları, dövr, Qabarcıqlar/Siyahı görünüşü və agent KPI paneli.",
    },
    content: {
      en: lazy(() => import("./leaderboard/en")),
      ru: lazy(() => import("./leaderboard/ru")),
      az: lazy(() => import("./leaderboard/az")),
    },
  },
  marketplace: {
    title: { en: "App Marketplace", ru: "Магазин приложений", az: "Tətbiq Mağazası" },
    subtitle: {
      en: "Install, disable, or uninstall apps from the catalog.",
      ru: "Устанавливайте, отключайте или удаляйте приложения из каталога.",
      az: "Kataloqdan tətbiqlər quraşdırın, söndürün və ya silin.",
    },
    content: {
      en: lazy(() => import("./marketplace/en")),
      ru: lazy(() => import("./marketplace/ru")),
      az: lazy(() => import("./marketplace/az")),
    },
  },
  profile: {
    title: { en: "My Profile", ru: "Мой профиль", az: "Profilim" },
    subtitle: {
      en: "Your personal cabinet: avatar, password, 2FA, language & time zone, theme and sign-in history.",
      ru: "Личный кабинет: аватар, пароль, 2FA, язык и часовой пояс, тема и история входов.",
      az: "Şəxsi kabinet: avatar, şifrə, 2FA, dil və saat qurşağı, tema və daxilolma tarixçəsi.",
    },
    content: {
      en: lazy(() => import("./profile/en")),
      ru: lazy(() => import("./profile/ru")),
      az: lazy(() => import("./profile/az")),
    },
  },
  "invoice-create": {
    title: { en: "Create Invoice", ru: "Создать счёт", az: "Hesab-faktura yarat" },
    subtitle: {
      en: "Pick the company, add line items, set discount/VAT and terms, then save a draft or send.",
      ru: "Выберите компанию, добавьте позиции, задайте скидку/НДС и условия, сохраните черновик или отправьте.",
      az: "Şirkəti seçin, mövqelər, endirim/ƏDV və şərtləri təyin edin, qaralama saxlayın və ya göndərin.",
    },
    content: {
      en: lazy(() => import("./invoice-create/en")),
      ru: lazy(() => import("./invoice-create/ru")),
      az: lazy(() => import("./invoice-create/az")),
    },
  },
  "invoices-recurring": {
    title: { en: "Recurring Invoices", ru: "Повторяющиеся счета", az: "Təkrarlanan hesab-fakturalar" },
    subtitle: {
      en: "Set rules that auto-generate and email invoices on a fixed cadence.",
      ru: "Настройте правила автогенерации и отправки счетов с фиксированной периодичностью.",
      az: "Sabit dövriyyə ilə hesab-fakturaları avtomatik hazırlayan və göndərən qaydalar qurun.",
    },
    content: {
      en: lazy(() => import("./invoices-recurring/en")),
      ru: lazy(() => import("./invoices-recurring/ru")),
      az: lazy(() => import("./invoices-recurring/az")),
    },
  },
  "complaint-new": {
    title: { en: "New complaint / suggestion", ru: "Новая жалоба / предложение", az: "Yeni şikayət / təklif" },
    subtitle: {
      en: "Log a customer request, use AI to suggest department and risk, then save.",
      ru: "Зарегистрируйте обращение, предложите отдел и риск через AI, сохраните.",
      az: "Müştəri müraciətini qeyd edin, AI ilə şöbə və riski təklif edin və yadda saxlayın.",
    },
    content: {
      en: lazy(() => import("./complaint-new/en")),
      ru: lazy(() => import("./complaint-new/ru")),
      az: lazy(() => import("./complaint-new/az")),
    },
  },
  "complaints-import": {
    title: { en: "Import complaints register (xlsx)", ru: "Импорт реестра жалоб (xlsx)", az: "Şikayətlər reyestrinin idxalı (xlsx)" },
    subtitle: {
      en: "Drag-and-drop the Excel complaints register, review the preview, and bulk-import.",
      ru: "Перетащите Excel-реестр жалоб, проверьте предпросмотр и массово импортируйте.",
      az: "Excel şikayət reyestrini sürüşdür-burax ilə yükləyin, ön baxışı yoxlayın və kütləvi idxal edin.",
    },
    content: {
      en: lazy(() => import("./complaints-import/en")),
      ru: lazy(() => import("./complaints-import/ru")),
      az: lazy(() => import("./complaints-import/az")),
    },
  },
  "whatsapp-channel": {
    title: { en: "WhatsApp Business channel", ru: "Канал WhatsApp Business", az: "WhatsApp Business kanalı" },
    subtitle: {
      en: "Verify WhatsApp Business messaging, wire the webhook, sync templates from Meta, map notifications. WhatsApp Business Calling uses the same Meta app and number, then needs the separate calls-event checklist in Channels.",
      ru: "Проверьте WhatsApp Business сообщения, подключите webhook, синхронизируйте шаблоны из Meta, настройте уведомления. WhatsApp Business Calling использует тот же Meta app и номер, затем требует отдельный чеклист calls events в Каналах.",
      az: "WhatsApp Business mesajlarını yoxlayın, webhook-u qoşun, Meta şablonlarını sinxronlaşdırın, bildirişləri təyin edin. WhatsApp Business Calling eyni Meta app və nömrədən istifadə edir, sonra Kanallarda ayrıca calls events checklist tələb edir.",
    },
    content: {
      en: lazy(() => import("./whatsapp-channel/en")),
      ru: lazy(() => import("./whatsapp-channel/ru")),
      az: lazy(() => import("./whatsapp-channel/az")),
    },
  },
  "board-view": {
    title: { en: "Kanban board", ru: "Канбан-доска", az: "Kanban lövhəsi" },
    subtitle: {
      en: "Manage tasks across columns with drag-and-drop, filter, create tasks, and view reports.",
      ru: "Управляйте задачами по колонкам перетаскиванием, фильтруйте, создавайте задачи, смотрите отчёты.",
      az: "Tapşırıqları sütunlar üzrə sürüklə-burax ilə idarə et, filtrlə, yarat və hesabatlara bax.",
    },
    content: {
      en: lazy(() => import("./board-view/en")),
      ru: lazy(() => import("./board-view/ru")),
      az: lazy(() => import("./board-view/az")),
    },
  },
  "board-settings": {
    title: { en: "Board configuration", ru: "Конфигурация доски", az: "Lövhə konfiqurasiyası" },
    subtitle: {
      en: "Set a board's columns (statuses), task/event types, custom fields, and table-view columns.",
      ru: "Настройте колонки доски (статусы), типы задач/событий, доп. поля и колонки таблицы.",
      az: "Lövhənin sütunlarını (statuslar), tapşırıq/event tiplərini, sahələri və cədvəl sütunlarını qurun.",
    },
    content: {
      en: lazy(() => import("./board-settings/en")),
      ru: lazy(() => import("./board-settings/ru")),
      az: lazy(() => import("./board-settings/az")),
    },
  },
  "lead-detail": {
    title: { en: "Lead Detail", ru: "Карточка лида", az: "Lid kartı" },
    subtitle: {
      en: "Open a lead, read its sections, log activity, and convert or move it down the pipeline.",
      ru: "Откройте лид, изучите разделы, фиксируйте активность и конвертируйте или двигайте по воронке.",
      az: "Lidi açın, bölmələrini oxuyun, fəaliyyət qeyd edin və konvert edin və ya boru xətti ilə irəlilədin.",
    },
    content: {
      en: lazy(() => import("./lead-detail/en")),
      ru: lazy(() => import("./lead-detail/ru")),
      az: lazy(() => import("./lead-detail/az")),
    },
  },
  "deal-detail": {
    title: { en: "Deal Detail", ru: "Карточка сделки", az: "Sövdə kartı" },
    subtitle: {
      en: "Work a deal: move stages, track amount and close date, log activity and related records.",
      ru: "Ведите сделку: меняйте этапы, отслеживайте сумму и дату закрытия, фиксируйте активность.",
      az: "Sövdəni idarə et: mərhələləri dəyiş, məbləğ və bağlanma tarixini izlə, fəaliyyət qeyd et.",
    },
    content: {
      en: lazy(() => import("./deal-detail/en")),
      ru: lazy(() => import("./deal-detail/ru")),
      az: lazy(() => import("./deal-detail/az")),
    },
  },
  "contact-detail": {
    title: { en: "Contact Detail", ru: "Карточка контакта", az: "Kontakt kartı" },
    subtitle: {
      en: "Open a contact, view its company/deals/activity, edit fields, and start communication.",
      ru: "Откройте контакт, смотрите компанию/сделки/активность, редактируйте поля и начинайте общение.",
      az: "Kontaktı açın, şirkət/sövdə/fəaliyyətini görün, sahələri redaktə edin və ünsiyyətə başlayın.",
    },
    content: {
      en: lazy(() => import("./contact-detail/en")),
      ru: lazy(() => import("./contact-detail/ru")),
      az: lazy(() => import("./contact-detail/az")),
    },
  },
  "company-detail": {
    title: { en: "Company Detail", ru: "Карточка компании", az: "Şirkət kartı" },
    subtitle: {
      en: "Open a company, view its contacts/deals/contracts, edit details, and track activity.",
      ru: "Откройте компанию, смотрите контакты/сделки/договоры, редактируйте данные и активность.",
      az: "Şirkəti açın, kontakt/sövdə/müqavilələrini görün, məlumatları redaktə edin və fəaliyyəti izləyin.",
    },
    content: {
      en: lazy(() => import("./company-detail/en")),
      ru: lazy(() => import("./company-detail/ru")),
      az: lazy(() => import("./company-detail/az")),
    },
  },
  "contacts-list": {
    title: { en: "Contacts List", ru: "Список контактов", az: "Kontaktlar siyahısı" },
    subtitle: {
      en: "Browse, search, filter and bulk-act on contacts; pick columns and open any record.",
      ru: "Просматривайте, ищите, фильтруйте и массово действуйте с контактами; выбирайте колонки.",
      az: "Kontaktları nəzərdən keçirin, axtarın, filtrləyin və kütləvi əməliyyat edin; sütunları seçin.",
    },
    content: {
      en: lazy(() => import("./contacts-list/en")),
      ru: lazy(() => import("./contacts-list/ru")),
      az: lazy(() => import("./contacts-list/az")),
    },
  },
  "campaign-detail": {
    title: { en: "Campaign Detail", ru: "Карточка кампании", az: "Kampaniya kartı" },
    subtitle: {
      en: "Open a campaign: review audience and content, send or schedule, and read the results.",
      ru: "Откройте кампанию: проверьте аудиторию и контент, отправьте или запланируйте, читайте результаты.",
      az: "Kampaniyanı açın: auditoriya və məzmunu yoxlayın, göndərin və ya planlayın və nəticələri oxuyun.",
    },
    content: {
      en: lazy(() => import("./campaign-detail/en")),
      ru: lazy(() => import("./campaign-detail/ru")),
      az: lazy(() => import("./campaign-detail/az")),
    },
  },
  "ticket-detail": {
    title: { en: "Ticket Detail", ru: "Карточка тикета", az: "Tiket kartı" },
    subtitle: {
      en: "Work a ticket: reply, change status/priority/assignee, and track the SLA and history.",
      ru: "Ведите тикет: отвечайте, меняйте статус/приоритет/исполнителя, следите за SLA и историей.",
      az: "Tiketi idarə et: cavab ver, status/prioritet/icraçını dəyiş və SLA və tarixçəni izlə.",
    },
    content: {
      en: lazy(() => import("./ticket-detail/en")),
      ru: lazy(() => import("./ticket-detail/ru")),
      az: lazy(() => import("./ticket-detail/az")),
    },
  },
  "contract-detail": {
    title: { en: "Contract Detail", ru: "Карточка договора", az: "Müqavilə kartı" },
    subtitle: {
      en: "Open a contract: read its terms and status, submit for approval, and track the lifecycle.",
      ru: "Откройте договор: читайте условия и статус, отправляйте на согласование, следите за жизненным циклом.",
      az: "Müqaviləni açın: şərtlər və statusu oxuyun, təsdiqə göndərin və həyat dövrünü izləyin.",
    },
    content: {
      en: lazy(() => import("./contract-detail/en")),
      ru: lazy(() => import("./contract-detail/ru")),
      az: lazy(() => import("./contract-detail/az")),
    },
  },
  "invoice-detail": {
    title: { en: "Invoice detail", ru: "Карточка счёта", az: "Hesab-faktura kartı" },
    subtitle: {
      en: "Send an invoice, record payment, and set up an automatic reminder chain.",
      ru: "Отправьте счёт, запишите платёж и настройте цепочку автонапоминаний.",
      az: "Bir fakturanı göndərin, ödənişi qeyd edin və avtomatik xatırlatma zənciri qurun.",
    },
    content: {
      en: lazy(() => import("./invoice-detail/en")),
      ru: lazy(() => import("./invoice-detail/ru")),
      az: lazy(() => import("./invoice-detail/az")),
    },
  },
  "offer-detail": {
    title: { en: "Offer record", ru: "Карточка предложения", az: "Təklif kartı" },
    subtitle: {
      en: "Open an offer, send it, get a PDF, and convert it to an invoice once approved.",
      ru: "Откройте предложение, отправьте его, получите PDF и преобразуйте в счёт после утверждения.",
      az: "Bir təklifi açın, göndərin, PDF alın və təsdiqlənəndən sonra hesab-fakturaya çevirin.",
    },
    content: {
      en: lazy(() => import("./offer-detail/en")),
      ru: lazy(() => import("./offer-detail/ru")),
      az: lazy(() => import("./offer-detail/az")),
    },
  },
  "product-detail": {
    title: { en: "Product detail", ru: "Карточка продукта", az: "Məhsul kartı" },
    subtitle: {
      en: "Review, edit and delete a single product or service.",
      ru: "Просмотр, редактирование и удаление одного продукта или услуги.",
      az: "Bir məhsul və ya xidmətə baxın, redaktə edin və silin.",
    },
    content: {
      en: lazy(() => import("./product-detail/en")),
      ru: lazy(() => import("./product-detail/ru")),
      az: lazy(() => import("./product-detail/az")),
    },
  },
  "project-detail": {
    title: { en: "Project detail", ru: "Карточка проекта", az: "Layihə kartı" },
    subtitle: {
      en: "Manage tasks, milestones, the team and budget on one screen.",
      ru: "Управляйте задачами, этапами, командой и бюджетом на одном экране.",
      az: "Tapşırıqları, mərhələləri, komandanı və büdcəni bir ekranda idarə edin.",
    },
    content: {
      en: lazy(() => import("./project-detail/en")),
      ru: lazy(() => import("./project-detail/ru")),
      az: lazy(() => import("./project-detail/az")),
    },
  },
  "event-detail": {
    title: { en: "Event detail", ru: "Детали мероприятия", az: "Tədbir detalları" },
    subtitle: {
      en: "Manage status, add participants and send invitations, track budget and metrics.",
      ru: "Управляйте статусом, добавляйте участников и приглашения, следите за бюджетом и показателями.",
      az: "Statusu idarə edin, iştirakçı əlavə edin və dəvətnamə göndərin, büdcə və göstəriciləri izləyin.",
    },
    content: {
      en: lazy(() => import("./event-detail/en")),
      ru: lazy(() => import("./event-detail/ru")),
      az: lazy(() => import("./event-detail/az")),
    },
  },
  "survey-detail": {
    title: { en: "Survey detail page", ru: "Страница опроса", az: "Sorğu səhifəsi" },
    subtitle: {
      en: "Read a survey's results, tune questions and auto-send triggers, export responses as CSV.",
      ru: "Читайте результаты опроса, настраивайте вопросы и триггеры автоотправки, выгружайте ответы в CSV.",
      az: "Sorğunun nəticələrini oxuyun, suallarını və avtomatik göndərmə tetiklərini tənzimləyin, CSV ixrac edin.",
    },
    content: {
      en: lazy(() => import("./survey-detail/en")),
      ru: lazy(() => import("./survey-detail/ru")),
      az: lazy(() => import("./survey-detail/az")),
    },
  },
  "kb-article-detail": {
    title: { en: "Knowledge Base — Article detail", ru: "База знаний — Детали статьи", az: "Bilik bazası — Məqalə detalı" },
    subtitle: {
      en: "Read, edit, switch published/draft status, or delete an article.",
      ru: "Прочитайте, отредактируйте, переключите статус опубликовано/черновик или удалите статью.",
      az: "Məqaləni oxuyun, redaktə edin, nəşr/qaralama statusunu dəyişin və ya silin.",
    },
    content: {
      en: lazy(() => import("./kb-article-detail/en")),
      ru: lazy(() => import("./kb-article-detail/ru")),
      az: lazy(() => import("./kb-article-detail/az")),
    },
  },
  "loyalty-account-detail": {
    title: { en: "Loyalty account detail", ru: "Карточка счёта лояльности", az: "Sadiqlik hesabı detalları" },
    subtitle: {
      en: "Review a member's points balance, manually credit or redeem points, track history.",
      ru: "Просмотр баланса баллов участника, ручное начисление или списание баллов, история транзакций.",
      az: "Üzvün bal balansına baxın, əl ilə bal yazın və ya silin və əməliyyat tarixçəsini izləyin.",
    },
    content: {
      en: lazy(() => import("./loyalty-account-detail/en")),
      ru: lazy(() => import("./loyalty-account-detail/ru")),
      az: lazy(() => import("./loyalty-account-detail/az")),
    },
  },
  "energy-customer-detail": {
    title: { en: "Energy customer detail", ru: "Карточка клиента (энергетика)", az: "Kommunal müştəri kartı" },
    subtitle: {
      en: "See one utility customer's full picture — account, service address, meters and service calls.",
      ru: "Полная картина по одному коммунальному клиенту — счёт, адрес, счётчики и сервисные заявки.",
      az: "Bir kommunal müştərinin tam mənzərəsi — hesab, xidmət ünvanı, sayğaclar və xidmət müraciətləri.",
    },
    content: {
      en: lazy(() => import("./energy-customer-detail/en")),
      ru: lazy(() => import("./energy-customer-detail/ru")),
      az: lazy(() => import("./energy-customer-detail/az")),
    },
  },
  "health-patient-detail": {
    title: { en: "Patient detail", ru: "Карточка пациента", az: "Pasiyent kartı" },
    subtitle: {
      en: "Open a patient record: demographics, encounters, care plans and related history.",
      ru: "Откройте карточку пациента: данные, обращения, планы ухода и связанная история.",
      az: "Pasiyent kartını açın: məlumatlar, müraciətlər, baxım planları və əlaqəli tarixçə.",
    },
    content: {
      en: lazy(() => import("./health-patient-detail/en")),
      ru: lazy(() => import("./health-patient-detail/ru")),
      az: lazy(() => import("./health-patient-detail/az")),
    },
  },
  "insurance-holder-detail": {
    title: { en: "Policy holder detail", ru: "Карточка страхователя", az: "Sığortalı kartı" },
    subtitle: {
      en: "Open a policy holder: their policies, claims, beneficiaries and contact details.",
      ru: "Откройте страхователя: его полисы, претензии, выгодоприобретатели и контакты.",
      az: "Sığortalını açın: polislər, tələblər, benefisiarlar və əlaqə məlumatları.",
    },
    content: {
      en: lazy(() => import("./insurance-holder-detail/en")),
      ru: lazy(() => import("./insurance-holder-detail/ru")),
      az: lazy(() => import("./insurance-holder-detail/az")),
    },
  },
  "media-subscriber-detail": {
    title: { en: "Subscriber detail", ru: "Карточка подписчика", az: "Abunəçi kartı" },
    subtitle: {
      en: "Open a media subscriber: their subscription, content access and ad-campaign links.",
      ru: "Откройте подписчика: подписка, доступ к контенту и связи с рекламными кампаниями.",
      az: "Media abunəçisini açın: abunə, məzmuna giriş və reklam kampaniyası bağlantıları.",
    },
    content: {
      en: lazy(() => import("./media-subscriber-detail/en")),
      ru: lazy(() => import("./media-subscriber-detail/ru")),
      az: lazy(() => import("./media-subscriber-detail/az")),
    },
  },
  "cobrowse-session-detail": {
    title: { en: "Manage a cobrowse session", ru: "Управление сессией cobrowse", az: "Cobrowse sessiyasını idarə et" },
    subtitle: {
      en: "Invite the customer, watch their screen live, pause, and end the session.",
      ru: "Пригласите клиента, смотрите его экран вживую, ставьте на паузу и завершайте сессию.",
      az: "Müştərini dəvət edin, ekranını canlı izləyin, fasilə verin və sessiyanı bitirin.",
    },
    content: {
      en: lazy(() => import("./cobrowse-session-detail/en")),
      ru: lazy(() => import("./cobrowse-session-detail/ru")),
      az: lazy(() => import("./cobrowse-session-detail/az")),
    },
  },
  "complaint-detail": {
    title: { en: "Complaint card", ru: "Карточка жалобы", az: "Şikayət kartı" },
    subtitle: {
      en: "Open one complaint record: change its status, review details and reply to the customer.",
      ru: "Откройте запись жалобы: измените статус, проверьте детали и ответьте клиенту.",
      az: "Bir şikayət qeydini açın: statusu dəyişin, məlumatları yoxlayın və müştəriyə cavab yazın.",
    },
    content: {
      en: lazy(() => import("./complaint-detail/en")),
      ru: lazy(() => import("./complaint-detail/ru")),
      az: lazy(() => import("./complaint-detail/az")),
    },
  },
  "contract-editor": {
    title: { en: "Contract body editor", ru: "Редактор тела контракта", az: "Müqavilə mətn redaktoru" },
    subtitle: {
      en: "Write, format, fill in variables, and export the contract body to PDF — with autosave.",
      ru: "Пишите, форматируйте, заполняйте переменные и экспортируйте тело контракта в PDF — с автосохранением.",
      az: "Müqavilə mətnini yazın, formatlayın, dəyişənləri doldurun və PDF ixrac edin — avtomatik saxlama ilə.",
    },
    content: {
      en: lazy(() => import("./contract-editor/en")),
      ru: lazy(() => import("./contract-editor/ru")),
      az: lazy(() => import("./contract-editor/az")),
    },
  },
  "form-detail": {
    title: { en: "Form editor", ru: "Редактор формы", az: "Forma redaktoru" },
    subtitle: {
      en: "Add fields, set metadata, save a draft, and publish a public lead-capture form.",
      ru: "Добавьте поля, настройте метаданные, сохраните черновик и опубликуйте публичную форму.",
      az: "Sahələri əlavə edin, metaməlumatı tənzimləyin, qaralama saxlayın və ictimai formanı dərc edin.",
    },
    content: {
      en: lazy(() => import("./form-detail/en")),
      ru: lazy(() => import("./form-detail/ru")),
      az: lazy(() => import("./form-detail/az")),
    },
  },
  "invoice-edit": {
    title: { en: "Edit an invoice", ru: "Редактирование счёта", az: "Hesab-fakturanı redaktə et" },
    subtitle: {
      en: "Change an existing invoice's client, line items, details and totals, then save.",
      ru: "Измените у существующего счёта клиента, позиции, детали и итоги, затем сохраните.",
      az: "Mövcud hesab-fakturanın müştərisini, mövqelərini, detallarını və yekununu dəyişib saxlayın.",
    },
    content: {
      en: lazy(() => import("./invoice-edit/en")),
      ru: lazy(() => import("./invoice-edit/ru")),
      az: lazy(() => import("./invoice-edit/az")),
    },
  },
  quotas: {
    title: { en: "Quotas", ru: "Квоты", az: "Kvotalar" },
    subtitle: {
      en: "Set a quarterly quota per rep and watch live attainment against won deals.",
      ru: "Поставьте менеджеру квоту на квартал и следите за выполнением по выигранным сделкам.",
      az: "Hər satıcıya rüblük kvota qoyun və udulmuş sövdələr üzrə icranı canlı izləyin.",
    },
    content: {
      en: lazy(() => import("./quotas/en")),
      ru: lazy(() => import("./quotas/ru")),
      az: lazy(() => import("./quotas/az")),
    },
  },
  territories: {
    title: { en: "Sales Territories", ru: "Территории продаж", az: "Satış əraziləri" },
    subtitle: {
      en: "Carve the market into named territories with coverage rules and member reps.",
      ru: "Разбейте рынок на именованные территории с правилами охвата и участниками.",
      az: "Bazarı əhatə qaydaları və üzv nümayəndələri olan adlı ərazilərə bölün.",
    },
    content: {
      en: lazy(() => import("./territories/en")),
      ru: lazy(() => import("./territories/ru")),
      az: lazy(() => import("./territories/az")),
    },
  },
  integrations: {
    title: {
      en: "Integrations & API Keys",
      ru: "Интеграции и API-ключи",
      az: "İnteqrasiyalar və API açarları",
    },
    subtitle: {
      en: "Push events out with webhooks, Google Calendar and Slack — and let external systems read and write your data over the REST API with scoped keys.",
      ru: "Отправляйте события наружу через вебхуки, Google Calendar и Slack — и давайте внешним системам читать и писать ваши данные через REST API с помощью ключей со скоупами.",
      az: "Hadisələri webhook-lar, Google Calendar və Slack ilə çölə ötürün — və scope-lu açarlarla xarici sistemlərə REST API üzərindən məlumatınızı oxuyub yazmağa imkan verin.",
    },
    content: {
      en: lazy(() => import("./integrations/en")),
      ru: lazy(() => import("./integrations/ru")),
      az: lazy(() => import("./integrations/az")),
    },
  },
  "settings-voip": {
    title: {
      en: "VoIP Settings",
      ru: "Настройки VoIP",
      az: "VoIP Parametrləri",
    },
    subtitle: {
      en: "Connect one telephony provider — Twilio, 3CX, Asterisk, or Custom SIP — so the CRM can place click-to-call calls, log them automatically, and optionally record.",
      ru: "Подключите одного провайдера телефонии — Twilio, 3CX, Asterisk или Custom SIP — чтобы CRM звонила по клику, логировала звонки автоматически и при желании записывала их.",
      az: "Bir telefon provayderini — Twilio, 3CX, Asterisk və ya Custom SIP — qoşun ki, CRM kliklə zəng etsin, zəngləri avtomatik qeydə alsın və istəsəniz yazsın.",
    },
    content: {
      en: lazy(() => import("./settings-voip/en")),
      ru: lazy(() => import("./settings-voip/ru")),
      az: lazy(() => import("./settings-voip/az")),
    },
  },
  "ai-automation": {
    title: {
      en: "AI Automation",
      ru: "ИИ-автоматизация",
      az: "AI Avtomatlaşdırma",
    },
    subtitle: {
      en: "Delegate CRM work in three tiers — Analytics watches, Review drafts for your approval, Autopilot acts. Plus the daily AI budget, delivery channels, briefing subscriptions, and the shadow-action review queue.",
      ru: "Передавайте рутину CRM на трёх уровнях: Аналитика наблюдает, Проверка готовит черновик на ваше подтверждение, Автопилот действует. А также дневной бюджет ИИ, каналы доставки, подписки на сводки и очередь shadow-действий на согласование.",
      az: "CRM işini üç səviyyədə ötürün: Analitika izləyir, Baxış sizin təsdiqiniz üçün qaralama hazırlayır, Avtopilot icra edir. Həmçinin gündəlik AI büdcəsi, çatdırılma kanalları, xülasə abunələri və shadow-əməliyyat təsdiq növbəsi.",
    },
    content: {
      en: lazy(() => import("./ai-automation/en")),
      ru: lazy(() => import("./ai-automation/ru")),
      az: lazy(() => import("./ai-automation/az")),
    },
  },
  "contract-templates": {
    title: {
      en: "Contract Templates & Clauses",
      ru: "Шаблоны контрактов и пункты",
      az: "Müqavilə şablonları və bəndlər",
    },
    subtitle: {
      en: "Build reusable contract blueprints with {{variables}}, manage the governed clause library, and generate versioned contracts in seconds.",
      ru: "Создавайте переиспользуемые шаблоны договоров с {{переменными}}, управляйте библиотекой согласованных пунктов и генерируйте версионированные контракты за секунды.",
      az: "{{dəyişənlər}} ilə təkrar istifadəli müqavilə şablonları qurun, idarə olunan bənd kitabxanasını idarə edin və versiyalanmış müqavilələri saniyələr ərzində yaradın.",
    },
    content: {
      en: lazy(() => import("./contract-templates/en")),
      ru: lazy(() => import("./contract-templates/ru")),
      az: lazy(() => import("./contract-templates/az")),
    },
  },
}

/**
 * Resolve an article for a slug + locale, with safe English fallback.
 * Returns null only if the slug itself is unknown (caller should guard).
 */
export function resolveHelpArticle(
  slug: HelpSlug,
  locale: HelpLocale
): { component: LazyExoticComponent<ComponentType>; title: string; subtitle: string; locale: HelpLocale } | null {
  const entry = HELP_REGISTRY[slug]
  if (!entry) return null
  const chosen: HelpLocale = entry.content[locale] ? locale : "en"
  const component = entry.content[chosen]
  if (!component) return null
  return {
    component,
    title: entry.title[locale] ?? entry.title.en,
    subtitle: entry.subtitle[locale] ?? entry.subtitle.en,
    locale: chosen,
  }
}
