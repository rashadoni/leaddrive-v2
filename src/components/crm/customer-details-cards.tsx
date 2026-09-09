"use client"

import Link from "next/link"
import { Mail, Phone, Building2, Globe } from "lucide-react"

interface PersonCard {
  name: string
  subtitle?: string | null
  email?: string | null
  phone?: string | null
  href?: string
}

interface CompanyCard {
  name: string
  industry?: string | null
  country?: string | null
  email?: string | null
  phone?: string | null
  href?: string
}

function NameEl({ name, href }: { name: string; href?: string }) {
  if (href) {
    return (
      <Link href={href} className="text-sm font-semibold text-primary hover:underline block truncate">
        {name}
      </Link>
    )
  }
  return <p className="text-sm font-semibold truncate">{name}</p>
}

/**
 * Creatio-style "Customer details" cards (contact + company side by
 * side), data-agnostic: works for leads (plain strings, no links) and
 * any record that can map its fields. Fetch-free — callers pass what
 * they have.
 */
export function CustomerDetailsCards({
  person,
  company,
}: {
  person?: PersonCard | null
  company?: CompanyCard | null
}) {
  if (!person && !company) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {person && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3.5 flex gap-3 min-w-0">
          <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0">
            {person.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <NameEl name={person.name} href={person.href} />
            {person.subtitle && <p className="text-xs text-muted-foreground truncate">{person.subtitle}</p>}
            {person.email && (
              <p className="text-xs flex items-center gap-1.5 min-w-0">
                <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <a href={`mailto:${person.email}`} className="text-primary hover:underline truncate">{person.email}</a>
              </p>
            )}
            {person.phone && (
              <p className="text-xs flex items-center gap-1.5">
                <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <a href={`tel:${person.phone}`} className="text-primary hover:underline">{person.phone}</a>
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
            <NameEl name={company.name} href={company.href} />
            <div className="flex items-center gap-1.5 flex-wrap">
              {company.industry && (
                <span className="inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  {company.industry}
                </span>
              )}
              {company.country && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  <Globe className="h-2.5 w-2.5" /> {company.country}
                </span>
              )}
            </div>
            {company.email && (
              <p className="text-xs flex items-center gap-1.5 min-w-0">
                <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <a href={`mailto:${company.email}`} className="text-primary hover:underline truncate">{company.email}</a>
              </p>
            )}
            {company.phone && (
              <p className="text-xs flex items-center gap-1.5">
                <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <a href={`tel:${company.phone}`} className="text-primary hover:underline">{company.phone}</a>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
