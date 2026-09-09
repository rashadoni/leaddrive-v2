import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { verifyUnsubToken } from "@/lib/survey-triggers"

export const dynamic = "force-dynamic"

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; e?: string; t?: string }>
}) {
  const sp = await searchParams
  const surveyId = sp.s
  const email = sp.e
  const token = sp.t

  let status: "ok" | "invalid" | "error" = "invalid"
  let organizationName = ""

  if (surveyId && email && token) {
    // RLS: the survey id from the link is the external identifier → org resolution under bypass.
    // The HMAC unsubscribe token is verified against the resolved org BEFORE any tenant-scoped work.
    const survey = await runWithRlsBypass(() =>
      prisma.survey.findUnique({
        where: { id: surveyId },
        include: { organization: { select: { id: true, name: true } } },
      })
    )
    if (survey && verifyUnsubToken(survey.organizationId, survey.id, email, token)) {
      try {
        // RLS: org resolved + token verified — unsubscribe read/write runs tenant-scoped.
        await runWithTenant(survey.organizationId, async () => {
          const existing = await prisma.surveyUnsubscribe.findFirst({
            where: {
              organizationId: survey.organizationId,
              email: email.toLowerCase(),
              surveyId: null,
            },
          })
          if (!existing) {
            await prisma.surveyUnsubscribe.create({
              data: {
                organizationId: survey.organizationId,
                surveyId: null,
                email: email.toLowerCase(),
                reason: "unsubscribe_link",
              },
            })
          }
        })
        status = "ok"
        organizationName = survey.organization.name
      } catch {
        status = "error"
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-xl border p-8 text-center space-y-3">
        {status === "ok" ? (
          <>
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold">You&rsquo;ve been unsubscribed</h1>
            <p className="text-sm text-muted-foreground">You will no longer receive survey emails from {organizationName}.</p>
          </>
        ) : status === "error" ? (
          <>
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">Please try again later or contact support.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Invalid unsubscribe link</h1>
            <p className="text-sm text-muted-foreground">This link is invalid or has expired.</p>
          </>
        )}
      </div>
    </div>
  )
}
