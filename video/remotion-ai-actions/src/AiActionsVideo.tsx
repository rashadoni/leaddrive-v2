import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Locale = "az" | "en" | "ru";
type TabId = "today" | "ask" | "modules" | "queue" | "history";
type TargetId = "kpis" | "rail" | "detail" | "queueButton" | TabId;

type Scene = {
  id: string;
  target: TargetId;
  tab: TabId;
  title: string;
  action: "hover" | "click";
  weight: number;
};

type UI = {
  crm: string;
  searchMenu: string;
  search: string;
  apps: string;
  title: string;
  subtitle: string;
  refresh: string;
  updated: string;
  tabs: Record<TabId, string>;
  nav: string[];
  kpis: Array<{ label: string; value: string; tone?: "red" | "green" }>;
  railTitle: string;
  riskTitle: string;
  riskSummary: string;
  critical: string;
  openRight: string;
  riskDetail: string;
  nextStep: string;
  createTask: string;
  lowRisk: string;
  queue: string;
  askTitle: string;
  money: string;
  salesRisks: string;
  slaTickets: string;
  moneyCaption: string;
  salesRisksCaption: string;
  slaTicketsCaption: string;
  askAnswer: string;
  modulesTitle: string;
  active: string;
  locked: string;
  silent: string;
  queueTitle: string;
  evidencePreview: string;
  approve: string;
  reject: string;
  historyTitle: string;
  supportEscalation: string;
  paymentReminder: string;
  executed: string;
  reviewed: string;
  queued: string;
  guide: string;
};

const ORANGE = "#f45108";
const INK = "#1f2937";
const MUTED = "#657386";
const LINE = "#dfe5ee";
const BG = "#f5f7fb";
const SURFACE = "#ffffff";
const WARM = "#fff8f3";

