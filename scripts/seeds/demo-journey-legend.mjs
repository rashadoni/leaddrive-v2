// Legend for the demo stand the guided demo's intro clips are filmed on
// (scripts/seeds/demo-journey-clips.mjs). Pure data, no side effects: the
// seeder writes it, the rescorer reads the lead names from it, and a test
// reads it for real brands.
//
// Everything here is invented. The brand is the Omni-channel reel's «Demo
// Mebel», an online furniture shop in Baku; the four companies are the
// product-tour legend's (scripts/seeds/tour-legend.mjs), already checked to be
// free of real brands; every person's name is new and differs from the reel's
// cast. No phone numbers at all, e-mail only on a reserved `.example` domain.
// Numbers are deliberately not round — a round number reads as a placeholder.

import { COMPANIES } from "./tour-legend.mjs"

const DAY = 24 * 60 * 60_000
const nowMs = Date.now()
export const daysAgo = (d) => new Date(nowMs - d * DAY)
export const inDays = (d) => new Date(nowMs + d * DAY)
// A moment on a Baku working day, `dayOffset` days from today (Asia/Baku is
// UTC+4 all year). Activities show their time of day; a call "at 21:55"
// because the seeder happened to run then reads as a made-up record.
const BAKU = 4 * 60 * 60_000
export const bakuAt = (dayOffset, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number)
  const baku = new Date(nowMs + BAKU)
  return new Date(Date.UTC(baku.getUTCFullYear(), baku.getUTCMonth(), baku.getUTCDate() + dayOffset, h, m) - BAKU)
}

// The reel's team (scripts/seeds/inbox-reel-demo.mjs); looked up by name and
// left unassigned if that seed has not run.
export const TEAM = { aynur: "Aynur Həsənli", tural: "Tural Kərimov", sebine: "Səbinə Rzayeva" }
const company = (i) => COMPANIES[i].name
export const MAIL = "demo-journey.example"

// Sent campaigns carry only the numbers the product itself records, so the
// stand never looks better than a real tenant (src/lib/campaigns/analytics.ts):
// opens, clicks and bounces exist for email alone (bounces arrive through the
// Resend webhook), and unsubscribes are the recipients the send skipped. Nothing is left in a
// state some worker would pick up and send ("sending", "ab_testing").
export const CAMPAIGNS = [
  {
    name: "Payız kolleksiyası — divan və kreslolar",
    description: "Yeni divan və kreslo modelləri, 12 aya qədər hissə-hissə ödəniş.",
    type: "email", status: "sent", subject: "Payız kolleksiyası gəldi: divanlara 12 ay hissə-hissə ödəniş",
    totalRecipients: 1847, totalSent: 1829, totalOpened: 763, totalClicked: 214, totalBounced: 18, totalUnsubscribed: 7,
    budget: 340, actualCost: 318, sentAt: daysAgo(16), createdAt: daysAgo(19),
  },
  {
    name: "WhatsApp: «Nar» mətbəx dəstinin təqdimatı",
    description: "Mətbəx mebeli soruşan müştərilərə yeni dəstin şəkilləri və ölçüləri.",
    type: "whatsapp", status: "sent",
    totalRecipients: 612, totalSent: 603,
    budget: 185, actualCost: 172, sentAt: daysAgo(11), createdAt: daysAgo(13),
  },
  {
    name: "SMS: həftəsonu sərgi salonunda endirim",
    description: "Nərimanovdakı sərgi salonuna dəvət, şənbə və bazar günü.",
    type: "sms", status: "sent",
    totalRecipients: 2314, totalSent: 2291,
    budget: 229, actualCost: 211, sentAt: daysAgo(6), createdAt: daysAgo(7),
  },
  {
    name: "Telegram: ofis mebeli kataloqu",
    description: "Korporativ müştərilər üçün iş masaları, kreslolar və arxiv şkafları.",
    type: "telegram", status: "scheduled",
    totalRecipients: 386, budget: 64, scheduledAt: inDays(2), createdAt: daysAgo(3),
  },
  {
    name: "Yeni il: yataq otağı dəstləri",
    description: "Qaralama — mətn və seqment hələ razılaşdırılır.",
    type: "email", status: "draft", subject: "Yeni ilə yeni yataq otağı ilə",
    budget: 410, createdAt: daysAgo(1),
  },
  {
    name: "SMS: köhnə müştərilərə geri dönüş",
    description: "Seqment çox geniş çıxdı, kampaniya dayandırıldı.",
    type: "sms", status: "cancelled",
    totalRecipients: 947, budget: 118, createdAt: daysAgo(9),
  },
]

