#!/usr/bin/env node
/**
 * KPI Arena (/leaderboard) demo-data seeder — makes the bubble board look like a
 * live team on ALL five tabs (sales / mtm / tickets / projects / tasks) and on
 * every period switch (Gün / Həftə / Ay / Rüb / İl / Bütün vaxt).
 *
 * Usage:
 *   node scripts/seed-leaderboard-demo.mjs --org=leaddrive               # seed
 *   node scripts/seed-leaderboard-demo.mjs --org=leaddrive --dry-run     # plan only
 *   node scripts/seed-leaderboard-demo.mjs --org=leaddrive --clean-only  # remove demo rows
 *   node scripts/seed-leaderboard-demo.mjs --org=leaddrive --groups=sales,tickets
 *
 * DESIGN — why it shapes records instead of writing numbers
 * ---------------------------------------------------------
 * Every bubble's % is DERIVED by src/lib/leaderboard/*.ts from real rows. There is
 * no place to store an attainment. So for each person we pick a target % off a
 * designed ladder and then emit rows whose ratio produces that %:
 *   sales    → WON deals summing to target% of the person's quarterly quota
 *   mtm      → tasks/photos/routes whose done-ratios feed the 0.5/0.3/0.2 composite
 *   tickets  → resolved tickets, target% of them inside slaDueAt
 *   projects → completed projects, target% of them with actualEndDate ≤ endDate
 *   tasks    → completed tasks, target% of them with completedAt ≤ dueDate
 *
 * Because those are RATIOS, they hold for any period window that contains the
 * generated days — one dataset covers day/week/month/quarter/year at once.
 * Volume tapers with age so a longer window also shows a bigger raw count.
 *
 * The ladder is deliberately a realistic spread (a couple of stars, a green core,
 * a few amber, one red) so the legend's five colours all actually appear.
 *
 * IDEMPOTENT: every row carries a marker (`kpi-demo` tag / sourceKey / customFields
 * flag / id prefix). A re-run deletes the previous generation first, so running it
 * again the morning of a demo just refreshes the dates. Nothing not carrying the
 * marker is ever modified or deleted.
 *
 * RLS: writes go through a tenant-scoped client (app.org_id) per scripts/_rls.mjs.
 */
import { makeScriptPrisma } from "./_rls.mjs"

const MARK = "kpi-demo"
const ALL_GROUPS = ["sales", "mtm", "tickets", "projects", "tasks"]

// ─────────────────────────── args ───────────────────────────
function getArg(name, dflt = null) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : dflt
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const SLUG = getArg("org", "leaddrive")
const DAYS = Number(getArg("days", "45"))
const DRY = hasFlag("dry-run")
const CLEAN_ONLY = hasFlag("clean-only")
const GROUPS = (getArg("groups", ALL_GROUPS.join(",")) || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => ALL_GROUPS.includes(s))

// ─────────────────────── deterministic rng ───────────────────────
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rngFor = (key) => mulberry32(hashStr(`${MARK}:${key}`))
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length]
const between = (rnd, lo, hi) => lo + rnd() * (hi - lo)

// ─────────────────────── KPI target ladders ───────────────────────
/** Sales attainment may exceed 100 (quota over-achievement). */
const LADDER_SALES = [128, 118, 111, 104, 98, 93, 87, 79, 68, 57, 47]
/** Rate-based groups are capped at 100 by construction (SLA %, on-time %, …). */
const LADDER_RATE = [100, 97, 95, 92, 90, 86, 81, 75, 67, 58, 48]

/** Resample a ladder onto exactly n people, preserving its shape. */
function ladder(n, base) {
  if (n <= 0) return []
  if (n === 1) return [base[2]]
  const out = []
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (base.length - 1)
    const lo = Math.floor(p)
    const hi = Math.min(base.length - 1, lo + 1)
    out.push(base[lo] + (base[hi] - base[lo]) * (p - lo))
  }
  return out.map((v) => Math.round(v * 10) / 10)
}

/**
 * Per-ITEM good/bad decision (Bresenham-style) hitting `ratePct` in aggregate.
 *
 * Deciding per day instead would round a 2-3 item day to all-good or all-bad, so
 * the short windows ("Gün") showed everyone at 100% while the month showed 60%.
 * Spreading the misses evenly across items keeps every window honest.
 */
function makeRater(ratePct) {
  let acc = 0.5 // half-step start → the first item is not always the odd one out
  return () => {
    acc += ratePct / 100
    if (acc >= 1) {
      acc -= 1
      return true
    }
    return false
  }
}

// ─────────────────────── time helpers ───────────────────────
const NOW = new Date()
const HOUR = 3600_000

/** Older days carry less activity → a longer period shows a bigger raw volume. */
function density(dayIdx) {
  if (dayIdx === 0) return 1
  if (dayIdx <= 6) return 0.9
  if (dayIdx <= 13) return 0.7
  return 0.45
}
/**
 * Field/support work thins out but does not stop on weekends. Day 0 is exempt:
 * the "Gün" tab needs enough rows to express a ratio, and the demo itself may be
 * given on a Sunday.
 */
