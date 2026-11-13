import type { Prisma } from "@prisma/client"
import type { MtmExcelRowError, ParsedMtmWorkbook } from "@/lib/mtm/excel-contract"

/**
 * Doctors from Excel (Zeytun, 2026-11-13: the client's list of neurologists,
 * each with the agent who visits him and the clinic he works in).
 *
 * One file row is «this agent visits this doctor at this clinic». Rows are
 * grouped into doctors before anything is written:
 *
 * - a doctor is his code when the file gives one, otherwise his name together
 *   with his agent. The same name under one agent in two rows is ONE doctor
 *   with two clinics (owner: «некоторые врачи бывают в разных клиниках»); the
 *   same name under two agents stays two doctors and is shown as a warning —
 *   a name alone does not prove one person;
 * - a clinic is its name and city, compared without case, spaces, punctuation
 *   and Azerbaijani letters («12 Saylı» = «12 sayli»). An existing place that
 *   is not a pharmacy is reused, otherwise a clinic is created — without a pin,
 *   which the agent's «Клиент здесь» or a manager sets later;
 * - an agent is his code in MTM or, failing that, his full name; a name that
 *   matches no agent or several is an error of the row.
 *
 * Nothing is removed or ended: a repeated file finds its doctors (by code, or
 * by name among the agent's own doctors) and adds only a missing workplace or
 * agent assignment. The validation is a preview; the apply re-reads what it
 * must not duplicate, inside its transaction.
 */

type DbClient = Pick<Prisma.TransactionClient, "mtmAgent" | "mtmCustomer" | "mtmContact">

export interface DoctorImportWarning {
  code: "TWO_CLINICS" | "NAMESAKE_OTHER_AGENT" | "SAME_NAME_EXISTS" | "CLINIC_SPELLINGS" | "OTHER_PRIMARY_AGENT"
  message: string
  params?: Record<string, string | number>
}

export interface DoctorImportClinic {
  key: string
  customerId: string | null
  name: string
  city: string | null
  district: string | null
  address: string | null
}

export interface DoctorImportRow {
  rowNumber: number
  sourceRows: number[]
  operation: "CREATE" | "UPDATE" | "UNCHANGED"
  existingId?: string
  warnings?: DoctorImportWarning[]
  data: {
    doctorName: string
    firstName: string
    lastName: string
    code: string | null
    specialty: string | null
    agentId: string
    agentName: string
    /** No active assignment of this doctor to this agent yet. */
    assignAgent: boolean
    clinics: DoctorImportClinic[]
  }
}

const AZ_LETTERS: Record<string, string> = { ə: "e", ı: "i", ş: "s", ç: "c", ğ: "g", ö: "o", ü: "u" }

/** A name as the file and MTM may both spell it: case, spaces, dots and Azerbaijani letters aside. */
export function foldName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("az")
    .replace(/[əışçğöü]/g, (letter) => AZ_LETTERS[letter] ?? letter)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function text(value: unknown): string {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim()
}

function optional(value: unknown, max: number): string | null {
  const normalized = text(value)
  return normalized ? normalized.slice(0, max) : null
}

function clinicKey(name: string, city: string | null): string {
  return `${foldName(name)}|${foldName(city ?? "")}`
}

/** «Aliyeva Leyla Kamal» → first word and the rest; the display name is kept as written. */
export function splitDoctorName(name: string): { firstName: string; lastName: string } {
  const words = name.split(" ").filter(Boolean)
  return { firstName: words[0] ?? name, lastName: words.slice(1).join(" ") }
}

