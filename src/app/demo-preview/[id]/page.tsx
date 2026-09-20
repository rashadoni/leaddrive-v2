import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { DemoPlayer } from "@/components/demo-center/demo-player"
import { DemoJourneyPlayer } from "@/components/demo-center/journey/demo-journey-player"
import { getDemoModules } from "@/lib/demo-center/catalog"
import {
  DEMO_SOURCE_CHANNELS,
  getDemoJourneyScenario,
  type DemoProspectIdentity,
  type DemoSourceChannel,
} from "@/lib/demo-center/journey"
import { maskEmail, maskPhone } from "@/lib/demo-center/security"
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

function sourceChannelOf(value: string | null | undefined): DemoSourceChannel {
  const candidate = (value ?? "").toLowerCase()
  return (DEMO_SOURCE_CHANNELS as readonly string[]).includes(candidate)
    ? (candidate as DemoSourceChannel)
    : "website"
}

export default async function DemoRequestPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ modules?: string | string[]; scenario?: string | string[] }>
}) {
  if (!(await isSuperAdminSession())) redirect("/dashboard")

  const [{ id }, query] = await Promise.all([params, searchParams])
  const request = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({
      where: { id },
      select: { id: true, name: true, company: true, jobTitle: true, email: true, phone: true, source: true },
    }),
  )
  if (!request) notFound()

  // Guided journey preview. Effect-free by construction: the journey player
  // never fetches, and preview mode keeps its progress in memory only.
  const rawScenario = Array.isArray(query.scenario) ? query.scenario[0] : query.scenario
  if (rawScenario) {
    const manifest = getDemoJourneyScenario(rawScenario)
    if (!manifest) redirect(`/admin/demo-requests/${request.id}`)

    const identity: DemoProspectIdentity = {
      name: request.name,
      company: request.company,
      jobTitle: request.jobTitle,
      emailMasked: maskEmail(request.email),
      phoneMasked: request.phone ? maskPhone(request.phone) : null,
      sourceChannel: sourceChannelOf(request.source),
    }

    return (
      <DemoJourneyPlayer
        token={`admin-preview-${request.id}-${manifest.scenarioId}-${manifest.version}`}
        manifest={manifest}
        identity={identity}
        company={request.company}
        watermark={`${request.company} · Admin ön baxışı`}
        previewMode
      />
    )
  }

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