// What the product scores on (src/lib/ai/lead-scoring.ts): how to reach them,
// whether they said what they want, what the salesperson concluded. The
// statuses spread across the board's columns.
export const LEADS = [
  {
    contactName: "Leyla Məmmədova", companyName: company(0), email: `leyla.m@${MAIL}`, source: "website",
    status: "qualified", customerStage: "interested", category: "vip", priority: "high", assign: "tural", estimatedValue: 8740,
    interest: "Anbar ofisi üçün 14 iş yeri: masa, kreslo və arxiv şkafları, quraşdırma ilə birlikdə",
    notes: "Ölçü görüşü razılaşdırılıb. Büdcə təsdiqlənib, təklif bu həftə gözlənilir.", createdDays: 9,
    activities: [
      { type: "call", subject: "Tanışlıq zəngi", description: "Ehtiyacı dəqiqləşdirdik: 14 iş yeri, quraşdırma ilə.", days: 8, at: "11:20" },
      { type: "email", subject: "Kataloq göndərildi", description: "Ofis mebeli kataloqu və qiymət aralığı.", days: 6, at: "15:05" },
      { type: "meeting", subject: "Anbar ofisində ölçü görüşü", description: "Tural Kərimov ofisə baxıb ölçüləri götürəcək.", days: 2, at: "16:40", planned: [1, "11:30"] },
    ],
  },
  {
    contactName: "Nigar Əliyeva", companyName: company(2), email: `nigar@${MAIL}`, source: "instagram",
    status: "qualified", customerStage: "potential", category: "prospect", priority: "high", assign: "sebine", estimatedValue: 5960,
    interest: "Dizayn studiyası üçün 8 iş masası və görüş otağı mebeli", createdDays: 12,
    activities: [{ type: "call", subject: "Studiyanın planı soruşuldu", description: "Plan e-poçtla gələcək.", days: 5, at: "12:45" }],
  },
  {
    contactName: "Rəşad Hüseynov", companyName: company(1), email: `resad.h@${MAIL}`, source: "referral",
    status: "contacted", customerStage: "sales_contacted", category: "partner", priority: "medium", assign: "sebine", estimatedValue: 4380,
    interest: "Kassa zonası üçün rəflər", createdDays: 6,
  },
  {
    contactName: "Tural Səfərov", companyName: company(3), email: `tural.s@${MAIL}`, source: "email",
    status: "new", category: "prospect", priority: "medium", assign: "tural", estimatedValue: 3270,
    interest: "Gəncə filialı üçün ofis mebeli", createdDays: 2,
  },
  {
    contactName: "Aydan Qarayeva", email: `aydan.q@${MAIL}`, source: "instagram",
    status: "new", category: "regular", priority: "medium", assign: "aynur", estimatedValue: 2140,
    interest: "«Nar» mətbəx dəsti, ağ rəngdə", createdDays: 1,
  },
  {
    contactName: "Cavid Məlikov", email: `cavid.m@${MAIL}`, source: "whatsapp",
    status: "qualified", customerStage: "interested", category: "regular", priority: "medium", assign: "aynur", estimatedValue: 1870,
    interest: "Künc divanı, 12 aya hissə-hissə ödənişlə", notes: "Sənədləri bu gün göndərəcək — təcili.", createdDays: 5,
    activities: [{ type: "call", subject: "Hissə-hissə ödəniş şərtləri", description: "Şərtlər izah edildi, razıdır.", days: 1, at: "17:10" }],
  },
  {
    contactName: "Lamiyə Hacıyeva", email: `lamiye.h@${MAIL}`, source: "tiktok",
    status: "converted", customerStage: "interested", category: "regular", priority: "medium", assign: "tural", estimatedValue: 1460,
    interest: "Yataq dəsti, boz rəngdə", createdDays: 15, convertedDays: 8,
  },
  {
    contactName: "Pərviz Əzimov", email: `perviz.e@${MAIL}`, source: "website",
    status: "converted", customerStage: "interested", category: "regular", priority: "medium", assign: "aynur", estimatedValue: 2390,
    interest: "Künc divanı və jurnal masası", createdDays: 18, convertedDays: 11,
  },
  {
    contactName: "Sevda Musayeva", source: "tiktok",
    status: "contacted", customerStage: "no_result", category: "regular", priority: "low", assign: "aynur", estimatedValue: 690,
    interest: "Uşaq otağı üçün stol", createdDays: 3,
  },
  {
    contactName: "Zaur Novruzov", source: "cold_call",
    status: "lost", customerStage: "not_sold", category: "inactive", priority: "low", assign: "tural", estimatedValue: 1120,
    createdDays: 21,
  },
  {
    contactName: "Məryəm Kərimli", email: `meryem.k@${MAIL}`, source: "instagram",
    status: "new", category: "regular", priority: "medium", estimatedValue: 1730,
    interest: "Qonaq otağı üçün divan dəsti", createdDays: 0.3,
  },
  {
    contactName: "Elnur Bayramov", email: `elnur.b@${MAIL}`, source: "referral",
    status: "contacted", customerStage: "potential", category: "vip", priority: "high", assign: "tural", estimatedValue: 3180,
    interest: "Yeni mənzil üçün yataq otağı və qonaq otağı mebeli, dizayner məsləhəti ilə", createdDays: 4,
  },
  {
    contactName: "Fidan Ağayeva", source: "whatsapp",
    status: "new", category: "regular", priority: "medium", assign: "aynur", estimatedValue: 960,
    interest: "Ortopedik döşək 180×200", createdDays: 0.1,
  },
  {
    contactName: "Nicat Səmədov", email: `nicat.s@${MAIL}`, source: "email",
    status: "lost", customerStage: "unable_to_contact", category: "prospect", priority: "low", assign: "sebine", estimatedValue: 2610,
    createdDays: 24,
  },
]

