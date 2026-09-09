/**
 * Hand-authored, per-section guide scenarios (rich, real-UI walkthroughs).
 * produce-guides.mjs loads this; an entry here WINS over browser-guided.json.
 *
 * Shape: export default { "<slug>": { route, title{lang}, scenes:[
 *   { voice:{az,en,ru}, do: async (page, lang, h) => { ... } } ] } }
 *
 * h helpers move the VISIBLE cursor to a real element, then act:
 *   h.hover(sel) · h.click(sel) · h.moveTo(sel) · h.fill(sel,text) · h.sleep(ms)
 * A `sel` may be an array — the first selector that exists wins (fallback chain).
 *
 * Scene length == narration length (recorder holds each scene for its voice
 * duration). So "longer video" = longer narration + more scenes; "more cursor
 * engagement" = several h.* steps inside one `do` (they run in sequence after a
 * ~650 ms voice-lead). Keep ONE meaning-bearing action per scene so cursor and
 * narration stay in sync.
 *
 * ai-actions — RE-VERIFIED LIVE against prod-demo 2026-07-28 after the Advisor
 * redesign. What changed since the 2026-07-09 recording (the old scenario drove
 * a UI that no longer exists):
 *  - The page now exposes language-independent tour-id anchors for every block:
 *    ai-actions-header · ai-actions-kpis · ai-actions-flow · ai-actions-tabs ·
 *    ai-actions-rail · ai-actions-detail. Prefer these over text selectors.
 *  - Top TABS (role=tab) DO switch under automation now: «Bu gün» · «Soruş» ·
 *    «Modullar» · «Təsdiq növbəsi» · «Tarixçə». (The old note said they don't.)
 *  - MODULE CHIPS live in the rail and only exist on the «Bu gün» tab — switch
 *    back before using them. Labels stay ENGLISH in every UI locale ("Finance",
 *    "Sales", "Ticketing", "Contracts" + a count), so has-text is safe; a click
 *    re-filters and auto-selects that module's top signal into the detail.
 *  - The detail panel now holds SEVERAL queue buttons: the primary
 *    «Əsas addımı növbəyə əlavə et» plus a per-step «Növbəyə əlavə et».
 *  - Live demo evidence (2026-07-28) used in the narration:
 *      KPIs      80 open risks · 54 critical · 728,693 AZN at risk ·
 *                169 awaiting approval · 10 active modules · 0 execution errors
 *      Sales     "Firewall" stuck at LEAD 114 days (2,500 AZN)
 *      Finance   INV-TEST-001 — 15,000 USD unpaid 116 days
 *      Ticketing TK-0006 open 133 days → support escalation
 *      Queue     50 items, each with evidence + "what will be done" preview
 *      History   4 decisions, 4 executed
 *    Counters drift with the demo tenant, so the narration names the numbers
 *    only where they are structural (money at risk, pending approvals).
 *  - NEVER click «Təsdiqlə» in the queue: approving really executes the action.
 *    The cursor rests on it while the narration explains it — that is enough.
 */
const showDetail = (p) => p.evaluate(() => {
  const d = document.querySelector("[data-tour-id='ai-actions-detail']");
  if (d) d.scrollIntoView({ block: "start" }); else window.scrollTo(0, 320);
}).catch(() => {});
// Bring a block to the top of the frame (tabs/rail/queue live below the fold).
const showBlock = (p, tourId) => p.evaluate((id) => {
  document.querySelector(`[data-tour-id='${id}']`)?.scrollIntoView({ block: "start" });
}, tourId).catch(() => {});

const HEADER = ["[data-tour-id='ai-actions-header']", "main"];
const KPIS = ["[data-tour-id='ai-actions-kpis']", "main"];
const FLOW = ["[data-tour-id='ai-actions-flow']", "main"];
const RAIL = ["[data-tour-id='ai-actions-rail']", "main"];
const DETAIL = ["[data-tour-id='ai-actions-detail']", "main"];
// Primary "queue the main step" button, then the per-step one, then any button.
const ADD_TO_QUEUE = [
  "[data-tour-id='ai-actions-detail'] button:has-text('Növbəyə əlavə et')",
  "[data-tour-id='ai-actions-detail'] button:has-text('Add to queue')",
  "[data-tour-id='ai-actions-detail'] button:has-text('Добавить в очередь')",
  "[data-tour-id='ai-actions-detail'] button",
];
const tab = (az, en, ru) => [
  `[data-tour-id='ai-actions-tabs'] [role=tab]:has-text('${az}')`,
  `[role=tab]:has-text('${az}')`, `[role=tab]:has-text('${en}')`, `[role=tab]:has-text('${ru}')`,
];
const TAB_TODAY = tab("Bu gün", "Today", "Сегодня");
const TAB_ASK = tab("Soruş", "Ask", "Спросить");
const TAB_MODULES = tab("Modullar", "Modules", "Модули");
const TAB_QUEUE = tab("Təsdiq növbəsi", "Approval queue", "Очередь");
const TAB_HISTORY = tab("Tarixçə", "History", "История");
// A module chip inside the rail (English labels in every locale).
const chip = (name) => [`[data-tour-id='ai-actions-rail'] button:has-text('${name}')`, `main button:has-text('${name}')`];
// Nth KPI tile / nth step of the decision-flow strip — positional, so the
// cursor can walk them without depending on localized labels.
const kpiCard = (n) => [
  `[data-tour-id='ai-actions-kpis'] > section > div > div:nth-child(${n})`,
  `[data-tour-id='ai-actions-kpis'] div.grid > div:nth-child(${n})`,
  "[data-tour-id='ai-actions-kpis']",
];
// child[0] of the flow block is its heading row; child[1] is the 4-step grid.
const flowStep = (n) => [
  `[data-tour-id='ai-actions-flow'] > div:nth-child(2) > div:nth-child(${n})`,
  `[data-tour-id='ai-actions-flow'] > div:nth-child(2)`,
  "[data-tour-id='ai-actions-flow']",
];
// Whatever the active tab renders (Modules / Queue / History / Ask panels have
// no tour-id of their own, so anchor on the tabs block's sibling content).
// Only the active tabpanel has a box — the inactive ones are 0×0, and hovering
// a box-less node sends the cursor to the middle of the viewport.
const TAB_PANEL = ["[role=tabpanel]:visible", "[data-tour-id='ai-actions-tabs']", "main"];
// Approval-queue row internals. NEVER click the approve button — hovering it
// while the narration explains it is the whole point.
const QUEUE_EVIDENCE = [
  "main :text('Sübut və ön baxış')", "main :text('Evidence')", "main :text('Доказательства')",
  "[role=tabpanel]:visible", "main",
];
const QUEUE_APPROVE = [
  "main button:has-text('Təsdiqlə')", "main button:has-text('Approve')", "main button:has-text('Подтвердить')",
  "[role=tabpanel]:visible", "main",
];
// Switch module, then re-anchor the frame on the detail panel it just filled.
const switchModule = async (p, h, name) => {
  await h.click(chip(name));
  await h.sleep(900);
  await showDetail(p);
};

// ── ai-command-center (Da Vinci Command Center) ──────────────────────────────
// Verified LIVE against prod 2026-07-10. The two view tabs are real <button>s
// (clickable), but their labels are LOCALIZED (unlike ai-actions' English chips),
// so each selector lists az/en/ru. Scoped to `main` so the sidebar's own
// "Dashboard" nav item can't be matched by mistake. Universal anchors used where
// possible: CSAT/FCR (KPI acronyms), "Social AI Agent"/"Da Vinci Lite" (data),
// the 🛡️ emoji, and "2135" (log count).
const ACC_DASH_TAB = [
  "main button:has-text('İdarə paneli')", "main button:has-text('Dashboard')", "main button:has-text('Дашборд')",
];
const ACC_BUILDER_TAB = [
  "main button:has-text('Agent konstruktoru')", "main button:has-text('Agent Constructor')", "main button:has-text('Конструктор агентов')",
];
const ACC_CSAT = ["main :text('CSAT')", "main :text('FCR')"];
const ACC_ALERTS = ["main :text('Xəbərdarlıqlar')", "main :text('Alerts')", "main :text('Оповещения')"];
const ACC_MARKREAD = [
  "main button:has-text('Oxunmuş kimi işarələ')", "main button:has-text('Mark read')", "main button:has-text('Отметить прочитанным')",
];
const ACC_LOGS = ["main :text('2135')"];
const ACC_DETAILS = ["main button:has-text('Detallar')", "main button:has-text('Details')", "main button:has-text('Детали')"];
const ACC_CONFIG = ["main :text('Social AI Agent')", "main :text('Da Vinci Lite')"];
const ACC_RULES = [
  "main :text('🛡️')", "main :has-text('Qaydalar və məhdudiyyətlər')", "main :has-text('Rules')", "main :has-text('Правила и ограничения')",
];
const ACC_NEWRULE = ["main button:has-text('Yeni qayda')", "main button:has-text('New rule')", "main button:has-text('Новое правило')"];
const ACC_GENDESC = [
  "main :has-text('Təsvirlə konfiqurasiya yarat')", "main :has-text('from description')", "main :has-text('по описанию')",
];
const ACC_NEWCONFIG = [
  "main button:has-text('Yeni konfiqurasiya')", "main button:has-text('New configuration')", "main button:has-text('Новая конфигурация')",
];

// ── deals (Sales Pipeline) ───────────────────────────────────────────────────
// Verified LIVE against prod 2026-07-10. This page HAS stable data-tour-id
// anchors (language-independent): deals-summary (Da Vinci funnel metrics),
// deals-kanban (the "Kanban" view toggle button), deals-card (a deal card),
// deals-new (the "New Deal" button). Stage filter chips are localized buttons.
const DEALS_SUMMARY = ["[data-tour-id='deals-summary']", "main"];
const DEALS_KANBAN_BTN = ["[data-tour-id='deals-kanban']", "main button:has-text('Kanban')"];
const DEALS_CARD = ["[data-tour-id='deals-card']", "[data-tour-id='deals-kanban']"];
const DEALS_NEW = ["[data-tour-id='deals-new']", "main button:has-text('Yeni sövdələşmə')", "main button:has-text('New Deal')", "main button:has-text('Новая сделка')"];
const DEALS_PROPOSAL = ["main button:has-text('Təklif')", "main button:has-text('Proposal')", "main button:has-text('Предложение')"];
const DEALS_WON = ["main button:has-text('Qazanıldı')", "main button:has-text('Won')", "main button:has-text('Выиграна')"];

// ── deal-detail (a single deal's page) ───────────────────────────────────────
// Verified LIVE against prod 2026-07-10. Rich page with stable, language-
// independent data-tour-id anchors: deal-stage-progress (stage stepper),
// deal-ai-prediction (win probability/confidence), deal-ai-suggestions (Advisor
// risk — "stalled 86 days, overdue"), deal-quick-actions (Note/Task/Email
// composer), deal-sidebar (linked entities accordions), deal-timeline (history).
// Only the composer tabs + accordions are localized; anchors are tour-ids.
const DD_STAGE = ["[data-tour-id='deal-stage-progress']", "main"];
const DD_AIPRED = ["[data-tour-id='deal-ai-prediction']", "main"];
const DD_AISUG = ["[data-tour-id='deal-ai-suggestions']", "[data-tour-id='deal-ai-prediction']"];
const DD_QUICK = ["[data-tour-id='deal-quick-actions']", "main"];
const DD_SIDEBAR = ["[data-tour-id='deal-sidebar']", "main"];
const DD_TIMELINE = ["[data-tour-id='deal-timeline']", "main"];
const DD_TASK = ["[data-tour-id='deal-quick-actions'] button:has-text('Tapşırıq')", "main button:has-text('Tapşırıq')", "main button:has-text('Task')", "main button:has-text('Задача')"];
const DD_EMAIL = ["[data-tour-id='deal-quick-actions'] button:has-text('E-poçt')", "main button:has-text('E-poçt')", "main button:has-text('Email')"];
const DD_COMPETITORS = ["[data-tour-id='deal-sidebar'] button:has-text('Rəqiblər')", "main button:has-text('Rəqiblər')", "main button:has-text('Competitors')", "main button:has-text('Конкуренты')"];

// New (2026-07-19) anchors for the MEDDPICC qualification + polished deal card.
// Verified LIVE on the uxtest stand 2026-07-19: all card anchors present; list
// toggle + MEDDPICC column + sort present. DATA-dependent (need a demo tenant
// with MEDDPICC-scored deals + the named pipeline stages): DEALS_MEDD_CHIP and
// the stage-filter chips — otherwise they render empty. MEDDPICC tab label is
// language-independent; the suggest/status/save are localized (az/en/ru).
const DEALS_LIST_BTN = ["main button:has-text('Список')", "main button:has-text('List')", "main button:has-text('Siyahı')"];
const DEALS_MEDD_CHIP = ["[data-tour-id='deals-card'] span[title*='метрики']", "span[title*='метрики']", "span[title*='Metrics']"];
const DEALS_MEDD_COL = ["th:has-text('MEDDPICC')", "main"];
const DD_KPI = ["[data-tour-id='deal-kpi-chips']", "main"];
const DD_TAB_MEDD = ["main button:has-text('MEDDPICC')"];
const DD_TAB_FEED = ["main button:has-text('Лента')", "main button:has-text('Lent')", "main button:has-text('Feed')"];
const DD_MEDD_SUGGEST = ["main button:has-text('Предложить из переписки')", "main button:has-text('Suggest from correspondence')", "main button:has-text('Yazışmadan təklif et')"];
const DD_MEDD_STATUS = ["main :text('Не оценено')", "main :text('Not assessed')", "main :text('Qiymətləndirilməyib')", "main"];
const DD_ADVISOR = ["main :text('Риск Advisor')", "main :text('Da Vinci')", "[data-tour-id='deal-ai-suggestions']"];

// ── MTM: Routes & Field (overview panel + live map) ──────────────────────────
// Verified LIVE against prod 2026-07-10. No page-specific tour-ids; anchored on
// localized button/label text (az/en/ru) + the universal .leaflet-container.
// Overview KPI labels: az/en confirmed live; ru uses standard translations with
// a `main` fallback. Period toggle + map status filters + heatmap are real,
// non-mutating drives.
const MTM_OFFROUTE = ["main :text('Marşrutdan kənar')", "main :text('Off-Route')", "main :text('Вне маршрута')"];
const MTM_PENDING = ["main :text('Gözləyən tapşırıqlar')", "main :text('Pending Tasks')", "main :text('Ожидающие задачи')"];
const MTM_TIMEMETRICS = ["main :text('Zaman metrikaları')", "main :text('Time Metrics')", "main :text('Метрики времени')"];
const MTM_AGENTS = ["main :text('Aktiv agentlər')", "main :text('Active Agents')", "main :text('Активные агенты')"];
const MTM_WEEK = ["main button:has-text('Bu həftə')", "main button:has-text('This Week')", "main button:has-text('Эта неделя')"];
const MTM_MONTH = ["main button:has-text('Bu ay')", "main button:has-text('This Month')", "main button:has-text('Этот месяц')"];
const MTM_NEWAGENT = ["main button:has-text('Yeni agent')", "main button:has-text('New Agent')", "main button:has-text('Новый агент')"];
// Live map
const MAP_CONTAINER = [".leaflet-container", "main"];
const MAP_ALL = ["main button:has-text('Hamısı')", "main button:has-text('All')", "main button:has-text('Все')"];
const MAP_OFFLINE = ["main button:has-text('Oflayn')", "main button:has-text('Offline')", "main button:has-text('Офлайн')"];
const MAP_HEATMAP = ["main button:has-text('İstilik xəritəsi')", "main button:has-text('Heatmap')", "main button:has-text('Тепловая карта')"];
const MAP_GEOFENCE = ["main button:has-text('Geozona')", "main button:has-text('Geofence')", "main button:has-text('Геозона')"];

// ── MTM routes + visits ──────────────────────────────────────────────────────
// Verified LIVE 2026-07-10. List pages, no page tour-ids; localized status-chip
// + button labels (az/en/ru); universal anchors: route name data, "GPS" header.
const RT_INPROGRESS = ["main button:has-text('Davam edir')", "main button:has-text('In Progress')", "main button:has-text('В процессе')"];
const RT_PLANNED = ["main button:has-text('Planlaşdırılmış')", "main button:has-text('Planned')", "main button:has-text('Запланирован')"];
const RT_ALL = ["main button:has-text('Hamısı')", "main button:has-text('All')", "main button:has-text('Все')"];
const RT_ADD = ["main button:has-text('Marşrut əlavə et')", "main button:has-text('Add Route')", "main button:has-text('Добавить маршрут')"];
const RT_TEMPLATES = ["main button:has-text('Şablonlar')", "main button:has-text('Templates')", "main button:has-text('Шаблоны')"];
const RT_CARD = ["main :text('ADV-DEMO Baku retail route')", "main :text('IN_PROGRESS')", "main"];
const VS_TABLE = ["main table", "main :text('GPS')", "main"];
const VS_GPS = ["main :text('GPS')", "main table", "main"];
const VS_CHECKEDOUT = ["main button:has-text('Tamamlanmış')", "main button:has-text('Checked Out')", "main button:has-text('Завершён')"];
const VS_LOG = ["main button:has-text('Ziyarət qeyd et')", "main button:has-text('Log Visit')", "main button:has-text('Записать визит')"];
// Interactive: edit pencil (lucide Pencil) opens the same form modal pre-filled;
// the route name input is the first text field in the create modal.
const RT_EDIT = ["main button:has(svg.lucide-pencil)", "main button:has(svg.lucide-square-pen)"];
const VS_EDIT = ["main button:has(svg.lucide-pencil)", "main button:has(svg.lucide-square-pen)"];
// The create/edit modal is a custom overlay (NOT role=dialog, ignores Escape),
// so close it via its Cancel button (portal → unscoped selector).
const MODAL_CANCEL = ["button:has-text('Ləğv et')", "button:has-text('Cancel')", "button:has-text('Отмена')"];

// ── MTM routes: detailed Azerbaijani guide (2026-08) ───────────────────────
// These selectors deliberately use stable test ids from the current routes
// workspace. The guide is recorded only with the dedicated [QA-SWISSMED]
// acceptance principal and fixtures; it never needs a customer employee's
// account or data.
const ROUTE_GUIDE_VIEW_CALENDAR = ["[data-testid='mtm-routes-view-calendar']"];
const ROUTE_GUIDE_MORE_VIEWS = ["[data-testid='mtm-routes-more-views-toggle']"];
const ROUTE_GUIDE_VIEW_LIST = ["[data-testid='mtm-routes-view-list']"];
const ROUTE_GUIDE_VIEW_WEEK = ["[data-testid='mtm-routes-view-week']"];
const ROUTE_GUIDE_BUILDER_OPEN = ["[data-testid='mtm-route-builder-open']"];
const ROUTE_GUIDE_BUILDER = ["[data-testid='mtm-route-builder']"];
const ROUTE_GUIDE_OPTIONAL = ["[data-testid='mtm-route-optional-settings'] summary"];
const ROUTE_GUIDE_DOCTORS = ["[data-route-target-direction='DOCTOR']"];
const ROUTE_GUIDE_PHARMACIES = ["[data-route-target-direction='PHARMACY']"];
const ROUTE_GUIDE_CANDIDATE = ["[data-testid='mtm-route-candidate']:visible"];
const ROUTE_GUIDE_INLINE_OPEN = ["[data-testid='mtm-route-inline-assignment-open']"];
const ROUTE_GUIDE_INLINE_PANEL = ["[data-testid='mtm-route-inline-assignment']"];
const ROUTE_GUIDE_FINISH_CUSTOMERS = ["[data-testid='mtm-route-primary-action']"];
const ROUTE_GUIDE_AUTO_SCHEDULE = ["[data-testid='mtm-route-auto-schedule']"];
const ROUTE_GUIDE_SAVE_DRAFT = ["[data-testid='mtm-route-save-draft']"];
const ROUTE_GUIDE_DETAIL = ["[data-testid='mtm-route-detail']"];
const ROUTE_GUIDE_PUBLISH = ["[data-testid='mtm-route-publish']"];
const ROUTE_GUIDE_DYNAMIC_NAME = "[QA-SWISSMED] Video guide creation proof";
const ROUTE_GUIDE_SEEDED_NAME = "[QA-SWISSMED] Video guide draft";
const ROUTE_GUIDE_INLINE_CODE = "QA-SWM-UNASSIGNED-CLINIC";
const ROUTE_GUIDE_INLINE_NAME = "[QA-SWISSMED] Unassigned Clinic";

function routeGuideDateKey() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 35);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function routeGuideCandidateResponse(response, { agentId, date, direction }) {
  try {
    const url = new URL(response.url());
    return response.ok()
      && url.pathname === "/api/v1/mtm/routes/candidates"
      && url.searchParams.get("agentId") === agentId
      && url.searchParams.get("startDate") === date
      && url.searchParams.get("direction") === direction;
  } catch {
    return false;
  }
}

async function removeRouteGuideDrafts(page, date, name) {
  const result = await page.evaluate(async ({ guideDate, guideName }) => {
    const listResponse = await fetch(`/api/v1/mtm/routes?date=${encodeURIComponent(guideDate)}&limit=50`);
    const listPayload = await listResponse.json().catch(() => null);
    if (!listResponse.ok || !Array.isArray(listPayload?.data?.routes)) return { ok: false, reason: `list_${listResponse.status}` };
    const matches = listPayload.data.routes.filter((route) => route?.name === guideName);
    const protectedRoute = matches.find((route) => route?.status !== "DRAFT");
    if (protectedRoute) return { ok: false, reason: `unexpected_${protectedRoute.status}` };
    for (const route of matches) {
      const response = await fetch(`/api/v1/mtm/routes/${encodeURIComponent(route.id)}`, { method: "DELETE" });
      if (!response.ok) return { ok: false, reason: `delete_${response.status}` };
    }
    return { ok: true };
  }, { guideDate: date, guideName: name });
  if (!result?.ok) throw new Error(`route_guide_cleanup_${result?.reason || "failed"}`);
}

async function chooseRouteGuideAgentAndDate(page, h) {
  const select = page.locator("#route-builder-primary");
  const dateInput = page.locator("#route-builder-date");
  await select.waitFor({ state: "visible", timeout: 15000 });
  const agentId = await select.locator("option").evaluateAll((options) => (
    options.find((option) => option.textContent?.includes("[QA-SWISSMED] Field Agent"))?.value || ""
  ));
  if (!agentId) throw new Error("route_guide_qa_agent_missing");
  const date = routeGuideDateKey();
  await removeRouteGuideDrafts(page, date, ROUTE_GUIDE_DYNAMIC_NAME);
  await h.moveTo(["#route-builder-date"]);
  await dateInput.fill(date);
  const candidatesReady = page.waitForResponse((response) => routeGuideCandidateResponse(response, {
    agentId,
    date,
    direction: "ORGANIZATION",
  }), { timeout: 20000 });
  await h.moveTo(["#route-builder-primary"]);
  await select.selectOption(agentId);
  await candidatesReady;
  return { agentId, date };
}

async function openRouteGuideCustomersStep(page, h) {
  await h.click(ROUTE_GUIDE_FINISH_CUSTOMERS);
  await page.getByTestId("mtm-route-customer-picker").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(ROUTE_GUIDE_CANDIDATE[0]).first().waitFor({ state: "visible", timeout: 20000 });
}

async function assignRouteGuideInlineCustomer(page, h) {
  const customerSearch = page.locator("#route-builder-customer-search");
  await h.fill(["#route-builder-customer-search"], ROUTE_GUIDE_INLINE_CODE);

  // Re-running the guide is idempotent: once its customer has been assigned,
  // the route picker exposes that customer directly and no recovery panel is
  // needed. Keep the recorded flow aligned with whichever valid state exists.
  await page.waitForFunction(({ candidateName }) => {
    const candidateVisible = [...document.querySelectorAll('[data-testid="mtm-route-candidate"]')]
      .some((element) => element.textContent?.includes(candidateName));
    const assignmentRecoveryVisible = document.querySelector('[data-testid="mtm-route-inline-assignment-open"]');
    return candidateVisible || assignmentRecoveryVisible;
  }, { candidateName: ROUTE_GUIDE_INLINE_NAME }, { timeout: 15000 });

  const existingCandidate = page.getByTestId("mtm-route-candidate")
    .filter({ hasText: ROUTE_GUIDE_INLINE_NAME })
    .first();
  if (await existingCandidate.isVisible()) {
    await h.click([`[data-testid='mtm-route-candidate']:has-text('${ROUTE_GUIDE_INLINE_NAME}')`]);
    await customerSearch.fill("");
    return;
  }

  await h.click(ROUTE_GUIDE_INLINE_OPEN);

  const panel = page.locator(ROUTE_GUIDE_INLINE_PANEL[0]);
  await panel.waitFor({ state: "visible", timeout: 15000 });
  await h.fill(["#route-inline-assignment-search"], ROUTE_GUIDE_INLINE_CODE);
  const item = panel.getByTestId("mtm-route-inline-assignment-item")
    .filter({ hasText: ROUTE_GUIDE_INLINE_NAME })
    .first();
  await item.waitFor({ state: "visible", timeout: 15000 });
  const assigned = page.waitForResponse((response) => {
    try {
      return response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/v1/mtm/field-assignments";
    } catch {
      return false;
    }
  }, { timeout: 25000 });
  await h.click(`[data-testid='mtm-route-inline-assignment-item']:has-text('${ROUTE_GUIDE_INLINE_NAME}') [data-testid='mtm-route-inline-assignment-add']`);
  const response = await assigned;
  if (!response.ok()) throw new Error(`route_guide_inline_assignment_${response.status()}`);
  await panel.waitFor({ state: "hidden", timeout: 15000 });
  await customerSearch.fill("");
}

async function addRouteGuideCandidate(page, h, direction) {
  const agentId = await page.locator("#route-builder-primary").inputValue();
  const date = await page.locator("#route-builder-date").inputValue();
  const candidatesReady = page.waitForResponse((response) => routeGuideCandidateResponse(response, {
    agentId,
    date,
    direction,
  }), { timeout: 20000 });
  await h.click(direction === "DOCTOR" ? ROUTE_GUIDE_DOCTORS : ROUTE_GUIDE_PHARMACIES);
  await candidatesReady;
  await page.locator(ROUTE_GUIDE_CANDIDATE[0]).first().waitFor({ state: "visible", timeout: 20000 });
  await h.click(ROUTE_GUIDE_CANDIDATE);
  await page.locator(`${ROUTE_GUIDE_CANDIDATE[0]}:disabled`).first().waitFor({ state: "visible", timeout: 10000 });
}

async function saveRouteGuideDraft(page, h) {
  const created = page.waitForResponse((response) => {
    try {
      return response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/mtm/routes";
    } catch {
      return false;
    }
  }, { timeout: 25000 });
  await h.click(ROUTE_GUIDE_SAVE_DRAFT);
  const response = await created;
  const payload = await response.json().catch(() => null);
  if (!response.ok() || typeof payload?.data?.id !== "string") {
    throw new Error(`route_guide_draft_save_${response.status()}`);
  }
  await page.getByTestId("mtm-route-builder").waitFor({ state: "hidden", timeout: 25000 });
  await page.getByTestId("mtm-route-detail").waitFor({ state: "visible", timeout: 15000 });
  await page.evaluate((routeId) => { window.__leaddriveRouteGuideDraftId = routeId; }, payload.data.id);
}

async function removeCreatedRouteGuideDraft(page) {
  const result = await page.evaluate(async () => {
    const routeId = window.__leaddriveRouteGuideDraftId;
    if (!routeId) return { ok: false, reason: "id_missing" };
    const response = await fetch(`/api/v1/mtm/routes/${encodeURIComponent(routeId)}`, { method: "DELETE" });
    return response.ok ? { ok: true } : { ok: false, reason: `delete_${response.status}` };
  });
  if (!result?.ok) throw new Error(`route_guide_created_draft_cleanup_${result?.reason || "failed"}`);
}

async function openSeededRouteGuideDraft(page, h) {
  const listView = page.getByTestId("mtm-routes-view-list");
  if (!(await listView.isVisible())) await h.click(ROUTE_GUIDE_MORE_VIEWS);
  await h.click(ROUTE_GUIDE_VIEW_LIST);
  const search = page.getByTestId("mtm-route-list-search");
  await search.waitFor({ state: "visible", timeout: 15000 });
  await h.fill(["[data-testid='mtm-route-list-search']"], ROUTE_GUIDE_SEEDED_NAME);
  const row = page.locator(`[data-testid='mtm-route-list-item']:has-text('${ROUTE_GUIDE_SEEDED_NAME}')`).first();
  await row.waitFor({ state: "visible", timeout: 15000 });
  await h.click(`[data-testid='mtm-route-list-item']:has-text('${ROUTE_GUIDE_SEEDED_NAME}') [data-testid^='mtm-route-open-']`);
  await page.getByTestId("mtm-route-detail").waitFor({ state: "visible", timeout: 15000 });
}

async function publishSeededRouteGuideDraft(page, h) {
  const published = page.waitForResponse((response) => {
    try {
      return response.request().method() === "POST" && /\/api\/v1\/mtm\/routes\/[^/]+\/publish$/.test(new URL(response.url()).pathname);
    } catch {
      return false;
    }
  }, { timeout: 25000 });
  await h.click(ROUTE_GUIDE_PUBLISH);
  const response = await published;
  if (!response.ok()) throw new Error(`route_guide_publish_${response.status()}`);
  await page.getByTestId("mtm-route-publish").waitFor({ state: "hidden", timeout: 15000 });
}
// ── MTM field tasks (kanban) ────────────────────────────────────────────────
// Verified LIVE 2026-07-10. Kanban board (To Do/In Progress/Completed), cards
// with priority + agent + "Start →" status move. Add/Edit open the same modal
// (title, agent, customer, priority, status, due date, description).
const TK_ADD = ["main button:has-text('Tapşırıq əlavə et')", "main button:has-text('Add Task')", "main button:has-text('Добавить задачу')"];
const TK_START = ["main button:has-text('Start')"];
const TK_EDIT = ["main button:has(svg.lucide-pencil)", "main button:has(svg.lucide-square-pen)"];
const TK_PENDING = ["main :text('Gözləyən')", "main :text('Pending')", "main :text('Ожидают')"];

// ── MTM photos (review wall) ────────────────────────────────────────────────
// Verified LIVE 2026-07-10 against 6 seeded demo photos (2 pending / 3 approved
// / 1 rejected, GPS-stamped). Status filters are localized <button>s with a
// count; view-mode toggles are icon-only (lucide layout-grid / columns /
// check-square); the "Export" button label is hardcoded English in every
// locale. Photo cards are the only `div.cursor-pointer` in main. Per-card
// Approve/Reject show only on PENDING cards — matched by EXACT text (:text-is)
// so "Approve" can't collide with the "Approved" filter or "Approve All".
const PH_TITLE = ["main h1", "main h2", "main"];
const PH_STATS = ["main :text('Cəmi şəkil')", "main :text('Total Photos')", "main :text('Всего фото')", "main"];
const PH_ALL = ["main button:has-text('Hamısı')", "main button:has-text('All')", "main button:has-text('Все')"];
const PH_PENDING = ["main button:has-text('Yoxlamada')", "main button:has-text('Pending')", "main button:has-text('На проверке')"];
const PH_APPROVED_FILTER = ["main button:has-text('Təsdiqlənmiş')", "main button:has-text('Approved')", "main button:has-text('Одобрено')"];
// NB: lucide 0.577 renders `Columns`→lucide-columns-2 and `CheckSquare`→
// lucide-square-check-big (verified on the live DOM), NOT the plain names.
const PH_GALLERY = ["main button:has(svg.lucide-layout-grid)"];
const PH_COMPARE = ["main button:has(svg.lucide-columns-2)", "main button:has(svg.lucide-columns2)"];
const PH_BATCH = ["main button:has(svg.lucide-square-check-big)", "main button:has(svg.lucide-check-square)"];
const PH_EXPORT = ["main button:has-text('Export')", "main button:has(svg.lucide-download)"];
const PH_APPROVE = ['main button:text-is("Təsdiq et")', 'main button:text-is("Approve")', 'main button:text-is("Одобрить")'];
const PH_REJECT = ['main button:text-is("Rədd et")', 'main button:text-is("Reject")', 'main button:text-is("Отклонить")'];
const PH_CARD1 = ["main div.cursor-pointer >> nth=0", "main img"];
const PH_CARD2 = ["main div.cursor-pointer >> nth=1", "main img >> nth=1"];
const PH_CARD3 = ["main div.cursor-pointer >> nth=2", "main img >> nth=2"];
// nth=2 / nth=3 are colorful promo/display shots (the two newest are plain white
// receipts) — used for the compare scene so the side-by-side is visually distinct.
const PH_CARD4 = ["main div.cursor-pointer >> nth=3", "main img >> nth=3"];
// Demo photo ids kept PENDING so scene 6's real approve/reject is reproducible
// across the az/en/ru runs (restored via the app's own PATCH after the clicks).
// Full pending queue (24-photo demo wall: 10 approved / 4 rejected / 10 pending);
// scene 6 flips the two newest, restore resets the whole queue back to PENDING.
const PH_PENDING_IDS = [
  "cmrfdj23r01o650l8gyq4mxpr", "cmrfdj1z001o050l8p732ngu9", "cmrfdj1dx01ne50l8x7rqh3v0",
  "cmrfdj12h01n050l8ojd9n81o", "cmrfdj0pu01mm50l8lnos6v9z", "cmrfdj0f501m850l8xq6m1l88",
  "cmrfdizo001le50l8ajba9f58", "cmrfdiza801l250l8n3lov8o9", "cmrfdiyr101km50l8zewpgike",
];
const restorePending = (p) => p.evaluate(async (ids) => {
  for (const id of ids) {
    try { await fetch(`/api/v1/mtm/photos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "PENDING" }) }); } catch { /* demo reseeded → id gone, harmless */ }
  }
}, PH_PENDING_IDS).catch(() => {});

// ── MTM alerts (field watchdog) ─────────────────────────────────────────────
// Verified LIVE 2026-07-11 against 21 real auto-generated alerts (18 unresolved:
// 17 WARNING + 1 CRITICAL; 3 resolved). Default view = unresolved only (the
// "Show All" toggle reveals resolved + fills the Resolved count). Filter buttons
// are localized <button>s with a count; the Resolve button = lucide-circle-check
// + localized text (matched EXACT via :text-is). Alert cards are the direct
// children of the `space-y-2` list.
const AL_TITLE = ["main h1", "main h2", "main"];
const AL_STATS = ["main :text('Cəmi xəbərdarlıq')", "main :text('Total Alerts')", "main :text('Всего оповещений')", "main"];
const AL_RESOLVED_STAT = ["main :text('Həll edilmiş')", "main :text('Resolved')", "main :text('Решённых')", "main"];
// NB: match the "(count)" paren so the "All" filter button is not confused with
// the "Show All" toggle (both contain "All"); "All (" hits only the filter.
const AL_ALL = ["main button:has-text('Hamısı (')", "main button:has-text('All (')", "main button:has-text('Все (')"];
const AL_CRITICAL = ["main button:has-text('Kritik (')", "main button:has-text('Critical (')", "main button:has-text('Критически')"];
const AL_SHOWALL = ["main button:has-text('Hamısını göstər')", "main button:has-text('Show All')", "main button:has-text('Показать все')"];
const AL_RESOLVE = ['main button:text-is("Həll et")', 'main button:text-is("Resolve")', 'main button:text-is("Решить")', "main button:has(svg.lucide-circle-check)"];
const AL_CARD = ["main div.space-y-2 > div.rounded-lg", "main div.space-y-2 > div", "main"];
// Redesigned (grouped) list: alerts are grouped by type into collapsible cards;
// the group header is a <button> (chevron + icon + human label + count + severity
// + a one-line "what to do"). This selector = the first group's header button.
const AL_GROUP_BTN = ["main div.space-y-3 > div > button", "main div.space-y-3 button", "main"];
// Top unresolved alert ids — scene 5 resolves the newest, restore un-resolves
// them so the az/en/ru runs each start from the same 18-unresolved state.
const AL_UNRESOLVED_IDS = [
  "cmqwy3652001b50h76juemgv7", "cmqtjs08u04x850bccn0rpbxp", "cmqtjs08m04x650bco6icf0y7",
  "cmq6smxr802fv5014k4ojw3ib", "cmq6ddqvl00105049qxmb4lm6", "cmq6dbayz00095049h72cjoj1",
  "cmq6cumne018950gvd82tx2yf", "cmp56rhgv002r50v3qrpks825",
];
const restoreAlerts = (p) => p.evaluate(async (ids) => {
  for (const id of ids) {
    try { await fetch(`/api/v1/mtm/alerts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isResolved: false }) }); } catch { /* id gone → harmless */ }
  }
}, AL_UNRESOLVED_IDS).catch(() => {});

