/**
 * Excel import of field clients («Клиенты»: doctors, pharmacists, others).
 *
 * Why it exists: every pharma tenant arrives with its doctor base in a
 * spreadsheet, and until 2026-10 the only way in was one API call per doctor
 * (the CUSTOMERS import creates institutions, not people).
 *
 * The rules, in the order a row meets them:
 *
 *  - **Create only.** A row never changes an existing client. A code that is
 *    already in the organization — even on a deleted client, the unique index
 *    counts those — is a row error, not an update.
 *  - **Placeholders are empty.** «[Адрес ожидает обработки]», «Təyin
 *    edilməyib», «-» and the like are what source systems print for "nothing";
 *    they are read as an empty cell, in every column.
 *  - **Institution.** `institution_code` must name an existing institution; an
 *    unknown code is a row error (a code never creates anything). Without a
 *    code, `institution_name` is matched ignoring letter case and spacing; if
 *    no institution has that name it is **created** from the name and the
 *    address/city of the first row that carries them. The owner's real files
 *    list the workplace by name on every row and have no institution codes, so
 *    refusing unknown names would turn a doctor file into two files to prepare
 *    by hand. Spellings that differ by more than case («saylı» / «nömrəli»,
 *    «№5») stay separate institutions and are reported as warnings.
 *  - **Last name.** An empty one is a row error — the card requires it. A
 *    dash typed there on purpose («—») is accepted with a warning and the
 *    client is listed under the first name: that is how the owner had the
 *    surname-less rows of the first real base loaded (2026-10-03), to be
 *    corrected on the card later instead of being left out.
 *  - **Same person twice.** The same name at the same institution, in the file
 *    or already in the base, is a row error; a different patronymic on both
 *    sides tells two people apart.
 *  - **Required fields** follow the tenant's client-card settings, exactly as
 *    the single-client endpoint does.
 *  - **Owner.** `agent_code_or_email` must name an active field agent inside
 *    the importer's scope. Ownership is written by `executeContactAssignment`,
 *    the same code the assignment endpoint runs.
 *
 * Nothing is written during validation. Apply runs in the import job's
 * transaction and re-reads whatever validation resolved, because a validated
 * job can wait for its "apply" as long as the administrator likes.
 */
import type { MtmContactType, MtmCustomerObjectType, Prisma } from "@prisma/client"
import { getMtmExcelContract, type MtmExcelLocale, type MtmExcelRowError, type ParsedMtmWorkbook } from "@/lib/mtm/excel-contract"
import type { MtmExcelSnapshotRow } from "@/lib/mtm/excel-import"
import { isAgentInRouteScope, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData, contactDisplayName } from "@/lib/mtm/field-scope"
import {
  effectiveMtmContactRequiredFields,
  missingMtmContactRequiredFields,
  type MtmContactRequiredField,
} from "@/lib/mtm/contact-required-fields"
import { contactSpecialtyKey, MTM_CONTACT_SPECIALTY_MAX_LENGTH } from "@/lib/mtm/contact-specialties"
import {
  buildContactAssignmentPreview,
  contactAssignmentRequestHash,
  executeContactAssignment,
} from "@/lib/mtm/contact-bulk-assignment"

export const MTM_CONTACT_IMPORT_SOURCE = "EXCEL_IMPORT"
/** The assignment endpoint accepts at most this many contacts per batch. */
const ASSIGNMENT_BATCH = 500
const QUERY_BATCH = 5_000

type ContactImportReadDb = Pick<Prisma.TransactionClient, "mtmContact" | "mtmCustomer" | "mtmAgent">

export interface MtmContactImportPolicy {
  /** MTM setting `contactRequiredFields`. */
  requiredFields?: unknown
  /** MTM setting `contactHiddenFields`. */
  hiddenFields?: unknown
  /** MTM setting `contactSpecialties`: the tenant's own list. */
  specialties?: readonly string[]
}

interface NewInstitution {
  /** Name folded for comparison; rows that share it share the institution. */
  key: string
  name: string
  address: string | null
  city: string | null
  objectType: MtmCustomerObjectType
}

interface ContactRowData {
  externalCode: string
  lastName: string
  firstName: string
  middleName: string | null
  displayName: string
  type: MtmContactType
  specialtyName: string | null
  phone: string | null
  notes: string | null
  institutionId: string | null
  institutionName: string | null
  newInstitution: NewInstitution | null
  agentId: string | null
  agentName: string | null
}

// ─── Text handling ───────────────────────────────────────────────────────

/**
 * One spelling for comparison: case, spacing and the four Azerbaijani/Turkish
 * i's folded (plain lowercasing leaves İ as i + a combining dot, ı as itself).
 */
function textKey(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase().replace(/̇/g, "").replace(/ı/g, "i")
}

/** textKey plus Latin look-alikes: «Hüseynov» typed on an English keyboard is «Huseynov». */
function asciiKey(value: string): string {
  return textKey(value)
    .replace(/ə/g, "e")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
}

const PLACEHOLDER_KEYS = new Set([
  "teyin edilmeyib",
  "teyin olunmayib",
  "melum deyil",
  "yoxdur",
  "не указано",
  "не указан",
  "не указана",
  "не назначено",
  "не назначен",
  "нет данных",
  "нет",
  "n/a",
  "#n/a",
  "none",
  "null",
  "unknown",
])

function isPlaceholder(value: string): boolean {
  // «[Адрес ожидает обработки]»: a bracketed note is a status, never a value.
  if (/^\[.*\]$/.test(value)) return true
  if (/^[-–—_.\s]+$/.test(value)) return true
  return PLACEHOLDER_KEYS.has(asciiKey(value).replace(/[.!]+$/, ""))
}

/** A cell as one line of text; a placeholder is an empty cell. */
function cleanCell(value: unknown): string {
  const raw = value == null ? "" : String(value).normalize("NFC").replace(/\s+/g, " ").trim()
  return raw && !isPlaceholder(raw) ? raw : ""
}