const ui: Record<Locale, UI> = {
  az: {
    crm: "CRM",
    searchMenu: "Menyuda axtar...",
    search: "Axtar...",
    apps: "Bütün tətbiqlər",
    title: "AI məsləhətçi",
    subtitle: "Gündəlik qərarlar və təhlükəsiz növbəti addımlar üçün CRM əsaslı siqnallar.",
    refresh: "Yenilə",
    updated: "Yeniləndi 20:49",
    tabs: { today: "Bu gün", ask: "Soruş", modules: "Modullar", queue: "Növbə", history: "Tarixçə" },
    nav: ["Dashboard", "AI məsləhətçi", "Şirkətlər", "Kontaktlar", "Lövhələr", "Məhsullar", "Bildirişlər", "Layihələr"],
    kpis: [
      { label: "Açıq risklər", value: "80" },
      { label: "Kritik", value: "55", tone: "red" },
      { label: "Risk altında məbləğ", value: "897,297 AZN", tone: "green" },
      { label: "Təsdiq gözləyən", value: "57" },
      { label: "Aktiv modullar", value: "10" },
      { label: "İcra xətaları", value: "0" },
    ],
    railTitle: "Diqqət tələb edir",
    riskTitle: "Firewall \"LEAD\" mərhələsində dayanıb",
    riskSummary: "88 gündür mərhələ dəyişməyib.",
    critical: "Kritik",
    openRight: "Sağda açıq",
    riskDetail: "Risk detalı",
    nextStep: "Növbəti addım",
    createTask: "Tapşırıq yarat",
    lowRisk: "Aşağı risk",
    queue: "Növbəyə əlavə et",
    askTitle: "Nəyə baxaq?",
    money: "Pul riski",
    salesRisks: "Satış riskləri",
    slaTickets: "SLA / tiketlər",
    moneyCaption: "14 siqnal · 897,297 AZN",
    salesRisksCaption: "55 kritik · 80 açıq",
    slaTicketsCaption: "11 dəstək siqnalı",
    askAnswer: "Advisor 14 satış riski tapdı və əsas siqnalı yoxlama üçün açdı.",
    modulesTitle: "Advisor modul əhatəsi",
    active: "Aktiv",
    locked: "İcazə yoxdur",
    silent: "Siqnal yoxdur",
    queueTitle: "Təsdiq növbəsi",
    evidencePreview: "Sübut və ön baxış",
    approve: "Təsdiqlə",
    reject: "Rədd et",
    historyTitle: "Qərar tarixçəsi",
    supportEscalation: "Dəstək SLA eskalasiyası",
    paymentReminder: "Ödəniş xatırlatma tapşırığı",
    executed: "icra olundu",
    reviewed: "baxıldı",
    queued: "növbədə",
    guide: "GID",
  },
  en: {
    crm: "CRM",
    searchMenu: "Search menu...",
    search: "Search...",
    apps: "All apps",
    title: "AI Advisor",
    subtitle: "CRM-backed operating signals for daily decisions and safe next steps.",
    refresh: "Refresh",
    updated: "Updated 20:49",
    tabs: { today: "Today", ask: "Ask", modules: "Modules", queue: "Queue", history: "History" },
    nav: ["Dashboard", "AI Advisor", "Companies", "Contacts", "Boards", "Products", "Notifications", "Projects"],
    kpis: [
      { label: "Open risks", value: "80" },
      { label: "Critical", value: "55", tone: "red" },
      { label: "Money at risk", value: "897,297 AZN", tone: "green" },
      { label: "Pending actions", value: "57" },
      { label: "Active modules", value: "10" },
      { label: "Failed executions", value: "0" },
    ],
    railTitle: "Needs attention",
    riskTitle: "Firewall is stalled in \"LEAD\"",
    riskSummary: "No stage movement for 88 days.",
    critical: "Critical",
    openRight: "Open on right",
    riskDetail: "Risk detail",
    nextStep: "Next step",
    createTask: "Create task",
    lowRisk: "Low risk",
    queue: "Queue action",
    askTitle: "What should we review?",
    money: "Money at risk",
    salesRisks: "Sales risks",
    slaTickets: "SLA / tickets",
    moneyCaption: "14 signals · 897,297 AZN",
    salesRisksCaption: "55 critical · 80 open",
    slaTicketsCaption: "11 support signals",
    askAnswer: "Advisor found 14 sales risks and pinned the primary signal for review.",
    modulesTitle: "Advisor coverage by module",
    active: "Active",
    locked: "No access",
    silent: "No signals",
    queueTitle: "Approval queue",
    evidencePreview: "Evidence and preview",
    approve: "Approve",
    reject: "Reject",
    historyTitle: "Decision history",
    supportEscalation: "Support SLA escalation",
    paymentReminder: "Payment reminder task",
    executed: "executed",
    reviewed: "reviewed",
    queued: "queued",
    guide: "GUIDE",
  },
  ru: {
    crm: "CRM",
    searchMenu: "Поиск по меню...",
    search: "Поиск...",
    apps: "Все приложения",
    title: "AI-советник",
    subtitle: "Операционные CRM-сигналы для ежедневных решений и безопасных следующих шагов.",
    refresh: "Обновить",
    updated: "Обновлено 20:49",
    tabs: { today: "Сегодня", ask: "Спросить", modules: "Модули", queue: "Очередь", history: "История" },
    nav: ["Dashboard", "AI-советник", "Компании", "Контакты", "Доски", "Продукты", "Уведомления", "Проекты"],
    kpis: [
      { label: "Открытые риски", value: "80" },
      { label: "Критичные", value: "55", tone: "red" },
      { label: "Деньги под риском", value: "897,297 AZN", tone: "green" },
      { label: "Действия на согласовании", value: "57" },
      { label: "Активные модули", value: "10" },
      { label: "Ошибки исполнения", value: "0" },
    ],
    railTitle: "Требует внимания",
    riskTitle: "Firewall завис на этапе \"LEAD\"",
    riskSummary: "88 дн. нет движения по этапу.",
    critical: "Критичный",
    openRight: "Открыто справа",
    riskDetail: "Детали риска",
    nextStep: "Следующий шаг",
    createTask: "Создать задачу",
    lowRisk: "Низкий риск",
    queue: "Добавить в очередь",
    askTitle: "Что посмотрим?",
    money: "Деньги под риском",
    salesRisks: "Риски продаж",
    slaTickets: "SLA / тикеты",
    moneyCaption: "14 сигналов · 897,297 AZN",
    salesRisksCaption: "55 критичных · 80 открытых",
    slaTicketsCaption: "11 сигналов поддержки",
    askAnswer: "Advisor нашел 14 рисков продаж и закрепил главный сигнал для разбора.",
    modulesTitle: "Покрытие Advisor по модулям",
    active: "Активен",
    locked: "Нет прав",
    silent: "Нет сигналов",
    queueTitle: "Очередь согласования",
    evidencePreview: "Доказательства и предпросмотр",
    approve: "Одобрить",
    reject: "Отклонить",
    historyTitle: "История решений",
    supportEscalation: "Эскалация SLA поддержки",
    paymentReminder: "Задача по платежу",
    executed: "исполнено",
    reviewed: "проверено",
    queued: "в очереди",
    guide: "ГИД",
  },
};

