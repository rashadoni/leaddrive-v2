/**
 * Build an abuse-control identity without changing the address used for
 * storage or delivery.
 *
 * Subaddress tags are deliberately collapsed for every domain. A small number
 * of mail systems can treat `+` as a literal local-part character, but sharing
 * a rate-limit bucket is safer than letting an unauthenticated sender turn
 * common plus-addressing into a mailbox-bombing bypass. Gmail's documented
 * dot aliases and the googlemail.com alias are collapsed as well; dots remain
 * significant for every other domain.
 */
export function publicEmailAbuseKey(email: string): string {
  const normalized = email.trim().toLowerCase()
  const at = normalized.lastIndexOf("@")
  if (at <= 0 || at === normalized.length - 1) return normalized

  let local = normalized.slice(0, at)
  let domain = normalized.slice(at + 1)

  const plus = local.indexOf("+")
  if (plus > 0) local = local.slice(0, plus)

  if (domain === "googlemail.com") domain = "gmail.com"
  if (domain === "gmail.com") local = local.replaceAll(".", "")

  return `${local}@${domain}`
}
