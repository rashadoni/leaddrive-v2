// Mappers between the client's xlsx "CRM hesabat" format and our Ticket + ComplaintMeta model.
// Column headers in the source file are Azerbaijani; we accept loose variants to stay tolerant
// across clients who tweak the template slightly.

export type ComplaintRow = {
  externalRegistryNumber: number | null
  customerName: string | null
  requestDate: Date | null
  source: string | null
  complaintType: "complaint" | "suggestion"
  brand: string | null
  productionArea: string | null
  productCategory: string | null
  complaintObject: string | null
  complaintObjectDetail: string | null
  phone: string | null
  content: string
  responsibleDepartment: string | null
  response: string | null
  status: "open" | "in_progress" | "resolved" | "escalated"
  riskLevel: "low" | "medium" | "high" | null
  priority: "low" | "medium" | "high" | "urgent"
}

const HEADER_ALIASES: Record<keyof ComplaintRow | "month" | "year", string[]> = {
  externalRegistryNumber: ["sıra", "sira", "№", "no", "номер"],
  customerName: ["müştərinin ad və soyadı", "müştəri", "ad və soyad", "customer", "клиент", "фио"],
  month: ["ay", "month", "месяц"],
  year: ["il", "year", "год"],
  requestDate: ["müraciət tarixi", "tarix", "date", "дата"],
  source: ["daxil olan şikayət mənbəyi", "mənbə", "source", "источник"],
  complaintType: ["şikayət və ya təklif", "tip", "type", "тип"],
  brand: ["marka", "brand", "бренд"],
  productionArea: ["istehsal sahəsi", "production area"],
  productCategory: ["şikayət və təklif olunan məhsul çeşidi", "məhsul", "product", "продукт"],
  complaintObject: ["şikayət obyekti", "obyekt"],
  complaintObjectDetail: ["şikayət obyekti 2", "obyekt 2", "detail"],
  phone: ["əlaqə nömrəsi", "telefon", "phone", "телефон"],
  content: ["şikayət məzmunu", "məzmun", "content", "описание", "содержание"],
  responsibleDepartment: ["aidiyyatı şöbə (şəxs)", "aidiyyatı şöbə", "şöbə", "department", "отдел"],
  response: ["cavab", "response", "ответ"],
  status: ["status", "статус"],
  riskLevel: ["önəmlilik dərəcəsi", "risk", "приоритет"],
  priority: [],
}

function normalize(h: string): string {
  return h.toLowerCase().replace(/\s+/g, " ").trim()
}

// Resolve which header index corresponds to which logical column. First row = headers.
export function resolveHeaders(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  const normalized = headers.map((h) => normalize(String(h ?? "")))
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias)
      if (idx !== -1) {
        result[key] = idx
        break
      }
    }
  }
  return result
}

export function parseComplaintType(raw: unknown): "complaint" | "suggestion" {
  const s = String(raw ?? "").toLowerCase().trim()
  if (s.includes("təklif") || s.includes("suggestion") || s.includes("предлож")) return "suggestion"
  return "complaint"
}

export function parseRiskLevel(raw: unknown): "low" | "medium" | "high" | null {
  const s = String(raw ?? "").toLowerCase().trim()
  if (!s) return null
  if (s.includes("yüksək") || s.includes("высок") || s.includes("high")) return "high"
  if (s.includes("aşağı") || s.includes("низ") || s.includes("low")) return "low"
  if (s.includes("orta") || s.includes("сред") || s.includes("medium")) return "medium"
  return null
}

export function parseStatus(raw: unknown): "open" | "in_progress" | "resolved" | "escalated" {
  const s = String(raw ?? "").toLowerCase().trim()
  if (s === "ok" || s.includes("resolved") || s.includes("closed") || s.includes("решен")) return "resolved"
  if (s === "not ok" || s.includes("escalat") || s.includes("эскал")) return "escalated"
  if (s.includes("progress") || s.includes("в работе") || s.includes("iş")) return "in_progress"
  return "open"
}

export function riskToPriority(r: "low" | "medium" | "high" | null): "low" | "medium" | "high" | "urgent" {
  if (r === "high") return "high"
  if (r === "low") return "low"
  return "medium"
}

