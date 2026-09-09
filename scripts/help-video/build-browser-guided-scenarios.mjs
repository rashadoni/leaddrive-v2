#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const mapPath = resolve(repoRoot, "docs/help-video-section-map-2026-07-03.md");
const scenarioPath = resolve(repoRoot, "video/scenarios/browser-guided.json");
const minWords = 280;

const rows = parseMap(readFileSync(mapPath, "utf8"));
const scenarios = {};

for (const row of rows) {
  scenarios[row.slug] = buildScenario(row);
}

validate(scenarios);
writeFileSync(scenarioPath, `${JSON.stringify(scenarios, null, 2)}\n`);
console.log(`Wrote ${Object.keys(scenarios).length} browser-guided scenarios to ${scenarioPath}`);

function parseMap(markdown) {
  let group = "";
  const parsed = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s+\(\d+\)/);
    if (heading) {
      group = heading[1];
      continue;
    }
    if (!line.startsWith("| ") || line.includes("|---")) continue;
    const cells = splitTableRow(line);
    if (!/^\d+$/.test(cells[0] || "")) continue;
    parsed.push({
      group,
      index: Number(cells[0]),
      slug: stripCode(cells[1]),
      routes: cells[2]
        .split("<br>")
        .map(stripCode)
        .filter(Boolean),
      source: cells[3],
      registry: cells[4],
    });
  }
  return parsed;
}

