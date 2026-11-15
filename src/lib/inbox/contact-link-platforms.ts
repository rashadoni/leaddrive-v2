/**
 * Platforms whose messages carry no customer identity of their own — an Instagram or Messenger sender is
 * only a page-scoped id — so a manager ties their conversation to a customer by hand (lib/inbox/contact-link).
 * Kept apart from that module so the inbox screen can read it without the database client.
 */
export const CONTACT_LINKABLE_PLATFORMS = ["instagram", "facebook"] as const
export type ContactLinkablePlatform = (typeof CONTACT_LINKABLE_PLATFORMS)[number]

export function isContactLinkablePlatform(platform: string | null | undefined): platform is ContactLinkablePlatform {
  return (CONTACT_LINKABLE_PLATFORMS as readonly string[]).includes(platform ?? "")
}
