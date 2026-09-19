import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { DemoPlayer } from "@/components/demo-center/demo-player"
import { getDemoModules } from "@/lib/demo-center/catalog"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isSuperAdminSession } from "@/lib/superadmin-guard"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Demo preview | LeadDrive",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}

export default async function DemoRequestPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ modules?: string | string[] }>
}) {
  if (!(await isSuperAdminSession())) redirect("/dashboard")

  const [{ id }, query] = await Promise.all([params, searchParams])
  const request = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({
      where: { id },
      select: { id: true, company: true },
    }),
  )
  if (!request) notFound()

  const rawModules = Array.isArray(query.modules) ? query.modules.join(",") : query.modules || ""
  const modules = getDemoModules(rawModules.split(",").filter(Boolean))
  if (!modules.length) redirect(`/admin/demo-requests/${request.id}`)

  const moduleKey = modules.map((module) => module.id).join("-")

  return (
    <DemoPlayer
      token={`admin-preview-${request.id}-${moduleKey}`}
      company={request.company}
      watermark={`${request.company} · Admin ön baxışı`}
      modules={modules}
      previewMode
    />
  )
}
