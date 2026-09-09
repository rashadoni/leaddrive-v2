#!/usr/bin/env node
/**
 * scripts/demo-fill.mjs
 * =====================================================================
 * Deterministic, idempotent demo-data seeder for the guide-video stand. It is
 * the companion `scripts/produce-guides.mjs` calls (under RESEED) so the lists
 * and titles on screen are in the SAME language as the voiceover.
 *
 * It writes via Prisma (RLS-scoped to the demo org, mirroring scripts/seed-demo.mjs)
 * — there is no HTTP login step here, so it can't hit an auth rate-limit.
 *
 *   node scripts/demo-fill.mjs [apiUrl]     # apiUrl is accepted+ignored (Prisma path)
 *
 * ENV
 *   DEMO_LANG=az|ru|en   localize the story free-text (deal/task/ticket/campaign/
 *                        lead titles) so on-screen lists match the narration.
 *                        Default "az".
 *   DEMO_RESET=1         clear the localized story tables (deals, tasks, tickets,
 *                        campaigns, leads) for the demo org first, then reseed —
 *                        so switching DEMO_LANG replaces old-language rows. The
 *                        shared company/contact base is kept. Best-effort: a
 *                        blocked delete is logged, not fatal.
 *   DEMO_ORG_SLUG        which tenant to seed (default "demo", then "demo-company",
 *                        then the first org).
 *
 * Idempotent: existing rows (matched by a natural key) are left in place, so
 * re-running is safe. Localized rows are keyed by a stable index so the same
 * slot is reused across languages after a reset.
 * =====================================================================
 */
import { makeScriptPrisma } from "./_rls.mjs";

const LANG = (process.env.DEMO_LANG || "az").trim();
const RESET = ["1", "true", "yes"].includes(String(process.env.DEMO_RESET || "").toLowerCase());
const ORG_SLUG = process.env.DEMO_ORG_SLUG || "demo";

// ── Shared structural base (proper nouns / numbers — same across languages) ──
const COMPANIES = [
  { name: "Azercell Telekom MMC", industry: { az: "Telekommunikasiya", ru: "Телеком", en: "Telecom" }, website: "azercell.com", phone: "+994 50 200 0000", email: "info@azercell.com", employeeCount: 1500, annualRevenue: 450000, category: "client" },
  { name: "SOCAR Trading", industry: { az: "Neft və Qaz", ru: "Нефть и газ", en: "Oil & Gas" }, website: "socar.az", phone: "+994 12 521 0000", email: "info@socar.az", employeeCount: 5000, annualRevenue: 2500000, category: "client" },
  { name: "Pasha Holding", industry: { az: "Maliyyə", ru: "Финансы", en: "Finance" }, website: "pashaholding.az", phone: "+994 12 496 5000", email: "info@pashaholding.az", employeeCount: 3000, annualRevenue: 1200000, category: "client" },
  { name: "Kapital Bank", industry: { az: "Bankçılıq", ru: "Банкинг", en: "Banking" }, website: "kapitalbank.az", phone: "+994 12 310 0000", email: "info@kapitalbank.az", employeeCount: 2000, annualRevenue: 800000, category: "client" },
  { name: "ABB Sığorta", industry: { az: "Sığorta", ru: "Страхование", en: "Insurance" }, website: "abbsigorta.az", phone: "+994 12 404 4040", email: "info@abbsigorta.az", employeeCount: 400, annualRevenue: 350000, category: "prospect" },
  { name: "Bravo Supermarket", industry: { az: "Pərakəndə", ru: "Ритейл", en: "Retail" }, website: "bravo.az", phone: "+994 12 555 0000", email: "info@bravo.az", employeeCount: 1200, annualRevenue: 500000, category: "prospect" },
];