function splitTableRow(line) {
  return line
    .replace(/^\|\s*/, "")
    .replace(/\s*\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function stripCode(value) {
  return value.replaceAll("`", "").trim();
}

function buildScenario(row) {
  const route = row.routes[0] || "/dashboard";
  const title = titleFor(row.slug);
  const group = groupCopy(row.group);
  const domain = domainCopy(row.group);
  const profile = sectionProfile(row, title);
  const targetBase = targetBaseFor(row.slug);

  return {
    route,
    title: {
      ru: title.ru,
      en: title.en,
      az: title.az,
    },
    goal: {
      ru: `Показать полный рабочий цикл раздела ${title.ru}: понять назначение, найти нужные данные, выполнить безопасное действие, проверить результат и оставить понятный след для команды.`,
      en: `Show the full working flow for ${title.en}: understand the purpose, find the right data, perform a safe action, verify the result, and leave a clear trail for the team.`,
      az: `${title.az} bölməsi üçün tam iş axınını göstərmək: məqsədi anlamaq, lazımi məlumatı tapmaq, təhlükəsiz əməliyyat etmək, nəticəni yoxlamaq və komanda üçün aydın iz buraxmaq.`,
    },
    steps: [
      sceneIntro({ route, title, group, domain, profile, targetBase }),
      sceneNavigate({ route, title, group, domain, profile, targetBase }),
      sceneWork({ route, title, group, domain, profile, targetBase }),
      sceneReview({ route, title, group, domain, profile, targetBase }),
      sceneSafety({ route, title, group, domain, profile, targetBase }),
      sceneVerify({ route, title, group, domain, profile, targetBase }),
    ],
  };
}

function sceneIntro({ route, title, group, domain, profile, targetBase }) {
  return {
    route,
    target: selectors(targetBase, ["header", "stats", "kpis", "overview"]),
    action: "hover",
    heading: {
      ru: "Сначала понимаем назначение",
      en: "Start with the purpose",
      az: "Əvvəl məqsədi anlayın",
    },
    caption: {
      ru: "Что показывает раздел и кому он нужен",
      en: "What this section shows and who uses it",
      az: "Bölmə nəyi göstərir və kim istifadə edir",
    },
    voice: {
      ru: `Открываем раздел ${title.ru}. В первые секунды пользователь должен понять не только название страницы, но и рабочую задачу. Рабочая область этого раздела: ${profile.focus.ru}. Начинаем с верхней части экрана, потому что там чаще всего находятся заголовок, ключевые показатели, статус синхронизации и быстрые действия. Если раздел используется каждый день, эта зона помогает сразу оценить масштаб работы, увидеть владельца процесса и не проваливаться в детали слишком рано.`,
      en: `Open the ${title.en} section. In the first seconds, the user should understand more than the page name: this is where the team works with ${profile.focus.en}. Start from the top of the screen because it usually contains the title, key indicators, sync status, and quick actions. When a section is used every day, this area helps the user judge the workload, see process ownership, and avoid diving into details too early.`,
      az: `${title.az} bölməsini açın. İlk saniyələrdə istifadəçi yalnız səhifənin adını deyil, iş tapşırığını anlamalıdır: komanda burada ${profile.focus.az} ilə işləyir. Yuxarı hissədən başlayın, çünki adətən başlıq, əsas göstəricilər, sinxronizasiya statusu və sürətli əməliyyatlar burada olur. Bölmə gündəlik istifadə olunursa, bu zona iş həcmini, proses sahibini və detallara nə vaxt keçməyi anlamağa kömək edir.`,
    },
  };
}

function sceneNavigate({ route, title, group, domain, profile, targetBase }) {
  return {
    route,
    target: selectors(targetBase, ["filters", "tabs", "search", "list", "table"]),
    action: "click",
    heading: {
      ru: "Находим нужный срез",
      en: "Find the right slice",
      az: "Lazımi kəsimi tapın",
    },
    caption: {
      ru: "Фильтры, вкладки и поиск сужают список",
      en: "Filters, tabs, and search narrow the list",
      az: "Filtrlər, tablar və axtarış siyahını daraldır",
    },
    voice: {
      ru: `Дальше показываем навигацию внутри ${title.ru}: ${profile.slice.ru}. Для ${group.ru} важно быстро отделить рабочие элементы от шума: просроченные, новые, критичные, ожидающие проверки или уже выполненные. Курсор не просто водит по экрану, а выбирает один понятный срез и объясняет, почему именно он нужен в этом разделе. Так пользователь запоминает не все кнопки подряд, а короткий путь к своей ежедневной задаче.`,
      en: `Next, show navigation inside ${title.en}: ${profile.slice.en}. For ${group.en}, the important skill is separating working items from noise: overdue, new, critical, waiting for review, or already completed. The cursor should not just move across the screen; it should choose one clear slice and explain why that slice matters in this section. This teaches the user a daily path instead of a random tour of buttons.`,
      az: `Sonra ${title.az} daxilində naviqasiyanı göstərin: ${profile.slice.az}. ${group.az} üçün əsas bacarıq iş elementlərini səs-küydən ayırmaqdır: gecikmiş, yeni, kritik, yoxlama gözləyən və ya tamamlanmış. Kursor sadəcə ekranda gəzməməlidir; bu bölmədə vacib olan bir aydın kəsim seçməli və niyə lazım olduğunu izah etməlidir. Beləliklə istifadəçi düymələri deyil, gündəlik iş yolunu yadda saxlayır.`,
    },
  };
}

function sceneWork({ route, title, group, domain, profile, targetBase }) {
  return {
    route,
    target: selectors(targetBase, ["new", "create", "builder", "form", "actions"]),
    action: "click",
    heading: {
      ru: "Выполняем основное действие",
      en: "Perform the main action",
      az: "Əsas əməliyyatı edin",
    },
    caption: {
      ru: "Открыть, создать или обновить запись",
      en: "Open, create, or update a record",
      az: "Qeydi açın, yaradın və ya yeniləyin",
    },
    voice: {
      ru: `Теперь выполняем основное действие раздела ${title.ru}: ${profile.action.ru}. Важно проговаривать правило безопасности: пользователь должен понимать, какие поля обязательны, какие изменения сразу влияют на клиента, деньги, SLA или автоматизацию, и где действие остается черновиком. Такой сценарий делает раздел практичным, потому что человек видит реальный шаг, а не абстрактное описание интерфейса. Если действие требует согласования, курсор должен показать, где оно ожидает проверки, а не создавать ощущение мгновенного запуска.`,
      en: `Now perform the main action in ${title.en}: ${profile.action.en}. The safety rule must be spoken clearly: the user needs to know which fields are required, which changes affect customers, money, SLAs, or automation immediately, and where the action remains a draft. This makes the section practical because the user sees a real step, not an abstract description of the interface. If approval is required, the cursor should show where the action waits for review instead of implying an instant launch.`,
      az: `İndi ${title.az} bölməsində əsas əməliyyatı edin: ${profile.action.az}. Təhlükəsizlik qaydası aydın deyilməlidir: istifadəçi hansı sahələrin məcburi olduğunu, hansı dəyişikliklərin müştəriyə, pula, SLA-ya və ya avtomatlaşdırmaya dərhal təsir etdiyini, harada əməliyyatın qaralama qaldığını bilməlidir. Belə ssenari bölməni praktik edir, çünki insan real addımı görür. Təsdiq lazımdırsa, kursor əməliyyatın harada yoxlama gözlədiyini göstərməlidir.`,
    },
  };
}

function sceneReview({ route, title, group, domain, profile, targetBase }) {
  return {
    route,
    target: selectors(targetBase, ["detail", "preview", "card", "summary", "table"]),
    action: "hover",
    heading: {
      ru: "Проверяем карточку и контекст",
      en: "Review the card and context",
      az: "Kartı və konteksti yoxlayın",
    },
    caption: {
      ru: "Детали показывают причину и следующий шаг",
      en: "Details explain the reason and next step",
      az: "Detallar səbəbi və növbəti addımı göstərir",
    },
    voice: {
      ru: `После действия переходим к проверке. В ${title.ru} нужно показать, где пользователь видит детали: ${profile.review.ru}. Для ${domain.risk.ru} нельзя полагаться только на цветной статус. Нужно объяснить, какие признаки подтверждают, что запись выбрана правильно, что данные свежие и что следующий шаг соответствует процессу компании. Это снижает риск случайного изменения не той записи и помогает руководителю понять, почему команда доверяет этому экрану.`,
      en: `After the action, move into review. In ${title.en}, show where the user sees the details: ${profile.review.en}. For ${domain.risk.en}, a colored status alone is not enough. Explain which signals confirm that the correct record was selected, the data is fresh, and the next step matches the company's process. This reduces the risk of accidentally changing the wrong item and helps a manager understand why the team can trust this screen.`,
      az: `Əməliyyatdan sonra yoxlamaya keçin. ${title.az} bölməsində istifadəçinin detalları harada gördüyünü göstərin: ${profile.review.az}. ${domain.risk.az} üçün təkcə rəngli status kifayət deyil. Düzgün qeydin seçildiyini, məlumatın təzə olduğunu və növbəti addımın şirkət prosesinə uyğun gəldiyini hansı siqnalların təsdiqlədiyini izah edin. Bu, səhv qeydi dəyişmək riskini azaldır və rəhbərə bu ekrana niyə güvənmək olduğunu göstərir.`,
    },
  };
}

function sceneSafety({ route, title, group, domain, profile, targetBase }) {
  return {
    route,
    target: selectors(targetBase, ["permissions", "settings", "save", "controls", "rules"]),
    action: "hover",
    heading: {
      ru: "Объясняем права и безопасный запуск",
      en: "Explain permissions and safe launch",
      az: "İcazələri və təhlükəsiz işə salmanı izah edin",
    },
    caption: {
      ru: "Права, черновики и подтверждения защищают процесс",
      en: "Permissions, drafts, and approvals protect the process",
      az: "İcazələr, qaralamalar və təsdiqlər prosesi qoruyur",
    },
    voice: {
      ru: `Отдельно проговариваем безопасный запуск: ${profile.safety.ru}. В разделах ${group.ru} часть пользователей только смотрит данные, часть редактирует, а часть утверждает или запускает действия. Поэтому в видео нужно показать, где находится сохранение, где отмена, где черновик, где подтверждение, а где настройка прав. Если действие может отправить сообщение, поменять сумму, повлиять на SLA или включить автоматизацию, пользователь должен услышать это до клика. Такой акцент делает обучение надежным для реальной команды.`,
      en: `Call out safe launch separately: ${profile.safety.en}. In ${group.en} sections, some users only view data, some edit it, and some approve or launch actions. The video should therefore show where save lives, where cancel lives, where drafts are kept, where approval happens, and where permissions are configured. If an action can send a message, change an amount, affect an SLA, or enable automation, the user must hear that before clicking. This emphasis makes the training safe for a real team.`,
      az: `Təhlükəsiz işə salmanı ayrıca izah edin: ${profile.safety.az}. ${group.az} bölmələrində bəzi istifadəçilər yalnız məlumatı görür, bəziləri redaktə edir, bəziləri isə təsdiqləyir və ya əməliyyat başladır. Buna görə videoda saxla düyməsinin, ləğvin, qaralamanın, təsdiqin və icazə ayarlarının harada olduğunu göstərmək lazımdır. Əməliyyat mesaj göndərə, məbləği dəyişə, SLA-ya təsir edə və ya avtomatlaşdırmanı aktiv edə bilərsə, istifadəçi bunu klikdən əvvəl eşitməlidir. Bu vurğu real komanda üçün təlimi təhlükəsiz edir.`,
    },
  };
}

function sceneVerify({ route, title, group, domain, profile, targetBase }) {
  return {
    route,
    target: selectors(targetBase, ["history", "audit", "runs", "reports", "list"]),
    action: "click",
    heading: {
      ru: "Фиксируем результат",
      en: "Confirm the result",
      az: "Nəticəni təsdiqləyin",
    },
    caption: {
      ru: "Проверка результата завершает рабочий цикл",
      en: "Result verification closes the workflow",
      az: "Nəticə yoxlaması iş axınını bağlayır",
    },
    voice: {
      ru: `Завершаем тур проверкой результата: ${profile.verify.ru}. После работы в ${title.ru} пользователь должен знать, куда смотреть дальше: обновился ли список, появилась ли запись в истории, изменился ли статус, ушло ли задание ответственному, попал ли объект в отчет или очередь. Финальный кадр полезно заканчивать коротким резюме: открыть раздел, выбрать правильный срез, выполнить одно действие, проверить детали, убедиться в правах и подтвердить результат. Тогда пользователь понимает полный цикл и может повторить его самостоятельно.`,
      en: `Finish the tour by verifying the result: ${profile.verify.en}. After working in ${title.en}, the user should know where to look next: did the list update, did history record the action, did the status change, did the task reach the owner, did the object enter a report or queue. The final frame should end with a short recap: open the section, choose the right slice, perform one action, review details, confirm permissions, and verify the result. Then the user understands the full cycle and can repeat it alone.`,
      az: `Turu nəticəni yoxlamaqla bitirin: ${profile.verify.az}. ${title.az} bölməsində işlədikdən sonra istifadəçi haraya baxacağını bilməlidir: siyahı yeniləndimi, tarixçədə qeyd yarandımı, status dəyişdimi, tapşırıq məsul şəxsə çatdımı, obyekt hesabat və ya növbəyə düşdümü. Son kadrı qısa yekunla bitirmək faydalıdır: bölməni aç, düzgün kəsimi seç, bir əməliyyat et, detalları yoxla, icazələri təsdiqlə və nəticəni yoxla. Beləliklə istifadəçi tam dövrü anlayır və özü təkrarlaya bilir.`,
    },
  };
}

function selectors(base, suffixes) {
  return [
    ...suffixes.map((suffix) => `[data-tour-id='${base}-${suffix}']`),
    ...suffixes.map((suffix) => `[data-video-target='${base}-${suffix}']`),
    `[data-tour-id='${base}']`,
    "main",
  ];
}

function targetBaseFor(slug) {
  const aliases = {
    dashboard: "dashboard",
    reports: "reports",
    leads: "leads",
    companies: "companies",
    segments: "segments",
    campaigns: "campaigns",
    journeys: "journeys",
    invoices: "invoices",
    finance: "finance",
    budgeting: "budgeting",
    profitability: "profitability",
    pricing: "pricing",
    "budget-config": "budget-config",
    "lead-rules": "lead-rules",
    "sales-forecast-settings": "sales-forecast",
    "web-to-lead": "web-to-lead",
    "approval-rules-nav": "approval-rules",
    "approval-delegates-nav": "approval-delegates",
    snippets: "snippets",
    "web-chat-nav": "webchat",
    smtp: "smtp",
    users: "users",
    macros: "macros",
    integrations: "integrations",
    "dashboard-settings": "widget",
    "kpi-arena-config": "leaderboard-config",
    "field-permissions": "fields",
    "ai-automation": "ai",
    "loyalty-builder": "lb",
    "loyalty-dashboard": "loyalty",
    "task-templates": "task-templates",
    "email-templates": "email-templates",
    "invoice-settings": "inv-settings",
    "finance-notifications": "fin-notif",
    "portal-users": "portal",
    "settings-voip": "voip",
    "sla-policies": "sla",
    "skill-routing": "sr",
    "ai-actions": "ai-actions",
    "inbox-automation": "inbox-automation",
    "whatsapp-business-calls": "whatsapp-calls",
    channels: "channels",
  };
  return aliases[slug] || slug;
}

function titleFor(slug) {
  const overrides = {
    "ai-actions": "AI Advisor",
    "ai-command-center": "AI Command Center",
    "ai-scoring": "AI Scoring",
    "api-keys": "API Keys",
    "campaign-roi": "Campaign ROI",
    "cdp-insights": "CDP Insights",
    "cdp-merge-queue": "CDP Merge Queue",
    "kpi-arena": "KPI Arena",
    "kpi-arena-config": "KPI Arena Config",
    "loyalty-pos": "Loyalty POS",
    "mtm-overview": "MTM Overview",
    "settings-voip": "VoIP Settings",
    "sla-policies": "SLA Policies",
    smtp: "SMTP",
    voip: "VoIP",
    "voip-insights": "VoIP Insights",
    "web-chat-nav": "Web Chat",
    "whatsapp-business-calls": "WhatsApp Business Calling",
  };
  const en = overrides[slug] || slug
    .replace(/-nav$/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const acronyms = new Set(["ai", "api", "cdp", "crm", "kpi", "mtm", "pos", "roi", "sla", "smtp", "voip"]);
      if (acronyms.has(part)) return part.toUpperCase();
      if (part === "whatsapp") return "WhatsApp";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
  return {
    en,
    ru: en,
    az: en,
  };
}

function groupCopy(group) {
  const map = {
    CRM: { ru: "CRM", en: "CRM", az: "CRM" },
    Sales: { ru: "продаж", en: "Sales", az: "Satış" },
    "Contracts Control": { ru: "управления контрактами", en: "Contracts Control", az: "Müqavilə nəzarəti" },
    Communication: { ru: "коммуникаций", en: "Communication", az: "Kommunikasiya" },
    Support: { ru: "поддержки", en: "Support", az: "Dəstək" },
    Marketing: { ru: "маркетинга", en: "Marketing", az: "Marketinq" },
    "Loyalty Program": { ru: "программы лояльности", en: "Loyalty Program", az: "Loyallıq proqramı" },
    Finance: { ru: "финансов", en: "Finance", az: "Maliyyə" },
    Analytics: { ru: "аналитики", en: "Analytics", az: "Analitika" },
    "Route & Field": { ru: "полевых команд", en: "Route and Field", az: "Sahə komandaları" },
    Settings: { ru: "настроек", en: "Settings", az: "Ayarlar" },
    "Health Cloud": { ru: "Health Cloud", en: "Health Cloud", az: "Health Cloud" },
    "Insurance Cloud": { ru: "Insurance Cloud", en: "Insurance Cloud", az: "Insurance Cloud" },
    "Public Sector": { ru: "Public Sector", en: "Public Sector", az: "Public Sector" },
    "Media Cloud": { ru: "Media Cloud", en: "Media Cloud", az: "Media Cloud" },
    "Energy & Utilities": { ru: "Energy and Utilities", en: "Energy and Utilities", az: "Energy and Utilities" },
  };
  return map[group] || { ru: group, en: group, az: group };
}

function domainCopy(group) {
  const fallback = {
    records: { ru: "записи и рабочие объекты", en: "records and work objects", az: "qeydlər və iş obyektləri" },
    risk: { ru: "операционной работы", en: "operational work", az: "əməliyyat işi" },
  };
  const map = {
    Sales: {
      records: { ru: "лиды, сделки, прогнозы и коммерческие действия", en: "leads, deals, forecasts, and commercial actions", az: "lidlər, sövdələşmələr, proqnozlar və kommersiya əməliyyatları" },
      risk: { ru: "продаж", en: "sales work", az: "satış işi" },
    },
    "Contracts Control": {
      records: { ru: "заявки, договоры, шаблоны, правила согласования и этапы жизненного цикла", en: "requests, contracts, templates, approval rules, and lifecycle stages", az: "sorğular, müqavilələr, şablonlar, təsdiq qaydaları və həyat dövrü mərhələləri" },
      risk: { ru: "контрактного процесса", en: "contract work", az: "müqavilə prosesi" },
    },
    Communication: {
      records: { ru: "каналы, диалоги, очереди, шаблоны и правила маршрутизации", en: "channels, conversations, queues, templates, and routing rules", az: "kanallar, söhbətlər, növbələr, şablonlar və yönləndirmə qaydaları" },
      risk: { ru: "коммуникаций с клиентом", en: "customer communication", az: "müştəri kommunikasiyası" },
    },
    Support: {
      records: { ru: "тикеты, SLA, эскалации, статьи базы знаний и действия агентов", en: "tickets, SLAs, escalations, knowledge articles, and agent actions", az: "ticketlər, SLA-lar, eskalasiyalar, bilik bazası məqalələri və agent əməliyyatları" },
      risk: { ru: "поддержки", en: "support work", az: "dəstək işi" },
    },
    Marketing: {
      records: { ru: "кампании, сегменты, события, шаблоны, источники и атрибуцию", en: "campaigns, segments, events, templates, sources, and attribution", az: "kampaniyalar, segmentlər, tədbirlər, şablonlar, mənbələr və atribusiya" },
      risk: { ru: "маркетинга", en: "marketing work", az: "marketinq işi" },
    },
    "Loyalty Program": {
      records: { ru: "уровни, правила начисления, промокоды, POS-операции и участников", en: "tiers, earn rules, promo codes, POS actions, and members", az: "səviyyələr, qazanma qaydaları, promo kodlar, POS əməliyyatları və üzvlər" },
      risk: { ru: "лояльности", en: "loyalty work", az: "loyallıq işi" },
    },
    Finance: {
      records: { ru: "счета, бюджеты, цены, подписки, маржу и финансовые настройки", en: "invoices, budgets, prices, subscriptions, margin, and finance settings", az: "fakturalar, büdcələr, qiymətlər, abunələr, marja və maliyyə ayarları" },
      risk: { ru: "финансов", en: "finance work", az: "maliyyə işi" },
    },
    Analytics: {
      records: { ru: "метрики, отчеты, рекомендации AI, сегменты данных и управленческие выводы", en: "metrics, reports, AI recommendations, data slices, and management insights", az: "metrikalar, hesabatlar, AI tövsiyələri, məlumat kəsimləri və idarəetmə nəticələri" },
      risk: { ru: "аналитики", en: "analytics work", az: "analitika işi" },
    },
    "Route & Field": {
      records: { ru: "маршруты, визиты, фото, задания, агенты и полевые проверки", en: "routes, visits, photos, tasks, agents, and field checks", az: "marşrutlar, ziyarətlər, fotolar, tapşırıqlar, agentlər və sahə yoxlamaları" },
      risk: { ru: "полевой работы", en: "field work", az: "sahə işi" },
    },
    Settings: {
      records: { ru: "правила, ключи, интеграции, пользователей, права и системные параметры", en: "rules, keys, integrations, users, permissions, and system settings", az: "qaydalar, açarlar, inteqrasiyalar, istifadəçilər, icazələr və sistem ayarları" },
      risk: { ru: "настроек", en: "settings work", az: "ayar işi" },
    },
  };
  return map[group] || fallback;
}

function sectionProfile(row, title) {
  const slug = row.slug;
  const g = row.group;
  const t = title;
  const p = (focus, slice, action, review, safety, verify) => ({ focus, slice, action, review, safety, verify });
  const l = (ru, en, az) => ({ ru, en, az });

  const defaults = {
    CRM: p(
      l("клиентские записи, активности, ответственные и следующие шаги", "customer records, activities, owners, and next steps", "müştəri qeydləri, aktivliklər, məsul şəxslər və növbəti addımlar"),
      l("поиск по названию, фильтр по владельцу, статусу и последней активности", "search by name, owner filter, status filter, and last activity", "ad üzrə axtarış, sahib, status və son aktivlik filtri"),
      l("открыть нужную карточку, обновить ответственного или создать следующий шаг", "open the right card, update the owner, or create the next step", "düzgün kartı açmaq, sahibi yeniləmək və ya növbəti addımı yaratmaq"),
      l("владелец, связанный клиент, последние активности, заметки, задачи и история изменений", "owner, linked customer, recent activities, notes, tasks, and change history", "sahib, əlaqəli müştəri, son aktivliklər, qeydlər, tapşırıqlar və dəyişiklik tarixçəsi"),
      l("перед массовым изменением нужно проверить владельца, права и связанный объект", "before a bulk change, check the owner, permissions, and linked object", "kütləvi dəyişiklikdən əvvəl sahib, icazələr və əlaqəli obyekt yoxlanmalıdır"),
      l("карточка должна обновиться, а новое действие должно появиться в задачах или истории", "the card should update and the new action should appear in tasks or history", "kart yenilənməli və yeni əməliyyat tapşırıqlarda və ya tarixçədə görünməlidir"),
    ),
    Sales: p(
      l("воронка продаж, лиды, сделки, прогнозы и коммерческие обязательства", "sales pipeline, leads, deals, forecasts, and commercial commitments", "satış borusu, lidlər, sövdələşmələr, proqnozlar və kommersiya öhdəlikləri"),
      l("pipeline, этап, сумма, владелец, дата закрытия, источник и риск зависания", "pipeline, stage, amount, owner, close date, source, and stall risk", "pipeline, mərhələ, məbləğ, sahib, bağlanma tarixi, mənbə və dayanma riski"),
      l("создать или открыть коммерческий объект, уточнить этап и назначить следующий follow-up", "create or open a commercial object, refine the stage, and assign the next follow-up", "kommersiya obyektini yaratmaq və ya açmaq, mərhələni dəqiqləşdirmək və növbəti follow-up təyin etmək"),
      l("сумма, вероятность, этап, ожидаемое закрытие, связанные контакты и последние касания", "amount, probability, stage, expected close, linked contacts, and latest touches", "məbləğ, ehtimal, mərhələ, gözlənilən bağlanma, əlaqəli kontaktlar və son toxunuşlar"),
      l("этап, сумма и прогноз влияют на отчетность, поэтому их нельзя менять без основания", "stage, amount, and forecast affect reporting, so they should not change without evidence", "mərhələ, məbləğ və proqnoz hesabatlara təsir edir, buna görə sübutsuz dəyişdirilməməlidir"),
      l("обновленный объект должен попасть в нужный этап, прогноз, задачу или коммерческий отчет", "the updated object should appear in the right stage, forecast, task, or sales report", "yenilənmiş obyekt düzgün mərhələdə, proqnozda, tapşırıqda və ya satış hesabatında görünməlidir"),
    ),
    "Contracts Control": p(
      l("заявки, договоры, шаблоны, согласования и жизненный цикл документа", "requests, contracts, templates, approvals, and document lifecycle", "sorğular, müqavilələr, şablonlar, təsdiqlər və sənəd həyat dövrü"),
      l("тип договора, статус, владелец, контрагент, срок, сумма и этап согласования", "contract type, status, owner, counterparty, term, amount, and approval stage", "müqavilə tipi, status, sahib, qarşı tərəf, müddət, məbləğ və təsdiq mərhələsi"),
      l("подготовить заявку или открыть договор, выбрать шаблон и передать его на согласование", "prepare a request or open a contract, choose a template, and send it for approval", "sorğu hazırlamaq və ya müqavilə açmaq, şablon seçmək və təsdiqə göndərmək"),
      l("контрагент, версия шаблона, условия, обязательные поля, согласующие и история правок", "counterparty, template version, terms, required fields, approvers, and edit history", "qarşı tərəf, şablon versiyası, şərtlər, məcburi sahələr, təsdiqləyənlər və düzəliş tarixçəsi"),
      l("нельзя отправлять договор дальше, пока не проверены шаблон, обязательные поля и маршрут согласования", "do not move the contract forward until the template, required fields, and approval route are checked", "şablon, məcburi sahələr və təsdiq marşrutu yoxlanmadan müqavilə irəli göndərilməməlidir"),
      l("после действия статус, согласующий или запись в истории договора должны измениться ожидаемо", "after the action, the status, approver, or contract history entry should change as expected", "əməliyyatdan sonra status, təsdiqləyən və ya müqavilə tarixçəsi gözlənildiyi kimi dəyişməlidir"),
    ),
    Communication: p(
      l("каналы, диалоги, очереди, шаблоны и безопасная маршрутизация сообщений", "channels, conversations, queues, templates, and safe message routing", "kanallar, söhbətlər, növbələr, şablonlar və təhlükəsiz mesaj yönləndirməsi"),
      l("канал, очередь, статус диалога, ответственный, непрочитанные сообщения и источник", "channel, queue, conversation status, owner, unread messages, and source", "kanal, növbə, söhbət statusu, sahib, oxunmamış mesajlar və mənbə"),
      l("открыть диалог или настройку канала, назначить очередь и подготовить безопасный ответ", "open a conversation or channel setting, assign a queue, and prepare a safe reply", "söhbəti və ya kanal ayarını açmaq, növbə təyin etmək və təhlükəsiz cavab hazırlamaq"),
      l("канал, клиент, последняя реплика, очередь, шаблон, статус доставки и история обработки", "channel, customer, latest message, queue, template, delivery status, and handling history", "kanal, müştəri, son mesaj, növbə, şablon, çatdırılma statusu və emal tarixçəsi"),
      l("перед отправкой или включением automation нужно отличить черновик, preview и реальную отправку клиенту", "before sending or enabling automation, distinguish draft, preview, and a real customer send", "göndərmədən və ya avtomatlaşdırmanı aktiv etmədən əvvəl qaralama, preview və real müştəri göndərişini ayırmaq lazımdır"),
      l("сообщение, маршрут или настройка должны отразиться в очереди, истории диалога или статусе канала", "the message, route, or setting should appear in the queue, conversation history, or channel status", "mesaj, marşrut və ya ayar növbədə, söhbət tarixçəsində və ya kanal statusunda görünməlidir"),
    ),
    Support: p(
      l("тикеты, SLA, эскалации, база знаний, агенты и сервисные обязательства", "tickets, SLAs, escalations, knowledge base, agents, and service commitments", "ticketlər, SLA-lar, eskalasiyalar, bilik bazası, agentlər və servis öhdəlikləri"),
      l("приоритет, SLA, очередь, агент, канал, статус клиента и просроченные обращения", "priority, SLA, queue, agent, channel, customer status, and overdue requests", "prioritet, SLA, növbə, agent, kanal, müştəri statusu və gecikmiş müraciətlər"),
      l("открыть обращение или правило, назначить ответственного и подготовить следующий сервисный шаг", "open a request or rule, assign an owner, and prepare the next service step", "müraciəti və ya qaydanı açmaq, məsul təyin etmək və növbəti servis addımını hazırlamaq"),
      l("SLA-таймер, клиент, канал, тема, комментарии, макросы, эскалация и связанные материалы", "SLA timer, customer, channel, topic, comments, macros, escalation, and linked materials", "SLA taymeri, müştəri, kanal, mövzu, şərhlər, makrolar, eskalasiya və əlaqəli materiallar"),
      l("ответ клиенту, смена приоритета и эскалация должны быть понятны, потому что они влияют на SLA", "customer replies, priority changes, and escalations must be clear because they affect SLA", "müştəri cavabları, prioritet dəyişikliyi və eskalasiyalar aydın olmalıdır, çünki SLA-ya təsir edir"),
      l("тикет, правило или статья должны показать новый статус, ответственного, SLA или запись в истории", "the ticket, rule, or article should show the new status, owner, SLA, or history entry", "ticket, qayda və ya məqalə yeni statusu, sahibi, SLA-nı və ya tarixçə qeydini göstərməlidir"),
    ),
    Marketing: p(
      l("кампании, сегменты, события, шаблоны, источники и качество аудитории", "campaigns, segments, events, templates, sources, and audience quality", "kampaniyalar, segmentlər, tədbirlər, şablonlar, mənbələr və auditoriya keyfiyyəti"),
      l("аудитория, статус кампании, источник, период, канал, модель атрибуции и качество данных", "audience, campaign status, source, period, channel, attribution model, and data quality", "auditoriya, kampaniya statusu, mənbə, dövr, kanal, atribusiya modeli və məlumat keyfiyyəti"),
      l("создать или открыть маркетинговый объект, проверить аудиторию и подготовить тестовый запуск", "create or open a marketing object, review the audience, and prepare a test launch", "marketinq obyektini yaratmaq və ya açmaq, auditoriyanı yoxlamaq və test işə salma hazırlamaq"),
      l("сегмент, шаблон, канал, расписание, источник конверсии, отписки и предварительный просмотр", "segment, template, channel, schedule, conversion source, unsubscribes, and preview", "segment, şablon, kanal, cədvəl, konversiya mənbəyi, abunəlikdən çıxmalar və preview"),
      l("массовую коммуникацию нельзя запускать без проверки сегмента, отписок, шаблона и тестовой отправки", "mass communication should not launch without checking segment, unsubscribes, template, and test send", "kütləvi kommunikasiya segment, abunəlikdən çıxmalar, şablon və test göndərişi yoxlanmadan başladılmamalıdır"),
      l("кампания или сегмент должны обновить статус, счетчики аудитории, события или отчет по результату", "the campaign or segment should update status, audience counters, events, or result reporting", "kampaniya və ya segment statusu, auditoriya sayğaclarını, tədbirləri və ya nəticə hesabatını yeniləməlidir"),
    ),
    "Loyalty Program": p(
      l("участники, уровни, правила начисления, промокоды, POS-операции и балансы", "members, tiers, earn rules, promo codes, POS actions, and balances", "üzvlər, səviyyələr, qazanma qaydaları, promo kodlar, POS əməliyyatları və balanslar"),
      l("уровень, правило начисления, активность участника, промокод, POS-операция и период", "tier, earn rule, member activity, promo code, POS action, and period", "səviyyə, qazanma qaydası, üzv aktivliyi, promo kod, POS əməliyyatı və dövr"),
      l("создать или проверить правило лояльности, показать preview начисления и связать его с POS", "create or review a loyalty rule, show earning preview, and connect it to POS", "loyallıq qaydasını yaratmaq və ya yoxlamaq, qazanma preview-i göstərmək və POS ilə bağlamaq"),
      l("условие начисления, ограничение, участник, баланс, транзакция и журнал изменений", "earning condition, limit, member, balance, transaction, and change log", "qazanma şərti, limit, üzv, balans, tranzaksiya və dəyişiklik jurnalı"),
      l("баллы и промокоды влияют на клиентский баланс, поэтому тестируйте правило до включения", "points and promo codes affect customer balances, so test the rule before enabling it", "ballar və promo kodlar müştəri balansına təsir edir, buna görə qaydanı aktiv etmədən əvvəl test edin"),
      l("после проверки баланс, транзакция, уровень или POS-результат должны совпасть с правилом", "after checking, the balance, transaction, tier, or POS result should match the rule", "yoxlamadan sonra balans, tranzaksiya, səviyyə və ya POS nəticəsi qaydaya uyğun olmalıdır"),
    ),
    Finance: p(
      l("счета, бюджеты, цены, подписки, маржа, уведомления и финансовый контроль", "invoices, budgets, prices, subscriptions, margin, notifications, and financial control", "fakturalar, büdcələr, qiymətlər, abunələr, marja, bildirişlər və maliyyə nəzarəti"),
      l("период, клиент, сумма, статус оплаты, статья бюджета, валюта и центр ответственности", "period, customer, amount, payment status, budget line, currency, and responsibility center", "dövr, müştəri, məbləğ, ödəniş statusu, büdcə sətri, valyuta və məsuliyyət mərkəzi"),
      l("создать или открыть финансовый объект, проверить сумму, период и ответственного", "create or open a financial object, then check amount, period, and owner", "maliyyə obyektini yaratmaq və ya açmaq, məbləği, dövrü və sahibi yoxlamaq"),
      l("сумма, налог, валюта, клиент, план-факт, платежный статус и связанный документ", "amount, tax, currency, customer, plan-versus-actual, payment status, and linked document", "məbləğ, vergi, valyuta, müştəri, plan-fakt, ödəniş statusu və əlaqəli sənəd"),
      l("финансовые изменения требуют проверки суммы, периода, валюты, прав и влияния на отчетность", "financial changes require checking amount, period, currency, permissions, and reporting impact", "maliyyə dəyişiklikləri məbləğ, dövr, valyuta, icazələr və hesabat təsiri üzrə yoxlanmalıdır"),
      l("результат должен совпасть в списке, карточке, финансовом отчете или уведомлении", "the result should match the list, card, financial report, or notification", "nəticə siyahıda, kartda, maliyyə hesabatında və ya bildirişdə uyğun görünməlidir"),
    ),
    Analytics: p(
      l("метрики, отчеты, AI-рекомендации, фильтры и управленческие выводы", "metrics, reports, AI recommendations, filters, and management insights", "metrikalar, hesabatlar, AI tövsiyələri, filtrlər və idarəetmə nəticələri"),
      l("период, команда, источник, модуль, статус, сегмент и выбранный показатель", "period, team, source, module, status, segment, and selected metric", "dövr, komanda, mənbə, modul, status, segment və seçilmiş göstərici"),
      l("выбрать показатель или рекомендацию, открыть детализацию и подготовить управленческий вывод", "choose a metric or recommendation, open the detail, and prepare a management conclusion", "metrika və ya tövsiyə seçmək, detalı açmaq və idarəetmə nəticəsi hazırlamaq"),
      l("источник данных, фильтр, тренд, отклонение, drill-down и связанный операционный объект", "data source, filter, trend, variance, drill-down, and linked operational object", "məlumat mənbəyi, filtr, trend, fərq, drill-down və əlaqəli əməliyyat obyekti"),
      l("перед решением по цифрам нужно проверить период, источник и примененные фильтры", "before acting on numbers, check period, source, and applied filters", "rəqəmlərə əsasən qərar vermədən əvvəl dövr, mənbə və tətbiq edilmiş filtrlər yoxlanmalıdır"),
      l("вывод должен быть подтвержден графиком, таблицей, источником или историей решения", "the conclusion should be backed by a chart, table, source, or decision history", "nəticə qrafik, cədvəl, mənbə və ya qərar tarixçəsi ilə təsdiqlənməlidir"),
    ),
    "Route & Field": p(
      l("маршруты, визиты, агенты, фото, задания и проверки на местах", "routes, visits, agents, photos, tasks, and field checks", "marşrutlar, ziyarətlər, agentlər, fotolar, tapşırıqlar və sahə yoxlamaları"),
      l("агент, дата, маршрут, точка, статус визита, фото, категория и отклонение", "agent, date, route, location, visit status, photo, category, and exception", "agent, tarix, marşrut, nöqtə, ziyarət statusu, foto, kateqoriya və istisna"),
      l("открыть полевой объект, проверить данные визита и подготовить корректирующее действие", "open a field object, review visit data, and prepare a corrective action", "sahə obyektini açmaq, ziyarət məlumatını yoxlamaq və düzəldici əməliyyat hazırlamaq"),
      l("GPS, время, фото, агент, торговая точка, задача, заказ, отклонение и комментарий", "GPS, time, photo, agent, outlet, task, order, exception, and comment", "GPS, vaxt, foto, agent, satış nöqtəsi, tapşırıq, sifariş, istisna və şərh"),
      l("полевые данные нельзя утверждать без проверки времени, точки, фото и ответственного агента", "field data should not be approved without checking time, location, photo, and responsible agent", "sahə məlumatı vaxt, nöqtə, foto və məsul agent yoxlanmadan təsdiqlənməməlidir"),
      l("после действия статус визита, задача, отчет или карта должны показать обновленный результат", "after the action, visit status, task, report, or map should show the updated result", "əməliyyatdan sonra ziyarət statusu, tapşırıq, hesabat və ya xəritə yenilənmiş nəticəni göstərməlidir"),
    ),
    Settings: p(
      l("правила, пользователи, интеграции, ключи, права и параметры системы", "rules, users, integrations, keys, permissions, and system parameters", "qaydalar, istifadəçilər, inteqrasiyalar, açarlar, icazələr və sistem parametrləri"),
      l("модуль, роль, статус, владелец настройки, интеграция, ключ и область влияния", "module, role, status, setting owner, integration, key, and impact area", "modul, rol, status, ayar sahibi, inteqrasiya, açar və təsir sahəsi"),
      l("открыть настройку, изменить один параметр и сохранить только после проверки влияния", "open a setting, change one parameter, and save only after checking impact", "ayarı açmaq, bir parametr dəyişmək və təsiri yoxladıqdan sonra saxlamaq"),
      l("кто может менять настройку, какие модули она затрагивает, есть ли тест и можно ли откатить", "who can change the setting, which modules it affects, whether there is a test, and whether rollback is possible", "ayarı kimin dəyişə bildiyi, hansı modullara təsir etdiyi, testin olub-olmadığı və geri dönüşün mümkünlüyü"),
      l("настройки нельзя менять вслепую: сначала проверьте права, область влияния и тестовый режим", "settings should not be changed blindly: first check permissions, impact area, and test mode", "ayarlar kor-koranə dəyişdirilməməlidir: əvvəl icazələr, təsir sahəsi və test rejimi yoxlanmalıdır"),
      l("после сохранения статус, тест подключения, права или поведение модуля должны подтвердить изменение", "after saving, status, connection test, permissions, or module behavior should confirm the change", "saxladıqdan sonra status, bağlantı testi, icazələr və ya modul davranışı dəyişikliyi təsdiqləməlidir"),
    ),
  };

  const profile = defaults[g] || defaults.CRM;

  if (slug === "dashboard") return p(
    l("сводными KPI, активностью команды, воронкой, задачами и сигналами дня", "summary KPIs, team activity, pipeline health, tasks, and daily signals", "ümumi KPI-lar, komanda aktivliyi, pipeline sağlamlığı, tapşırıqlar və günlük siqnallar"),
    l("период, команда, pipeline, владелец и блоки с просроченными действиями", "period, team, pipeline, owner, and blocks with overdue actions", "dövr, komanda, pipeline, sahib və gecikmiş əməliyyat blokları"),
    l("открыть KPI или pipeline-блок и перейти к объекту, который требует внимания", "open a KPI or pipeline block and drill into the object that needs attention", "KPI və ya pipeline blokunu açmaq və diqqət tələb edən obyektə keçmək"),
    l("KPI, динамика, источник, связанная сделка или задача, последняя активность и владелец", "KPI, trend, source, linked deal or task, latest activity, and owner", "KPI, dinamika, mənbə, əlaqəli sövdələşmə və ya tapşırıq, son aktivlik və sahib"),
    l("дашборд не редактирует все напрямую, но по нему принимают решения, поэтому фильтры и период критичны", "the dashboard does not edit everything directly, but decisions are made from it, so filters and period are critical", "dashboard hər şeyi birbaşa redaktə etmir, amma qərarlar buradan verilir, ona görə filtrlər və dövr kritikdir"),
    l("переход из KPI должен привести к тому же объекту или списку, который объясняет цифру", "a KPI drill-down should lead to the object or list that explains the number", "KPI-dan keçid rəqəmi izah edən obyektə və ya siyahıya aparmalıdır"),
  );

  if (slug.includes("forecast")) return refine(profile, {
    focus: l("прогноз продаж, изменения pipeline, скорость сделок и отклонения от плана", "sales forecast, pipeline changes, deal velocity, and plan variance", "satış proqnozu, pipeline dəyişiklikləri, sövdələşmə sürəti və plan fərqləri"),
    action: l("выбрать период прогноза, проверить вклад сделок и объяснить изменение ожидаемой выручки", "select the forecast period, review deal contribution, and explain expected revenue movement", "proqnoz dövrünü seçmək, sövdələşmə təsirini yoxlamaq və gözlənilən gəlir dəyişikliyini izah etmək"),
    verify: l("итог должен совпасть с forecast snapshot, waterfall, velocity или настройками прогноза", "the result should match the forecast snapshot, waterfall, velocity view, or forecast settings", "nəticə forecast snapshot, waterfall, velocity görünüşü və ya proqnoz ayarları ilə uyğun olmalıdır"),
  });
  if (slug === "deals") return refine(profile, { focus: l("активными сделками, этапами pipeline, суммами, вероятностью и next steps", "active deals, pipeline stages, amounts, probability, and next steps", "aktiv sövdələşmələr, pipeline mərhələləri, məbləğlər, ehtimal və növbəti addımlar") });
  if (slug === "leads") return refine(profile, { focus: l("новыми лидами, источниками, score, статусом квалификации и конвертацией", "new leads, sources, score, qualification status, and conversion", "yeni lidlər, mənbələr, score, kvalifikasiya statusu və konversiya") });
  if (slug === "quotes") return refine(profile, { focus: l("коммерческими предложениями, позициями, скидками, статусом отправки и связью со сделкой", "quotes, line items, discounts, send status, and deal linkage", "təkliflər, sətir elementləri, endirimlər, göndəriş statusu və sövdələşmə bağlantısı") });
  if (slug === "sequences") return refine(profile, { focus: l("цепочками follow-up, шагами касания, паузами и ответственными менеджерами", "follow-up sequences, touch steps, pauses, and responsible managers", "follow-up ardıcıllıqları, toxunuş addımları, fasilələr və məsul menecerlər") });

  if (slug.includes("contract")) return defaults["Contracts Control"];
  if (slug.includes("approval")) return refine(defaults["Contracts Control"], {
    focus: l("правила согласования, делегаты, лимиты и маршрут утверждения", "approval rules, delegates, limits, and approval routing", "təsdiq qaydaları, nümayəndələr, limitlər və təsdiq marşrutu"),
    safety: l("маршрут согласования влияет на юридический контроль, поэтому тестируйте правило до включения", "approval routing affects legal control, so test the rule before enabling it", "təsdiq marşrutu hüquqi nəzarətə təsir edir, buna görə qaydanı aktiv etmədən əvvəl test edin"),
  });

  if (slug === "inbox") return refine(defaults.Communication, {
    focus: l("живыми клиентскими диалогами, очередями, каналами, агентами и непрочитанными сообщениями", "live customer conversations, queues, channels, agents, and unread messages", "canlı müştəri söhbətləri, növbələr, kanallar, agentlər və oxunmamış mesajlar"),
    action: l("открыть диалог, проверить клиента, назначить очередь и подготовить ответ без случайной отправки", "open a conversation, verify the customer, assign a queue, and prepare a reply without accidental sending", "söhbəti açmaq, müştərini yoxlamaq, növbə təyin etmək və təsadüfi göndəriş olmadan cavab hazırlamaq"),
  });
  if (slug === "ai-actions") return p(
    l("AI-сигналы, открытые риски, доказательства, теневые действия, очередь согласования и история решений", "AI signals, open risks, evidence, shadow actions, approval queue, and decision history", "AI siqnalları, açıq risklər, sübutlar, kölgə əməliyyatları, təsdiq növbəsi və qərar tarixçəsi"),
    l("критичность, модуль, владелец, тип действия, объект CRM и статус согласования", "severity, module, owner, action type, CRM object, and approval status", "kritiklik, modul, sahib, əməliyyat tipi, CRM obyekti və təsdiq statusu"),
    l("открыть риск, проверить доказательства, посмотреть dry-run preview и отправить действие в очередь", "open a risk, review evidence, inspect the dry-run preview, and send the action to the queue", "riski açmaq, sübutu yoxlamaq, dry-run preview-ə baxmaq və əməliyyatı növbəyə göndərmək"),
    l("причина риска, факты, источник, теневое действие, объект, preview изменений и кнопки одобрения", "risk reason, facts, source, shadow action, object, change preview, and approval controls", "risk səbəbi, faktlar, mənbə, kölgə əməliyyatı, obyekt, dəyişiklik preview-i və təsdiq düymələri"),
    l("AI ничего не должен выполнять до ручного одобрения; пользователь обязан отличить рекомендацию от реального действия", "AI should not execute anything before manual approval; the user must distinguish a recommendation from a real action", "AI əl təsdiqi olmadan heç nə icra etməməlidir; istifadəçi tövsiyəni real əməliyyatdan ayırmalıdır"),
    l("действие должно появиться в очереди, а после решения - в истории с понятным статусом исполнения", "the action should appear in the queue and, after a decision, in history with a clear execution status", "əməliyyat növbədə görünməli, qərardan sonra isə aydın icra statusu ilə tarixçəyə düşməlidir"),
  );
  if (slug === "inbox-automation") return p(
    l("automation-сценарии Inbox, триггеры входящих сообщений, очереди, safe mode, preview и журнал запусков", "Inbox automation scenarios, inbound triggers, queues, safe mode, preview, and run logs", "Inbox avtomatlaşdırma ssenariləri, gələn mesaj triggerləri, növbələr, safe mode, preview və icra jurnalları"),
    l("вкладки обзор, сборка, flows и runs; канал, очередь, статус сценария и последний запуск", "overview, builder, flows, and runs tabs; channel, queue, scenario status, and latest run", "overview, builder, flows və runs tabları; kanal, növbə, ssenari statusu və son icra"),
    l("создать безопасный маршрут: входящее сообщение назначается в очередь без автоматической отправки клиенту", "create a safe route where an inbound message is assigned to a queue without automatically replying to the customer", "gələn mesajın müştəriyə avtomatik cavab getmədən növbəyə təyin edildiyi təhlükəsiz marşrut yaratmaq"),
    l("trigger, выбранные каналы, очередь, preview пути, safe mode, node выполнения и run log", "trigger, selected channels, queue, path preview, safe mode, execution node, and run log", "trigger, seçilmiş kanallar, növbə, yol preview-i, safe mode, icra node-u və run log"),
    l("первый запуск должен идти через safe mode или тестовое сообщение; AI-ответ и live-send включаются только после проверки", "the first launch should use safe mode or a test message; AI reply and live send are enabled only after verification", "ilk işə salma safe mode və ya test mesajı ilə olmalıdır; AI cavabı və live-send yalnız yoxlamadan sonra aktiv edilir"),
    l("в Runs должно быть видно, какой сценарий сработал, какой диалог затронут и сколько шагов выполнено", "Runs should show which scenario fired, which conversation was touched, and how many steps completed", "Runs hansı ssenarinin işlədiyini, hansı söhbətə toxunduğunu və neçə addımın tamamlandığını göstərməlidir"),
  );
  if (slug.includes("automation")) return refine(defaults.Communication, {
    focus: l("automation-сценариями, триггерами, очередями, safe mode и журналом запусков", "automation scenarios, triggers, queues, safe mode, and run logs", "avtomatlaşdırma ssenariləri, triggerlər, növbələr, safe mode və icra jurnalları"),
    safety: l("первый запуск должен быть в safe mode или на тестовом сообщении, без случайного ответа клиенту", "the first run should be in safe mode or on a test message, without an accidental customer reply", "ilk işə salma safe mode-da və ya test mesajında olmalıdır, müştəriyə təsadüfi cavab getməməlidir"),
  });
  if (slug === "whatsapp-business-calls") return p(
    l("подключение WhatsApp Business Calling, Meta app, Phone Number ID, calls webhook, credentials и CRM-only smoke test", "WhatsApp Business Calling setup, Meta app, Phone Number ID, calls webhook, credentials, and CRM-only smoke test", "WhatsApp Business Calling qoşulması, Meta app, Phone Number ID, calls webhook, credentials və CRM-only smoke test"),
    l("сценарий подключения, готовность Meta, credentials, callback URL, verify token и smoke test", "setup scenario, Meta readiness, credentials, callback URL, verify token, and smoke test", "qoşulma ssenarisi, Meta hazırlığı, credentials, callback URL, verify token və smoke test"),
    l("выбрать сценарий, проверить Meta readiness, скопировать calls webhook и запустить только CRM-smoke", "choose the scenario, check Meta readiness, copy the calls webhook, and run only CRM smoke", "ssenarini seçmək, Meta readiness yoxlamaq, calls webhook-u kopyalamaq və yalnız CRM smoke başlatmaq"),
    l("access token, Phone Number ID, verify token, app secret, callback URL, подписка calls и результат smoke test", "access token, Phone Number ID, verify token, app secret, callback URL, calls subscription, and smoke test result", "access token, Phone Number ID, verify token, app secret, callback URL, calls abunəliyi və smoke test nəticəsi"),
    l("это не обычный VoIP; нельзя тестировать реальный звонок, пока credentials, webhook и CRM routing не прошли smoke test", "this is not regular VoIP; do not test a real call until credentials, webhook, and CRM routing pass the smoke test", "bu adi VoIP deyil; credentials, webhook və CRM routing smoke test-dən keçmədən real zəngi test etmək olmaz"),
    l("после smoke test в CRM должны появиться call log, routing result, временная media session и понятный статус проверки", "after the smoke test, CRM should show a call log, routing result, temporary media session, and clear verification status", "smoke test-dən sonra CRM-də call log, routing nəticəsi, müvəqqəti media session və aydın yoxlama statusu görünməlidir"),
  );
  if (slug === "channels" || slug.includes("whatsapp")) return refine(defaults.Communication, {
    focus: l("подключение каналов, credentials, webhooks, health status и безопасная проверка интеграции", "channel connection, credentials, webhooks, health status, and safe integration testing", "kanal qoşulması, credentials, webhook-lar, health status və təhlükəsiz inteqrasiya testi"),
    safety: l("ключи, токены и webhooks нельзя показывать лишним людям или проверять на реальных клиентах без smoke test", "keys, tokens, and webhooks should not be exposed or tested on real customers without a smoke test", "açarlar, tokenlər və webhook-lar artıq insanlara göstərilməməli və smoke test olmadan real müştəridə yoxlanmamalıdır"),
  });

  if (slug.includes("ticket") || slug.includes("sla") || slug.includes("escalation")) return defaults.Support;
  if (slug.includes("knowledge")) return refine(defaults.Support, {
    focus: l("статьи базы знаний, категории, поиск ответа и связь с обращениями", "knowledge articles, categories, answer search, and ticket linkage", "bilik bazası məqalələri, kateqoriyalar, cavab axtarışı və ticket bağlantısı"),
    action: l("найти или создать статью, проверить категорию и показать, как агент использует ее в ответе", "find or create an article, check its category, and show how an agent uses it in a reply", "məqaləni tapmaq və ya yaratmaq, kateqoriyanı yoxlamaq və agentin cavabda necə istifadə etdiyini göstərmək"),
  });

  if (slug.includes("campaign") || slug.includes("segment") || slug.includes("journey") || slug.includes("email") || slug.includes("attribution") || slug.includes("survey") || slug.includes("event") || slug.includes("landing") || slug.includes("scoring") || slug.includes("account-engagement") || slug.includes("cdp")) return defaults.Marketing;
  if (slug.includes("loyalty")) return defaults["Loyalty Program"];
  if (slug.includes("invoice") || slug.includes("budget") || slug.includes("finance") || slug.includes("profit") || slug.includes("pricing") || slug.includes("subscription")) return defaults.Finance;
  if (slug.includes("report") || slug.includes("analytics") || slug.includes("arena") || slug.includes("ai-command") || slug.includes("ai-actions")) return defaults.Analytics;
  if (slug.startsWith("mtm-")) return defaults["Route & Field"];
  if (g === "Settings") return defaults.Settings;
  if (g.endsWith("Cloud") || ["Public Sector", "Energy & Utilities"].includes(g)) return p(
    l("отраслевые карточки, статусы обслуживания, ответственные и регулируемые данные", "industry records, service statuses, owners, and regulated data", "sahə qeydləri, xidmət statusları, məsul şəxslər və tənzimlənən məlumatlar"),
    l("тип объекта, статус, владелец, регион, дата обновления и приоритет обслуживания", "object type, status, owner, region, update date, and service priority", "obyekt tipi, status, sahib, region, yenilənmə tarixi və xidmət prioriteti"),
    l("открыть отраслевую карточку, проверить обязательные поля и назначить следующий шаг", "open an industry card, check required fields, and assign the next step", "sahə kartını açmaq, məcburi sahələri yoxlamaq və növbəti addımı təyin etmək"),
    l("идентификатор, статус, владелец, связанные обращения, документы и история изменений", "identifier, status, owner, linked requests, documents, and change history", "identifikator, status, sahib, əlaqəli müraciətlər, sənədlər və dəyişiklik tarixçəsi"),
    l("отраслевые данные часто регулируются, поэтому права доступа и история изменений обязательны", "industry data is often regulated, so permissions and change history are mandatory", "sahə məlumatları çox vaxt tənzimlənir, buna görə icazələr və dəyişiklik tarixçəsi məcburidir"),
    l("карточка должна показать новый статус, ответственного или запись аудита", "the card should show the new status, owner, or audit entry", "kart yeni statusu, sahibi və ya audit qeydini göstərməlidir"),
  );

  return profile;
}

function refine(base, patch) {
  return { ...base, ...patch };
}

function validate(scenarios) {
  const locales = ["ru", "en", "az"];
  const failures = [];
  for (const [slug, scenario] of Object.entries(scenarios)) {
    for (const locale of locales) {
      const words = [
        scenario.title[locale],
        scenario.goal[locale],
        ...scenario.steps.map((step) => `${step.heading[locale]} ${step.voice[locale]}`),
      ].join(" ").split(/\s+/).filter(Boolean).length;
      if (words < minWords) failures.push(`${slug}/${locale}: ${words} words`);
    }
  }
  if (failures.length) {
    throw new Error(`Scenarios below ${minWords} words:\n${failures.join("\n")}`);
  }
}
