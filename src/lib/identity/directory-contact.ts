type AccountContact = { cutoverAt: Date | string | null; phoneClaim?: { normalizedPhone: string } | null } | null | undefined
/** Private already-authorized directory projection, never ownership or login
 * admission. A converted person must never display a stale legacy number when
 * its current verified claim is absent. Shadow claims remain non-authoritative. */
export function identityDirectoryPhone(input: { userAccount?: AccountContact; boundAccount?: AccountContact; legacyPhone: string | null }): string | null {
  const account = input.boundAccount?.cutoverAt ? input.boundAccount : input.userAccount?.cutoverAt ? input.userAccount : null
  return account ? account.phoneClaim?.normalizedPhone ?? null : input.legacyPhone
}