const CONTACTS = [
  { fullName: "Elvin Məmmədov", email: "elvin@azercell.com", phone: "+994 50 200 1234", position: { az: "IT Direktor", ru: "ИТ-директор", en: "IT Director" }, companyIdx: 0, engagementScore: 85 },
  { fullName: "Kamalə Həsənova", email: "kamala@socar.az", phone: "+994 55 300 5678", position: { az: "CTO", ru: "Технический директор", en: "CTO" }, companyIdx: 1, engagementScore: 92 },
  { fullName: "Tural Əliyev", email: "tural@pashaholding.az", phone: "+994 50 400 9012", position: { az: "Satış üzrə VP", ru: "VP по продажам", en: "VP of Sales" }, companyIdx: 2, engagementScore: 78 },
  { fullName: "Nigar Babayeva", email: "nigar@kapitalbank.az", phone: "+994 55 500 3456", position: { az: "COO", ru: "Операционный директор", en: "COO" }, companyIdx: 3, engagementScore: 88 },
  { fullName: "Rəşad Vəliyev", email: "rashad@abbsigorta.az", phone: "+994 50 600 7890", position: { az: "CEO", ru: "Генеральный директор", en: "CEO" }, companyIdx: 4, engagementScore: 65 },
  { fullName: "Fərid Hüseynov", email: "farid@bravo.az", phone: "+994 50 800 5678", position: { az: "IT Menecer", ru: "ИТ-менеджер", en: "IT Manager" }, companyIdx: 5, engagementScore: 55 },
];

// Deals — structural (company/contact/stage/value) shared, name localized.
const DEALS = [
  { name: { az: "Azercell CRM İnteqrasiyası", ru: "Azercell — интеграция CRM", en: "Azercell CRM Integration" }, companyIdx: 0, contactIdx: 0, stage: "NEGOTIATION", valueAmount: 145000, probability: 75 },
  { name: { az: "SOCAR ERP Modernizasiyası", ru: "SOCAR — модернизация ERP", en: "SOCAR ERP Modernization" }, companyIdx: 1, contactIdx: 1, stage: "PROPOSAL", valueAmount: 320000, probability: 50 },
  { name: { az: "Pasha Holding Data Analitika", ru: "Pasha Holding — аналитика данных", en: "Pasha Holding Data Analytics" }, companyIdx: 2, contactIdx: 2, stage: "WON", valueAmount: 185000, probability: 100 },
  { name: { az: "Kapital Bank Mobil Tətbiq", ru: "Kapital Bank — мобильное приложение", en: "Kapital Bank Mobile App" }, companyIdx: 3, contactIdx: 3, stage: "NEGOTIATION", valueAmount: 95000, probability: 70 },
  { name: { az: "ABB Sığorta Portalı", ru: "ABB Страхование — портал", en: "ABB Insurance Portal" }, companyIdx: 4, contactIdx: 4, stage: "LEAD", valueAmount: 67000, probability: 15 },
  { name: { az: "Bravo ERP Sistemi", ru: "Bravo — система ERP", en: "Bravo ERP System" }, companyIdx: 5, contactIdx: 5, stage: "QUALIFIED", valueAmount: 120000, probability: 25 },
];

const LEADS = [
  { contactName: { az: "Əli Həsənov", ru: "Али Гасанов", en: "Ali Hasanov" }, companyName: "TechVision MMC", email: "ali@techvision.az", phone: "+994 50 111 2233", source: "website", status: "new", priority: "high", score: 85, estimatedValue: 45000 },
  { contactName: { az: "Günel Rzayeva", ru: "Гюнель Рзаева", en: "Gunel Rzayeva" }, companyName: "DataPro LLC", email: "gunel@datapro.az", phone: "+994 55 222 3344", source: "referral", status: "contacted", priority: "high", score: 78, estimatedValue: 67000 },
  { contactName: { az: "Murad Əhmədov", ru: "Мурад Ахмедов", en: "Murad Ahmadov" }, companyName: "CloudAz", email: "murad@cloudaz.com", phone: "+994 50 333 4455", source: "linkedin", status: "qualified", priority: "medium", score: 72, estimatedValue: 34000 },
  { contactName: { az: "Nərmin Əliyeva", ru: "Нармин Алиева", en: "Narmin Aliyeva" }, companyName: "InnoTech Baku", email: "narmin@innotech.az", phone: "+994 55 444 5566", source: "exhibition", status: "new", priority: "medium", score: 65, estimatedValue: 28000 },
];

