import PptxGenJS from "pptxgenjs"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const screenshotsDir = path.join(__dirname, "..", "docs", "screenshots")

const pptx = new PptxGenJS()

// ─── Clean Tech Brand Colors ───
const PRIMARY = "0066FF"
const SECONDARY = "7C3AED"
const ACCENT = "06B6D4"
const SUCCESS = "10B981"
const WARNING = "F59E0B"
const DANGER = "EF4444"
const PINK = "EC4899"
const ORANGE = "F97316"
const WHITE = "FFFFFF"
const LIGHT = "F8FAFC"
const DARK = "0F172A"
const MUTED = "64748B"
const LIGHT_BLUE = "EFF6FF"
const LIGHT_PURPLE = "F5F3FF"

// Keep in step with COMPANY_LEGAL_* in src/lib/constants.ts —
// company-identity-claims.test.ts fails if this drifts back.
pptx.author = "Fanumsec MMC"
pptx.company = "Fanumsec MMC"
pptx.title = "LeadDrive CRM — Kommersiya Təklifi"
pptx.layout = "LAYOUT_WIDE" // 13.33 x 7.5

/**
 * Screenshots that were withdrawn because they showed fabricated contracts
 * and contacts attributed to real companies (SOCAR, Kapital Bank, Azercell,
 * Pasha Holding, ASAN Xidmət). A proposal is a commercial claim, so shipping
 * those slides told prospects those firms were customers.
 * See docs/isms/evidence/2026-08-31-marketing-screenshots-data-exposure.md §3.
 */
const missingShots = []

function img(name) {
  const p = path.join(screenshotsDir, `${name}.png`)
  if (!fs.existsSync(p)) {
    // Silently returning null is how a half-illustrated deck reached a client
    // and nobody noticed. Record it and fail before the file is written.
    missingShots.push(name)
    return null
  }
  return { data: `image/png;base64,${fs.readFileSync(p).toString("base64")}` }
}

// Helper: gradient header with section nav
function addHeader(slide, title, subtitle, bgColor) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.3, fill: { color: bgColor || PRIMARY } })
  slide.addShape(pptx.ShapeType.ellipse, { x: 11, y: -0.5, w: 3, h: 3, fill: { color: WHITE, transparency: 92 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.5, y: -1, w: 4, h: 4, fill: { color: WHITE, transparency: 95 } })
  slide.addText(title, { x: 0.6, y: 0.15, w: 10, h: 0.55, fontSize: 24, color: WHITE, fontFace: "Arial", bold: true })
  if (subtitle) {
    slide.addText(subtitle, { x: 0.6, y: 0.7, w: 10, h: 0.35, fontSize: 12, color: WHITE, fontFace: "Arial", transparency: 15 })
  }
}

// Helper: screenshot with shadow frame
function addScreenshot(slide, name, x, y, w, h) {
  const image = img(name)
  if (!image) return
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.03, y: y + 0.03, w, h,
    fill: { color: "000000", transparency: 85 },
  })
  slide.addImage({
    ...image, x, y, w, h,
    sizing: { type: "cover", w, h },
  })
}

// Helper: progress indicator at bottom
function addProgress(slide, activeIdx) {
  const sections = ["CRM", "Marketinq", "Dəstək", "Maliyyə", "AI"]
  const colors = [PRIMARY, SECONDARY, ACCENT, WARNING, PINK]
  const totalW = sections.length * 1.8
  const startX = (13.33 - totalW) / 2
  for (let i = 0; i < sections.length; i++) {
    const x = startX + i * 1.8
    const isActive = i === activeIdx
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 7.1, w: 1.6, h: 0.28,
      fill: { color: isActive ? colors[i] : "E2E8F0" },
      rectRadius: 0.14,
    })
    slide.addText(sections[i], {
      x, y: 7.1, w: 1.6, h: 0.28,
      fontSize: 8, color: isActive ? WHITE : MUTED, fontFace: "Arial", bold: isActive, align: "center", valign: "middle",
    })
  }
}

// Helper: USP badge
function addUSP(slide, x, y, text) {
  const w = text.length * 0.075 + 0.5
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.35, fill: { color: WARNING }, rectRadius: 0.17 })
  slide.addText(`★ ${text}`, { x: x + 0.05, y, w, h: 0.35, fontSize: 9, color: DARK, fontFace: "Arial", bold: true, align: "center", valign: "middle" })
}

