#!/usr/bin/env node
/**
 * scripts/seeds/inbox-reel-demo.mjs
 * =====================================================================
 * Fills the DEMO tenant's Omni-channel Inbox for the marketing reel
 * (docs/omnichannel-reel-scenario.md): fictional Azerbaijani conversations
 * across WhatsApp, Telegram, TikTok, SMS, e-mail, VoIP and web chat, a team of
 * agents, chatbot rules with the org-level auto-reply switched on, and 30 days
 * of history so /inbox/analytics shows fast first replies and a small backlog.
 *
 * Everything is invented: the brand «Demo Mebel», every name, the .example
 * e-mail domain and the +994 50 555 01xx numbers. Never point this at a real
 * customer's tenant — the slug allow-list below refuses anything but "demo".
 *
 * Idempotent: every row it owns is tagged (conversation externalId "reel-…",
 * message metadata.seed, web-chat visitorEmail @demo-mebel.example) and is
 * deleted and recreated on each run, so re-running just before a recording
 * moves the "night" conversation to today 02:14 Baku time. Rows it does not
 * own are never touched.
 *
 *   CONFIRM_PROD=1 DATABASE_URL=… node scripts/seeds/inbox-reel-demo.mjs --slug=demo
 * =====================================================================
 */
import crypto from "node:crypto"
import bcrypt from "bcryptjs"
import { makeScriptPrisma } from "../_rls.mjs"

const ALLOWED_SLUGS = new Set(["demo"])
const SEED_TAG = "omnichannel-reel"
const MAIL_DOMAIN = "demo-mebel.example"

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=")
const slug = arg("slug") || "demo"
if (!ALLOWED_SLUGS.has(slug)) {
  console.error(`FATAL: slug "${slug}" is not an allowed demo tenant (${[...ALLOWED_SLUGS].join(", ")})`)
  process.exit(1)
}
const dbUrl = process.env.DATABASE_URL || ""
const isLocalDb = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
if (!isLocalDb && process.env.CONFIRM_PROD !== "1") {
  console.error("FATAL: non-local DATABASE_URL — set CONFIRM_PROD=1 to seed the demo tenant")
  process.exit(1)
}

// ── Time: Baku is UTC+4 all year. The hero message lands at 02:14 Baku today
// (yesterday if it is not 02:30 yet), and every other thread is older, so the
// hero is always the first row of the list.
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const BAKU = 4 * HOUR
const nowMs = Date.now()
const bakuNow = new Date(nowMs + BAKU)
let heroMs = Date.UTC(bakuNow.getUTCFullYear(), bakuNow.getUTCMonth(), bakuNow.getUTCDate(), 2, 14) - BAKU
if (heroMs > nowMs - 15 * MIN) heroMs -= DAY
const at = (ms) => new Date(ms)

// ── Cast ───────────────────────────────────────────────────────────────────
const AGENTS = [
  { key: "aynur", name: "Aynur Həsənli", role: "sales", department: "Satış" },
  { key: "orxan", name: "Orxan Quliyev", role: "support", department: "Müştəri xidməti" },
  { key: "sebine", name: "Səbinə Rzayeva", role: "manager", department: "Satış" },
  { key: "tural", name: "Tural Kərimov", role: "sales", department: "Satış" },
]

const CUSTOMERS = [
  "Nərmin Əliyeva", "Rauf Məmmədli", "Günel Səfərova", "Elçin Hüseynov", "Lalə Qasımova",
  "Kənan İsmayılov", "Aysu Nəbiyeva", "Fuad Abbasov", "Sevinc Bağırova", "Emin Cəfərov",
  "Nigar Vəliyeva", "Vüsal Əsgərov", "Ülviyyə Kazımova", "Samir Babayev", "Aytən Mirzəyeva",
  "Ramil Nağıyev", "Könül Paşayeva", "Tərlan Rüstəmov", "Şəbnəm Həsənova", "Orxan Sadıqov",
  "Xədicə Əhmədova", "Murad Zeynalov", "Gülnar İbrahimova", "Elvin Rəhimov", "Səidə Quliyeva",
]

