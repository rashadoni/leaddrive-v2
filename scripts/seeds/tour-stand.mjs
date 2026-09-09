// Стенд для съёмки кадров интерактивного тура по продукту.
//
// Зачем отдельный сидер. Кадры тура уезжают на публичный сайт, поэтому в них
// не может быть ни одного настоящего имени. Существующие демо-сидеры этому
// требованию не отвечают: в demo-fill.mjs, seed-demo.mjs и seeds/mars.mjs
// суммарно 151 упоминание живых брендов, а полевой сидер поднимает тенант
// реального пилота с его GPS-точками. Здесь их названия не приводятся —
// файл целиком свободен от настоящих имён, это проверяется тестом. Их не правлю — они существуют для своих
// демо и не виноваты; для тура нужен свой стенд.
//
// Что сеет (кадры 2, 3, 5 плана docs/product-tour-plan.md):
//   - компании и контакты легенды;
//   - лиды со скорингом — кадр «Da Vinci Скоринг»;
//   - сделки по стадиям — кадр «Сделки»;
//   - счёт с частичной оплатой и просрочкой — кадр «Счета».
//
// Чего НЕ сеет, и это осознанно:
//   - очередь действий советника (кадр 4). Действия генерирует сам движок по
//     состоянию данных; подложить их строками — значит показать в туре то,
//     чего продукт не сделал сам. Кадр снимается после того, как очередь
//     наполнится сама, и если денежные действия не появятся — кадр меняется,
//     а не подделывается.
//   - модель затрат и рентабельность (кадр 6). Живёт в отдельных таблицах и
//     сеется seed-cost-model.ts, который сейчас читает данные чужой компании.
//     Это следующая задача, здесь её не маскирую.
//   - входящие и ценообразование (кадры 1 и 7) — по плану верстаются сценой,
//     а не снимаются.
//
// Идемпотентность: всё созданное помечено доменом tour-stand.local в почте
// контактов и лидов и тегом "tour-stand" у сделок. Повторный запуск сначала
// удаляет прежние строки с этими метками, поэтому стенд можно пересевать
// сколько угодно, а чужие данные он не тронет никогда.
//
// Запуск (на сервере, где DATABASE_URL смотрит в нужную базу):
//   CONFIRM_PROD=1 node scripts/seeds/tour-stand.mjs --slug=<slug>
//   CONFIRM_PROD=1 node scripts/seeds/tour-stand.mjs --slug=<slug> --clean

import { makeScriptPrisma } from "../_rls.mjs"
import { TOUR_MARKER, TENANT, PEOPLE, COMPANIES, STORY } from "./tour-legend.mjs"

const prisma = await makeScriptPrisma()

if (!process.env.CONFIRM_PROD) {
  console.error("Отказ: запуск без CONFIRM_PROD=1. Сидер пишет в базу.")
  process.exit(1)
}

const slug = (process.argv.find((a) => a.startsWith("--slug=")) || "").split("=")[1]
if (!slug) {
  console.error("Отказ: не указан --slug=<организация>.")
  process.exit(1)
}
const clean = process.argv.includes("--clean")