const sceneTitles: Record<Locale, string[]> = {
  az: [
    "Yuxarı xülasədən başlayın",
    "Solda riski seçin",
    "Sübutları yoxlayın",
    "Əməliyyatı növbəyə əlavə edin",
    "Soruş tabına keçin",
    "Modul əhatəsini yoxlayın",
    "Növbədə təsdiqləyin",
    "Tarixçə ilə bitirin",
    "Nəticə auditdə qalır",
  ],
  en: [
    "Start with the top summary",
    "Select a risk on the left",
    "Review the evidence",
    "Queue the action",
    "Move to Ask",
    "Check module coverage",
    "Approve in the queue",
    "Finish with history",
    "The result stays auditable",
  ],
  ru: [
    "Начинаем с верхней сводки",
    "Выбираем риск слева",
    "Проверяем доказательства",
    "Добавляем действие в очередь",
    "Переходим в Спросить",
    "Проверяем покрытие модулей",
    "Одобряем в очереди",
    "Завершаем историей",
    "Результат остается в аудите",
  ],
};

const baseScenes: Array<Omit<Scene, "title">> = [
  { id: "summary", target: "kpis", tab: "today", action: "hover", weight: 1.2 },
  { id: "pick-risk", target: "rail", tab: "today", action: "click", weight: 1.1 },
  { id: "evidence", target: "detail", tab: "today", action: "hover", weight: 1.15 },
  { id: "queue-action", target: "queueButton", tab: "today", action: "click", weight: 1.0 },
  { id: "ask", target: "ask", tab: "ask", action: "click", weight: 1.0 },
  { id: "modules", target: "modules", tab: "modules", action: "click", weight: 1.0 },
  { id: "queue", target: "queue", tab: "queue", action: "click", weight: 1.0 },
  { id: "history", target: "history", tab: "history", action: "click", weight: 1.0 },
  { id: "outcome", target: "history", tab: "history", action: "hover", weight: 0.75 },
];

const targetPoints: Record<TargetId, { x: number; y: number }> = {
  kpis: { x: 890, y: 318 },
  rail: { x: 548, y: 780 },
  detail: { x: 1378, y: 690 },
  queueButton: { x: 1628, y: 856 },
  today: { x: 430, y: 420 },
  ask: { x: 582, y: 420 },
  modules: { x: 740, y: 420 },
  queue: { x: 910, y: 420 },
  history: { x: 1084, y: 420 },
};

const focus: Record<TargetId, { x: number; y: number; scale: number }> = {
  kpis: { x: 0, y: 0, scale: 1 },
  rail: { x: 0, y: 0, scale: 1 },
  detail: { x: 0, y: 0, scale: 1 },
  queueButton: { x: 0, y: 0, scale: 1 },
  today: { x: 0, y: 0, scale: 1 },
  ask: { x: 0, y: 0, scale: 1 },
  modules: { x: 0, y: 0, scale: 1 },
  queue: { x: 0, y: 0, scale: 1 },
  history: { x: 0, y: 0, scale: 1 },
};

const tabOrder: TabId[] = ["today", "ask", "modules", "queue", "history"];

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const styles = {
  font: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Arial, sans-serif",
  },
  card: {
    background: SURFACE,
    border: `1px solid ${LINE}`,
    borderRadius: 18,
    boxShadow: "0 18px 44px rgba(15, 23, 42, 0.07)",
  },
} as const;

