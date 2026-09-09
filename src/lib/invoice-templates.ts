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
    actIntroTemplate: `Bir tərəfdən "{executor}" (bundan sonra - İcraçı), digər tərəfdən "{customer}" (bundan sonra - Sifarişçi) arasında bağlanılan {contractDate} il tarixli, {contractNumber} nömrəli "İnformasiya Texnologiyaları üzrə xidmətlərin təşkili və göstərilməsinə dair" müqaviləyə əlavə olaraq, İcraçı tərəfindən göstərilən İT xidmətlərin Sifarişçi tərəfindən təhvil alınması ilə bağlı akt tərtib edilir:`,
    actClause1Template: `1. Müqavilə şərtlərinə və bu Əlavəyə əsasən, İcraçı tərəfindən aylıq göstərilən İT xidmətlərə görə {dateFrom} - {dateTo} dövr üçün ödəniləcək məbləğ əlavə dəyər vergisi (ƏDV 18%) nəzərə alınmamaqla {subtotal} {currency} ({subtotalWords}) təşkil edir.`,
    actClause2: "2. Bu Əlavə üzrə ödənişlər hər xidmət ayının sonuncu iş günü İcraçı tərəfindən təqdim olunan müvafiq ödəniş sənədlərinə (hesab-faktura, e-qaimə və s.) və təhvil-təslim aktlarına əsasən 15 (on beş) iş günü ərzində Sifarişçi tərəfindən nağdsız hesablaşmalar qaydasında aparılır.",
    actClause3: "3. Hazırkı Əlavə üzrə hər təqvim ayının sonuncu iş günü Tərəflər arasında imzalanacaq Təhvil-Təslim Aktı müvafiq hesablaşmaların aparılmasına əsasdır. Bu sənədlər imzalandıqları andan hüquqi qüvvəyə minəcək və Müqavilənin ayrılmaz hissəsi hesab olunacaqlar.",
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
    actIntroTemplate: `С одной стороны "{executor}" (далее — Исполнитель), с другой стороны "{customer}" (далее — Заказчик) в соответствии с договором от {contractDate}, № {contractNumber} "Об организации и предоставлении услуг в сфере информационных технологий", составлен акт приёма ИТ услуг, оказанных Исполнителем:`,
    actClause1Template: `1. Согласно условиям Договора и настоящего Приложения, сумма за ежемесячные ИТ услуги, оказанные Исполнителем за период {dateFrom} - {dateTo}, без учёта НДС (18%) составляет {subtotal} {currency} ({subtotalWords}).`,
    actClause2: "2. Оплата по настоящему Приложению производится Заказчиком безналичным расчётом в течение 15 (пятнадцати) рабочих дней на основании соответствующих платёжных документов (счёт-фактура, электронная накладная и т.д.) и актов приёма-передачи, предоставленных Исполнителем в последний рабочий день каждого месяца обслуживания.",
    actClause3: "3. Акт приёма-передачи, подписываемый Сторонами в последний рабочий день каждого календарного месяца по настоящему Приложению, является основанием для проведения соответствующих расчётов. Данные документы вступают в юридическую силу с момента их подписания и считаются неотъемлемой частью Договора.",
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
    actIntroTemplate: `On one hand "{executor}" (hereinafter referred to as the Contractor), on the other hand "{customer}" (hereinafter referred to as the Client), in accordance with the agreement dated {contractDate}, No. {contractNumber} "On the organization and provision of information technology services", this acceptance act for IT services provided by the Contractor is drawn up:`,
    actClause1Template: `1. In accordance with the terms of the Agreement and this Appendix, the amount payable for monthly IT services provided by the Contractor for the period {dateFrom} - {dateTo}, excluding VAT (18%), amounts to {subtotal} {currency} ({subtotalWords}).`,
    actClause2: "2. Payments under this Appendix shall be made by the Client via non-cash settlement within 15 (fifteen) business days based on the relevant payment documents (invoice, electronic waybill, etc.) and acceptance acts submitted by the Contractor on the last business day of each service month.",
    actClause3: "3. The Acceptance Act signed by the Parties on the last business day of each calendar month under this Appendix shall serve as the basis for the relevant settlements. These documents shall enter into legal force from the moment of their signing and shall be deemed an integral part of the Agreement.",
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