const org = await prisma.organization.findUnique({ where: { slug } })
if (!org) {
  console.error(`Отказ: организации со slug "${slug}" нет.`)
  process.exit(1)
}
const orgId = org.id
const mail = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${TOUR_MARKER}`

// ── снос прежнего стенда ──────────────────────────────────────────────────
// Порядок важен: сначала то, что ссылается, потом то, на что ссылаются.
const wipe = async () => {
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, name: { in: COMPANIES.map((c) => c.name) } },
    select: { id: true },
  })
  const companyIds = companies.map((c) => c.id)
  const { count: inv } = await prisma.invoice.deleteMany({
    where: { organizationId: orgId, invoiceNumber: STORY.invoice.number },
  })
  const { count: deals } = await prisma.deal.deleteMany({
    where: { organizationId: orgId, tags: { has: "tour-stand" } },
  })
  const { count: leads } = await prisma.lead.deleteMany({
    where: { organizationId: orgId, email: { endsWith: `@${TOUR_MARKER}` } },
  })
  const { count: contacts } = await prisma.contact.deleteMany({
    where: { organizationId: orgId, email: { endsWith: `@${TOUR_MARKER}` } },
  })
  const { count: comps } = companyIds.length
    ? await prisma.company.deleteMany({ where: { organizationId: orgId, id: { in: companyIds } } })
    : { count: 0 }
  console.log(`снесено: счетов ${inv}, сделок ${deals}, лидов ${leads}, контактов ${contacts}, компаний ${comps}`)
}

await wipe()
if (clean) {
  console.log("режим --clean: стенд снят, ничего не создано.")
  process.exit(0)
}

// ── компании и контакты ───────────────────────────────────────────────────
const companyByName = {}
for (const c of COMPANIES) {
  companyByName[c.name] = await prisma.company.create({
    data: { organizationId: orgId, name: c.name, industry: c.industry, city: c.city },
  })
}
const client = companyByName[COMPANIES[0].name]

const contact = await prisma.contact.create({
  data: {
    organizationId: orgId,
    fullName: PEOPLE.clientContact.fullName,
    position: PEOPLE.clientContact.position,
    email: mail(PEOPLE.clientContact.fullName),
    companyId: client.id,
  },
})

// ── лиды: кадр «Da Vinci Скоринг» ─────────────────────────────────────────
// Разброс баллов намеренный: один кадр должен показывать шкалу, а не один
// удачный лид. Сквозной лид легенды — первый, с баллом из STORY.
const LEADS = [
  { contactName: PEOPLE.clientContact.fullName, companyName: client.name, score: STORY.lead.score, status: STORY.lead.status },
  { contactName: "Rəşad Hüseynov", companyName: "Aroma Market", score: 61, status: "new" },
  { contactName: "Nigar Əliyeva", companyName: "Atlas Design", score: 43, status: "new" },
  { contactName: "Tural Səfərov", companyName: "Greenline", score: 29, status: "new" },
]
for (const l of LEADS) {
  await prisma.lead.create({
    data: {
      organizationId: orgId,
      contactName: l.contactName,
      companyName: l.companyName,
      email: mail(l.contactName),
      source: STORY.lead.source,
      status: l.status,
      score: l.score,
    },
  })
}

// ── сделки: кадр «Сделки» ─────────────────────────────────────────────────
const DEALS = [
  { name: `${client.name} — anbar terminalları`, stage: STORY.deal.stage, valueAmount: STORY.deal.valueAmount, probability: STORY.deal.probability, companyId: client.id, contactId: contact.id },
  { name: "Aroma Market — kassa sistemləri", stage: "proposal", valueAmount: 18300, probability: 45 },
  { name: "Atlas Design — dəstək paketi", stage: "qualified", valueAmount: 9700, probability: 30 },
]
for (const d of DEALS) {
  await prisma.deal.create({
    data: {
      organizationId: orgId,
      name: d.name,
      stage: d.stage,
      valueAmount: d.valueAmount,
      currency: STORY.deal.currency,
      probability: d.probability,
      companyId: d.companyId ?? null,
      contactId: d.contactId ?? null,
      tags: ["tour-stand"],
    },
  })
}

// ── счёт: кадр «Счета» ────────────────────────────────────────────────────
// Половина суммы пришла, остаток просрочен на одиннадцать дней — это первый
// из двух денежных рисков, которые обещает кадр очереди советника.
const day = 24 * 60 * 60 * 1000
const issued = new Date(Date.now() - 41 * day)
const due = new Date(Date.now() - STORY.invoice.overdueDays * day)
const total = STORY.invoice.total
const paid = STORY.invoice.paid
await prisma.invoice.create({
  data: {
    organizationId: orgId,
    invoiceNumber: STORY.invoice.number,
    title: `${client.name} — anbar terminalları`,
    status: "overdue",
    subtotal: total,
    totalAmount: total,
    paidAmount: paid,
    balanceDue: total - paid,
    currency: STORY.invoice.currency,
    issueDate: issued,
    dueDate: due,
    companyId: client.id,
    contactId: contact.id,
  },
})

console.log(`стенд собран в «${org.name}»: компаний ${COMPANIES.length}, лидов ${LEADS.length}, сделок ${DEALS.length}, счёт ${STORY.invoice.number}`)
console.log(`легенда: ${TENANT.name}, ${TENANT.city}, ${TENANT.headcount} чел. Метка для снятия — @${TOUR_MARKER} и тег tour-stand.`)
await prisma.$disconnect()