/** A dash in the last-name cell: "not known yet", said on purpose. */
function isDash(value: unknown): boolean {
  return /^[-–—]+$/.test(value == null ? "" : String(value).trim())
}

const UNKNOWN_LAST_NAME = "—"

/** Notes keep their line breaks. */
function cleanNote(value: unknown): string {
  const raw = value == null ? "" : String(value).normalize("NFC").trim()
  return raw && !isPlaceholder(raw.replace(/\s+/g, " ")) ? raw : ""
}

/**
 * Who a row is, for "the same person twice": last and first name as a bag of
 * words, so a file with the two columns swapped still meets itself.
 */
function personKey(lastName: string, firstName: string): string {
  return asciiKey(`${lastName} ${firstName}`).split(" ").filter(Boolean).sort().join(" ")
}

const INSTITUTION_NUMBER_WORDS = new Set(["sayli", "nomreli", "nomre", "no", "n", "номер"])

/**
 * A looser spelling used only to warn: «5 saylı poliklinika», «5 nömrəli
 * Poliklinika» and «Poliklinika №5» all become the same bag of words. It never
 * decides which institution a row belongs to.
 */
function institutionLooseKey(name: string): string {
  return asciiKey(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token && !INSTITUTION_NUMBER_WORDS.has(token))
    .sort()
    .join(" ")
}

// ─── Messages ────────────────────────────────────────────────────────────
//
// Row messages are stored on the job and shown as written, so they are
// produced in the uploader's language. The reader is a tenant administrator
// fixing a spreadsheet, not a developer: each one says what to change.

type UnsupportedRequiredField = Exclude<
  MtmContactRequiredField,
  "firstName" | "lastName" | "middleName" | "externalCode" | "specialtyName" | "phone"
>

interface ContactImportMessages {
  codeRequired: string
  lastNameRequired: string
  lastNameOnlyFirst: (firstName: string) => string
  lastNameUnknown: string
  firstNameRequired: string
  tooLong: (max: number) => string
  templateExample: string
  invalidType: (value: string) => string
  duplicateInFile: (row: number) => string
  alreadyExists: (name: string) => string
  alreadyExistsDeleted: string
  requiredBySettings: string
  requiredNotInTemplate: (fields: string) => string
  institutionCodeNotFound: (code: string) => string
  institutionInactive: (name: string) => string
  institutionAmbiguous: (name: string, count: number) => string
  duplicatePersonInFile: (row: number) => string
  duplicatePersonExisting: (name: string) => string
  agentNotFound: (value: string) => string
  agentAmbiguous: (value: string) => string
  agentInactive: (name: string) => string
  agentNotFieldAgent: (name: string) => string
  agentOutsideScope: (name: string) => string
  nearDuplicate: (name: string, others: string) => string
  nameMismatch: (code: string, existing: string) => string
  addressDiffers: (row: number) => string
  noInstitution: string
  specialtyNotInList: (value: string, count: number) => string
  newInstitution: (name: string) => string
  fields: Record<UnsupportedRequiredField, string>
}

