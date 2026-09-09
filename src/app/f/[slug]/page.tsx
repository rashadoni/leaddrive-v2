/**
 * P8 No-Code Form Builder — slice-3 public renderer page.
 *
 * URL: `/f/[slug]?org=<organizationId>`
 *
 * Reads the form definition server-side (via direct prisma access
 * for SSR speed; the public API is for embedded/iframe contexts) and
 * renders the form with progressive enhancement. The actual submit
 * happens via fetch from the client widget.
 */
import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import type { FormFieldSchema } from "@/lib/form-builder/types"
import { PublicFormWidget } from "@/components/form-builder/public-form-widget"

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ org?: string }>
}

export default async function PublicFormPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { org } = await searchParams

  if (!org) notFound()

  // Direct DB read for SSR speed. The public API route exists for
  // iframe/embed contexts where the page is served from a different
  // host; here we have first-party access.
  // RLS: the URL carries the org id explicitly — no cross-tenant resolution
  // needed (no bypass); the lookup itself runs tenant-scoped under the
  // caller-supplied org. A wrong org fails closed: zero rows → 404.
  const form = await runWithTenant(org, () =>
    prisma.formDefinition.findUnique({
      where: { organizationId_slug: { organizationId: org, slug } },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
        fields: true,
        status: true,
        successMessage: true,
        redirectUrl: true,
      },
    })
  )

  if (!form || form.status !== "published") notFound()

  // Fire-and-forget view counter — matches the API route. (RLS: tenant-scoped.)
  runWithTenant(org, () =>
    prisma.formDefinition.update({ where: { id: form.id }, data: { totalViews: { increment: 1 } } })
  ).catch((e: unknown) => {
    console.warn(`[/f/${slug}] totalViews increment failed:`, e)
  })

  const fields = form.fields as unknown as FormFieldSchema[]

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900 flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 p-6 sm:p-8">
        <h1 className="text-2xl font-semibold mb-2">{form.name}</h1>
        {form.description ? (
          <p className="text-sm text-muted-foreground mb-6 whitespace-pre-wrap">{form.description}</p>
        ) : (
          <div className="mb-6" />
        )}

        <PublicFormWidget
          organizationId={form.organizationId}
          slug={form.slug}
          fields={fields}
          successMessage={form.successMessage}
          redirectUrl={form.redirectUrl}
        />
      </div>
    </div>
  )
}
