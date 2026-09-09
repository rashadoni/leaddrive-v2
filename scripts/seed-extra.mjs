// Seed extra demo data: KB articles, Budget plans, Inbox messages, Profitability
import { makeScriptPrisma } from "./_rls.mjs"
const prisma = await makeScriptPrisma()

const orgId = "cmnmya8oa0000u6vhhmo3vq4s"

async function main() {
  const user = await prisma.user.findFirst({ where: { organizationId: orgId, role: "admin" } })
  const contacts = await prisma.contact.findMany({ where: { organizationId: orgId }, take: 8 })

  // ─── KB Articles ───
  const articles = [
    { title: "LeadDrive CRM-ə başlamaq", content: "Bu məqalədə LeadDrive CRM-in əsas funksiyaları haqqında öyrənəcəksiniz. Dashboard, şirkətlər, kontaktlar və sövdələşmələr modullarının istifadəsi.", status: "published", viewCount: 234, helpfulCount: 45 },
    { title: "Sövdələşmə pipeline-ını necə qurmaq", content: "Pipeline mərhələlərinin yaradılması, düzəliş edilməsi və silinməsi. Kanban görünüşündə sövdələşmələri idarə etmək. Çoxlu pipeline dəstəyi.", status: "published", viewCount: 189, helpfulCount: 38 },
    { title: "AI Lid Skorinq sistemi", content: "Da Vinci AI motorunun lid skorinq funksiyası. 5 faktor üzrə qiymətləndirmə, A-F dərəcə, konversiya ehtimalı. Toplu skorinq.", status: "published", viewCount: 156, helpfulCount: 29 },
    { title: "E-poçt kampaniyalarının yaradılması", content: "Kampaniya yaratma, seqment seçimi, şablon istifadəsi, A/B testləşdirmə, planlaşdırma və statistika izləmə.", status: "published", viewCount: 312, helpfulCount: 67 },
    { title: "SLA siyasətlərinin konfiqurasiyası", content: "SLA siyasətlərinin yaradılması, cavab müddətləri, eskalasiya qaydaları, prioritet əsaslı SLA idarəetməsi.", status: "published", viewCount: 98, helpfulCount: 21 },
    { title: "Workflow avtomatlaşdırma", content: "Rule-based avtomatlaşdırma: trigger yaratma, şərtlərin təyin edilməsi, əməliyyatların seçilməsi. 7 əməliyyat növü.", status: "published", viewCount: 145, helpfulCount: 33 },
    { title: "API inteqrasiya bələdçisi", content: "API açarlarının yaradılması, scope-based giriş, webhook konfiqurasiyası, Zapier/n8n inteqrasiya.", status: "published", viewCount: 87, helpfulCount: 15 },
    { title: "Maliyyə modulunun istifadəsi", content: "Fakturalar, büdcələmə, xərc modeli, rentabellik analizi. Müştəri/xidmət üzrə marja hesablaması.", status: "published", viewCount: 203, helpfulCount: 42 },
    { title: "Müştəri portalının quraşdırılması", content: "Portal aktivləşdirmə, müştəri girişi, tiket yaratma, bilik bazası paylaşımı, AI chat.", status: "draft", viewCount: 12, helpfulCount: 0 },
    { title: "Hesabatlar və analitika", content: "Dashboard widgetləri, pipeline hesabatları, CSAT, SLA, gəlir trendi, proqnozlaşdırma.", status: "published", viewCount: 176, helpfulCount: 31 },
  ]

  for (const a of articles) {
    const exists = await prisma.kbArticle.findFirst({ where: { organizationId: orgId, title: a.title } })
    if (!exists) {
      await prisma.kbArticle.create({ data: { ...a, organizationId: orgId, authorId: user?.id, tags: [] } })
    }
  }
  console.log(`KB Articles: ${articles.length}`)

  // ─── Budget Plans ───
  const budgets = [
    { name: "Q1 2026 — Satış departamenti", periodType: "quarterly", year: 2026, quarter: 1, status: "approved" },
    { name: "Q2 2026 — Marketinq büdcəsi", periodType: "quarterly", year: 2026, quarter: 2, status: "active" },
    { name: "2026 İllik IT büdcəsi", periodType: "annual", year: 2026, status: "approved" },
    { name: "Aprel 2026 — Əməliyyat xərcləri", periodType: "monthly", year: 2026, month: 4, status: "draft" },
  ]

  for (const b of budgets) {
    const exists = await prisma.budgetPlan.findFirst({ where: { organizationId: orgId, name: b.name } })
    if (!exists) {
      await prisma.budgetPlan.create({ data: { ...b, organizationId: orgId, submittedBy: user?.id } })
    }
  }
  console.log(`Budget Plans: ${budgets.length}`)

  // ─── Inbox / Channel Messages ───
  const messages = [
    { direction: "inbound", channelType: "whatsapp", from: "+994502001234", to: "system", body: "Salam, CRM sisteminiz barədə məlumat ala bilərəm?", contactIdx: 0 },
    { direction: "outbound", channelType: "whatsapp", from: "system", to: "+994502001234", body: "Salam! Əlbəttə, hansı modullar sizi maraqlandırır?", contactIdx: 0 },
    { direction: "inbound", channelType: "whatsapp", from: "+994502001234", to: "system", body: "Satış və maliyyə modulları. Qiyməti nə qədərdir?", contactIdx: 0 },
    { direction: "inbound", channelType: "email", from: "kamala@socar.az", to: "info@leaddrivecrm.org", subject: "Demo sorğusu", body: "Hörmətli komanda, SOCAR Trading üçün CRM demo-su planlaşdıra bilərikmi?", contactIdx: 1 },
    { direction: "outbound", channelType: "email", from: "info@leaddrivecrm.org", to: "kamala@socar.az", subject: "Re: Demo sorğusu", body: "Hörmətli Kamala xanım, əlbəttə! Bu həftə çərşənbə günü 14:00-da uyğundur?", contactIdx: 1 },
    { direction: "inbound", channelType: "telegram", from: "tural_aliyev", to: "system", body: "Demo nə vaxt olacaq? Pasha Holding komandası hazırdır.", contactIdx: 2 },
    { direction: "inbound", channelType: "email", from: "nigar@kapitalbank.az", to: "info@leaddrivecrm.org", subject: "Faktura göndərin", body: "Zəhmət olmasa, son xidmət üçün fakturanı göndərin.", contactIdx: 3 },
    { direction: "inbound", channelType: "whatsapp", from: "+994506007890", to: "system", body: "İnteqrasiya mümkündürmü? SAP ilə bağlamaq istəyirik.", contactIdx: 4 },
    { direction: "inbound", channelType: "facebook", from: "sevda.alizada", to: "system", body: "Xidmət qiymətləri haqqında məlumat verin zəhmət olmasa.", contactIdx: 5 },
    { direction: "inbound", channelType: "email", from: "farid@bravo.az", to: "info@leaddrivecrm.org", subject: "ERP inteqrasiyası", body: "Bravo üçün ERP inteqrasiyası barədə danışmaq istəyirik.", contactIdx: 6 },
    { direction: "outbound", channelType: "email", from: "info@leaddrivecrm.org", to: "farid@bravo.az", subject: "Re: ERP inteqrasiyası", body: "Hörmətli Farid bəy, texniki komandamız sizinlə əlaqə saxlayacaq.", contactIdx: 6 },
    { direction: "inbound", channelType: "telegram", from: "orxan_ismayilov", to: "system", body: "ASAN layihəsi üçün API sənədləri lazımdır.", contactIdx: 7 },
  ]

  for (const m of messages) {
    const { contactIdx, ...rest } = m
    const exists = await prisma.channelMessage.findFirst({
      where: { organizationId: orgId, body: rest.body },
    })
    if (!exists) {
      await prisma.channelMessage.create({
        data: {
          ...rest,
          organizationId: orgId,
          contactId: contacts[contactIdx]?.id || null,
          metadata: {},
          messageType: "text",
        },
      })
    }
  }
  console.log(`Channel Messages: ${messages.length}`)

  // ─── Overhead Costs (Profitability) ───
  const overheads = [
    { category: "Administrativ əlavə xərclər", label: "Ofis icarəsi", amount: 3500, isAnnual: false, sortOrder: 1 },
    { category: "Administrativ əlavə xərclər", label: "Kommunal xidmətlər", amount: 800, isAnnual: false, sortOrder: 2 },
    { category: "Administrativ əlavə xərclər", label: "İnternet & Telekom", amount: 450, isAnnual: false, sortOrder: 3 },
    { category: "Texniki infrastruktur", label: "Server hostinq (Hetzner)", amount: 280, isAnnual: false, sortOrder: 4 },
    { category: "Texniki infrastruktur", label: "Domain & SSL", amount: 120, isAnnual: true, sortOrder: 5 },
    { category: "Texniki infrastruktur", label: "GitHub Pro", amount: 44, isAnnual: false, sortOrder: 6 },
    { category: "Texniki infrastruktur", label: "Claude API (Anthropic)", amount: 350, isAnnual: false, sortOrder: 7 },
    { category: "Birbaşa əmək xərcləri", label: "Baş developer", amount: 4500, isAnnual: false, sortOrder: 8 },
    { category: "Birbaşa əmək xərcləri", label: "Frontend developer", amount: 3200, isAnnual: false, sortOrder: 9 },
    { category: "Birbaşa əmək xərcləri", label: "QA mühəndisi", amount: 2800, isAnnual: false, sortOrder: 10 },
    { category: "Birbaşa əmək xərcləri", label: "Dəstək meneceri", amount: 2200, isAnnual: false, sortOrder: 11 },
    { category: "Əməliyyat xərcləri", label: "Twilio SMS/VoIP", amount: 200, isAnnual: false, sortOrder: 12 },
    { category: "Əməliyyat xərcləri", label: "SendGrid email", amount: 150, isAnnual: false, sortOrder: 13 },
    { category: "Əməliyyat xərcləri", label: "Sığorta", amount: 600, isAnnual: true, sortOrder: 14 },
  ]

  for (const o of overheads) {
    const exists = await prisma.overheadCost.findFirst({ where: { organizationId: orgId, label: o.label } })
    if (!exists) {
      await prisma.overheadCost.create({ data: { ...o, organizationId: orgId } })
    }
  }
  console.log(`Overhead Costs: ${overheads.length}`)

  // ─── Budget Lines (for budget plans) ───
  const plans = await prisma.budgetPlan.findMany({ where: { organizationId: orgId } })
  if (plans.length > 0) {
    const lineCount = await prisma.budgetLine.count({ where: { organizationId: orgId } })
    if (lineCount === 0) {
      const items = [
        { planId: plans[0].id, category: "Satış", lineType: "expense", plannedAmount: 15000, notes: "CRM lisenziyalar" },
        { planId: plans[0].id, category: "Satış", lineType: "expense", plannedAmount: 5000, notes: "Təlim xərcləri" },
        { planId: plans[0].id, category: "Satış", lineType: "expense", plannedAmount: 3000, notes: "Müştəri görüşləri" },
        { planId: plans[1]?.id || plans[0].id, category: "Marketinq", lineType: "expense", plannedAmount: 8000, notes: "Rəqəmsal reklam" },
        { planId: plans[1]?.id || plans[0].id, category: "Marketinq", lineType: "expense", plannedAmount: 12000, notes: "Tədbir sponsorluğu" },
        { planId: plans[1]?.id || plans[0].id, category: "Marketinq", lineType: "expense", plannedAmount: 4000, notes: "Kontent yaratma" },
        { planId: plans[2]?.id || plans[0].id, category: "IT", lineType: "expense", plannedAmount: 24000, notes: "Server infrastrukturu" },
        { planId: plans[2]?.id || plans[0].id, category: "IT", lineType: "expense", plannedAmount: 18000, notes: "Proqram təminatı" },
      ]
      for (const item of items) {
        await prisma.budgetLine.create({ data: { ...item, organizationId: orgId } })
      }
      console.log(`Budget Lines: ${items.length}`)
    }
  }

  console.log("\n✅ Extra demo data seeded!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