const MESSAGES: Record<MtmExcelLocale, ContactImportMessages> = {
  en: {
    codeRequired: "The client code is empty.",
    lastNameRequired: "The last name is empty.",
    lastNameOnlyFirst: (firstName) => `Only a first name is given («${firstName}»). A client needs a last name. If it is not known yet, type a dash (—) and correct the card later.`,
    lastNameUnknown: "The last name is a dash: the client is created under the first name only. Correct the card when the last name is known.",
    firstNameRequired: "The first name is empty.",
    tooLong: (max) => `The value is longer than ${max} characters.`,
    templateExample: "This is the example row from the template. Delete it and upload the file again.",
    invalidType: (value) => `Unknown client type «${value}». Use doctor, pharmacist or other.`,
    duplicateInFile: (row) => `This code is also on row ${row}. Each client needs its own code.`,
    alreadyExists: (name) => `A client with this code already exists: ${name}. The import does not overwrite clients.`,
    alreadyExistsDeleted: "This code belongs to a deleted client. Use another code or restore that client.",
    requiredBySettings: "Your client card settings make this field required.",
    requiredNotInTemplate: (fields) => `Your client card settings require ${fields}, and this file has no column for it. Make it optional in the MTM settings, or add these clients by hand.`,
    institutionCodeNotFound: (code) => `No institution has the code «${code}». Clear the code to find or create the institution by its name.`,
    institutionInactive: (name) => `The institution «${name}» is inactive. Activate it or choose another one.`,
    institutionAmbiguous: (name, count) => `${count} institutions are named «${name}». Fill institution_code to say which one.`,
    duplicatePersonInFile: (row) => `The same person at the same institution is already on row ${row}.`,
    duplicatePersonExisting: (name) => `This person already exists at this institution: ${name}.`,
    agentNotFound: (value) => `No employee has the code or e-mail «${value}».`,
    agentAmbiguous: (value) => `«${value}» matches several employees. Use the employee's external code.`,
    agentInactive: (name) => `«${name}» is not active and cannot be given clients.`,
    agentNotFieldAgent: (name) => `«${name}» is not a field agent; clients are assigned to field agents only.`,
    agentOutsideScope: (name) => `«${name}» is not in your team.`,
    nearDuplicate: (name, others) => `«${name}» looks like ${others}. If it is the same institution, use one spelling — otherwise they stay separate institutions.`,
    nameMismatch: (code, existing) => `The code «${code}» belongs to «${existing}»; the name in the file is different. The code is used.`,
    addressDiffers: (row) => `Row ${row} gives another address for the same new institution; the first address is kept.`,
    noInstitution: "No institution: the client will be created without a workplace.",
    specialtyNotInList: (value, count) => `«${value}» is not in your specialty list (${count} rows). It is saved as written.`,
    newInstitution: (name) => `${name} (new)`,
    fields: {
      birthDate: "Date of birth",
      gender: "Gender",
      qualificationCategory: "Qualification category",
      profile: "Profile",
      email: "E-mail",
      mobilePhone: "Mobile phone",
      workPhone: "Work phone",
      messengerPhone: "Messenger phone",
      postalCode: "Postal code",
      addressRegion: "Region",
      addressLocality: "City or town",
      addressDistrict: "District",
      addressStreet: "Street address",
      productCategory: "Product category",
    },
  },
  ru: {
    codeRequired: "Код клиента пуст.",
    lastNameRequired: "Фамилия пуста.",
    lastNameOnlyFirst: (firstName) => `Указано только имя («${firstName}»). Клиенту нужна фамилия. Если она пока неизвестна, поставьте прочерк (—) и исправьте карточку позже.`,
    lastNameUnknown: "Вместо фамилии прочерк: клиент будет создан только с именем. Исправьте карточку, когда фамилия станет известна.",
    firstNameRequired: "Имя пусто.",
    tooLong: (max) => `Значение длиннее ${max} символов.`,
    templateExample: "Это строка с примером из шаблона. Удалите её и загрузите файл снова.",
    invalidType: (value) => `Неизвестный тип клиента «${value}». Укажите doctor, pharmacist или other.`,
    duplicateInFile: (row) => `Этот код есть и в строке ${row}. У каждого клиента должен быть свой код.`,
    alreadyExists: (name) => `Клиент с таким кодом уже есть: ${name}. Импорт не перезаписывает клиентов.`,
    alreadyExistsDeleted: "Этот код принадлежит удалённому клиенту. Укажите другой код или восстановите того клиента.",
    requiredBySettings: "По настройкам карточки клиента это поле обязательно.",
    requiredNotInTemplate: (fields) => `Настройки карточки клиента требуют: ${fields}, а в этом файле для этого нет столбца. Сделайте поле необязательным в настройках MTM или добавьте этих клиентов вручную.`,
    institutionCodeNotFound: (code) => `Учреждения с кодом «${code}» нет. Очистите код, чтобы найти или создать учреждение по названию.`,
    institutionInactive: (name) => `Учреждение «${name}» неактивно. Активируйте его или выберите другое.`,
    institutionAmbiguous: (name, count) => `Учреждений с названием «${name}»: ${count}. Укажите institution_code, чтобы выбрать нужное.`,
    duplicatePersonInFile: (row) => `Этот же человек в этом же учреждении уже есть в строке ${row}.`,
    duplicatePersonExisting: (name) => `Этот человек уже есть в этом учреждении: ${name}.`,
    agentNotFound: (value) => `Сотрудника с кодом или e-mail «${value}» нет.`,
    agentAmbiguous: (value) => `«${value}» подходит нескольким сотрудникам. Укажите внешний код сотрудника.`,
    agentInactive: (name) => `«${name}» неактивен, за ним нельзя закрепить клиента.`,
    agentNotFieldAgent: (name) => `«${name}» — не полевой сотрудник; клиенты закрепляются только за полевыми сотрудниками.`,
    agentOutsideScope: (name) => `«${name}» не входит в вашу команду.`,
    nearDuplicate: (name, others) => `«${name}» похоже на ${others}. Если это одно учреждение, используйте одно написание — иначе останутся отдельные учреждения.`,
    nameMismatch: (code, existing) => `Код «${code}» принадлежит учреждению «${existing}»; название в файле другое. Используется код.`,
    addressDiffers: (row) => `В строке ${row} для этого же нового учреждения указан другой адрес; сохранён первый.`,
    noInstitution: "Учреждение не указано: клиент будет создан без места работы.",
    specialtyNotInList: (value, count) => `«${value}» нет в вашем списке специальностей (строк: ${count}). Сохранится как написано.`,
    newInstitution: (name) => `${name} (новое)`,
    fields: {
      birthDate: "Дата рождения",
      gender: "Пол",
      qualificationCategory: "Квалификационная категория",
      profile: "Профиль",
      email: "E-mail",
      mobilePhone: "Мобильный телефон",
      workPhone: "Рабочий телефон",
      messengerPhone: "Телефон для мессенджеров",
      postalCode: "Почтовый индекс",
      addressRegion: "Регион",
      addressLocality: "Населённый пункт",
      addressDistrict: "Район",
      addressStreet: "Улица и дом",
      productCategory: "Категория продукции",
    },
  },
  az: {
    codeRequired: "Müştəri kodu boşdur.",
    lastNameRequired: "Soyad boşdur.",
    lastNameOnlyFirst: (firstName) => `Yalnız ad yazılıb («${firstName}»). Müştəri üçün soyad lazımdır. Hələ məlum deyilsə, tire (—) qoyun və kartı sonra düzəldin.`,
    lastNameUnknown: "Soyad əvəzinə tire yazılıb: müştəri yalnız adla yaradılacaq. Soyad məlum olanda kartı düzəldin.",
    firstNameRequired: "Ad boşdur.",
    tooLong: (max) => `Dəyər ${max} simvoldan uzundur.`,
    templateExample: "Bu, şablondakı nümunə sətridir. Onu silin və faylı yenidən yükləyin.",
    invalidType: (value) => `«${value}» müştəri növü tanınmır. doctor, pharmacist və ya other yazın.`,
    duplicateInFile: (row) => `Bu kod ${row} nömrəli sətirdə də var. Hər müştərinin öz kodu olmalıdır.`,
    alreadyExists: (name) => `Bu kodla müştəri artıq var: ${name}. İdxal mövcud müştərilərin üzərinə yazmır.`,
    alreadyExistsDeleted: "Bu kod silinmiş müştəriyə aiddir. Başqa kod yazın və ya həmin müştərini bərpa edin.",
    requiredBySettings: "Müştəri kartının ayarlarına görə bu xana məcburidir.",
    requiredNotInTemplate: (fields) => `Müştəri kartının ayarları bunu tələb edir: ${fields}, bu faylda isə bunun üçün sütun yoxdur. MTM ayarlarında xananı məcburi olmayan edin və ya bu müştəriləri əl ilə əlavə edin.`,
    institutionCodeNotFound: (code) => `«${code}» kodlu müəssisə yoxdur. Müəssisəni adı ilə tapmaq və ya yaratmaq üçün kodu silin.`,
    institutionInactive: (name) => `«${name}» müəssisəsi aktiv deyil. Onu aktivləşdirin və ya başqasını seçin.`,
    institutionAmbiguous: (name, count) => `«${name}» adlı ${count} müəssisə var. Hansı olduğunu institution_code ilə göstərin.`,
    duplicatePersonInFile: (row) => `Eyni şəxs eyni müəssisədə artıq ${row} nömrəli sətirdə var.`,
    duplicatePersonExisting: (name) => `Bu şəxs həmin müəssisədə artıq var: ${name}.`,
    agentNotFound: (value) => `«${value}» kodu və ya e-poçtu olan əməkdaş yoxdur.`,
    agentAmbiguous: (value) => `«${value}» bir neçə əməkdaşa uyğun gəlir. Əməkdaşın xarici kodunu yazın.`,
    agentInactive: (name) => `«${name}» aktiv deyil, ona müştəri təhkim etmək olmaz.`,
    agentNotFieldAgent: (name) => `«${name}» sahə əməkdaşı deyil; müştərilər yalnız sahə əməkdaşlarına təhkim olunur.`,
    agentOutsideScope: (name) => `«${name}» sizin komandanızda deyil.`,
    nearDuplicate: (name, others) => `«${name}» ${others} ilə oxşardır. Eyni müəssisədirsə, bir yazılışdan istifadə edin — əks halda ayrı müəssisələr kimi qalacaq.`,
    nameMismatch: (code, existing) => `«${code}» kodu «${existing}» müəssisəsinə aiddir; fayldakı ad fərqlidir. Kod əsas götürülür.`,
    addressDiffers: (row) => `${row} nömrəli sətirdə eyni yeni müəssisə üçün başqa ünvan yazılıb; ilk ünvan saxlanılır.`,
    noInstitution: "Müəssisə göstərilməyib: müştəri iş yeri olmadan yaradılacaq.",
    specialtyNotInList: (value, count) => `«${value}» ixtisas siyahınızda yoxdur (${count} sətir). Yazıldığı kimi saxlanılacaq.`,
    newInstitution: (name) => `${name} (yeni)`,
    fields: {
      birthDate: "Doğum tarixi",
      gender: "Cins",
      qualificationCategory: "İxtisas dərəcəsi",
      profile: "Profil",
      email: "E-poçt",
      mobilePhone: "Mobil telefon",
      workPhone: "İş telefonu",
      messengerPhone: "Messencer telefonu",
      postalCode: "Poçt indeksi",
      addressRegion: "Region",
      addressLocality: "Yaşayış məntəqəsi",
      addressDistrict: "Rayon",
      addressStreet: "Küçə və ev",
      productCategory: "Məhsul kateqoriyası",
    },
  },
}

