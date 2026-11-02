import { prisma } from "@/lib/prisma"
import { defaultLocale, locales, type Locale } from "@/i18n/routing"

/**
 * The language a ticket's customer is written to in, when no browser is there
 * to say: a WhatsApp message, an e-mail, a link the customer opens later.
 *
 * The rule is the one the renewal cron and the tenant settings already state
 * («Fallback language for renewal / meeting-recap / social-reply when the
 * contact has no preferredLanguage»): the contact's own `preferredLanguage`;
 * else the organization's `settings.language`, or the older `settings.locale`;
 * else the application default.
 *
 * `settings.language` is «Язык общения с клиентами» in Settings → Organization
 * (/api/v1/settings/organization/language, admin-only) and in the superadmin
 * tenant editor. Until 2026-10-17 it was the «Язык брифинга» select of the AI
 * delivery card; the owner moved it, as one setting, to where an admin looking
 * for the chat's or the notices' language would find it.
 *
 * Found on 2026-10-17: the main tenant has `settings.language = "az"`, one
 * contact of 692 on production has a language of its own, and that tenant's
 * WhatsApp customers were told about their tickets in Russian and English.
 */

function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (locales as readonly string[]).includes(value) ? (value as Locale) : null
}

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
}

export function organizationLocale(settings: unknown): Locale {
  const record = settingsRecord(settings)
  return asLocale(record.language) ?? asLocale(record.locale) ?? defaultLocale
}

export function customerLocale(input: { contactLanguage?: string | null; organizationSettings?: unknown }): Locale {
  return asLocale(input.contactLanguage) ?? organizationLocale(input.organizationSettings)
}

/** `Organization.settings.timezone` when it names a zone, else null. */
export function organizationTimezone(settings: unknown): string | null {
  const value = settingsRecord(settings).timezone
  return typeof value === "string" && value ? value : null
}

export type CustomerLanguageContext = { locale: Locale; timezone: string | null }

/**
 * Reads what `customerLocale` needs. Runs inside the caller's tenant scope
 * (contacts are under FORCE RLS). Never throws: a failed read means the
 * application default, not an unsent notification.
 */
export async function loadCustomerLanguage(input: { organizationId: string; contactId?: string | null }): Promise<CustomerLanguageContext> {
  try {
    const [organization, contact] = await Promise.all([
      prisma.organization.findUnique({ where: { id: input.organizationId }, select: { settings: true } }),
      input.contactId
        ? prisma.contact.findFirst({
            where: { id: input.contactId, organizationId: input.organizationId },
            select: { preferredLanguage: true },
          })
        : Promise.resolve(null),
    ])
    return {
      locale: customerLocale({ contactLanguage: contact?.preferredLanguage, organizationSettings: organization?.settings }),
      timezone: organizationTimezone(organization?.settings),
    }
  } catch (error) {
    console.error("[customer-locale] falling back to the default language:", error)
    return { locale: defaultLocale, timezone: null }
  }
}

/** The organization's own language — for text its team reads, such as a ticket subject. */
export async function loadOrganizationLocale(organizationId: string): Promise<Locale> {
  try {
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
    return organizationLocale(organization?.settings)
  } catch (error) {
    console.error("[customer-locale] falling back to the default language:", error)
    return defaultLocale
  }
}