export async function validateDoctorImport(
  db: DbClient,
  organizationId: string,
  parsed: ParsedMtmWorkbook,
  at: Date,
): Promise<{ rows: DoctorImportRow[]; errors: MtmExcelRowError[]; newClinics: number }> {
  const errors: MtmExcelRowError[] = [...parsed.errors]
  const [agents, places, doctors] = await Promise.all([
    db.mtmAgent.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, name: true, externalCode: true },
    }),
    db.mtmCustomer.findMany({
      where: { organizationId, deletedAt: null, objectType: { not: "PHARMACY" } },
      select: { id: true, name: true, city: true },
    }),
    db.mtmContact.findMany({
      where: { organizationId, deletedAt: null, type: "DOCTOR" },
      select: {
        id: true,
        displayName: true,
        externalCode: true,
        agentAssignments: {
          where: { deletedAt: null, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
          select: { agentId: true, role: true },
        },
        workplaces: {
          where: { deletedAt: null, endedOn: null },
          select: { customerId: true },
        },
      },
    }),
  ])

  const agentByCode = new Map<string, { id: string; name: string }>()
  const agentsByName = new Map<string, Array<{ id: string; name: string }>>()
  for (const agent of agents as Array<{ id: string; name: string; externalCode: string | null }>) {
    if (agent.externalCode) agentByCode.set(agent.externalCode.trim(), agent)
    const key = foldName(agent.name)
    agentsByName.set(key, [...(agentsByName.get(key) ?? []), agent])
  }
  const placeByKey = new Map<string, string>()
  const placesByName = new Map<string, string[]>()
  for (const place of places as Array<{ id: string; name: string; city: string | null }>) {
    const key = clinicKey(place.name, place.city)
    if (!placeByKey.has(key)) placeByKey.set(key, place.id)
    const name = foldName(place.name)
    placesByName.set(name, [...(placesByName.get(name) ?? []), place.id])
  }
  type ExistingDoctor = {
    id: string
    displayName: string
    externalCode: string | null
    agentAssignments: Array<{ agentId: string; role: string }>
    workplaces: Array<{ customerId: string }>
  }
  const doctorRows = doctors as ExistingDoctor[]
  const doctorByCode = new Map(doctorRows.filter((doctor) => doctor.externalCode).map((doctor) => [doctor.externalCode!.trim(), doctor]))
  const doctorsByName = new Map<string, ExistingDoctor[]>()
  for (const doctor of doctorRows) {
    const key = foldName(doctor.displayName)
    doctorsByName.set(key, [...(doctorsByName.get(key) ?? []), doctor])
  }

  type Group = {
    rowNumber: number
    sourceRows: number[]
    name: string
    code: string | null
    specialty: string | null
    agent: { id: string; name: string }
    clinics: Map<string, DoctorImportClinic>
  }
  const groups = new Map<string, Group>()
  const clinicSpellings = new Map<string, { first: number; spellings: Set<string> }>()
  const push = (rowNumber: number, columnName: string, errorCode: string, message: string, rawValue?: unknown) =>
    errors.push({ sheetName: parsed.sheetName, rowNumber, columnName, errorCode, message, rawValue })

  for (const row of parsed.rows) {
    const values = row.values
    const agentValue = text(values.agent)
    const name = text(values.doctor_name)
    const clinicName = text(values.clinic_name)
    const before = errors.length
    if (!agentValue) push(row.rowNumber, "agent", "REQUIRED", "'agent' is required")
    if (!name) push(row.rowNumber, "doctor_name", "REQUIRED", "'doctor_name' is required")
    else if (name.length > 200) push(row.rowNumber, "doctor_name", "TOO_LONG", "'doctor_name' exceeds 200 characters", name)
    if (!clinicName) push(row.rowNumber, "clinic_name", "REQUIRED", "'clinic_name' is required: a doctor without a clinic cannot be planned")
    else if (clinicName.length > 200) push(row.rowNumber, "clinic_name", "TOO_LONG", "'clinic_name' exceeds 200 characters", clinicName)

    let agent: { id: string; name: string } | undefined
    if (agentValue) {
      agent = agentByCode.get(agentValue)
      if (!agent) {
        const named = agentsByName.get(foldName(agentValue)) ?? []
        if (named.length === 1) agent = named[0]
        else if (named.length > 1) push(row.rowNumber, "agent", "AGENT_AMBIGUOUS", `Several active employees are called '${agentValue}'; use the employee's code`, agentValue)
        else push(row.rowNumber, "agent", "AGENT_NOT_FOUND", `No active employee with code or name '${agentValue}'`, agentValue)
      }
    }
    // A code no doctor carries yet is a new doctor with that code.
    const code = optional(values.doctor_code, 128)
    if (errors.length > before || !agent) continue

    const city = optional(values.clinic_city, 200)
    const key = clinicKey(clinicName, city)
    const spelling = clinicSpellings.get(key)
    if (spelling) spelling.spellings.add(clinicName)
    else clinicSpellings.set(key, { first: row.rowNumber, spellings: new Set([clinicName]) })

    const groupKey = code ? `code:${code}` : `name:${foldName(name)}|agent:${agent.id}`
    const group = groups.get(groupKey) ?? {
      rowNumber: row.rowNumber,
      sourceRows: [],
      name,
      code,
      specialty: null,
      agent,
      clinics: new Map<string, DoctorImportClinic>(),
    }
    if (code && group.agent.id !== agent.id) {
      push(row.rowNumber, "agent", "CODE_AGENT_CONFLICT", `Doctor code '${code}' is given to another agent on row ${group.rowNumber}`, agentValue)
      continue
    }
    group.sourceRows.push(row.rowNumber)
    group.specialty ??= optional(values.specialty, 200)
    if (!group.clinics.has(key)) {
      const existingPlace = placeByKey.get(key)
        // No city in the file: a single place of that name is that place.
        ?? (!city && (placesByName.get(foldName(clinicName))?.length ?? 0) === 1 ? placesByName.get(foldName(clinicName))![0] : undefined)
      group.clinics.set(key, {
        key,
        customerId: existingPlace ?? null,
        name: clinicName,
        city,
        district: optional(values.clinic_district, 200),
        address: optional(values.clinic_address, 500),
      })
    }
    groups.set(groupKey, group)
  }

  // The same name under different agents in this file.
  const agentsOfName = new Map<string, Map<string, string>>()
  for (const group of groups.values()) {
    const key = foldName(group.name)
    const byAgent = agentsOfName.get(key) ?? new Map<string, string>()
    byAgent.set(group.agent.id, group.agent.name)
    agentsOfName.set(key, byAgent)
  }

  const rows: DoctorImportRow[] = []
  const newClinicKeys = new Set<string>()
  const spellingWarned = new Set<string>()
  for (const group of groups.values()) {
    const warnings: DoctorImportWarning[] = []
    const existing = group.code
      ? doctorByCode.get(group.code)
      : (doctorsByName.get(foldName(group.name)) ?? []).find((doctor) => doctor.agentAssignments.some((assignment) => assignment.agentId === group.agent.id))
    const clinics = [...group.clinics.values()]
    if (clinics.length > 1) {
      warnings.push({ code: "TWO_CLINICS", message: `One doctor in ${clinics.length} clinics: ${clinics.map((clinic) => clinic.name).join(", ")}`, params: { name: group.name, clinics: clinics.map((clinic) => clinic.name).join(", ") } })
    }
    const otherAgents = [...(agentsOfName.get(foldName(group.name))?.entries() ?? [])].filter(([agentId]) => agentId !== group.agent.id)
    if (otherAgents.length > 0) {
      warnings.push({ code: "NAMESAKE_OTHER_AGENT", message: `The same name is also given to ${otherAgents.map(([, name]) => name).join(", ")}; imported as a separate doctor`, params: { name: group.name, agents: otherAgents.map(([, name]) => name).join(", ") } })
    }
    if (!existing && !group.code && (doctorsByName.get(foldName(group.name))?.length ?? 0) > 0) {
      warnings.push({ code: "SAME_NAME_EXISTS", message: "A doctor with this name already exists in MTM under another agent; a new doctor is created", params: { name: group.name } })
    }
    for (const clinic of clinics) {
      const spelling = clinicSpellings.get(clinic.key)
      if (spelling && spelling.spellings.size > 1 && !spellingWarned.has(clinic.key)) {
        spellingWarned.add(clinic.key)
        warnings.push({ code: "CLINIC_SPELLINGS", message: `Written differently in the file, imported as one clinic: ${[...spelling.spellings].join(" / ")}`, params: { spellings: [...spelling.spellings].join(" / ") } })
      }
      if (!clinic.customerId) newClinicKeys.add(clinic.key)
    }
    const assigned = existing?.agentAssignments.some((assignment) => assignment.agentId === group.agent.id) ?? false
    const otherPrimary = existing?.agentAssignments.find((assignment) => assignment.role === "PRIMARY" && assignment.agentId !== group.agent.id)
    if (existing && !assigned && otherPrimary) {
      warnings.push({ code: "OTHER_PRIMARY_AGENT", message: "The doctor already has a primary agent; this agent is added as a second one", params: { name: group.name } })
    }
    const missingWorkplace = clinics.some((clinic) => !clinic.customerId || !existing?.workplaces.some((workplace) => workplace.customerId === clinic.customerId))
    const { firstName, lastName } = splitDoctorName(group.name)
    rows.push({
      rowNumber: group.rowNumber,
      sourceRows: group.sourceRows,
      operation: !existing ? "CREATE" : (!assigned || missingWorkplace) ? "UPDATE" : "UNCHANGED",
      ...(existing ? { existingId: existing.id } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      data: {
        doctorName: group.name,
        firstName,
        lastName,
        code: group.code,
        specialty: group.specialty,
        agentId: group.agent.id,
        agentName: group.agent.name,
        assignAgent: !assigned,
        clinics,
      },
    })
  }
  return { rows, errors, newClinics: newClinicKeys.size }
}

