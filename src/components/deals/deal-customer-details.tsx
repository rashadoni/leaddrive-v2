"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Mail, Phone, Building2, Globe } from "lucide-react"

interface ContactInfo {
  id: string
  fullName: string
  position: string | null
  email: string | null
  phone: string | null
  avatar: string | null
}

interface CompanyRef {
  id: string
  name: string
}

interface CompanyDetails {
  industry: string | null
  country: string | null
  email: string | null
  phone: string | null
}

/**
 * Creatio-style "Customer details" block: contact card + company card
 * side by side. Company extras (industry/country) are fetched lazily
 * from the existing companies endpoint; the block renders fine without
 * them.
 */
export function DealCustomerDetails({
  contact,
  company,
  orgId,
  bare = false,
}: {
  contact: ContactInfo | null
  company: CompanyRef | null
  orgId?: string
  /** Render only the cards grid, without the outer card + heading (for embedding in a CollapsibleSection). */
  bare?: boolean
}) {
  const t = useTranslations("deals")
  const [companyDetails, setCompanyDetails] = useState<CompanyDetails | null>(null)

  useEffect(() => {
    if (!company?.id) { setCompanyDetails(null); return }
    const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {}
    let cancelled = false
    fetch(`/api/v1/companies/${company.id}`, { headers })
      .then(r => r.json())
      .then(json => {
        if (!cancelled && json.success && json.data) {
          setCompanyDetails({
            industry: json.data.industry ?? null,
            country: json.data.country ?? null,
            email: json.data.email ?? null,
            phone: json.data.phone ?? null,
          })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [company?.id, orgId])

  if (!contact && !company) return null

  const cards = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {contact && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3.5 flex gap-3 min-w-0">
            <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden">
              {contact.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={contact.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                contact.fullName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <Link href={`/contacts/${contact.id}`} className="text-sm font-semibold text-primary hover:underline block truncate">
                {contact.fullName}
              </Link>
              {contact.position && (
                <p className="text-xs text-muted-foreground truncate">{contact.position}</p>
              )}
              {contact.email && (
                <p className="text-xs flex items-center gap-1.5 min-w-0">
                  <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <a href={`mailto:${contact.email}`} className="text-primary hover:underline truncate">{contact.email}</a>
                </p>
              )}
              {contact.phone && (
                <p className="text-xs flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <a href={`tel:${contact.phone}`} className="text-primary hover:underline">{contact.phone}</a>
                </p>
              )}
            </div>
          </div>
        )}

        {company && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3.5 flex gap-3 min-w-0">
            <div className="h-11 w-11 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <Link href={`/companies/${company.id}`} className="text-sm font-semibold text-primary hover:underline block truncate">
                {company.name}
              </Link>
              <div className="flex items-center gap-1.5 flex-wrap">
                {companyDetails?.industry && (
                  <span className="inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    {companyDetails.industry}
                  </span>
                )}
                {companyDetails?.country && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    <Globe className="h-2.5 w-2.5" /> {companyDetails.country}
                  </span>
                )}
              </div>
              {companyDetails?.email && (
                <p className="text-xs flex items-center gap-1.5 min-w-0">
                  <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <a href={`mailto:${companyDetails.email}`} className="text-primary hover:underline truncate">{companyDetails.email}</a>
                </p>
              )}
              {companyDetails?.phone && (
                <p className="text-xs flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <a href={`tel:${companyDetails.phone}`} className="text-primary hover:underline">{companyDetails.phone}</a>
                </p>
              )}
            </div>
          </div>
        )}
    </div>
  )

  if (bare) return cards

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4">
      <p className="text-sm font-semibold mb-3">{t("customerDetails")}</p>
      {cards}
    </div>
  )
}