// Helper: benefit card
function addBenefitCard(slide, x, y, w, h, icon, title, desc, color) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, fill: { color: WHITE }, rectRadius: 0.1,
    shadow: { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.05 },
  })
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.04, fill: { color } })
  slide.addText(icon, { x: x + 0.15, y: y + 0.15, w: 0.4, h: 0.4, fontSize: 18, fontFace: "Arial", align: "center", valign: "middle" })
  slide.addText(title, { x: x + 0.6, y: y + 0.12, w: w - 0.8, h: 0.25, fontSize: 10, color: DARK, fontFace: "Arial", bold: true })
  slide.addText(desc, { x: x + 0.6, y: y + 0.38, w: w - 0.8, h: 0.35, fontSize: 8.5, color: MUTED, fontFace: "Arial", lineSpacingMultiple: 1.3 })
}

// ═══════════════════════════════════════════════════
// SLIDE 1: Cover
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: PRIMARY }
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.5, w: 13.33, h: 4.0, fill: { color: SECONDARY, transparency: 40 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: -2, y: -2, w: 7, h: 7, fill: { color: WHITE, transparency: 92 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: 9, y: 4, w: 6, h: 6, fill: { color: WHITE, transparency: 92 } })

  slide.addText("LeadDrive CRM", {
    x: 0.8, y: 0.8, w: 6, h: 0.5, fontSize: 18, color: WHITE, fontFace: "Arial", bold: true, transparency: 10,
  })
  slide.addText("Müasir Biznesiniz üçün\nAğıllı CRM Platforması", {
    x: 0.8, y: 2.0, w: 6.5, h: 1.8, fontSize: 40, color: WHITE, fontFace: "Arial", bold: true, lineSpacingMultiple: 1.15,
  })
  slide.addText("Satış, Marketinq, Dəstək və Maliyyə — hamısı bir platformada.\nSüni intellekt ilə gücləndirilmiş.", {
    x: 0.8, y: 4.0, w: 6, h: 0.9, fontSize: 15, color: WHITE, fontFace: "Arial", lineSpacingMultiple: 1.4, transparency: 15,
  })
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: 5.2, w: 3.0, h: 0.55, fill: { color: WHITE }, rectRadius: 0.28 })
  slide.addText("Demo Sifariş Edin  →", { x: 0.8, y: 5.2, w: 3.0, h: 0.55, fontSize: 13, color: PRIMARY, fontFace: "Arial", bold: true, align: "center", valign: "middle" })
  slide.addText("Fanumsec MMC  |  Bakı, Azərbaycan  |  leaddrivecrm.org", {
    x: 0.8, y: 6.7, w: 7, h: 0.35, fontSize: 11, color: WHITE, fontFace: "Arial", transparency: 30,
  })

  addScreenshot(slide, "dashboard", 7.2, 0.8, 5.8, 5.8)
}