// ── MTM agents (field-team command center) ──────────────────────────────────
// Verified LIVE 2026-07-11 against the redesigned page: 4 stat cards, filters
// (All / Online / Active / …), agents grouped by manager (h3 headers) into
// cards; each card = last-seen + weekly snapshot + role/status/app badges +
// call/WhatsApp/map/visits quick actions. Online state is time-decayed (10-min
// window) so lastSeenAt is refreshed to "now" right before recording.
const AG_TITLE = ["main h1", "main h2", "main"];
const AG_STATS = ["main div.grid.grid-cols-2 > div", "main"];
const AG_ONLINE = ["main button:has-text('В сети')", "main button:has-text('Online')", "main button:has-text('Onlayn')"];
const AG_ALLF = ["main button:has-text('Все (')", "main button:has-text('All (')", "main button:has-text('Hamısı (')"];
const AG_CARD = ["main div.rounded-lg.border.bg-card.p-4", "main"];
const AG_ACTIONS = ["main a[href^='tel:']", "main div.rounded-lg.border.bg-card.p-4", "main"];
const AG_GROUP = ["main :text('Farid Aliyev')", "main h3", "main"];
// Add-agent button (lucide Plus = language-independent); first card edit pencil.
// The form is a Radix Dialog — MODAL_CANCEL (or Escape) closes it.
const AG_ADD = ["main button:has(svg.lucide-plus)", "main button:has-text('Добавить агента')", "main button:has-text('Add Agent')", "main button:has-text('Agent əlavə et')"];
const AG_EDIT = ["main button:has(svg.lucide-pencil)", "main button:has(svg.lucide-square-pen)"];

// ── leads (Lead management) ─────────────────────────────────────────────────
// Verified LIVE against prod-demo 2026-07-28 (probe + source read):
//  - Anchors: leads-list (title + counter), leads-score (avg score / hot leads),
//    leads-status-filter (the status chips), leads-convert (the kanban board in
//    card view, the <tbody> in table view).
//  - Views: «Analitika» and «Siyahı» stay on /leads. «Anlayışlar» NAVIGATES
//    AWAY to /contacts?entity=leads — never click it inside this guide.
//  - Kanban card: the card itself routes to /leads/<id>; its footer icon
//    buttons are convert (the only one carrying a title attribute), edit and
//    delete. Cards drag between status columns — narrated, not performed, since
//    the recorder has no drag helper.
//  - Convert opens LeadConvertDialog (deal title · stage with probability ·
//    value). We open it and press Cancel — nothing is ever converted.
//  - The new-lead modal is NOT role=dialog; close it with the Cancel button.
//  - Live demo data: 43 leads · avg 34/100 · 3 converted · pipeline ₼384K ·
//    TikTok = 81% of sources; qualified holds "Vahid Kasımoğlu / Memarlıq
//    şirkəti" at $350,000; search "Rauf" → "Rauf Cold Advisor / ADV-DEMO
//    Dormant Prospect" 37/100, $9,000. Counters drift with the demo tenant, so
//    the narration leans on structure rather than exact totals.
const btn = (az, en, ru) => [
  `main button:has-text('${az}')`, `main button:has-text('${en}')`, `main button:has-text('${ru}')`,
];
const LEADS_HEAD = ["[data-tour-id='leads-list']", "main"];
const LEADS_SCORE = ["[data-tour-id='leads-score']", "main"];
const LEADS_FILTER = ["[data-tour-id='leads-status-filter']", "main"];
const LEADS_BOARD = ["[data-tour-id='leads-convert']", "main"];
const LEADS_CHIP_QUALIFIED = btn("Kvalifikasiya edildi", "Qualified", "Квалифицирован");
const LEADS_CHIP_ALL = btn("Hamısı", "All", "Все");
const LEADS_NEW = btn("Yeni lid", "New Lead", "Новый лид");
const LEADS_ANALYTICS = btn("Analitika", "Analytics", "Аналитика");
const LEADS_SEARCH = [
  "main input[placeholder*='axtarış']", "main input[placeholder*='Search leads']",
  "main input[placeholder*='Поиск лидов']", "main input >> nth=1",
];
// The three filter dropdowns, left to right: category · source · sort.
const leadsSelect = (n) => [`main select >> nth=${n}`, "[data-tour-id='leads-status-filter']", "main"];
// Only the convert control carries a title attribute inside a card.
const LEADS_CONVERT_BTN = [
  "[data-tour-id='leads-convert'] button[title]", "[data-tour-id='leads-convert'] button", "main",
];

// ── lead-rules (automatic lead assignment) ──────────────────────────────────
// Verified LIVE against prod-demo 2026-07-29 (probe + source read):
//  - Anchors: lead-rules-header · lead-rules-new · lead-rules-kpis ·
//    lead-rules-list (the last one only exists once ≥1 rule is saved).
//  - A rule card shows: active/inactive badge, method badge, "Prioritet: N",
//    the conditions as `field operator "value"`, the assignees, and the
//    activate / edit (pencil) / delete (trash) controls.
//  - The editor is INLINE (no modal): name · priority (number, smaller runs
//    first) · description · method select (condition | round_robin) ·
//    condition rows (field select: source, estimated_value, interest,
//    company_size, country, industry — operator select: ==, !=, >=, <=,
//    contains, starts_with — value input) · "Şərt Əlavə Et" · assignees input ·
//    Save / Cancel. We open it and always leave via Cancel.
//  - Engine (src/lib/lead-assignment.ts): only ACTIVE rules run, in ascending
//    priority; every condition of a rule must match; the first matching rule
//    wins; several assignees on one rule → round-robin between them; a rule
//    with no assignees is skipped. That is what the narration explains.
const LR_HEADER = ["[data-tour-id='lead-rules-header']", "main"];
const LR_KPIS = ["[data-tour-id='lead-rules-kpis']", "main"];
// Nth counter card inside the KPI grid (total · active · assignees).
const kpiTile = (n) => [
  `[data-tour-id='lead-rules-kpis'] > div:nth-child(${n})`,
  `[data-tour-id='lead-rules-kpis'] div:nth-child(${n})`,
  "[data-tour-id='lead-rules-kpis']",
];
const LR_LIST = ["[data-tour-id='lead-rules-list']", "main"];
const LR_NEW = ["[data-tour-id='lead-rules-new']", "main button:has-text('Qayda')", "main button:has-text('Add Rule')", "main button:has-text('Добавить правило')"];
// The spare, still-empty rule sits last (highest priority number), so its
// pencil is the one we open — the demo edits it and always leaves via Cancel.
const LR_EDIT_LAST = ["main button:has(svg.lucide-pencil) >> nth=-1", "main button:has(svg.lucide-square-pen) >> nth=-1", "[data-tour-id='lead-rules-list']"];
const LR_SAVE = ["main button:has-text('Yadda saxla')", "main button:has-text('Save')", "main button:has-text('Сохранить')"];
// A saved rule's card and the chips inside it (1-based, priority order).
const ruleCard = (n) => [`[data-tour-id='lead-rules-list'] > div:nth-child(${n})`, "[data-tour-id='lead-rules-list']"];
// The condition is a monospace chip; the assignees are outline badges.
const ruleCondition = (n) => [`[data-tour-id='lead-rules-list'] > div:nth-child(${n}) div.font-mono`, `[data-tour-id='lead-rules-list'] > div:nth-child(${n})`];
const ruleAssignee = (n) => [`[data-tour-id='lead-rules-list'] > div:nth-child(${n}) div.flex-wrap > *`, `[data-tour-id='lead-rules-list'] > div:nth-child(${n})`];
// Editor fields, in DOM order after the page-level AI search box.
const LR_NAME = ["main input >> nth=1", "main"];
const LR_PRIORITY = ["main input[type=number]", "main input >> nth=2", "main"];
const LR_VALUE = ["main input[placeholder='Dəyər']", "main input[placeholder='Value']", "main input[placeholder='Значение']", "main input >> nth=4", "main"];
// Move the cursor onto a <select>, then actually switch it — a native dropdown
// list never shows up in a recording, but the changed value does.
const pickOption = async (h, sel, value) => {
  await h.moveTo(sel);
  const loc = await h.firstLocator(sel);
  await loc?.selectOption(value).catch(() => {});
  await h.sleep(450);
};
// Inside the inline editor: [0] method · [1] condition field · [2] operator.
const lrSelect = (n) => [`main select >> nth=${n}`, "[data-tour-id='lead-rules-list']", "main"];
const LR_ADD_COND = ["main button:has-text('Şərt Əlavə Et')", "main button:has-text('Add condition')", "main button:has-text('Добавить условие')"];
const LR_ASSIGNEES = [
  "main input[placeholder*='Həsənov']", "main input[placeholder*='Doe']", "main input[placeholder*='Иванов']",
  "main input[type=text] >> nth=-1", "main",
];

// ── quotes (customer-facing proposals) ──────────────────────────────────────
// Verified LIVE against prod-demo 2026-07-29 (probe + i18n read):
//  - NO data-tour-id anchors on either page, so everything hangs off the
//    localized labels below plus the table structure.
//  - List: status chips (All · Draft · Sent · Viewed · Accepted · Rejected ·
//    Expired), a search box (number / deal / notes) and the table
//    (number · deal · status · lines · total · valid-until · created).
//  - Detail: header (number + status) → "All quotes" back link → actions
//    (mark sent · mark expired · Save · PDF · Delete) → customer/deal binding →
//    "Advisor risk" card → the line-item table (product · type · SKU ·
//    description · qty · unit price · discount · line total) with "Add line" →
//    quote-level discount (None / Amount / %) → Summary (subtotal, discount,
//    total).
//  - MUTATION SAFETY: Save, Delete and both "mark as …" buttons are only
//    hovered, never clicked. "Add line" appends an empty row in local state
//    only — nothing reaches the server unless Save is pressed, and it isn't.
//  - Demo data: ADV-DEMO-Q-001 (18,800 AZN, Viewed) and q-2026-v333
//    (2 lines, 16,060 AZN) — the guide opens the latter because it has lines.
const qLabel = (az, en, ru) => [
  `main button:has-text('${az}')`, `main button:has-text('${en}')`, `main button:has-text('${ru}')`,
];
const Q_TITLE = ["main h1", "main"];
const Q_CHIPS = ["main button:has-text('Qaralama')", "main button:has-text('Draft')", "main button:has-text('Черновик')", "main"];
const Q_CHIP_VIEWED = qLabel("Baxıldı", "Viewed", "Просмотрено");
const Q_CHIP_ALL = qLabel("Hamısı", "All", "Все");
const Q_NEW = qLabel("Yeni təklif", "New Quote", "Новое предложение");
const Q_SEARCH = [
  "main input[placeholder*='axtarış']", "main input[placeholder*='Search quote']",
  "main input[placeholder*='Поиск по номеру']", "main input >> nth=1",
];
const Q_TABLE = ["main table", "main"];
const Q_ROW = (n) => [`main table tbody tr:nth-child(${n})`, "main table", "main"];
// Detail page.
const QD_HEAD = ["main h1", "main"];
const QD_BACK = qLabel("Bütün təkliflər", "All quotes", "Все предложения");
const QD_MARK_SENT = qLabel("Göndərilmiş kimi", "Mark as sent", "Отметить отправленным");
const QD_PDF = qLabel("PDF", "PDF", "PDF");
const QD_SAVE = qLabel("Yadda saxla", "Save", "Сохранить");
const QD_CUSTOMER = ["main input[placeholder*='Sövdələşmə']", "main input[placeholder*='Link a deal']", "main input[placeholder*='Привязать сделку']", "main"];
const QD_RISK = ["main :text('Advisor riski')", "main :text('Advisor risk')", "main :text('Риск Advisor')", "main"];
const QD_LINES = ["main table", "main"];
const QD_ADD_LINE = qLabel("Sətir əlavə et", "Add line", "Добавить позицию");
const QD_TYPE_SELECT = ["main table select >> nth=0", "main select >> nth=0", "main"];
const QD_SUMMARY = ["main :text('Yekun')", "main :text('Summary')", "main :text('Итого')", "main"];
const QD_DISCOUNT = ["main :text('Bütün təklif üzrə endirim')", "main :text('Quote-level discount')", "main :text('Скидка на всё предложение')", "main"];

// ── sequences (the manager's touch cadence) ─────────────────────────────────
// Verified LIVE against prod-demo 2026-07-29 (probe + i18n read):
//  - No data-tour-id anchors; everything hangs off localized labels.
//  - Page order: header → "Touches today" queue (daily-limit control) → stats
//    row (total enrollments · active touches · reply rate · meetings · touches
//    to reply) → the "Analytics" toggle → search → the sequence cards.
//  - A card expands via ITS OWN chevron. The analytics block is also a
//    div.rounded-xl with a chevron, so the card selector is scoped by the
//    "enroll" button, which only real sequence cards carry.
//  - Expanded card = tabs "Steps" / "Participants". Steps read like
//    "#1 Email — <subject> — same day", "#2 Call — … — +4 days".
//  - Analytics = rep leaderboard + step funnel (how far enrollments got).
//  - MUTATION SAFETY: enroll, deactivate, edit and delete are only hovered.
//    The queue's Done / No answer / Skip buttons are never touched.
//  - This is the manager's CADENCE (a human performs each touch) — NOT the
//    marketing autopilot in Journeys. The narration keeps that line sharp.
const sq = (az, en, ru) => [
  `main button:has-text('${az}')`, `main button:has-text('${en}')`, `main button:has-text('${ru}')`,
];
const sqText = (az, en, ru) => [`main :text('${az}')`, `main :text('${en}')`, `main :text('${ru}')`, "main"];
const SQ_HEAD = ["main h1", "main"];
const SQ_QUEUE = sqText("Bu günkü toxunuşlar", "Touches today", "Касания на сегодня");
const SQ_LIMIT = sq("Gündəlik limit", "Daily limit", "Дневной лимит");
const SQ_STATS = sqText("Aktiv toxunuşlar", "Active touches", "Активные касания");
const SQ_REPLY = sqText("Cavab payı", "Reply rate", "Ответили");
const SQ_ANALYTICS = sq("Analitika", "Analytics", "Аналитика");
const SQ_LEADERBOARD = sqText("Menecer reytinqi", "Rep leaderboard", "Рейтинг менеджеров");
const SQ_FUNNEL = sqText("Addım huni", "Step funnel", "Воронка по шагам");
const SQ_SEARCH = ["main input[placeholder*='Ardıcıllıq']", "main input[placeholder*='Search sequences']", "main input[placeholder*='Поиск серий']", "main input >> nth=1"];
const SQ_NEW = sq("Yeni ardıcıllıq", "New Sequence", "Новая серия");
// A real sequence card is the only rounded block carrying an "enroll" button.
const SQ_CARD = [
  "main div.rounded-xl:has(button:has-text('Qeyd et'))",
  "main div.rounded-xl:has(button:has-text('Enroll'))",
  "main div.rounded-xl:has(button:has-text('Записать'))",
  "main",
];
const SQ_CARD_TOGGLE = [
  "main div.rounded-xl:has(button:has-text('Qeyd et')) button:has(svg.lucide-chevron-right)",
  "main div.rounded-xl:has(button:has-text('Enroll')) button:has(svg.lucide-chevron-right)",
  "main div.rounded-xl:has(button:has-text('Записать')) button:has(svg.lucide-chevron-right)",
  "main",
];
const SQ_TAB_STEPS = sq("Addımlar", "Steps", "Шаги");
const SQ_TAB_PARTICIPANTS = sq("İştirakçılar", "Participants", "Участники");
const SQ_ENROLL = sq("Qeyd et", "Enroll", "Записать");
const SQ_DEACTIVATE = sq("Deaktiv et", "Deactivate", "Деактивировать");

// ── forecast (the quarter's revenue forecast) ───────────────────────────────
// Verified LIVE against prod-demo 2026-07-29: no data-tour-id anchors and no
// mutating controls at all — the page only reads. Layout: quarter tabs
// (Q1…Q4) → three headline numbers (committed · best case · weighted
// pipeline) → the quota card (attainment % and amount vs target) → a 6-month
// revenue chart (actual vs forecast) → per-manager attainment → per-pipeline
// totals (deal count, total, weighted). Demo data: quota Q3 at 18%
// (84K of 470K), one rep over target at 105% while most sit under 10%,
// Default Sales holding 20 deals worth 1.4M with 423K weighted.
// `:text-is` (exact) first: the page subtitle repeats "Committed / Best case /
// Pipeline forecast" as one line, so a loose :text() match would put the cursor
// on the subtitle instead of the KPI card.
const fc = (az, en, ru) => [
  `main :text-is('${az}')`, `main :text-is('${en}')`, `main :text-is('${ru}')`,
  `main :text('${az}')`, `main :text('${en}')`, `main :text('${ru}')`, "main",
];
const FC_TITLE = ["main h1", "main"];
const FC_COMMITTED = fc("Təsdiqlənmiş", "Committed", "Подтверждено");
const FC_BEST = fc("Ən yaxşı ssenari", "Best Case", "Лучший сценарий");
const FC_PIPELINE = fc("Huni (çəkili)", "Pipeline (weighted)", "Воронка (взвеш.)");
const FC_QUOTA = fc("Kvota", "Quota", "Квота");
const FC_CHART = fc("Gəlir proqnozu", "Revenue Forecast", "Прогноз выручки");
const FC_MANAGERS = fc("Menecerlər üzrə", "By Managers", "По менеджерам");
const FC_PIPELINES = fc("Hunilər üzrə", "By Pipelines", "По воронкам");
const fcQuarter = (q) => [`main button:has-text('Q${q}')`, "main"];

// ── forecast sub-pages (snapshots · waterfall · velocity) ───────────────────
// Verified LIVE against prod-demo 2026-07-29. None of the three has
// data-tour-id anchors, so labels below come from the i18n bundles.
//  - snapshots: a table of point-in-time captures (captured · period ·
//    committed · best case · forecast · deals) plus "Take snapshot now" and a
//    per-row delete. BOTH mutate — hovered, never clicked.
//  - waterfall: period tabs (7 / 30 / 90 / 180 / all), headline numbers
//    (total transitions 10 · net change +1.1M · biggest move "advanced (5)
//    +900K"), a bar chart by transition type and the table
//    created / advanced / regressed / won / lost / reopened / reassigned.
//  - velocity: period tabs, a bottleneck banner ("Negotiation" holds slow
//    deals for 66 days), a "how to read this" card, and per-stage cards with
//    typical time, slow-deal time, advance rate and entered/exited counts.
const FS_TITLE = ["main h1", "main"];
const FS_TAKE = [
  "main button:has-text('Anlıq görüntü çək')", "main button:has-text('Take Snapshot')",
  "main button:has-text('Сделать снимок')", "main",
];
const FS_TABLE = ["main table", "main"];
const FS_ROW = (n) => [`main table tbody tr:nth-child(${n})`, "main table", "main"];
const WF_PERIOD = (az, en, ru) => [`main button:has-text('${az}')`, `main button:has-text('${en}')`, `main button:has-text('${ru}')`, "main"];
const WF_30 = WF_PERIOD("Son 30 gün", "Last 30 days", "30 дней");
const WF_ALL = WF_PERIOD("Bütün dövr", "All time", "Всё время");
const WF_TOTAL = fc("Ümumi keçidlər", "Total transitions", "Всего переходов");
const WF_NET = fc("Xalis dəyişiklik", "Net change", "Чистое изменение");
const WF_BIGGEST = fc("Ən böyük hərəkət", "Biggest move", "Наибольшее движение");
const WF_CHART = fc("Keçid növünə görə", "By transition type", "По типу перехода");
const WF_TABLE = ["main table", "main"];
const VL_BANNER = fc("ləngidir", "slowing sales", "замедляет");
const VL_HOWTO = fc("Bu ekranı necə oxumalı", "How to read this page", "Как читать этот экран");
const VL_STAGES = fc("Mərhələlər üzrə vaxt", "Time by stage", "Время по этапам");
const VL_SHOW_DEALS = [
  "main button:has-text('Sövdələri göstər')", "main button:has-text('Show deals')",
  "main button:has-text('Показать сделки')", "main",
];
const VL_90 = WF_PERIOD("Son 90 gün", "Last 90 days", "90 дней");

// ── pipelines · quotas · territories (the sales setup trio) ─────────────────
// Verified LIVE against prod-demo 2026-07-29.
//  - pipelines (/settings/pipelines): anchor `pipelines-header`; pipeline tabs
//    ("Default Sales ★ (25)", "SMM (1)", …), "Add pipeline", the stage list
//    with its probability per stage (Lead 10% → Qualified 25% → Proposal 50%
//    → Negotiation 75% → Won 100% / Lost 0%) and "Add stage".
//  - quotas (/settings/quotas): anchors quotas-header · quotas-year ·
//    quotas-form · quotas-list; year tabs 2025–2027, a manager select, a
//    quarter select, an amount field and "Add".
//  - territories (/settings/territories): anchors territories-header ·
//    territories-new · territories-stats · territories-list; cards per
//    territory with member counts and a pause/resume control.
//  - MUTATION SAFETY: "Add pipeline", "Add stage", "Add" (quota), "New
//    territory" and pause/resume are hovered only. Nothing is submitted.
const pqt = (az, en, ru) => [
  `main button:has-text('${az}')`, `main button:has-text('${en}')`, `main button:has-text('${ru}')`, "main",
];
const pqtText = (az, en, ru) => [
  `main :text-is('${az}')`, `main :text-is('${en}')`, `main :text-is('${ru}')`,
  `main :text('${az}')`, `main :text('${en}')`, `main :text('${ru}')`, "main",
];
const PL_HEADER = ["[data-tour-id='pipelines-header']", "main h1", "main"];
const PL_TAB_DEFAULT = ["main button:has-text('Default Sales')", "main button", "main"];
const PL_TAB_SECOND = ["main button:has-text('SMM')", "main button", "main"];
const PL_ADD_PIPELINE = pqt("Huni əlavə et", "Add Pipeline", "Добавить воронку");
const PL_STAGE_LEAD = ["main button:has-text('LEAD')", "main button:has-text('Лид')", "main"];
const PL_STAGE_WON = ["main button:has-text('WON')", "main button:has-text('QAZANILDI')", "main"];
const PL_ADD_STAGE = pqt("Mərhələ əlavə et", "Add Stage", "Добавить стадию");
const QT_HEADER = ["[data-tour-id='quotas-header']", "main h1", "main"];
const QT_YEAR = ["[data-tour-id='quotas-year']", "main"];
const QT_FORM = ["[data-tour-id='quotas-form']", "main"];
const QT_LIST = ["[data-tour-id='quotas-list']", "main"];
const QT_MANAGER = ["[data-tour-id='quotas-form'] select >> nth=0", "main select >> nth=0", "main"];
const QT_QUARTER = ["[data-tour-id='quotas-form'] select >> nth=1", "main select >> nth=1", "main"];
const QT_AMOUNT = ["[data-tour-id='quotas-form'] input[type=number]", "main input[type=number]", "main"];
const QT_ADD = pqt("Əlavə et", "Add", "Добавить");
const TR_HEADER = ["[data-tour-id='territories-header']", "main h1", "main"];
const TR_STATS = ["[data-tour-id='territories-stats']", "main"];
const TR_LIST = ["[data-tour-id='territories-list']", "main"];
const TR_NEW = ["[data-tour-id='territories-new']", ...pqt("Yeni ərazi", "New Territory", "Новая территория")];
const TR_PAUSE = pqt("Dayandır", "Pause", "Приостановить");

// ── web-to-lead · sales-forecast settings ───────────────────────────────────
// Verified LIVE against prod-demo 2026-07-29.
//  - web-to-lead: anchors web-to-lead-header · -config · -endpoint · -embed ·
//    -preview. Config holds the org slug, form title, button text, redirect URL
//    and the field toggles (name* · email* · phone · company · message); then
//    the public endpoint (POST /api/v1/public/leads, CORS on, 10 requests per
//    minute per IP), the copy-paste embed snippet and a live preview.
//    MUTATION SAFETY: the preview's Submit button would create a real lead and
//    the field chips write config — both are hovered only. "Copy" is safe
//    (clipboard) but we don't need it either.
//  - sales-forecast settings: anchors sales-forecast-header · -controls ·
//    -save · -grid. The grid is the yearly revenue plan per service line
//    (8 services × 12 months) with a VAT toggle, a year select, export buttons
//    and Save. Every cell is an editable input — the guide never types into
//    them and never clicks Save.
const W2L_HEADER = ["[data-tour-id='web-to-lead-header']", "main h1", "main"];
const W2L_CONFIG = ["[data-tour-id='web-to-lead-config']", "main"];
const W2L_ENDPOINT = ["[data-tour-id='web-to-lead-endpoint']", "main"];
const W2L_EMBED = ["[data-tour-id='web-to-lead-embed']", "main"];
const W2L_PREVIEW = ["[data-tour-id='web-to-lead-preview']", "main"];
const SF_HEADER = ["[data-tour-id='sales-forecast-header']", "main h1", "main"];
const SF_CONTROLS = ["[data-tour-id='sales-forecast-controls']", "main"];
const SF_SAVE = ["[data-tour-id='sales-forecast-save']", "main"];
const SF_GRID = ["[data-tour-id='sales-forecast-grid']", "main"];

// ── boards (team task boards) ───────────────────────────────────────────────
// Verified LIVE against prod-demo 2026-07-29. No data-tour-id anchors.
//  - /boards lists the boards as cards ("Görüşlər 0 tasks", "sosial media 50
//    tasks") plus "New board". The substance is INSIDE a board, so the guide
//    opens the one that actually holds tasks.
//  - /boards/<id>: a board switcher select, Export, "New task", the view
//    toggles (Board · List · Reports), filter row (assigned to me · created by
//    me · type · event/line · priority · assignee) and the kanban columns with
//    task cards (key like HHH-51, due date, progress %, assignee avatar).
//  - MUTATION SAFETY: "New board", "New task" and Export are hovered only;
//    cards are never dragged (a drag would change a task's column).
const bd = (az, en, ru) => [
  `main button:has-text('${az}')`, `main button:has-text('${en}')`, `main button:has-text('${ru}')`, "main",
];
const BD_TITLE = ["main h1", "main"];
const BD_CARD_WITH_TASKS = ["main :text('sosial media')", "main a", "main"];
const BD_NEW_BOARD = bd("Yeni Lövhə", "New Board", "Новая доска");
const BD_NEW_TASK = bd("Yeni Tapşırıq", "New Task", "Новая задача");
const BD_VIEW_BOARD = bd("Lövhə", "Board", "Доска");
const BD_VIEW_REPORTS = bd("Hesabatlar", "Reports", "Отчёты");
const BD_ASSIGNED_ME = bd("Mənə təyin olunanlar", "Assigned to me", "Назначенные мне");
const BD_SWITCHER = ["main select >> nth=0", "main"];
const BD_FILTER_TYPE = ["main select >> nth=1", "main"];
const BD_FILTER_PRIORITY = ["main select >> nth=3", "main select >> nth=2", "main"];
const BD_COLUMNS = ["main :text('BACKLOG')", "main :text('Backlog')", "main"];