function weekendFactor(dayIdx) {
  if (dayIdx === 0) return 1
  const w = dayRef(dayIdx).getDay()
  return w === 0 || w === 6 ? 0.45 : 1
}
/** Calendar noon of `dayIdx` days ago — used only to read the weekday. */
function dayRef(dayIdx) {
  const d = new Date(NOW)
  d.setDate(d.getDate() - dayIdx)
  d.setHours(12, 0, 0, 0)
  return d
}
/**
 * A timestamp inside working hours of `dayIdx` days ago. dayIdx 0 is special:
 * the "Gün" period is a ROLLING 24h, so today's rows are spread over the trailing
 * 20 hours instead of the calendar day — that keeps them in-window (and in the
 * past) even when the script runs just after midnight.
 */
function stampFor(dayIdx, rnd) {
  if (dayIdx === 0) return new Date(NOW.getTime() - between(rnd, 0.4, 20) * HOUR)
  const d = dayRef(dayIdx)
  d.setHours(8, 0, 0, 0)
  return new Date(d.getTime() + between(rnd, 0, 11) * HOUR)
}
/** Round a per-day count with a carry so the taper is not lost to rounding. */
function makeCounter() {
  let carry = 0
  return (x) => {
    const v = x + carry
    const n = Math.max(0, Math.round(v))
    carry = v - n
    return n
  }
}

// ─────────────────────── content pools (az) ───────────────────────
const DEAL_KINDS = [
  "CRM lisenziyası",
  "illik dəstək paketi",
  "inteqrasiya layihəsi",
  "modul genişlənməsi",
  "istifadəçi lisenziyalarının artırılması",
  "təlim və miqrasiya",
  "Premium SLA paketi",
]
const TICKET_SUBJECTS = [
  "Hesabat yüklənmir",
  "İstifadəçi sisteme daxil ola bilmir",
  "E-poçt bildirişləri gecikir",
  "Sifariş statusu yenilənmir",
  "Mobil tətbiqdə sinxronizasiya xətası",
  "Qaimə PDF-i açılmır",
  "Yeni istifadəçi əlavə etmək tələbi",
  "İnteqrasiya API cavab vermir",
  "Kontaktların idxalı yarımçıq qaldı",
  "Kassa çekində məbləğ səhvdir",
]
const TICKET_CATEGORIES = ["technical", "billing", "general", "integration", "account"]
const TICKET_SOURCES = ["portal", "email", "whatsapp", "web_chat", "agent"]
const PROJECT_KINDS = [
  "CRM tətbiqi",
  "1C inteqrasiyası",
  "Anbar modulunun quraşdırılması",
  "Call-center miqrasiyası",
  "Sənəd dövriyyəsinin avtomatlaşdırılması",
  "Sahə komandası üçün mobil tətbiq",
  "Hesabat panelinin qurulması",
]
const TASK_TITLES = [
  "Müştəri ilə zəng planlaşdır",
  "Kommersiya təklifi hazırla",
  "Müqavilə şərtlərini razılaşdır",
  "Görüş qeydlərini sistemə yaz",
  "Ödəniş qrafikini yoxla",
  "Texniki tələbləri dəqiqləşdir",
  "Demo mühiti hazırla",
  "Müştəri sorğusunu cavablandır",
  "Aylıq hesabatı təqdim et",
  "Yeni lidləri paylaşdır",
]
const MTM_TASK_TITLES = [
  "Rəf düzümünü yoxla",
  "Qiymət etiketlərini yenilə",
  "Promo materialları yerləşdir",
  "Qalıq inventarını qeyd et",
  "Müştəri ilə sifarişi təsdiqlə",
  "Rəqib aksiyalarını qeyd et",
]
const VISIT_NOTES = [
  "Planlı ziyarət, sifariş qəbul edildi",
  "Rəf auditi tamamlandı",
  "Promo yerləşdirmə yoxlanıldı",
  "Yeni məhsul təqdim edildi",
]

// ─────────────────────── cleanup ───────────────────────
const CLEAN_SQL = [
  ["mtm_photos", `DELETE FROM mtm_photos WHERE "organizationId"=$1 AND "clientPhotoId" LIKE '${MARK}-%'`],
  ["mtm_tasks", `DELETE FROM mtm_tasks WHERE "organizationId"=$1 AND "sourceKey" LIKE '${MARK}%'`],
  ["mtm_visits", `DELETE FROM mtm_visits WHERE "organizationId"=$1 AND notes LIKE '[${MARK}]%'`],
  ["mtm_routes", `DELETE FROM mtm_routes WHERE "organizationId"=$1 AND "externalId" LIKE '${MARK}-%'`],
  ["tasks", `DELETE FROM tasks WHERE "organizationId"=$1 AND "customFields"->>'kpiDemo'='true'`],
  ["project_tasks", `DELETE FROM project_tasks WHERE "organizationId"=$1 AND '${MARK}' = ANY(tags)`],
  ["projects", `DELETE FROM projects WHERE "organizationId"=$1 AND '${MARK}' = ANY(tags)`],
  ["tickets", `DELETE FROM tickets WHERE "organizationId"=$1 AND '${MARK}' = ANY(tags)`],
  ["deals", `DELETE FROM deals WHERE "organizationId"=$1 AND '${MARK}' = ANY(tags)`],
]

