// Demo data for the Complaints Register, based on the client's original xlsx
// (CRM hesabat.xlsx — rows 250..254, FMCG / bakery). Run against a target org:
//   ORG_ID=<uuid> npx tsx prisma/seed/complaints-demo.ts
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

type Row = {
  sira: number
  customer: string
  date: string // ISO
  source: string
  type: "complaint" | "suggestion"
  brand: string
  productionArea: string
  productCategory: string
  object: string
  objectDetail: string
  phone: string | null
  content: string
  department: string
  response: string
  status: "resolved" | "escalated"
  riskLevel: "low" | "medium" | "high"
}

const ROWS: Row[] = [
  {
    sira: 250,
    customer: "Nicat Alışov",
    date: "2026-02-06",
    source: "hotline",
    type: "complaint",
    brand: "Çörəkçi",
    productionArea: "Çörəkçi",
    productCategory: "Kruassan",
    object: "Qiymət artımı",
    objectDetail: "Qiymət artımı",
    phone: "055 775 45 44",
    content:
      "STB əməkdaşları çörək məhsulu qiymət artımı ilə bağlı narazılıq bildirir. Paketsiz kruassanın qiyməti 0.30 → 0.50 AZN-ə qalxıb.",
    department: "Marketing departmenti",
    response:
      "Paketsiz kruassan qiymət artımları zamanı nəzərə alınmayıb. Yeni qiymət təyin olunmuşdur.",
    status: "resolved",
    riskLevel: "medium",
  },
  {
    sira: 251,
    customer: "Lalə xanım",
    date: "2026-02-12",
    source: "hotline",
    type: "complaint",
    brand: "Bismak",
    productionArea: "Bismak Vafli",
    productCategory: "vafli",
    object: "keyfiyyət",
    objectDetail: "dad dəyişimi",
    phone: "055 494 82 75",
    content:
      "450 qr südlü vafli çeşidi. Müştəri məhsulun dadında hiss olunacaq dərəcədə dəyişiklik olduğunu iddia edir, mağazada tozlu vəziyyətdə saxlanıldığını qeyd edir.",
    department: "Keyfiyyət nəzarət şöbəsi",
    response:
      "Şahid nümunəsinə baxış keçirildi — rəngi, qoxusu və dadı normal idi. Saxlanma şəraitinin qaydasında olmaması probleminin əsas səbəbi hesab olunur.",
    status: "resolved",
    riskLevel: "medium",
  },
  {
    sira: 252,
    customer: "Nigar Əlipaşayeva",
    date: "2026-02-19",
    source: "email",
    type: "complaint",
    brand: "Çörəkçi",
    productionArea: "Çörəkçi",
    productCategory: "kruassan",
    object: "keyfiyyət",
    objectDetail: "İçlik olmaması",
    phone: null,
    content:
      "17.02.2026 istehsallı 4 ədəd şokoladlı kruassanın heç birinin içərisinə şokolad əlavə olunmamışdı.",
    department: "Keyfiyyət nəzarət şöbəsi",
    response:
      "Kruassan dolum avadanlığında iynə gözünün tutulması səbəbindən bir hissəsi boş gedmişdir. Tədarükçü ilə görüşülmüş, problem aradan qaldırılmışdır.",
    status: "resolved",
    riskLevel: "medium",
  },
  {
    sira: 253,
    customer: "Ramin",
    date: "2026-02-25",
    source: "hotline",
    type: "complaint",
    brand: "Çörəkçi",
    productionArea: "Çörəkçi",
    productCategory: "Çatdırılma",
    object: "çatdırılma",
    objectDetail: "Gec çatdırılma",
    phone: "050 359 81 00",
    content:
      "Şüvəlanda 3 mərtəbə market rəhbərliyi 6 aydır çatdırılma ilə bağlı narazıdır. Çörək rəfi boş, məhsul vaxtında çatdırılmır.",
    department: "Satış departamenti",
    response:
      "Müştəri vaxtaşırı ziyarət olunur. Bravo market açıldığından satışı düşüb. Yaranmış vəziyyət müştəriyə izah olunub, problem həll olunub.",
    status: "resolved",
    riskLevel: "medium",
  },
  {
    sira: 254,
    customer: "Adı qeyd olunmayan",
    date: "2026-02-02",
    source: "sales_rep",
    type: "complaint",
    brand: "Çörəkçi",
    productionArea: "Çörəkçi",
    productCategory: "Baton ekstra",
    object: "Keyfiyyət",
    objectDetail: "yad cisim aşkarlanma",
    phone: "055-795-65-28",
    content:
      "23.02.2026 Al Market mağazasından alınan Baton çörəyinin daxilində yad cismin olması iddia olunur. Qida təhlükəsizliyi baxımından ciddi risk.",
    department: "Keyfiyyət nəzarət şöbəsi",
    response:
      "Müştəri ilə dəfələrlə əlaqə saxlanıldı, xətt məşğul. Videoya baxış keçirildi — xammalın yaxşı qarışmaması ehtimalı mövcuddur.",
    status: "escalated",
    riskLevel: "high",
  },
]

async function main() {
  const orgId = process.env.ORG_ID
  if (!orgId) {
    console.error("Set ORG_ID=<uuid> before running")
    process.exit(1)
  }

  console.log(`Seeding ${ROWS.length} demo complaints into org ${orgId}…`)

  // Start ticket numbering from the max registry number we're about to insert
  const existing = await prisma.ticket.findMany({
    where: { organizationId: orgId },
    select: { ticketNumber: true },
  })
  let counter = existing.reduce((m, t) => {
    const n = parseInt(t.ticketNumber.replace(/[^0-9]/g, ""), 10) || 0
    return n > m ? n : m
  }, 0)

  for (const r of ROWS) {
    counter++
    const ticketNumber = `TK-${String(counter).padStart(4, "0")}` // standalone seed: avoid @/lib alias dep

    let contactId: string | undefined
    if (r.phone || r.customer) {
      const found = r.phone
        ? await prisma.contact.findFirst({
            where: { organizationId: orgId, phone: r.phone },
            select: { id: true },
          })
        : null
      contactId =
        found?.id ??
        (await prisma.contact.create({
          data: {
            organizationId: orgId,
            fullName: r.customer,
            phone: r.phone,
            source: "complaints_register",
          },
          select: { id: true },
        })).id
    }

    const createdAt = new Date(r.date)
    await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          organizationId: orgId,
          ticketNumber,
          subject: `${r.brand} — ${r.object}: ${r.content.slice(0, 80)}`,
          description: r.content,
          priority: r.riskLevel === "high" ? "high" : r.riskLevel === "low" ? "low" : "medium",
          status: r.status === "resolved" ? "resolved" : "open",
          category: "complaint",
          source: r.source,
          contactId,
          createdAt,
          updatedAt: createdAt,
          resolvedAt: r.status === "resolved" ? createdAt : null,
        },
      })
      await tx.complaintMeta.create({
        data: {
          ticketId: ticket.id,
          organizationId: orgId,
          externalRegistryNumber: r.sira,
          complaintType: r.type,
          brand: r.brand,
          productionArea: r.productionArea,
          productCategory: r.productCategory,
          complaintObject: r.object,
          complaintObjectDetail: r.objectDetail,
          responsibleDepartment: r.department,
          riskLevel: r.riskLevel,
        },
      })
      await tx.ticketComment.create({
        data: {
          ticketId: ticket.id,
          comment: r.response,
          isInternal: false,
        },
      })
    })
    console.log(`  #${r.sira} — ${r.customer} — ${r.brand} — ${r.status}`)
  }

  console.log("✔ done")
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