// One entry per thread. `ago` = minutes before the hero message the first
// customer message arrived; `reply` = minutes to the first answer; `by` = who
// answered ("ai" = chatbot/AI auto-reply, agent key = a person); `state`
// open|resolved|snoozed; `assign` = agent key or null.
const THREADS = [
  // The hero — 02:14 at night, still waiting: the reel opens it, asks the AI
  // for a reply, opens the assignee picker and the lead dialog.
  { ch: "whatsapp", who: 0, ago: 0, hero: true, state: "open", assign: null, msgs: [
    ["in", "Salam, kimsə var? 🙂 «Bakı» künc divanı hələ satışdadır? Bu həftə Xırdalana çatdırmaq olar?"],
  ] },
  { ch: "whatsapp", who: 1, ago: 95, reply: 1, by: "ai", state: "resolved", assign: null, msgs: [
    ["in", "Axşamınız xeyir. Sabah neçədə açılırsınız?"],
    ["out", "Axşamınız xeyir! Mağazamız hər gün 10:00–20:00 işləyir, sifarişi isə indi də saytda və ya burada qeyd edə bilərsiniz."],
    ["in", "Təşəkkürlər!"],
  ] },
  { ch: "telegram", who: 2, ago: 180, reply: 1, by: "ai", state: "resolved", assign: null, msgs: [
    ["in", "Hissə-hissə ödəniş varmı?"],
    ["out", "Bəli, 12 aya qədər faizsiz hissə-hissə ödəniş mümkündür. Menecerimiz səhər sizə şərtləri göndərəcək."],
  ] },
  { ch: "tiktok", who: 3, ago: 260, reply: 2, by: "ai", state: "open", assign: "aynur", msgs: [
    ["in", "Videodakı yataq dəsti neçəyədir? Rəngi boz olsun."],
    ["out", "Salam! Boz rəngdə var. Dəqiq qiyməti və endirimi menecerimiz Aynur xanım səhər yazacaq."],
    ["in", "Oldu, gözləyirəm"],
  ] },
  { ch: "web-chat", who: 4, ago: 330, reply: 1, by: "ai", state: "resolved", assign: null, msgs: [
    ["in", "Quraşdırma pulludur?"],
    ["out", "Bakı daxilində quraşdırma pulsuzdur, çatdırılma 1–3 gün çəkir."],
  ] },
  // Yesterday's working day: people answered within minutes.
  { ch: "whatsapp", who: 5, ago: 14 * 60, reply: 3, by: "aynur", state: "resolved", assign: "aynur", outcome: "won", msgs: [
    ["in", "Salam, «Nar» mətbəx dəstinin ölçülərini göndərə bilərsiniz?"],
    ["out", "Salam, Kənan bəy! Ölçülər: 2,4 m × 0,6 m, hündürlük 2,1 m. Kataloqu da əlavə etdim."],
    ["in", "Əla, sifariş verirəm. Ünvanı yazıram."],
    ["out", "Təşəkkür edirik! Sifarişiniz qeydə alındı, çatdırılma cümə axşamı olacaq."],
  ] },
  { ch: "email", who: 6, ago: 16 * 60, reply: 6, by: "orxan", state: "resolved", assign: "orxan", subject: "Sifariş #4821 — çatdırılma tarixi", msgs: [
    ["in", "Salam, 4821 nömrəli sifarişimin çatdırılma tarixini dəyişmək istəyirəm — şənbə günü evdə olmayacağam."],
    ["out", "Salam, Aysu xanım! Çatdırılmanı bazar gününə, 12:00–15:00 arasına keçirdik. Kuryer bir saat əvvəl zəng edəcək."],
  ] },
  { ch: "telegram", who: 7, ago: 17 * 60, reply: 2, by: "tural", state: "resolved", assign: "tural", outcome: "won", msgs: [
    ["in", "Ofis üçün 12 kreslo lazımdır, korporativ endirim olur?"],
    ["out", "Salam, Fuad bəy! Bəli, 10 ədəddən yuxarı sifarişdə korporativ qiymət tətbiq olunur. Kommersiya təklifini e-poçtla göndərirəm."],
    ["in", "Təklif gəldi, razıyıq."],
  ] },
  { ch: "sms", who: 8, ago: 18 * 60, reply: 4, by: "orxan", state: "resolved", assign: "orxan", msgs: [
    ["in", "Sifarişim yoldadır?"],
    ["out", "Bəli, Sevinc xanım, kuryer 14:00-da ünvanınızda olacaq."],
  ] },
  { ch: "voip", who: 9, ago: 19 * 60, reply: 0, by: "sebine", state: "resolved", assign: "sebine", msgs: [
    ["in", "Gələn zəng — 3 dəq 12 san"],
    ["out", "Zəng cavablandı: Səbinə Rzayeva. Müştəri divanın rəng seçimini soruşdu, nümunələr WhatsApp-a göndərildi."],
  ] },
  { ch: "whatsapp", who: 10, ago: 20 * 60, reply: 2, by: "aynur", state: "open", assign: "aynur", msgs: [
    ["in", "Salam, çarpayının döşəyi ayrıca satılır?"],
    ["out", "Salam, Nigar xanım! Bəli, ortopedik döşəklər 160×200 və 180×200 ölçüdə var."],
    ["in", "180×200 üçün qiymət deyə bilərsiniz?"],
  ] },
  { ch: "web-chat", who: 11, ago: 21 * 60, reply: 1, by: "ai", state: "resolved", assign: null, msgs: [
    ["in", "Mağazanız harada yerləşir?"],
    ["out", "Onlayn mağazayıq, sərgi salonumuz isə Nərimanov rayonundadır — ünvanı xəritə ilə göndərirəm."],
  ] },
  { ch: "tiktok", who: 12, ago: 22 * 60, reply: 3, by: "ai", state: "resolved", assign: null, msgs: [
    ["in", "Bu stolun rəngi başqa olur?"],
    ["out", "Bəli! Ağ, qoz və qrafit rəngləri var. Hansını göndərək?"],
    ["in", "Qoz"],
    ["out", "Qeyd etdik — menecer sifarişi təsdiqləmək üçün yazacaq."],
  ] },
  { ch: "email", who: 13, ago: 26 * 60, reply: 9, by: "sebine", state: "resolved", assign: "sebine", escalated: true, subject: "Zədələnmiş qapaq", msgs: [
    ["in", "Dünən gələn şkafın bir qapağı cızılıb. Şəkli əlavə edirəm."],
    ["out", "Samir bəy, üzr istəyirik! Yeni qapağı sabah pulsuz dəyişəcəyik, usta 11:00-da gələcək."],
  ] },
  { ch: "whatsapp", who: 14, ago: 30 * 60, reply: 1, by: "ai", state: "snoozed", assign: "tural", msgs: [
    ["in", "Maaş gələndə sifariş verəcəm, divanı saxlaya bilərsiniz?"],
    ["out", "Əlbəttə! 5 günlük rezerv qeyd etdik, menecerimiz sizə xatırladacaq."],
  ] },
  // Older history for the 30-day analytics.
  ...Array.from({ length: 10 }, (_, i) => {
    const ch = ["whatsapp", "telegram", "tiktok", "sms", "email", "whatsapp", "web-chat", "telegram", "whatsapp", "voip"][i]
    const aiDone = i % 3 === 0
    const agent = ["aynur", "orxan", "tural", "sebine"][i % 4]
    return {
      ch, who: 15 + i, ago: (2 + i * 2.6) * DAY / MIN, reply: aiDone ? 1 : 2 + (i % 5), by: aiDone ? "ai" : agent,
      state: "resolved", assign: aiDone ? null : agent, outcome: i % 4 === 1 ? "won" : undefined,
      subject: ch === "email" ? "Kataloq sorğusu" : undefined,
      msgs: ch === "voip"
        ? [["in", "Gələn zəng — 1 dəq 48 san"], ["out", "Zəng cavablandı: sifarişin statusu deyildi."]]
        : [
            ["in", ["Çatdırılma neçə gündür?", "Kataloqu göndərə bilərsiniz?", "Endirim nə vaxta qədərdir?", "Sifarişimi dəyişmək olar?", "Rəng nümunələri var?"][i % 5]],
            ["out", ["Bakı daxilində 1–3 gün.", "Kataloqu əlavə etdik.", "Endirim ayın sonuna qədər qüvvədədir.", "Bəli, dəyişikliyi qeyd etdik.", "Bəli, nümunələri göndəririk."][i % 5]],
          ],
    }
  }),
]