async function clean(prisma, orgId) {
  for (const [label, sql] of CLEAN_SQL) {
    const n = await prisma.$executeRawUnsafe(sql, orgId)
    if (n > 0) console.log(`   − ${label}: ${n}`)
  }
}

// ─────────────────── won-stage spellings (mirrors the app) ───────────────────
/**
 * `Deal.stage` is a free string and one org stores several spellings of the same
 * stage — production holds `CLOSED_WON` next to `WON`. Since #767 the sales
 * aggregator counts them all via `orgStageVocabulary`, so this script has to ask
 * the same question: a literal `stage: "WON"` here would under-count what a rep
 * has already banked and make the seeder overshoot their target.
 *
 * Folding rules copied from `src/lib/deal-stage-normalization.ts` (a standalone
 * .mjs cannot import the TS module). Only the spellings actually STORED are
 * needed: a configured-but-empty won stage contributes nothing to a sum.
 */
const WON_ALIASES = new Set(["WON", "CLOSED_WON", "CLOSE_WON", "QAZANDI", "QAZANILDI", "VYIGRANO", "SUCCESS"])

function foldStage(value) {
  return value
    .trim()
    .replace(/[\u0131\u0130]/g, "i")
    .replace(/[\u0259\u018F]/g, "e")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
}

async function wonStageSpellings(prisma, orgId) {
  const stored = await prisma.deal.findMany({
    where: { organizationId: orgId },
    distinct: ["stage"],
    select: { stage: true },
  })
  const won = stored.map((d) => d.stage).filter((st) => WON_ALIASES.has(foldStage(st)))
  return won.length > 0 ? won : ["WON"]
}

// ─────────────────────── group: sales ───────────────────────
/**
 * volume = Σ WON deal value this quarter, attainment = that ÷ quarterly quota.
 * Deals already won by a rep are KEPT — we only add what is missing to reach the
 * target, and the ladder is assigned in the reps' current order so nobody's
 * target lands below what they have already booked.
 */
async function seedSales(prisma, orgId, companies, wonStages) {
  const year = NOW.getFullYear()
  const quarter = Math.floor(NOW.getMonth() / 3) + 1
  const qStart = new Date(year, (quarter - 1) * 3, 1)
  const qEnd = new Date(year, quarter * 3, 1)

  const quotas = await prisma.salesQuota.findMany({
    where: { organizationId: orgId, year, quarter, user: { isActive: true } },
    include: { user: { select: { id: true, name: true } } },
  })
  if (quotas.length === 0) {
    console.log("   ! no sales quotas for the current quarter — sales tab stays empty")
    return []
  }

  const won = await prisma.deal.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      stage: { in: wonStages },
      assignedTo: { in: quotas.map((q) => q.userId) },
      updatedAt: { gte: qStart, lt: qEnd },
      // A real run has already deleted the previous generation; excluding it here
      // too is what makes --dry-run report the same numbers the real run produces
      // (it used to count its own last output as "already booked" and plan ~10
      // deals instead of ~59).
      NOT: { tags: { has: MARK } },
    },
    _sum: { valueAmount: true },
  })
  const already = new Map(won.map((w) => [w.assignedTo, Number(w._sum.valueAmount ?? 0)]))

  const rows = quotas
    .filter((q) => q.amount > 0) // a zero quota has no meaningful attainment
    .map((q) => ({ q, have: already.get(q.userId) ?? 0 }))
    .sort((a, b) => b.have / b.q.amount - a.have / a.q.amount)
  const targets = ladder(rows.length, LADDER_SALES)

  const created = []
  const report = []
  for (let i = 0; i < rows.length; i++) {
    const { q, have } = rows[i]
    const target = targets[i]
    const need = (target / 100) * q.amount - have
    const rnd = rngFor(`sales:${q.userId}`)
    if (need <= 0) {
      report.push({ name: q.user.name, target, pct: (have / q.amount) * 100, deals: 0 })
      continue
    }
    // 4-7 deals, uneven sizes, dated across the quarter but weighted to recent days.
    const n = 4 + Math.floor(rnd() * 4)
    const weights = Array.from({ length: n }, () => 0.6 + rnd() * 1.4)
    const wSum = weights.reduce((a, b) => a + b, 0)
    for (let k = 0; k < n; k++) {
      const amount = Math.round(((need * weights[k]) / wSum) * 100) / 100
      const dayIdx = Math.floor(Math.pow(rnd(), 1.7) * Math.min(DAYS, Math.round((NOW - qStart) / 86400000)))
      const closed = stampFor(dayIdx, rnd)
      const company = companies.length ? pick(rnd, companies) : null
      created.push({
        organizationId: orgId,
        companyId: company?.id ?? null,
        name: `${company ? company.name : "Yeni müştəri"} — ${pick(rnd, DEAL_KINDS)}`,
        stage: "WON",
        valueAmount: amount,
        currency: q.currency,
        probability: 100,
        assignedTo: q.userId,
        salesChannel: pick(rnd, ["direct", "partner", "inbound"]),
        // stageChangedAt doubles as the source for the updatedAt fixup below:
        // the sales aggregator buckets WON deals by updatedAt.
        stageChangedAt: closed,
        expectedClose: closed,
        createdAt: new Date(closed.getTime() - between(rnd, 12, 60) * 24 * HOUR),
        tags: [MARK],
      })
    }
    report.push({ name: q.user.name, target, pct: target, deals: n })
  }

  if (!DRY && created.length) {
    await prisma.deal.createMany({ data: created })
    // `updatedAt` is @updatedAt so Prisma stamps now(); the aggregator windows on
    // it, so copy the intended close date over in one pass.
    await prisma.$executeRawUnsafe(
      `UPDATE deals SET "updatedAt" = "stageChangedAt" WHERE "organizationId"=$1 AND '${MARK}' = ANY(tags)`,
      orgId,
    )
  }
  console.log(`   + deals: ${created.length}`)
  return report
}