export const AiActionsVideo = ({ locale }: { locale: Locale }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const data = ui[locale];
  const scenes = baseScenes.map((scene, index) => ({ ...scene, title: sceneTitles[locale][index] }));
  const timeline = buildTimeline(scenes, durationInFrames);
  const current = findScene(timeline, frame);
  const localFrame = frame - current.start;
  const localProgress = clamp(localFrame / Math.max(1, current.end - current.start), 0, 1);
  const previous = timeline[Math.max(0, current.index - 1)]?.scene ?? current.scene;
  const cursor = cursorPosition(previous.target, current.scene.target, localProgress);
  const camera = cameraMotion(previous.target, current.scene.target, localProgress);
  const click = current.scene.action === "click" ? clickProgress(localProgress) : 0;

  return (
    <AbsoluteFill style={{ ...styles.font, background: BG, color: INK, overflow: "hidden" }}>
      <Audio src={staticFile(`audio/ai-actions.${locale}.mp3`)} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: "50% 50%",
        }}
      >
        <AppChrome data={data} active={current.scene.tab} />
        <MainContent data={data} active={current.scene.tab} />
        <Highlight target={current.scene.target} click={click} />
      </div>
      <StepBadge data={data} title={current.scene.title} progress={localProgress} />
      <Cursor x={cursor.x} y={cursor.y} click={click} />
      <ProgressBar progress={frame / Math.max(1, durationInFrames - 1)} />
    </AbsoluteFill>
  );
};

function buildTimeline(scenes: Scene[], duration: number) {
  const totalWeight = scenes.reduce((sum, scene) => sum + scene.weight, 0);
  let start = 0;
  return scenes.map((scene, index) => {
    const frames = index === scenes.length - 1 ? duration - start : Math.round((duration * scene.weight) / totalWeight);
    const end = Math.min(duration, start + frames);
    const item = { scene, start, end, index };
    start = end;
    return item;
  });
}

