import { COMPANY_EMAIL } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getDemoModules } from "./catalog"
import { sendDemoRequestNotification } from "./email"

export type DemoEmailConfirmation = "confirmed" | "already_confirmed" | "failed"

/**
 * The request's address is proven: the prospect opened the link that was sent
 * only to that mailbox and pressed the button on the page. The request is
 * marked, and the owner hears about it — exactly once, whoever wins the claim.
 *
 * Owner, 2026-10-18: a request with an invented address («Mms», «Mdme»,
 * mzmdmmd@fmdm.ru) reached his inbox the moment the form was sent. Since then
 * the form only stores the request and mails the link; the owner's
 * «Yeni demo sorğusu» goes out from here. A request nobody confirms stays in
 * Demo Center and never reaches his inbox.
 *
 * Never throws: the prospect's demo does not wait on the owner's inbox. If
 * the notification fails, the request is still confirmed in Demo Center.
 */
export async function confirmDemoRequestEmail(requestId: string, now: Date = new Date()): Promise<DemoEmailConfirmation> {
  try {
    const claimed = await runWithRlsBypass(() =>
      prisma.demoRequest.updateMany({
        where: { id: requestId, emailConfirmedAt: null },
        data: { emailConfirmedAt: now },
      }),
    )
    if (!claimed.count) return "already_confirmed"

    const request = await runWithRlsBypass(() =>
      prisma.demoRequest.findUnique({
        where: { id: requestId },
        select: { id: true, name: true, company: true, email: true, phone: true, jobTitle: true, message: true, requestedModules: true },
      }),
    )
    if (!request) return "failed"

    const delivery = await sendDemoRequestNotification({
      to: COMPANY_EMAIL,
      confirmation: "confirmed",
      requestId: request.id,
      name: request.name,
      company: request.company,
      email: request.email,
      phone: request.phone,
      jobTitle: request.jobTitle,
      message: request.message,
      requestedModuleNames: getDemoModules(request.requestedModules).map((module) => module.title),
    })
    if (!delivery.success) {
      console.error("[demo-email-confirmation] owner notification not delivered", { requestId, error: delivery.error })
    }
    return "confirmed"
  } catch (error) {
    console.error("[demo-email-confirmation] could not confirm", { requestId }, error)
    return "failed"
  }
}