// ─────────────────────── group: mtm ───────────────────────
/**
 * volume = visits, attainment = 0.5·taskCompletion + 0.3·photoApproval +
 * 0.2·routeCompletion. The three rates are nudged apart around the target so the
 * drill-down card does not read as three identical numbers.
 */
async function seedMtm(prisma, orgId) {
  const agents = await prisma.mtmAgent.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  })
  if (agents.length === 0) {
    console.log("   ! no active MTM agents — field tab stays empty")
    return []
  }
  const customers = await prisma.mtmCustomer.findMany({
    where: { organizationId: orgId },
    select: { id: true },
    take: 200,
  })
  if (customers.length === 0) {
    console.log("   ! no MTM customers — cannot create visits")
    return []
  }
  const photoUrls = (
    await prisma.mtmPhoto.findMany({
      where: { organizationId: orgId },
      select: { url: true, thumbnailUrl: true },
      take: 25,
    })
  ).filter((p) => p.url)

  const order = [...agents].sort((a, b) => hashStr(a.id) - hashStr(b.id))
  const targets = ladder(order.length, LADDER_RATE)

  const visits = []
  const tasks = []
  const photos = []
  const routes = []
  const report = []

  for (let i = 0; i < order.length; i++) {
    const agent = order[i]
    const target = targets[i]
    const rnd = rngFor(`mtm:${agent.id}`)
    // Spread the composite's three inputs around the target (weights 0.5/0.3/0.2
    // keep the weighted mean ≈ target).
    const rateTask = makeRater(Math.min(100, target + 3))
    const ratePhoto = makeRater(Math.min(100, target - 4))
    const rateRoute = makeRater(Math.min(100, target + 2))
    const cVisit = makeCounter()
    const cTask = makeCounter()
    const cPhoto = makeCounter()
    const cRoute = makeCounter()
    const load = 0.7 + rnd() * 0.9 // personal workload → varied volumes

    let vTotal = 0
    for (let d = 0; d < DAYS; d++) {
      const f = density(d) * weekendFactor(d) * load
      const nVisits = cVisit(2 * f)
      const nTasks = cTask(4 * f)
      const nPhotos = cPhoto(4 * f)
      const nRoutes = cRoute(1 * f)

      for (let k = 0; k < nVisits; k++) {
        const at = stampFor(d, rnd)
        const dur = Math.round(between(rnd, 15, 55))
        visits.push({
          organizationId: orgId,
          agentId: agent.id,
          customerId: pick(rnd, customers).id,
          status: "CHECKED_OUT",
          checkInAt: at,
          checkOutAt: new Date(at.getTime() + dur * 60000),
          duration: dur,
          outcome: rnd() < 0.85 ? "SUCCESSFUL" : "PARTIAL",
          potential: pick(rnd, ["HIGH", "MEDIUM", "LOW"]),
          notes: `[${MARK}] ${pick(rnd, VISIT_NOTES)}`,
          createdAt: at,
        })
      }
      vTotal += nVisits

      for (let k = 0; k < nTasks; k++) {
        const at = stampFor(d, rnd)
        const done = rateTask()
        tasks.push({
          organizationId: orgId,
          agentId: agent.id,
          customerId: pick(rnd, customers).id,
          // (organizationId, sourceKey) carries a PARTIAL UNIQUE INDEX in the DB
          // that schema.prisma does not declare — the marker must stay per-row
          // unique or every generated task but one is silently rejected.
          sourceKey: `${MARK}-${agent.id}-${d}-${k}`,
          title: pick(rnd, MTM_TASK_TITLES),
          status: done ? "COMPLETED" : rnd() < 0.5 ? "IN_PROGRESS" : "PENDING",
          priority: pick(rnd, ["LOW", "MEDIUM", "MEDIUM", "HIGH"]),
          dueDate: new Date(at.getTime() + 6 * HOUR),
          completedAt: done ? new Date(at.getTime() + between(rnd, 0.5, 5) * HOUR) : null,
          createdAt: at,
        })
      }

      for (let k = 0; k < nPhotos; k++) {
        const at = stampFor(d, rnd)
        const approved = ratePhoto()
        const src = photoUrls.length ? photoUrls[(d * 7 + k) % photoUrls.length] : null
        photos.push({
          organizationId: orgId,
          agentId: agent.id,
          clientPhotoId: `${MARK}-${d}-${k}`,
          url: src?.url ?? `/uploads/mtm/${MARK}/display-${(d + k) % 8}.jpg`,
          thumbnailUrl: src?.thumbnailUrl ?? null,
          category: pick(rnd, ["display", "promo", "receipt"]),
          status: approved ? "APPROVED" : rnd() < 0.6 ? "PENDING" : "REJECTED",
          createdAt: at,
        })
      }

      for (let k = 0; k < nRoutes; k++) {
        const at = stampFor(d, rnd)
        const day = dayRef(d)
        const done = rateRoute()
        const pts = 4 + Math.floor(rnd() * 6)
        routes.push({
          organizationId: orgId,
          agentId: agent.id,
          externalId: `${MARK}-${agent.id}-${d}-${k}`,
          date: new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())),
          name: `Marşrut ${day.getDate()}.${day.getMonth() + 1}`,
          status: done ? "COMPLETED" : rnd() < 0.5 ? "IN_PROGRESS" : "PLANNED",
          totalPoints: pts,
          visitedPoints: done ? pts : Math.floor(pts * 0.6),
          startedAt: at,
          completedAt: done ? new Date(at.getTime() + between(rnd, 3, 7) * HOUR) : null,
          createdAt: at,
        })
      }
    }
    report.push({ name: agent.name, target, visits: vTotal })
  }

  if (!DRY) {
    for (const [model, data] of [
      [prisma.mtmVisit, visits],
      [prisma.mtmTask, tasks],
      [prisma.mtmPhoto, photos],
      [prisma.mtmRoute, routes],
    ]) {
      for (let i = 0; i < data.length; i += 500) {
        await model.createMany({ data: data.slice(i, i + 500) })
      }
    }
  }
  console.log(
    `   + mtm: ${visits.length} visits, ${tasks.length} tasks, ${photos.length} photos, ${routes.length} routes`,
  )
  return report
}