const TASKS = [
  { title: { az: "Azercell ilə demo görüşü", ru: "Демо-встреча с Azercell", en: "Demo meeting with Azercell" }, status: "in_progress", priority: "high", dueInDays: 2 },
  { title: { az: "SOCAR üçün təklif hazırla", ru: "Подготовить предложение для SOCAR", en: "Prepare SOCAR proposal" }, status: "pending", priority: "high", dueInDays: 4 },
  { title: { az: "Pasha Holding müqaviləni imzala", ru: "Подписать договор Pasha Holding", en: "Sign Pasha Holding contract" }, status: "completed", priority: "high", dueInDays: -1 },
  { title: { az: "Kapital Bank texniki audit", ru: "Технический аудит Kapital Bank", en: "Kapital Bank technical audit" }, status: "in_progress", priority: "medium", dueInDays: 6 },
  { title: { az: "ABB Sığorta ilk görüş", ru: "Первая встреча с ABB Страхование", en: "ABB Insurance first meeting" }, status: "pending", priority: "medium", dueInDays: 8 },
];

const TICKETS = [
  { num: "TK-001", subject: { az: "CRM giriş problemi", ru: "Проблема входа в CRM", en: "CRM login issue" }, description: { az: "İstifadəçi sistemə daxil ola bilmir", ru: "Пользователь не может войти в систему", en: "User cannot sign in" }, priority: "high", status: "new", category: "technical", contactIdx: 0, companyIdx: 0 },
  { num: "TK-002", subject: { az: "Hesabat yüklənməsi yavaş", ru: "Отчёты загружаются медленно", en: "Reports load slowly" }, description: { az: "Dashboard-da hesabatlar gec yüklənir", ru: "Отчёты на дашборде грузятся долго", en: "Dashboard reports are slow" }, priority: "medium", status: "in_progress", category: "performance", contactIdx: 1, companyIdx: 1 },
  { num: "TK-003", subject: { az: "Faktura PDF xətası", ru: "Ошибка PDF счёта", en: "Invoice PDF error" }, description: { az: "PDF yaradılarkən xəta baş verir", ru: "При создании PDF возникает ошибка", en: "An error occurs when generating the PDF" }, priority: "high", status: "new", category: "bug", contactIdx: 3, companyIdx: 3 },
  { num: "TK-004", subject: { az: "Yeni istifadəçi əlavə etmək", ru: "Добавить нового пользователя", en: "Add a new user" }, description: { az: "Yeni komanda üzvü üçün hesab yaratmaq lazımdır", ru: "Нужно создать аккаунт для нового сотрудника", en: "Need an account for a new team member" }, priority: "low", status: "resolved", category: "general", contactIdx: 5, companyIdx: 5 },
];

const CAMPAIGNS = [
  { name: { az: "Novruz Bayramı Kampaniyası", ru: "Кампания к Новрузу", en: "Novruz Holiday Campaign" }, subject: { az: "Novruz təbriki və xüsusi təklif!", ru: "Поздравление с Новрузом и спецпредложение!", en: "Novruz greetings and a special offer!" }, status: "sent", totalRecipients: 1250, totalSent: 1230, totalOpened: 485, totalClicked: 156, budget: 500, actualCost: 420 },
  { name: { az: "Yeni Məhsul Lansmanı", ru: "Запуск нового продукта", en: "New Product Launch" }, subject: { az: "LeadDrive v2 — yeni imkanlar!", ru: "LeadDrive v2 — новые возможности!", en: "LeadDrive v2 — new capabilities!" }, status: "running", totalRecipients: 890, totalSent: 870, totalOpened: 342, totalClicked: 98, budget: 800, actualCost: 650 },
  { name: { az: "Referral Proqramı", ru: "Реферальная программа", en: "Referral Program" }, subject: { az: "Dostunuzu dəvət edin — 20% endirim!", ru: "Пригласите друга — скидка 20%!", en: "Invite a friend — 20% off!" }, status: "sent", totalRecipients: 650, totalSent: 640, totalOpened: 312, totalClicked: 145, budget: 200, actualCost: 180 },
];