const RULES = [
  { name: "Çatdırılma sualları", triggerValue: "çatdırılma,çatdırma,dostavka,neçə günə", responseText: "Bakı daxilində çatdırılma 1–3 gün çəkir, quraşdırma pulsuzdur. Sifariş nömrənizi yazsanız, dəqiq tarixi deyərik.", channelTypes: [], priority: 10, matchCount: 184 },
  { name: "İş saatları", triggerValue: "saat,açıqsınız,iş vaxtı,neçədə", responseText: "Mağazamız hər gün 10:00–20:00 işləyir. Sualınızı indi də yaza bilərsiniz — cavab verəcəyik.", channelTypes: [], priority: 20, matchCount: 97 },
  { name: "Hissə-hissə ödəniş", triggerValue: "kredit,taksit,hissə,faizsiz", responseText: "12 aya qədər faizsiz hissə-hissə ödəniş mümkündür. Menecerimiz şərtləri sizə göndərəcək.", channelTypes: [], priority: 30, matchCount: 61 },
  { name: "Qiymət sorğusu", triggerValue: "qiymət,neçəyə,dəyər,endirim", responseText: "Təşəkkür edirik! Dəqiq qiyməti və aktual endirimi menecerimiz iş saatlarında yazacaq.", channelTypes: ["whatsapp", "telegram", "tiktok"], priority: 40, matchCount: 142 },
]