// ─────────────────────── group: tickets ───────────────────────
/** volume = resolved tickets, attainment = share resolved within slaDueAt. */
async function seedTickets(prisma, orgId, contacts) {
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, role: "support", isActive: true },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  })
  if (users.length === 0) {
    console.log("   ! no active support users — support tab stays empty")
    return []
  }
  const order = [...users].sort((a, b) => hashStr(a.id) - hashStr(b.id))
  const targets = ladder(order.length, LADDER_RATE)

  const rows = []
  const report = []
  let seq = 1
  for (let i = 0; i < order.length; i++) {
    const u = order[i]
    const target = targets[i]
    const rnd = rngFor(`tickets:${u.id}`)
    const rate = makeRater(target)
    const count = makeCounter()
    const load = 0.7 + rnd() * 0.9
    let total = 0

    for (let d = 0; d < DAYS; d++) {
      const n = count(4 * density(d) * weekendFactor(d) * load)
      for (let k = 0; k < n; k++) {
        const opened = stampFor(d, rnd)
        const slaHours = pick(rnd, [4, 8, 24, 48])
        const slaDue = new Date(opened.getTime() + slaHours * HOUR)
        const onTime = rate()
        const resolved = onTime
          ? new Date(opened.getTime() + between(rnd, 0.3, 0.9) * slaHours * HOUR)
          : new Date(slaDue.getTime() + between(rnd, 1, 12) * HOUR)
        rows.push({
          organizationId: orgId,
          ticketNumber: `DMO-${String(seq++).padStart(5, "0")}`,
          subject: pick(rnd, TICKET_SUBJECTS),
          description: "Demo məlumatı — KPI Arena üçün yaradılıb.",
          status: "resolved",
          priority: pick(rnd, ["low", "medium", "medium", "high"]),
          category: pick(rnd, TICKET_CATEGORIES),
          contactId: contacts.length && rnd() < 0.7 ? pick(rnd, contacts).id : null,
          assignedTo: u.id,
          source: pick(rnd, TICKET_SOURCES),
          slaDueAt: slaDue,
          firstResponseAt: new Date(opened.getTime() + between(rnd, 0.1, 1.5) * HOUR),
          resolvedAt: resolved,
          closedAt: resolved,
          satisfactionRating: rnd() < 0.75 ? (rnd() < 0.7 ? 5 : 4) : 3,
          handleTimeSeconds: Math.round(between(rnd, 8, 95) * 60),
          escalationLevel: rnd() < 0.08 ? 1 : 0,
          reopenCount: rnd() < 0.07 ? 1 : 0,
          tags: [MARK],
          createdAt: opened,
        })
      }
      total += n
    }
    report.push({ name: u.name, target, resolved: total })
  }

  if (!DRY) {
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.ticket.createMany({ data: rows.slice(i, i + 500) })
    }
  }
  console.log(`   + tickets: ${rows.length}`)
  return report
}

// ─────────────────────── group: projects ───────────────────────
/**
 * volume = projects managed (lifetime, minus cancelled), attainment = share of
 * projects completed IN-WINDOW that landed on or before their planned endDate.
 * Only the last 14 days get completions (projects are heavy rows); that is enough
 * for day/week/month/quarter because the metric is a ratio.
 */
