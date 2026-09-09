import { NextRequest, NextResponse } from "next/server"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  createOrUpdateMonitoringProfile,
  findProfileCandidates,
  listMonitoringProfiles,
  suggestProfileAliases,
  buildMonitoringProfileView,
  pickCanonicalScenario,
} from "@/lib/social/monitoring-profiles"
import { monitoringProfileSchema } from "@/lib/social/monitoring-profile-schema"
import { getMonitoringScenarios } from "@/lib/social/monitoring-scenarios"

/**
 * The unified surface an SMM/PR manager works with. Subjects and scenarios stay
 * behind it; see docs/social-monitoring-unified-profile-spec.md.
 *
 * GET without `name`  → every profile, split into active and archive.
 * GET with `name`     → step-1 lookup: existing/archived matches plus local
 *                       spelling suggestions. Local only — no provider call.
 */
export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const name = req.nextUrl.searchParams.get("name")?.trim()
  const companyId = req.nextUrl.searchParams.get("companyId")?.trim()

  // Карточка компании в CRM спрашивает только «есть ли мониторинг у этого
  // клиента». Полный listMonitoringProfiles ради одной строки считал бы
  // находки по всем объектам организации.
  //
  // Архивные показываем: архив — обратимое состояние оператора, и скрытая
  // связь превращалась бы в невидимую — отвязать её было бы нечем, а карточка
  // предлагала бы завести дубль. Исключаем только 'deleted': мягкое удаление
  // профиля не чистит companyId, и надгробие всплывало бы как живой мониторинг.
  if (companyId) {
    const linked = await prisma.monitoringSubject.findMany({
      where: {
        organizationId: auth.orgId,
        companyId,
        status: { not: "deleted" },
      },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    })
    return NextResponse.json({ success: true, data: { linked } })
  }

  if (name) {
    const [candidates, scenarios] = await Promise.all([
      findProfileCandidates(auth.orgId, name),
      getMonitoringScenarios(auth.orgId),
    ])
    const scenariosBySubject = new Map<string, typeof scenarios>()
    for (const scenario of scenarios) {
      if (!scenario.subjectId) continue
      const group = scenariosBySubject.get(scenario.subjectId) ?? []
      group.push(scenario)
      scenariosBySubject.set(scenario.subjectId, group)
    }
    return NextResponse.json({
      success: true,
      data: {
        matches: candidates.map(subject => buildMonitoringProfileView(
          subject,
          pickCanonicalScenario(scenariosBySubject.get(subject.id) ?? []),
        )),
        suggestions: suggestProfileAliases(name),
      },
    })
  }

  const profiles = await listMonitoringProfiles(auth.orgId)
  return NextResponse.json({
    success: true,
    data: {
      profiles,
      stats: {
        total: profiles.length,
        active: profiles.filter(profile => profile.status === "active").length,
        paused: profiles.filter(profile => profile.status === "paused").length,
        needsResume: profiles.filter(profile => profile.status === "needs_resume").length,
        archived: profiles.filter(profile => profile.status === "archived").length,
      },
    },
  })
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth) => {
  const parsed = monitoringProfileSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid monitoring profile" }, { status: 400 })
  }
  try {
    // Rolling clients may still send the removed page/profile picker fields.
    // Do not let either field recreate subject MONITORS links.
    const {
      sourceIds: _ignoredSourceIds,
      officialSourceIds: _ignoredOfficialSourceIds,
      ...profileInput
    } = parsed.data
    void _ignoredSourceIds
    void _ignoredOfficialSourceIds
    const profile = await createOrUpdateMonitoringProfile(auth.orgId, auth.userId, profileInput)
    await logAudit(auth.orgId, "create", "monitoring_profile", profile.id, profile.name)
    return NextResponse.json({ success: true, data: profile }, { status: 201 })
  } catch (error) {
    // The orchestrator already compensated (a half-created profile is left
    // paused, never active-but-collecting-nothing). Report the real reason so
    // the wizard can keep the operator's configuration on screen.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save monitoring" },
      { status: 400 },
    )
  }
})
