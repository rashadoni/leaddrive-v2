"use client"

import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { contactSpecialtyKey } from "@/lib/mtm/contact-specialties"

/**
 * The specialty of a client: a choice from the tenant's list (MTM settings →
 * «Специальности клиентов»), so the same specialty is not typed three ways and
 * the «Клиенты» filter can find it. A tenant that keeps no list types it
 * freely, as before. A value the list no longer has stays selectable — opening
 * and saving a card must not silently drop its specialty.
 */
export function ContactSpecialtyInput({
  id,
  value,
  onChange,
  specialties,
  chooseLabel,
  placeholder,
  required = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  specialties: readonly string[]
  /** The empty choice: «not set». */
  chooseLabel: string
  placeholder?: string
  required?: boolean
}) {
  if (specialties.length === 0) {
    return <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={500} required={required} />
  }
  const current = value.trim()
  // Stored «pediatr» and listed «Pediatr» are the same choice.
  const listed = specialties.find((name) => contactSpecialtyKey(name) === contactSpecialtyKey(current))
  return (
    <Select id={id} value={listed ?? current} onChange={(event) => onChange(event.target.value)} required={required}>
      <option value="">{chooseLabel}</option>
      {current && !listed ? <option value={current}>{current}</option> : null}
      {specialties.map((name) => <option key={name} value={name}>{name}</option>)}
    </Select>
  )
}