// Safety guard: this seeder WRITES (and with DEMO_RESET, DELETES) rows. Refuse
// to touch a non-local database unless the operator explicitly confirms — a
// prod DATABASE_URL + DEMO_RESET would otherwise wipe live story tables.
const dbHost = (() => { try { return new URL(process.env.DATABASE_URL).hostname; } catch { return ""; } })();
const dbIsLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/.test(dbHost);
if (!dbIsLocal && process.env.CONFIRM_PROD !== "1") {
  console.error(`Refusing to seed a non-local database (host "${dbHost}"). This script writes/deletes demo rows.`);
  console.error("If you REALLY mean to seed this DB, re-run with CONFIRM_PROD=1 (and be sure it's a demo tenant).");
  process.exit(1);
}

const prisma = await makeScriptPrisma();
const t = (v) => (v && typeof v === "object" ? (v[LANG] || v.az || v.en) : v);
const daysFromNow = (d) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

async function main() {
  const org = await resolveOrg();
  const orgId = org.id;
  console.log(`demo-fill: org "${org.name}" (${org.slug || orgId}) · lang=${LANG} · reset=${RESET}`);

  const user = await resolveAdmin(orgId);
  await ensureStages(orgId);

  if (RESET) await resetStoryTables(orgId);

  const companyIds = [];
  for (const c of COMPANIES) {
    const found = await prisma.company.findFirst({ where: { organizationId: orgId, name: c.name } });
    const row = found || await prisma.company.create({
      data: {
        organizationId: orgId, name: c.name, industry: t(c.industry), website: c.website,
        phone: c.phone, email: c.email, city: "Bakı", country: "Azərbaycan",
        employeeCount: c.employeeCount, annualRevenue: c.annualRevenue, status: "active", category: c.category,
      },
    });
    companyIds.push(row.id);
  }
  console.log(`  companies: ${companyIds.length}`);

  const contactIds = [];
  for (const c of CONTACTS) {
    const found = await prisma.contact.findFirst({ where: { organizationId: orgId, email: c.email } });
    const row = found || await prisma.contact.create({
      data: {
        organizationId: orgId, fullName: c.fullName, email: c.email, phone: c.phone,
        position: t(c.position), companyId: companyIds[c.companyIdx], engagementScore: c.engagementScore,
        isActive: true, tags: [],
      },
    });
    contactIds.push(row.id);
  }
  console.log(`  contacts: ${contactIds.length}`);

  let n = 0;
  for (const d of DEALS) {
    const name = t(d.name);
    if (await prisma.deal.findFirst({ where: { organizationId: orgId, name } })) continue;
    await prisma.deal.create({
      data: {
        organizationId: orgId, name, companyId: companyIds[d.companyIdx], contactId: contactIds[d.contactIdx],
        stage: d.stage, valueAmount: d.valueAmount, probability: d.probability, currency: "AZN",
        assignedTo: user.id, expectedClose: daysFromNow(Math.floor(Math.random() * 60) + 5), tags: [],
      },
    });
    n += 1;
  }
  console.log(`  deals: +${n}`);

  n = 0;
  for (const l of LEADS) {
    if (await prisma.lead.findFirst({ where: { organizationId: orgId, email: l.email } })) continue;
    await prisma.lead.create({
      data: {
        organizationId: orgId, contactName: t(l.contactName), companyName: l.companyName, email: l.email,
        phone: l.phone, source: l.source, status: l.status, priority: l.priority, score: l.score,
        estimatedValue: l.estimatedValue, assignedTo: user.id,
      },
    });
    n += 1;
  }
  console.log(`  leads: +${n}`);

  n = 0;
  for (const task of TASKS) {
    const title = t(task.title);
    if (await prisma.task.findFirst({ where: { organizationId: orgId, title } })) continue;
    await prisma.task.create({
      data: {
        organizationId: orgId, title, status: task.status, priority: task.priority,
        dueDate: daysFromNow(task.dueInDays), assignedTo: user.id, createdBy: user.id,
      },
    });
    n += 1;
  }
  console.log(`  tasks: +${n}`);

  n = 0;
  for (const tk of TICKETS) {
    if (await prisma.ticket.findFirst({ where: { organizationId: orgId, ticketNumber: tk.num } })) continue;
    await prisma.ticket.create({
      data: {
        organizationId: orgId, ticketNumber: tk.num, subject: t(tk.subject), description: t(tk.description),
        priority: tk.priority, status: tk.status, category: tk.category,
        contactId: contactIds[tk.contactIdx], companyId: companyIds[tk.companyIdx],
        assignedTo: user.id, createdBy: user.id, tags: [], escalationLevel: 0,
      },
    });
    n += 1;
  }
  console.log(`  tickets: +${n}`);

  n = 0;
  for (const c of CAMPAIGNS) {
    const name = t(c.name);
    if (await prisma.campaign.findFirst({ where: { organizationId: orgId, name } })) continue;
    await prisma.campaign.create({
      data: {
        organizationId: orgId, name, type: "email", status: c.status, subject: t(c.subject),
        totalRecipients: c.totalRecipients, totalSent: c.totalSent, totalOpened: c.totalOpened,
        totalClicked: c.totalClicked, budget: c.budget, actualCost: c.actualCost, createdBy: user.id,
        sentAt: c.status === "sent" ? daysFromNow(-Math.floor(Math.random() * 30) - 1) : undefined,
      },
    });
    n += 1;
  }
  console.log(`  campaigns: +${n}`);

  console.log(`✅ demo-fill done (org "${org.name}", lang ${LANG})`);
}

