"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"

/**
 * A sign-in number as it is typed (owner, 2026-11-19: «особый формат: + а потом только цифры
 * и количество цифр»): «+» first, then digits only — letters, spaces, dashes and brackets never
 * get in. An Azerbaijani number (+994) stops at its nine digits after the code; any other
 * country at the 15 digits E.164 allows. «00» typed for «+» becomes «+».
 */
export const AZ_PHONE_DIGITS = 12 // 994 + nine
export const MAX_PHONE_DIGITS = 15

export function typedPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "")
  if (!raw.trimStart().startsWith("+") && digits.startsWith("00")) digits = digits.slice(2)
  digits = digits.slice(0, digits.startsWith("994") ? AZ_PHONE_DIGITS : MAX_PHONE_DIGITS)
  return digits ? `+${digits}` : raw.includes("+") ? "+" : ""
}

type PhoneInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string
  onValueChange: (value: string) => void
}

export function PhoneInput({ value, onValueChange, onFocus, onBlur, ...props }: PhoneInputProps) {
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      maxLength={MAX_PHONE_DIGITS + 1}
      value={value}
      onChange={(event) => onValueChange(typedPhone(event.target.value))}
      // The «+» is there before the first digit, so nobody types a national «050…».
      onFocus={(event) => { if (!value) onValueChange("+"); onFocus?.(event) }}
      onBlur={(event) => { if (value === "+") onValueChange(""); onBlur?.(event) }}
    />
  )
}
