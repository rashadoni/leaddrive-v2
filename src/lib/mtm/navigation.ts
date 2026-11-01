/**
 * `/mtm` is a landing page, not a prefix tab. Keeping it exact prevents the
 * old double-active state where both “Today” and the current child page looked
 * selected. Child destinations remain active on their detail routes.
 *
 * The module's menu itself is the Route & Field group in `nav-items.ts`
 * (owner, 2026-11-01: one menu, the left one).
 */
export function isMtmNavigationItemActive(href: string, pathname: string): boolean {
  if (href === "/mtm") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