const prisma = await makeScriptPrisma()
try {
  const org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) throw new Error(`organization "${slug}" not found`)
  if (!/demo/i.test(org.name)) throw new Error(`organization "${slug}" is named "${org.name}" — refusing: not a demo tenant`)
  const orgId = org.id
  console.log(`▶ seeding Omni-channel reel data into ${org.name} (${slug})`)

  // ── Agents (no usable password: a random bcrypt hash nobody knows) ─────────
  const agentIds = {}
  for (const a of AGENTS) {
    const email = `${a.key}@${MAIL_DOMAIN}`
    const existing = await prisma.user.findFirst({ where: { organizationId: orgId, email } })
    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { name: a.name, role: a.role, department: a.department, isActive: true } })
      : await prisma.user.create({ data: {
          organizationId: orgId, email, name: a.name, role: a.role, department: a.department, isActive: true,
          passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12),
        } })
    agentIds[a.key] = user.id
  }
  const agentName = (key) => AGENTS.find((a) => a.key === key)?.name
  console.log(`  agents: ${AGENTS.length}`)

  // ── Reset what this seed owns ─────────────────────────────────────────────
  const oldConvs = await prisma.socialConversation.findMany({
    where: { organizationId: orgId, externalId: { startsWith: "reel-" } }, select: { id: true },
  })
  const oldIds = oldConvs.map((c) => c.id)
  const delMsgs = await prisma.channelMessage.deleteMany({
    where: { organizationId: orgId, OR: [{ conversationId: { in: oldIds } }, { metadata: { path: ["seed"], equals: SEED_TAG } }] },
  })
  const delConvs = await prisma.socialConversation.deleteMany({ where: { id: { in: oldIds } } })
  const oldSessions = await prisma.webChatSession.findMany({
    where: { organizationId: orgId, visitorEmail: { endsWith: `@${MAIL_DOMAIN}` } }, select: { id: true },
  })
  await prisma.webChatMessage.deleteMany({ where: { organizationId: orgId, sessionId: { in: oldSessions.map((s) => s.id) } } })
  const delSessions = await prisma.webChatSession.deleteMany({ where: { id: { in: oldSessions.map((s) => s.id) } } })
  console.log(`  reset: ${delConvs.count} conversations, ${delMsgs.count} messages, ${delSessions.count} web-chat sessions`)

  // ── Threads ───────────────────────────────────────────────────────────────
  const BUSINESS = { whatsapp: "+994 50 555 0100", sms: "+994 50 555 0100", voip: "+994 12 555 0100", telegram: "@demomebel_bot", tiktok: "@demomebel", email: `salam@${MAIL_DOMAIN}` }
  let nConv = 0; let nMsg = 0; let nWeb = 0
  for (const [idx, t] of THREADS.entries()) {
    const name = CUSTOMERS[t.who]
    const phone = `+994 50 555 01${String(10 + t.who).padStart(2, "0")}`
    const email = `${name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}${t.who}@${MAIL_DOMAIN}`
    const handle = `${email.split("@")[0]}`
    const start = heroMs - t.ago * MIN
    // Message times: first inbound at `start`, first reply `reply` minutes
    // later, the rest a few minutes apart.
    const times = t.msgs.map((_, i) => start + (i === 0 ? 0 : (t.reply ?? 2) * MIN + (i - 1) * 4 * MIN))
    const lastAt = times[times.length - 1]
    const resolved = t.state === "resolved"
    const closedAt = resolved ? lastAt + 10 * MIN : null

    if (t.ch === "web-chat") {
      const session = await prisma.webChatSession.create({ data: {
        organizationId: orgId, visitorName: name, visitorEmail: email,
        status: resolved ? "closed" : "open", assignedUserId: t.assign ? agentIds[t.assign] : null,
        closedAt: closedAt ? at(closedAt) : null, lastMessageAt: at(lastAt), createdAt: at(start),
      } })
      for (const [i, [dir, text]] of t.msgs.entries()) {
        const bot = dir === "out" && t.by === "ai"
        await prisma.webChatMessage.create({ data: {
          organizationId: orgId, sessionId: session.id, text, createdAt: at(times[i]),
          fromRole: dir === "in" ? "visitor" : bot ? "bot" : "agent",
          authorUserId: dir === "out" && !bot ? agentIds[t.by] : null,
          metadata: bot ? { aiGenerated: true, seed: SEED_TAG } : { seed: SEED_TAG },
        } })
      }
      nWeb += 1
      continue
    }

    const contact = await prisma.contact.findFirst({ where: { organizationId: orgId, fullName: name } })
      || await prisma.contact.create({ data: { organizationId: orgId, fullName: name, phone, email, source: t.ch } })
    const conv = await prisma.socialConversation.create({ data: {
      organizationId: orgId, platform: t.ch, externalId: `reel-${String(idx).padStart(2, "0")}-${t.ch}`,
      contactId: contact.id, contactName: name, status: resolved ? "resolved" : "open",
      closedAt: closedAt ? at(closedAt) : null, closeOutcome: resolved ? (t.outcome || "none") : null,
      assignedTo: t.assign ? agentIds[t.assign] : null,
      snoozedUntil: t.state === "snoozed" ? at(nowMs + 3 * DAY) : null,
      lastMessage: t.msgs[t.msgs.length - 1][1], lastMessageAt: at(lastAt),
      unreadCount: t.msgs[t.msgs.length - 1][0] === "in" ? 1 : 0,
      createdAt: at(start),
      metadata: { seed: SEED_TAG },
    } })
    nConv += 1
    const customerAddr = t.ch === "email" ? email : t.ch === "telegram" || t.ch === "tiktok" ? `@${handle}` : phone
    for (const [i, [dir, body]] of t.msgs.entries()) {
      const inbound = dir === "in"
      const ai = !inbound && t.by === "ai"
      const agentKey = !inbound && !ai ? t.by : null
      const isLast = i === t.msgs.length - 1
      await prisma.channelMessage.create({ data: {
        organizationId: orgId, conversationId: conv.id, contactId: contact.id, channelType: t.ch,
        direction: inbound ? "inbound" : "outbound",
        from: inbound ? customerAddr : BUSINESS[t.ch], to: inbound ? BUSINESS[t.ch] : customerAddr,
        subject: t.subject ? (i === 0 ? t.subject : `Re: ${t.subject}`) : null,
        body,
        // Everything answered has been read; the last inbound of an open thread is still unread.
        status: inbound ? (isLast && !resolved ? "delivered" : "read") : (i % 3 === 0 ? "delivered" : "read"),
        createdAt: at(times[i]),
        metadata: {
          seed: SEED_TAG,
          ...(t.ch === "whatsapp" ? { waPhone: phone.replace(/\D/g, "") } : {}),
          ...(t.ch === "telegram" ? { chatId: `reel-${t.who}` } : {}),
          ...(ai ? { aiAutoReply: true, autoReply: true, authorType: "ai" } : {}),
          ...(agentKey ? { authorType: "operator", authorUserId: agentIds[agentKey], authorName: agentName(agentKey), sentVia: "leaddrive_inbox" } : {}),
          ...(t.escalated && inbound && i === 0 ? { escalated: true } : {}),
        },
      } })
      nMsg += 1
    }
  }
  console.log(`  conversations: ${nConv} (+${nWeb} web-chat), messages: ${nMsg}`)

  // ── Chatbot rules + org-level auto-reply switch ───────────────────────────
  for (const r of RULES) {
    const existing = await prisma.chatbotRule.findFirst({ where: { organizationId: orgId, name: r.name } })
    const data = { ...r, triggerType: "contains", status: "active" }
    if (existing) await prisma.chatbotRule.update({ where: { id: existing.id }, data })
    else await prisma.chatbotRule.create({ data: { ...data, organizationId: orgId } })
  }
  const raw = org.features
  const features = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw || "[]") : []
  if (!features.includes("chatbotAutoReply")) {
    await prisma.organization.update({ where: { id: orgId }, data: { features: [...features, "chatbotAutoReply"] } })
  }
  console.log(`  chatbot rules: ${RULES.length} active, auto-reply on`)
  console.log(`✔ done — hero thread at ${new Date(heroMs).toISOString()} (02:14 Baku)`)
} finally {
  await prisma.$disconnect()
}
