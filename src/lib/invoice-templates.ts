export type DocLanguage = "az" | "ru" | "en"

export interface PdfTranslations {
  // Invoice
  invoiceTitle: string
  // Act
  actTitle: string
  iApprove: string
  director: string
  directorOf: string
  signatureAndStamp: string
  // Parties
  executor: string
  customer: string
  // Fields
  companyName: string
  voen: string
  address: string
  email: string
  phone: string
  documentNumber: string
  documentDate: string
  monthlyReport: string
  // Services
  servicesProvided: string
  unitOfMeasure: string
  unitMonth: string
  unitCompany: string
  quantity: string
  // Totals
  subtotal: string
  vat18: string
  totalWithVat: string
  // Bank
  bankAccount: string
  confirmation: string
  bank: string
  code: string
  swift: string
  account: string
  corrAccount: string
  // Act legal text
  city: string
  actIntroTemplate: string
  actClause1Template: string
  actClause2: string
  actClause3: string
  // Signatures
  position: string
  fullName: string
  signature: string
  // Act extra keys (used by act template)
  approve: string
  signAndStamp: string
  companyInfo: string
  description: string
  unit: string
  unitPrice: string
  total: string
  discount: string
  vat: string
  grandTotal: string
  unitValue: string
  printButton: string
  // Months
  months: string[]
}