// ═══════════════════════════════════════════════════
// SLIDE 2: Platform Overview — Benefits, not stats
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Platforma Haqqında", "LeadDrive CRM — tam funksional SaaS CRM platforması", PRIMARY)

  // Benefits row (transformed stats → business benefits)
  const benefits = [
    { value: "40+", label: "Hazır Modul", desc: "Bütün departamentlər üçün", color: PRIMARY },
    { value: "5 dəq", label: "Quraşdırma", desc: "Bulud əsaslı, quraşdırma yoxdur", color: SECONDARY },
    { value: "3-in-1", label: "CRM + ERP + AI", desc: "Bir platforma, tam həll", color: SUCCESS },
    { value: "24/7", label: "AI Köməkçi", desc: "Da Vinci AI hər an hazır", color: PINK },
    { value: "∞", label: "İnteqrasiya", desc: "API, Webhook, Zapier", color: ACCENT },
  ]
  for (let i = 0; i < benefits.length; i++) {
    const x = 0.5 + i * 2.55
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 1.55, w: 2.3, h: 1.2, fill: { color: WHITE }, rectRadius: 0.1 })
    slide.addShape(pptx.ShapeType.rect, { x, y: 1.55, w: 2.3, h: 0.05, fill: { color: benefits[i].color } })
    slide.addText(benefits[i].value, { x, y: 1.65, w: 2.3, h: 0.45, fontSize: 24, color: benefits[i].color, fontFace: "Arial", bold: true, align: "center" })
    slide.addText(benefits[i].label, { x, y: 2.1, w: 2.3, h: 0.25, fontSize: 10, color: DARK, fontFace: "Arial", bold: true, align: "center" })
    slide.addText(benefits[i].desc, { x, y: 2.35, w: 2.3, h: 0.25, fontSize: 8.5, color: MUTED, fontFace: "Arial", align: "center" })
  }

  // Modules grid
  const modules = [
    { title: "CRM & Satış", desc: "Lidlər, kontaktlar, şirkətlər, sövdələşmələr, kanban, pipeline", color: PRIMARY },
    { title: "Marketinq", desc: "Kampaniyalar, seqmentlər, journey builder, A/B test, şablonlar", color: SECONDARY },
    { title: "Dəstək & Inbox", desc: "Tiketlər, SLA, bilik bazası, WhatsApp, Telegram, Email", color: ACCENT },
    { title: "Maliyyə", desc: "Fakturalar, müqavilələr, büdcələmə, rentabellik, xərc modeli", color: WARNING },
    { title: "AI & Da Vinci", desc: "AI agentlər, lid skorinq, proqnozlaşdırma, next best action", color: PINK },
    { title: "Platforma", desc: "SSO, API keys, webhooks, RBAC, audit log, custom fields", color: SUCCESS },
    { title: "Hesabatlar", desc: "Pipeline, funnel, CSAT, SLA, gəlir trendi, 10+ hesabat", color: ORANGE },
    { title: "Avtomatlaşma", desc: "Workflow engine, rule-based triggers, 7 əməliyyat növü", color: DANGER },
  ]
  for (let i = 0; i < modules.length; i++) {
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = 0.5 + col * 3.2
    const y = 3.05 + row * 2.15
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: 3.0, h: 1.85, fill: { color: WHITE }, rectRadius: 0.1,
      shadow: { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.05 },
    })
    slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5, fill: { color: modules[i].color }, rectRadius: 0.12 })
    slide.addText(modules[i].title, { x: x + 0.2, y: y + 0.8, w: 2.6, h: 0.3, fontSize: 12, color: DARK, fontFace: "Arial", bold: true })
    slide.addText(modules[i].desc, { x: x + 0.2, y: y + 1.1, w: 2.6, h: 0.55, fontSize: 9, color: MUTED, fontFace: "Arial", lineSpacingMultiple: 1.3 })
  }
}

// ═══════════════════════════════════════════════════
// SLIDE 3: Dashboard
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "İdarə Paneli", "KPI-lar, satış pipeline, gəlir trendi, AI tövsiyələr — hamısı bir baxışda", PRIMARY)

  addScreenshot(slide, "dashboard", 0.4, 1.5, 12.5, 5.4)
  addProgress(slide, 0)
}

// ═══════════════════════════════════════════════════
// SLIDE 4: CRM & Sales
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "CRM & Satış İdarəetməsi", "Şirkətlər, kontaktlar, sövdələşmələr, lidlər — bütün satış prosesi", PRIMARY)

  // Benefit cards instead of bullet list
  const cards = [
    { icon: "🏢", title: "Şirkətlər & Kontaktlar", desc: "Profil, kontaktlar, sövdələşmələr, müqavilələr. CSV idxalı.", color: PRIMARY },
    { icon: "🔀", title: "Kanban Pipeline", desc: "Çoxlu pipeline, weighted dəyər, drag & drop idarəetmə.", color: SECONDARY },
    { icon: "🎯", title: "Lid Menecment", desc: "AI skorinq (A-F), konversiya %, auto-assignment.", color: SUCCESS },
    { icon: "📋", title: "Tapşırıqlar & Müqavilələr", desc: "Siyahı + Kanban + Təqvim. Fayl əlavələri, xəbərdarlıqlar.", color: ACCENT },
  ]
  for (let i = 0; i < cards.length; i++) {
    addBenefitCard(slide, 0.5, 1.5 + i * 0.85, 5.5, 0.75, cards[i].icon, cards[i].title, cards[i].desc, cards[i].color)
  }

  addScreenshot(slide, "deals", 6.5, 1.5, 6.5, 5.4)
  addProgress(slide, 0)
}

// ═══════════════════════════════════════════════════
// SLIDE 5: Contacts & Leads
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Kontaktlar & Lidlər", "Kontakt bazası, lid skorinq, AI qiymətləndirmə — konversiyanı artırır", SECONDARY)

  addScreenshot(slide, "contacts", 0.4, 1.5, 6.3, 5.4)
  addScreenshot(slide, "leads", 6.85, 1.5, 6.1, 5.4)
  addProgress(slide, 0)
}

