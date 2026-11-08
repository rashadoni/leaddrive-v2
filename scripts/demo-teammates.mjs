// Demo teammates a seed puts into a tenant so its pipeline, deal teams and
// reports have names on them. They are scenery, not accounts.
//
// Until 2026-11-08 they were accounts. The tenant demo seed created Sarah
// Johnson (manager), Alex Chen and Maria Lopez as ACTIVE users on
// `<slug>.com`, with the same temporary password the tenant's admin got in the
// welcome email. `<slug>.com` is somebody else's domain: on that day
// biznesdoktor.com was unregistered, atsfood.com was parked for sale and
// servicedesk.com belonged to a stranger. Whoever holds such a domain receives
// «Забыли пароль?» for sarah@<slug>.com and signs in to a client's CRM as a
// manager. Two of the three also carried the role "member", which no
// permission check knows: the menu offered them 79 pages and the API refused
// every one.
//
// So a demo teammate now:
//  - holds a role the permission matrix enforces (never "member");
//  - lives on the reserved `.invalid` TLD (RFC 2606), so no reset mail can ever
//    be delivered to anyone;
//  - is inactive, so neither a password, nor OAuth, nor the JWT callback lets
//    it in (src/lib/auth.ts refuses isActive=false on every path);
//  - gets a random password hash nobody has ever seen — never the seed's
//    password.
import { randomBytes } from "node:crypto"

/** Roles the permission matrix enforces and a tenant admin may assign. */
export const DEMO_TEAMMATE_ROLES = new Set(["manager", "sales", "support", "viewer"])

/** Reserved TLD: mail to it is undeliverable by definition (RFC 2606). */
export const DEMO_TEAMMATE_EMAIL_DOMAIN = "demo.invalid"

function local(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** `alex.chen` + `afigroup` → `alex.chen@afigroup.demo.invalid` */
export function demoTeammateEmail(localPart, slug) {
  const user = String(localPart).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
  return `${user}@${local(slug)}.${DEMO_TEAMMATE_EMAIL_DOMAIN}`
}

/**
 * The fields a seed writes for one demo teammate. `hashPassword` is the seed's
 * own bcrypt (passed in so this module needs no dependency); it hashes a
 * random secret that leaves this function only as a hash.
 */
export async function demoTeammateData({ name, localPart, role }, slug, hashPassword) {
  if (!DEMO_TEAMMATE_ROLES.has(role)) {
    throw new Error(`Demo teammate role "${role}" is not an enforced role`)
  }
  return {
    name,
    email: demoTeammateEmail(localPart, slug),
    role,
    isActive: false,
    passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
  }
}