// ─── Validation ──────────────────────────────────────────────────────────

/** Required-field keys the file has a column for. */
const COLUMN_BY_REQUIRED_FIELD: Partial<Record<MtmContactRequiredField, string>> = {
  firstName: "first_name",
  lastName: "last_name",
  middleName: "middle_name",
  externalCode: "external_code",
  specialtyName: "specialty",
  phone: "phone",
}

const CONTACT_TYPES: readonly MtmContactType[] = ["DOCTOR", "PHARMACIST", "OTHER"]

/** What a new institution is, judged by the first client the file puts there. */
const INSTITUTION_TYPE_BY_CONTACT_TYPE: Record<MtmContactType, MtmCustomerObjectType> = {
  DOCTOR: "CLINIC",
  PHARMACIST: "PHARMACY",
  OTHER: "OTHER",
}

interface ExistingInstitution {
  id: string
  code: string | null
  name: string
  status: string
}

interface ExistingAgent {
  id: string
  name: string
  email: string | null
  externalCode: string | null
  role: string
  status: string
}

function isTemplateExampleRow(code: string, lastName: string, firstName: string): boolean {
  const example = new Map(getMtmExcelContract("CONTACTS").columns.map((column) => [column.key, String(column.example)]))
  return code === example.get("external_code")
    && lastName === example.get("last_name")
    && firstName === example.get("first_name")
}

export interface MtmContactImportValidation {
  rows: MtmExcelSnapshotRow[]
  errors: MtmExcelRowError[]
  preview: Array<Record<string, unknown>>
  /** Institutions the import will create. */
  createInstitutions: number
  /** Clients the import will hand to a field agent. */
  assignRows: number
}

