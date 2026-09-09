"use client"
import { Input } from "@/components/ui/input"
import { isDecimalLineType } from "@/lib/cpq/line-types"

interface QuantityInputProps {
  productType: string | null | undefined
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  title?: string
  "aria-label"?: string
}

/** Integer-only (digit-sanitized) for discrete types; decimal (step 0.01, min 0.01)
 *  for `service`. Keeps the UI in lockstep with the API's isValidLineQuantity rule. */
export function QuantityInput({
  productType, value, onChange, disabled, className, placeholder, title,
  "aria-label": ariaLabel,
}: QuantityInputProps) {
  if (isDecimalLineType(productType)) {
    return (
      <Input
        type="number" step="0.01" min="0.01" value={value} disabled={disabled}
        className={className} placeholder={placeholder} title={title} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Input
      type="text" inputMode="numeric" pattern="[0-9]*" value={value} disabled={disabled}
      className={className} placeholder={placeholder} title={title} aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
    />
  )
}