export const PDF_TRANSLATIONS: Record<DocLanguage, PdfTranslations> = {
  az: {
    invoiceTitle: "HESAB FAKTURA",
    actTitle: "Təhvil - Təslim Aktı",
    iApprove: "Təsdiq edirəm",
    director: "Direktoru",
    directorOf: "-nin",
    signatureAndStamp: "(imza və möhür)",
    executor: "İcraçı Şirkət",
    customer: "Sifarişçi Şirkət",
    companyName: "Şirkət Adı",
    voen: "VÖEN",
    address: "Ünvan",
    email: "E-poçt",
    phone: "Telefon",
    documentNumber: "Sənəd Nömrəsi",
    documentDate: "Sənədin tarixi",
    monthlyReport: "Aylıq hesabat",
    servicesProvided: "GÖSTƏRİLMİŞ İT XİDMƏTLƏR",
    unitOfMeasure: "ÖLÇÜ VAHİDİ",
    unitMonth: "AY",
    unitCompany: "Şirkət üzrə",
    quantity: "SAY",
    subtotal: "Ümumi Məbləğ",
    vat18: "ƏDV 18%",
    totalWithVat: "Yekun aylıq xidmət haqqı (ƏDV daxil)",
    bankAccount: "Bank hesabı",
    confirmation: "Təsdiq (imza, möhür)",
    bank: "Bank",
    code: "Kod",
    swift: "SWIFT",
    account: "Hesab",
    corrAccount: "Müx. hesab",
    city: "Bakı şəhəri",
    actIntroTemplate: `Bir tərəfdən "{executor}" (bundan sonra - İcraçı), digər tərəfdən "{customer}" (bundan sonra - Sifarişçi) arasında bağlanılan {contractDate} il tarixli, {contractNumber} nömrəli müqaviləyə əsasən İcraçı tərəfindən təhvil verilən malların (göstərilən xidmətlərin) Sifarişçi tərəfindən qəbul edilməsi ilə bağlı bu akt tərtib edilir:`,
    actClause1Template: `1. {dateFrom} - {dateTo} dövrü üzrə təhvil verilmiş malların (göstərilmiş xidmətlərin) dəyəri əlavə dəyər vergisi nəzərə alınmamaqla {subtotal} {currency} təşkil edir.`,
    actClause2: "2. Ödəniş müqavilənin şərtlərinə uyğun olaraq təqdim olunan hesab-faktura (e-qaimə) əsasında nağdsız qaydada aparılır.",
    actClause3: "3. Tərəflərin bir-birinə qarşı keyfiyyət, miqdar və müddət üzrə iddiaları yoxdur. Bu akt Tərəflərin imzaladığı andan qüvvəyə minir və müqavilənin ayrılmaz hissəsidir.",
    position: "Vəzifə",
    fullName: "A.S.A",
    signature: "İmza",
    approve: "Təsdiq edirəm",
    signAndStamp: "(imza və möhür)",
    companyInfo: "ŞİRKƏT HAQQINDA MƏLUMAT",
    description: "Təsvir",
    unit: "Vahid",
    unitPrice: "Qiymət",
    total: "Cəm",
    discount: "Endirim",
    vat: "ƏDV",
    grandTotal: "Yekun",
    unitValue: "AY",
    printButton: "🖨️ Çap et / PDF",
    months: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"],
  },
  ru: {
    invoiceTitle: "СЧЁТ-ФАКТУРА",
    actTitle: "Акт приёма-передачи",
    iApprove: "Утверждаю",
    director: "Директор",
    directorOf: "",
    signatureAndStamp: "(подпись и печать)",
    executor: "Исполнитель",
    customer: "Заказчик",
    companyName: "Наименование",
    voen: "ИНН (VÖEN)",
    address: "Адрес",
    email: "Эл. почта",
    phone: "Телефон",
    documentNumber: "Номер документа",
    documentDate: "Дата документа",
    monthlyReport: "Ежемесячный отчёт",
    servicesProvided: "ОКАЗАННЫЕ ИТ УСЛУГИ",
    unitOfMeasure: "ЕДИНИЦА ИЗМЕРЕНИЯ",
    unitMonth: "МЕСЯЦ",
    unitCompany: "По компании",
    quantity: "КОЛИЧЕСТВО",
    subtotal: "Итого",
    vat18: "НДС 18%",
    totalWithVat: "Итого с НДС",
    bankAccount: "Банковские реквизиты",
    confirmation: "Утверждение (подпись, печать)",
    bank: "Банк",
    code: "Код",
    swift: "SWIFT",
    account: "Счёт",
    corrAccount: "Корр. счёт",
    city: "г. Баку",
    actIntroTemplate: `С одной стороны "{executor}" (далее — Исполнитель), с другой стороны "{customer}" (далее — Заказчик) составили настоящий акт о том, что по договору от {contractDate}, № {contractNumber} Исполнитель передал, а Заказчик принял следующие товары (услуги):`,
    actClause1Template: `1. Стоимость товаров (услуг), переданных за период {dateFrom} - {dateTo}, без учёта НДС составляет {subtotal} {currency}.`,
    actClause2: "2. Оплата производится безналичным расчётом на основании выставленного счёта-фактуры (электронной накладной) в соответствии с условиями договора.",
    actClause3: "3. Стороны не имеют претензий друг к другу по качеству, количеству и срокам. Акт вступает в силу с момента подписания Сторонами и является неотъемлемой частью договора.",
    position: "Должность",
    fullName: "Ф.И.О",
    signature: "Подпись",
    approve: "Утверждаю",
    signAndStamp: "(подпись и печать)",
    companyInfo: "ИНФОРМАЦИЯ О КОМПАНИИ",
    description: "Описание",
    unit: "Единица",
    unitPrice: "Цена",
    total: "Итого",
    discount: "Скидка",
    vat: "НДС",
    grandTotal: "Итого с НДС",
    unitValue: "МЕСЯЦ",
    printButton: "🖨️ Печать / PDF",
    months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  },
  en: {
    invoiceTitle: "INVOICE",
    actTitle: "Acceptance Act",
    iApprove: "Approved by",
    director: "Director",
    directorOf: "of",
    signatureAndStamp: "(signature and stamp)",
    executor: "Service Provider",
    customer: "Client",
    companyName: "Company Name",
    voen: "Tax ID (VOEN)",
    address: "Address",
    email: "Email",
    phone: "Phone",
    documentNumber: "Document No.",
    documentDate: "Document Date",
    monthlyReport: "Monthly Report",
    servicesProvided: "IT SERVICES PROVIDED",
    unitOfMeasure: "UNIT OF MEASURE",
    unitMonth: "MONTH",
    unitCompany: "Per company",
    quantity: "QUANTITY",
    subtotal: "Subtotal",
    vat18: "VAT 18%",
    totalWithVat: "Total incl. VAT",
    bankAccount: "Bank Details",
    confirmation: "Confirmation (signature, stamp)",
    bank: "Bank",
    code: "Code",
    swift: "SWIFT",
    account: "Account",
    corrAccount: "Corr. account",
    city: "Baku city",
    actIntroTemplate: `On one hand "{executor}" (hereinafter referred to as the Contractor), on the other hand "{customer}" (hereinafter referred to as the Client), have drawn up this act confirming that under the agreement dated {contractDate}, No. {contractNumber}, the Contractor has delivered and the Client has accepted the following goods (services):`,
    actClause1Template: `1. The value of the goods (services) delivered for the period {dateFrom} - {dateTo}, excluding VAT, amounts to {subtotal} {currency}.`,
    actClause2: "2. Payment is made by non-cash settlement on the basis of the issued invoice (electronic waybill) in accordance with the terms of the agreement.",
    actClause3: "3. The Parties have no claims against each other as to quality, quantity or timing. This act enters into force when signed by the Parties and is an integral part of the agreement.",
    position: "Position",
    fullName: "Full Name",
    signature: "Signature",
    approve: "Approved by",
    signAndStamp: "(signature and stamp)",
    companyInfo: "COMPANY INFORMATION",
    description: "Description",
    unit: "Unit",
    unitPrice: "Unit Price",
    total: "Total",
    discount: "Discount",
    vat: "VAT",
    grandTotal: "Grand Total",
    unitValue: "MONTH",
    printButton: "🖨️ Print / PDF",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
}

export function getTranslations(lang: string): PdfTranslations {
  return PDF_TRANSLATIONS[(lang as DocLanguage)] || PDF_TRANSLATIONS.az
}

export function formatMonthYear(date: Date, lang: string): string {
  const t = getTranslations(lang)
  return `${t.months[date.getMonth()]} ${date.getFullYear()}`
}

export function formatDate(date: Date | string | null | undefined, lang: string): string {
  if (!date) return "—"
  const d = new Date(date)
  return d.toLocaleDateString(lang === "az" ? "az-AZ" : lang === "ru" ? "ru-RU" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function formatMoney(amount: number, _lang?: string): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function getFirstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function getLastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value)
  }
  return result
}