export async function validateContactRows(
  db: ContactImportReadDb,
  organizationId: string,
  parsed: ParsedMtmWorkbook,
  context: { actor: MtmRouteActor; locale?: MtmExcelLocale; policy?: MtmContactImportPolicy },
): Promise<MtmContactImportValidation> {
  const m = MESSAGES[context.locale ?? "en"]
  const errors = [...parsed.errors]
  const sheetName = parsed.sheetName
  const fail = (rowNumber: number, columnName: string | null, errorCode: string, message: string, rawValue?: unknown) => {
    errors.push({ sheetName, rowNumber, columnName, errorCode, message, ...(rawValue === undefined ? {} : { rawValue }) })
  }

  const [contacts, institutions, agents] = await Promise.all([
    // Deleted clients too: the unique index on the code does not skip them.
    db.mtmContact.findMany({
      where: { organizationId },
      select: {
        externalCode: true,
        firstName: true,
        lastName: true,
        middleName: true,
        displayName: true,
        status: true,
        deletedAt: true,
        workplaces: { where: { deletedAt: null, endedOn: null }, select: { customerId: true } },
      },
    }),
    db.mtmCustomer.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, code: true, name: true, status: true },
    }),
    db.mtmAgent.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true, externalCode: true, role: true, status: true },
    }),
  ])

  const existingByCode = new Map<string, { displayName: string; deleted: boolean }>()
  /** Clients already at an institution: `${institutionId}|${personKey}` → patronymics seen. */
  const existingPeople = new Map<string, Array<{ middleKey: string; displayName: string }>>()
  for (const contact of contacts) {
    if (contact.externalCode) {
      existingByCode.set(textKey(contact.externalCode), { displayName: contact.displayName, deleted: contact.deletedAt != null })
    }
    // A merged or flagged duplicate is a retired card, not a person on the list.
    if (contact.deletedAt != null || contact.status === "MERGED" || contact.status === "DUPLICATE") continue
    for (const workplace of contact.workplaces) {
      const key = `existing:${workplace.customerId}|${personKey(contact.lastName, contact.firstName)}`
      const people = existingPeople.get(key) ?? []
      people.push({ middleKey: asciiKey(contact.middleName ?? ""), displayName: contact.displayName })
      existingPeople.set(key, people)
    }
  }

  const institutionRows = institutions as ExistingInstitution[]
  const institutionByCode = new Map<string, ExistingInstitution>()
  const institutionsByName = new Map<string, ExistingInstitution[]>()
  const institutionsByLooseName = new Map<string, ExistingInstitution[]>()
  for (const institution of institutionRows) {
    if (institution.code) institutionByCode.set(institution.code.trim(), institution)
    const nameKey = textKey(institution.name)
    institutionsByName.set(nameKey, [...(institutionsByName.get(nameKey) ?? []), institution])
    const looseKey = institutionLooseKey(institution.name)
    if (looseKey) institutionsByLooseName.set(looseKey, [...(institutionsByLooseName.get(looseKey) ?? []), institution])
  }

  const agentRows = agents as ExistingAgent[]
  const agentsByCode = new Map<string, ExistingAgent[]>()
  const agentsByEmail = new Map<string, ExistingAgent[]>()
  for (const agent of agentRows) {
    if (agent.externalCode) agentsByCode.set(agent.externalCode.trim(), [...(agentsByCode.get(agent.externalCode.trim()) ?? []), agent])
    if (agent.email) {
      const email = agent.email.trim().toLowerCase()
      agentsByEmail.set(email, [...(agentsByEmail.get(email) ?? []), agent])
    }
  }

  const specialtyByKey = new Map((context.policy?.specialties ?? []).map((name) => [contactSpecialtyKey(name), name.trim()]))
  const requiredFields = context.policy?.requiredFields
  const hiddenFields = context.policy?.hiddenFields

  // A required field the file cannot carry would fail every row the same way;
  // say it once, at the top, where the administrator can act on it.
  const unsupported = effectiveMtmContactRequiredFields(requiredFields, hiddenFields)
    .filter((field): field is UnsupportedRequiredField => !(field in COLUMN_BY_REQUIRED_FIELD))
  if (unsupported.length > 0 && parsed.rows.length > 0) {
    fail(1, null, "REQUIRED_FIELD_NOT_IN_TEMPLATE", m.requiredNotInTemplate(unsupported.map((field) => m.fields[field]).join(", ")), unsupported)
  }

  const seenCodes = new Map<string, number>()
  const seenPeople = new Map<string, Array<{ middleKey: string; rowNumber: number }>>()
  const newInstitutions = new Map<string, { definition: NewInstitution; looseKey: string; rowNumbers: number[] }>()
  const unknownSpecialties = new Map<string, { value: string; rowNumbers: number[] }>()
  const rows: MtmExcelSnapshotRow[] = []
  const warn = (row: MtmExcelSnapshotRow, code: string, message: string) => {
    row.warnings = [...(row.warnings ?? []), { code, message }]
  }

  for (const row of parsed.rows) {
    const before = errors.length
    const rowNumber = row.rowNumber
    const warnings: Array<{ code: string; message: string }> = []
    const cell = (column: string) => cleanCell(row.values[column])
    const limited = (column: string, max: number) => {
      const value = cell(column)
      if (value.length > max) fail(rowNumber, column, "TOO_LONG", m.tooLong(max), value)
      return value
    }

    const code = limited("external_code", 128)
    const lastNameUnknown = isDash(row.values.last_name)
    const lastName = lastNameUnknown ? UNKNOWN_LAST_NAME : limited("last_name", 120)
    const firstName = limited("first_name", 120)
    const middleName = limited("middle_name", 120)
    if (isTemplateExampleRow(code, lastName, firstName)) {
      fail(rowNumber, null, "TEMPLATE_EXAMPLE_ROW", m.templateExample)
      continue
    }
    if (!code) fail(rowNumber, "external_code", "REQUIRED", m.codeRequired)
    if (!lastName) fail(rowNumber, "last_name", "REQUIRED", firstName ? m.lastNameOnlyFirst(firstName) : m.lastNameRequired)
    if (!firstName) fail(rowNumber, "first_name", "REQUIRED", m.firstNameRequired)
    if (lastNameUnknown) warnings.push({ code: "LAST_NAME_UNKNOWN", message: m.lastNameUnknown })
    const displayName = lastNameUnknown
      ? [firstName, middleName].filter(Boolean).join(" ")
      : contactDisplayName({ firstName, lastName, middleName })

    const rawType = cell("contact_type")
    const type = rawType ? CONTACT_TYPES.find((candidate) => candidate === rawType.toUpperCase()) ?? null : "DOCTOR"
    if (!type) fail(rowNumber, "contact_type", "INVALID_VALUE", m.invalidType(rawType), rawType)

    const typedSpecialty = limited("specialty", MTM_CONTACT_SPECIALTY_MAX_LENGTH)
    // The tenant's own spelling wins, so «terapevt» lands under «Terapevt» in
    // the filter instead of beside it.
    const specialtyName = typedSpecialty ? specialtyByKey.get(contactSpecialtyKey(typedSpecialty)) ?? typedSpecialty : ""
    const phone = limited("phone", 500)
    const notes = cleanNote(row.values.notes)
    if (notes.length > 2000) fail(rowNumber, "notes", "TOO_LONG", m.tooLong(2000))

    if (code) {
      const codeKey = textKey(code)
      const firstSeen = seenCodes.get(codeKey)
      if (firstSeen) fail(rowNumber, "external_code", "DUPLICATE_IN_FILE", m.duplicateInFile(firstSeen), code)
      else seenCodes.set(codeKey, rowNumber)
      const existing = existingByCode.get(codeKey)
      if (existing) {
        fail(rowNumber, "external_code", "ALREADY_EXISTS", existing.deleted ? m.alreadyExistsDeleted : m.alreadyExists(existing.displayName), code)
      }
    }

    // The same policy the single-client endpoint applies. Name and code are
    // reported above in their own words.
    const missing = missingMtmContactRequiredFields(
      { firstName, lastName, middleName, externalCode: code, specialtyName, phone },
      requiredFields,
      hiddenFields,
    )
    for (const field of missing) {
      const column = COLUMN_BY_REQUIRED_FIELD[field]
      if (!column || field === "firstName" || field === "lastName" || field === "externalCode") continue
      fail(rowNumber, column, "REQUIRED_BY_SETTINGS", m.requiredBySettings)
    }

    // ── Institution ──
    const institutionCode = cell("institution_code")
    const institutionName = limited("institution_name", 200)
    const institutionAddress = limited("institution_address", 500)
    const institutionCity = limited("institution_city", 500)
    let institution: ExistingInstitution | null = null
    let newInstitution: NewInstitution | null = null
    if (institutionCode) {
      const byCode = institutionByCode.get(institutionCode)
      if (!byCode) {
        fail(rowNumber, "institution_code", "REFERENCE_NOT_FOUND", m.institutionCodeNotFound(institutionCode), institutionCode)
      } else if (byCode.status === "INACTIVE") {
        fail(rowNumber, "institution_code", "INSTITUTION_INACTIVE", m.institutionInactive(byCode.name), institutionCode)
      } else {
        institution = byCode
        if (institutionName && textKey(institutionName) !== textKey(byCode.name)) {
          warnings.push({ code: "INSTITUTION_NAME_MISMATCH", message: m.nameMismatch(institutionCode, byCode.name) })
        }
      }
    } else if (institutionName) {
      const nameKey = textKey(institutionName)
      const named = institutionsByName.get(nameKey) ?? []
      const usable = named.filter((candidate) => candidate.status !== "INACTIVE")
      if (usable.length === 1) {
        institution = usable[0]
      } else if (usable.length > 1) {
        fail(rowNumber, "institution_name", "AMBIGUOUS_REFERENCE", m.institutionAmbiguous(institutionName, usable.length), institutionName)
      } else if (named.length > 0) {
        // Creating a twin of a deactivated institution would hide the decision
        // somebody made when they deactivated it.
        fail(rowNumber, "institution_name", "INSTITUTION_INACTIVE", m.institutionInactive(named[0].name), institutionName)
      } else if (type) {
        const known = newInstitutions.get(nameKey)
        if (known) {
          newInstitution = known.definition
          if (!known.definition.address && institutionAddress) known.definition.address = institutionAddress
          else if (known.definition.address && institutionAddress && textKey(known.definition.address) !== textKey(institutionAddress)) {
            warnings.push({ code: "INSTITUTION_ADDRESS_DIFFERS", message: m.addressDiffers(known.rowNumbers[0]) })
          }
          if (!known.definition.city && institutionCity) known.definition.city = institutionCity
          known.rowNumbers.push(rowNumber)
        } else {
          newInstitution = {
            key: nameKey,
            name: institutionName,
            address: institutionAddress || null,
            city: institutionCity || null,
            objectType: INSTITUTION_TYPE_BY_CONTACT_TYPE[type],
          }
          newInstitutions.set(nameKey, {
            definition: newInstitution,
            looseKey: institutionLooseKey(institutionName),
            rowNumbers: [rowNumber],
          })
        }
      }
    } else {
      warnings.push({ code: "NO_INSTITUTION", message: m.noInstitution })
    }

    // ── The same person twice ──
    const institutionToken = institution ? `existing:${institution.id}` : newInstitution ? `new:${newInstitution.key}` : null
    if (institutionToken && lastName && firstName) {
      const key = `${institutionToken}|${personKey(lastName, firstName)}`
      const middleKey = asciiKey(middleName)
      // Two different patronymics are two people; one missing patronymic is not proof of that.
      const samePerson = (other: { middleKey: string }) => !middleKey || !other.middleKey || other.middleKey === middleKey
      const inFile = seenPeople.get(key)?.find(samePerson)
      const inBase = existingPeople.get(key)?.find(samePerson)
      if (inFile) fail(rowNumber, "last_name", "DUPLICATE_PERSON", m.duplicatePersonInFile(inFile.rowNumber), displayName)
      else if (inBase) fail(rowNumber, "last_name", "DUPLICATE_PERSON", m.duplicatePersonExisting(inBase.displayName), displayName)
      seenPeople.set(key, [...(seenPeople.get(key) ?? []), { middleKey, rowNumber }])
    }

    // ── Owner ──
    const agentValue = cell("agent_code_or_email")
    let agent: ExistingAgent | null = null
    if (agentValue) {
      const candidates = agentsByCode.get(agentValue) ?? agentsByEmail.get(agentValue.toLowerCase()) ?? []
      const assignable = candidates.filter((candidate) => candidate.status === "ACTIVE" && candidate.role === "AGENT")
      if (candidates.length === 0) {
        fail(rowNumber, "agent_code_or_email", "REFERENCE_NOT_FOUND", m.agentNotFound(agentValue), agentValue)
      } else if (assignable.length > 1) {
        fail(rowNumber, "agent_code_or_email", "AMBIGUOUS_REFERENCE", m.agentAmbiguous(agentValue), agentValue)
      } else if (assignable.length === 0) {
        const candidate = candidates[0]
        fail(
          rowNumber,
          "agent_code_or_email",
          "AGENT_NOT_ASSIGNABLE",
          candidate.status === "ACTIVE" ? m.agentNotFieldAgent(candidate.name) : m.agentInactive(candidate.name),
          agentValue,
        )
      } else if (!isAgentInRouteScope(context.actor, assignable[0].id)) {
        fail(rowNumber, "agent_code_or_email", "OUTSIDE_SCOPE", m.agentOutsideScope(assignable[0].name), agentValue)
      } else {
        agent = assignable[0]
      }
    }

    if (errors.length > before || !type) continue

    if (typedSpecialty && specialtyByKey.size > 0 && !specialtyByKey.has(contactSpecialtyKey(typedSpecialty))) {
      const key = contactSpecialtyKey(typedSpecialty)
      const known = unknownSpecialties.get(key) ?? { value: typedSpecialty, rowNumbers: [] }
      known.rowNumbers.push(rowNumber)
      unknownSpecialties.set(key, known)
    }

    const data: ContactRowData = {
      externalCode: code,
      lastName,
      firstName,
      middleName: middleName || null,
      displayName,
      type,
      specialtyName: specialtyName || null,
      phone: phone || null,
      notes: notes || null,
      institutionId: institution?.id ?? null,
      institutionName: institution?.name ?? newInstitution?.name ?? null,
      newInstitution,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
    }
    rows.push({
      rowNumber,
      operation: "CREATE",
      warnings: warnings.length > 0 ? warnings : undefined,
      data: data as unknown as Record<string, unknown>,
    })
  }

  const rowByNumber = new Map(rows.map((row) => [row.rowNumber, row]))
  const dataOf = (row: MtmExcelSnapshotRow) => row.data as unknown as ContactRowData

  // Institutions the file would create that look like one another, or like one
  // the base already has. Reported once per spelling, on its first valid row.
  const newByLooseName = new Map<string, NewInstitution[]>()
  for (const entry of newInstitutions.values()) {
    if (entry.looseKey) newByLooseName.set(entry.looseKey, [...(newByLooseName.get(entry.looseKey) ?? []), entry.definition])
  }
  for (const entry of newInstitutions.values()) {
    const firstValid = entry.rowNumbers.map((rowNumber) => rowByNumber.get(rowNumber)).find(Boolean)
    if (!firstValid || !entry.looseKey) continue
    const lookalikes = [
      ...(institutionsByLooseName.get(entry.looseKey) ?? []).map((existing) => existing.name),
      ...(newByLooseName.get(entry.looseKey) ?? []).filter((other) => other.key !== entry.definition.key).map((other) => other.name),
    ]
    if (lookalikes.length === 0) continue
    warn(firstValid, "INSTITUTION_NEAR_DUPLICATE", m.nearDuplicate(entry.definition.name, [...new Set(lookalikes)].map((name) => `«${name}»`).join(", ")))
  }

  for (const unknown of unknownSpecialties.values()) {
    const first = rowByNumber.get(unknown.rowNumbers[0])
    if (first) warn(first, "SPECIALTY_NOT_IN_LIST", m.specialtyNotInList(unknown.value, unknown.rowNumbers.length))
  }

  const creating = new Set(rows.map((row) => dataOf(row).newInstitution?.key).filter(Boolean))
  return {
    rows,
    errors,
    preview: rows.slice(0, 20).map((row) => {
      const data = dataOf(row)
      return {
        rowNumber: row.rowNumber,
        externalCode: data.externalCode,
        displayName: data.displayName,
        specialty: data.specialtyName ?? "",
        institution: data.newInstitution ? m.newInstitution(data.newInstitution.name) : data.institutionName ?? "",
        agent: data.agentName ?? "",
      }
    }),
    createInstitutions: creating.size,
    assignRows: rows.filter((row) => dataOf(row).agentId).length,
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asNullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function readNewInstitution(value: unknown): NewInstitution | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const key = asText(record.key)
  const name = asText(record.name)
  if (!key || !name) return null
  const objectType = asText(record.objectType)
  return {
    key,
    name,
    address: asNullableText(record.address),
    city: asNullableText(record.city),
    objectType: objectType === "PHARMACY" || objectType === "OTHER" ? objectType : "CLINIC",
  }
}