export default {
  boards: {
    route: "/boards",
    title: { az: "Lövhələr", en: "Boards", ru: "Доски" },
    scenes: [
      {
        voice: {
          az: "Lövhələr — komandanın işini apardığı yerdir. Sövdələşmələr və lidlər satışın vəziyyətini göstərir, lövhələr isə konkret işi: kim nə edir, hansı mərhələdədir və nə vaxta bitməlidir. Hər şöbənin öz lövhəsi olur, ona görə marketinqin işi satışın lövhəsini doldurmur.",
          en: "Boards are where the team actually does the work. Deals and leads show the state of sales; boards show the concrete work: who is doing what, at which stage and by when. Each unit gets its own board, so marketing's work doesn't clutter the sales board.",
          ru: "Доски — это место, где команда собственно делает работу. Сделки и лиды показывают состояние продаж, а доски — конкретную работу: кто что делает, на какой стадии и к какому сроку. У каждого отдела своя доска, поэтому работа маркетинга не засоряет доску продаж.",
        },
        do: async (p, l, h) => {
          await h.hover(BD_TITLE);
          await h.holdUntil(0.45);
          await h.moveTo(BD_CARD_WITH_TASKS);
          await h.holdUntil(0.8);
          await h.moveTo(BD_NEW_BOARD);
        },
      },
      {
        voice: {
          az: "Siyahıda hər lövhənin adı və içindəki tapşırıq sayı göstərilir. Lövhələr iki cür olur: şöbə lövhəsi tapşırıqları saxlayır, departament isə şöbələri birləşdirən konteynerdir — onun öz tapşırığı yoxdur, amma hesabatları yığır. Beləcə struktur şirkətin real quruluşunu təkrarlayır.",
          en: "The list shows each board's name and how many tasks it holds. Boards come in two kinds: a section board holds tasks, while a department is a container that groups sections — it has no tasks of its own but aggregates their reports. That way the structure mirrors how the company is actually organised.",
          ru: "В списке у каждой доски видно название и число задач внутри. Доски бывают двух видов: доска-отдел хранит задачи, а департамент — контейнер, объединяющий отделы: своих задач у него нет, но он собирает их отчёты. Так структура повторяет реальное устройство компании.",
        },
        do: async (p, l, h) => {
          await h.hover(BD_CARD_WITH_TASKS);
          await h.holdUntil(0.5);
          await h.moveTo(BD_NEW_BOARD);
          await h.holdUntil(0.82);
          await h.hover(BD_CARD_WITH_TASKS);
        },
      },
      {
        voice: {
          az: "Lövhəni açırıq. İçəridə klassik kanban: sütunlar işin mərhələləridir, kartlar isə tapşırıqlar. Kartda ən vacibi göz önündədir — tapşırığın nömrəsi, adı, son tarixi, icra faizi və məsul şəxsin nişanı. Kartı sütundan sütuna sürükləyəndə tapşırığın statusu dəyişir.",
          en: "We open a board. Inside is a classic kanban: the columns are the stages of work and the cards are the tasks. The card puts the essentials in plain sight — the task key, its title, the due date, the progress percentage and the assignee's avatar. Drag a card from column to column and the task's status changes.",
          ru: "Открываем доску. Внутри классический канбан: колонки — стадии работы, карточки — задачи. На карточке главное на виду: номер задачи, название, срок, процент выполнения и значок ответственного. Перетащите карточку из колонки в колонку — статус задачи изменится.",
        },
        do: async (p, l, h) => {
          await h.click(BD_CARD_WITH_TASKS);
          await h.sleep(2200);
          await h.holdUntil(0.6);
          await h.hover(BD_COLUMNS);
          await h.holdUntil(0.88);
          await h.moveTo(BD_COLUMNS);
        },
      },
      {
        voice: {
          az: "Yuxarıdakı süzgəclər lövhəni sizin işinizə çevirir. «Mənə təyin olunanlar» — yalnız sizin tapşırıqlarınız. Sonra tip: tapşırıq, xəta, yeni funksiya, epik. Sonra prioritet — kritikdən aşağıya. Və məsul şəxs. Əlli tapşırığın içindən beş dənə qalır, məhz sizin bu gün etməli olduğunuz.",
          en: "The filters at the top turn the board into your own work list. “Assigned to me” — only your tasks. Then the type: task, bug, feature, epic. Then the priority, from critical down. And the assignee. Out of fifty tasks five remain — exactly the ones you have to do today.",
          ru: "Фильтры сверху превращают доску в ваш личный список. «Назначенные мне» — только ваши задачи. Дальше тип: задача, баг, фича, эпик. Дальше приоритет — от критического вниз. И исполнитель. Из пятидесяти задач остаётся пять — ровно те, что нужно сделать сегодня.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BD_ASSIGNED_ME);
          await h.holdUntil(0.35);
          await h.moveTo(BD_FILTER_TYPE);
          await h.holdUntil(0.62);
          await h.moveTo(BD_FILTER_PRIORITY);
          await h.holdUntil(0.88);
          await h.hover(BD_COLUMNS);
        },
      },
      {
        voice: {
          az: "Yanında görünüş rejimləri var. «Lövhə» — kanban, işi mərhələ üzrə görmək üçün. «Siyahı» — cədvəl, çoxlu tapşırığı sıralayıb müqayisə etmək üçün. «Hesabatlar» — komandanın yükü və icra dinamikası. Eyni məlumat, üç fərqli sual üçün üç fərqli baxış.",
          en: "Next to them are the view modes. “Board” is the kanban, for seeing work by stage. “List” is a table, for sorting and comparing many tasks at once. “Reports” shows the team's load and how execution is trending. The same data, three views for three different questions.",
          ru: "Рядом режимы отображения. «Доска» — канбан, чтобы видеть работу по стадиям. «Список» — таблица, чтобы сортировать и сравнивать много задач сразу. «Отчёты» — нагрузка команды и динамика выполнения. Одни и те же данные, три вида под три разных вопроса.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BD_VIEW_BOARD);
          await h.holdUntil(0.45);
          await h.moveTo(BD_VIEW_REPORTS);
          await h.holdUntil(0.78);
          await h.hover(BD_VIEW_REPORTS);
        },
      },
      {
        voice: {
          az: "Yeni tapşırıq bir düymə ilə yaradılır və dərhal lövhənin lazımi sütununa düşür; yuxarıdakı seçici isə lövhələr arasında sürətlə keçməyə imkan verir. Beləcə şirkətin bütün işi bir yerdə qalır: satış öz lövhəsində, marketinq özündə, amma hamısı eyni sistemdə və eyni hesabatlarda.",
          en: "A new task is created with one button and lands straight in the right column; the selector at the top lets you jump between boards quickly. That keeps all of the company's work in one place: sales on their board, marketing on theirs, yet all inside the same system and the same reports.",
          ru: "Новая задача создаётся одной кнопкой и сразу попадает в нужную колонку, а переключатель сверху позволяет быстро прыгать между досками. Так вся работа компании остаётся в одном месте: продажи на своей доске, маркетинг на своей, но всё в одной системе и в одних отчётах.",
        },
        do: async (p, l, h) => {
          await h.moveTo(BD_NEW_TASK);
          await h.holdUntil(0.4);
          await h.moveTo(BD_SWITCHER);
          await h.holdUntil(0.72);
          await h.hover(BD_COLUMNS);
        },
      },
    ],
  },

  "web-to-lead": {
    route: "/settings/web-to-lead",
    title: { az: "Web-to-Lead", en: "Web-to-Lead", ru: "Web-to-Lead" },
    scenes: [
      {
        voice: {
          az: "Web-to-Lead saytınızı CRM-ə birləşdirir. Ziyarətçi saytdakı formanı doldurur — və lid birbaşa sistemə düşür, heç kimin poçtdan köçürməsinə ehtiyac qalmır. Bu, ən çox itən lid mənbəyini bağlayır: sayta gələn müraciəti.",
          en: "Web-to-Lead connects your website to the CRM. A visitor fills in the form on your site — and the lead lands straight in the system, with nobody copying it over from an inbox. This closes the leakiest lead source of all: the enquiry that arrives on your website.",
          ru: "Web-to-Lead соединяет ваш сайт с CRM. Посетитель заполняет форму на сайте — и лид попадает прямо в систему, без переноса кем-то вручную из почты. Это закрывает самый «протекающий» источник лидов: обращение, пришедшее на сайт.",
        },
        do: async (p, l, h) => {
          await h.hover(W2L_HEADER);
          await h.holdUntil(0.5);
          await h.moveTo(W2L_CONFIG);
          await h.holdUntil(0.85);
          await h.hover(W2L_CONFIG);
        },
      },
      {
        voice: {
          az: "Formanı burada yığırsınız: başlıq, düymə mətni və göndərişdən sonra ziyarətçinin yönləndiriləcəyi ünvan. Aşağıda sahələr var — ad və email həmişə tələb olunur, telefon, şirkət və mesaj isə istəyə bağlıdır. Praktik qayda: nə qədər az sahə, bir o qədər çox doldurulmuş forma.",
          en: "You assemble the form here: the heading, the button text and the address the visitor is redirected to after submitting. Below are the fields — name and email are always required, while phone, company and message are optional. A practical rule: the fewer fields, the more completed forms.",
          ru: "Форму вы собираете здесь: заголовок, текст кнопки и адрес, куда посетитель попадёт после отправки. Ниже поля — имя и email обязательны всегда, а телефон, компания и сообщение опциональны. Практическое правило: чем меньше полей, тем больше заполненных форм.",
        },
        do: async (p, l, h) => {
          await h.hover(W2L_CONFIG);
          await h.holdUntil(0.55);
          await h.moveTo(W2L_CONFIG);
          await h.holdUntil(0.88);
          await h.hover(W2L_ENDPOINT);
        },
      },
      {
        voice: {
          az: "Aşağıda texniki hissə: forma məlumatı açıq endpointə göndərilir. CORS aktivdir, yəni istənilən saytdan işləyir, və limit var — bir IP üçün dəqiqədə on sorğu. Bu limit vacibdir: o, formanı spam-botlardan qoruyur, amma real ziyarətçiyə mane olmur.",
          en: "Below is the technical part: the form posts to a public endpoint. CORS is enabled, so it works from any site, and there's a limit — ten requests per minute per IP. That limit matters: it shields the form from spam bots without getting in a real visitor's way.",
          ru: "Ниже техническая часть: форма отправляется на публичный endpoint. CORS включён, значит работает с любого сайта, и есть лимит — десять запросов в минуту с одного IP. Этот лимит важен: он защищает форму от спам-ботов, не мешая настоящему посетителю.",
        },
        do: async (p, l, h) => {
          await h.hover(W2L_ENDPOINT);
          await h.holdUntil(0.55);
          await h.moveTo(W2L_EMBED);
          await h.holdUntil(0.88);
          await h.hover(W2L_EMBED);
        },
      },
      {
        voice: {
          az: "Ən rahat hissə — hazır kod. Sistem forma üçün HTML və göndərmə skriptini özü yaradır; onu kopyalayıb saytın istənilən səhifəsinə yerləşdirmək kifayətdir. Proqramçı işi bir neçə dəqiqəlik məsələyə çevrilir, çünki inteqrasiya yazmaq lazım deyil.",
          en: "The most convenient part — ready-made code. The system generates the form's HTML and its submit script for you; you copy it and paste it into any page of your site. The developer's job shrinks to a few minutes, because there's no integration to write.",
          ru: "Самая удобная часть — готовый код. Система сама генерирует HTML формы и скрипт отправки; его достаточно скопировать и вставить на любую страницу сайта. Работа разработчика сокращается до нескольких минут, потому что интеграцию писать не нужно.",
        },
        do: async (p, l, h) => {
          await h.hover(W2L_EMBED);
          await h.holdUntil(0.5);
          await h.moveTo(W2L_PREVIEW);
          await h.holdUntil(0.85);
          await h.hover(W2L_PREVIEW);
        },
      },
      {
        voice: {
          az: "Sağda canlı ön baxış var — forma saytda necə görünəcəksə, elə göstərilir. Dövrə belə bağlanır: ziyarətçi formanı doldurur, lid «Lidlər» bölməsində yaranır, lid qaydaları onu dərhal düzgün menecerə təyin edir. Sayt artıq sadəcə vitrin deyil — satışın giriş qapısıdır.",
          en: "On the right is a live preview — the form exactly as it will look on your site. That's how the loop closes: the visitor fills in the form, the lead appears in the Leads section, and the assignment rules hand it to the right manager immediately. Your website stops being a brochure and becomes the front door of sales.",
          ru: "Справа живой предпросмотр — форма ровно в том виде, в каком будет на сайте. Так замыкается цикл: посетитель заполняет форму, лид появляется в разделе «Лиды», а правила назначения сразу отдают его нужному менеджеру. Сайт перестаёт быть витриной и становится входной дверью продаж.",
        },
        do: async (p, l, h) => {
          await h.hover(W2L_PREVIEW);
          await h.holdUntil(0.5);
          await h.moveTo(W2L_HEADER);
        },
      },
    ],
  },

  "sales-forecast-settings": {
    route: "/settings/sales-forecast",
    title: { az: "Satış Proqnozu parametrləri", en: "Sales Forecast settings", ru: "Параметры прогноза продаж" },
    scenes: [
      {
        voice: {
          az: "Bu bölmə şirkətin gəlir planını saxlayır. Sövdələşmələrdən hesablanan proqnozdan fərqli olaraq, bura sizin özünüzün qoyduğunuz hədəflərdir: hansı xidmət ilin hansı ayında nə qədər gətirməlidir. Fakt sonra bu planla tutuşdurulur.",
          en: "This section holds the company's revenue plan. Unlike the forecast computed from deals, these are the targets you set yourself: how much each service should bring in, month by month. The actuals are then compared against this plan.",
          ru: "Этот раздел хранит план выручки компании. В отличие от прогноза, который считается из сделок, здесь цели, которые вы ставите сами: сколько какая услуга должна принести в каждый месяц года. Факт потом сравнивается именно с этим планом.",
        },
        do: async (p, l, h) => {
          await h.hover(SF_HEADER);
          await h.holdUntil(0.5);
          await h.moveTo(SF_CONTROLS);
          await h.holdUntil(0.85);
          await h.hover(SF_CONTROLS);
        },
      },
      {
        voice: {
          az: "Yuxarıda idarəetmə var: il seçimi, ƏDV-nin göstərilməsi və ixrac düymələri. Vacib nüans — məbləğlər ƏDV-siz saxlanılır, ƏDV isə yalnız göstərmək üçün əlavə olunur. Bu, plan ilə faktı müqayisə edəndə ən çox rast gəlinən səhvi aradan qaldırır: biri ƏDV ilə, digəri ƏDV-siz olanda.",
          en: "At the top are the controls: the year, the VAT display and the export buttons. One important nuance — amounts are stored without VAT, and VAT is added for display only. That removes the most common mistake when comparing plan against actual: one of them carrying VAT and the other not.",
          ru: "Сверху управление: выбор года, показ НДС и кнопки экспорта. Важный нюанс — суммы хранятся без НДС, а НДС добавляется только для отображения. Это снимает самую частую ошибку при сравнении плана с фактом: когда одно с НДС, а другое без.",
        },
        do: async (p, l, h) => {
          await h.hover(SF_CONTROLS);
          await h.holdUntil(0.55);
          await h.moveTo(SF_CONTROLS);
          await h.holdUntil(0.88);
          await h.moveTo(SF_GRID);
        },
      },
      {
        voice: {
          az: "Cədvəlin özü sadədir: sətirlər — xidmətlər, sütunlar — ilin ayları. Hər xanaya həmin ay üçün gözlənilən məbləği yazırsınız. Belə bölgü nə verir? Ümumi rəqəm əvəzinə görürsünüz ki, plan hansı istiqamətdən gəlir — davamlı xidmətdən, yoxsa bir dəfəlik layihələrdən.",
          en: "The grid itself is simple: rows are services, columns are the months of the year. In each cell you enter the amount expected that month. What does that breakdown give you? Instead of one total you see where the plan comes from — from recurring services or from one-off projects.",
          ru: "Сама таблица проста: строки — услуги, столбцы — месяцы года. В каждую ячейку вы вписываете сумму, ожидаемую в этот месяц. Что даёт такая разбивка? Вместо одной общей цифры видно, откуда берётся план — из постоянных услуг или из разовых проектов.",
        },
        do: async (p, l, h) => {
          await h.hover(SF_GRID);
          await h.holdUntil(0.5);
          await h.moveTo(SF_GRID);
          await h.holdUntil(0.85);
          await h.hover(SF_GRID);
        },
      },
      {
        voice: {
          az: "Aşağıda avtomatik yekunlar var: hər ay üzrə ƏDV və ümumi cəm. Yəni siz sətirləri doldurursunuz, cəmi isə sistem özü hesablayır — Excel-də düsturların sürüşməsi kimi problem olmur. Dəyişikliklər «Saxla» düyməsi ilə yazılır, ixrac düymələri isə planı fayl kimi çıxarır.",
          en: "At the bottom are the automatic totals: VAT and the grand total for each month. You fill in the rows, and the system computes the totals — none of the formula drift you get in a spreadsheet. Changes are stored with the Save button, and the export buttons take the plan out as a file.",
          ru: "Внизу автоматические итоги: НДС и общая сумма по каждому месяцу. То есть вы заполняете строки, а суммы система считает сама — без съезжающих формул, как это бывает в Excel. Изменения записываются кнопкой «Сохранить», а кнопки экспорта выгружают план файлом.",
        },
        do: async (p, l, h) => {
          await h.hover(SF_GRID);
          await h.holdUntil(0.5);
          await h.moveTo(SF_SAVE);
          await h.holdUntil(0.85);
          await h.hover(SF_SAVE);
        },
      },
      {
        voice: {
          az: "Qısası: bu ekran «nə qədər qazanmaq istəyirik» sualına cavab verir, «Satış proqnozu» bölməsi isə «nə qədər qazanacağıq» sualına. İkisinin fərqi — komandanın bu il əslində nə qədər işləməli olduğunu göstərən ən dürüst rəqəmdir.",
          en: "In short: this screen answers “how much do we want to earn”, while the Sales Forecast section answers “how much are we going to earn”. The gap between the two is the most honest number there is about how much work the team actually owes this year.",
          ru: "Коротко: этот экран отвечает на вопрос «сколько мы хотим заработать», а раздел «Прогноз продаж» — на вопрос «сколько мы заработаем». Разрыв между ними и есть самая честная цифра о том, сколько работы команде на самом деле предстоит в этом году.",
        },
        do: async (p, l, h) => {
          await h.hover(SF_HEADER);
          await h.holdUntil(0.5);
          await h.moveTo(SF_GRID);
        },
      },
    ],
  },

  pipelines: {
    route: "/settings/pipelines",
    title: { az: "Huni və Mərhələlər", en: "Pipelines & Stages", ru: "Воронки и стадии" },
    scenes: [
      {
        voice: {
          az: "Bu bölmə satışın skeletini qurur. Huni — sövdələşmənin keçdiyi yol, mərhələlər isə o yolun addımlarıdır. Nə qədər çox komanda və məhsul varsa, bir huni bir o qədər az uyğun gəlir: burada ayrıca hunilər yaradıb hər birinə öz mərhələlərini verirsiniz.",
          en: "This section builds the skeleton of your sales. A pipeline is the path a deal travels; the stages are the steps along that path. The more teams and products you have, the worse a single pipeline fits: here you create separate pipelines and give each its own stages.",
          ru: "Этот раздел строит скелет продаж. Воронка — путь, который проходит сделка, а стадии — шаги этого пути. Чем больше команд и продуктов, тем хуже подходит одна воронка на всех: здесь вы заводите отдельные воронки и даёте каждой свои стадии.",
        },
        do: async (p, l, h) => {
          await h.hover(PL_HEADER);
          await h.holdUntil(0.5);
          await h.moveTo(PL_TAB_DEFAULT);
          await h.holdUntil(0.85);
          await h.hover(PL_TAB_DEFAULT);
        },
      },
      {
        voice: {
          az: "Yuxarıda mövcud hunilər var və hər birinin yanında sövdələşmə sayı göstərilib. Ulduz əsas hunini bildirir — yeni sövdələşmə göstərilmədikdə oraya düşür. Başqa hunini seçəndə aşağıdakı mərhələ siyahısı dərhal dəyişir, çünki hər huninin öz mərhələləri var.",
          en: "At the top are the existing pipelines, each with its deal count. The star marks the default one — a new deal lands there unless told otherwise. Pick another pipeline and the stage list below changes immediately, because each pipeline carries its own stages.",
          ru: "Сверху существующие воронки, у каждой указано число сделок. Звезда отмечает основную — новая сделка попадает в неё, если не указано иное. Выберите другую воронку, и список стадий ниже сразу изменится: у каждой воронки свои стадии.",
        },
        do: async (p, l, h) => {
          await h.click(PL_TAB_SECOND);
          await h.sleep(1200);
          await h.holdUntil(0.6);
          await h.click(PL_TAB_DEFAULT);
          await h.sleep(1000);
          await h.hover(PL_TAB_DEFAULT);
        },
      },
      {
        voice: {
          az: "Ən vacib şey mərhələnin yanındakı faizdir — bu, qazanma ehtimalıdır. Lid on faiz, kvalifikasiya iyirmi beş, təklif əlli, danışıqlar yetmiş beş, qazanıldı yüz. Məhz bu faizlər proqnozdakı çəkili məbləği hesablayır. Yəni burada rəqəmi dəyişsəniz, bütün şirkətin proqnozu dəyişəcək — ona görə bu ekran nəzarət tələb edir.",
          en: "The most important thing is the percentage next to each stage — that's the win probability. Lead ten percent, qualification twenty-five, proposal fifty, negotiation seventy-five, won a hundred. Those very percentages compute the weighted amount in the forecast. Change a number here and the whole company's forecast changes — which is why this screen deserves control.",
          ru: "Самое важное — процент рядом со стадией: это вероятность выигрыша. Лид десять процентов, квалификация двадцать пять, предложение пятьдесят, переговоры семьдесят пять, выиграна сто. Именно эти проценты считают взвешенную сумму в прогнозе. Измените здесь цифру — изменится прогноз всей компании, поэтому экран требует контроля.",
        },
        do: async (p, l, h) => {
          await h.hover(PL_STAGE_LEAD);
          await h.holdUntil(0.45);
          await h.moveTo(PL_STAGE_WON);
          await h.holdUntil(0.8);
          await h.hover(PL_STAGE_WON);
        },
      },
      {
        voice: {
          az: "Yeni mərhələ və ya bütöv yeni huni əlavə etmək də buradadır. Praktik məsləhət: mərhələ o zaman lazımdır ki, onun aydın çıxış şərti olsun. «Müştəri düşünür» mərhələ deyil — bu, sadəcə gözləmədir. «Təklif göndərildi» mərhələdir, çünki onu yoxlamaq olar.",
          en: "Adding a new stage, or a whole new pipeline, lives here too. A practical rule: a stage earns its place only if it has a clear exit condition. “Customer is thinking” is not a stage — that's just waiting. “Proposal sent” is a stage, because you can verify it.",
          ru: "Добавление новой стадии или целой новой воронки — тоже здесь. Практическое правило: стадия имеет право на существование, только если у неё есть внятное условие выхода. «Клиент думает» — не стадия, это просто ожидание. «Предложение отправлено» — стадия, потому что её можно проверить.",
        },
        do: async (p, l, h) => {
          // moveTo only: an extra hover() on the same button waited out its own
          // 6 s timeout here and pushed the next scene's voice past the hold,
          // which showed up as a 4.4 s silent gap.
          await h.moveTo(PL_ADD_STAGE);
          await h.holdUntil(0.5);
          await h.moveTo(PL_ADD_PIPELINE);
          await h.holdUntil(0.85);
          await h.moveTo(PL_HEADER);
        },
      },
      {
        voice: {
          az: "Qısası: hunilər sövdələşmənin marşrutunu, mərhələlərin faizləri isə proqnozun dəqiqliyini müəyyən edir. Bu iki şeyi düz qursanız, satışın qalan hesabatları özü düzgün işləyəcək.",
          en: "In short: pipelines define the route a deal takes, and the stage percentages define how accurate your forecast is. Get those two right and the rest of your sales reporting works correctly on its own.",
          ru: "Коротко: воронки задают маршрут сделки, а проценты стадий — точность прогноза. Настройте эти две вещи правильно, и остальная отчётность по продажам заработает корректно сама.",
        },
        do: async (p, l, h) => {
          await h.hover(PL_STAGE_LEAD);
          await h.holdUntil(0.5);
          await h.moveTo(PL_HEADER);
        },
      },
    ],
  },

  quotas: {
    route: "/settings/quotas",
    title: { az: "Kvota İdarəetməsi", en: "Quota Management", ru: "Управление квотами" },
    scenes: [
      {
        voice: {
          az: "Kvota — menecerin rüblük planıdır. Bu bölmə olmasa, «planı yerinə yetirdik» ifadəsi mənasızdır: müqayisə etmək üçün rəqəm yoxdur. Burada hər menecerə hər rüb üçün hədəf qoyursunuz, sistem isə faktı özü hesablayır.",
          en: "A quota is a manager's quarterly plan. Without this section the phrase “we hit the plan” is meaningless: there's no number to compare against. Here you set a target for each manager for each quarter, and the system computes the actual result itself.",
          ru: "Квота — это квартальный план менеджера. Без этого раздела фраза «мы выполнили план» бессмысленна: не с чем сравнивать. Здесь вы ставите цель каждому менеджеру на каждый квартал, а факт система считает сама.",
        },
        do: async (p, l, h) => {
          await h.hover(QT_HEADER);
          await h.holdUntil(0.5);
          await h.moveTo(QT_YEAR);
          await h.holdUntil(0.85);
          await h.hover(QT_YEAR);
        },
      },
      {
        voice: {
          az: "Yuxarıda il seçilir — planlar illər üzrə saxlanılır, ona görə keçmiş ilin kvotalarına da baxa bilərsiniz. Bu, yeni ilin planını qurarkən lazım olur: keçən il nə qoymuşduq və nə alındı.",
          en: "The year is chosen at the top — plans are kept per year, so you can look back at last year's quotas as well. That matters when you're setting the new year's plan: what did we commit to last year, and what actually happened.",
          ru: "Сверху выбирается год — планы хранятся по годам, поэтому можно посмотреть и квоты прошлого года. Это нужно, когда строишь план на новый год: что мы ставили в прошлом и что из этого вышло.",
        },
        do: async (p, l, h) => {
          await h.hover(QT_YEAR);
          await h.holdUntil(0.55);
          await h.moveTo(QT_FORM);
          await h.holdUntil(0.88);
          await h.hover(QT_FORM);
        },
      },
      {
        voice: {
          az: "Kvota qoymaq üç addımdır: meneceri seçirsiniz, rübü seçirsiniz və məbləği yazırsınız. Diqqət edin — burada yalnız plan redaktə olunur. Fakt heç vaxt əl ilə yazılmır, o, bağlanmış sövdələşmələrdən hesablanır. Bu, planın sonradan «düzəldilməsi» ehtimalını sıfıra endirir.",
          en: "Setting a quota takes three steps: pick the manager, pick the quarter, type the amount. Note that only the plan is editable here. The actual number is never typed in by hand — it's computed from closed deals. That removes any chance of the plan being “adjusted” after the fact.",
          ru: "Поставить квоту — три шага: выбрать менеджера, выбрать квартал, ввести сумму. Обратите внимание: здесь редактируется только план. Факт никогда не вводится руками — он считается из закрытых сделок. Это сводит к нулю возможность «подправить» план задним числом.",
        },
        do: async (p, l, h) => {
          await h.moveTo(QT_MANAGER);
          await h.holdUntil(0.35);
          await h.moveTo(QT_QUARTER);
          await h.holdUntil(0.6);
          await h.moveTo(QT_AMOUNT);
          await h.holdUntil(0.85);
          await h.moveTo(QT_ADD);
        },
      },
      {
        voice: {
          az: "Qoyulmuş kvotalar aşağıdakı siyahıda toplanır. Məhz bu rəqəmlər sonra proqnoz bölməsində «menecerlər üzrə» kəsiyini qidalandırır — orada gördüyünüz faizlər buradan gəlir. Yəni kvota boş qalsa, orada da faiz olmayacaq.",
          en: "The quotas you've set collect in the list below. These are exactly the numbers that later feed the “by managers” cut in the forecast — the percentages you see there come from here. Leave a quota empty and that percentage simply won't exist.",
          ru: "Проставленные квоты собираются в списке ниже. Именно эти цифры потом питают срез «по менеджерам» в прогнозе — проценты, которые вы там видите, приходят отсюда. Оставите квоту пустой — процента там просто не будет.",
        },
        do: async (p, l, h) => {
          await h.hover(QT_LIST);
          await h.holdUntil(0.55);
          await h.moveTo(QT_LIST);
          await h.holdUntil(0.85);
          await h.hover(QT_HEADER);
        },
      },
    ],
  },

  territories: {
    route: "/settings/territories",
    title: { az: "Satış əraziləri", en: "Sales Territories", ru: "Территории продаж" },
    scenes: [
      {
        voice: {
          az: "Ərazilər satış komandasını bölgələrə görə bölür — coğrafi və ya sahə üzrə. Bu, bir sadə problemi həll edir: eyni müştəriyə iki menecer zəng etməsin, və heç bir bölgə sahibsiz qalmasın.",
          en: "Territories split the sales team by region — geographic or industry-based. It solves one simple problem: two reps shouldn't be calling the same customer, and no region should be left without an owner.",
          ru: "Территории делят команду продаж по регионам — географическим или отраслевым. Это решает одну простую задачу: чтобы одному клиенту не звонили два менеджера и чтобы ни один регион не остался без владельца.",
        },
        do: async (p, l, h) => {
          await h.hover(TR_HEADER);
          await h.holdUntil(0.5);
          await h.moveTo(TR_STATS);
          await h.holdUntil(0.85);
          await h.hover(TR_STATS);
        },
      },
      {
        voice: {
          az: "Yuxarıda ümumi mənzərə var: neçə ərazi yaradılıb, onlardan neçəsi aktivdir və cəmi neçə nəfər təyin olunub. Aktiv olmayan ərazi silinmir — sadəcə dayandırılır, məsələn mövsüm bitəndə və ya komanda yenidən qurulanda.",
          en: "At the top is the overview: how many territories exist, how many are active and how many people are assigned in total. An inactive territory isn't deleted — it's just paused, say when a season ends or the team is being restructured.",
          ru: "Сверху общая картина: сколько территорий заведено, сколько из них активны и сколько всего людей назначено. Неактивная территория не удаляется — она просто приостановлена, например когда закончился сезон или команду перестраивают.",
        },
        do: async (p, l, h) => {
          await h.hover(TR_STATS);
          await h.holdUntil(0.5);
          await h.moveTo(TR_LIST);
          await h.holdUntil(0.85);
          await h.hover(TR_LIST);
        },
      },
      {
        voice: {
          az: "Hər ərazi ayrıca kartdır: adı, statusu və neçə nəfərin ona təyin olunduğu. Bax burada Bakı regionu, Azərbaycan üzrə pərakəndə və texnologiya, ayrıca Türkiyə üzrə korporativ istiqamət. Bölgü coğrafiya ilə məhdud deyil — sahəyə görə də bölmək olar, çünki korporativ satış və pərakəndə tamamilə fərqli bacarıq tələb edir.",
          en: "Each territory is its own card: its name, its status and how many people are assigned to it. Here we have the Baku region, retail and technology across Azerbaijan, and a separate corporate direction for Turkey. The split isn't limited to geography — you can divide by industry too, because corporate sales and retail need completely different skills.",
          ru: "Каждая территория — отдельная карточка: название, статус и сколько человек назначено. Здесь Бакинский регион, розница и технологии по Азербайджану и отдельное корпоративное направление по Турции. Деление не ограничено географией — можно делить и по отрасли, потому что корпоративные продажи и розница требуют совершенно разных навыков.",
        },
        do: async (p, l, h) => {
          await h.hover(TR_LIST);
          await h.holdUntil(0.4);
          await h.moveTo(TR_PAUSE);
          await h.holdUntil(0.72);
          await h.hover(TR_LIST);
        },
      },
      {
        voice: {
          az: "Yeni ərazi bir düymə ilə yaradılır, mövcud olanı isə dayandırmaq və ya yenidən işə salmaq olar. Praktikada bu bölmə kadr dəyişikliyində ən çox lazım olur: menecer gedəndə onun ərazisi görünən qalır və yeni adama təyin olunur — müştərilər «sahibsiz» qalmır.",
          en: "A new territory is created with one button, and an existing one can be paused or resumed. In practice this section matters most when people change: when a rep leaves, their territory stays visible and gets assigned to someone new — the customers never end up ownerless.",
          ru: "Новая территория создаётся одной кнопкой, существующую можно приостановить или снова включить. На практике этот раздел важнее всего при смене людей: когда менеджер уходит, его территория остаётся видимой и назначается новому — клиенты не остаются без владельца.",
        },
        do: async (p, l, h) => {
          await h.moveTo(TR_NEW);
          await h.holdUntil(0.5);
          await h.hover(TR_NEW);
          await h.holdUntil(0.85);
          await h.moveTo(TR_HEADER);
        },
      },
    ],
  },

  "forecast-snapshots": {
    route: "/forecast/snapshots",
    title: { az: "Proqnoz anlıq görüntüləri", en: "Forecast Snapshots", ru: "Снимки прогноза" },
    scenes: [
      {
        voice: {
          az: "Bu bölmə bir problemi həll edir: proqnoz dəyişir, amma köhnə proqnoz heç yerdə qalmır. «Anlıq görüntü» — proqnozun konkret andakı şəkli. Bu gün çəkirsiniz, rübün sonunda faktiki gəlirlə tutuşdurursunuz və nəhayət bilirsiniz ki, proqnozunuz nə qədər dəqiqdir.",
          en: "This section solves one problem: the forecast keeps changing, but the old forecast is never kept anywhere. A snapshot is a picture of the forecast at a given moment. You take one today, compare it against actual revenue at the end of the quarter, and finally learn how accurate your forecasting really is.",
          ru: "Этот раздел решает одну проблему: прогноз меняется, но старый прогноз нигде не сохраняется. Снимок — это фотография прогноза на конкретный момент. Вы делаете его сегодня, в конце квартала сравниваете с фактической выручкой и наконец узнаёте, насколько точны ваши прогнозы.",
        },
        do: async (p, l, h) => {
          await h.hover(FS_TITLE);
          await h.holdUntil(0.5);
          await h.moveTo(FS_TAKE);
          await h.holdUntil(0.85);
          await h.hover(FS_TAKE);
        },
      },
      {
        voice: {
          az: "Anlıq görüntünü bir düymə ilə çəkirsiniz — sistem həmin an üçün bütün proqnoz rəqəmlərini yazıb saxlayır. Adətən bunu rübün əvvəlində, ortasında və bağlanmadan bir həftə əvvəl edirlər: üç nöqtə proqnozun necə sürüşdüyünü göstərmək üçün kifayətdir.",
          en: "You take a snapshot with a single button — the system stores every forecast number as of that moment. The usual rhythm is one at the start of the quarter, one mid-quarter and one a week before it closes: three points are enough to show how the forecast drifted.",
          ru: "Снимок делается одной кнопкой — система сохраняет все цифры прогноза на этот момент. Обычный ритм: один в начале квартала, один в середине и один за неделю до закрытия. Трёх точек достаточно, чтобы увидеть, как прогноз сползал.",
        },
        do: async (p, l, h) => {
          await h.moveTo(FS_TAKE);
          await h.holdUntil(0.55);
          await h.hover(FS_TABLE);
          await h.holdUntil(0.88);
          await h.moveTo(FS_ROW(1));
        },
      },
      {
        voice: {
          az: "Cədvəldə hər sətir bir anlıq görüntüdür: nə vaxt çəkilib, hansı dövr üçün, təsdiqlənmiş məbləğ, ən yaxşı ssenari, ümumi proqnoz və neçə sövdələşmə. Yəni hər sətir — həmin gün nə düşündüyünüzün sənədləşdirilmiş qeydi.",
          en: "In the table every row is one snapshot: when it was captured, for which period, the committed amount, the best case, the total forecast and how many deals. Each row is a documented record of what you believed on that day.",
          ru: "В таблице каждая строка — один снимок: когда сделан, за какой период, подтверждённая сумма, лучший сценарий, общий прогноз и сколько сделок. То есть каждая строка — задокументированная запись того, что вы думали в тот день.",
        },
        do: async (p, l, h) => {
          // Rows, not column headers: resolving the localized header labels was
          // slow enough on ru to overrun the scene and leave a silent gap.
          await h.hover(FS_ROW(1));
          await h.holdUntil(0.4);
          await h.moveTo(FS_ROW(2));
          await h.holdUntil(0.7);
          await h.moveTo(FS_ROW(3));
          await h.holdUntil(0.9);
          await h.hover(FS_ROW(1));
        },
      },
      {
        voice: {
          az: "Sətirləri müqayisə edəndə əsas sual aydınlaşır: proqnoz sabit qalır, yoxsa hər həftə aşağı sürüşür? Əgər hər anlıq görüntüdə rəqəm azalırsa — deməli komanda əvvəlcə həddindən artıq nikbin qiymət verir. Bu, düzəldilə bilən vərdişdir, amma yalnız ölçəndə görünür.",
          en: "Comparing the rows makes the real question visible: does the forecast hold steady, or does it slide down week after week? If the number shrinks with every snapshot, the team is starting out too optimistic. That's a fixable habit — but only once you measure it.",
          ru: "Сравнение строк проявляет главный вопрос: прогноз держится или каждую неделю сползает вниз? Если с каждым снимком цифра уменьшается — команда изначально слишком оптимистична. Это исправимая привычка, но видно её только когда измеряешь.",
        },
        do: async (p, l, h) => {
          await h.hover(FS_ROW(2));
          await h.holdUntil(0.45);
          await h.moveTo(FS_ROW(3));
          await h.holdUntil(0.8);
          await h.moveTo(FS_ROW(4));
        },
      },
      {
        voice: {
          az: "Anlıq görüntülər eyni zamanda müdafiə sənədidir. Rübün sonunda «biz belə demişdik» mübahisəsi olmur: hər proqnozun tarixi, müəllifi və rəqəmi qeydə alınıb. Lazımsız qeydi silmək də olar — sətrin sonundakı düymə ilə.",
          en: "Snapshots are also a defence document. At the end of the quarter there's no “but we said” argument: every forecast has its date, its author and its number on record. A useless capture can be removed too — with the button at the end of the row.",
          ru: "Снимки — ещё и защитный документ. В конце квартала не бывает спора «мы же говорили»: у каждого прогноза записаны дата, автор и цифра. Ненужный снимок можно и удалить — кнопкой в конце строки.",
        },
        do: async (p, l, h) => {
          await h.hover(FS_TABLE);
          await h.holdUntil(0.55);
          await h.moveTo(FS_ROW(1));
          await h.holdUntil(0.85);
          await h.hover(FS_ROW(1));
        },
      },
      {
        voice: {
          az: "Qısası: proqnoz bir dəfə deyilən söz deyil, ölçülən bacarıqdır. Müntəzəm anlıq görüntü çəkin — bir neçə rübdən sonra komandanızın proqnozunun neçə faiz dəqiq olduğunu dəqiq bilərsiniz.",
          en: "In short: a forecast isn't a sentence said once, it's a measurable skill. Take snapshots regularly, and after a few quarters you'll know exactly how accurate your team's forecast is, in percent.",
          ru: "Коротко: прогноз — не фраза, сказанная один раз, а измеримый навык. Делайте снимки регулярно, и через несколько кварталов вы будете точно знать, на сколько процентов точен прогноз вашей команды.",
        },
        do: async (p, l, h) => {
          await h.hover(FS_TITLE);
          await h.holdUntil(0.5);
          await h.moveTo(FS_TAKE);
        },
      },
    ],
  },

  "forecast-waterfall": {
    route: "/forecast/waterfall",
    title: { az: "Satış boru xətti şəlaləsi", en: "Pipeline Waterfall", ru: "Воронка движений" },
    scenes: [
      {
        voice: {
          az: "Bu bölmə hunidəki hərəkəti göstərir. Adi hesabat deyir ki, hunidə nə qədər pul var; şəlalə isə deyir ki, o pul necə dəyişdi: nə yarandı, nə irəlilədi, nə geri qayıtdı, nə qazanıldı və nə itirildi. Statik şəkil əvəzinə dövrün dinamikası.",
          en: "This section shows the movement inside your pipeline. A normal report tells you how much money is in the funnel; the waterfall tells you how that money changed: what was created, what advanced, what slipped back, what was won and what was lost. The dynamics of the period instead of a static picture.",
          ru: "Этот раздел показывает движение внутри воронки. Обычный отчёт говорит, сколько денег в воронке; водопад говорит, как эти деньги изменились: что создано, что продвинулось, что откатилось, что выиграно и что проиграно. Динамика периода вместо статичной картинки.",
        },
        do: async (p, l, h) => {
          await h.hover(FS_TITLE);
          await h.holdUntil(0.5);
          await h.moveTo(WF_TOTAL);
          await h.holdUntil(0.85);
          await h.hover(WF_TOTAL);
        },
      },
      {
        voice: {
          az: "Yuxarıda dövrü seçirsiniz: son yeddi gün, otuz, doxsan, yüz səksən gün və ya bütün tarix. Dövrü dəyişəndə bütün rəqəmlər yenidən hesablanır. Həftəlik iclas üçün otuz gün, rüblük təhlil üçün doxsan gün rahatdır.",
          en: "At the top you choose the period: the last seven days, thirty, ninety, a hundred and eighty, or all time. Change the period and every number is recomputed. Thirty days works for the weekly meeting, ninety for the quarterly review.",
          ru: "Сверху выбираете период: последние семь дней, тридцать, девяносто, сто восемьдесят или всё время. Меняете период — все цифры пересчитываются. Тридцать дней удобны для недельной встречи, девяносто — для квартального разбора.",
        },
        do: async (p, l, h) => {
          await h.click(WF_30);
          await h.sleep(1300);
          await h.holdUntil(0.6);
          await h.click(WF_ALL);
          await h.sleep(1200);
          await h.hover(WF_TOTAL);
        },
      },
      {
        voice: {
          az: "Üç əsas rəqəm: ümumi keçidlər — dövr ərzində neçə dəfə sövdələşmə vəziyyət dəyişib; xalis dəyişiklik — hunidəki pulun yekun fərqi; və ən böyük hərəkət — hansı növ keçid ən çox təsir edib. Burada ən böyük təsiri irəliləyən beş sövdələşmə verib.",
          en: "Three headline numbers: total transitions — how many times a deal changed state in the period; net change — the bottom-line difference in pipeline money; and the biggest move — which kind of transition mattered most. Here the biggest impact came from five deals that advanced.",
          ru: "Три главные цифры: всего переходов — сколько раз сделки меняли состояние за период; чистое изменение — итоговая разница денег в воронке; и наибольшее движение — какой тип перехода повлиял сильнее всего. Здесь наибольший вклад дали пять продвинувшихся сделок.",
        },
        do: async (p, l, h) => {
          await h.hover(WF_TOTAL);
          await h.holdUntil(0.4);
          await h.moveTo(WF_NET);
          await h.holdUntil(0.7);
          await h.moveTo(WF_BIGGEST);
          await h.holdUntil(0.9);
          await h.hover(WF_BIGGEST);
        },
      },
      {
        voice: {
          az: "Diaqram keçidləri növ üzrə bölür. Burada ən vacib sütun «geri qayıtdı» sütunudur: sövdələşmə mərhələdə geriyə düşübsə, deməli ya kvalifikasiya səhv olub, ya da müştəri tərəddüd edir. Bu rəqəm böyükdürsə, problem huninin özündədir, satışçının səyində yox.",
          en: "The chart splits transitions by type. The most important bar here is “regressed”: when a deal falls back a stage, either the qualification was wrong or the customer is hesitating. If that number is large, the problem is in the funnel itself, not in the rep's effort.",
          ru: "Диаграмма делит переходы по типам. Самый важный столбец здесь — «откатилось»: если сделка упала назад по стадии, значит либо квалификация была неверной, либо клиент сомневается. Если эта цифра велика, проблема в самой воронке, а не в усилиях продавца.",
        },
        do: async (p, l, h) => {
          await h.hover(WF_CHART);
          await h.holdUntil(0.55);
          await h.moveTo(WF_CHART);
          await h.holdUntil(0.85);
          await h.hover(WF_CHART);
        },
      },
      {
        voice: {
          az: "Cədvəldə hər keçid növü rəqəmlərlə açılır: neçə sövdələşmə və pulda nə qədər dəyişiklik. Yaradıldı, irəlilədi, geri qayıtdı, qazanıldı, itirildi, yenidən açıldı, məsul dəyişdi. Burada bir sövdələşmənin yenidən açılması yüz min dollar geri qaytarıb — belə hadisələr adi hesabatda tamamilə görünmür.",
          en: "The table breaks every transition type down into numbers: how many deals and how much money moved. Created, advanced, regressed, won, lost, reopened, reassigned. Here one reopened deal brought back a hundred thousand dollars — events like that are completely invisible in a normal report.",
          ru: "Таблица раскладывает каждый тип перехода в цифрах: сколько сделок и на сколько изменились деньги. Создано, продвинуто, откатилось, выиграно, проиграно, переоткрыто, сменился ответственный. Здесь одна переоткрытая сделка вернула сто тысяч долларов — такие события в обычном отчёте не видны вовсе.",
        },
        do: async (p, l, h) => {
          await h.hover(WF_TABLE);
          await h.holdUntil(0.5);
          await h.moveTo(WF_TABLE);
          await h.holdUntil(0.85);
          await h.hover(WF_TABLE);
        },
      },
      {
        voice: {
          az: "Yekunda şəlalə bir suala cavab verir: bu dövrdə huni irəli getdi, yoxsa yerində saydı? Keçidlər sövdələşmənin mərhələsi dəyişəndə avtomatik yazılır — yəni bu hesabat üçün heç kim əl ilə heç nə doldurmur.",
          en: "In the end the waterfall answers one question: did the pipeline move forward this period, or did it just churn in place? Transitions are recorded automatically whenever a deal's stage changes — nobody fills anything in by hand for this report.",
          ru: "В итоге водопад отвечает на один вопрос: воронка за период продвинулась или толклась на месте? Переходы записываются автоматически при смене стадии сделки — вручную для этого отчёта никто ничего не заполняет.",
        },
        do: async (p, l, h) => {
          await h.hover(WF_NET);
          await h.holdUntil(0.5);
          await h.moveTo(FS_TITLE);
        },
      },
    ],
  },

  "forecast-velocity": {
    route: "/forecast/velocity",
    title: { az: "Sövdələrin sürəti", en: "Deal Velocity", ru: "Скорость сделок" },
    scenes: [
      {
        voice: {
          az: "Bu bölmə sövdələşmələrin harada ləngidiyini göstərir. Satışda pul çox vaxt ona görə itmir ki, müştəri «yox» deyir — ona görə itir ki, sövdələşmə bir mərhələdə həftələrlə donub qalır və heç kim bunu vaxtında görmür.",
          en: "This section shows where deals slow down. In sales money is usually lost not because the customer says no, but because a deal freezes at one stage for weeks and nobody notices in time.",
          ru: "Этот раздел показывает, где сделки тормозят. В продажах деньги чаще теряются не потому, что клиент сказал «нет», а потому что сделка неделями стоит на одном этапе и никто этого вовремя не замечает.",
        },
        do: async (p, l, h) => {
          await h.hover(FS_TITLE);
          await h.holdUntil(0.5);
          await h.moveTo(VL_BANNER);
          await h.holdUntil(0.85);
          await h.hover(VL_BANNER);
        },
      },
      {
        voice: {
          az: "Ən yuxarıda sistem özü diaqnoz qoyur: hansı mərhələ satışı ləngidir. Bax burada «Danışıqlar» mərhələsi göstərilir — gecikən sövdələşmələr orada altmış altı günə qədər qala bilər. Yəni sizə hesabatı təhlil etmək lazım deyil, sistem harada başlamağı özü deyir.",
          en: "At the very top the system makes the diagnosis itself: which stage is slowing sales down. Here it points at “Negotiation” — slow deals can sit there for up to sixty-six days. So you don't have to analyse a report; the system tells you where to start.",
          ru: "В самом верху система сама ставит диагноз: какой этап замедляет продажи. Здесь она указывает на «Переговоры» — долгие сделки могут стоять там до шестидесяти шести дней. То есть вам не нужно анализировать отчёт: система сама говорит, с чего начать.",
        },
        do: async (p, l, h) => {
          await h.hover(VL_BANNER);
          await h.holdUntil(0.55);
          await h.moveTo(VL_HOWTO);
          await h.holdUntil(0.88);
          await h.hover(VL_HOWTO);
        },
      },
      {
        voice: {
          az: "Yanında «bu ekranı necə oxumalı» izahı var və orada əsas fikir yazılıb: adi vaxtı gecikən sövdələşmələrin vaxtı ilə müqayisə edin. Böyük fərq o deməkdir ki, sövdələşmələrin bir hissəsi ilişib qalıb — və məhz onlara baxmaq lazımdır.",
          en: "Next to it is a “how to read this page” card with the key idea: compare the typical time against the time of slow deals. A large gap means a portion of your deals is stuck — and those are exactly the ones to look at.",
          ru: "Рядом карточка «как читать этот экран», и в ней записана главная мысль: сравнивайте обычное время со временем долгих сделок. Большой разрыв означает, что часть сделок застряла — и смотреть нужно именно на них.",
        },
        do: async (p, l, h) => {
          await h.hover(VL_HOWTO);
          await h.holdUntil(0.5);
          await h.moveTo(VL_STAGES);
          await h.holdUntil(0.85);
          await h.hover(VL_STAGES);
        },
      },
      {
        voice: {
          az: "Aşağıda mərhələlər üzrə vaxt var və problemli mərhələlər birinci gəlir. Hər mərhələ üçün dörd rəqəm: neçə sövdələşmə daxil olub və çıxıb, adətən nə qədər çəkir, gecikənlərdə nə qədər çəkir və neçə faizi irəli keçib. «İrəli keçdi» sıfırdırsa, mərhələ tələ kimi işləyir: sövdələşmə daxil olur, amma çıxmır.",
          en: "Below is the time by stage, with the problem stages listed first. Each stage carries four numbers: how many deals entered and exited, how long it usually takes, how long it takes for the slow ones, and what share advanced. If “advanced” is zero, the stage works like a trap: deals go in but don't come out.",
          ru: "Ниже время по этапам, и проблемные этапы идут первыми. У каждого этапа четыре цифры: сколько сделок вошло и вышло, сколько обычно занимает, сколько занимает у долгих и какая доля продвинулась. Если «продвинулось» ноль, этап работает как ловушка: сделки входят, но не выходят.",
        },
        do: async (p, l, h) => {
          await h.hover(VL_STAGES);
          await h.holdUntil(0.45);
          await h.moveTo(VL_SHOW_DEALS);
          await h.holdUntil(0.8);
          await h.hover(VL_SHOW_DEALS);
        },
      },
      {
        voice: {
          az: "Hər mərhələdə «Sövdələri göstər» düyməsi var — analitikadan birbaşa konkret sövdələşmələrə keçirsiniz. Bu vacibdir: hesabat problemi tapır, siz isə həmin dəqiqə həmin sövdələşmələri açıb növbəti addımı təyin edirsiniz.",
          en: "Every stage has a “show deals” button — you go straight from the analytics to the concrete deals. That matters: the report finds the problem, and you open exactly those deals right away and set the next step.",
          ru: "У каждого этапа есть кнопка «показать сделки» — вы переходите из аналитики прямо к конкретным сделкам. Это важно: отчёт находит проблему, а вы тут же открываете именно эти сделки и назначаете следующий шаг.",
        },
        do: async (p, l, h) => {
          await h.moveTo(VL_SHOW_DEALS);
          await h.holdUntil(0.5);
          await h.hover(VL_STAGES);
          await h.holdUntil(0.85);
          await h.moveTo(VL_90);
        },
      },
      {
        voice: {
          az: "Dövrü də dəyişmək olar — otuz, doxsan, yüz səksən və ya üç yüz altmış beş gün. Uzun dövr mövsümi dəyişiklikləri hamarlayır, qısa dövr isə son dəyişikliyin nəticə verib-vermədiyini göstərir.",
          en: "You can change the period as well — thirty, ninety, a hundred and eighty or three hundred and sixty-five days. A long window smooths seasonality; a short one shows whether your latest change actually worked.",
          ru: "Период тоже можно менять — тридцать, девяносто, сто восемьдесят или триста шестьдесят пять дней. Длинное окно сглаживает сезонность, короткое показывает, сработало ли последнее изменение.",
        },
        do: async (p, l, h) => {
          await h.click(VL_90);
          await h.sleep(1400);
          await h.holdUntil(0.6);
          await h.hover(VL_STAGES);
        },
      },
      {
        voice: {
          az: "Yekunda bu ekran satış rəhbərinin ən konkret alətidir: o, mücərrəd «zəif işləyirik» əvəzinə dəqiq deyir — hansı mərhələ, neçə gün və hansı sövdələşmələr. Qalan iş sadəcə həmin sövdələşmələri hərəkətə gətirməkdir.",
          en: "In the end this screen is a sales manager's most concrete tool: instead of a vague “we're underperforming” it says exactly which stage, how many days and which deals. All that's left is to get those deals moving again.",
          ru: "В итоге этот экран — самый конкретный инструмент руководителя продаж: вместо абстрактного «мы плохо работаем» он говорит точно — какой этап, сколько дней и какие сделки. Остаётся только сдвинуть эти сделки с места.",
        },
        do: async (p, l, h) => {
          await h.hover(VL_BANNER);
          await h.holdUntil(0.5);
          await h.moveTo(FS_TITLE);
        },
      },
    ],
  },

  forecast: {
    route: "/forecast",
    title: { az: "Satış proqnozu", en: "Sales Forecast", ru: "Прогноз продаж" },
    scenes: [
      // 1 — The question the section answers.
      {
        voice: {
          az: "Bu, «Satış proqnozu» bölməsidir. O, bir sualı cavablandırır: rübü bağlaya biləcəyikmi? Proqnoz arzu deyil — o, hunidəki real sövdələşmələrdən, onların mərhələsindən və ehtimalından hesablanır. Yuxarıda rübü seçirsiniz və bütün rəqəmlər həmin dövrə uyğunlaşır.",
          en: "This is the Sales Forecast. It answers one question: are we going to close the quarter? A forecast here isn't a wish — it's computed from the real deals in the pipeline, their stage and their probability. At the top you pick the quarter, and every number below follows it.",
          ru: "Это раздел «Прогноз продаж». Он отвечает на один вопрос: закроем ли мы квартал? Прогноз здесь не пожелание — он считается из реальных сделок в воронке, их стадии и вероятности. Сверху вы выбираете квартал, и все цифры подстраиваются под него.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_TITLE);
          await h.holdUntil(0.5);
          await h.moveTo(fcQuarter(3));
          await h.holdUntil(0.82);
          await h.hover(fcQuarter(3));
        },
      },
      // 2 — The three headline numbers.
      {
        voice: {
          az: "Üç əsas rəqəm var və onları qarışdırmaq olmaz. «Təsdiqlənmiş» — menecerin söz verdiyi, bağlanacağına əmin olduğu məbləğ. «Ən yaxşı ssenari» — hər şey uğurlu getsə nə qədər olacağı. «Huni (çəkili)» — hunidəki bütün sövdələşmələrin ehtimala görə düzəldilmiş dəyəri. Birinci rəqəm öhdəlikdir, ikinci ümiddir, üçüncü isə statistikadır.",
          en: "There are three headline numbers, and they must not be mixed up. “Committed” — what the rep has promised, the amount they're confident will close. “Best case” — what it becomes if everything goes well. “Pipeline, weighted” — the value of every deal in the funnel adjusted by its probability. The first number is a commitment, the second is hope, the third is statistics.",
          ru: "Есть три главные цифры, и путать их нельзя. «Подтверждено» — то, что менеджер пообещал и в чём уверен. «Лучший сценарий» — сколько получится, если всё сложится удачно. «Воронка, взвешенная» — стоимость всех сделок воронки с поправкой на вероятность. Первая цифра — обязательство, вторая — надежда, третья — статистика.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_COMMITTED);
          await h.holdUntil(0.4);
          await h.moveTo(FC_BEST);
          await h.holdUntil(0.68);
          await h.moveTo(FC_PIPELINE);
          await h.holdUntil(0.9);
          await h.hover(FC_PIPELINE);
        },
      },
      // 3 — Quota attainment: the gap.
      {
        voice: {
          az: "Yanında kvota kartı var — rübün planı və onun neçə faizinin artıq bağlandığı. Bax burada: dörd yüz yetmiş mindən səksən dörd min bağlanıb, yəni on səkkiz faiz. Bu, ən dürüst göstəricidir: qalan boşluq həmin rübdə nə qədər iş görülməli olduğunu birbaşa deyir.",
          en: "Next to them is the quota card — the target for the quarter and how much of it is already closed. Here: eighty-four thousand out of four hundred and seventy, which is eighteen percent. That's the most honest indicator on the page: the remaining gap tells you directly how much work the quarter still needs.",
          ru: "Рядом карточка квоты — план на квартал и сколько его уже закрыто. Здесь: восемьдесят четыре тысячи из четырёхсот семидесяти, то есть восемнадцать процентов. Это самый честный показатель: оставшийся разрыв прямо говорит, сколько работы ещё нужно в этом квартале.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_QUOTA);
          await h.holdUntil(0.55);
          await h.moveTo(FC_QUOTA);
          await h.holdUntil(0.85);
          await h.hover(FC_QUOTA);
        },
      },
      // 4 — Quarter switching.
      {
        voice: {
          az: "Rübü dəyişdirmək bir kliklədir. İkinci rübə keçirik — və bütün mənzərə həmin dövrün rəqəmlərinə çevrilir: təsdiqlənmiş məbləğ, kvota, menecerlərin nəticələri. Belə keçid tarixi müqayisə üçün lazımdır: keçən rübdə plana necə çıxmışdıq və indi hansı sürətlə gedirik.",
          en: "Switching the quarter takes one click. We move to the second quarter — and the whole picture becomes that period's numbers: the committed amount, the quota, the reps' results. That switch is what makes historical comparison possible: how we finished last quarter and what pace we're on now.",
          ru: "Смена квартала — один клик. Переходим во второй квартал, и вся картина становится цифрами этого периода: подтверждённая сумма, квота, результаты менеджеров. Такой переход нужен для сравнения: как мы закрыли прошлый квартал и с какой скоростью идём сейчас.",
        },
        do: async (p, l, h) => {
          await h.click(fcQuarter(2));
          await h.sleep(1400);
          await h.holdUntil(0.55);
          await h.hover(FC_COMMITTED);
          await h.holdUntil(0.8);
          await h.click(fcQuarter(3));
        },
      },
      // 5 — The six-month revenue chart.
      {
        voice: {
          az: "Qrafik altı ayı göstərir: faktiki gəlir və proqnoz yan-yana. Burada trend görünür — gəlir artır, düz gedir, yoxsa enir. Bir rübün rəqəmi tək başına az şey deyir; mənzərəni məhz bu xətt verir.",
          en: "The chart covers six months: actual revenue and the forecast side by side. This is where the trend shows — whether revenue is climbing, flat, or sliding. A single quarter's number says little on its own; this line is what gives you the picture.",
          ru: "График показывает шесть месяцев: фактическая выручка и прогноз рядом. Именно здесь виден тренд — растёт выручка, стоит на месте или падает. Цифра одного квартала сама по себе говорит мало; картину даёт именно эта линия.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_CHART);
          await h.holdUntil(0.5);
          await h.moveTo(FC_CHART);
          await h.holdUntil(0.85);
          await h.hover(FC_CHART);
        },
      },
      // 6 — Per-manager attainment.
      {
        voice: {
          az: "Aşağıda menecerlər üzrə kəsik var: hər kəsin planı, bağladığı məbləğ və faizi. Bir baxışda görünür ki, kim planı aşıb — burada yüz beş faiz — və kim çox geri qalıb. Bu, cəza siyahısı deyil, idarəetmə aləti: geri qalanın hunisinə baxıb ona vaxtında kömək etmək lazımdır, rübün sonunda deyil.",
          en: "Below is the per-manager cut: each person's target, what they've closed and their percentage. At a glance you see who is over plan — a hundred and five percent here — and who is far behind. This isn't a shame list, it's a management tool: you look into the laggard's pipeline and help in time, not at the end of the quarter.",
          ru: "Ниже срез по менеджерам: у каждого план, закрытая сумма и процент. С одного взгляда видно, кто перевыполнил — здесь сто пять процентов — и кто сильно отстаёт. Это не список для порицания, а инструмент управления: в воронку отстающего нужно заглянуть вовремя, а не в конце квартала.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_MANAGERS);
          await h.holdUntil(0.45);
          await h.moveTo(FC_MANAGERS);
          await h.holdUntil(0.78);
          await h.hover(FC_MANAGERS);
        },
      },
      // 7 — Per-pipeline totals.
      {
        voice: {
          az: "Sonuncu kəsik hunilər üzrədir: hər hunidə neçə sövdələşmə var, onların ümumi dəyəri və ehtimala görə çəkili dəyəri. Fərqə diqqət edin — ümumi məbləğ bir milyon dörd yüz min, çəkili isə dörd yüz iyirmi üç min. Bu fərq real gözləntinin nə olduğunu göstərir və büdcə planlaşdırarkən məhz ikinci rəqəmə güvənmək lazımdır.",
          en: "The last cut is by pipeline: how many deals sit in each one, their total value and their probability-weighted value. Mind the difference — one point four million in total against four hundred and twenty-three thousand weighted. That gap is what real expectation looks like, and when you plan a budget it's the second number you trust.",
          ru: "Последний срез — по воронкам: сколько в каждой сделок, их общая стоимость и взвешенная по вероятности. Обратите внимание на разницу: миллион четыреста общей суммы против четырёхсот двадцати трёх тысяч взвешенной. Этот разрыв и есть реальное ожидание, и при планировании бюджета доверять нужно именно второй цифре.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_PIPELINES);
          await h.holdUntil(0.5);
          await h.moveTo(FC_PIPELINES);
          await h.holdUntil(0.85);
          await h.hover(FC_PIPELINES);
        },
      },
      // 8 — Closing.
      {
        voice: {
          az: "Beləliklə, bu bölmə rübü bağlamağa nə qədər yaxın olduğunuzu bir ekranda deyir: nə vəd edilib, nə mümkündür, nə real gözlənilir, kim geri qalır və pul hansı hunidədir. Proqnoz hesabat deyil — o, rübün ortasında qərar dəyişdirmək üçün alətdir.",
          en: "So this section tells you on one screen how close you are to closing the quarter: what was promised, what's possible, what's realistically expected, who is behind and which pipeline holds the money. A forecast isn't a report — it's the instrument for changing course in the middle of the quarter.",
          ru: "Итак, раздел на одном экране говорит, насколько вы близки к закрытию квартала: что обещано, что возможно, что реально ожидается, кто отстаёт и в какой воронке лежат деньги. Прогноз — не отчёт, а инструмент, чтобы поменять решение в середине квартала.",
        },
        do: async (p, l, h) => {
          await h.hover(FC_COMMITTED);
          await h.holdUntil(0.4);
          await h.moveTo(FC_QUOTA);
          await h.holdUntil(0.72);
          await h.moveTo(FC_TITLE);
        },
      },
    ],
  },

  sequences: {
    route: "/sequences",
    title: { az: "Satış ssenariləri", en: "Sales Sequences", ru: "Сценарии продаж" },
    scenes: [
      // 1 — What this section is, and what it is NOT.
      {
        voice: {
          az: "Bu, «Satış ssenariləri» bölməsidir — menecerin toxunuş kadensiyası. Burada avtomat müştəriyə özü yazmır: sistem sizə deyir ki, kimə, nə vaxt və hansı kanalla toxunmaq lazımdır, toxunuşu isə canlı adam edir. Marketinq avtomatikası ayrı bölmədədir; burada söhbət satışçının gündəlik intizamındandır — bir lidə üç dəfə yox, planlaşdırılmış beş dəfə toxunmaqdan.",
          en: "This is the Sales Sequences section — the manager's touch cadence. No robot writes to the customer here: the system tells you who to touch, when and through which channel, and a live person performs the touch. Marketing automation lives in a different section; this one is about a salesperson's daily discipline — touching a lead five planned times instead of three random ones.",
          ru: "Это раздел «Сценарии продаж» — каденция касаний менеджера. Здесь робот не пишет клиенту сам: система говорит, кого, когда и каким каналом коснуться, а само касание делает живой человек. Маркетинговая автоматика живёт в другом разделе; здесь речь про ежедневную дисциплину продавца — коснуться лида пять запланированных раз вместо трёх случайных.",
        },
        do: async (p, l, h) => {
          await h.hover(SQ_HEAD);
          await h.holdUntil(0.45);
          await h.moveTo(SQ_QUEUE);
          await h.holdUntil(0.8);
          await h.hover(SQ_QUEUE);
        },
      },
      // 2 — The touch queue: the working surface of the section.
      {
        voice: {
          az: "Səhifənin ən yuxarısında günün toxunuş növbəsi var — bölmənin iş masası budur. Hər sətir bir konkret iş olur: kimə zəng etmək, kimə məktub yazmaq, hansı addımda olduğunuz. Gecikmiş toxunuşlar ayrıca işarələnir. Hər toxunuşu ya «hazırdır», ya «cavab vermədi», ya da «ötür» kimi bağlayırsınız — və növbə azalır. Sağda gündəlik limit var: özünüzə gündə neçə toxunuş qoyduğunuzu təyin edirsiniz ki, növbə real olsun.",
          en: "At the very top sits today's touch queue — the working surface of this section. Every row is one concrete job: who to call, who to write to, which step you're on. Overdue touches are flagged separately. You close each touch as “done”, “no answer” or “skip” — and the queue shrinks. On the right is the daily limit: you decide how many touches a day you take on, so the queue stays realistic.",
          ru: "В самом верху — очередь касаний на сегодня, это рабочая поверхность раздела. Каждая строка — одно конкретное дело: кому позвонить, кому написать, на каком вы шаге. Просроченные касания помечаются отдельно. Каждое касание вы закрываете как «готово», «не дозвонился» или «пропустить» — и очередь тает. Справа дневной лимит: вы сами решаете, сколько касаний в день берёте, чтобы очередь была реальной.",
        },
        do: async (p, l, h) => {
          await h.hover(SQ_QUEUE);
          await h.holdUntil(0.5);
          await h.moveTo(SQ_LIMIT);
          await h.holdUntil(0.85);
          await h.hover(SQ_QUEUE);
        },
      },
      // 3 — The stats row.
      {
        voice: {
          az: "Aşağıdakı göstəricilər kadensiyanın işlədiyini ölçür: ümumi iştirakçılar, aktiv toxunuşlar, cavab payı, qeyd olunan görüşlər və ən maraqlısı — cavaba qədər neçə toxunuş lazım olub. Sonuncu rəqəm çox şey deyir: əgər cavab orta hesabla dördüncü toxunuşdan sonra gəlirsə, deməli üç toxunuşdan sonra dayanan menecer sadəcə nəticəni əldən verir.",
          en: "The indicators below measure whether the cadence works: total enrollments, active touches, the reply rate, meetings booked and — the most telling one — how many touches it took to get a reply. That last number says a lot: if the answer arrives on the fourth touch on average, then a rep who stops after three is simply throwing the result away.",
          ru: "Показатели ниже измеряют, работает ли каденция: всего участников, активные касания, доля ответов, назначенные встречи и самое показательное — сколько касаний потребовалось до ответа. Последняя цифра говорит о многом: если ответ приходит в среднем на четвёртом касании, то менеджер, который останавливается после третьего, просто выбрасывает результат.",
        },
        do: async (p, l, h) => {
          await h.hover(SQ_STATS);
          await h.holdUntil(0.5);
          await h.moveTo(SQ_REPLY);
          await h.holdUntil(0.85);
          await h.hover(SQ_REPLY);
        },
      },
      // 4 — The sequence card.
      {
        voice: {
          az: "Aşağıda ssenarilərin özü var. Kartda hər şey görünür: adı, aktiv olub-olmaması, nə üçün nəzərdə tutulduğu, neçə addımdan ibarətdir, neçə iştirakçısı var və cavab faizi. Məsələn, bu ssenari doxsan gündən çox aktivlik göstərməyən kontaktları geri qaytarmaq üçündür — üç toxunuş. İkincisi isə gələn lidlərə on gün ərzində beş toxunuş.",
          en: "Below are the sequences themselves. The card shows everything: the name, whether it's active, what it's meant for, how many steps it holds, how many people are enrolled and the reply rate. This one, for example, brings back contacts with no activity for over ninety days — three touches. The second gives incoming leads five touches across ten days.",
          ru: "Ниже — сами сценарии. На карточке видно всё: название, активен ли он, для чего предназначен, из скольких шагов состоит, сколько участников и доля ответов. Вот этот, например, возвращает контакты без активности больше девяноста дней — три касания. Второй даёт входящим лидам пять касаний за десять дней.",
        },
        do: async (p, l, h) => {
          await h.hover(SQ_CARD);
          await h.holdUntil(0.55);
          await h.moveTo(SQ_ENROLL);
          await h.holdUntil(0.85);
          await h.hover(SQ_CARD);
        },
      },
      // 5 — Expand: the cadence itself.
      {
        voice: {
          az: "Kartı açaq — kadensiyanın özü buradadır. Hər addımın nömrəsi, kanalı və gözləmə müddəti var: birinci gün elektron məktub, dörd gün sonra zəng, on beş gün sonra seriyanın son məktubu. Kanal e-poçt, zəng, tapşırıq, SMS və ya WhatsApp ola bilər. Yəni «nə vaxt yenidən yazım?» sualı yaddaşdan yox, plandan cavablanır.",
          en: "Let's open the card — the cadence itself lives here. Every step carries its number, its channel and its waiting time: an email on day one, a call four days later, and the final email of the series after fifteen days. The channel can be email, a call, a task, SMS or WhatsApp. So “when do I follow up again?” is answered by the plan, not by memory.",
          ru: "Откроем карточку — сама каденция здесь. У каждого шага есть номер, канал и время ожидания: письмо в первый день, звонок через четыре дня и последнее письмо серии через пятнадцать. Канал может быть письмом, звонком, задачей, SMS или WhatsApp. То есть на вопрос «когда написать снова?» отвечает план, а не память.",
        },
        do: async (p, l, h) => {
          await h.click(SQ_CARD_TOGGLE);
          await h.sleep(1200);
          await h.holdUntil(0.55);
          await h.hover(SQ_TAB_STEPS);
          await h.holdUntil(0.85);
          await h.moveTo(SQ_TAB_PARTICIPANTS);
        },
      },
      // 6 — Participants.
      {
        voice: {
          az: "«İştirakçılar» vərəqi kimin bu ssenaridən keçdiyini göstərir: hansı lid və ya kontakt, hansı addımdadır, nə vaxt növbəti toxunuş olacaq. Beləcə kadensiya qara qutu deyil — istənilən anda konkret adamın harada olduğunu görürsünüz.",
          en: "The “Participants” tab shows who is going through this sequence: which lead or contact, which step they're on, when the next touch is due. So the cadence isn't a black box — at any moment you can see exactly where a given person stands.",
          ru: "Вкладка «Участники» показывает, кто проходит этот сценарий: какой лид или контакт, на каком он шаге, когда следующее касание. То есть каденция не чёрный ящик — в любой момент видно, где именно находится конкретный человек.",
        },
        do: async (p, l, h) => {
          await h.click(SQ_TAB_PARTICIPANTS);
          await h.sleep(1000);
          await h.holdUntil(0.6);
          await h.hover(SQ_CARD);
          await h.holdUntil(0.88);
          await h.moveTo(SQ_TAB_STEPS);
        },
      },
      // 7 — Enrolling and the stop rules.
      {
        voice: {
          az: "İnsanlar ssenariyə «Qeyd et» düyməsi ilə düşür — bir lidi də, bir siyahını da qeyd etmək olar; həmçinin lid mənbəyinə görə avtomatik qeyd qurmaq mümkündür. Ən vacib qayda isə dayanma şərtləridir: müştəri cavab verəndə, görüş qeyd olunanda və ya sövdələşmə bağlananda ssenari özü dayanır. Yəni cavab verən adama sistem daha «unudulmuş» məktub göndərmir — bu, kadensiyanı nəzakətli edən şeydir.",
          en: "People enter a sequence through the “Enroll” button — you can enroll a single lead or a whole list, and you can also auto-enroll by lead source. But the most important rule is the stop conditions: the sequence halts by itself when the person replies, when a meeting is logged, or when the related deal closes. So somebody who answered never receives a forgotten follow-up — that's what keeps the cadence polite.",
          ru: "Люди попадают в сценарий через кнопку «Записать» — можно записать одного лида или целый список, а ещё настроить авто-запись по источнику лида. Но самое важное — условия остановки: сценарий сам прекращается, когда человек ответил, когда назначена встреча или когда закрылась сделка. То есть ответившему система не пришлёт забытое письмо вдогонку — именно это делает каденцию вежливой.",
        },
        do: async (p, l, h) => {
          await h.moveTo(SQ_ENROLL);
          await h.holdUntil(0.45);
          await h.hover(SQ_ENROLL);
          await h.holdUntil(0.8);
          await h.moveTo(SQ_DEACTIVATE);
        },
      },
      // 8 — Analytics: leaderboard + step funnel.
      {
        voice: {
          az: "«Analitika» iki suala cavab verir. Birincisi — menecer reytinqi: kim neçə adam qeyd edib, neçə cavab və neçə görüş alıb. İkincisi — addım hunisi: qeydiyyatdan keçənlərin neçəsi hansı addıma çatıb. Huni harada qırılırsa, problem də oradadır: adamlar ikinci toxunuşdan sonra dayanırsa, deməli ya mətn zəifdir, ya da menecer növbəni sona qədər aparmır.",
          en: "“Analytics” answers two questions. First, the rep leaderboard: who enrolled how many people, how many replies and meetings they got. Second, the step funnel: how many of the enrolled actually reached each step. Wherever the funnel breaks, that's where the problem is: if people stop after the second touch, either the copy is weak or the rep isn't working the queue to the end.",
          ru: "«Аналитика» отвечает на два вопроса. Первый — рейтинг менеджеров: кто сколько людей записал, сколько получил ответов и встреч. Второй — воронка по шагам: сколько записанных реально дошли до каждого шага. Где воронка рвётся, там и проблема: если люди останавливаются после второго касания, значит либо текст слабый, либо менеджер не доводит очередь до конца.",
        },
        do: async (p, l, h) => {
          await h.click(SQ_ANALYTICS);
          await h.sleep(1200);
          await h.holdUntil(0.5);
          await h.hover(SQ_LEADERBOARD);
          await h.holdUntil(0.82);
          await h.moveTo(SQ_FUNNEL);
        },
      },
      // 9 — Closing.
      {
        voice: {
          az: "Yekunda: ssenari planı qurur, növbə hər gün konkret işi verir, dayanma şərtləri isə artıq lazım olmayanda hər şeyi söndürür. Yeni kadensiyanı «Yeni ardıcıllıq» ilə yaradırsınız. Nəticə odur ki, lid unudulduğu üçün yox, yalnız həqiqətən maraqlanmadığı üçün itir.",
          en: "To sum up: the sequence sets the plan, the queue hands you a concrete job every day, and the stop rules switch everything off when it's no longer needed. You create a new cadence with “New Sequence”. The result is that a lead is lost only because they truly weren't interested — never because they were forgotten.",
          ru: "Итого: сценарий задаёт план, очередь каждый день выдаёт конкретное дело, а условия остановки выключают всё, когда оно больше не нужно. Новую каденцию вы создаёте кнопкой «Новая серия». Результат в том, что лид теряется только потому, что ему действительно не интересно, а не потому, что о нём забыли.",
        },
        do: async (p, l, h) => {
          await h.hover(SQ_CARD);
          await h.holdUntil(0.4);
          await h.moveTo(SQ_NEW);
          await h.holdUntil(0.72);
          await h.hover(SQ_QUEUE);
        },
      },
    ],
  },

  quotes: {
    route: "/quotes",
    title: { az: "Kommersiya təklifləri", en: "Quotes", ru: "Коммерческие предложения" },
    scenes: [
      // 1 — What the section is.
      {
        voice: {
          az: "Bu, «Kommersiya təklifləri» bölməsidir — müştəriyə göndərdiyiniz rəsmi təklifin CRM-dəki yeri. Sövdələşmə danışıq mərhələsinə çatanda söz artıq kifayət etmir: müştəriyə nəyi, hansı qiymətə və hansı şərtlərlə təklif etdiyinizi sənəd şəklində göndərmək lazımdır. Bu bölmə həmin sənədi sövdələşmənin özündən qurur və hər təklifin taleyini izləyir.",
          en: "This is the Quotes section — where the formal proposal you send to a customer lives inside the CRM. Once a deal reaches negotiation, words are no longer enough: the customer needs a document stating what you offer, at what price and on what terms. This section builds that document out of the deal itself and then tracks what happens to it.",
          ru: "Это раздел «Коммерческие предложения» — место, где внутри CRM живёт официальное предложение, которое вы отправляете клиенту. Когда сделка доходит до переговоров, слов уже мало: клиенту нужен документ с тем, что вы предлагаете, по какой цене и на каких условиях. Этот раздел собирает такой документ из самой сделки и отслеживает его дальнейшую судьбу.",
        },
        do: async (p, l, h) => {
          await h.hover(Q_TITLE);
          await h.holdUntil(0.42);
          await h.moveTo(Q_TABLE);
          await h.holdUntil(0.78);
          await h.hover(Q_TABLE);
        },
      },
      // 2 — The table columns = the answer to "where does this quote stand".
      {
        voice: {
          az: "Siyahı hər təklif haqqında əsas sualları bir sətirdə cavablandırır: təklifin nömrəsi, hansı sövdələşməyə bağlıdır, statusu, neçə sətirdən ibarətdir, ümumi məbləği, etibarlılıq tarixi və nə vaxt yaradılıb. Etibarlılıq tarixinə xüsusi diqqət: təklifin müddəti bitibsə, qiymətlər artıq sizin öhdəliyiniz deyil — bunu vaxtında görmək lazımdır.",
          en: "The list answers the key questions about every quote in a single row: its number, which deal it belongs to, its status, how many lines it holds, the total, the valid-until date and when it was created. Watch the validity date in particular: once a quote expires, those prices are no longer your commitment — and you want to see that in time.",
          ru: "Список отвечает на главные вопросы о каждом предложении одной строкой: номер, к какой сделке привязано, статус, сколько в нём позиций, общая сумма, срок действия и когда создано. Особое внимание — сроку действия: когда предложение истекло, эти цены больше не ваше обязательство, и увидеть это нужно вовремя.",
        },
        do: async (p, l, h) => {
          await h.hover(Q_ROW(3));
          await h.holdUntil(0.5);
          await h.moveTo(Q_ROW(4));
          await h.holdUntil(0.82);
          await h.hover(Q_ROW(5));
        },
      },
      // 3 — The lifecycle, driven by the status chips.
      {
        voice: {
          az: "Yuxarıdakı filtrlər təklifin həyat yolunu göstərir: qaralama, göndərildi, baxıldı, qəbul edildi, rədd edildi, müddəti bitib. «Baxıldı» filtrinə klik edirik — və ekranda müştərinin açıb oxuduğu təkliflər qalır. Bu, satışçı üçün ən dəyərli siqnaldır: adam təklifi görüb, amma hələ cavab verməyib — deməli, indi zəng etmək lazımdır.",
          en: "The filters at the top lay out a quote's life: draft, sent, viewed, accepted, rejected, expired. We click “Viewed” — and only the quotes the customer actually opened stay on screen. For a salesperson that's the most valuable signal of all: the person has seen the offer but hasn't replied yet — which means now is the moment to call.",
          ru: "Фильтры сверху показывают жизненный путь предложения: черновик, отправлено, просмотрено, принято, отклонено, истекло. Кликаем «Просмотрено» — и на экране остаются предложения, которые клиент действительно открыл. Для продавца это самый ценный сигнал: человек увидел предложение, но ещё не ответил — значит, звонить нужно сейчас.",
        },
        do: async (p, l, h) => {
          await h.hover(Q_CHIPS);
          await h.holdUntil(0.4);
          await h.click(Q_CHIP_VIEWED);
          await h.holdUntil(0.75);
          await h.hover(Q_TABLE);
        },
      },
      // 4 — Search, then open a quote that actually has line items.
      {
        voice: {
          az: "Filtri geri qaytarıb konkret sənədi tapaq. Axtarış nömrəyə, sövdələşməyə və qeydlərə görə işləyir — yüzlərlə təklif arasında lazım olanı saniyələrlə tapırsınız. İndi bu təklifi açırıq və içəridə nə olduğuna baxırıq.",
          en: "Let's put the filter back and find one specific document. Search works by number, by deal and by notes — among hundreds of quotes you find the one you need in seconds. Now we open this quote and look at what's inside.",
          ru: "Вернём фильтр и найдём конкретный документ. Поиск работает по номеру, по сделке и по заметкам — среди сотен предложений нужное находится за секунды. Теперь откроем это предложение и посмотрим, что внутри.",
        },
        do: async (p, l, h) => {
          await h.click(Q_CHIP_ALL);
          await h.sleep(700);
          await h.holdUntil(0.35);
          await h.fill(Q_SEARCH, "q-2026");
          await h.holdUntil(0.72);
          await h.click(Q_ROW(1));
          await h.sleep(1500);
        },
      },
      // 5 — The quote header: number, status, and what the actions mean.
      {
        voice: {
          az: "Təklifin özü açıldı. Yuxarıda nömrəsi və statusu, yanında isə bütün idarəetmə düymələri var: təklifi göndərilmiş kimi işarələmək, müddəti bitmiş kimi işarələmək, yadda saxlamaq, müştəri üçün PDF açmaq və silmək. Status əl ilə idarə olunur, çünki təklifi necə göndərdiyinizi — poçtla, mesajla və ya şəxsən — məhz siz bilirsiniz.",
          en: "The quote itself is open. At the top sit its number and status, and next to them every control: mark it as sent, mark it as expired, save, open the customer-facing PDF, or delete it. The status is driven by hand, because only you know how the quote actually went out — by email, by message or in person.",
          ru: "Само предложение открыто. Сверху его номер и статус, рядом — все элементы управления: отметить отправленным, отметить истёкшим, сохранить, открыть PDF для клиента и удалить. Статусом управляете вы вручную, потому что только вы знаете, как предложение ушло — почтой, сообщением или лично.",
        },
        do: async (p, l, h) => {
          await h.hover(QD_HEAD);
          await h.holdUntil(0.4);
          await h.moveTo(QD_MARK_SENT);
          await h.holdUntil(0.68);
          await h.moveTo(QD_PDF);
          await h.holdUntil(0.9);
          await h.moveTo(QD_SAVE);
        },
      },
      // 6 — The binding to the deal + the Advisor risk card.
      {
        voice: {
          az: "Aşağıda təklifin sövdələşmə ilə bağlantısı var — buna görə sənəd havadan asılı qalmır, konkret sövdələşmənin və müştərinin tarixçəsinə yazılır. Ayrıca «Advisor riski» kartı: süni intellekt bu sənəd üzrə risk görürsə — məsələn, təklif göndərilib, amma cavab yoxdursa — bunu elə burada deyir.",
          en: "Below is the quote's binding to a deal — that's why the document doesn't hang in mid-air but is written into the history of a specific deal and customer. And there's the “Advisor risk” card: if the AI sees a risk on this document — the quote was sent but there's no answer, say — it tells you right here.",
          ru: "Ниже — привязка предложения к сделке: именно поэтому документ не висит в воздухе, а записывается в историю конкретной сделки и клиента. И отдельная карточка «Риск Advisor»: если ИИ видит риск по этому документу — например, предложение отправлено, а ответа нет — он скажет об этом прямо здесь.",
        },
        do: async (p, l, h) => {
          await h.hover(QD_CUSTOMER);
          await h.holdUntil(0.5);
          await h.moveTo(QD_RISK);
          await h.holdUntil(0.85);
          await h.hover(QD_RISK);
        },
      },
      // 7 — Line items: the substance of the offer.
      {
        voice: {
          az: "Ən vacib hissə — sətirlər. Hər sətir bir mövqedir: məhsul və ya xidmət, növü — avadanlıq, lisenziya, abunəlik, xidmət, digər — SKU nömrəsi, təsvir, miqdar, vahid qiymət, endirim və sətir cəmi. Düstur sadədir: miqdar vurulsun vahid qiymətə, çıxılsın endirim. «Sətir əlavə et» ilə yeni mövqe əlavə edirik — beləcə təklifi tam şəkildə yığırsınız.",
          en: "The most important part — the lines. Each line is one position: the product or service, its type — equipment, licence, subscription, service, other — the SKU, a description, the quantity, the unit price, the discount and the line total. The formula is simple: quantity times unit price, minus the discount. With “Add line” we append a new position — that's how the offer is assembled in full.",
          ru: "Самая важная часть — позиции. Каждая строка — это одна позиция: товар или услуга, её тип — оборудование, лицензия, подписка, услуга, другое — артикул, описание, количество, цена за единицу, скидка и сумма строки. Формула простая: количество умножить на цену, минус скидка. Кнопкой «Добавить позицию» добавляем новую строку — так предложение собирается целиком.",
        },
        do: async (p, l, h) => {
          await h.hover(QD_LINES);
          await h.holdUntil(0.4);
          await h.moveTo(QD_TYPE_SELECT);
          await h.holdUntil(0.7);
          await h.click(QD_ADD_LINE);
          await h.holdUntil(0.9);
          await h.hover(QD_LINES);
        },
      },
      // 8 — Quote-level discount and the summary block.
      {
        voice: {
          az: "Sətir endirimlərindən başqa bütün təklif üzrə ümumi endirim də var — onu ya məbləğlə, ya da faizlə verirsiniz. Aşağıdakı «Yekun» bloku hesabı özü aparır: aralıq cəm, endirim və yekun məbləğ. Yəni müzakirədə «beş faiz endirim etsək nə olar?» sualına dərhal dəqiq rəqəmlə cavab verirsiniz.",
          en: "Besides per-line discounts there's a discount on the whole quote — you set it either as an amount or as a percentage. The “Summary” block below does the arithmetic for you: subtotal, discount and the final total. So when someone asks “what if we give five percent?”, you answer with an exact number on the spot.",
          ru: "Кроме скидок по строкам есть скидка на всё предложение — её задают либо суммой, либо процентом. Блок «Итого» ниже считает сам: подытог, скидка и финальная сумма. То есть на вопрос «а если дадим пять процентов?» вы отвечаете точной цифрой сразу.",
        },
        do: async (p, l, h) => {
          await p.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
          await h.hover(QD_DISCOUNT);
          await h.holdUntil(0.5);
          await h.moveTo(QD_SUMMARY);
          await h.holdUntil(0.85);
          await h.hover(QD_SUMMARY);
        },
      },
      // 9 — Closing: the loop deal → document → decision.
      {
        voice: {
          az: "Beləliklə, dövrə tamamlanır: sövdələşmə təklifə çevrilir, təklif PDF şəklində müştəriyə gedir, statusu isə cavabı göstərir — baxıldı, qəbul edildi və ya müddəti bitdi. Hər rəqəm sənəddə yazılıdır, hər sənəd sövdələşməyə bağlıdır. Nəticədə «biz ona nə təklif etmişdik?» sualı bir daha yaddaşdan yox, sistemdən cavablanır.",
          en: "So the loop closes: the deal becomes a quote, the quote goes to the customer as a PDF, and its status reflects the answer — viewed, accepted, or expired. Every number is written into the document, every document is tied to its deal. And the question “what exactly did we offer them?” is answered by the system instead of somebody's memory.",
          ru: "Так круг замыкается: сделка превращается в предложение, предложение уходит клиенту в PDF, а его статус отражает ответ — просмотрено, принято или истекло. Каждая цифра записана в документе, каждый документ привязан к своей сделке. И на вопрос «что именно мы им предлагали?» отвечает система, а не чья-то память.",
        },
        do: async (p, l, h) => {
          await h.moveTo(QD_BACK);
          await h.holdUntil(0.4);
          await h.click(QD_BACK);
          await h.sleep(1400);
          await h.holdUntil(0.75);
          await h.hover(Q_TABLE);
        },
      },
    ],
  },

  "lead-rules": {
    route: "/settings/lead-rules",
    title: { az: "Lid Təyinat Qaydaları", en: "Lead Assignment Rules", ru: "Правила назначения лидов" },
    scenes: [
      // 1 — The problem the section solves.
      {
        voice: {
          az: "Bu bölmə bir sualı həll edir: yeni lid kimin üzərinə düşsün? Əl ilə paylayanda vaxt itir — lid saatlarla sahibsiz qalır, halbuki satışda ilk cavabın sürəti hər şeyi həll edir. «Lid Təyinat Qaydaları» bu paylamanı avtomatlaşdırır: qaydanı bir dəfə yazırsınız, sistem sonra hər yeni lidi özü düzgün adama yönləndirir.",
          en: "This section answers one question: who should a new lead go to? Handing them out by hand wastes time — a lead sits ownerless for hours, while in sales the speed of the first reply decides everything. Lead Assignment Rules automate that hand-off: you write the rule once, and the system routes every new lead to the right person by itself.",
          ru: "Этот раздел решает один вопрос: кому достанется новый лид? Раздавать вручную — терять время: лид часами остаётся без владельца, хотя в продажах всё решает скорость первого ответа. «Правила назначения лидов» автоматизируют раздачу: вы один раз описываете правило, а дальше система сама направляет каждый новый лид нужному человеку.",
        },
        do: async (p, l, h) => {
          await h.hover(LR_HEADER);
          await h.holdUntil(0.45);
          await h.moveTo(LR_KPIS);
          await h.holdUntil(0.8);
          await h.hover(LR_KPIS);
        },
      },
      // 2 — The three counters, walked one by one.
      {
        voice: {
          az: "Yuxarıdakı üç göstərici bölmənin vəziyyətini deyir. Ümumi qaydalar — nə qədər qayda yazılıb. Aktiv qaydalar — onlardan neçəsi həqiqətən işləyir; yazılıb, amma yandırılmayıb — deməli işləmir. Məsul şəxslər — qaydaların lidləri neçə nəfər arasında payladığı. Bu üç rəqəm avtomatlaşdırmanın canlı olduğunu bir baxışda göstərir.",
          en: "The three counters at the top state the health of the section. Total rules — how many are written. Active rules — how many actually run; written but not switched on means it does nothing. Assignees — how many people the rules route leads to. These three numbers show at a glance whether the automation is alive.",
          ru: "Три счётчика сверху говорят о состоянии раздела. Всего правил — сколько написано. Активные правила — сколько из них реально работает; написано, но не включено — значит не работает. Ответственные — между сколькими людьми правила раздают лиды. Эти три числа с одного взгляда показывают, жива ли автоматизация.",
        },
        do: async (p, l, h) => {
          await h.hover(kpiTile(1));
          await h.holdUntil(0.4);
          await h.hover(kpiTile(2));
          await h.holdUntil(0.68);
          await h.hover(kpiTile(3));
          await h.holdUntil(0.9);
          await h.moveTo(LR_LIST);
        },
      },
      // 3 — Read the first real rule out loud while pointing at its parts.
      {
        voice: {
          az: "Aşağıda real qaydalara baxaq. Birincisi belə deyir: gözlənilən məbləği on min manatdan çox olan lid dərhal satış rəhbərinin üzərinə düşsün. Kartda hər şey görünür: qayda aktivdir, şərtə əsaslanır, prioriteti beşdir, şərti «estimated_value böyükdür və ya bərabərdir on min», aşağıda isə məsul şəxsin identifikatoru. Yəni qaydanı açmadan da onun nə etdiyini oxuyursunuz.",
          en: "Let's look at the real rules below. The first one says: a lead with an expected value above ten thousand goes straight to the head of sales. The card shows everything: the rule is active, it is condition-based, its priority is five, its condition reads “estimated value greater or equal ten thousand”, and underneath sits the assignee's identifier. So you read what a rule does without opening it.",
          ru: "Посмотрим на реальные правила ниже. Первое говорит: лид с ожидаемой суммой больше десяти тысяч сразу уходит руководителю продаж. На карточке видно всё: правило активно, оно по условиям, приоритет пять, условие «estimated value больше или равно десяти тысячам», а ниже — идентификатор ответственного. То есть вы читаете, что делает правило, не открывая его.",
        },
        do: async (p, l, h) => {
          await showBlock(p, "lead-rules-list");
          await h.hover(ruleCard(1));
          await h.holdUntil(0.42);
          await h.moveTo(ruleCondition(1));
          await h.holdUntil(0.72);
          await h.moveTo(ruleAssignee(1));
        },
      },
      // 4 — The second rule + why priority order decides the outcome.
      {
        voice: {
          az: "İkinci qayda: mənbəyi TikTok olan lidlər SMM komandasına gedir və iki nəfər arasında növbə ilə bölünür. Diqqət edin — onun prioriteti ondur, birincinin isə beş. Sistem qaydaları prioritetin artan sırası ilə yoxlayır və uyğun gələn ilk qaydada dayanır. Deməli, TikTok-dan gələn əlli minlik lid birinci qaydaya düşür və rəhbərə gedir, adi TikTok lidi isə ikinciyə çatıb komandaya bölünür. Sıra təsadüfi deyil — nəticəni məhz o həll edir.",
          en: "The second rule: leads whose source is TikTok go to the social team and rotate between two people. Notice its priority is ten, while the first one's is five. The system checks the rules in ascending priority and stops at the first match. So a fifty-thousand lead coming from TikTok falls into the first rule and goes to the head of sales, while an ordinary TikTok lead reaches the second one and is shared by the team. The order isn't decorative — it decides the outcome.",
          ru: "Второе правило: лиды с источником TikTok уходят SMM-команде и распределяются по очереди между двумя людьми. Обратите внимание — у него приоритет десять, а у первого пять. Система проверяет правила по возрастанию приоритета и останавливается на первом подошедшем. Значит, лид на пятьдесят тысяч из TikTok попадёт в первое правило и уйдёт руководителю, а обычный TikTok-лид дойдёт до второго и разделится между командой. Порядок не для красоты — именно он решает исход.",
        },
        do: async (p, l, h) => {
          await h.hover(ruleCard(2));
          await h.holdUntil(0.35);
          await h.moveTo(ruleCondition(2));
          await h.holdUntil(0.6);
          await h.moveTo(ruleAssignee(2));
          await h.holdUntil(0.85);
          await h.moveTo(ruleCard(1));
        },
      },
      // 5 — Open the editor on the spare empty rule and name it live.
      {
        voice: {
          az: "İndi öz qaydamızı quraq. Karandaş düyməsi redaktoru açır — o, elə səhifənin içində açılır. Birinci sətir ad və prioritetdir. Adı elə yazıram ki, altı ay sonra da başa düşülsün: «Bakı lidləri — Kənana». Yanına prioritet qoyuram: iyirmi — yəni bu qayda mövcud iki qaydadan sonra yoxlanacaq.",
          en: "Now let's build our own rule. The pencil opens the editor right inside the page. The first row is the name and the priority. I type a name that will still make sense in six months: “Baku leads — to Kanan.” Next to it I set the priority to twenty, so this rule is checked after the two that already exist.",
          ru: "Теперь соберём своё правило. Карандаш открывает редактор прямо внутри страницы. Первая строка — название и приоритет. Пишу название так, чтобы оно было понятно и через полгода: «Бакинские лиды — Кянану». Рядом ставлю приоритет двадцать: значит, это правило будет проверяться после двух существующих.",
        },
        do: async (p, l, h) => {
          await h.click(LR_EDIT_LAST);
          await h.sleep(1100);
          await showBlock(p, "lead-rules-list");
          await h.holdUntil(0.42);
          await h.fill(LR_NAME, "Bakı lidləri — Kənana");
          await h.holdUntil(0.78);
          await h.fill(LR_PRIORITY, "20");
        },
      },
      // 6 — The method switch, actually flipped on camera.
      {
        voice: {
          az: "Növbəti seçim — metod. «Round Robin» seçsəm, qayda şərtlərə baxmır: lidləri sadəcə məsul şəxslər arasında növbə ilə bərabər paylayır — bu, yükü ədalətli bölmək üçündür. Amma bizə ünvanlı qayda lazımdır, ona görə «Şərtə əsaslanan» rejimə qayıdıram: lid yalnız şərtlərə uyğun gələndə təyin olunacaq.",
          en: "The next choice is the method. If I pick “Round robin”, the rule ignores conditions: it simply shares leads between the assignees in turn — that's for splitting the load fairly. But we need a targeted rule, so I switch back to “Condition-based”: the lead will be assigned only when it matches the conditions.",
          ru: "Следующий выбор — метод. Если выбрать «Round Robin», правило не смотрит на условия: оно просто раздаёт лиды между ответственными по очереди — это для честного распределения нагрузки. Но нам нужно адресное правило, поэтому возвращаюсь в режим «По условиям»: лид назначится только при совпадении условий.",
        },
        do: async (p, l, h) => {
          await pickOption(h, lrSelect(0), "round_robin");
          await h.holdUntil(0.55);
          await pickOption(h, lrSelect(0), "condition");
          await h.holdUntil(0.85);
          await h.hover(LR_LIST);
        },
      },
      // 7 — Build the condition on camera: field → operator → value.
      {
        voice: {
          az: "İndi şərti quraq. Şərt üç hissədən ibarətdir: sahə, müqayisə və dəyər. Sahələr siyahısında lidin mənbəyi, gözlənilən məbləği, marağı, şirkətin ölçüsü, ölkə və sahə var — mən «country» seçirəm. Müqayisə olaraq «bərabərdir» qalır, dəyər olaraq «Azerbaijan» yazıram. Bir qaydaya bir neçə şərt əlavə etmək olar, amma yadda saxlayın: qayda işləsin deyə onların hamısı eyni anda uyğun gəlməlidir.",
          en: "Now the condition. It is built from three parts: the field, the comparison and the value. The field list holds the lead's source, expected value, interest, company size, country and industry — I pick “country”. The comparison stays “equals”, and for the value I type “Azerbaijan”. You can add several conditions to one rule, but remember: all of them must match at the same time for the rule to fire.",
          ru: "Теперь условие. Оно собирается из трёх частей: поле, сравнение и значение. В списке полей — источник лида, ожидаемая сумма, интерес, размер компании, страна и отрасль; выбираю «country». Сравнение оставляю «равно», а значением пишу «Azerbaijan». В одно правило можно добавить несколько условий, но помните: чтобы правило сработало, совпасть должны все сразу.",
        },
        do: async (p, l, h) => {
          await pickOption(h, lrSelect(1), "country");
          await h.holdUntil(0.35);
          await pickOption(h, lrSelect(2), "==");
          await h.holdUntil(0.58);
          await h.fill(LR_VALUE, "Azerbaijan");
          await h.holdUntil(0.85);
          await h.moveTo(LR_ADD_COND);
        },
      },
      // 8 — Assignees, then leave without saving.
      {
        voice: {
          az: "Sonuncu sahə — məsul şəxslər. Bir nəfər yazsanız, uyğun lidlər həmişə ona gedir; bir neçə nəfər yazsanız, sistem onların arasında növbə ilə bölür. Məsul şəxs yoxdursa, qayda sadəcə keçilir — ən çox rast gəlinən səhv budur. Qaydanı «Yadda saxla» ilə yazır, sonra kartdakı düymə ilə yandırırsınız. Biz isə nümunə üçün heç nə dəyişmirik: «Ləğv et» ilə çıxırıq.",
          en: "The last field is the assignees. Put one person there and every matching lead always goes to them; put several and the system rotates between them. With no assignee the rule is simply skipped — that's the most common mistake. You store the rule with “Save” and then switch it on with the button on the card. For this demo we change nothing: we leave with Cancel.",
          ru: "Последнее поле — ответственные. Укажете одного — все подходящие лиды всегда идут к нему; укажете нескольких — система распределяет между ними по очереди. Без ответственного правило просто пропускается — это самая частая ошибка. Правило сохраняется кнопкой «Сохранить», а включается кнопкой на карточке. Мы же для примера ничего не меняем: выходим по «Отмена».",
        },
        do: async (p, l, h) => {
          await h.fill(LR_ASSIGNEES, "Kənan Məmmədov");
          await h.holdUntil(0.5);
          await h.moveTo(LR_SAVE);
          await h.holdUntil(0.82);
          await h.click(MODAL_CANCEL);
        },
      },
      // 9 — The whole loop, end to end.
      {
        voice: {
          az: "Yekunda məntiq belədir: yeni lid yaranan kimi sistem yalnız aktiv qaydaları götürür, prioritet sırası ilə yoxlayır və uyğun gələn ilk qaydada dayanır — lid həmin adamın üzərinə düşür. Yeni qaydanı «Qayda Əlavə Et» ilə yaradır, prioritetlə sıralayır və yandırırsınız. Nəticə: heç bir lid sahibsiz qalmır, paylama kiminsə yadına düşməsindən asılı olmur, ilk cavab isə saatlarla yox, dəqiqələrlə ölçülür.",
          en: "So the whole loop is this: the moment a new lead appears, the system takes only the active rules, checks them in priority order and stops at the first match — the lead lands on that person. You create a new rule with “Add Rule”, order it by priority and switch it on. The result: no lead is left ownerless, the hand-off no longer depends on who remembered it, and the first reply is measured in minutes instead of hours.",
          ru: "Итого весь цикл такой: как только появляется новый лид, система берёт только активные правила, проверяет их по порядку приоритета и останавливается на первом подошедшем — лид оказывается у этого человека. Новое правило вы создаёте кнопкой «Добавить правило», расставляете по приоритету и включаете. Результат: ни один лид не остаётся без владельца, раздача не зависит от того, кто про неё вспомнил, а первый ответ измеряется минутами, а не часами.",
        },
        do: async (p, l, h) => {
          await h.hover(ruleCard(1));
          await h.holdUntil(0.35);
          await h.moveTo(ruleCard(2));
          await h.holdUntil(0.62);
          await h.moveTo(LR_NEW);
          await h.holdUntil(0.85);
          await h.hover(LR_KPIS);
        },
      },
    ],
  },

  leads: {
    route: "/leads",
    title: { az: "Lidlər", en: "Leads", ru: "Лиды" },
    scenes: [
      // 1 — What the section is + the live counters.
      {
        voice: {
          az: "Bu, «Lidlər» bölməsidir — satışın ilk mərhələsi. Maraq göstərən hər adam, gələn hər müraciət burada bir kartda toplanır və heç biri itmir. Yuxarıda bölmənin nəbzi görünür: neçə lid var, orta bal nədir, neçəsi artıq sövdələşməyə çevrilib. Yəni siz sadəcə siyahıya yox, işin real vəziyyətinə baxırsınız.",
          en: "This is the Leads section — the first stage of sales. Every person who shows interest, every incoming request lands here as a card, and none of them gets lost. At the top you see the pulse of the section: how many leads there are, what the average score is, how many have already been converted into deals. So you're not looking at a list — you're looking at the real state of the work.",
          ru: "Это раздел «Лиды» — первая стадия продаж. Каждый проявивший интерес человек, каждое входящее обращение попадает сюда карточкой, и ни один не теряется. Сверху виден пульс раздела: сколько лидов, какой средний балл, сколько уже превратилось в сделки. То есть вы смотрите не на список, а на реальное состояние работы.",
        },
        do: async (p, l, h) => {
          await h.hover(LEADS_HEAD);
          await h.holdUntil(0.38);
          await h.moveTo(LEADS_SCORE);
          await h.holdUntil(0.72);
          await h.hover(LEADS_SCORE);
        },
      },
      // 2 — Da Vinci scoring: why a lead gets its grade.
      {
        voice: {
          az: "Hər lidin öz balı və hərfi var — bunu Da Vinci özü hesablayır. Səkkiz amilə baxır: korporativ email üstünə on bal, C-səviyyəli vəzifə iyirmi bal, qeydlərdə «büdcə» sözü daha on bal, köhnəlmiş lid isə on beş bal itirir. Buna görə A hərfli lid təsadüfi deyil — o, dəlillə seçilib. Siz isə kimə birinci zəng edəcəyinizi təxminlə yox, balla qərar verirsiniz.",
          en: "Every lead carries a score and a grade — Da Vinci calculates it by itself. It looks at eight factors: a corporate email adds ten points, a C-level title adds twenty, the word “budget” in the notes adds another ten, while a stale lead loses fifteen. So an A-grade lead isn't an accident — it was picked with evidence. And you decide who to call first by score, not by gut feeling.",
          ru: "У каждого лида есть балл и буква — их считает сам Da Vinci. Он смотрит на восемь факторов: корпоративная почта плюс десять баллов, должность C-уровня плюс двадцать, слово «бюджет» в заметках ещё плюс десять, а устаревший лид теряет пятнадцать. Поэтому лид с буквой A — не случайность, он выбран по доказательствам. А вы решаете, кому звонить первым, по баллу, а не на глаз.",
        },
        do: async (p, l, h) => {
          await h.hover(LEADS_SCORE);
          await h.holdUntil(0.4);
          await h.moveTo(LEADS_BOARD);
          await h.holdUntil(0.75);
          await h.hover(LEADS_BOARD);
        },
      },
      // 3 — The status board: the lead's path, and drag to move it.
      {
        voice: {
          az: "Aşağıda lidin yolu var: yeni, əlaqə quruldu, kvalifikasiya edildi, çevrildi, itirildi. Hər sütun bir mərhələdir və hər kartda ad, şirkət, bal və gözlənilən məbləğ görünür. Kartı qonşu sütuna sürüklədikdə mərhələ dərhal dəyişir — vəziyyəti yeniləmək üçün heç bir forma açmağa ehtiyac yoxdur.",
          en: "Below is the lead's journey: new, contacted, qualified, converted, lost. Each column is a stage, and each card shows the name, the company, the score and the expected amount. Drag a card into the next column and the stage changes immediately — you don't have to open a single form to update the state.",
          ru: "Ниже — путь лида: новый, связались, квалифицирован, конвертирован, потерян. Каждая колонка — это стадия, а на карточке видно имя, компанию, балл и ожидаемую сумму. Перетащите карточку в соседнюю колонку — стадия изменится сразу, и открывать какую-либо форму для этого не нужно.",
        },
        do: async (p, l, h) => {
          await showBlock(p, "leads-convert");
          await h.hover(LEADS_BOARD);
          await h.holdUntil(0.45);
          await h.moveTo(LEADS_FILTER);
          await h.holdUntil(0.78);
          await h.hover(LEADS_BOARD);
        },
      },
      // 4 — Status chips: focus on the qualified ones.
      {
        voice: {
          az: "Statuslara görə süzgəcləmək bir kliklə olur. «Kvalifikasiya edildi» filtrinə basırıq — və ekranda yalnız artıq yoxlanmış, pula ən yaxın lidlər qalır. Bax burada üç yüz əlli min dollarlıq bir lid var. Gündəlik işin mənası budur: siz bütün siyahını yox, məhz vacib olanı görürsünüz.",
          en: "Filtering by status takes one click. We press the “Qualified” filter — and only the leads that are already vetted, the ones closest to money, stay on screen. Look, here is a lead worth three hundred and fifty thousand dollars. That's the point of the daily work: you see what matters, not the whole list.",
          ru: "Фильтр по статусу — в один клик. Нажимаем «Квалифицирован» — и на экране остаются только уже проверенные лиды, самые близкие к деньгам. Вот здесь лид на триста пятьдесят тысяч долларов. В этом и смысл ежедневной работы: вы видите не весь список, а именно то, что важно.",
        },
        do: async (p, l, h) => {
          await h.click(LEADS_CHIP_QUALIFIED);
          await h.sleep(900);
          await showBlock(p, "leads-convert");
          await h.holdUntil(0.55);
          await h.hover(LEADS_BOARD);
        },
      },
      // 5 — Category / source / sort: where the leads come from.
      {
        voice: {
          az: "Filtri geri açırıq və digər kəsiklərə baxırıq: kateqoriya — VIP, tərəfdaş, potensial; mənbə — sayt, LinkedIn, tövsiyə, soyuq zəng, sosial şəbəkə. Bu demo bazada lidlərin böyük hissəsi TikTok-dan gəlir. Belə bir kəsik marketinq büdcəsi barədə qərarı dəyişir: hansı kanal işləyir, hansı yox — bu, artıq rəqəmlə görünür. Yanda isə sıralama var: Da Vinci balına görə ən güclü lidləri yuxarı qaldırırsınız.",
          en: "We open the filter back up and look at the other cuts: category — VIP, partner, prospect; source — website, LinkedIn, referral, cold call, social. In this demo base most of the leads come from TikTok. A cut like that changes the marketing budget decision: which channel works and which doesn't is now visible as a number. And next to it is sorting — by Da Vinci score you lift the strongest leads to the top.",
          ru: "Возвращаем фильтр и смотрим другие срезы: категория — VIP, партнёр, потенциальный; источник — сайт, LinkedIn, рекомендация, холодный звонок, соцсети. В этой демо-базе большая часть лидов приходит из TikTok. Такой срез меняет решение по маркетинговому бюджету: какой канал работает, а какой нет — теперь видно цифрой. А рядом сортировка — по баллу Da Vinci вы поднимаете наверх самые сильные лиды.",
        },
        do: async (p, l, h) => {
          await h.click(LEADS_CHIP_ALL);
          await h.sleep(700);
          await h.holdUntil(0.32);
          await h.moveTo(leadsSelect(0));
          await h.holdUntil(0.55);
          await h.moveTo(leadsSelect(1));
          await h.holdUntil(0.82);
          await h.moveTo(leadsSelect(2));
        },
      },
      // 6 — Search: find one lead among dozens.
      {
        voice: {
          az: "Konkret adam lazımdırsa — axtarış var. Ad, şirkət, email və ya telefon üzrə yazırsınız və lid dərhal tapılır. Bax, bu lid otuz yeddi bal toplayıb və doqquz min dollar gözlənilən məbləği var. Yəni yüzlərlə qeyd arasında axtarmağa vaxt sərf etmirsiniz.",
          en: "If you need one specific person — there's search. You type a name, a company, an email or a phone number, and the lead is found instantly. This one has scored thirty-seven points with nine thousand dollars of expected value. So you don't burn time digging through hundreds of records.",
          ru: "Если нужен конкретный человек — есть поиск. Вы вводите имя, компанию, email или телефон, и лид находится сразу. Вот у этого лида тридцать семь баллов и девять тысяч долларов ожидаемой суммы. То есть вы не тратите время на раскопки среди сотен записей.",
        },
        do: async (p, l, h) => {
          await h.fill(LEADS_SEARCH, "Rauf");
          await h.holdUntil(0.5);
          await showBlock(p, "leads-convert");
          await h.hover(LEADS_BOARD);
        },
      },
      // 7 — Add a lead by hand: the full capture form (opened, then cancelled).
      {
        voice: {
          az: "Yeni lidi əl ilə də əlavə edə bilərsiniz — «Yeni lid» düyməsi. Formada təkcə ad və telefon yoxdur: email, WhatsApp, Telegram, mənbə, prioritet, gözlənilən məbləğ, satış hunisi və məsul satıcı da var. Yəni lid ilk andan tam kontekstlə yaranır və kimin üzərində olduğu bəllidir. Biz burada heç nə saxlamırıq — formanı göstərib bağlayırıq.",
          en: "You can also add a lead by hand — the “New Lead” button. The form isn't just a name and a phone: there's email, WhatsApp, Telegram, source, priority, expected amount, the sales funnel and the responsible salesperson. So the lead is created with full context from the first moment, and it's clear whose it is. We're not saving anything here — we just show the form and close it.",
          ru: "Лид можно добавить и вручную — кнопка «Новый лид». В форме не только имя и телефон: есть email, WhatsApp, Telegram, источник, приоритет, ожидаемая сумма, воронка продаж и ответственный продавец. То есть лид создаётся с полным контекстом с первой секунды, и сразу понятно, чей он. Мы здесь ничего не сохраняем — просто показываем форму и закрываем.",
        },
        do: async (p, l, h) => {
          await h.click(LEADS_NEW);
          await h.holdUntil(0.75);
          await h.click(MODAL_CANCEL);
        },
      },
      // 8 — Convert to deal: the moment a lead becomes money.
      {
        voice: {
          az: "Ən vacib addım — lidi sövdələşməyə çevirmək. Kartdakı ox düyməsi pəncərəni açır və sistem hər şeyi özü hazırlayır: kontakt yaradılır, sövdələşmənin adı, satış hunisi, mərhələsi — ehtimalı ilə birlikdə — və məbləğ artıq doldurulub. Bir təsdiq, və lid satış boru xəttində olur; heç nəyi yenidən yazmırsınız. Biz nümunə üçün pəncərəni açıb bağlayırıq.",
          en: "The most important step — turning a lead into a deal. The arrow button on the card opens the window, and the system prepares everything itself: a contact is created, the deal name, the sales funnel, the stage — with its probability — and the amount are already filled in. One confirmation, and the lead is in the sales pipeline; you retype nothing. For the demo we just open the window and close it.",
          ru: "Самый важный шаг — превратить лид в сделку. Кнопка со стрелкой на карточке открывает окно, и система готовит всё сама: создаётся контакт, название сделки, воронка продаж, стадия — вместе с вероятностью — и сумма уже подставлены. Одно подтверждение, и лид в воронке продаж; перенабирать ничего не нужно. Для примера мы просто откроем окно и закроем.",
        },
        do: async (p, l, h) => {
          await showBlock(p, "leads-convert");
          await h.click(LEADS_CONVERT_BTN);
          await h.holdUntil(0.72);
          await h.click(MODAL_CANCEL);
        },
      },
      // 9 — Analytics view: the section answers management questions.
      {
        voice: {
          az: "Və nəhayət — «Analitika» görünüşü. Burada bölmə rəhbərin suallarına cavab verir: konversiya faizi nədir, boru kəmərində nə qədər pul var, lidlər hansı statuslarda ilişib, hansı mənbə real nəticə gətirir, hansı lidlər ən yüksək baldadır. Aşağıda konversiya hunisi var — yenidən çevrilməyə qədər hər mərhələdə nə qədər itki olduğunu göstərir.",
          en: "And finally — the “Analytics” view. Here the section answers the manager's questions: what the conversion rate is, how much money sits in the pipeline, which statuses the leads are stuck in, which source brings real results, which leads score highest. At the bottom is the conversion funnel — it shows how much is lost at every stage on the way from new to converted.",
          ru: "И наконец — представление «Аналитика». Здесь раздел отвечает на вопросы руководителя: какова конверсия, сколько денег в воронке, в каких статусах застряли лиды, какой источник даёт реальный результат, какие лиды с самым высоким баллом. Внизу — воронка конверсии: она показывает, сколько теряется на каждом этапе от нового до конвертированного.",
        },
        do: async (p, l, h) => {
          await h.click(LEADS_ANALYTICS);
          await h.sleep(1200);
          await h.holdUntil(0.4);
          await h.hover(LEADS_HEAD);
          await h.holdUntil(0.62);
          await p.evaluate(() => window.scrollBy(0, 520)).catch(() => {});
          await h.holdUntil(0.85);
          await p.evaluate(() => window.scrollBy(0, 520)).catch(() => {});
        },
      },
      // 10 — Closing value.
      {
        voice: {
          az: "Beləliklə, «Lidlər» bölməsi hər şeyi bir yerdə saxlayır: gələn marağı itirmir, Da Vinci balı ilə prioritet verir, mərhələ üzrə aparır və bir kliklə sövdələşməyə çevirir. Satışın başlanğıcı təsadüf olmaqdan çıxır — idarə olunan prosesə çevrilir.",
          en: "So the Leads section holds it all together: it never loses an incoming interest, it prioritizes with the Da Vinci score, it moves the lead through the stages and converts it into a deal in one click. The start of your sales stops being a matter of chance — it becomes a managed process.",
          ru: "Итак, раздел «Лиды» держит всё вместе: не теряет входящий интерес, расставляет приоритеты по баллу Da Vinci, ведёт по стадиям и одним кликом превращает лид в сделку. Начало продаж перестаёт быть делом случая и становится управляемым процессом.",
        },
        do: async (p, l, h) => {
          await h.hover(LEADS_HEAD);
          await h.holdUntil(0.5);
          await h.moveTo(LEADS_SCORE);
        },
      },
    ],
  },

  "ai-actions": {
    route: "/ai/actions",
    title: { az: "AI Məsləhətçi", en: "AI Advisor", ru: "AI-советник" },
    scenes: [
      // 1 — What the section IS + the KPI strip (money at risk = the stakes).
      {
        voice: {
          az: "AI Məsləhətçi — şirkətin bütün risklərini bir ekrana toplayan əməliyyat mərkəzidir. O, CRM-in hər modulunu özü tarayır: satış, maliyyə, tapşırıqlar, müqavilələr, dəstək — və nəyin diqqət tələb etdiyini özü üzə çıxarır. Yuxarıdakı göstəricilər vəziyyəti bir baxışda deyir: neçə açıq risk var, onlardan neçəsi kritikdir və ən vacibi — nə qədər pul risk altındadır. Bu rəqəm sadəcə statistika deyil, itirilə bilən puldur.",
          en: "The AI Advisor is the operations center that brings every risk in your company onto one screen. It scans each CRM module by itself — sales, finance, tasks, contracts, support — and surfaces what needs attention. The indicators at the top tell you the situation at a glance: how many risks are open, how many of them are critical, and most important — how much money is at risk. That number isn't statistics; it's money you can lose.",
          ru: "AI-советник — это операционный центр, который собирает все риски компании на один экран. Он сам сканирует каждый модуль CRM — продажи, финансы, задачи, договоры, поддержку — и сам выносит наверх то, что требует внимания. Показатели сверху говорят обстановку с одного взгляда: сколько рисков открыто, сколько из них критические и самое важное — сколько денег под риском. Это не статистика, это деньги, которые можно потерять.",
        },
        do: async (p, l, h) => {
          await h.hover(HEADER);
          await h.holdUntil(0.34);
          await h.moveTo(KPIS);
          await h.holdUntil(0.58);
          await h.hover(kpiCard(2));
          await h.holdUntil(0.8);
          await h.hover(kpiCard(3));
        },
      },
      // 2 — The method: Signal → Evidence → Next step → Approval.
      {
        voice: {
          az: "Məsləhətçinin işi dörd addımlıq bir qayda üzərində qurulub: siqnal, sübut, növbəti addım və təsdiq. Əvvəlcə sistem riski tapır, sonra onu sübutla əsaslandırır, sonra konkret növbəti addımı hazırlayır — və heç nəyi özbaşına icra etmir. İcra yalnız sizin təsdiqinizdən sonra baş verir. Beləcə süni intellekt sizin əvəzinizə qərar vermir, sizin üçün qərarı hazırlayır.",
          en: "The Advisor works on a four-step rule: signal, evidence, next step, approval. First the system finds the risk, then it backs it with proof, then it prepares a concrete next step — and it never executes anything on its own. Execution happens only after your approval. So the AI doesn't decide instead of you; it prepares the decision for you.",
          ru: "Работа советника построена на правиле из четырёх шагов: сигнал, доказательство, следующий шаг и подтверждение. Сначала система находит риск, затем обосновывает его доказательством, затем готовит конкретный следующий шаг — и ничего не выполняет самовольно. Выполнение происходит только после твоего подтверждения. Так ИИ не решает вместо тебя, а готовит решение для тебя.",
        },
        do: async (p, l, h) => {
          await showBlock(p, "ai-actions-flow");
          await h.hover(FLOW);
          await h.holdUntil(0.3);
          await h.moveTo(flowStep(1));
          await h.holdUntil(0.5);
          await h.moveTo(flowStep(2));
          await h.holdUntil(0.68);
          await h.moveTo(flowStep(3));
          await h.holdUntil(0.86);
          await h.moveTo(flowStep(4));
        },
      },
      // 3 — The rail: every risk, grouped by module, critical first.
      {
        voice: {
          az: "Aşağıda bütün risklərin siyahısı var — «Diqqət tələb edir» bloku. Siyahı modullara görə bölünüb: maliyyə, tapşırıqlar, satış, müqavilələr, dəstək, marketinq. Hər modulun yanındakı rəqəm o sahədə neçə açıq risk olduğunu göstərir. Ən kritik siqnallar yuxarıdadır — yəni siz siyahını gəzmirsiniz, sistem sizə haradan başlamağı özü deyir.",
          en: "Below is the list of every risk — the “Needs attention” block. It is grouped by module: finance, tasks, sales, contracts, support, marketing. The number next to each module shows how many risks are open in that area. The most critical signals sit at the top — so you don't wander through a list; the system tells you where to start.",
          ru: "Ниже — список всех рисков, блок «Требует внимания». Он разбит по модулям: финансы, задачи, продажи, договоры, поддержка, маркетинг. Число рядом с модулем показывает, сколько рисков открыто в этой области. Самые критичные сигналы наверху — ты не бродишь по списку, система сама говорит, с чего начать.",
        },
        do: async (p, l, h) => {
          await showBlock(p, "ai-actions-rail");
          await h.hover(RAIL);
          await h.holdUntil(0.42);
          await h.moveTo(chip("Finance"));
          await h.holdUntil(0.66);
          await h.moveTo(chip("Sales"));
          await h.holdUntil(0.86);
          await h.moveTo(chip("Contracts"));
        },
      },
      // 4 — Finance module: real evidence behind an overdue invoice.
      {
        voice: {
          az: "Maliyyə filtrinə klik edirik — və Məsləhətçi pulla bağlı riskləri qarşımıza gətirir. Bax bu hesab-faktura: on beş min dollar, yüz on altı gündür ödənilməyib. Sağdakı panel təxmin yox, sübut göstərir — hansı obyekt, hansı şirkət, hansı məbləğ və neçə gün gecikmə. Siz bu riskə baxıb dərhal başa düşürsünüz ki, niyə o kritikdir.",
          en: "We click the finance filter — and the Advisor brings the money risks in front of us. Look at this invoice: fifteen thousand dollars, unpaid for a hundred and sixteen days. The panel on the right shows proof, not a guess — which object, which company, which amount, and how many days overdue. You look at the risk and immediately understand why it is critical.",
          ru: "Кликаем фильтр финансов — и советник выводит перед нами денежные риски. Вот этот счёт: пятнадцать тысяч долларов, не оплачен сто шестнадцать дней. Панель справа показывает доказательство, а не догадку — какой объект, какая компания, какая сумма и сколько дней просрочки. Ты смотришь на риск и сразу понимаешь, почему он критический.",
        },
        do: async (p, l, h) => {
          await switchModule(p, h, "Finance");
          await h.holdUntil(0.42);
          await h.hover(DETAIL);
          await h.holdUntil(0.72);
          await h.moveTo(ADD_TO_QUEUE);
        },
      },
      // 5 — Act: queue the prepared next step.
      {
        voice: {
          az: "İndi «Növbəyə əlavə et» düyməsinə klik edirik. Bir kliklə hazır addım təsdiq növbəsinə düşür: heç nə icra olunmur, amma heç nə də unudulmur. Risk artıq sadəcə xəbərdarlıq deyil — məsul adamın qərar xəttində duran, izlənilən tapşırıqdır.",
          en: "Now we click “Add to queue.” In one click the prepared step drops into the approval queue: nothing is executed yet, but nothing is forgotten either. The risk is no longer just an alert — it's a tracked task sitting on the owner's decision line.",
          ru: "Теперь кликаем «Добавить в очередь». Одним кликом подготовленный шаг попадает в очередь подтверждений: ничего не выполняется, но и ничего не теряется. Риск больше не просто уведомление — это отслеживаемая задача на линии решений ответственного.",
        },
        do: async (p, l, h) => {
          await showDetail(p);
          await h.holdUntil(0.28);
          await h.click(ADD_TO_QUEUE);
          await h.holdUntil(0.72);
          await h.hover(DETAIL);
        },
      },
      // 6 — Same machine, another module: an old support ticket.
      {
        voice: {
          az: "Eyni məntiq bütün modullarda işləyir. «Ticketing» filtrinə keçirik — və dəstək riskləri açılır. Bu tiket yüz otuz üç gündür açıqdır və hələ də həll olunmayıb. Məsləhətçi burada başqa addım təklif edir: eskalasiya. Yəni tövsiyə şablon deyil, riskin növünə uyğun seçilir.",
          en: "The same logic works across every module. We switch to the “Ticketing” filter — and the support risks open up. This ticket has been open for a hundred and thirty-three days and still isn't resolved. Here the Advisor proposes a different step: escalation. The recommendation isn't a template — it's chosen to match the kind of risk.",
          ru: "Та же логика работает во всех модулях. Переключаемся на фильтр «Ticketing» — и открываются риски поддержки. Этот тикет открыт сто тридцать три дня и до сих пор не решён. Здесь советник предлагает другой шаг — эскалацию. То есть рекомендация не шаблон, она подбирается под тип риска.",
        },
        do: async (p, l, h) => {
          await switchModule(p, h, "Ticketing");
          await h.holdUntil(0.45);
          await h.hover(DETAIL);
          await h.holdUntil(0.75);
          await h.moveTo(ADD_TO_QUEUE);
        },
      },
      // 7 — The approval queue: evidence + preview before anything runs.
      {
        voice: {
          az: "İndi «Təsdiq növbəsi» bölməsinə keçək — sistemin ürəyi buradadır. Növbədəki hər sətir təsdiq gözləyir və özü ilə birlikdə iki şey gətirir: sübutlar və «nə ediləcək» ön baxışı. Yəni düyməni basmadan əvvəl siz dəqiq görürsünüz ki, hansı obyektə, hansı əməliyyat tətbiq olunacaq. «Təsdiqlə» — addım icra olunur, «Rədd et» — ləğv edilir. Nəzarət tamamilə sizdə qalır.",
          en: "Now let's move to the “Approval queue” — this is the heart of the system. Every row in the queue is waiting for approval and brings two things with it: the evidence and a preview of what will be done. So before you press anything, you see exactly which object and which operation it will be applied to. “Approve” — the step runs; “Reject” — it's cancelled. Control stays entirely with you.",
          ru: "Теперь перейдём в «Очередь подтверждений» — это сердце системы. Каждая строка в очереди ждёт подтверждения и приносит с собой две вещи: доказательства и предпросмотр «что будет сделано». То есть до нажатия ты точно видишь, к какому объекту и какая операция применится. «Подтвердить» — шаг выполняется, «Отклонить» — отменяется. Контроль полностью остаётся у тебя.",
        },
        do: async (p, l, h) => {
          await h.click(TAB_QUEUE);
          await h.sleep(900);
          await showBlock(p, "ai-actions-tabs");
          await h.holdUntil(0.4);
          await h.hover(QUEUE_EVIDENCE);
          await h.holdUntil(0.72);
          await h.moveTo(QUEUE_APPROVE);
        },
      },
      // 8 — Module coverage: which domains the Advisor actually watches.
      {
        voice: {
          az: "«Modullar» vərəqi Məsləhətçinin nəyə nəzarət etdiyini açıq göstərir: hansı biznes sahələri aktivdir, hansı mənbə işləyir, harada siqnal yoxdur. Bu, şəffaflıq üçün lazımdır — süni intellektin nəyi gördüyünü və nəyi görmədiyini bilirsiniz. Qara qutu yoxdur.",
          en: "The “Modules” tab shows plainly what the Advisor is watching: which business domains are active, which source is working, where there are no signals. This is about transparency — you know what the AI sees and what it doesn't. No black box.",
          ru: "Вкладка «Модули» прямо показывает, за чем следит советник: какие бизнес-области активны, какой источник работает, где сигналов нет. Это про прозрачность — ты знаешь, что ИИ видит, а чего не видит. Никакого чёрного ящика.",
        },
        do: async (p, l, h) => {
          await h.click(TAB_MODULES);
          await h.sleep(900);
          await showBlock(p, "ai-actions-tabs");
          await h.holdUntil(0.45);
          await h.hover(TAB_PANEL);
          await h.holdUntil(0.78);
          await h.moveTo(TAB_PANEL);
        },
      },
      // 9 — History: an auditable trail of every executed decision.
      {
        voice: {
          az: "«Tarixçə» vərəqində isə artıq verilmiş qərarlar saxlanılır: nə icra olundu, nə növbədədir, nə rədd edildi, harada xəta oldu. Bu, yoxlanıla bilən izdir — kim nəyi təsdiqlədi və nəticə nə oldu. Beləcə avtomatlaşdırma idarə olunan və hesabat verilə bilən prosesə çevrilir.",
          en: "The “History” tab keeps the decisions already made: what was executed, what is queued, what was rejected, where an error occurred. It's an auditable trail — who approved what, and what came of it. That's how automation becomes a managed, accountable process.",
          ru: "А вкладка «История» хранит уже принятые решения: что выполнено, что в очереди, что отклонено, где была ошибка. Это проверяемый след — кто что подтвердил и чем это закончилось. Так автоматизация становится управляемым и подотчётным процессом.",
        },
        do: async (p, l, h) => {
          await h.click(TAB_HISTORY);
          await h.sleep(900);
          await showBlock(p, "ai-actions-tabs");
          await h.holdUntil(0.5);
          await h.hover(TAB_PANEL);
          await h.holdUntil(0.8);
          await h.moveTo(TAB_PANEL);
        },
      },
      // 10 — Ask in plain language + closing value.
      {
        voice: {
          az: "Və nəhayət — «Soruş» vərəqi. Burada siz sadə dildə sual verirsiniz: pul harada risk altındadır, hansı sövdələşmələr dayanıb, hansı tapşırıqlar gecikir. Hazır suallar da var. Cavab isə uydurma deyil — məhz bu səhifədəki siqnallara əsaslanır. Bir bölmədə hər şey var: risk özü tapılır, sübutla göstərilir, addım hazırlanır və sizin təsdiqinizlə icra olunur. Vacib heç nə əldən getmir.",
          en: "And finally — the “Ask” tab. Here you ask in plain language: where money is at risk, which deals have stalled, which tasks are overdue. There are ready-made questions too. And the answer isn't invented — it is grounded in the signals on this very page. One section holds it all: the risk is found, shown with evidence, the step is prepared, and it runs on your approval. Nothing important slips away.",
          ru: "И наконец — вкладка «Спросить». Здесь ты задаёшь вопрос обычным языком: где деньги под риском, какие сделки встали, какие задачи просрочены. Есть и готовые вопросы. А ответ не выдуман — он опирается на сигналы именно этой страницы. Один раздел вмещает всё: риск находится сам, показывается с доказательством, шаг готовится и выполняется по твоему подтверждению. Ничего важного не ускользает.",
        },
        do: async (p, l, h) => {
          await h.click(TAB_ASK);
          await h.sleep(900);
          await showBlock(p, "ai-actions-tabs");
          await h.holdUntil(0.42);
          await h.hover(TAB_PANEL);
          await h.holdUntil(0.72);
          await h.moveTo(KPIS);
        },
      },
    ],
  },

  "ai-command-center": {
    route: "/ai-command-center",
    title: { az: "Da Vinci İdarəetmə Mərkəzi", en: "Da Vinci Command Center", ru: "Da Vinci Центр управления" },
    scenes: [
      // 1 — What the section IS + significance (Dashboard view on load).
      {
        voice: {
          az: "Da Vinci İdarəetmə Mərkəzi — süni intellekt agentlərinizi bir yerdən idarə etdiyiniz və canlı izlədiyiniz komanda mərkəzidir. Agentlər real müştərilərlə danışır, siz isə onların bütün işini şəffaf görürsünüz: neçə sessiya, hansı keyfiyyət, nə qədər xərc. Süni intellekt burada qara qutu deyil — ölçülən, idarə olunan komandadır.",
          en: "The Da Vinci Command Center is the hub where you run and watch your AI agents from one place, live. The agents talk to real customers while you see all of their work transparently — how many sessions, what quality, how much cost. Here the AI is not a black box; it is a measured, managed team.",
          ru: "Da Vinci Центр управления — это командный центр, где ты управляешь ИИ-агентами и наблюдаешь за ними вживую из одного места. Агенты общаются с реальными клиентами, а ты прозрачно видишь всю их работу: сколько сессий, какое качество, сколько затрат. Здесь ИИ не чёрный ящик, а измеримая, управляемая команда.",
        },
        do: async (p, l, h) => { await h.moveTo(["main h1", "main h2", "main"]); await h.sleep(300); await h.hover(["main"]); },
      },
      // 2 — KPIs: the AI's health measured like a real team.
      {
        voice: {
          az: "Yuxarıdakı göstəricilər agentin sağlamlığıdır. Cəmi doxsan altı sessiya, bu gün qırx yeddi. Müraciətlərin otuz bir faizi ümumiyyətlə insana çatmadan həll olunub. Müştəri məmnuniyyəti beşdən dörd yarım, ilk təmasda həll qırx faiz, orta həll müddəti altı dəqiqə. Hər cavabın dəyəri belə qəpiyinə qədər sayılır.",
          en: "The metrics up top are the agent's health. Ninety-six sessions in total, forty-seven today. Thirty-one percent of requests were resolved without ever reaching a human. Customer satisfaction four and a half out of five, first-contact resolution forty percent, average resolution about six minutes. Even the cost of each answer is counted to the cent.",
          ru: "Показатели сверху — это здоровье агента. Всего девяносто шесть сессий, сегодня сорок семь. Тридцать один процент обращений решён, вообще не дойдя до человека. Удовлетворённость клиентов четыре с половиной из пяти, решение с первого контакта сорок процентов, среднее время решения около шести минут. Даже стоимость каждого ответа считается до копейки.",
        },
        do: async (p, l, h) => { await h.moveTo(ACC_CSAT); await h.hover(ACC_CSAT); },
      },
      // 3 — Alerts: the center watches itself (anomaly detection).
      {
        voice: {
          az: "Mərkəz özünü də izləyir. Bax burada avtomatik xəbərdarlıq: token sıçrayışı, süni intellekt xərclərində qəfil artım. Sistem anomaliyanı özü aşkarlayır ki, xərc və ya səhv nəzarətdən çıxmasın. Sən problemi sonradan yox, baş verən anda görürsən və bir kliklə oxunmuş kimi işarələyirsən.",
          en: "The center watches itself too. Right here is an automatic alert: a token spike, a sudden jump in AI cost. The system detects the anomaly on its own so cost or errors never slip out of control. You see the problem the moment it happens, not later, and clear it with one click.",
          ru: "Центр следит и за собой. Вот здесь автоматическое оповещение: всплеск токенов, резкий скачок расходов на ИИ. Система сама обнаруживает аномалию, чтобы расходы или ошибки не вышли из-под контроля. Ты видишь проблему в момент, когда она возникла, а не потом, и закрываешь её одним кликом.",
        },
        do: async (p, l, h) => { await h.moveTo(ACC_ALERTS); await h.moveTo(ACC_MARKREAD); },
      },
      // 4 — Interaction logs: complete, auditable trail.
      {
        voice: {
          az: "Hər qarşılıqlı əlaqə burada qeydə alınır — iki min yüz otuz beş yazı. Bu, agentin hər addımının tam, yoxlanıla bilən tarixçəsidir. İstənilən sessiyanı açıb detallara baxa bilərsiniz: nə soruşuldu, agent necə cavab verdi, hansı alət işə düşdü. Heç nə gizli qalmır.",
          en: "Every interaction is logged here — two thousand one hundred and thirty-five records. This is a complete, auditable history of the agent's every step. You can open any session and inspect the details: what was asked, how the agent answered, which tool fired. Nothing stays hidden.",
          ru: "Каждое взаимодействие записывается здесь — две тысячи сто тридцать пять записей. Это полная, проверяемая история каждого шага агента. Любую сессию можно открыть и посмотреть детали: что спросили, как ответил агент, какой инструмент сработал. Ничего не остаётся скрытым.",
        },
        do: async (p, l, h) => { await h.moveTo(ACC_LOGS); await h.moveTo(ACC_DETAILS); },
      },
      // 5 — Switch to the Agent Builder (real tab click).
      {
        voice: {
          az: "İndi mərkəzin ikinci tərəfinə keçək — agentlərin özünü qurmağa. «Agent konstruktoru» düyməsinə bir klik edirik. Burada hər agenti sıfırdan formalaşdırırsınız.",
          en: "Now let's move to the other side of the center — building the agents themselves. We click the “Agent Constructor.” Here you shape each agent from the ground up.",
          ru: "Теперь перейдём на вторую сторону центра — к созданию самих агентов. Кликаем кнопку «Конструктор агентов». Здесь ты формируешь каждого агента с нуля.",
        },
        do: async (p, l, h) => { await h.click(ACC_BUILDER_TAB); await h.sleep(800); },
      },
      // 6 — Agent configurations: model, tools, behavior.
      {
        voice: {
          az: "Hər konfiqurasiya bir agenti təyin edir: hansı model, hansı alətlər, neçə token, necə davranış. Bax bu — «Social AI Agent», Da Vinci Lite modelində, aktiv vəziyyətdə, eskalasiya açıq. Bir neçə kliklə modeli dəyişir, alət əlavə edir və ya agenti aktivləşdirirsiniz.",
          en: "Each configuration defines an agent: which model, which tools, how many tokens, what behavior. Here is the “Social AI Agent,” on the Da Vinci Lite model, active, with escalation on. In a few clicks you switch the model, add a tool, or activate the agent.",
          ru: "Каждая конфигурация задаёт агента: какая модель, какие инструменты, сколько токенов, какое поведение. Вот «Social AI Agent» на модели Da Vinci Lite, активен, эскалация включена. В несколько кликов ты меняешь модель, добавляешь инструмент или активируешь агента.",
        },
        do: async (p, l, h) => { await h.moveTo(ACC_CONFIG); await h.hover(ACC_CONFIG); },
      },
      // 7 — Rules & guardrails.
      {
        voice: {
          az: "Ən vacibi — qaydalar və məhdudiyyətlər. Bu, agentin təhlükəsizlik qoruyucularıdır: nəyi edə bilər, nəyi yox. Yeni qayda bir kliklə əlavə olunur. Beləcə süni intellekt sərbəst deyil, sizin qoyduğunuz çərçivədə işləyir.",
          en: "Most important — rules and constraints. These are the agent's safety guardrails: what it may do and what it may not. A new rule is added with one click. So the AI isn't loose — it works inside the boundaries you set.",
          ru: "Самое важное — правила и ограничения. Это защитные барьеры агента: что он может делать, а что нет. Новое правило добавляется одним кликом. Так ИИ не свободен, а работает в рамках, которые ты задаёшь.",
        },
        do: async (p, l, h) => { await h.moveTo(ACC_RULES); await h.moveTo(ACC_NEWRULE); },
      },
      // 8 — Create from description + closing on significance.
      {
        voice: {
          az: "Ən maraqlısı budur: agenti sadəcə sözlə təsvir edirsiniz və sistem konfiqurasiyanı özü qurur. «Yeni konfiqurasiya» — və növbəti agentiniz hazırdır. Da Vinci İdarəetmə Mərkəzi budur: süni intellekt komandanızı bir yerdə işlədir, izləyir və formalaşdırırsınız — tam nəzarətdə.",
          en: "And the best part: you simply describe an agent in words, and the system builds the configuration itself. “New configuration,” and your next agent is ready. That is the Da Vinci Command Center: you run, watch, and shape your AI team in one place — fully in control.",
          ru: "И самое интересное: ты просто описываешь агента словами, и система сама собирает конфигурацию. «Новая конфигурация» — и твой следующий агент готов. Это и есть Da Vinci Центр управления: ты запускаешь, наблюдаешь и формируешь свою ИИ-команду в одном месте — полностью под контролем.",
        },
        do: async (p, l, h) => { await h.moveTo(ACC_GENDESC); await h.moveTo(ACC_NEWCONFIG); },
      },
    ],
  },

  "deals": {
    route: "/deals",
    title: { az: "Satış boru xətti", en: "Sales Pipeline", ru: "Воронка продаж" },
    scenes: [
      // 1 — What the pipeline IS + significance.
      {
        voice: {
          az: "Bu — satış boru xəttidir, bütün sövdələşmələrinizin tək bir mənzərəsi. On altı sövdələşmə, ümumi dəyəri beş yüz üç min manat — hamısı bir lövhədə. Hansı pulun harada olduğunu və hansı mərhələdə dayandığını hər an görürsünüz. Satış artıq elektron cədvəldə deyil, canlı boru xəttindədir.",
          en: "This is the sales pipeline — a single view of every one of your deals. Sixteen deals, a total value of five hundred and three thousand manat, all on one board. At any moment you see where the money is and which stage it's stuck at. Sales is no longer in a spreadsheet; it lives in a living pipeline.",
          ru: "Это воронка продаж — единый вид всех твоих сделок. Шестнадцать сделок общей стоимостью пятьсот три тысячи манат — все на одной доске. В любой момент ты видишь, где деньги и на какой стадии они застряли. Продажи больше не в таблице, а в живой воронке.",
        },
        do: async (p, l, h) => { await h.moveTo(DEALS_SUMMARY); await h.sleep(300); await h.hover(DEALS_SUMMARY); },
      },
      // 2 — Da Vinci funnel analytics (weighted forecast).
      {
        voice: {
          az: "Yuxarıda Da Vinci analitikası boru xəttini özü hesablayır. Cəmi on altı sövdələşmə, huni dəyəri dörd yüz altmış yeddi min, qazanılmış iyirmi səkkiz min. Ən vacibi — çəkili dəyər: iki yüz iyirmi yeddi min. Bu, hər sövdələşmənin ehtimalına görə düzəldilmiş real proqnozdur, sadəcə arzu deyil.",
          en: "At the top, Da Vinci analytics computes the pipeline for you. Sixteen deals in total, a funnel value of four hundred sixty-seven thousand, twenty-eight thousand already won. Most important is the weighted value — two hundred twenty-seven thousand. That is the realistic forecast, adjusted by each deal's probability, not just a wish.",
          ru: "Наверху Da Vinci аналитика сама считает воронку. Всего шестнадцать сделок, стоимость воронки четыреста шестьдесят семь тысяч, выиграно двадцать восемь тысяч. Самое важное — взвешенная стоимость: двести двадцать семь тысяч. Это реалистичный прогноз, скорректированный на вероятность каждой сделки, а не просто желание.",
        },
        do: async (p, l, h) => { await h.moveTo(DEALS_SUMMARY); await h.hover(DEALS_SUMMARY); },
      },
      // 3 — Switch to the Kanban board (real click).
      {
        voice: {
          az: "«Kanban» düyməsinə klik edirik — və hər sövdələşmə öz mərhələ sütununda karta çevrilir: Lid, Kvalifikasiya, Təklif, Qazanıldı, İtirildi. Bütün boru xətti bir baxışda gözünüzün önündədir.",
          en: "We click the “Kanban” button — and every deal becomes a card in its stage column: Lead, Qualification, Proposal, Won, Lost. The whole pipeline is in front of you at a single glance.",
          ru: "Кликаем кнопку «Канбан» — и каждая сделка становится карточкой в колонке своей стадии: Лид, Квалификация, Предложение, Выиграна, Проиграна. Вся воронка перед тобой одним взглядом.",
        },
        do: async (p, l, h) => { await h.click(DEALS_KANBAN_BTN); await h.sleep(800); },
      },
      // 3b — NEW (D2): MEDDPICC chips right on the card (data-dependent: needs scored deals).
      {
        voice: {
          az: "Kartın üstündəki rəngli hərflərə diqqət edin — bu, MEDDPICC-dir, B2B sövdələşmələrini qiymətləndirmək üçün səkkiz meyarlı metodika: metrikalar, iqtisadi alıcı, qərar meyarları və prosesi, sənəd prosesi, müştərinin ağrısı, çempion və rəqabət. Hər hərf öz balına görə rənglənir — yaşıl, sarı, qırmızı — yanında isə qırx baldan ümumi qiymət. Beləcə sövdələşməni açmadan onun nə qədər işləndiyini və zəif nöqtəsini görürsünüz — məsələn, harada iqtisadi alıcı və ya çempion çatışmır.",
          en: "Notice the colored letters on the card — that's MEDDPICC, an eight-criterion methodology for qualifying B2B deals: metrics, economic buyer, decision criteria and process, paper process, the customer's pain, champion, and competition. Each letter is colored by its score — green, amber, red — with the total out of forty beside it. So you see how well the deal is worked and where its weak spot is before you even open it — for example, where the economic buyer or the champion is missing.",
          ru: "Обрати внимание на цветные буквы на карточке — это MEDDPICC, методика квалификации B2B-сделок из восьми критериев: метрики, экономический покупатель, критерии и процесс решения, бумажный процесс, боль клиента, чемпион и конкуренция. Каждая буква окрашена по своей оценке — зелёный, жёлтый, красный — а рядом общий балл из сорока. Так ты видишь качество проработки сделки и её слабое место ещё до того, как открыл карточку — например, где не хватает экономического покупателя или чемпиона.",
        },
        do: async (p, l, h) => { await h.moveTo(DEALS_MEDD_CHIP); await h.hover(DEALS_MEDD_CHIP); },
      },
      // 4 — A deal card + the drag-to-move-stage capability.
      {
        voice: {
          az: "Hər kartda sövdələşmənin özü, məbləği və qazanma ehtimalı var — məsələn, GlobalTech, yüz iyirmi min dollar, əlli faiz. Kartı bir sütundan digərinə sürükləyin — mərhələ və ehtimal avtomatik yenilənir. Bir hərəkətlə sövdələşməni irəli aparırsınız.",
          en: "Each card carries the deal itself, its amount and its win probability — for example GlobalTech, a hundred and twenty thousand dollars, fifty percent. Drag a card from one column to another, and the stage and probability update automatically. In one motion you move the deal forward.",
          ru: "На каждой карточке — сама сделка, её сумма и вероятность выигрыша — например, GlobalTech, сто двадцать тысяч долларов, пятьдесят процентов. Перетащи карточку из одной колонки в другую — стадия и вероятность обновятся автоматически. Одним движением ты продвигаешь сделку вперёд.",
        },
        do: async (p, l, h) => { await h.moveTo(DEALS_CARD); await h.hover(DEALS_CARD); },
      },
      // 5 — Filter by a stage (Proposal).
      {
        voice: {
          az: "İstənilən mərhələyə görə süzgəc qoya bilərsiniz. «Təklif» üzərinə klik — və yalnız təklif mərhələsindəki beş sövdələşmə qalır. Beləcə bağlanmağa yaxın olan sövdələşmələrə diqqəti cəmləyirsiniz.",
          en: "You can filter by any stage. Click “Proposal,” and only the five deals in the proposal stage remain. That way you focus on the deals that are closest to closing.",
          ru: "Можно фильтровать по любой стадии. Клик по «Предложение» — и остаются только пять сделок на стадии предложения. Так ты фокусируешься на сделках, ближайших к закрытию.",
        },
        do: async (p, l, h) => { await h.click(DEALS_PROPOSAL); await h.sleep(700); },
      },
      // 6 — Won / Lost.
      {
        voice: {
          az: "«Qazanıldı» üzərinə klik — və qazanılmış sövdələşmələri görürsünüz: dörd sövdələşmə, iyirmi səkkiz min manat. İstədiyiniz zaman «İtirildi»yə keçib itkilərin səbəbini də təhlil edə bilərsiniz. Boru xətti həm qələbələri, həm dərsləri göstərir.",
          en: "Click “Won,” and you see the deals you've closed: four deals, twenty-eight thousand. Whenever you want, switch to “Lost” and analyze why deals slipped away. The pipeline shows both the wins and the lessons.",
          ru: "Клик по «Выиграна» — и ты видишь закрытые сделки: четыре сделки, двадцать восемь тысяч. В любой момент переключись на «Проиграна» и разбери, почему сделки ушли. Воронка показывает и победы, и уроки.",
        },
        do: async (p, l, h) => { await h.click(DEALS_WON); await h.sleep(700); },
      },
      // 6b — NEW (D2): List view + MEDDPICC column + sort by qualification.
      {
        voice: {
          az: "«Siyahı» rejiminə keçin — hər sövdələşmə üçün eyni çiplərlə MEDDPICC sütunu görünür. Kvalifikasiyaya görə sıralayın — ən az işlənmiş sövdələşmələr yuxarı qalxır. Beləcə rəhbər təxmin etmədən hansı sövdələşmənin diqqət tələb etdiyini dərhal görür.",
          en: "Switch to the List view — and a MEDDPICC column appears with the same chips for every deal. Sort by qualification, and the least-qualified deals rise to the top. So the manager sees at once which deals need attention, instead of guessing.",
          ru: "Переключись в режим «Список» — и появляется колонка MEDDPICC с теми же чипами по каждой сделке. Отсортируй по квалификации — самые непроработанные сделки поднимутся наверх. Так руководитель сразу видит, какие сделки требуют внимания, а не гадает.",
        },
        do: async (p, l, h) => { await h.click(DEALS_LIST_BTN); await h.sleep(900); await h.moveTo(DEALS_MEDD_COL); await h.hover(DEALS_MEDD_COL); },
      },
      // 7 — Add a new deal.
      {
        voice: {
          az: "Yeni sövdələşməni bir kliklə əlavə edirsiniz. «Yeni sövdələşmə» düyməsi — və sövdələşmə düz boru xəttinə, lazımi mərhələyə düşür. Heç nə itmir, hər fürsət qeydə alınır.",
          en: "You add a new deal with one click. The “New Deal” button — and the deal drops straight into the pipeline at the right stage. Nothing is lost; every opportunity is captured.",
          ru: "Новую сделку ты добавляешь одним кликом. Кнопка «Новая сделка» — и сделка попадает прямо в воронку, на нужную стадию. Ничего не теряется, каждая возможность зафиксирована.",
        },
        do: async (p, l, h) => { await h.moveTo(DEALS_NEW); await h.hover(DEALS_NEW); },
      },
      // 8 — Closing on significance.
      {
        voice: {
          az: "Satış boru xətti gəlirin tək həqiqət mənbəyidir: kartları sürükləyib mərhələləri dəyişirsiniz, mərhələ üzrə süzgəcləyirsiniz, MEDDPICC çipləri və Da Vinci isə keyfiyyəti və çəkili proqnozu dərhal göstərir. Bütün satışınız — bir lövhədə, tam nəzarətdə.",
          en: "The sales pipeline is your single source of truth for revenue: you drag cards to change stages, filter by stage, while the MEDDPICC chips and Da Vinci instantly show the quality and the weighted forecast. All of your sales — on one board, fully in control.",
          ru: "Воронка продаж — единый источник правды о выручке: перетаскиваешь карточки, меняя стадии, фильтруешь по стадии, а чипы MEDDPICC и Da Vinci сразу показывают качество и взвешенный прогноз. Все твои продажи — на одной доске, полностью под контролем.",
        },
        do: async (p, l, h) => { await h.moveTo(DEALS_SUMMARY); await h.hover(DEALS_SUMMARY); },
      },
    ],
  },

  "deal-detail": {
    // A specific demo deal (GlobalTech, 120k, stalled in Qualified) on prod.
    route: "/deals/cmnz99n5g000550qm8ir26e5g",
    title: { az: "Sövdələşmə kartı", en: "Deal page", ru: "Карточка сделки" },
    scenes: [
      // 1 — What the deal page IS.
      {
        voice: {
          az: "Hər sövdələşməni açanda onun öz idarə mərkəzinə düşürsünüz. Bir səhifədə sövdələşmə haqqında hər şey var: məbləğ, mərhələ, süni intellektin proqnozu, tapşırıqlar və tarixçə. Budur «GlobalTech» sövdələşməsi — yüz iyirmi min dollar. Gəlin içəridəki imkanlara baxaq.",
          en: "When you open a deal, you land in its own command center. Everything about the deal is on one page: the amount, the stage, the AI prediction, the tasks, and the history. Here is the “GlobalTech” deal — a hundred and twenty thousand dollars. Let's look at what's inside.",
          ru: "Открывая сделку, ты попадаешь в её собственный командный центр. Всё о сделке на одной странице: сумма, стадия, прогноз ИИ, задачи и история. Вот сделка «GlobalTech» — сто двадцать тысяч долларов. Давай посмотрим, что внутри.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_STAGE); await h.sleep(300); await h.hover(DD_STAGE); },
      },
      // 2 — Stage stepper: move the deal forward.
      {
        voice: {
          az: "Yuxarıdakı zolaq sövdələşmənin mərhələsini göstərir — hazırda «Kvalifikasiya». Növbəti mərhələyə keçmək üçün sadəcə üstünə klikləyirsiniz: Lid, Təklif, Danışıqlar, Qazanıldı. Sövdələşməni səhifəni tərk etmədən irəli aparırsınız.",
          en: "The bar at the top shows the deal's stage — right now “Qualification.” To move to the next stage you simply click on it: Lead, Proposal, Negotiation, Won. You move the deal forward without leaving the page.",
          ru: "Полоса сверху показывает стадию сделки — сейчас «Квалификация». Чтобы перейти на следующую стадию, ты просто кликаешь по ней: Лид, Предложение, Переговоры, Выиграна. Ты продвигаешь сделку, не покидая страницу.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_STAGE); await h.hover(DD_STAGE); },
      },
      // 2b — NEW: KPI chips (deal pulse — days in funnel / at stage, emails, calls).
      {
        voice: {
          az: "«Sövdələşmə təfərrüatları» bloku əsas suallara dərhal cavab verir: sövdələşmə neçə gündür hunidədir, cari mərhələdə nə qədər ilişib qalıb, neçə e-poçt və zəng olub. Bu, sövdələşmənin nəbzidir — bir baxışda onun canlı, yoxsa donmuş olduğunu görürsünüz.",
          en: "The “Deal details” block answers the key questions at once: how many days the deal has been in the funnel, how long it's been stuck at the current stage, how many emails and calls there were. It's the deal's pulse — one glance tells you whether it's alive or frozen.",
          ru: "Блок «Детали сделки» сразу отвечает на главные вопросы: сколько дней сделка в воронке, сколько застряла на текущем этапе, сколько было писем и звонков. Это пульс сделки — с одного взгляда видно, живая она или замерла.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_KPI); await h.hover(DD_KPI); },
      },
      // 2c — NEW: tabs (Overview / Feed / MEDDPICC); open the MEDDPICC qualification tab.
      {
        voice: {
          az: "Sövdələşmə üzrə bütün iş vərəqlərə bölünüb: «İcmal» — məlumat və müştəri təfərrüatları, «Lent» — ünsiyyət və tarixçə, «MEDDPICC» — kvalifikasiyanın keyfiyyəti. Kvalifikasiyanı açırıq — bu, sövdələşmənin ürəyidir.",
          en: "All the work on a deal is organized into tabs: “Overview” — the data and customer details, “Feed” — communication and history, “MEDDPICC” — the quality of qualification. We open qualification — it's the heart of the deal.",
          ru: "Вся работа со сделкой разложена по вкладкам: «Обзор» — данные и детали клиента, «Лента» — общение и история, «MEDDPICC» — качество квалификации. Открываем квалификацию — это сердце сделки.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_TAB_MEDD); await h.click(DD_TAB_MEDD); await h.sleep(800); },
      },
      // 2d — NEW (D1): the MEDDPICC method — 8 blocks, 1–5 score, honest rollup status.
      {
        voice: {
          az: "MEDDPICC vərəqi mürəkkəb B2B sövdələşmələrini qiymətləndirmək üçün metodikadır. Səkkiz hərf — buraxıla bilməyən səkkiz sual: Metrics — pulla ölçülən dəyər; Economic Buyer — büdcəni əslində kim idarə edir; Decision Criteria və Decision Process — hansı meyarlarla və necə qərar verilir; Paper Process — hüquqi və satınalma yolu; Identify Pain — müştərinin əsl ağrısı; Champion — sizin daxili müttəfiqiniz; Competition — kiminlə rəqabət edirsiniz. Hər biri üçün birdən beşə qədər qiymət verir, niyə belə və sonra nə edəcəyinizi yazırsınız. Yuxarıda ümumi status və qırx baldan qiymət: hər hansı meyar qiymətlənməyibsə, sövdələşmə hazır kimi görünmür, dürüstcəsinə sarı ilə işarələnir. Beləcə «yaxşı gedir» hissi yox, sövdələşmənin harada güclü, harada itirilə biləcəyini dəqiq görürsünüz.",
          en: "The MEDDPICC tab is a methodology for qualifying complex B2B deals. Eight letters — eight questions you can't skip: Metrics — the measurable value in money; Economic Buyer — who really controls the budget; Decision Criteria and Decision Process — by what criteria and how the decision is made; Paper Process — the legal and procurement path; Identify Pain — the customer's real pain; Champion — your internal advocate; Competition — who you're up against. For each you set a score from one to five and note why and what to do next. At the top, the overall status and a score out of forty — while any criterion is unscored, the deal is honestly flagged yellow instead of pretending to be ready. So instead of a gut feeling that it's going well, you see exactly where the deal is strong and where you could lose it.",
          ru: "Вкладка MEDDPICC — это методика квалификации сложных B2B-сделок. Восемь букв — восемь вопросов, которые нельзя пропускать: Metrics — измеримая ценность в деньгах; Economic Buyer — кто реально распоряжается бюджетом; Decision Criteria и Decision Process — по каким критериям и как принимают решение; Paper Process — юридический и закупочный путь; Identify Pain — настоящая боль клиента; Champion — твой внутренний союзник; Competition — с кем конкурируешь. По каждому ставишь оценку от одного до пяти и пишешь, почему такой балл и что делать дальше. Сверху — общий статус и балл из сорока: пока хоть один критерий не оценён, сделка честно помечена жёлтым, а не выдаёт себя за готовую. Так ты видишь не ощущение «вроде идёт хорошо», а конкретно, где сделка сильна и где её можно потерять.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_MEDD_STATUS); await h.hover(DD_MEDD_STATUS); },
      },
      // 2e — NEW (D3): "Suggest from correspondence" — AI drafts the empty blocks (hover only, no spend).
      {
        voice: {
          az: "Və ən güclüsü — «Yazışmadan təklif et» düyməsi. Süni intellekt sövdələşmənin poçtunu və qeydlərini oxuyur və boş blokları özü qaralama ilə doldurur: çempion kimdir, ağrı nədir, qərar meyarları hansılardır. Sizin işinizə toxunmur — yalnız boş olanı doldurur və «AI» nişanı ilə işarələyir. Kvalifikasiya əl işindən bir neçə dəqiqəyə çevrilir.",
          en: "And the strongest part — the “Suggest from correspondence” button. The AI reads the deal's email and notes and drafts the empty blocks itself: who the champion is, what the pain is, the decision criteria. It never touches your own work — it fills only what's empty and marks it with an “AI” badge. Qualification turns from manual routine into a couple of minutes.",
          ru: "И самое сильное — кнопка «Предложить из переписки». ИИ читает почту и заметки по сделке и сам заполняет пустые блоки черновиком: кто чемпион, в чём боль, какие критерии решения. Твою работу он не трогает — дополняет только пустое и помечает бейджем «ИИ». Квалификация из ручной рутины превращается в пару минут.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_MEDD_SUGGEST); await h.hover(DD_MEDD_SUGGEST); },
      },
      // 3 — AI win-probability prediction.
      {
        voice: {
          az: "Süni intellekt bu sövdələşmə üçün öz proqnozunu verir. «AI Proqnoz» kartı qazanma ehtimalını göstərir — cəmi on dörd faiz, səksən faiz əminliklə. Səbəblər də sadalanır: yüz bir gündür aktivlik yoxdur, qarşılıqlı əlaqə azdır, bağlanma tarixi keçib. Bu, hissə yox, məlumata əsaslanan qiymətdir.",
          en: "The AI gives its own forecast for this deal. The “AI Prediction” card shows the win probability — just fourteen percent, with eighty percent confidence. And it lists why: no activity for a hundred and one days, low interaction, the close date overdue. This is a data-driven read, not a gut feeling.",
          ru: "ИИ даёт собственный прогноз по сделке. Карточка «AI-прогноз» показывает вероятность выигрыша — всего четырнадцать процентов, с уверенностью восемьдесят процентов. И перечисляет причины: сто один день нет активности, слабое взаимодействие, дата закрытия просрочена. Это оценка на данных, а не на ощущениях.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_AIPRED); await h.hover(DD_AIPRED); },
      },
      // 4 — Risk Advisor: recommends the next step AND prepares it ("Send for approval").
      {
        voice: {
          az: "Amma süni intellekt təkcə riski demir. «Risk Advisor» konkret növbəti addımı tövsiyə edir və onu sizin üçün hazırlayır — tapşırıq yarat, planı yenilə. Bir «Təsdiqə göndər» düyməsi — və tövsiyə rəhbər nəzarəti ilə işə düşür. Analiz birbaşa fəaliyyətə çevrilir.",
          en: "But the AI doesn't just state the risk. The “Risk Advisor” recommends a concrete next step and prepares it for you — create a task, update the plan. One “Send for approval” button, and the recommendation goes into action with the manager's oversight. Analysis turns straight into action.",
          ru: "Но ИИ не просто называет риск. «Риск Advisor» рекомендует конкретный следующий шаг и готовит его за тебя — создать задачу, обновить план. Одна кнопка «Отправить на согласование» — и рекомендация уходит в работу с контролем руководителя. Анализ сразу превращается в действие.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_ADVISOR); await h.hover(DD_ADVISOR); },
      },
      // 5 — Quick actions: note / task / email inside the deal.
      {
        voice: {
          az: "Burada dərhal hərəkət edirsiniz: qeyd yazın, tapşırıq yaradın və ya e-poçt göndərin — hamısı sövdələşmənin içində. «Növbəti addım nədir?» sualına cavabı elə burada qeyd edirsiniz, başqa ekrana keçmədən.",
          en: "Right here you act immediately: write a note, create a task, or send an email — all inside the deal. You answer “what's the next step?” right here, without switching to another screen.",
          ru: "Прямо здесь ты действуешь сразу: пишешь заметку, создаёшь задачу или отправляешь письмо — всё внутри сделки. На вопрос «какой следующий шаг?» ты отвечаешь здесь же, не переключаясь на другой экран.",
        },
        do: async (p, l, h) => { await h.click(DD_TAB_FEED); await h.sleep(600); await h.moveTo(DD_QUICK); await h.click(DD_TASK); await h.sleep(500); await h.click(DD_EMAIL); },
      },
      // 6 — Sidebar: linked entities (expand competitors).
      {
        voice: {
          az: "Sol tərəfdə sövdələşməyə bağlı hər şey var: təkliflər, hesab-fakturalar, komanda, kontakt rolları və rəqiblər. Bir kliklə istənilən bölməni açırsınız — məsələn, rəqibləri — və bütün əlaqəli məlumatı görürsünüz. Sövdələşmə tək deyil, bütöv kontekstdədir.",
          en: "On the left is everything linked to the deal: proposals, invoices, the team, contact roles, and competitors. With one click you open any section — for example, competitors — and see all the related data. The deal isn't alone; it comes with full context.",
          ru: "Слева — всё, что связано со сделкой: предложения, счета, команда, роли контактов и конкуренты. Одним кликом ты открываешь любой раздел — например, конкурентов — и видишь все связанные данные. Сделка не одна, у неё полный контекст.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_SIDEBAR); await h.click(DD_COMPETITORS); await h.sleep(600); },
      },
      // 7 — Activity timeline.
      {
        voice: {
          az: "Aşağıda sövdələşmənin bütün tarixçəsi var — hər e-poçt, qeyd və tapşırıq. Bu, sövdələşmənin ömrünün tam, yoxlanıla bilən xronologiyasıdır. Kim nə etdi, nə vaxt — hamısı bir yerdə.",
          en: "Below is the deal's full history — every email, note, and task. This is a complete, auditable timeline of the deal's life. Who did what, and when — all in one place.",
          ru: "Ниже — вся история сделки: каждое письмо, заметка, задача. Это полная, проверяемая хронология жизни сделки. Кто что сделал и когда — всё в одном месте.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_TIMELINE); await h.hover(DD_TIMELINE); },
      },
      // 8 — Closing on significance.
      {
        voice: {
          az: "Sövdələşmə səhifəsi sövdələşməni görmək, kvalifikasiya etmək və irəli aparmaq üçün tək yerdir: MEDDPICC keyfiyyəti, süni intellekt isə riski və növbəti addımı göstərir, siz isə səhifəni tərk etmədən hərəkət edirsiniz. Hər sövdələşmə — ilk təmasdan bağlanmağa qədər tam nəzarətdə.",
          en: "The deal page is the single place to see, qualify, and drive a deal: MEDDPICC shows the quality, the AI shows the risk and the next step, and you act without ever leaving the page. Every deal — fully in control, from first touch to close.",
          ru: "Карточка сделки — единое место, чтобы видеть, квалифицировать и вести сделку: MEDDPICC показывает качество, ИИ — риск и следующий шаг, а ты действуешь, не покидая страницу. Каждая сделка — под полным контролем, от первого касания до закрытия.",
        },
        do: async (p, l, h) => { await h.moveTo(DD_AISUG); await h.hover(DD_AISUG); },
      },
    ],
  },

  "mtm-overview": {
    route: "/mtm",
    title: { az: "Marşrut və sahə — Panel", en: "Routes & Field — Dashboard", ru: "Маршруты и поле — Панель" },
    scenes: [
      {
        voice: {
          az: "Bu — «Marşrut və sahə» modulunun idarə panelidir: bütün sahə komandanız bir ekranda. Agentlər, marşrutlar, vizitlər, tapşırıqlar — hamısı canlı. Ofisə bağlı qalmadan, kimin harada olduğunu və nə etdiyini real vaxtda görürsünüz.",
          en: "This is the control panel of the Routes & Field module: your entire field team on one screen. Agents, routes, visits, tasks — all live. Without being tied to the office, you see who is where and what they're doing, in real time.",
          ru: "Это панель управления модуля «Маршруты и поле»: вся твоя полевая команда на одном экране. Агенты, маршруты, визиты, задачи — всё вживую. Не привязываясь к офису, ты в реальном времени видишь, кто где и что делает.",
        },
        do: async (p, l, h) => { await h.moveTo(["main h1", "main h2", "main"]); await h.sleep(300); await h.hover(["main"]); },
      },
      {
        voice: {
          az: "Yuxarıdakı göstəricilər günün mənzərəsidir: planlaşdırılmış marşrutlar, tamamlananlar və ən vacibi — marşrutdan kənar on yeddi hal, diqqət tələb edir. Problemi axtarmırsınız, panel özü onu qabağınıza çıxarır.",
          en: "The metrics up top are the picture of the day: planned routes, the completed ones, and most important — seventeen off-route cases that need attention. You don't hunt for the problem; the panel surfaces it for you.",
          ru: "Показатели сверху — картина дня: запланированные маршруты, выполненные и самое важное — семнадцать случаев вне маршрута, требующих внимания. Ты не ищешь проблему — панель сама выводит её перед тобой.",
        },
        do: async (p, l, h) => { await h.moveTo(MTM_OFFROUTE); await h.hover(MTM_OFFROUTE); },
      },
      {
        voice: {
          az: "Gözləyən tapşırıqlar da elə burada sayılır — qırx beş tapşırıq, neçəsi təcili. Beləcə komandanın yükünü və harada gecikmə olduğunu bir baxışda görürsünüz.",
          en: "Pending tasks are counted right here too — forty-five tasks, and how many are urgent. So you see the team's load and where the delays are, at a single glance.",
          ru: "Ожидающие задачи считаются тут же — сорок пять задач и сколько из них срочные. Так ты одним взглядом видишь загрузку команды и где возникают задержки.",
        },
        do: async (p, l, h) => { await h.moveTo(MTM_PENDING); await h.hover(MTM_PENDING); },
      },
      {
        voice: {
          az: "Aşağıda zaman metrikaları var: orta marşrut vaxtı, orta vizit vaxtı, ümumi iş vaxtı. Bu rəqəmlər sahə işinin nə qədər səmərəli getdiyini göstərir — subyektiv hisslə yox, dəqiq ölçülərlə.",
          en: "Below are the time metrics: average route time, average visit time, total work time. These numbers show how efficiently the field work is running — with exact measurements, not a subjective feeling.",
          ru: "Ниже — метрики времени: среднее время маршрута, среднее время визита, общее рабочее время. Эти цифры показывают, насколько эффективно идёт полевая работа — точными мерами, а не на ощущениях.",
        },
        do: async (p, l, h) => { await h.moveTo(MTM_TIMEMETRICS); await h.hover(MTM_TIMEMETRICS); },
      },
      {
        voice: {
          az: "Sağda aktiv agentlər siyahısı: on beşdən dördü hazırda işdədir. Kimin onlayn olduğunu, kimin işə çıxdığını dərhal görürsünüz — komandanı canlı idarə edirsiniz.",
          en: "On the right is the list of active agents: four of fifteen are working right now. You immediately see who's online and who's out in the field — you manage the team live.",
          ru: "Справа — список активных агентов: четверо из пятнадцати сейчас в работе. Ты сразу видишь, кто онлайн и кто вышел в поле — управляешь командой вживую.",
        },
        do: async (p, l, h) => { await h.moveTo(MTM_AGENTS); await h.hover(MTM_AGENTS); },
      },
      {
        voice: {
          az: "Mənzərəni istədiyiniz dövrə uyğunlaşdırırsınız. «Bu həftə», «Bu ay» — bir kliklə bütün göstəricilər seçdiyiniz müddət üzrə yenidən hesablanır. Bu günün operativ nəzarəti də, dövrün təhlili də bir yerdə.",
          en: "You adjust the picture to any period you want. “This week,” “This month” — one click and every metric recalculates for the chosen timeframe. Both today's operational control and the period's analysis in one place.",
          ru: "Ты подстраиваешь картину под любой период. «Эта неделя», «Этот месяц» — одним кликом все показатели пересчитываются за выбранный срок. И оперативный контроль сегодня, и анализ за период — в одном месте.",
        },
        do: async (p, l, h) => { await h.click(MTM_WEEK); await h.sleep(700); await h.click(MTM_MONTH); await h.sleep(600); },
      },
      {
        voice: {
          az: "Bir kliklə yeni agent əlavə edir, hesabatları açır və ya canlı xəritəyə keçirsiniz. «Marşrut və sahə» paneli sahə əməliyyatlarınızın idarə mərkəzidir: hər şey görünür, hər şey ölçülür, hər şey nəzarətdədir.",
          en: "With one click you add a new agent, open the reports, or jump to the live map. The Routes & Field panel is the control center of your field operations: everything visible, everything measured, everything under control.",
          ru: "Одним кликом ты добавляешь нового агента, открываешь отчёты или переходишь на живую карту. Панель «Маршруты и поле» — центр управления полевыми операциями: всё видно, всё измеримо, всё под контролем.",
        },
        do: async (p, l, h) => { await h.moveTo(MTM_NEWAGENT); await h.hover(MTM_NEWAGENT); },
      },
    ],
  },

  "mtm-map": {
    route: "/mtm/map",
    title: { az: "Canlı Xəritə", en: "Live Map", ru: "Живая карта" },
    scenes: [
      {
        voice: {
          az: "Bu — canlı xəritədir: sahə agentlərinin real vaxtda GPS izlənməsi. Hər agent xəritədə öz mövqeyində görünür. Ofisdən çıxmadan bütün komandanın harada olduğunu canlı izləyirsiniz.",
          en: "This is the live map: real-time GPS tracking of your field agents. Each agent appears on the map at their position. Without leaving the office, you watch where the whole team is, live.",
          ru: "Это живая карта: GPS-отслеживание полевых агентов в реальном времени. Каждый агент виден на карте в своей позиции. Не выходя из офиса, ты вживую наблюдаешь, где находится вся команда.",
        },
        do: async (p, l, h) => { await h.moveTo(MAP_CONTAINER); await h.sleep(400); await h.hover(MAP_CONTAINER); },
      },
      {
        voice: {
          az: "Xəritədə hər nişan bir agentdir. Onlar şəhər üzrə hərəkət etdikcə mövqeləri yenilənir — Bakının küçələri boyunca real marşrutları görürsünüz. Bu, kağız üzərində plan yox, canlı mənzərədir.",
          en: "On the map, each marker is an agent. As they move across the city, their positions update — you see the real routes along the streets of Baku. This isn't a plan on paper; it's a live picture.",
          ru: "На карте каждая метка — это агент. Пока они перемещаются по городу, их позиции обновляются — ты видишь реальные маршруты по улицам Баку. Это не план на бумаге, а живая картина.",
        },
        do: async (p, l, h) => { await h.moveTo(MAP_CONTAINER); await h.hover(MAP_CONTAINER); },
      },
      {
        voice: {
          az: "Agentləri statusa görə süzgəcləyirsiniz: yerində, yolda, gecikir, oflayn. «Oflayn» üzərinə klik — və yalnız hazırda əlaqədə olmayan on beş agent qalır. Sonra «Hamısı» ilə tam mənzərəyə qayıdırsınız.",
          en: "You filter the agents by status: on-site, on the road, late, offline. Click “Offline,” and only the fifteen agents currently out of contact remain. Then “All” brings you back to the full picture.",
          ru: "Ты фильтруешь агентов по статусу: на точке, в пути, опаздывает, офлайн. Клик по «Офлайн» — и остаются только пятнадцать агентов, сейчас вне связи. Потом «Все» возвращает полную картину.",
        },
        do: async (p, l, h) => { await h.click(MAP_OFFLINE); await h.sleep(700); await h.click(MAP_ALL); await h.sleep(600); },
      },
      {
        voice: {
          az: "«İstilik xəritəsi» rejimi fəallığın harada cəmləndiyini göstərir — hansı rayonlarda daha çox vizit və hərəkət var. Bir baxışda görürsünüz ki, komanda hara sıx işləyir, hara isə çatmır.",
          en: "The “Heatmap” mode shows where activity concentrates — which districts have more visits and movement. At a glance you see where the team works densely, and where coverage is thin.",
          ru: "Режим «Тепловая карта» показывает, где сосредоточена активность — в каких районах больше визитов и перемещений. Одним взглядом видно, где команда работает плотно, а куда не дотягивается.",
        },
        do: async (p, l, h) => { await h.click(MAP_HEATMAP); await h.sleep(800); },
      },
      {
        voice: {
          az: "«Geozona» ilə xəritədə zonalar cızırsınız — məsələn, müştəri ərazisi. Agent zonaya girəndə və ya çıxanda sistem sizə avtomatik bildiriş verir. Beləcə sahə işi öz-özünü yoxlayır.",
          en: "With “Geofence” you draw zones on the map — for example, a customer's territory. When an agent enters or leaves a zone, the system alerts you automatically. That way the field work checks itself.",
          ru: "С «Геозоной» ты рисуешь зоны на карте — например, территорию клиента. Когда агент входит в зону или выходит из неё, система автоматически присылает тебе оповещение. Так полевая работа проверяет сама себя.",
        },
        do: async (p, l, h) => { await h.moveTo(MAP_GEOFENCE); await h.hover(MAP_GEOFENCE); },
      },
      {
        voice: {
          az: "Sağ paneldə canlı lent və agentlər siyahısı var: hadisələr baş verdikcə real vaxtda görünür, hər agentin statusu yanında. «Yenilə» ilə mənzərəni istənilən an təzələyirsiniz — məlumat həmişə cari qalır.",
          en: "The right panel has a live feed and the agents list: events appear in real time as they happen, each agent's status beside them. “Refresh” updates the picture any moment — the data always stays current.",
          ru: "На правой панели — живая лента и список агентов: события появляются в реальном времени, статус каждого агента рядом. «Обновить» освежает картину в любой момент — данные всегда актуальны.",
        },
        do: async (p, l, h) => { await h.moveTo(["main button:has-text('Yenilə')", "main button:has-text('Refresh')", "main button:has-text('Обновить')", "main"]); await h.hover(MAP_CONTAINER); },
      },
      {
        voice: {
          az: "Canlı xəritə sahə komandanızın gözüdür: real vaxtda GPS, statuslar, istilik xəritəsi və geozonalar bir ekranda. Kimin harada olduğunu təxmin etmirsiniz — görürsünüz və idarə edirsiniz.",
          en: "The live map is the eye over your field team: real-time GPS, statuses, heatmap, and geofences on one screen. You don't guess where anyone is — you see it, and you manage it.",
          ru: "Живая карта — это глаз над твоей полевой командой: GPS в реальном времени, статусы, тепловая карта и геозоны на одном экране. Ты не гадаешь, кто где, — ты это видишь и управляешь.",
        },
        do: async (p, l, h) => { await h.moveTo(MAP_CONTAINER); await h.hover(MAP_CONTAINER); },
      },
    ],
  },

  "mtm-routes": {
    route: "/mtm/routes",
    title: { az: "Marşrutlar: addım-addım işçi bələdçi" },
    scenes: [
      {
        voice: {
          az: "Bu, «Marşrutlar» bölməsi üçün ətraflı işçi bələdçidir. Burada bir agentin iş gününü planlayacağıq: əməkdaşı seçəcəyik, mövcud klinikanı elə bu səhifədə agentə təyin edəcəyik, həkim və aptek əlavə edəcəyik, vaxtları düzəldəcəyik, qaralamanı saxlayacaq və onu yayımlayacağıq. Bu bölmə yalnız menecer üçün deyil. İcazəsi olan agent də öz gününün marşrutunu eyni sadə addımlarla hazırlaya bilər. Videonu izləyərkən tələsməyin: hər mərhələdən sonra istəsəniz videonu dayandırın və öz hesabınızda həmin addımı təkrarlayın. Məqsəd düymələrin yerini əzbərləmək yox, gün planının məntiqini başa düşməkdir.",
        },
        do: async (p, l, h) => { await h.moveTo(["main h1", "main h2", "main"]); await h.hover(ROUTE_GUIDE_VIEW_CALENDAR); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Əvvəlcə təqvim görünüşünə baxaq. Burada hər gün ayrıca xana kimi görünür və həmin günə aid marşrutlar xananın içində yerləşir. Rəng marşrutun vəziyyətini bildirir: qaralama hələ hazırlanır, planlaşdırılmış marşrut agentə göndərilib, davam edən marşrut artıq işə başlayıb, tamamlanmış marşrut isə bağlanıb. Sadəcə kartın üstünə basmaqla onun detallarını aça bilərsiniz. Eyni gündə bir neçə kart görsəniz, bu xəta deyil: hər kart ayrı əməkdaşın və ya ayrı iş tapşırığının planıdır. İlk baxışda bu görünüş sizə günün nə qədər dolu olduğunu göstərir.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_VIEW_CALENDAR); await p.getByTestId("mtm-route-calendar").waitFor({ state: "visible", timeout: 15000 }); await h.hover(["[data-testid='mtm-route-calendar']"]); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "Komanda üzrə planı görmək üçün «Həftə» görünüşünü açın. Solda əməkdaşların adları, yuxarıda isə həftənin günləri var. Hər kart həmin əməkdaşın həmin günkü işidir. Menecer buradan bütün komandanın yükünü görə və boş xanadan yeni marşrut başlada bilər. Agent isə yalnız ona icazə verilmişsə öz sətrində plan yaradır; başqa əməkdaşın planını dəyişə bilmir. Həftə görünüşü xüsusilə faydalıdır, çünki bir nəfərin həddindən artıq yükləndiyini və digərinin boş olduğunu dərhal görürsünüz. Əvvəl yükü burada yoxlayın, sonra yeni plan yaradın.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_VIEW_WEEK); await p.getByTestId("mtm-route-week-plan").waitFor({ state: "visible", timeout: 15000 }); await h.hover(["[data-testid='mtm-route-week-plan']"]); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Bu qaydanı yadda saxlayın: marşruta yalnız seçilmiş əməkdaş üçün əlçatan olan müştərilər düşür. Əgər siyahı boşdursa, sistem xarab deyil və siz başqa səhifəyə getmirsiniz. Menecerdə elə marşrutun içində «Mövcud müştərini tap və təyin et» düyməsi görünür. Oradan klinikanı, apteki və ya həkimi tapır, həmin əməkdaşa bağlayır və bir kliklə plana əlavə edirsiniz. Agentin belə icazəsi yoxdursa, ekran rəhbərə müraciət etməyi sadə dillə deyir. Bu əlaqə bir dəfə düzgün qurulanda həm gələcək marşrutlar, həm də mobil tətbiq eyni bazadan istifadə edir.",
        },
        do: async (p, l, h) => { await h.moveTo(["[data-testid='mtm-week-empty-cell-action']", "[data-testid='mtm-route-week-plan']"]); await h.hover(["[data-testid='mtm-week-empty-cell-action']", "[data-testid='mtm-route-week-plan']"]); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "İndi tam nümunə yaradaq. Səhifənin sağ yuxarısındakı «Marşrut əlavə et» düyməsinə basırıq. Açılan forma üç böyük hissədən ibarətdir: birinci hissədə kim və hansı gün işləyəcək, ikinci hissədə hara gedəcək, üçüncü hissədə isə dayanacaqların sırası və vaxtı yoxlanılır. Aşağıdakı böyük düymə həmişə sizə növbəti lazım olan addımı göstərir. Formanı soldan sağa və yuxarıdan aşağıya doldurun; bütün məlumatı eyni anda axtarmağa ehtiyac yoxdur. Hər addım tamamlananda sistem növbəti hissəni aydın şəkildə açır.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_BUILDER_OPEN); await p.getByTestId("mtm-route-builder").waitFor({ state: "visible", timeout: 15000 }); await h.hover(ROUTE_GUIDE_BUILDER); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Birinci addımda əsas əməkdaşı və tarixi seçirik. Əsas əməkdaş marşrutu aparan şəxsdir. Tarix isə iş günüdür, marşrutun yaradıldığı gün deyil. Seçim edilən kimi sistem həmin əməkdaşın bazasını, onun əvvəlcədən planlaşdırılmış ziyarətlərini və iş gününü yoxlayır. Bu yoxlama sonradan eyni adamı eyni saatda iki yerə göndərməyin qarşısını alır. Siyahıda əməkdaş görünmürsə, onun aktiv statusunu və marşrut yaratmaq icazəsini «Agentlər» bölməsindən yoxlayın. Yanlış tarix seçmisinizsə, indi dəyişmək ən asandır; hələ heç bir marşrut yaranmayıb.",
        },
        do: async (p, l, h) => { await chooseRouteGuideAgentAndDate(p, h); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Əlavə parametrlər məcburi deyil, amma komanda işi üçün çox faydalıdır. Marşruta aydın ad verin: məsələn, «Yasamal – həkim və aptek ziyarətləri». Lazım olsa iştirakçı əlavə edin və qısa qeyd yazın. Adı oxuyan menecer niyə bu marşrutun yaradıldığını dərhal anlayır. Bu sahələri boş saxlamaq da olar; əsas olan əməkdaş, tarix və ən azı bir dayanacaqdır. Qeydə yalnız iş üçün vacib olan qısa məlumatı yazın: məsələn, görüşün məqsədi və ya müştərinin xahişi. Şəxsi və lazımsız məlumat yazmaqdan çəkinin.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_OPTIONAL); await h.fill(["#route-builder-name"], ROUTE_GUIDE_DYNAMIC_NAME); await h.fill(["#route-builder-notes"], "Həkim və aptek ziyarətləri üçün nümunə marşrut"); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "İkinci hissə — ziyarət ediləcək obyektlərdir. Üstdə üç sadə seçim var: «Təşkilatlar», «Həkimlər» və «Apteklər». Bu, axtarışı qarışdırmır: klinikanı ayrıca, həkimi ayrıca, apteki ayrıca tapırsınız. Aşağıdakı axtarış sətrinə ad, ünvan, telefon və ya kod yaza bilərsiniz. Hər kartda son ziyarət və artıq planlanmış iş barədə məlumat da görünür. Əvvəl nəyi tapdığınızı müəyyən edin: məkanın özünü, konkret həkimi, yoxsa aptek əlaqəsini. Sonra yalnız həmin nişanı seçin; nəticə azalar və seçim daha rahat olar.",
        },
        do: async (p, l, h) => { await openRouteGuideCustomersStep(p, h); await h.hover(["[data-testid='mtm-route-customer-picker']"]); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "İndi siyahıda görünməyən, amma kataloqda artıq mövcud olan klinikanı əlavə edək. Adı və ya kodu axtarırıq. Adi namizəd tapılmayanda sistem bizə «Mövcud müştərini tap və təyin et» düyməsini göstərir. Düyməni basırıq, həmin klinikanı elə burada tapırıq və «Təyin et və əlavə et» seçirik. Səhifə dəyişmir, seçdiyimiz əməkdaş və tarix itmir, klinika isə dərhal marşrutun dayanacağı olur. Başqa əməkdaşa bağlı obyekt seçilərsə, sistem köçürməni ayrıca təsdiqləməyi tələb edir; buna görə heç bir müştəri səssizcə bir agentdən digərinə keçmir.",
        },
        do: async (p, l, h) => { await assignRouteGuideInlineCustomer(p, h); await h.hover(["[data-testid='mtm-route-customer-picker']"]); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "Əvvəl həkim əlavə edək. «Həkimlər» düyməsinə basırıq. Qarşımızda yalnız seçilmiş əməkdaşa təyin edilmiş həkimlər görünür. Kartdakı üstəgəl işarəsinə basmaqla həkim dərhal marşruta keçir. Onu əvvəlcədən ayrıca seçmək, sonra yenidən axtarmaq lazım deyil. Kart yaşıl işarə alanda həmin həkim artıq marşruta daxil edilib. Lazım olan həkim görünmürsə, bu ekranda adını yenidən yaratmayın. Əvvəl onun «Sahə kontaktları»nda düzgün iş yerinə və seçilmiş agentə bağlı olduğunu yoxlayın.",
        },
        do: async (p, l, h) => { await addRouteGuideCandidate(p, h, "DOCTOR"); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "İndi aptek əlavə edirik. «Apteklər» düyməsinə keçin və uyğun kartın üstəgəl işarəsinə basın. Bir marşrutda həkim, aptek və təşkilat birlikdə ola bilər. Sistem eyni obyekti iki dəfə əlavə etməyə imkan vermir. Beləliklə, marşrut təmiz qalır, agent isə gün ərzində hansı nöqtəyə getməli olduğunu ardıcıllıqla görür. Aptek üçün də eyni qayda var: kart yoxdursa, əvvəl müştərinin seçilmiş agentə təyin olunmasını yoxlayın. Bir nöqtə səhv əlavə olunarsa, növbəti addımda onu təhlükəsiz silmək mümkündür.",
        },
        do: async (p, l, h) => { await addRouteGuideCandidate(p, h, "PHARMACY"); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Namizədlər çoxdursa, «Filtrlər və plan yoxlaması» hissəsini açın. Burada rayon, şəhər, təşkilat növü, ixtisas və digər meyarlarla siyahını daralda bilərsiniz. Filtrlərin yuxarısında sistemin hansı əməkdaş, tarix və istiqamət üzrə axtardığı açıq yazılır. Səhv nəticə görsəniz, əvvəl bu üç məlumatı yoxlayın. Beləliklə, “niyə müştəri görünmür?” sualının cavabı birbaşa ekrandadır. Bir filtr qoyduqdan sonra nəticələrin sayına baxın. Lazım olan kart yoxdursa, filtrinizi təmizləyin və əvvəlcə geniş siyahıda həmin obyektin həqiqətən təyin edildiyini yoxlayın.",
        },
        do: async (p, l, h) => { await h.click(["[data-testid='mtm-route-planning-tools'] summary"]); await h.hover(["[data-testid='mtm-route-planning-tools']"]); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Müştərilər seçildi. İndi «Əlavəni bitir» düyməsinə basırıq və üçüncü addıma keçirik. Burada bütün dayanacaqlar bir siyahıda görünür. «Vaxtları planlaşdır» düyməsi boş vaxtları avtomatik ardıcıllıqla doldurur. Bu, sürətli başlanğıc üçündür; son qərar yenə sizindir. İstəsəniz vaxtı bir-bir dəyişə, dayanacaqları yuxarı və aşağı oxlarla yerini dəyişə, artıq nöqtəni isə xaçla silə bilərsiniz. Avtomatik planlama yolu və görüşün real müddətini insan qədər yaxşı bilmir; o sadəcə başlanğıc ardıcıllığı verir. Ona görə müştərinin dəqiq qəbul saatı varsa, onu bu ekranda əl ilə düzəldin.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_FINISH_CUSTOMERS); await p.getByTestId("mtm-route-customer-picker").waitFor({ state: "hidden", timeout: 10000 }); await h.click(ROUTE_GUIDE_AUTO_SCHEDULE); await p.getByTestId("mtm-route-stop-2").waitFor({ state: "visible", timeout: 10000 }); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Yadda saxlamazdan əvvəl bu yoxlama siyahısına baxın: əsas əməkdaş düzgündürmü, tarix iş günüdürmü, dayanacaqların ardıcıllığı məntiqlidirmi və hər birinin vaxtı varmı? Yol məsafəsini nəzərə almaq üçün əvvəl daha uzaq nöqtəni, sonra ona yaxın olan nöqtəni yerləşdirin. Bu xırda yoxlama agentin tələsməsinin, gecikməsinin və boş gedişlərinin qarşısını alır. Hər dayanacaq üçün real vaxt qoyun: qəbul, yol və qısa fasilə də günün bir hissəsidir. Vaxtı olmayan kart yayımlandıqda agent üçün anlaşılmaz plan yarada bilər.",
        },
        do: async (p, l, h) => { await h.moveTo(["[data-testid='mtm-route-stop-0']"]); await h.hover(["[data-testid='mtm-route-stop-0']"]); await h.moveTo(["[data-testid='mtm-route-stop-time-1']"]); await h.hover(["[data-testid='mtm-route-stop-time-1']"]); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "İndi «Qaralamanı saxla» düyməsinə basırıq. Qaralama hələ agentə göndərilmir. Siz onu sonradan aça, vaxtını dəyişə, nöqtə əlavə edə və ya silə bilərsiniz. Bu mərhələ xüsusilə faydalıdır: səhər planı hazırlayırsınız, amma rəhbər və ya müştəri cavab verməmişdirsə, yanlışlıqla hazır iş kimi yayımlamırsınız. Qaralamanı saxlamaq işinizi itirməmək üçündür, onu gizlətmək üçün deyil. Yəni günə hazırlaşın, amma yalnız təsdiqlənmiş planı agentin qarşısına çıxarın.",
        },
        do: async (p, l, h) => { await saveRouteGuideDraft(p, h); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Saxlandıqdan sonra marşrutun kartı açılır. Burada təyin olunmuş əməkdaş, dayanacaqların sayı, icra faizi, xəritə və bütün nöqtələr görünür. Qaralama üçün «Düzəliş et» və «Marşrutu yayımla» düymələri var. Düzəliş lazım olanda qaralamanı dəyişin. Agentin görməsi və işləməsi üçün plan hazır olanda yalnız onda yayımlayın. Kartı açanda bir daha xəritə və ünvanlara nəzər salın. Bəzən eyni adlı obyektlər fərqli rayonlarda olur; ünvanı indi yoxlamaq son anda səhv istiqamətə getməyin qarşısını alır.",
        },
        do: async (p, l, h) => { await h.hover(ROUTE_GUIDE_DETAIL); await h.holdUntil(0.78); await removeCreatedRouteGuideDraft(p); },
      },
      {
        voice: {
          az: "İndi əvvəlcədən hazırlanmış qaralamanı açırıq ki, yayımlama anını ayrıca, aydın görə bilək. «Digər» menyusundan «Bütün marşrutlar» görünüşünü açın və adla axtarış edin. Axtarış nəticəni dərhal daraldır, ona görə yüzlərlə marşrutu əl ilə gəzmək lazım deyil. «Bax» düyməsi kartın bütün detallarını açır; qaralamanın yanında hələ yayımla düyməsi görünür. Adı xatırlamırsınızsa, agentin adı və tarixdən də başlayın, sonra qısa sözlə axtarışı daraldın. «Bütün marşrutlar» tarixçəni izləmək və əvvəldən saxlanmış planı tapmaq üçün ən rahat görünüşdür.",
        },
        do: async (p, l, h) => { await openSeededRouteGuideDraft(p, h); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Yayımlamaq son, şüurlu addımdır. Bu düyməyə basanda marşrut «Planlaşdırılmış» vəziyyətinə keçir və təyin olunmuş agent onu öz təqvimində görür. Buna görə yayımlamadan əvvəl tarixə, əməkdaşa və dayanacaqlara bir dəfə də baxın. Əgər hələ razılaşdırma gözlənilirsə, yayımlamayın — qaralama kimi saxlayın. Bu qayda komandada qarışıqlığın qarşısını alır. Xüsusilə müştərinin görüşü təsdiqlədiyini və agentin həmin gün işdə olduğunu yoxlayın. Yayımlama düyməsi sadəcə saxlama düyməsi deyil; o, iş tapşırığını real icraya buraxır.",
        },
        do: async (p, l, h) => { await h.moveTo(ROUTE_GUIDE_PUBLISH); await h.hover(ROUTE_GUIDE_PUBLISH); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "İndi marşrutu yayımlayırıq. Uğurlu yayımdan sonra plan sabit iş tapşırığına çevrilir: agent günün planında dayanacaqları görür, nöqtəyə gedir, ziyarəti icra edir və nəticəni qeyd edir. Menecer isə təqvimdən və xəritədən irəliləyişi izləyir. Əgər müştəri sonradan planı dəyişmək istəsə, artıq sadəcə səssizcə silmək yox, qaydalı dəyişiklik və ya ləğv prosesi işləyir. Bu həm agentə, həm menecerə nə baş verdiyini aydın saxlayır. Dəyişiklik olduqda səbəbi qısa qeydlə yazın ki, komanda sonradan niyə planın dəyişdiyini başa düşsün.",
        },
        do: async (p, l, h) => { await publishSeededRouteGuideDraft(p, h); await h.hover(ROUTE_GUIDE_DETAIL); await h.holdUntil(0.9); },
      },
      {
        voice: {
          az: "Yayımlanmış plan həm təqvimdə, həm də agentin iş axınında görünür. Agent mobil tətbiqdə öz gününü açır, marşrutu görür, növbəti dayanacağa keçir və ziyarəti qeyd edir. Menecer bütün komandanın həftəlik görünüşünü izləyir. Eyni müştəri ilə görüşün komanda üçün görünməsi ayrıca görünürlük qaydası ilə idarə olunur; lazım olduqda müştərinin məxfiliyi qorunur. Agent yalnız öz işi üçün lazım olan məlumatı görür, menecer isə planın icrasını izləyir. Bu bölüşmə həm əməkdaşlar arasında koordinasiyanı, həm də müştəri məlumatının təhlükəsizliyini qoruyur.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_VIEW_CALENDAR); await p.getByTestId("mtm-route-calendar").waitFor({ state: "visible", timeout: 15000 }); await h.hover(["[data-testid='mtm-route-calendar']"]); await h.holdUntil(0.92); },
      },
      {
        voice: {
          az: "Qısa gündəlik qayda belədir: əməkdaşı və tarixi seçin, yalnız onun təyin olunmuş bazasından müştəri əlavə edin, vaxt və ardıcıllığı yoxlayın, əvvəl qaralama saxlayın, hazır olanda yayımlayın. Bu ardıcıllıqdan istifadə etsəniz, menecer üçün nəzarət, agent üçün aydın gün planı, müştəri üçün isə vaxtında ziyarət yaranır. Növbəti dəfə bu prosesi eyni addımlarla təkrarlayın. Haradasa ilişsəniz, ən əvvəl seçilmiş agenti, tarixi və müştərinin təyinatını yoxlayın — problemlərin çoxu məhz bu üç nöqtədə həll olunur. İndi öz real iş gününüz üçün bir qaralama yaradıb təhlükəsiz şəkildə məşq edə bilərsiniz.",
        },
        do: async (p, l, h) => { await h.click(ROUTE_GUIDE_VIEW_WEEK); await p.getByTestId("mtm-route-week-plan").waitFor({ state: "visible", timeout: 15000 }); await h.hover(["[data-testid='mtm-route-week-plan']"]); await h.holdUntil(0.94); },
      },
    ],
  },

  "mtm-visits": {
    route: "/mtm/visits",
    title: { az: "Ziyarətlər", en: "Visits", ru: "Визиты" },
    scenes: [
      // 1 — What the visit log is.
      {
        voice: {
          az: "«Ziyarətlər» — sahə agentlərinizin müştərilərdə hər giriş və çıxışının jurnalıdır. Otuz beş ziyarət: kim, hansı müştəridə, nə vaxt olub və nə qədər qalıb. Sözlə hesabat yox — faktiki, vaxt möhürlü qeydlər.",
          en: "“Visits” is the log of your field agents' every check-in and check-out at customers. Thirty-five visits: who, at which customer, when, and how long they stayed. Not a verbal report — actual, time-stamped records.",
          ru: "«Визиты» — это журнал каждого чекина и чекаута полевых агентов у клиентов. Тридцать пять визитов: кто, у какого клиента, когда был и сколько пробыл. Не отчёт на словах — фактические записи с метками времени.",
        },
        do: async (p, l, h) => { await h.moveTo(["main h1", "main h2", "main"]); await h.sleep(300); await h.hover(["main"]); },
      },
      // 2 — The log table.
      {
        voice: {
          az: "Jurnal hər ziyarəti sətir-sətir göstərir: agent, müştəri, status, giriş və çıxış vaxtı. Məsələn, agent Store ikidə axşam saat on birdə giriş edib, gecə saat ikidə çıxıb. Hər hərəkət tarix-vaxtı ilə qeyddədir.",
          en: "The log shows every visit row by row: agent, customer, status, check-in and check-out time. For example, an agent checked in at Store two at eleven at night and checked out at two in the morning. Every action is recorded with its date and time.",
          ru: "Журнал показывает каждый визит строка за строкой: агент, клиент, статус, время чекина и чекаута. Например, агент зашёл в Store два в одиннадцать вечера и вышел в два ночи. Каждое действие записано с датой и временем.",
        },
        do: async (p, l, h) => { await h.moveTo(VS_TABLE); await h.hover(VS_TABLE); },
      },
      // 3 — Duration + GPS verification.
      {
        voice: {
          az: "Hər ziyarətin müddəti avtomatik hesablanır — neçə dəqiqə müştəridə qalıb — və GPS sütunu ziyarətin harada baş verdiyini təsdiqləyir. Uzaqlıq böyükdürsə xəbərdarlıq göstərilir. Beləcə ziyarətin həqiqətən olub-olmadığını yoxlayırsınız.",
          en: "Each visit's duration is calculated automatically — how many minutes were spent at the customer — and the GPS column confirms where the visit took place. If the distance is large, a warning is shown. So you verify that the visit really happened.",
          ru: "Длительность каждого визита считается автоматически — сколько минут провели у клиента — а колонка GPS подтверждает, где визит состоялся. Если расстояние большое, показывается предупреждение. Так ты проверяешь, что визит действительно был.",
        },
        do: async (p, l, h) => { await h.moveTo(VS_GPS); await h.hover(VS_GPS); },
      },
      // 4 — Log a visit (open form).
      {
        voice: {
          az: "Ziyarəti əl ilə də qeyd edə bilərsiniz. «Ziyarət qeyd et» düyməsinə klik edirik — və forma açılır: agenti və müştərini seçirsiniz, GPS koordinatlarını — enlik və uzunluğu — daxil edirsiniz, qeyd əlavə edirsiniz. «Yarat» — və ziyarət jurnala düşür.",
          en: "You can also log a visit manually. We click “Log visit,” and a form opens: you pick the agent and the customer, enter the GPS coordinates — latitude and longitude — and add a note. Hit “Create,” and the visit lands in the log.",
          ru: "Визит можно записать и вручную. Кликаем «Записать визит» — и открывается форма: выбираешь агента и клиента, вводишь GPS-координаты — широту и долготу — добавляешь заметку. Жмёшь «Создать» — и визит попадает в журнал.",
        },
        do: async (p, l, h) => { await h.click(VS_LOG); await h.sleep(1000); },
      },
      // 5 — Edit a recorded visit (same form, pre-filled).
      {
        voice: {
          az: "Yazılmış ziyarəti də düzəldə bilərsiniz — sətrin yanındakı qələm işarəsinə klik edin, eyni forma açılır. Səhv agent, yanlış müştəri və ya koordinat varsa — düzəldib saxlayırsınız. Jurnal həmişə dəqiq qalır.",
          en: "You can also correct a recorded visit — click the pencil icon next to the row, and the same form opens. If there's a wrong agent, wrong customer or coordinate, you fix it and save. The log always stays accurate.",
          ru: "Записанный визит тоже можно поправить — кликни по значку карандаша рядом со строкой, откроется та же форма. Если не тот агент, не тот клиент или координата — исправляешь и сохраняешь. Журнал всегда остаётся точным.",
        },
        do: async (p, l, h) => { await h.click(MODAL_CANCEL); await h.sleep(600); await h.click(VS_EDIT); await h.sleep(900); },
      },
      // 6 — Closing.
      {
        voice: {
          az: "«Ziyarətlər» jurnalı sahə işinin sübutudur: hər giriş, çıxış, müddət və GPS nöqtəsi qeyddə — və istənilən yazını əlavə edib ya düzəldə bilərsiniz. Agentlərin işini təxminlə yox, faktla ölçürsünüz.",
          en: "The “Visits” log is the proof of field work: every check-in, check-out, duration and GPS point recorded — and you can add or fix any entry. You measure your agents' work with facts, not guesses.",
          ru: "Журнал «Визиты» — доказательство полевой работы: каждый чекин, чекаут, длительность и GPS-точка записаны — и любую запись можно добавить или поправить. Ты измеряешь работу агентов фактами, а не догадками.",
        },
        do: async (p, l, h) => { await h.click(MODAL_CANCEL); await h.sleep(500); await h.moveTo(VS_TABLE); await h.hover(VS_TABLE); },
      },
    ],
  },

  "mtm-tasks": {
    route: "/mtm/tasks",
    title: { az: "Sahə tapşırıqları", en: "Field Tasks", ru: "Полевые задачи" },
    scenes: [
      {
        voice: {
          az: "«Sahə tapşırıqları» sahə agentlərinizə verilmiş tapşırıqların idarə mərkəzidir. Burada yüz otuz altı tapşırıq var — kim nə etməlidir, hansı prioritetlə və hansı mərhələdə. Bütün sahə işi bir lövhədə görünür.",
          en: "“Field Tasks” is the control center for the tasks assigned to your field agents. There are a hundred and thirty-six tasks here — who has to do what, with what priority, and at what stage. All the field work is visible on one board.",
          ru: "«Полевые задачи» — центр управления задачами, выданными полевым агентам. Здесь сто тридцать шесть задач — кто что должен сделать, с каким приоритетом и на какой стадии. Вся полевая работа видна на одной доске.",
        },
        do: async (p, l, h) => { await h.moveTo(["main h1", "main h2", "main"]); await h.sleep(300); await h.hover(["main"]); },
      },
      {
        voice: {
          az: "Yuxarıda ümumi mənzərə: yüz otuz altı tapşırıqdan qırx beşi gözləyir, doxsan biri tamamlanıb. Aşağıda kanban lövhəsi üç sütuna bölünür — «Görüləcək», «Davam edir», «Tamamlandı». Hər tapşırıq öz mərhələsində görünür.",
          en: "At the top, the overall picture: of the hundred and thirty-six tasks, forty-five are pending and ninety-one are completed. Below, the kanban board splits into three columns — “To Do,” “In Progress,” “Completed.” Each task sits in its own stage.",
          ru: "Сверху общая картина: из ста тридцати шести задач сорок пять ожидают, девяносто одна завершена. Ниже канбан-доска делится на три колонки — «К выполнению», «В процессе», «Завершено». Каждая задача — в своей стадии.",
        },
        do: async (p, l, h) => { await h.moveTo(TK_PENDING); await h.hover(TK_PENDING); },
      },
      {
        voice: {
          az: "Hər kartda tapşırığın adı, prioriteti və məsul agenti göstərilir — məsələn, «Orta» prioritet, Kamran Abbasov. «Start» düyməsi ilə tapşırığı bir kliklə növbəti mərhələyə — «Davam edir»ə keçirirsiniz. İş irəlilədikcə kartlar sütunlar arasında hərəkət edir.",
          en: "Each card shows the task's name, its priority and the responsible agent — for example, “Medium” priority, Kamran Abbasov. With the “Start” button you move the task to the next stage — “In Progress” — in one click. As the work advances, the cards move between the columns.",
          ru: "На каждой карточке — название задачи, приоритет и ответственный агент — например, приоритет «Средний», Камран Аббасов. Кнопкой «Start» ты одним кликом переводишь задачу на следующую стадию — «В процессе». По мере работы карточки двигаются между колонками.",
        },
        do: async (p, l, h) => { await h.moveTo(TK_START); await h.hover(TK_START); },
      },
      {
        voice: {
          az: "Yeni tapşırığı «Tapşırıq əlavə et» ilə yaradırsınız — və forma açılır: başlığı yazırsınız, agenti və müştərini seçirsiniz, prioriteti, statusu və son tarixi təyin edirsiniz, təsvir əlavə edirsiniz. «Yarat» — və tapşırıq agentin lövhəsinə düşür.",
          en: "You create a new task with “Add task,” and a form opens: you write the title, pick the agent and the customer, set the priority, status and due date, and add a description. Hit “Create,” and the task drops onto the agent's board.",
          ru: "Новую задачу ты создаёшь через «Добавить задачу» — открывается форма: пишешь заголовок, выбираешь агента и клиента, задаёшь приоритет, статус и срок, добавляешь описание. Жмёшь «Создать» — и задача попадает на доску агента.",
        },
        do: async (p, l, h) => { await h.click(TK_ADD); await h.sleep(1200); },
      },
      {
        voice: {
          az: "Mövcud tapşırığı redaktə etmək üçün karta yaxınlıqdakı qələm işarəsinə klik edin — eyni forma açılır, artıq doldurulmuş. Prioriteti dəyişir, son tarixi köçürür, statusu yeniləyir və ya təsviri düzəldirsiniz. Yaratmaq və redaktə — eyni yerdə.",
          en: "To edit an existing task, click the pencil icon next to the card — the same form opens, already filled in. You change the priority, move the due date, update the status, or fix the description. Creating and editing — in the same place.",
          ru: "Чтобы отредактировать существующую задачу, кликни по карандашу рядом с карточкой — открывается та же форма, уже заполненная. Меняешь приоритет, переносишь срок, обновляешь статус или правишь описание. Создание и редактирование — в одном месте.",
        },
        do: async (p, l, h) => { await h.click(MODAL_CANCEL); await h.sleep(600); await h.click(TK_EDIT); await h.sleep(900); },
      },
      {
        voice: {
          az: "«Sahə tapşırıqları» sahə komandanızın iş axınıdır: tapşırıq yaradın, agentə təyin edin, prioritet qoyun və mərhələlər üzrə izləyin — hamısı bir kanban lövhəsində. Heç bir tapşırıq unudulmur.",
          en: "“Field Tasks” is your field team's workflow: create a task, assign it to an agent, set the priority, and track it across stages — all on one kanban board. No task is forgotten.",
          ru: "«Полевые задачи» — это рабочий поток твоей полевой команды: создавай задачу, назначай агенту, ставь приоритет и отслеживай по стадиям — всё на одной канбан-доске. Ни одна задача не забыта.",
        },
        do: async (p, l, h) => { await h.click(MODAL_CANCEL); await h.sleep(500); await h.moveTo(TK_PENDING); await h.hover(TK_PENDING); },
      },
    ],
  },

  "mtm-photos": {
    route: "/mtm/photos",
    title: { az: "Şəkillər", en: "Photos", ru: "Фотографии" },
    scenes: [
      // 1 — What the photo wall is.
      {
        voice: {
          az: "«Şəkillər» sahə komandanızın yoxlama divarıdır. Agentlərinizin sahədə çəkdiyi hər vitrin və promo düz bura düşür — hər kadr GPS və vaxt möhürü ilə. Sözlə hesabata inanmaq əvəzinə, əsl sübutu öz gözünüzlə görürsünüz.",
          en: "“Photos” is the verification wall for your field team. Every display and promo your agents photograph in the field lands right here — each shot GPS-stamped and time-stamped. Instead of trusting a verbal report, you see the real proof with your own eyes.",
          ru: "«Фотографии» — это стена проверки для твоей полевой команды. Каждая витрина и промо, которые агенты снимают в поле, попадают прямо сюда — каждый кадр с меткой GPS и времени. Вместо того чтобы верить отчёту на словах, ты видишь реальное доказательство своими глазами.",
        },
        do: async (p, l, h) => { await h.moveTo(PH_TITLE); await h.sleep(300); await h.hover(PH_TITLE); },
      },
      // 2 — The review funnel (stat cards).
      {
        voice: {
          az: "Yuxarıdakı kartlar yoxlama mənzərəsini bir baxışda göstərir: ümumi şəkil sayı, neçəsi hələ yoxlamanı gözləyir, neçəsini təsdiqləmisiniz və neçəsini rədd etmisiniz. Sahə işinin nə qədərinin yoxlanıldığını — və nə qədərinin hələ diqqətinizi gözlədiyini — həmişə dəqiq bilirsiniz.",
          en: "The cards up top show the review funnel at a glance: total photos, how many are still pending your review, how many you've approved, and how many you've rejected. You always know exactly how much of the field's work is verified — and how much still needs your eyes.",
          ru: "Карточки сверху показывают воронку проверки одним взглядом: всего фото, сколько ещё ждут твоей проверки, сколько ты одобрил и сколько отклонил. Ты всегда точно знаешь, какая часть полевой работы проверена — а какая ещё ждёт твоего внимания.",
        },
        do: async (p, l, h) => { await h.moveTo(PH_STATS); await h.hover(PH_STATS); },
      },
      // 3 — Filter by review state (real clicks).
      {
        voice: {
          az: "Divarı yoxlama vəziyyətinə görə süzürsünüz. «Yoxlamada» klik edin — və yalnız qərar gözləyən şəkillər qalır, sizin növbəniz. «Təsdiqlənmiş» yoxlanmışları göstərir, «Hamısı»na bir klik isə bütün divarı geri qaytarır. Məhz istədiyiniz dəsti yoxlayırsınız, başqa heç nə mane olmur.",
          en: "You filter the wall by review state. Click “Pending,” and only the photos waiting for a decision remain — your review queue. “Approved” shows the verified ones, and one click on “All” brings the whole wall back. You review exactly the set you want, with nothing else in the way.",
          ru: "Ты фильтруешь стену по состоянию проверки. Клик по «На проверке» — и остаются только фото, ждущие решения, твоя очередь. «Одобрено» показывает проверенные, а один клик по «Все» возвращает всю стену. Ты проверяешь ровно тот набор, что нужен, ничто другое не мешает.",
        },
        do: async (p, l, h) => { await h.click(PH_PENDING); await h.sleep(750); await h.click(PH_APPROVED_FILTER); await h.sleep(750); await h.click(PH_ALL); await h.sleep(500); },
      },
      // 4 — Compare two shots side by side (real clicks).
      {
        voice: {
          az: "Müqayisə rejimi iki kadrı yan-yana qoyur. Bir şəkli, sonra digərini klik edin — və onlar birlikdə düzülür: eyni vitrin yenilənmədən əvvəl və sonra, ya da iki agentin promo üzərindəki işi. Siyahıda görünməyən fərqlər yan-yana qoyulan an gözə çarpır.",
          en: "The compare view puts two shots side by side. Click one photo, then another, and they line up together — the same display before and after an update, or two agents' work on one promotion. Differences that are invisible in a list jump out the moment you see them next to each other.",
          ru: "Режим сравнения ставит два кадра рядом. Кликни одно фото, затем другое — и они выстраиваются вместе: та же витрина до и после обновления или работа двух агентов над одним промо. Различия, невидимые в списке, бросаются в глаза, как только ты видишь их рядом.",
        },
        do: async (p, l, h) => { await h.click(PH_COMPARE); await h.sleep(600); await h.click(PH_CARD3); await h.sleep(700); await h.click(PH_CARD4); await h.sleep(700); await p.evaluate(() => window.scrollTo({ top: 0 })).catch(() => {}); await h.sleep(1000); },
      },
      // 5 — Batch review (real multi-select → bulk bar).
      {
        voice: {
          az: "Çoxlu şəkil eyni anda gələndə onları toplu yoxlayırsınız. Toplu rejimə keçin, etibar etdiyiniz kadrları işarələyin — və bütün seçimi bir kliklə təsdiqləmək ya rədd etmək üçün panel çıxır. Yüz sahə şəkli bir günün yarısı yox, bir neçə dəqiqəlik işə çevrilir.",
          en: "When many photos come in at once, you review them in bulk. Switch to batch mode, tick the shots you trust, and a bar appears to approve or reject the whole selection in a single click. A hundred field photos become a few minutes of work, not a whole afternoon.",
          ru: "Когда фото приходят сразу помногу, ты проверяешь их пачкой. Переключись в пакетный режим, отметь кадры, которым доверяешь — и появляется панель, чтобы одобрить или отклонить весь выбор одним кликом. Сотня полевых фото превращается в несколько минут работы, а не в полдня.",
        },
        do: async (p, l, h) => { await h.click(PH_BATCH); await h.sleep(600); await h.click(PH_CARD1); await h.sleep(450); await h.click(PH_CARD2); await h.sleep(450); await h.click(PH_CARD3); await h.sleep(1000); },
      },
      // 6 — Approve / reject a photo (real click, restored after for reproducibility).
      {
        voice: {
          az: "Hər gözləyən şəklin iki düyməsi var — təsdiq və rədd. Yaşıl işarəyə bir klik kadrı təsdiqləyir və «Təsdiqlənmiş»ə köçürür. Qırmızı çarpaza bir klik isə onu yenidən çəkmək üçün geri göndərir. Bax burada aydın sahə şəklini qəbul edir, bulanıq olanı rədd edirik — qərar ani verilir və adınızla qeydə alınır.",
          en: "Every pending photo carries two buttons — approve and reject. One click on the green check verifies the shot and moves it to Approved. One click on the red cross sends it back for a retake. Right here we accept a clear field photo and reject a blurred one — the decision is instant, and it's logged with your name.",
          ru: "У каждого фото на проверке две кнопки — одобрить и отклонить. Клик по зелёной галочке подтверждает кадр и переводит его в «Одобрено». Клик по красному крестику отправляет его на пересъёмку. Вот здесь мы принимаем чёткое полевое фото и отклоняем размытое — решение мгновенно и записывается с твоим именем.",
        },
        do: async (p, l, h) => { await h.click(PH_GALLERY); await h.sleep(500); await h.click(PH_PENDING); await h.sleep(850); await h.click(PH_APPROVE); await h.sleep(1200); await h.click(PH_REJECT); await h.sleep(1200); await restorePending(p); },
      },
      // 7 — Export + closing.
      {
        voice: {
          az: "Yoxlama bitəndə «Export»a bir klik bütün təsdiqlənmiş dəsti hesabat ya audit üçün çıxarır. Bu, şəkil divarıdır: xam sahə kadrları içəri gəlir, təsdiqlənmiş, GPS-yoxlanmış sübut isə çölə çıxır — vitrinləriniz və promolarınız, masanızdan qalxmadan təsdiqlənir.",
          en: "And when the review is done, one click on “Export” pulls the whole verified set out for a report or an audit. That's the photo wall: raw field shots come in, and verified, GPS-checked proof goes out — your displays and promotions, confirmed without ever leaving your desk.",
          ru: "А когда проверка закончена, один клик по «Export» выгружает весь проверенный набор для отчёта или аудита. Вот это и есть стена фотографий: сырые полевые кадры входят, а проверенное, GPS-подтверждённое доказательство выходит — твои витрины и промо подтверждены, не вставая из-за стола.",
        },
        do: async (p, l, h) => { await h.click(PH_ALL); await h.sleep(400); await h.moveTo(PH_EXPORT); await h.hover(PH_EXPORT); },
      },
    ],
  },

  "mtm-alerts": {
    route: "/mtm/alerts",
    title: { az: "Xəbərdarlıqlar", en: "Alerts", ru: "Оповещения" },
    scenes: [
      // 1 — What the alerts section is.
      {
        voice: {
          az: "«Xəbərdarlıqlar» bölməsi sahə modulunuzun keşikçisidir. Sistem hər agentin GPS-ini və qrafikini durmadan izləyir və nəsə düz getməyəndə — GPS nasazlığı, gecikmə, buraxılmış ziyarət, həddindən artıq uzun fasilə — dərhal burada xəbərdarlıq qaldırır. Problemləri siz axtarmırsınız, onlar özləri sizə gəlir.",
          en: "The “Alerts” section is your field module's watchdog. The system watches every agent's GPS and schedule, and the moment something's off — a GPS glitch, a late start, a missed visit, a break that ran too long — it raises an alert right here. You don't chase problems; they come to you.",
          ru: "Раздел «Оповещения» — сторож вашего полевого модуля. Система следит за GPS и графиком каждого агента, и как только что-то не так — сбой GPS, опоздание, пропущенный визит, слишком длинный перерыв — тут же поднимает оповещение прямо здесь. Вы не гоняетесь за проблемами — они сами приходят к вам.",
        },
        do: async (p, l, h) => { await h.moveTo(AL_TITLE); await h.sleep(300); await h.hover(AL_TITLE); },
      },
      // 2 — Severity stat cards.
      {
        voice: {
          az: "Yuxarıdakı kartlar hər şeyi ciddiliyə görə sıralayır: ümumi xəbərdarlıqlar, indi müdaxilə tələb edən kritiklər, göz altında saxlanası xəbərdarlıqlar və neçəsini artıq həll etmisiniz. Bir baxış bu gün sahənin nə qədər sağlam olduğunu deyir.",
          en: "The cards up top sort everything by severity: total alerts, the critical ones that need action now, the warnings to keep an eye on, and how many you've already resolved. One glance tells you how healthy the field is today.",
          ru: "Карточки сверху сортируют всё по важности: всего оповещений, критические — которые требуют действия сейчас, предупреждения — за которыми стоит следить, и сколько уже решено. Один взгляд говорит, насколько здорово поле сегодня.",
        },
        do: async (p, l, h) => { await h.moveTo(AL_STATS); await h.hover(AL_STATS); },
      },
      // 3 — Grouped by type (the headline of the redesign).
      {
        voice: {
          az: "Bir-birinə bənzəyən sətirlərin düz divarı əvəzinə, xəbərdarlıqlar əslində nə baş verdiyinə görə qruplaşdırılır — marşrutdan kənar, GPS saxtakarlığı, uzun fasilə və sair. Hər qrupun sadə adı, ciddiliyi, sayı və bir sətirlik «nə etməli» məsləhəti var — bir baxışda nəyin sizə lazım olduğunu və necə həll edəcəyinizi bilirsiniz.",
          en: "Instead of a flat wall of look-alike rows, alerts are grouped by what actually happened — off route, GPS spoofing, long break, and so on. Each group carries a plain-language name, its severity, how many there are, and a one-line “what to do,” so at a glance you know what needs you and how to handle it.",
          ru: "Вместо плоской стены похожих строк оповещения сгруппированы по тому, что на самом деле произошло — вне маршрута, подмена GPS, долгий перерыв и так далее. У каждой группы простое название, важность, количество и подсказка «что делать» в одну строку — с одного взгляда понятно, что требует внимания и как с этим быть.",
        },
        do: async (p, l, h) => { await h.moveTo(AL_GROUP_BTN); await h.hover(AL_GROUP_BTN); },
      },
      // 4 — Collapse / expand a group (real clicks).
      {
        voice: {
          az: "İstənilən qrup bir kliklə yığılır. Bütöv bir kateqoriyanı üzərində işləmədiyiniz zaman tək sətrə yığın, işə başlayanda isə yenidən açın. Səs-küy yox olur — ekranda yalnız sizə vacib olan qalır.",
          en: "Any group folds away with a click. Collapse a whole category into a single line when you're not working it, and open it back the moment you are. The noise disappears, and only what you care about stays on screen.",
          ru: "Любая группа сворачивается одним кликом. Сверните целую категорию в одну строку, когда вы ею не заняты, и разверните обратно, когда занялись. Шум исчезает — на экране остаётся только то, что вам важно.",
        },
        do: async (p, l, h) => { await h.click(AL_GROUP_BTN); await h.sleep(1200); await h.click(AL_GROUP_BTN); await h.sleep(800); },
      },
      // 5 — Filter by severity (real clicks).
      {
        voice: {
          az: "Yenə də ciddiliyə görə süzürsünüz. «Kritik»ə klik edin — və yalnız qırmızı, təcili xəbərdarlıqlar qalır, məsələn GPS saxtakarlığı. Hər səhər ilk baxdığınız yer budur. «Hamısı»na bir klik hər şeyi geri qaytarır.",
          en: "You still filter by severity. Click “Critical,” and only the red, act-now alerts remain — like a GPS spoofing. That's your first stop every morning. One click on “All” brings everything back.",
          ru: "Фильтр по важности на месте. Клик по «Критические» — и остаются только красные, срочные оповещения, например подмена GPS. Это первое, куда вы смотрите каждое утро. Клик по «Все» возвращает всё.",
        },
        do: async (p, l, h) => { await h.click(AL_CRITICAL); await h.sleep(900); await h.click(AL_ALL); await h.sleep(600); },
      },
      // 6 — Resolve an alert (real click, restored after for reproducibility).
      {
        voice: {
          az: "Birini həll edəndə «Həll et»ə klik edin — aktiv siyahınızdan çıxır və adınızla həll edilmişlər tarixçəsinə keçir. Bax burada birini bağlayırıq və siyahı qısalır. Aktiv görünüşünüz həmişə yalnız hələ də sizə lazım olanı göstərir.",
          en: "When you've handled one, click “Resolve” — it clears from your active list and moves into the resolved history with your name on it. Right here we close one, and the list gets shorter. Your active view always shows only what still needs you.",
          ru: "Когда с одним разобрались, нажмите «Решить» — оно уходит из активного списка в историю решённых с вашим именем. Вот здесь закрываем одно, и список становится короче. Активный вид всегда показывает только то, что ещё требует вас.",
        },
        do: async (p, l, h) => { await h.click(AL_RESOLVE); await h.sleep(1200); await restoreAlerts(p); },
      },
      // 7 — Show All + closing on the redesign.
      {
        voice: {
          az: "Tam mənzərə lazımdır? «Hamısını göstər» hər şeyi, o cümlədən həll edilmişləri geri gətirir və «Həll edilmiş» sayı dolur — hər anomaliyanın görüldüyünün və bağlandığının audit izi. Bu, yenilənmiş «Xəbərdarlıqlar»dır: qruplaşdırılmış, sadə dildə və hərəkətə hazır. Sahə özü-özünü nəzarətdə saxlayır, siz isə istisnalarla idarə edirsiniz.",
          en: "Need the full picture? “Show All” brings back everything, including the resolved ones, and the “Resolved” count fills in — your audit trail that every anomaly was seen and closed. That's the redesigned Alerts: grouped, plain-language, and action-ready. The field polices itself, and you manage by exception.",
          ru: "Нужна полная картина? «Показать все» возвращает всё, включая решённые, и счётчик «Решено» заполняется — ваш аудит-след, что каждую аномалию увидели и закрыли. Вот обновлённые «Оповещения»: сгруппированы, на понятном языке, готовы к действию. Поле контролирует себя само, а вы управляете по исключениям.",
        },
        do: async (p, l, h) => { await h.click(AL_SHOWALL); await h.sleep(900); await h.moveTo(AL_RESOLVED_STAT); await h.hover(AL_RESOLVED_STAT); },
      },
    ],
  },

  "mtm-agents": {
    route: "/mtm/agents",
    title: { az: "Agentlər", en: "Agents", ru: "Агенты" },
    scenes: [
      // 1 — What the agents section is.
      {
        voice: {
          az: "«Agentlər» bölməsi sahə komandanızın idarə mərkəzidir. Hər sahə agenti buradadır — və bu sadəcə siyahı deyil: kimin onlayn olduğunu, necə işlədiyini görürsünüz və hamısını bir ekrandan əlavə edir, açır və idarə edirsiniz.",
          en: "The “Agents” section is the command center for your field team. Every field agent lives here — and it's not just a list: you see who's online, how they're doing, and you add, open, and manage them all from one screen.",
          ru: "Раздел «Агенты» — командный центр вашей полевой команды. Здесь каждый полевой агент — и это не просто список: вы видите, кто в сети, как каждый работает, и всех добавляете, открываете и ведёте с одного экрана.",
        },
        do: async (p, l, h) => { await h.moveTo(AG_TITLE); await h.sleep(300); await h.hover(AG_TITLE); },
      },
      // 2 — Team stat cards.
      {
        voice: {
          az: "Yuxarıdakı kartlar komandanı bir baxışda verir: ümumi agentlər, neçəsi aktiv, neçəsi hazırda onlayn və neçəsi menecerdir. Bir baxış sahə qüvvənizin tərkibini və hazırlığını göstərir.",
          en: "The cards up top give you the team at a glance: total agents, how many are active, how many are online right now, and how many are managers. One look shows the shape and readiness of your field force.",
          ru: "Карточки сверху дают команду одним взглядом: всего агентов, сколько активны, сколько сейчас в сети и сколько менеджеров. Один взгляд показывает состав и готовность полевой команды.",
        },
        do: async (p, l, h) => { await h.moveTo(AG_STATS); await h.hover(AG_STATS); },
      },
      // 3 — Online filter (real clicks).
      {
        voice: {
          az: "İndi kimin işlədiyini bilmək lazımdır? «Onlayn»a bir klik son bir neçə dəqiqədə aktiv olan agentləri süzür — canlı komandanız, bu an əlçatan. «Hamısı» ilə hamını geri qaytarırsınız.",
          en: "Need to know who's working right now? One click on “Online” filters to the agents active in the last few minutes — your live team, reachable this instant. Click “All” to bring everyone back.",
          ru: "Нужно знать, кто работает прямо сейчас? Клик по «В сети» отфильтрует агентов, активных за последние минуты — вашу живую команду, доступную сию секунду. Клик по «Все» вернёт всех.",
        },
        do: async (p, l, h) => { await h.click(AG_ONLINE); await h.sleep(1000); await h.click(AG_ALLF); await h.sleep(600); },
      },
      // 4 — Create an agent (open the form, real click).
      {
        voice: {
          az: "Agent əlavə etmək bir kliklik işdir. «Agent əlavə et»ə basın — və forma açılır: ad, e-poçt, telefon, rol və hansı menecerə hesabat verdiyi. Doldurun, yadda saxlayın — və yeni agent komandanızda, mobil tətbiq üçün hazırdır.",
          en: "Adding an agent takes one click. Hit “Add agent,” and a form opens — name, email, phone, role, and which manager they report to. Fill it in, save, and the new agent is on your team and ready for the mobile app.",
          ru: "Добавить агента — один клик. Нажмите «Добавить агента» — откроется форма: имя, почта, телефон, роль и какому менеджеру подчиняется. Заполните, сохраните — и новый агент в команде, готов к мобильному приложению.",
        },
        do: async (p, l, h) => { await h.click(AG_ADD); await h.sleep(1500); },
      },
      // 5 — Open an existing agent (edit form, pre-filled).
      {
        voice: {
          az: "Və istənilən agenti eyni asanlıqla açırsınız. Kartdakı qələmə klik edin — və onun tam profili artıq doldurulmuş halda çıxır: rolu dəyişir, meneceri yenidən təyin edir, əlaqələri yeniləyir və saxlayırsınız. Hər agent bir klik uzaqdadır.",
          en: "And you open any agent just as easily. Click the pencil on a card, and their full profile comes up, already filled in — you adjust the role, reassign the manager, update contacts, and save. Every agent is one click away.",
          ru: "И любого агента открываете так же легко. Кликните карандаш на карточке — и его профиль уже заполнен: меняете роль, переназначаете менеджера, обновляете контакты и сохраняете. Каждый агент — в одном клике.",
        },
        do: async (p, l, h) => { await h.click(MODAL_CANCEL); await p.keyboard.press("Escape").catch(() => {}); await h.sleep(800); await h.click(AG_EDIT); await h.sleep(1500); },
      },
      // 6 — Card = mini-dashboard + quick actions (scroll to reveal the grid).
      {
        voice: {
          az: "Hər kart mini-idarə panelidir: agentin son dəfə nə vaxt göründüyü, həftəsi — ziyarətlər və səmərəlilik — tətbiqin quraşdırılıb-quraşdırılmadığı, həmçinin rol və status. Və birbaşa buradan hərəkət edirsiniz — zəng, WhatsApp mesajı, xəritədə görmək, ya da ziyarətlərini açmaq.",
          en: "Each card is a mini-dashboard: when the agent was last seen, their week — visits and effectiveness — whether the app is installed, plus role and status. And you act right here — call, message on WhatsApp, see them on the map, or open their visits.",
          ru: "Каждая карточка — мини-панель: когда агент был в сети, его неделя — визиты и эффективность — установлено ли приложение, плюс роль и статус. И действуете прямо здесь — позвонить, написать в WhatsApp, увидеть на карте или открыть его визиты.",
        },
        do: async (p, l, h) => { await h.click(MODAL_CANCEL); await p.keyboard.press("Escape").catch(() => {}); await h.sleep(800); await h.moveTo(AG_ACTIONS); await h.hover(AG_ACTIONS); await p.evaluate(() => window.scrollBy({ top: 380 })).catch(() => {}); await h.sleep(800); },
      },
      // 7 — Grouped by manager + closing.
      {
        voice: {
          az: "Və bütün siyahı menecerə görə qruplaşdırılıb — komandanın strukturu qarşınızdadır: kim kimə hesabat verir, hər qrup nə qədər böyükdür. Bu, «Agentlər» bölməsidir: telefon kitabçası yox, idarə mərkəzi — bütün sahə komandanızı bir ekrandan əlavə edin, açın, əlaqə saxlayın və idarə edin.",
          en: "And the whole roster is grouped by manager, so the team structure is right in front of you — who reports to whom, how big each group is. That's the “Agents” section: not a rolodex, but a command center — add, open, reach, and manage your whole field team from one screen.",
          ru: "И весь состав сгруппирован по менеджеру — структура команды прямо перед вами: кто кому подчиняется, насколько велика каждая группа. Вот раздел «Агенты»: не визитница, а командный центр — добавляйте, открывайте, связывайтесь и ведите всю полевую команду с одного экрана.",
        },
        do: async (p, l, h) => { await h.moveTo(AG_GROUP); await h.hover(AG_GROUP); },
      },
    ],
  },
};