async function resolveOrg() {
  const candidates = [ORG_SLUG, "demo-company"].filter(Boolean);
  for (const slug of candidates) {
    const org = await prisma.organization.findFirst({ where: { slug } });
    if (org) return org;
  }
  const first = await prisma.organization.findFirst();
  if (!first) { console.error("No organization found."); process.exit(1); }
  return first;
}

async function resolveAdmin(orgId) {
  const found = await prisma.user.findFirst({ where: { organizationId: orgId, role: "admin" } })
    || await prisma.user.findFirst({ where: { organizationId: orgId } });
  if (found) return found;
  return prisma.user.create({
    data: {
      organizationId: orgId, email: "demo-fill@leaddrive.local", name: "Demo Admin",
      role: "admin", isActive: true, passwordHash: "DEMO-DISABLED-NO-LOGIN",
    },
  });
}

async function ensureStages(orgId) {
  const count = await prisma.pipelineStage.count({ where: { organizationId: orgId } });
  if (count) return;
  const stages = [
    { name: "LEAD", displayName: "Yeni Lead", color: "#6366f1", probability: 10, sortOrder: 0 },
    { name: "QUALIFIED", displayName: "Kvalifikasiya", color: "#3b82f6", probability: 25, sortOrder: 1 },
    { name: "PROPOSAL", displayName: "Təklif", color: "#f59e0b", probability: 50, sortOrder: 2 },
    { name: "NEGOTIATION", displayName: "Danışıq", color: "#8b5cf6", probability: 75, sortOrder: 3 },
    { name: "WON", displayName: "Uduldu", color: "#10b981", probability: 100, sortOrder: 4, isWon: true },
    { name: "LOST", displayName: "İtirildi", color: "#ef4444", probability: 0, sortOrder: 5, isLost: true },
  ];
  for (const s of stages) await prisma.pipelineStage.create({ data: { ...s, organizationId: orgId } });
  console.log("  pipeline stages: created defaults");
}

// Best-effort clear of the LOCALIZED story tables (keep the shared company /
// contact base). A blocked delete (child FK rows) is logged, not fatal — the
// idempotent create path still dedupes on re-run.
async function resetStoryTables(orgId) {
  const where = { where: { organizationId: orgId } };
  for (const [label, del] of [
    ["tickets", () => prisma.ticket.deleteMany(where)],
    ["deals", () => prisma.deal.deleteMany(where)],
    ["tasks", () => prisma.task.deleteMany(where)],
    ["leads", () => prisma.lead.deleteMany(where)],
    ["campaigns", () => prisma.campaign.deleteMany(where)],
  ]) {
    try {
      const r = await del();
      console.log(`  reset ${label}: -${r.count ?? 0}`);
    } catch (e) {
      console.warn(`  ⚠ reset ${label} skipped: ${e.message.split("\n")[0]}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