function utcDay(at: Date): Date {
  return new Date(`${at.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

/**
 * Writes the validated doctors. Re-reads, inside the transaction, every row it
 * could otherwise duplicate: the doctor by code, the clinic by name and city,
 * the active workplace and the active agent assignment.
 */
export async function applyDoctorImportRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  requestedBy: string,
  rows: DoctorImportRow[],
  at: Date = new Date(),
): Promise<{ doctors: number; clinics: number; workplaces: number; assignments: number }> {
  const counts = { doctors: 0, clinics: 0, workplaces: 0, assignments: 0 }
  const places = await tx.mtmCustomer.findMany({
    where: { organizationId, deletedAt: null, objectType: { not: "PHARMACY" } },
    select: { id: true, name: true, city: true },
  })
  const placeByKey = new Map<string, string>()
  for (const place of places as Array<{ id: string; name: string; city: string | null }>) {
    const key = clinicKey(place.name, place.city)
    if (!placeByKey.has(key)) placeByKey.set(key, place.id)
  }
  const today = utcDay(at)

  for (const row of rows) {
    if (row.operation === "UNCHANGED") continue
    const data = row.data
    let contactId = row.existingId ?? null
    if (!contactId && data.code) {
      const byCode = await tx.mtmContact.findFirst({ where: { organizationId, externalCode: data.code, deletedAt: null }, select: { id: true } })
      contactId = byCode?.id ?? null
    }
    if (!contactId) {
      const created = await tx.mtmContact.create({
        data: {
          organizationId,
          externalCode: data.code,
          firstName: data.firstName,
          lastName: data.lastName,
          displayName: data.doctorName,
          type: "DOCTOR",
          specialtyName: data.specialty,
          source: "EXCEL_IMPORT",
        },
        select: { id: true },
      })
      contactId = created.id
      counts.doctors++
    }

    for (const clinic of data.clinics) {
      // Read now, not taken from the preview: a place may have been added or removed since.
      let customerId = placeByKey.get(clinic.key) ?? null
      if (!customerId && clinic.customerId) {
        // The preview's single place of that name, for a row without a city.
        const live = await tx.mtmCustomer.findFirst({ where: { id: clinic.customerId, organizationId, deletedAt: null }, select: { id: true } })
        customerId = live?.id ?? null
      }
      if (!customerId) {
        const created = await tx.mtmCustomer.create({
          data: {
            organizationId,
            objectType: "CLINIC",
            name: clinic.name,
            city: clinic.city,
            district: clinic.district,
            address: clinic.address,
          },
          select: { id: true },
        })
        customerId = created.id
        counts.clinics++
      }
      placeByKey.set(clinic.key, customerId)
      const workplace = await tx.mtmContactWorkplace.findFirst({
        where: { organizationId, contactId, customerId, deletedAt: null, endedOn: null },
        select: { id: true },
      })
      if (!workplace) {
        await tx.mtmContactWorkplace.create({
          data: { organizationId, contactId, customerId, source: "EXCEL_IMPORT", createdBy: requestedBy || null, updatedBy: requestedBy || null },
        })
        counts.workplaces++
      }
    }

    const assignments = await tx.mtmContactAgentAssignment.findMany({
      where: { organizationId, contactId, deletedAt: null, effectiveTo: null },
      select: { agentId: true, role: true },
    })
    if (!assignments.some((assignment: { agentId: string }) => assignment.agentId === data.agentId)) {
      const hasPrimary = assignments.some((assignment: { role: string }) => assignment.role === "PRIMARY")
      await tx.mtmContactAgentAssignment.create({
        data: {
          organizationId,
          contactId,
          agentId: data.agentId,
          role: hasPrimary ? "SECONDARY" : "PRIMARY",
          effectiveFrom: today,
          source: "EXCEL_IMPORT",
          assignedBy: requestedBy || null,
          reason: "Excel import",
        },
      })
      counts.assignments++
    }
  }
  return counts
}