// ═══════════════════════════════════════════════════
// SLIDE 6: Marketing
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Marketinq Avtomatlaşması", "Kampaniyalar, seqmentlər, journey builder, A/B test, ROI analizi", SECONDARY)

  const cards = [
    { icon: "📧", title: "Kampaniyalar & A/B Test", desc: "E-poçt/SMS, açılma/klik statistikası, planlaşdırma.", color: SECONDARY },
    { icon: "👥", title: "Seqmentasiya", desc: "Dinamik & statik, 9+ şərt növü, davranış əsaslı.", color: PRIMARY },
    { icon: "🔄", title: "Customer Journeys", desc: "Vizual flow builder, 8 addım növü, branching.", color: ACCENT },
  ]
  for (let i = 0; i < cards.length; i++) {
    addBenefitCard(slide, 0.5, 1.5 + i * 0.85, 12.3, 0.75, cards[i].icon, cards[i].title, cards[i].desc, cards[i].color)
  }

  addScreenshot(slide, "campaigns", 0.4, 4.15, 6.3, 2.7)
  addScreenshot(slide, "journeys", 6.85, 4.15, 6.1, 2.7)
  addProgress(slide, 1)
}

// ═══════════════════════════════════════════════════
// SLIDE 7: Support & Inbox with channel logos
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Müştəri Dəstəyi & Unified Inbox", "Tiketlər, SLA izləmə, 8+ kanal — bütün kommunikasiya bir yerdə", ACCENT)

  // Channel badges with brand colors
  const channels = [
    { name: "Email", color: PRIMARY },
    { name: "WhatsApp", color: "25D366" },
    { name: "Telegram", color: "0088CC" },
    { name: "Facebook", color: "1877F2" },
    { name: "Instagram", color: "E4405F" },
    { name: "SMS", color: ORANGE },
    { name: "VK", color: "4680C2" },
    { name: "Veb Chat", color: ACCENT },
  ]
  for (let i = 0; i < channels.length; i++) {
    const cx = 0.5 + i * 1.55
    slide.addShape(pptx.ShapeType.roundRect, { x: cx, y: 1.5, w: 1.35, h: 0.4, fill: { color: channels[i].color }, rectRadius: 0.2 })
    slide.addText(channels[i].name, { x: cx, y: 1.5, w: 1.35, h: 0.4, fontSize: 10, color: WHITE, fontFace: "Arial", bold: true, align: "center", valign: "middle" })
  }

  // Feature highlights
  const features = [
    { icon: "🎫", title: "SLA İzləmə", desc: "Prioritet əsaslı, avtomatik eskalasiya", color: ACCENT },
    { icon: "📚", title: "Bilik Bazası", desc: "Məqalələr, baxış sayı, faydalılıq reytinqi", color: SUCCESS },
    { icon: "🤖", title: "AI Chat Köməkçi", desc: "Müştəri portalında 24/7 dəstək", color: PINK },
  ]
  for (let i = 0; i < features.length; i++) {
    addBenefitCard(slide, 0.5 + i * 4.2, 2.1, 4.0, 0.75, features[i].icon, features[i].title, features[i].desc, features[i].color)
  }

  addScreenshot(slide, "tickets", 0.4, 3.1, 6.3, 3.8)
  addScreenshot(slide, "inbox", 6.85, 3.1, 6.1, 3.8)
  addProgress(slide, 2)
}