function findScene(timeline: ReturnType<typeof buildTimeline>, frame: number) {
  return timeline.find((item) => frame >= item.start && frame < item.end) ?? timeline[timeline.length - 1];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cursorPosition(from: TargetId, to: TargetId, progress: number) {
  const start = targetPoints[from];
  const end = targetPoints[to];
  const t = interpolate(progress, [0, 0.48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function cameraMotion(from: TargetId, to: TargetId, progress: number) {
  const start = focus[from];
  const end = focus[to];
  const t = interpolate(progress, [0, 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    scale: start.scale + (end.scale - start.scale) * t,
  };
}

function clickProgress(progress: number) {
  if (progress < 0.45 || progress > 0.72) return 0;
  return interpolate(progress, [0.45, 0.72], [0.001, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

function AppChrome({ data, active }: { data: UI; active: TabId }) {
  return (
    <>
      <aside
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 308,
          height: 1080,
          background: "#101621",
          color: "#e5e7eb",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "34px 38px" }}>
          <div style={{ fontSize: 31, fontWeight: 800 }}>LD</div>
          <div style={{ fontSize: 27, fontWeight: 800 }}>LeadDrive</div>
          <div style={{ fontSize: 21, color: "#909bb0" }}>{data.crm}</div>
        </div>
        <div
          style={{
            margin: "30px 26px 42px",
            height: 48,
            borderRadius: 24,
            background: "#17202e",
            border: "1px solid #293447",
            color: "#aeb8c8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          {data.searchMenu}
        </div>
        <div style={{ padding: "0 26px", color: "#8792a5", fontSize: 16, fontWeight: 800 }}>CRM</div>
        <div style={{ marginTop: 20 }}>
          {data.nav.map((item, index) => {
            const selected = index === 1;
            return (
              <div
                key={item}
                style={{
                  position: "relative",
                  height: 54,
                  margin: "0 14px 2px",
                  paddingLeft: 52,
                  display: "flex",
                  alignItems: "center",
                  borderRadius: 11,
                  background: selected ? "#3a3f51" : "transparent",
                  color: selected ? "#f8fafc" : "#9ba5b7",
                  fontSize: 21,
                  fontWeight: selected ? 700 : 500,
                }}
              >
                {selected && (
                  <div style={{ position: "absolute", left: 0, top: 9, width: 6, height: 36, background: ORANGE }} />
                )}
                {item}
              </div>
            );
          })}
        </div>
        {["ПРОДАЖИ", "МАРКЕТИНГ", "OMNI-CHANNEL"].map((label, index) => (
          <div
            key={label}
            style={{
              position: "absolute",
              left: 26,
              right: 20,
              top: 760 + index * 88,
              borderTop: "1px solid #273244",
              paddingTop: 20,
              color: "#8d98aa",
              fontSize: 16,
              fontWeight: 800,
            }}
          >
            {label}
          </div>
        ))}
      </aside>
      <header
        style={{
          position: "absolute",
          left: 308,
          right: 0,
          top: 0,
          height: 96,
          background: SURFACE,
          borderBottom: `1px solid ${LINE}`,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div style={{ marginLeft: 48, fontSize: 23, fontWeight: 800 }}>LeadDrive Inc.</div>
        <div
          style={{
            marginLeft: 40,
            width: 190,
            height: 48,
            borderRadius: 24,
            background: "#f8fafc",
            border: `1px solid ${LINE}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: MUTED,
            fontSize: 18,
          }}
        >
          {data.search}
        </div>
        <div
          style={{
            marginLeft: 28,
            height: 54,
            padding: "0 24px",
            borderRadius: 28,
            background: ORANGE,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 800,
          }}
        >
          {data.apps}
        </div>
        <div style={{ marginLeft: "auto", color: "#ef4444", fontSize: 18, fontWeight: 900 }}>9+</div>
        <div
          style={{
            marginLeft: 88,
            width: 52,
            height: 52,
            borderRadius: 26,
            background: ORANGE,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 800,
          }}
        >
          L
        </div>
        <div style={{ margin: "0 36px 0 14px", fontSize: 22, fontWeight: 600 }}>Lead Drive</div>
      </header>
      <TitleBlock data={data} />
      <Tabs data={data} active={active} />
    </>
  );
}

function TitleBlock({ data }: { data: UI }) {
  return (
    <>
      <div style={{ position: "absolute", left: 356, top: 140, fontSize: 54, lineHeight: 1, fontWeight: 850 }}>{data.title}</div>
      <div style={{ position: "absolute", left: 356, top: 210, width: 920, color: MUTED, fontSize: 25, lineHeight: 1.32 }}>
        {data.subtitle}
      </div>
      <div
        style={{
          position: "absolute",
          top: 116,
          right: 214,
          width: 166,
          height: 54,
          borderRadius: 28,
          border: `1px solid ${LINE}`,
          background: SURFACE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          fontWeight: 800,
        }}
      >
        {data.refresh}
      </div>
      <div style={{ position: "absolute", top: 184, right: 222, color: MUTED, fontSize: 20 }}>{data.updated}</div>
      <div style={{ position: "absolute", left: 356, top: 266, display: "flex", gap: 18 }}>
        {data.kpis.map((kpi) => (
          <MetricCard key={kpi.label} {...kpi} />
        ))}
      </div>
    </>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" }) {
  return (
    <div
      style={{
        width: 224,
        height: 104,
        borderRadius: 18,
        border: `1px solid ${LINE}`,
        background: SURFACE,
        padding: "18px 22px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: MUTED, fontSize: 19, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 12,
          color: tone === "red" ? "#dc2626" : tone === "green" ? "#16a34a" : INK,
          fontSize: 28,
          lineHeight: 1,
          fontWeight: 850,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Tabs({ data, active }: { data: UI; active: TabId }) {
  return (
    <div style={{ position: "absolute", left: 356, top: 394, display: "flex", gap: 14 }}>
      {tabOrder.map((tab) => {
        const selected = tab === active;
        return (
          <div
            key={tab}
            style={{
              minWidth: tab === "modules" ? 146 : 122,
              height: 54,
              padding: "0 24px",
              borderRadius: 28,
              border: selected ? `1px solid ${ORANGE}` : `1px solid ${LINE}`,
              background: selected ? ORANGE : SURFACE,
              color: selected ? "white" : MUTED,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 25,
              fontWeight: 850,
              boxSizing: "border-box",
            }}
          >
            {data.tabs[tab]}
          </div>
        );
      })}
    </div>
  );
}

function MainContent({ data, active }: { data: UI; active: TabId }) {
  if (active === "ask") return <AskContent data={data} />;
  if (active === "modules") return <ModulesContent data={data} />;
  if (active === "queue") return <QueueContent data={data} />;
  if (active === "history") return <HistoryContent data={data} />;
  return <TodayContent data={data} />;
}

function TodayContent({ data }: { data: UI }) {
  return (
    <>
      <section style={{ ...styles.card, position: "absolute", left: 356, top: 488, width: 564, height: 502, padding: 40, boxSizing: "border-box" }}>
        <div style={{ fontSize: 34, fontWeight: 850 }}>{data.railTitle}</div>
        <div
          style={{
            marginTop: 24,
            height: 50,
            borderRadius: 25,
            border: `1px solid ${LINE}`,
            background: "#f8fafc",
            color: MUTED,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          {data.searchMenu.replace("Menyuda", "Risk").replace("Поиск по меню", "Поиск по рискам").replace("Search menu", "Search risks")}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
          {["Sales 14", "Finance 27", "Tasks 14", "Ticketing 11"].map((filter, index) => (
            <div
              key={filter}
              style={{
                height: 40,
                padding: "0 18px",
                borderRadius: 20,
                background: index === 0 ? ORANGE : "#f8fafc",
                border: `1px solid ${index === 0 ? ORANGE : LINE}`,
                color: index === 0 ? "white" : MUTED,
                display: "flex",
                alignItems: "center",
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              {filter}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 30,
            borderRadius: 18,
            border: "2px solid #fdba74",
            background: WARM,
            padding: 26,
            minHeight: 160,
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Pill text={data.critical} tone="red" />
            <Pill text={data.openRight} tone="orange" />
          </div>
          <div style={{ marginTop: 30, fontSize: 25, fontWeight: 850 }}>{data.riskTitle}</div>
          <div style={{ marginTop: 20, color: MUTED, fontSize: 20 }}>{data.riskSummary}</div>
        </div>
      </section>
      <section style={{ ...styles.card, position: "absolute", left: 956, top: 488, width: 852, height: 502, padding: 40, boxSizing: "border-box" }}>
        <div style={{ fontSize: 38, fontWeight: 850 }}>{data.riskDetail}</div>
        <div style={{ marginTop: 26 }}>
          <Pill text={data.critical} tone="red" />
        </div>
        <div style={{ marginTop: 44, fontSize: 39, lineHeight: 1.08, fontWeight: 850 }}>{data.riskTitle}</div>
        <div style={{ marginTop: 22, color: MUTED, fontSize: 27 }}>{data.riskSummary}</div>
        <div
          style={{
            marginTop: 22,
            borderRadius: 18,
            border: "2px solid #fdba74",
            background: WARM,
            padding: "24px 28px",
            display: "grid",
            gridTemplateColumns: "198px 1fr 274px",
            alignItems: "center",
            columnGap: 24,
          }}
        >
          <Pill text={data.nextStep} tone="white" />
          <div>
            <div style={{ color: MUTED, fontSize: 23 }}>{data.lowRisk}</div>
            <div style={{ marginTop: 20, fontSize: 24, fontWeight: 850 }}>{data.createTask}</div>
            <div style={{ marginTop: 8, color: MUTED, fontSize: 20, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {data.riskSummary}
            </div>
          </div>
          <div
            style={{
              height: 60,
              borderRadius: 30,
              background: ORANGE,
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 21,
              fontWeight: 850,
            }}
          >
            {data.queue}
          </div>
        </div>
      </section>
    </>
  );
}

function AskContent({ data }: { data: UI }) {
  return (
    <section style={{ ...styles.card, position: "absolute", left: 356, top: 488, width: 1452, height: 502, padding: 50, boxSizing: "border-box" }}>
      <div style={{ fontSize: 42, fontWeight: 850 }}>{data.askTitle}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 30, marginTop: 48 }}>
        {[
          [data.money, data.moneyCaption, true],
          [data.salesRisks, data.salesRisksCaption, false],
          [data.slaTickets, data.slaTicketsCaption, false],
        ].map(([title, caption, selected]) => (
          <div
            key={String(title)}
            style={{
              height: 142,
              borderRadius: 20,
              border: selected ? `2px solid ${ORANGE}` : `1px solid ${LINE}`,
              background: selected ? "#ffedd5" : "#f8fafc",
              padding: "36px 30px",
              boxSizing: "border-box",
            }}
          >
            <div style={{ color: selected ? "#c2410c" : INK, fontSize: 30, fontWeight: 850 }}>{title}</div>
            <div style={{ marginTop: 22, color: MUTED, fontSize: 22 }}>{caption}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 60,
          height: 94,
          borderRadius: 18,
          background: "#dbeafe",
          border: "1px solid #93c5fd",
          color: "#2563eb",
          display: "flex",
          alignItems: "center",
          paddingLeft: 34,
          fontSize: 25,
          fontWeight: 850,
        }}
      >
        {data.askAnswer}
      </div>
    </section>
  );
}

function ModulesContent({ data }: { data: UI }) {
  const modules = [
    ["CRM", data.active, true],
    ["Sales", data.active, true],
    ["Finance", data.active, true],
    ["Ticketing", data.active, true],
    ["Routes", data.locked, false],
    ["MTM", data.silent, false],
  ];
  return (
    <section style={{ ...styles.card, position: "absolute", left: 356, top: 488, width: 1452, height: 502, padding: 50, boxSizing: "border-box" }}>
      <div style={{ fontSize: 42, fontWeight: 850 }}>{data.modulesTitle}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 32, marginTop: 50 }}>
        {modules.map(([name, status, active]) => (
          <div
            key={String(name)}
            style={{
              height: 108,
              borderRadius: 18,
              border: `1px solid ${LINE}`,
              background: active ? "#dcfce7" : "#f8fafc",
              padding: "22px 28px",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 850 }}>{name}</div>
            <div style={{ marginTop: 12, color: active ? "#16a34a" : MUTED, fontSize: 22 }}>{status}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function QueueContent({ data }: { data: UI }) {
  return (
    <section style={{ ...styles.card, position: "absolute", left: 356, top: 488, width: 1452, height: 502, padding: 50, boxSizing: "border-box" }}>
      <div style={{ fontSize: 42, fontWeight: 850 }}>{data.queueTitle}</div>
      <div
        style={{
          marginTop: 48,
          borderRadius: 20,
          border: "2px solid #fbbf24",
          background: WARM,
          minHeight: 210,
          padding: 34,
          display: "grid",
          gridTemplateColumns: "1fr 270px 170px",
          columnGap: 34,
          alignItems: "center",
        }}
      >
        <div>
          <Pill text={data.nextStep} tone="white" />
          <div style={{ marginTop: 38, fontSize: 31, fontWeight: 850 }}>{data.createTask}</div>
          <div style={{ marginTop: 18, color: MUTED, fontSize: 25 }}>{data.riskSummary}</div>
        </div>
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: SURFACE, padding: 28 }}>
          <div style={{ color: MUTED, fontSize: 19 }}>deal</div>
          <div style={{ marginTop: 14, fontSize: 23, fontWeight: 850 }}>cmmxo2l7...</div>
        </div>
        <div style={{ display: "grid", gap: 18 }}>
          <ActionButton text={data.approve} tone="green" />
          <ActionButton text={data.reject} tone="red" />
        </div>
      </div>
      <div style={{ marginTop: 34, height: 60, borderRadius: 16, border: `1px solid ${LINE}`, background: "#f8fafc", color: MUTED, display: "flex", alignItems: "center", paddingLeft: 32, fontSize: 22, fontWeight: 800 }}>
        {data.evidencePreview}
      </div>
    </section>
  );
}

function HistoryContent({ data }: { data: UI }) {
  const rows = [
    [data.riskTitle, data.approve, data.executed, "#dcfce7", "#16a34a"],
    [data.supportEscalation, data.reject, data.reviewed, "#dbeafe", "#2563eb"],
    [data.paymentReminder, data.approve, data.queued, "#ede9fe", "#7c3aed"],
  ];
  return (
    <section style={{ ...styles.card, position: "absolute", left: 356, top: 488, width: 1452, height: 502, padding: 50, boxSizing: "border-box" }}>
      <div style={{ fontSize: 42, fontWeight: 850 }}>{data.historyTitle}</div>
      <div style={{ marginTop: 48, display: "grid", gap: 22 }}>
        {rows.map(([title, decision, status, bg, color]) => (
          <div
            key={String(title)}
            style={{
              height: 78,
              borderRadius: 16,
              border: `1px solid ${LINE}`,
              background: "#f8fafc",
              display: "grid",
              gridTemplateColumns: "1fr 200px 170px",
              alignItems: "center",
              padding: "0 36px",
              fontSize: 23,
            }}
          >
            <div style={{ fontWeight: 850 }}>{title}</div>
            <div style={{ color: MUTED }}>{decision}</div>
            <div style={{ height: 46, borderRadius: 23, background: String(bg), color: String(color), display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 850 }}>
              {status}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pill({ text, tone }: { text: string; tone: "red" | "orange" | "white" }) {
  const colors = {
    red: { bg: "#fee2e2", fg: "#dc2626", border: "#fca5a5" },
    orange: { bg: "#ffedd5", fg: "#c2410c", border: "#ffedd5" },
    white: { bg: "#ffffff", fg: "#c2410c", border: "#fdba74" },
  }[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 42,
        padding: "0 18px",
        borderRadius: 22,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.fg,
        fontSize: 20,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}

function ActionButton({ text, tone }: { text: string; tone: "green" | "red" }) {
  const bg = tone === "green" ? "#16a34a" : "#fee2e2";
  const color = tone === "green" ? "white" : "#dc2626";
  return (
    <div style={{ height: 56, borderRadius: 28, background: bg, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 850 }}>
      {text}
    </div>
  );
}

function Highlight({ target, click }: { target: TargetId; click: number }) {
  const boxes: Record<TargetId, { left: number; top: number; width: number; height: number; radius: number }> = {
    kpis: { left: 352, top: 266, width: 1456, height: 104, radius: 22 },
    rail: { left: 396, top: 724, width: 484, height: 180, radius: 20 },
    detail: { left: 956, top: 488, width: 852, height: 502, radius: 24 },
    queueButton: { left: 1486, top: 830, width: 276, height: 60, radius: 30 },
    today: { left: 356, top: 394, width: 136, height: 54, radius: 28 },
    ask: { left: 506, top: 394, width: 144, height: 54, radius: 28 },
    modules: { left: 666, top: 394, width: 150, height: 54, radius: 28 },
    queue: { left: 834, top: 394, width: 146, height: 54, radius: 28 },
    history: { left: 994, top: 394, width: 156, height: 54, radius: 28 },
  };
  const box = boxes[target];
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          borderRadius: box.radius,
          border: `4px solid ${ORANGE}`,
          boxShadow: "0 0 0 8px rgba(244, 81, 8, 0.06)",
          pointerEvents: "none",
        }}
      />
      {click > 0 && <ClickRipple target={target} progress={click} />}
    </>
  );
}

function ClickRipple({ target, progress }: { target: TargetId; progress: number }) {
  const point = targetPoints[target];
  const size = interpolate(progress, [0, 1], [22, 130], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const opacity = interpolate(progress, [0, 1], [0.35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: point.x - size / 2,
        top: point.y - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        border: `5px solid rgba(244, 81, 8, ${opacity})`,
      }}
    />
  );
}

function StepBadge({ data, title, progress }: { data: UI; title: string; progress: number }) {
  const opacity = interpolate(progress, [0, 0.08, 0.86, 1], [0, 1, 1, 0.72], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 1050,
        top: 128,
        width: 482,
        height: 62,
        borderRadius: 20,
        background: "rgba(17, 24, 39, 0.84)",
        color: "white",
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)",
        opacity,
        padding: "12px 22px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: "#cbd5e1", fontSize: 15, fontWeight: 850 }}>{data.guide}</div>
      <div style={{ marginTop: 2, fontSize: 21, fontWeight: 850, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
    </div>
  );
}

function Cursor({ x, y, click }: { x: number; y: number; click: number }) {
  const scale = click > 0 ? interpolate(click, [0, 0.3, 1], [1, 0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  return (
    <svg
      width="66"
      height="76"
      viewBox="0 0 66 76"
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `translate(-8px, -8px) scale(${scale})`,
        filter: "drop-shadow(0 8px 8px rgba(15, 23, 42, 0.26))",
      }}
    >
      <path d="M6 4 L50 58 L31 55 L22 73 L12 68 L21 51 L6 4 Z" fill="white" stroke="#111827" strokeWidth="2" />
    </svg>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div style={{ position: "absolute", left: 356, right: 112, bottom: 48, height: 4, borderRadius: 2, background: "rgba(15, 23, 42, 0.08)" }}>
      <div style={{ width: `${progress * 100}%`, height: 4, borderRadius: 2, background: ORANGE }} />
    </div>
  );
}