/** The validated file no longer fits the base; the administrator uploads it again to see why. */
function stale(detail: string): Error {
  return new Error(`${detail} Upload the file again to check it against the current data.`)
}

export interface MtmContactImportApplyResult {
  createdContacts: number
  createdInstitutionIds: string[]
  assignedContacts: number
  assignmentOperationIds: string[]
}

/**
 * Writes a validated client file: missing institutions, then each client with
 * its primary workplace and CONTACT_CREATE audit entry — the same rows the
 * single-client endpoint writes — and finally ownership through
 * `executeContactAssignment`.
 */
export async function applyContactRows(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string
    jobId: string
    requestedBy: string
    actor: MtmRouteActor
    /** Today in the tenant's timezone (YYYY-MM-DD): the day ownership starts. */
    effectiveFrom: string
    fileName: string
    rows: MtmExcelSnapshotRow[]
  },
): Promise<MtmContactImportApplyResult> {
  const { organizationId, actor } = params
  if (!canManageFieldMasterData(actor)) throw new Error("Importing clients requires the right to create them")
  const rows = params.rows.filter((row) => row.operation === "CREATE").map((row) => row.data)
  const actorUserId = params.requestedBy || null

  const codes = rows.map((row) => asText(row.externalCode)).filter(Boolean)
  for (const batch of chunks(codes, QUERY_BATCH)) {
    const taken = await tx.mtmContact.findFirst({
      where: { organizationId, externalCode: { in: batch } },
      select: { externalCode: true },
    })
    if (taken) throw stale(`A client with the code '${taken.externalCode}' was added after this file was checked.`)
  }

  const currentInstitutions = await tx.mtmCustomer.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, name: true, status: true },
  })
  const usableById = new Map(currentInstitutions.filter((institution) => institution.status !== "INACTIVE").map((institution) => [institution.id, institution]))
  const currentByName = new Map<string, typeof currentInstitutions>()
  for (const institution of currentInstitutions) {
    const key = textKey(institution.name)
    currentByName.set(key, [...(currentByName.get(key) ?? []), institution])
  }

  // Each new institution once, however many clients work there. If somebody
  // created it between "check" and "apply", the clients go to that one rather
  // than to a second institution with the same name.
  const institutionIdByKey = new Map<string, string>()
  const createdInstitutions: Array<{ id: string; record: object }> = []
  for (const row of rows) {
    const definition = readNewInstitution(row.newInstitution)
    if (!definition || institutionIdByKey.has(definition.key)) continue
    const named = currentByName.get(definition.key) ?? []
    const usable = named.filter((institution) => institution.status !== "INACTIVE")
    if (usable.length === 1) {
      institutionIdByKey.set(definition.key, usable[0].id)
      continue
    }
    if (named.length > 0) throw stale(`The institution '${definition.name}' changed after this file was checked.`)
    const created = await tx.mtmCustomer.create({
      data: {
        organizationId,
        name: definition.name,
        objectType: definition.objectType,
        address: definition.address,
        city: definition.city,
      },
    })
    institutionIdByKey.set(definition.key, created.id)
    createdInstitutions.push({ id: created.id, record: created })
  }

  const createdContacts: Array<{ id: string; record: object }> = []
  const contactIdsByAgent = new Map<string, string[]>()
  for (const row of rows) {
    const definition = readNewInstitution(row.newInstitution)
    const institutionId = definition ? institutionIdByKey.get(definition.key) ?? null : asNullableText(row.institutionId)
    if (institutionId && !definition && !usableById.has(institutionId)) {
      throw stale(`The institution '${asText(row.institutionName)}' was removed or deactivated after this file was checked.`)
    }
    const firstName = asText(row.firstName)
    const lastName = asText(row.lastName)
    const middleName = asNullableText(row.middleName)
    const contact = await tx.mtmContact.create({
      data: {
        organizationId,
        externalCode: asText(row.externalCode),
        firstName,
        lastName,
        middleName,
        displayName: asText(row.displayName) || contactDisplayName({ firstName, lastName, middleName }),
        type: CONTACT_TYPES.find((candidate) => candidate === row.type) ?? "DOCTOR",
        specialtyName: asNullableText(row.specialtyName),
        phone: asNullableText(row.phone),
        notes: asNullableText(row.notes),
        source: MTM_CONTACT_IMPORT_SOURCE,
        ...(institutionId ? {
          workplaces: {
            create: {
              organizationId,
              customerId: institutionId,
              isPrimary: true,
              source: MTM_CONTACT_IMPORT_SOURCE,
              createdBy: actorUserId,
              updatedBy: actorUserId,
            },
          },
        } : {}),
      },
    })
    createdContacts.push({ id: contact.id, record: contact })
    const agentId = asNullableText(row.agentId)
    if (agentId) contactIdsByAgent.set(agentId, [...(contactIdsByAgent.get(agentId) ?? []), contact.id])
  }

  // The audit trail the single-record endpoints leave, one entry per record.
  const auditEntries = [
    ...createdInstitutions.map((institution) => ({
      action: "FIELD_ORGANIZATION_CREATE",
      entity: "customer",
      metadataKind: "field_organization_create",
      ...institution,
    })),
    ...createdContacts.map((contact) => ({
      action: "CONTACT_CREATE",
      entity: "contact",
      metadataKind: "contact_create",
      ...contact,
    })),
  ]
  for (const batch of chunks(auditEntries, ASSIGNMENT_BATCH)) {
    await tx.mtmAuditLog.createMany({
      data: batch.map((entry) => ({
        organizationId,
        agentId: actor.agentId,
        ...(actorUserId ? { actorUserId } : {}),
        action: entry.action,
        entity: entry.entity,
        entityId: entry.id,
        metadataKind: entry.metadataKind,
        newData: { ...entry.record, importJobId: params.jobId } as unknown as Prisma.InputJsonValue,
      })),
    })
  }

  const reason = `Excel import: ${params.fileName}`.slice(0, 500)
  const effectiveFrom = new Date(`${params.effectiveFrom}T00:00:00.000Z`)
  const assignmentOperationIds: string[] = []
  let assignedContacts = 0
  for (const [agentId, contactIds] of contactIdsByAgent) {
    if (!isAgentInRouteScope(actor, agentId)) throw stale("An employee named in this file is no longer in your team.")
    const batches = chunks(contactIds, ASSIGNMENT_BATCH)
    for (const [index, batch] of batches.entries()) {
      // Preview, then execute with its token: the two steps the assignment
      // screen makes, here inside one transaction.
      const preview = await buildContactAssignmentPreview(tx, {
        organizationId,
        contactIds: batch,
        mode: "ASSIGN",
        targetAgentId: agentId,
        effectiveFrom,
        actor,
      })
      const refused = preview.rows.find((candidate) => !candidate.assignable)
      if (refused) {
        throw stale(`'${preview.targetAgent?.name ?? agentId}' can no longer be given clients (${refused.issues.join(", ")}).`)
      }
      const request = {
        contactIds: batch,
        mode: "ASSIGN" as const,
        targetAgentId: agentId,
        effectiveFrom: params.effectiveFrom,
        reason,
        previewToken: preview.previewToken,
        idempotencyKey: `excel-import:${params.jobId}:${agentId}:${index}`,
      }
      const result = await executeContactAssignment(tx, {
        organizationId,
        actor,
        actorUserId,
        request,
        requestHash: contactAssignmentRequestHash(request),
        source: MTM_CONTACT_IMPORT_SOURCE,
      })
      assignmentOperationIds.push(result.operationId)
      assignedContacts += result.changed.length
    }
  }

  return {
    createdContacts: createdContacts.length,
    createdInstitutionIds: createdInstitutions.map((institution) => institution.id),
    assignedContacts,
    assignmentOperationIds,
  }
}
