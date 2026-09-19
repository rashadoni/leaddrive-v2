import { createHash } from "node:crypto"

export interface ContactDuplicateSource {
  id: string
  displayName: string
  specialtyName?: string | null
  phone?: string | null
}

export function normalizeContactText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

export function normalizeContactPhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "")
  // Agents enter the same local number as +994… or 0…. The final nine
  // digits are the stable subscriber identity for supported field markets.
  return digits.length >= 9 ? digits.slice(-9) : digits
}

export function contactRequestHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function splitContactName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().replace(/\s+/g, " ").split(" ")
  return { firstName: parts.shift() || displayName.trim(), lastName: parts.join(" ") || "—" }
}

export function rankContactDuplicates(
  input: { displayName: string; phone?: string | null },
  contacts: ContactDuplicateSource[],
) {
  const name = normalizeContactText(input.displayName)
  const phone = normalizeContactPhone(input.phone)
  return contacts.flatMap((contact) => {
    const sameName = normalizeContactText(contact.displayName) === name
    const samePhone = Boolean(phone) && normalizeContactPhone(contact.phone) === phone
    if (!sameName && !samePhone) return []
    return [{
      id: contact.id,
      displayName: contact.displayName,
      specialtyName: contact.specialtyName ?? null,
      phone: contact.phone ?? null,
      exact: sameName && (phone ? samePhone : true),
      reasons: [sameName ? "NAME" : null, samePhone ? "PHONE" : null].filter(Boolean),
    }]
  })
}