// ═══════════════════════════════════════════════════
// SLIDE 8: Finance & Analytics — USP HIGHLIGHT
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Maliyyə & Analitika", "Heç bir CRM-də olmayan dərin maliyyə modulu — LeadDrive-in unikal üstünlüyü", WARNING)

  // USP Badge
  addUSP(slide, 0.5, 1.5, "Unikal Üstünlük — bazarda analoqu yoxdur!")

  // Finance features as benefit cards
  const cards = [
    { icon: "📄", title: "Fakturalar & Ödəniş", desc: "Yaratma, PDF, göndərmə, ödəniş izləmə, təkrarlanan fakturalar.", color: WARNING },
    { icon: "📊", title: "Büdcələmə", desc: "Departament üzrə, plan vs faktiki, rolling proqnoz, QR/aylıq.", color: PRIMARY },
    { icon: "💰", title: "Xərc Modeli", desc: "Əlavə xərclər, işçi xərcləri, xidmət rentabelliyi hesablaması.", color: SUCCESS },
    { icon: "📈", title: "Rentabellik Analizi", desc: "Müştəri/xidmət/layihə marja, AI müşahidələri, P&L hesabat.", color: DANGER },
  ]
  for (let i = 0; i < 2; i++) {
    addBenefitCard(slide, 0.5, 2.05 + i * 0.85, 6.0, 0.75, cards[i].icon, cards[i].title, cards[i].desc, cards[i].color)
  }
  for (let i = 2; i < 4; i++) {
    addBenefitCard(slide, 6.8, 2.05 + (i - 2) * 0.85, 6.15, 0.75, cards[i].icon, cards[i].title, cards[i].desc, cards[i].color)
  }

  // Comparison callout
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.5, y: 3.85, w: 12.33, h: 0.55, fill: { color: LIGHT_PURPLE }, rectRadius: 0.1,
  })
  slide.addText("💡 Salesforce, HubSpot, Pipedrive-da maliyyə modulu YOXDUR. LeadDrive — yeganə CRM hansı ki, büdcə, xərc modeli və rentabellik analizi təklif edir.", {
    x: 0.7, y: 3.85, w: 12, h: 0.55, fontSize: 9.5, color: DARK, fontFace: "Arial", valign: "middle",
  })

  addScreenshot(slide, "profitability", 0.4, 4.55, 6.3, 2.7)
  addScreenshot(slide, "budgeting", 6.85, 4.55, 6.1, 2.7)
  addProgress(slide, 3)
}

// ═══════════════════════════════════════════════════
// SLIDE 9: AI & Automation — Infographic Cycle
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Süni İntellekt & Avtomatlaşma", "Da Vinci AI — Claude (Anthropic) üzərində qurulmuş AI motor", PINK)

  // AI Cycle Infographic (horizontal flow)
  const steps = [
    { label: "Məlumat\nToplanır", desc: "CRM-dən avtomatik", color: PRIMARY, icon: "📥" },
    { label: "Claude AI\nAnaliz Edir", desc: "Anthropic AI motoru", color: PINK, icon: "🧠" },
    { label: "Skorinq &\nProqnoz", desc: "A-F dərəcə, %", color: SECONDARY, icon: "📊" },
    { label: "Tövsiyə\nVerilir", desc: "Next Best Action", color: SUCCESS, icon: "✅" },
  ]

  for (let i = 0; i < steps.length; i++) {
    const x = 0.5 + i * 3.2
    // Circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.35, y: 1.55, w: 1.4, h: 1.4, fill: { color: steps[i].color },
      shadow: { type: "outer", blur: 8, offset: 2, color: "000000", opacity: 0.1 },
    })
    slide.addText(steps[i].icon, { x: x + 0.35, y: 1.65, w: 1.4, h: 0.7, fontSize: 22, fontFace: "Arial", align: "center", valign: "middle" })
    slide.addText(steps[i].label, { x: x, y: 3.05, w: 2.1, h: 0.5, fontSize: 10, color: DARK, fontFace: "Arial", bold: true, align: "center", lineSpacingMultiple: 1.2 })
    slide.addText(steps[i].desc, { x: x, y: 3.55, w: 2.1, h: 0.25, fontSize: 8.5, color: MUTED, fontFace: "Arial", align: "center" })

    // Arrow between circles
    if (i < steps.length - 1) {
      slide.addText("→", { x: x + 2.1, y: 1.85, w: 0.8, h: 0.7, fontSize: 24, color: "CBD5E1", fontFace: "Arial", align: "center", valign: "middle" })
    }
  }

  // AI features
  const aiFeatures = [
    { icon: "🤖", title: "AI Agentlər", desc: "CRM-də əməliyyatlar icra edir: tapşırıq, e-poçt, yeniləmə.", color: PINK },
    { icon: "📈", title: "Proqnozlaşdırma", desc: "Qazanma ehtimalı, gəlir proqnozu, churn riski.", color: SECONDARY },
    { icon: "⚡", title: "Workflow Engine", desc: "Rule-based trigger → şərt → əməliyyat. 7 əməliyyat növü.", color: ORANGE },
  ]
  for (let i = 0; i < aiFeatures.length; i++) {
    addBenefitCard(slide, 0.5 + i * 4.2, 4.0, 4.0, 0.75, aiFeatures[i].icon, aiFeatures[i].title, aiFeatures[i].desc, aiFeatures[i].color)
  }

  addScreenshot(slide, "ai-scoring", 0.4, 4.95, 6.3, 2.0)
  addScreenshot(slide, "ai-command-center", 6.85, 4.95, 6.1, 2.0)
  addProgress(slide, 4)
}