export function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return raw
  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = (raw - 25569) * 86400 * 1000
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === "string") {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function normalizeSource(raw: unknown): string | null {
  const s = String(raw ?? "").toLowerCase().trim()
  if (!s) return null
  if (s.includes("qaynar") || s.includes("горяч") || s.includes("hotline")) return "hotline"
  if (s.includes("e-poçt") || s.includes("email") || s.includes("почт")) return "email"
  if (s.includes("nümayəndə") || s.includes("торг") || s.includes("sales")) return "sales_rep"
  if (s.includes("whatsapp")) return "whatsapp"
  if (s.includes("instagram")) return "instagram"
  if (s.includes("facebook")) return "facebook"
  if (s.includes("telegram")) return "telegram"
  if (s.includes("portal") || s.includes("web")) return "web_chat"
  return s.slice(0, 40)
}

function cell(row: unknown[], idx: number | undefined): unknown {
  if (idx === undefined || idx < 0) return null
  return row[idx] ?? null
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

export function rowToComplaint(row: unknown[], headers: Record<string, number>): ComplaintRow | null {
  const content = str(cell(row, headers.content))
  const customer = str(cell(row, headers.customerName))
  // Skip truly empty rows (no content AND no customer)
  if (!content && !customer) return null

  const risk = parseRiskLevel(cell(row, headers.riskLevel))
  const numRaw = cell(row, headers.externalRegistryNumber)
  const num = typeof numRaw === "number" ? numRaw : Number(str(numRaw) ?? NaN)

  return {
    externalRegistryNumber: Number.isFinite(num) ? num : null,
    customerName: customer,
    requestDate: parseDate(cell(row, headers.requestDate)),
    source: normalizeSource(cell(row, headers.source)),
    complaintType: parseComplaintType(cell(row, headers.complaintType)),
    brand: str(cell(row, headers.brand)),
    productionArea: str(cell(row, headers.productionArea)),
    productCategory: str(cell(row, headers.productCategory)),
    complaintObject: str(cell(row, headers.complaintObject)),
    complaintObjectDetail: str(cell(row, headers.complaintObjectDetail)),
    phone: str(cell(row, headers.phone)),
    content: content ?? "",
    responsibleDepartment: str(cell(row, headers.responsibleDepartment)),
    response: str(cell(row, headers.response)),
    status: parseStatus(cell(row, headers.status)),
    riskLevel: risk,
    priority: riskToPriority(risk),
  }
}

// Reverse: format a complaint record back into xlsx row in the original column order.
export const EXPORT_HEADERS = [
  "Sıra",
  "Müştərinin ad və soyadı",
  "Ay",
  "Il",
  "Müraciət tarixi",
  "Daxil olan şikayət mənbəyi",
  "Şikayət və ya təklif",
  "Marka",
  "İstehsal Sahəsi",
  "Şikayət və təklif olunan məhsul çeşidi",
  "Şikayət obyekti",
  "Şikayət obyekti 2",
  "Əlaqə nömrəsi",
  "Şikayət məzmunu",
  "Aidiyyatı şöbə (şəxs)",
  "Cavab",
  "Status",
  "Önəmlilik dərəcəsi",
] as const

const AZ_MONTHS = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun",
  "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr",
]

export function complaintToExportRow(c: ComplaintRow): (string | number | Date | null)[] {
  const d = c.requestDate
  return [
    c.externalRegistryNumber,
    c.customerName,
    d ? AZ_MONTHS[d.getMonth()] : null,
    d ? d.getFullYear() : null,
    d,
    c.source,
    c.complaintType === "suggestion" ? "təklif" : "şikayət",
    c.brand,
    c.productionArea,
    c.productCategory,
    c.complaintObject,
    c.complaintObjectDetail,
    c.phone,
    c.content,
    c.responsibleDepartment,
    c.response,
    c.status === "resolved" ? "ok" : c.status === "escalated" ? "not ok" : c.status,
    c.riskLevel === "high" ? "yüksək riskli" : c.riskLevel === "low" ? "aşağı riskli" : c.riskLevel === "medium" ? "orta riskli" : null,
  ]
}
