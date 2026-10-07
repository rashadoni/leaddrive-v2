/** Read only own data properties. Do not invoke accessors, coercion or toJSON.
 * Hostile proxies are refused; the policy is intentionally bounded, not recursive.
 */
export function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && "value" in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

export function oneOf<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && choices.includes(value as T) ? value as T : fallback
}

export function boundedNumber(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : undefined
}

export function hex(value: unknown, length: number): string | undefined {
  return typeof value === "string" && value.length === length && /^[a-f0-9]+$/.test(value) ? value : undefined
}