// ═══════════════════════════════════════════════════
// SLIDE 10: Tasks, KB & Reports
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Tapşırıqlar, Bilik Bazası & Hesabatlar", "Komanda idarəetməsi, müştəri xidməti üçün KB, dərin analitika", SUCCESS)

  addScreenshot(slide, "tasks", 0.4, 1.5, 4.1, 3.0)
  addScreenshot(slide, "knowledge-base", 4.7, 1.5, 4.1, 3.0)
  addScreenshot(slide, "reports", 9.0, 1.5, 4.0, 3.0)

  // Feature cards below
  const items = [
    { icon: "📋", title: "Tapşırıq İdarəetməsi", desc: "Siyahı + Kanban + Təqvim görünüşü, prioritet, deadline, komanda assign.", color: PRIMARY },
    { icon: "📚", title: "Bilik Bazası", desc: "Məqalələr, kateqoriyalar, baxış statistikası, müştəri portalı paylaşımı.", color: SUCCESS },
    { icon: "📊", title: "10+ Hesabat", desc: "Pipeline, funnel, CSAT, SLA, gəlir trendi, proqnozlaşdırma.", color: ACCENT },
  ]
  for (let i = 0; i < items.length; i++) {
    addBenefitCard(slide, 0.5 + i * 4.2, 4.7, 4.0, 0.75, items[i].icon, items[i].title, items[i].desc, items[i].color)
  }

  // Extra screenshots
  addScreenshot(slide, "invoices", 0.4, 5.65, 6.3, 1.7)
  addScreenshot(slide, "contracts", 6.85, 5.65, 6.1, 1.7)
}

// ═══════════════════════════════════════════════════
// SLIDE 11: Platform & Integrations
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: LIGHT }
  addHeader(slide, "Platforma & İnteqrasiyalar", "SSO, RBAC, API, webhooks — enterprise-ready infrastruktur", SUCCESS)

  const items = [
    { title: "SSO / OAuth", desc: "Google, Microsoft ilə giriş", color: PRIMARY },
    { title: "RBAC Rollar", desc: "5 sistem rolu + custom, modul icazələri", color: SECONDARY },
    { title: "API Keys", desc: "Xarici sistemlər üçün, scope-based", color: ACCENT },
    { title: "Webhooks", desc: "Zapier, n8n, Make.com inteqrasiya", color: SUCCESS },
    { title: "Audit Log", desc: "Bütün əməliyyatların tarixçəsi", color: WARNING },
    { title: "Custom Fields", desc: "İstənilən entity-yə əlavə sahələr", color: PINK },
    { title: "Çoxvalyutalı", desc: "Çoxvalyutalı dəstək, məzənnə idarəsi", color: ORANGE },
    { title: "Çoxdilli", desc: "AZ, RU, EN interfeys", color: PRIMARY },
    { title: "Müştəri Portalı", desc: "Tiketlər, KB, AI chat", color: SECONDARY },
    { title: "PWA", desc: "Mobil home screen, offline", color: ACCENT },
    { title: "Bildirişlər", desc: "Real-time, SLA alertlər", color: DANGER },
    { title: "Google Calendar", desc: "Təqvim sinxronizasiyası", color: SUCCESS },
  ]
  for (let i = 0; i < items.length; i++) {
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = 0.5 + col * 3.2
    const y = 1.5 + row * 1.1
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.0, h: 0.9, fill: { color: WHITE }, rectRadius: 0.08, shadow: { type: "outer", blur: 4, offset: 1, color: "000000", opacity: 0.04 } })
    slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.12, y: y + 0.15, w: 0.45, h: 0.45, fill: { color: items[i].color }, rectRadius: 0.1 })
    slide.addText(items[i].title, { x: x + 0.7, y: y + 0.08, w: 2.15, h: 0.3, fontSize: 10, color: DARK, fontFace: "Arial", bold: true })
    slide.addText(items[i].desc, { x: x + 0.7, y: y + 0.4, w: 2.15, h: 0.3, fontSize: 8.5, color: MUTED, fontFace: "Arial" })
  }

  // Screenshots at bottom
  addScreenshot(slide, "budgeting", 0.4, 4.95, 6.3, 2.35)
  addScreenshot(slide, "segments", 6.85, 4.95, 6.1, 2.35)
}

