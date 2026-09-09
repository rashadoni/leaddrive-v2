import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

function csvEscape(v: unknown): string {
  if (v == null) return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const GET = withRlsAuth("campaigns", "export", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const survey = await prisma.survey.findFirst({ where: { id, organizationId: orgId } })
  if (!survey) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId: id },
    orderBy: { completedAt: "desc" },
  })

  const header = [
    "completedAt",
    "score",
    "category",
    "comment",
    "email",
    "phone",
    "channel",
    "ticketId",
    "contactId",
    "answers",
  ]
  const rows = responses.map((r: any) =>
    [
      r.completedAt.toISOString(),
      r.score ?? "",
      r.category ?? "",
      r.comment ?? "",
      r.email ?? "",
      r.phone ?? "",
      r.channel ?? "",
      r.ticketId ?? "",
      r.contactId ?? "",
      JSON.stringify(r.answers ?? {}),
    ]
      .map(csvEscape)
      .join(","),
  )

  const csv = [header.join(","), ...rows].join("\n") + "\n"
  const filename = `survey-${survey.publicSlug}-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
})
