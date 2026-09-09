/**
 * Shared invoice→profile linkage for the CDP read + write paths.
 *
 * A UnifiedProfile has no direct FK to Invoice; the link is via the contact /
 * company of its source records. CRITICAL: a profile can absorb MULTIPLE
 * contacts (e.g. two contacts sharing an email merge into one profile), so
 * paid invoices must be matched against ALL of a profile's contact-type
 * sources — not just its `primaryContactId` — otherwise a merged profile
 * silently undercounts spend (the slice-1 P2 finding).
 *
 * Both the materializer (`profile-builder` Phase B) and the on-the-fly read
 * route (`/api/v1/calculated-insights`) import these helpers, so the two paths
 * can never drift apart on how spend is attributed.
 */

export interface ProfileLinkRow {
  id: string
  primaryContactId: string | null
  primaryCompanyId: string | null
  /**
   * Sources attached to the profile. Only `sourceType === "contact"` rows
   * carry an invoice-linkable id (the `sourceId` IS the Contact.id). Lead /
   * mtm_customer / web_chat_session sources don't link to invoices directly.
   */
  sources: ReadonlyArray<{ sourceType: string; sourceId: string }>
}

export interface InvoiceLinkMaps {
  /** Contact.id → UnifiedProfile.id — union of primaryContactId + every contact source. */
  contactToProfile: Map<string, string>
  /** Company.id → UnifiedProfile.id — from primaryCompanyId. */
  companyToProfile: Map<string, string>
}

/**
 * Build the contact/company → profile lookup maps across ALL of each profile's
 * contact-type sources (plus the legacy primaryContactId / primaryCompanyId).
 */
export function buildInvoiceLinkMaps(profiles: ReadonlyArray<ProfileLinkRow>): InvoiceLinkMaps {
  const contactToProfile = new Map<string, string>()
  const companyToProfile = new Map<string, string>()
  for (const p of profiles) {
    if (p.primaryContactId) contactToProfile.set(p.primaryContactId, p.id)
    if (p.primaryCompanyId) companyToProfile.set(p.primaryCompanyId, p.id)
    for (const s of p.sources) {
      if (s.sourceType === "contact") contactToProfile.set(s.sourceId, p.id)
    }
  }
  return { contactToProfile, companyToProfile }
}

/** Distinct contact + company ids — feed these into an Invoice `OR` filter. */
export function linkIds(maps: InvoiceLinkMaps): { contactIds: string[]; companyIds: string[] } {
  return {
    contactIds: Array.from(maps.contactToProfile.keys()),
    companyIds: Array.from(maps.companyToProfile.keys()),
  }
}

/**
 * Resolve an invoice to a single profile id. Contact-mapped wins over
 * company-mapped — prevents double-counting a multi-contact company invoice.
 * Returns `undefined` when neither side maps to a profile.
 */
export function resolveInvoiceProfileId(
  inv: { contactId: string | null; companyId: string | null },
  maps: InvoiceLinkMaps,
): string | undefined {
  const fromContact = inv.contactId ? maps.contactToProfile.get(inv.contactId) : undefined
  const fromCompany = inv.companyId ? maps.companyToProfile.get(inv.companyId) : undefined
  return fromContact ?? fromCompany
}