// ═══════════════════════════════════════════════════
// SLIDE 12: Pricing — REAL prices
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: PRIMARY }
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.5, w: 13.33, h: 4.0, fill: { color: SECONDARY, transparency: 50 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: -2, y: 5, w: 5, h: 5, fill: { color: WHITE, transparency: 92 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: 10, y: -1, w: 5, h: 5, fill: { color: WHITE, transparency: 92 } })

  slide.addText("Qiymətləndirmə", {
    x: 0.8, y: 0.35, w: 12, h: 0.6, fontSize: 30, color: WHITE, fontFace: "Arial", bold: true, align: "center",
  })
  slide.addText("Bütün funksionallıq daxildir. Limitsiz modullar.", {
    x: 0.8, y: 0.95, w: 12, h: 0.35, fontSize: 13, color: WHITE, fontFace: "Arial", align: "center", transparency: 20,
  })

  const plans = [
    {
      name: "Starter", users: "1–5 istifadəçi", price: "49", period: "AZN / ay / istifadəçi",
      features: ["CRM & Satış", "Marketinq", "Dəstək & Tiketlər", "Inbox (bütün kanallar)", "AI Lid Skorinq", "5 GB yaddaş", "Email dəstək"],
      color: ACCENT, bg: WHITE, tc: DARK,
    },
    {
      name: "Business", users: "6–25 istifadəçi", price: "89", period: "AZN / ay / istifadəçi",
      features: ["Starter-dəki hər şey +", "Maliyyə modulu", "Büdcələmə & Rentabellik", "Workflow Engine", "API & Webhooks", "Custom Fields", "Audit Log", "Prioritet dəstək"],
      color: SECONDARY, bg: DARK, tc: WHITE, highlight: true,
    },
    {
      name: "Enterprise", users: "25+ istifadəçi", price: "149", period: "AZN / ay / istifadəçi",
      features: ["Business-dəki hər şey +", "SSO / OAuth", "Da Vinci AI Agentlər", "Proqnozlaşdırma", "Field Permissions", "Müştəri Portalı", "Dedicated Manager", "SLA Zəmanəti"],
      color: SUCCESS, bg: WHITE, tc: DARK,
    },
  ]

  for (let i = 0; i < plans.length; i++) {
    const x = 0.8 + i * 4.1
    const isHl = plans[i].highlight
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 1.55, w: 3.7, h: 5.5, fill: { color: plans[i].bg }, rectRadius: 0.15,
      shadow: { type: "outer", blur: 12, offset: 4, color: "000000", opacity: 0.2 },
    })
    if (isHl) {
      slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.9, y: 1.35, w: 1.9, h: 0.38, fill: { color: SECONDARY }, rectRadius: 0.19 })
      slide.addText("ƏN POPULYAR", { x: x + 0.9, y: 1.35, w: 1.9, h: 0.38, fontSize: 9.5, color: WHITE, fontFace: "Arial", bold: true, align: "center", valign: "middle" })
    }
    slide.addShape(pptx.ShapeType.rect, { x, y: 1.55, w: 3.7, h: 0.06, fill: { color: plans[i].color } })
    slide.addText(plans[i].name, { x: x + 0.3, y: 1.85, w: 3.1, h: 0.42, fontSize: 20, color: plans[i].color, fontFace: "Arial", bold: true })
    slide.addText(plans[i].users, { x: x + 0.3, y: 2.28, w: 3.1, h: 0.28, fontSize: 11, color: isHl ? "94A3B8" : MUTED, fontFace: "Arial" })
    slide.addText(plans[i].price, { x: x + 0.3, y: 2.65, w: 1.5, h: 0.6, fontSize: 34, color: plans[i].tc, fontFace: "Arial", bold: true })
    slide.addText(plans[i].period, { x: x + 1.5, y: 2.9, w: 2.0, h: 0.28, fontSize: 10, color: isHl ? "94A3B8" : MUTED, fontFace: "Arial" })
    slide.addShape(pptx.ShapeType.rect, { x: x + 0.3, y: 3.4, w: 3.1, h: 0.01, fill: { color: isHl ? "2A3550" : "E2E8F0" } })
    for (let f = 0; f < plans[i].features.length; f++) {
      slide.addText(`✓  ${plans[i].features[f]}`, { x: x + 0.3, y: 3.55 + f * 0.38, w: 3.1, h: 0.35, fontSize: 10, color: plans[i].tc, fontFace: "Arial" })
    }
  }
}

