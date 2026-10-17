export type BuilderLocale = "ru" | "az" | "en"
export type BuilderEntity = "company" | "contact" | "deal"
export type BuilderResource = "customers" | "contacts" | "deals"
export interface BuilderField { key: string; entity: BuilderEntity; kind: "text" | "decimal" | "date" | "number" | "boolean"; label: Record<BuilderLocale, string> }

const field = (entity: BuilderEntity, name: string, kind: BuilderField["kind"], ru: string, az: string, en: string): BuilderField => ({ key: `${entity}.${name}`, entity, kind, label: { ru, az, en } })

/** Explicit business-field catalogue; no raw rows, credentials, notes or metadata. */
export const BUILDER_FIELDS: readonly BuilderField[] = [
  field("company", "id", "text", "ID клиента", "Müştəri ID-si", "Customer ID"),
  field("company", "name", "text", "Название клиента", "Müştərinin adı", "Customer name"),
  field("company", "email", "text", "Email клиента", "Müştərinin email-i", "Customer email"),
  field("company", "phone", "text", "Телефон клиента", "Müştərinin telefonu", "Customer phone"),
  field("company", "voen", "text", "Налоговый номер", "VÖEN", "Tax number"),
  field("company", "country", "text", "Страна", "Ölkə", "Country"),
  field("company", "city", "text", "Город", "Şəhər", "City"),
  field("company", "address", "text", "Адрес", "Ünvan", "Address"),
  field("company", "website", "text", "Сайт", "Sayt", "Website"),
  field("company", "industry", "text", "Отрасль", "Sahə", "Industry"),
  field("company", "status", "text", "Статус клиента", "Müştəri statusu", "Customer status"),
  field("company", "category", "text", "Категория клиента", "Müştəri kateqoriyası", "Customer category"),
  field("company", "leadStatus", "text", "Статус лида", "Lid statusu", "Lead status"),
  field("company", "createdAt", "date", "Клиент создан", "Müştəri yaradılıb", "Customer created"),
  field("company", "updatedAt", "date", "Клиент изменён", "Müştəri dəyişdirilib", "Customer updated"),
  field("contact", "id", "text", "ID контакта", "Əlaqə ID-si", "Contact ID"),
  field("contact", "companyId", "text", "Клиент контакта", "Əlaqənin müştərisi", "Contact customer ID"),
  field("contact", "fullName", "text", "Имя контакта", "Əlaqənin adı", "Contact name"),
  field("contact", "email", "text", "Email контакта", "Əlaqənin email-i", "Contact email"),
  field("contact", "phone", "text", "Телефон контакта", "Əlaqənin telefonu", "Contact phone"),
  field("contact", "position", "text", "Должность", "Vəzifə", "Position"),
  field("contact", "department", "text", "Отдел", "Şöbə", "Department"),
  field("contact", "isActive", "boolean", "Контакт активен", "Əlaqə aktivdir", "Contact active"),
  field("contact", "lifecycleStage", "text", "Этап контакта", "Əlaqə mərhələsi", "Contact stage"),
  field("deal", "id", "text", "ID сделки", "Sövdələşmə ID-si", "Deal ID"),
  field("deal", "companyId", "text", "Клиент сделки", "Sövdələşmənin müştərisi", "Deal customer ID"),
  field("deal", "name", "text", "Название сделки", "Sövdələşmənin adı", "Deal name"),
  field("deal", "pipelineId", "text", "Воронка", "Satış hunisi", "Pipeline"),
  field("deal", "stage", "text", "Этап сделки", "Sövdələşmə mərhələsi", "Deal stage"),
  field("deal", "valueAmount", "decimal", "Сумма сделки", "Sövdələşmənin məbləği", "Deal amount"),
  field("deal", "currency", "text", "Валюта", "Valyuta", "Currency"),
  field("deal", "probability", "number", "Вероятность, %", "Ehtimal, %", "Probability, %"),
  field("deal", "expectedClose", "date", "Ожидаемая дата закрытия", "Gözlənilən bağlanma tarixi", "Expected close date"),
  field("deal", "createdAt", "date", "Сделка создана", "Sövdələşmə yaradılıb", "Deal created"),
  field("deal", "updatedAt", "date", "Сделка изменена", "Sövdələşmə dəyişdirilib", "Deal updated"),
]

export function fieldsForResource(resource: BuilderResource, catalogue: readonly BuilderField[] = BUILDER_FIELDS) {
  const entities = resource === "customers" ? ["company"] : resource === "contacts" ? ["company", "contact"] : ["company", "deal"]
  return catalogue.filter((entry) => entities.includes(entry.entity))
}

export const CONTEXT_FIELDS = ["schemaVersion", "eventId", "externalId", "entityVersion", "occurredAt", "sourceSystem", "customerExternalId"] as const

const CUSTOM_FIELD_KINDS: Record<string, BuilderField["kind"]> = { text: "text", textarea: "text", email: "text", phone: "text", select: "text", number: "decimal", date: "date", checkbox: "boolean" }

/** Tenant catalogue = fixed fields + active, supported custom field definitions. */
export function catalogueWithCustomFields(fields: readonly { id: string; entityType: string; fieldLabel: string; fieldType: string }[]): BuilderField[] {
  if (fields.length > 500) throw new Error("custom_field_catalogue_limit")
  return [...BUILDER_FIELDS, ...fields.filter((entry) => CUSTOM_FIELD_KINDS[entry.fieldType] && ["company", "contact", "deal"].includes(entry.entityType)).map((entry) => ({ key: `custom.${entry.entityType}.${entry.id}`, entity: entry.entityType as BuilderEntity, kind: CUSTOM_FIELD_KINDS[entry.fieldType], label: { ru: entry.fieldLabel, az: entry.fieldLabel, en: entry.fieldLabel } }))]
}
