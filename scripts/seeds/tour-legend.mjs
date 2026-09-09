// Легенда данных для стенда, с которого снимаются кадры тура по продукту.
//
// Отдельный файл, а не константы внутри сидера: легенда должна читаться и
// проверяться глазами целиком. Её главное свойство — в ней нет ни одного
// настоящего имени. Существующие демо-сидеры этим свойством не обладают:
// в scripts/demo-fill.mjs, seed-demo.mjs и seeds/mars.mjs суммарно 151
// упоминание живых брендов — операторов связи, банков, ритейла, — а полевой
// сидер поднимает тенант реального пилота с его брендингом и настоящими
// координатами магазинов. Снимать сайт на таком нельзя.
//
// Названия здесь намеренно не приводятся: в этом файле не должно быть
// настоящих имён даже в комментарии, и это проверяется тестом.
//
// Правила, которым легенда обязана соответствовать — они же приёмка:
//   1. Ни одного реального юрлица, человека, домена и телефона.
//   2. Ни одного круглого числа: круглые читаются как заглушка.
//   3. Каждое имя встречается минимум на трёх кадрах — иначе тур
//      рассыпается на несвязанные снимки.
//   4. Телефоны и почтовые адреса в кадр не попадают вовсе, поэтому
//      контактных данных здесь нет даже выдуманных.
//
// Перед публикацией названия юрлиц проверяются по реестру и по доменам:
// приписать свою CRM существующей компании — хуже, чем показать заглушку.

export const TOUR_MARKER = "tour-stand.local"

export const TENANT = {
  name: "Kür Systems MMC",
  city: "Bakı",
  industry: "Ticarət və anbar İT sistemlərinə xidmət",
  headcount: 14,
}

export const PEOPLE = {
  manager: { fullName: "Aysel Quliyeva", position: "Satış meneceri" },
  finance: { fullName: "Kənan Aslanov", position: "Maliyyə üzrə məsul" },
  clientContact: { fullName: "Leyla Məmmədova", position: "Əməliyyat direktoru" },
}

export const COMPANIES = [
  { name: "Northline Logistics", industry: "Logistika", city: "Xırdalan", lead: true },
  { name: "Aroma Market", industry: "Pərakəndə", city: "Bakı" },
  { name: "Atlas Design", industry: "Dizayn", city: "Bakı" },
  { name: "Greenline", industry: "Aqrar", city: "Gəncə" },
]

// Сквозной сюжет тура. Числа некруглые и связаны между собой: ставка 78
// против себестоимости 46 даёт ту самую маржу, которая падает на шестом кадре.
export const STORY = {
  lead: { score: 74, probability: 62, status: "qualified", source: "whatsapp", at: "21:40" },
  deal: { valueAmount: 27400, currency: "AZN", stage: "negotiation", probability: 62, touch: 6, ofTouches: 8 },
  invoice: { number: "INV-2026-0143", total: 12600, paid: 6300, overdueDays: 11, currency: "AZN" },
  margin: { costPerHour: 46, billedPerHour: 78, was: 31, now: 24, overheadGrowth: 23 },
  pricing: { from: 78, to: 89, currency: "AZN" },
}