async function seedProjects(prisma, orgId, companies) {
  const existing = await prisma.project.findMany({
    where: { organizationId: orgId, managerId: { not: null } },
    select: { managerId: true, manager: { select: { id: true, name: true } } },
  })
  const managers = [...new Map(existing.filter((p) => p.manager).map((p) => [p.manager.id, p.manager])).values()]
  if (managers.length === 0) {
    console.log("   ! no project managers — projects tab stays empty")
    return []
  }
  const order = [...managers].sort((a, b) => hashStr(a.id) - hashStr(b.id))
  const targets = ladder(order.length, LADDER_RATE)

  const PROJECT_DAYS = Math.min(DAYS, 14)
  const rows = []
  const report = []
  let seq = 1
  for (let i = 0; i < order.length; i++) {
    const m = order[i]
    const target = targets[i]
    const rnd = rngFor(`projects:${m.id}`)
    const rate = makeRater(target)
    const count = makeCounter()
    let total = 0

    for (let d = 0; d < PROJECT_DAYS; d++) {
      // 3 completions today (so the rolling-24h "Gün" view has enough granularity
      // to express a ratio), then ~1/day, thinning out after the first week.
      const base = d === 0 ? 3 : d <= 6 ? 1 : 0.5
      const n = count(base)
      for (let k = 0; k < n; k++) {
        const ended = stampFor(d, rnd)
        const planned = rate()
          ? new Date(ended.getTime() + between(rnd, 1, 9) * 24 * HOUR)
          : new Date(ended.getTime() - between(rnd, 1, 7) * 24 * HOUR)
        const started = new Date(ended.getTime() - between(rnd, 20, 70) * 24 * HOUR)
        const company = companies.length ? pick(rnd, companies) : null
        rows.push({
          organizationId: orgId,
          name: `${company ? company.name : "Müştəri"} — ${pick(rnd, PROJECT_KINDS)}`,
          code: `DMO-PRJ-${String(seq++).padStart(4, "0")}`,
          status: "completed",
          priority: pick(rnd, ["low", "medium", "medium", "high"]),
          companyId: company?.id ?? null,
          managerId: m.id,
          startDate: started,
          endDate: planned,
          actualStartDate: started,
          actualEndDate: ended,
          budget: Math.round(between(rnd, 6, 90)) * 1000,
          actualCost: Math.round(between(rnd, 5, 88)) * 1000,
          completionPercentage: 100,
          tags: [MARK],
          createdAt: started,
        })
      }
      total += n
    }
    report.push({ name: m.name, target, completed: total })
  }

  if (!DRY) {
    for (let i = 0; i < rows.length; i += 250) {
      await prisma.project.createMany({ data: rows.slice(i, i + 250) })
    }
  }
  console.log(`   + projects: ${rows.length}`)
  return report
}

// ─────────────────────── group: tasks ───────────────────────
/**
 * volume = tasks completed in-window, attainment = share completed on or before
 * dueDate.
 *
 * The roster is NOT ours to choose. The aggregator pulls in anyone with an
 * overdue task OR any task completed inside the window — and for the lifetime
 * windows ("İl" / "Bütün vaxt") that means ANY historical completion at all.
 * Seed one of those people short and they do not vanish: they show up carrying
 * whatever their old rows happen to average. That is exactly how Elnur Babayev
 * landed on the board at 10% (1 of 10 June tasks in time) while every seeded
 * colleague sat at 50-100%. So the roster must cover every user the aggregator
 * can reach, not a sample of them.
 */
async function seedTasks(prisma, orgId) {
  const overdue = await prisma.task.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      assignedTo: { not: null },
      deletedAt: null,
      completedAt: null,
      dueDate: { lt: NOW },
    },
    _count: true,
  })
  // Anyone with a completed task EVER surfaces in the lifetime windows, so they
  // belong in the roster just as much as the overdue holders.
  const everCompleted = await prisma.task.groupBy({
    by: ["assignedTo"],
    where: {
      organizationId: orgId,
      assignedTo: { not: null },
      deletedAt: null,
      completedAt: { not: null },
    },
    _count: true,
  })
  const mustIds = [
    ...new Set([...overdue, ...everCompleted].map((g) => g.assignedTo).filter(Boolean)),
  ]

  const must = await prisma.user.findMany({
    where: { organizationId: orgId, id: { in: mustIds }, isActive: true },
    select: { id: true, name: true },
  })
  const extra = await prisma.user.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      role: { in: ["support", "sales"] },
      id: { notIn: must.map((u) => u.id) },
    },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
    take: 8,
  })
  const roster = [...must, ...extra]
  if (roster.length === 0) {
    console.log("   ! no task assignees — tasks tab stays empty")
    return []
  }
  const order = [...roster].sort((a, b) => hashStr(a.id) - hashStr(b.id))
  const targets = ladder(order.length, LADDER_RATE)

  const rows = []
  const report = []
  for (let i = 0; i < order.length; i++) {
    const u = order[i]
    const target = targets[i]
    const rnd = rngFor(`tasks:${u.id}`)
    const rate = makeRater(target)
    const count = makeCounter()
    const load = 0.7 + rnd() * 0.8
    let total = 0

    for (let d = 0; d < DAYS; d++) {
      const n = count(5 * density(d) * weekendFactor(d) * load)
      for (let k = 0; k < n; k++) {
        const done = stampFor(d, rnd)
        const due = rate()
          ? new Date(done.getTime() + between(rnd, 2, 30) * HOUR)
          : new Date(done.getTime() - between(rnd, 3, 40) * HOUR)
        rows.push({
          organizationId: orgId,
          title: pick(rnd, TASK_TITLES),
          status: "completed",
          priority: pick(rnd, ["low", "medium", "medium", "high"]),
          assignedTo: u.id,
          dueDate: due,
          completedAt: done,
          customFields: { kpiDemo: true },
          createdAt: new Date(done.getTime() - between(rnd, 8, 96) * HOUR),
        })
      }
      total += n
    }
    report.push({ name: u.name, target, completed: total })
  }

  if (!DRY) {
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.task.createMany({ data: rows.slice(i, i + 500) })
    }
  }
  console.log(`   + tasks: ${rows.length}`)
  return report
}

