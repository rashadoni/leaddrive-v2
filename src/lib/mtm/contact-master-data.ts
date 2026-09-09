import type { Prisma } from "@prisma/client"
import type { z } from "zod"
import { ContactUpdateSchema } from "@/lib/mtm-validators"
import { contactDisplayName } from "@/lib/mtm/field-scope"

export type ContactUpdateInput = z.infer<typeof ContactUpdateSchema>

type ContactIdentity = {
  firstName: string
  lastName: string
  middleName: string | null
  displayName: string
}
const NULLABLE_FIELDS = [
  "externalCode", "middleName", "specialtyCode", "specialtyName",
  "qualificationCategory", "profile", "gender", "email", "phone",
  "messengerPhone", "workPhone", "homePhone", "mobilePhone", "viberPhone",
  "whatsappPhone", "telegramPhone", "postalCode", "addressRegion",
  "addressLocality", "addressDistrict", "addressStreet", "productCategory",
  "contactPreference", "duplicateOfContactId", "notes",
] as const

const VALUE_FIELDS = [
  "firstName", "lastName", "type", "category", "status", "consentStatus", "source",
] as const

export function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

/** Build the same authoritative contact mutation for direct manager edits and
 * approved Agent requests. Keeping it shared prevents review-time semantics
 * from drifting from the form's direct-save path. */
export function buildContactUpdateData(
  body: ContactUpdateInput,
  before: ContactIdentity,
  reviewerUserId: string | null,
  now: Date = new Date(),
): Prisma.MtmContactUpdateManyMutationInput {
  const data: Prisma.MtmContactUpdateManyMutationInput = {}
  for (const key of NULLABLE_FIELDS) {
    if (body[key] !== undefined) Object.assign(data, { [key]: body[key] ?? null })
  }
  for (const key of VALUE_FIELDS) {
    if (body[key] !== undefined) Object.assign(data, { [key]: body[key] })
  }
  if (body.birthDate !== undefined) data.birthDate = body.birthDate ? utcDate(body.birthDate) : null
  if (body.verificationStatus !== undefined) {
    data.verificationStatus = body.verificationStatus
    data.verifiedAt = body.verificationStatus === "VERIFIED" ? now : null
    data.verifiedBy = body.verificationStatus === "VERIFIED" ? reviewerUserId : null
  }
  if (
    body.displayName !== undefined || body.firstName !== undefined ||
    body.lastName !== undefined || body.middleName !== undefined
  ) {
    data.displayName = contactDisplayName({
      firstName: body.firstName ?? before.firstName,
      lastName: body.lastName ?? before.lastName,
      middleName: body.middleName !== undefined ? body.middleName : before.middleName,
      displayName: body.displayName,
    })
  }
  return data
}
