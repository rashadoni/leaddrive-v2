/**
 * What an import can create and how a header in the customer's file is
 * recognised (task 7.4). A header is normalised — lower case, letters and
 * digits only, Azerbaijani and Russian letters kept — and looked up among the
 * synonyms of each field in az, ru and en.
 */
export const IMPORT_ENTITIES = ["companies", "suppliers", "contacts", "products"] as const
export type ImportEntity = (typeof IMPORT_ENTITIES)[number]

export interface ImportField { key: string; required?: boolean; synonyms: string[] }

const COMPANY_FIELDS: ImportField[] = [
  { key: "name", required: true, synonyms: ["name", "company", "companyname", "название", "компания", "наименование", "şirkət", "şirkətinadı", "ad", "adı"] },
  { key: "voen", synonyms: ["voen", "vöen", "taxid", "inn", "инн", "vergi"] },
  { key: "phone", synonyms: ["phone", "tel", "telephone", "телефон", "telefon", "mobil"] },
  { key: "email", synonyms: ["email", "mail", "e-mail", "почта", "epoçt", "epoçta", "elektronpoçt"] },
  { key: "website", synonyms: ["website", "site", "url", "сайт", "sayt", "veb"] },
  { key: "address", synonyms: ["address", "адрес", "ünvan"] },
  { key: "city", synonyms: ["city", "город", "şəhər"] },
  { key: "industry", synonyms: ["industry", "sector", "отрасль", "sahə", "sektor"] },
  { key: "director", synonyms: ["director", "директор", "руководитель", "rəhbər", "direktor"] },
  { key: "description", synonyms: ["note", "notes", "description", "comment", "заметка", "примечание", "комментарий", "qeyd", "şərh"] },
]

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  companies: COMPANY_FIELDS,
  suppliers: COMPANY_FIELDS,
  contacts: [
    { key: "fullName", required: true, synonyms: ["name", "fullname", "контакт", "фио", "имя", "adsoyad", "ad", "adı", "soyadad", "əlaqə"] },
    { key: "phone", synonyms: ["phone", "tel", "telephone", "mobile", "телефон", "мобильный", "telefon", "mobil"] },
    { key: "email", synonyms: ["email", "mail", "e-mail", "почта", "epoçt", "epoçta"] },
    { key: "position", synonyms: ["position", "title", "role", "должность", "vəzifə"] },
    { key: "companyName", synonyms: ["company", "companyname", "компания", "организация", "şirkət"] },
    { key: "category", synonyms: ["category", "segment", "категория", "kateqoriya"] },
    { key: "source", synonyms: ["source", "источник", "mənbə"] },
  ],
  products: [
    { key: "name", required: true, synonyms: ["name", "product", "item", "товар", "название", "наименование", "məhsul", "mal", "ad", "adı"] },
    { key: "sku", synonyms: ["sku", "code", "article", "артикул", "код", "kod", "artikul"] },
    { key: "price", synonyms: ["price", "цена", "qiymət", "stoimost"] },
    { key: "currency", synonyms: ["currency", "валюта", "valyuta"] },
    { key: "category", synonyms: ["category", "категория", "kateqoriya"] },
    { key: "description", synonyms: ["description", "описание", "təsvir", "note", "qeyd"] },
  ],
}

export function normaliseHeader(header: string): string {
  return header.toLowerCase().normalize("NFC").replace(/[^a-z0-9а-яёəğıöşüçİ-]/giu, "").replace(/-/g, "")
}

/** The field each column most likely holds, or null — the person adjusts it on the screen. */
export function suggestMapping(headers: readonly string[], entity: ImportEntity): (string | null)[] {
  const used = new Set<string>()
  return headers.map((header) => {
    const norm = normaliseHeader(header)
    const field = IMPORT_FIELDS[entity].find((candidate) => !used.has(candidate.key) && (candidate.key.toLowerCase() === norm || candidate.synonyms.some((s) => normaliseHeader(s) === norm)))
    if (!field) return null
    used.add(field.key)
    return field.key
  })
}
