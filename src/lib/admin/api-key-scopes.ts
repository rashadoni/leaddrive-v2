/**
 * Ключ, выпущенный до отделения соцмониторинга от Omni-Channel (2026-08-01):
 * его scope'ы `read:inbox` / `write:inbox` больше НЕ открывают /api/v1/social —
 * там теперь `read:social` / `write:social`.
 *
 * Scope'ы у уже выпущенного ключа не редактируются (PATCH /api/v1/api-keys/[id]
 * меняет только имя и isActive), поэтому такой интеграции нужен НОВЫЙ ключ.
 * Суперадминская карточка тенанта помечает такие ключи, чтобы владелец видел их
 * без обхода тенантов.
 */
export function usesLegacyInboxScope(scopes: readonly string[]): boolean {
  return scopes.some((s) => s === "read:inbox" || s === "write:inbox")
}

/** Scope, подсвечиваемый как устаревший в списке scope'ов ключа. */
export function isLegacyInboxScope(scope: string): boolean {
  return scope === "read:inbox" || scope === "write:inbox"
}