// ─────────────────────── verification ───────────────────────
/** Recomputes what the API will return, straight from the DB, for the given window. */
async function verify(prisma, orgId, label, start, wonStages) {
  const out = {}

  if (GROUPS.includes("sales")) {
    const year = NOW.getFullYear()
    const quarter = Math.floor(NOW.getMonth() / 3) + 1
    const qStart = new Date(year, (quarter - 1) * 3, 1)
    const qEnd = new Date(year, quarter * 3, 1)
    const quotas = await prisma.salesQuota.findMany({
      where: { organizationId: orgId, year, quarter, user: { isActive: true } },
      include: { user: { select: { name: true } } },
    })
    const won = await prisma.deal.groupBy({
      by: ["assignedTo"],
      where: {
        organizationId: orgId,
        stage: { in: wonStages },
        assignedTo: { in: quotas.map((q) => q.userId) },
        updatedAt: { gte: qStart, lt: qEnd },
      },
      _sum: { valueAmount: true },
    })
    const m = new Map(won.map((w) => [w.assignedTo, Number(w._sum.valueAmount ?? 0)]))
    out.sales = quotas
      .map((q) => ({ name: q.user.name, pct: Math.round(((m.get(q.userId) ?? 0) / q.amount) * 1000) / 10 }))
      .sort((a, b) => b.pct - a.pct)
  }

  if (GROUPS.includes("mtm")) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT a.name,
              (SELECT count(*) FROM mtm_visits v WHERE v."agentId"=a.id AND v."deletedAt" IS NULL AND v."createdAt" >= $2) AS visits,
              (SELECT count(*) FROM mtm_tasks t WHERE t."agentId"=a.id AND t."deletedAt" IS NULL AND t."createdAt" >= $2) AS t_all,
              (SELECT count(*) FROM mtm_tasks t WHERE t."agentId"=a.id AND t."deletedAt" IS NULL AND t.status='COMPLETED' AND t."createdAt" >= $2) AS t_done,
              (SELECT count(*) FROM mtm_photos p WHERE p."agentId"=a.id AND p."createdAt" >= $2) AS p_all,
              (SELECT count(*) FROM mtm_photos p WHERE p."agentId"=a.id AND p.status='APPROVED' AND p."createdAt" >= $2) AS p_ok,
              (SELECT count(*) FROM mtm_routes r WHERE r."agentId"=a.id AND r."deletedAt" IS NULL AND r."createdAt" >= $2) AS r_all,
              (SELECT count(*) FROM mtm_routes r WHERE r."agentId"=a.id AND r."deletedAt" IS NULL AND r.status='COMPLETED' AND r."createdAt" >= $2) AS r_done
       FROM mtm_agents a WHERE a."organizationId"=$1 AND a.status='ACTIVE'`,
      orgId,
      start,
    )
    out.mtm = rows
      .map((r) => {
        const rate = (a, b) => (Number(b) > 0 ? Math.round((Number(a) / Number(b)) * 100) : 0)
        const pct =
          0.5 * rate(r.t_done, r.t_all) + 0.3 * rate(r.p_ok, r.p_all) + 0.2 * rate(r.r_done, r.r_all)
        return { name: r.name, pct: Math.round(pct * 10) / 10, vol: Number(r.visits) }
      })
      .sort((a, b) => b.pct - a.pct)
  }

  if (GROUPS.includes("tickets")) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT u.name,
              count(*) FILTER (WHERE t."slaDueAt" IS NOT NULL) AS with_sla,
              count(*) FILTER (WHERE t."slaDueAt" IS NOT NULL AND t."resolvedAt" <= t."slaDueAt") AS met,
              count(*) AS resolved
       FROM tickets t JOIN users u ON u.id=t."assignedTo"
       WHERE t."organizationId"=$1 AND u.role='support' AND u."isActive" AND t."resolvedAt" >= $2
       GROUP BY u.name`,
      orgId,
      start,
    )
    out.tickets = rows
      .map((r) => ({
        name: r.name,
        pct: Number(r.with_sla) > 0 ? Math.round((Number(r.met) / Number(r.with_sla)) * 1000) / 10 : 0,
        vol: Number(r.resolved),
      }))
      .sort((a, b) => b.pct - a.pct)
  }

  if (GROUPS.includes("projects")) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT u.name,
              count(*) FILTER (WHERE p.status='completed' AND p."actualEndDate" >= $2 AND p."endDate" IS NOT NULL) AS with_plan,
              count(*) FILTER (WHERE p.status='completed' AND p."actualEndDate" >= $2 AND p."endDate" IS NOT NULL AND p."actualEndDate" <= p."endDate") AS on_time,
              count(*) FILTER (WHERE p.status <> 'cancelled') AS managed
       FROM projects p JOIN users u ON u.id=p."managerId"
       WHERE p."organizationId"=$1 GROUP BY u.name`,
      orgId,
      start,
    )
    out.projects = rows
      .map((r) => ({
        name: r.name,
        pct: Number(r.with_plan) > 0 ? Math.round((Number(r.on_time) / Number(r.with_plan)) * 1000) / 10 : 0,
        vol: Number(r.managed),
      }))
      .sort((a, b) => b.pct - a.pct)
  }

  if (GROUPS.includes("tasks")) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT u.name,
              count(*) FILTER (WHERE t."dueDate" IS NOT NULL) AS with_due,
              count(*) FILTER (WHERE t."dueDate" IS NOT NULL AND t."completedAt" <= t."dueDate") AS on_time,
              count(*) AS completed
       FROM tasks t JOIN users u ON u.id=t."assignedTo"
       WHERE t."organizationId"=$1 AND t."deletedAt" IS NULL AND u."isActive" AND t."completedAt" >= $2
       GROUP BY u.name`,
      orgId,
      start,
    )
    out.tasks = rows
      .map((r) => ({
        name: r.name,
        pct: Number(r.with_due) > 0 ? Math.round((Number(r.on_time) / Number(r.with_due)) * 1000) / 10 : 0,
        vol: Number(r.completed),
      }))
      .sort((a, b) => b.pct - a.pct)
  }

  console.log(`\n── ${label} ──`)
  for (const g of GROUPS) {
    const list = out[g]
    if (!list?.length) continue
    const band = (p) => (p >= 110 ? "üstələyir" : p >= 90 ? "qrafikdə" : p >= 70 ? "geri qalır" : p >= 50 ? "riskdə" : "kritik")
    console.log(
      `${g.padEnd(9)} ${list.map((a) => `${a.name.split(" ")[0]} ${a.pct}%`).join(", ")}`,
    )
    const counts = { üstələyir: 0, qrafikdə: 0, "geri qalır": 0, riskdə: 0, kritik: 0 }
    for (const a of list) counts[band(a.pct)]++
    console.log(`${" ".repeat(10)}${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  ")}`)
  }
}