// ═══════════════════════════════════════════════════
// SLIDE 13: Contact / CTA
// ═══════════════════════════════════════════════════
{
  const slide = pptx.addSlide()
  slide.background = { fill: PRIMARY }
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 3.5, w: 13.33, h: 4.0, fill: { color: SECONDARY, transparency: 50 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: -3, y: 2, w: 8, h: 8, fill: { color: WHITE, transparency: 93 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: 9, y: -2, w: 7, h: 7, fill: { color: ACCENT, transparency: 88 } })

  slide.addText("Bizimlə Əlaqə", {
    x: 0.8, y: 1.0, w: 12, h: 0.8, fontSize: 40, color: WHITE, fontFace: "Arial", bold: true, align: "center",
  })
  slide.addText("LeadDrive CRM ilə biznesinizi növbəti səviyyəyə çatdırın", {
    x: 0.8, y: 1.85, w: 12, h: 0.4, fontSize: 16, color: WHITE, fontFace: "Arial", align: "center", transparency: 15,
  })
  // Enhanced CTA message
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 2.5, y: 2.4, w: 8.33, h: 0.55, fill: { color: WHITE, transparency: 85 }, rectRadius: 0.27,
  })
  slide.addText("Sifarişi fərdiləşdirmək üçün bu gün bizimlə əlaqə saxlayın", {
    x: 2.5, y: 2.4, w: 8.33, h: 0.55, fontSize: 13, color: WHITE, fontFace: "Arial", bold: true, align: "center", valign: "middle",
  })

  const contacts = [
    { icon: "🌐", label: "Sayt", value: "leaddrivecrm.org", color: PRIMARY },
    { icon: "📧", label: "E-poçt", value: "info@leaddrivecrm.org", color: SECONDARY },
    { icon: "📱", label: "Telefon", value: "+994 50 200 12 34", color: ACCENT },
    { icon: "📍", label: "Ünvan", value: "Bakı, Azərbaycan", color: SUCCESS },
  ]
  for (let i = 0; i < contacts.length; i++) {
    const x = 1.2 + i * 2.9
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 3.3, w: 2.5, h: 2.0, fill: { color: WHITE }, rectRadius: 0.15,
      shadow: { type: "outer", blur: 10, offset: 3, color: "000000", opacity: 0.15 },
    })
    slide.addShape(pptx.ShapeType.ellipse, { x: x + 0.85, y: 3.5, w: 0.8, h: 0.8, fill: { color: contacts[i].color } })
    slide.addText(contacts[i].icon, { x: x + 0.85, y: 3.5, w: 0.8, h: 0.8, fontSize: 18, fontFace: "Arial", align: "center", valign: "middle" })
    slide.addText(contacts[i].label, { x, y: 4.4, w: 2.5, h: 0.3, fontSize: 10, color: MUTED, fontFace: "Arial", align: "center" })
    slide.addText(contacts[i].value, { x, y: 4.7, w: 2.5, h: 0.35, fontSize: 12, color: DARK, fontFace: "Arial", align: "center", bold: true })
  }

  slide.addShape(pptx.ShapeType.roundRect, { x: 4.2, y: 5.8, w: 5.0, h: 0.7, fill: { color: WHITE }, rectRadius: 0.35 })
  slide.addText("Demo Sifariş Edin  →", { x: 4.2, y: 5.8, w: 5.0, h: 0.7, fontSize: 18, color: PRIMARY, fontFace: "Arial", bold: true, align: "center", valign: "middle" })
  slide.addText("© 2026 Fanumsec MMC  |  Bakı, Azərbaycan  |  Bütün hüquqlar qorunur", {
    x: 0.8, y: 6.9, w: 12, h: 0.3, fontSize: 10, color: WHITE, fontFace: "Arial", align: "center", transparency: 30,
  })
}

// ═══════════════════════════════════════════════════
const outPath = "docs/LeadDrive_CRM_Təklif.pptx"

if (missingShots.length > 0) {
  console.error(
    `\n✖ Refusing to write ${outPath}: ${missingShots.length} screenshot(s) are absent:\n` +
      missingShots.map((n) => `    ${n}.png`).join("\n") +
      "\n\nThey were withdrawn for showing fabricated contracts and contacts\n" +
      "attributed to real companies — see docs/isms/evidence/\n" +
      "2026-08-31-marketing-screenshots-data-exposure.md §3.\n\n" +
      "Re-shoot them against a seeded demo tenant, or drop the slides that\n" +
      "use them. Do not ship a deck with holes where the evidence should be.\n",
  )
  process.exit(1)
}

await pptx.writeFile({ fileName: outPath })
console.log(`✅ PPTX created: ${outPath} (${pptx.slides.length} slides)`)