// Two boards: the story's sales board and a marketing board beside it, so a
// clip can say "each team has its own board" and show it.
export const BOARDS = [
  { key: "SAT", name: "Satış", description: "Satış komandasının işi: təkliflər, görüşlər, sənədlər.", color: "#2563eb", sortOrder: 1, head: "sebine" },
  { key: "MRK", name: "Marketinq", description: "Kampaniyalar, kataloqlar, məzmun.", color: "#db2777", sortOrder: 2, head: "sebine" },
]
export const CANONICAL_COLUMNS = [
  ["backlog", "BACKLOG"], ["todo", "TO DO"], ["in_progress", "IN PROGRESS"],
  ["testing", "TESTING"], ["review", "REVIEW"], ["done", "DONE"],
] // src/lib/tasks/board-columns.ts — what a board created in the app gets

export const TASKS = {
  SAT: [
    { title: `${company(0)} — ofis mebeli üçün kommersiya təklifi`, status: "in_progress", priority: "high", assign: "tural", due: 2, lead: "Leyla Məmmədova",
      checklist: [["Ölçülər", true], ["Məhsul siyahısı", true], ["Endirim razılaşması", false], ["Təklifin göndərilməsi", false]] },
    { title: "Leyla Məmmədova ilə ölçü görüşü — anbar ofisi", status: "todo", priority: "high", assign: "tural", due: 1, lead: "Leyla Məmmədova" },
    { title: "Aydan Qarayeva: «Nar» dəstinin rəng nümunələrini göndərmək", status: "todo", priority: "medium", assign: "aynur", due: 1, lead: "Aydan Qarayeva" },
    { title: "Cavid Məlikov — hissə-hissə ödəniş sənədləri", status: "review", priority: "medium", assign: "aynur", due: 0, lead: "Cavid Məlikov",
      checklist: [["Şəxsiyyət vəsiqəsi", true], ["Ödəniş cədvəli", true], ["Müqavilənin imzası", false]] },
    { title: `${company(2)} — 8 iş masası, endirim razılaşması`, status: "in_progress", priority: "medium", assign: "sebine", due: 4, lead: "Nigar Əliyeva",
      checklist: [["Studiyanın planı", true], ["Masaların ölçüsü", true], ["Rəng seçimi", true], ["Endirim", false], ["Çatdırılma tarixi", false]] },
    { title: "Instagram lidlərinə 24 saat ərzində geri zəng", status: "backlog", priority: "low", assign: "aynur" },
    { title: "Lamiyə Hacıyeva — yataq dəstinin çatdırılmasını təsdiqləmək", status: "done", priority: "medium", assign: "tural", due: -1, lead: "Lamiyə Hacıyeva",
      checklist: [["Ünvan", true], ["Çatdırılma vaxtı", true]] },
    { title: `${company(3)} — Gəncə filialı üçün mebel siyahısı`, status: "backlog", priority: "medium", assign: "tural", due: 9, lead: "Tural Səfərov" },
    { title: "Pərviz Əzimov — künc divanının quraşdırma vaxtı", status: "done", priority: "low", assign: "aynur", due: -3, lead: "Pərviz Əzimov" },
    { title: "Həftəlik satış hesabatı", status: "todo", priority: "low", assign: "aynur", due: 3 },
    { title: `${company(1)} — kassa zonası üçün rəflər: ehtiyac analizi`, status: "review", priority: "critical", assign: "sebine", due: 1, lead: "Rəşad Hüseynov" },
  ],
  MRK: [
    { title: "Payız kolleksiyası — e-poçt kampaniyasının nəticələri", status: "done", priority: "medium", assign: "sebine", due: -2 },
    { title: "Telegram kataloqu üçün 24 məhsul şəkli", status: "in_progress", priority: "medium", assign: "sebine", due: 2,
      checklist: [["Divanlar", true], ["Kreslolar", true], ["Masalar", false]] },
    { title: "Yataq otağı dəstləri — WhatsApp mesaj şablonu", status: "todo", priority: "medium", assign: "sebine", due: 5 },
    { title: "Yeni il kampaniyası: büdcə planı", status: "backlog", priority: "low" },
    { title: "SMS aksiyası: linkə keçənləri seqmentə yığmaq", status: "review", priority: "high", assign: "sebine", due: 1 },
  ],
}