// ─────────────────────── main ───────────────────────
async function main() {
  const bootstrap = await makeScriptPrisma()
  const org = await bootstrap.organization.findUnique({ where: { slug: SLUG } })
  await bootstrap.$disconnect()
  if (!org) {
    console.error(`Organization "${SLUG}" not found`)
    process.exit(1)
  }

  const prisma = await makeScriptPrisma({ orgId: org.id })
  console.log(`\nKPI Arena demo seed → ${org.name} (${SLUG})`)
  console.log(`window: ${DAYS} days back from ${NOW.toISOString()}`)
  console.log(`groups: ${GROUPS.join(", ")}${DRY ? "   [DRY RUN — no writes]" : ""}`)
  console.log("─".repeat(60))

  console.log("cleaning previous demo rows…")
  if (!DRY) await clean(prisma, org.id)
  if (CLEAN_ONLY) {
    console.log("done (clean-only).")
    await prisma.$disconnect()
    return
  }

  const companies = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, name: true },
    take: 120,
  })
  const contacts = await prisma.contact.findMany({
    where: { organizationId: org.id },
    select: { id: true },
    take: 200,
  })

  const wonStages = await wonStageSpellings(prisma, org.id)
  console.log(`won-stage spellings in this org: ${wonStages.join(", ")}`)

  console.log("seeding…")
  if (GROUPS.includes("sales")) await seedSales(prisma, org.id, companies, wonStages)
  if (GROUPS.includes("mtm")) await seedMtm(prisma, org.id)
  if (GROUPS.includes("tickets")) await seedTickets(prisma, org.id, contacts)
  if (GROUPS.includes("projects")) await seedProjects(prisma, org.id, companies)
  if (GROUPS.includes("tasks")) await seedTasks(prisma, org.id)

  if (!DRY) {
    // Same windows the UI offers, so a bad period switch shows up here first.
    const monthStart = new Date(NOW.getFullYear(), NOW.getMonth(), 1)
    const quarterStart = new Date(NOW.getFullYear(), Math.floor(NOW.getMonth() / 3) * 3, 1)
    await verify(prisma, org.id, "Gün (rolling 24h)", new Date(NOW.getTime() - 24 * HOUR), wonStages)
    await verify(prisma, org.id, "Həftə (rolling 7d)", new Date(NOW.getTime() - 7 * 24 * HOUR), wonStages)
    await verify(prisma, org.id, "Ay (month-to-date)", monthStart, wonStages)
    await verify(prisma, org.id, "Rüb (quarter-to-date)", quarterStart, wonStages)
    await verify(prisma, org.id, "İl (year-to-date)", new Date(NOW.getFullYear(), 0, 1), wonStages)
    await verify(prisma, org.id, "Bütün vaxt", new Date(0), wonStages)
  }

  await prisma.$disconnect()
  console.log("\ndone.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
