import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { sendSms } from "@/lib/sms"
import { requestOutboundWebhook } from "@/lib/integrations/webhook-url-guard"
import { checkGoal } from "@/lib/journey-goals"
import { randomUUID } from "node:crypto"

// Whitelist of fields that journey steps are allowed to update per entity type
const SAFE_UPDATE_FIELDS: Record<string, Set<string>> = {
  lead: new Set(["status", "priority", "assignedTo", "notes", "source", "tags"]),
  contact: new Set(["status", "notes", "tags"]),
}

interface StepResult {
  stepId: string
  stepType: string
  status: "completed" | "waiting" | "failed" | "skipped"
  message: string
  nextActionAt?: Date
}

interface ProcessingClaim {
  token: string
  leaseUntil: Date
}

const PROCESSING_LEASE_MS = 5 * 60_000

function claimedWhere(enrollmentId: string, orgId: string, claim: ProcessingClaim) {
  return {
    id: enrollmentId,
    organizationId: orgId,
    status: "active",
    processingToken: claim.token,
  }
}

async function failClaimedEnrollment(
  enrollment: { id: string; journeyId: string; organizationId: string },
  orgId: string,
  claim: ProcessingClaim,
  reason: string,
  result: StepResult,
): Promise<StepResult> {
  const failed = await prisma.journeyEnrollment.updateMany({
    where: claimedWhere(enrollment.id, orgId, claim),
    data: {
      status: "failed",
      exitReason: reason,
      completedAt: new Date(),
      currentStepId: null,
      nextActionAt: null,
      processingToken: null,
      processingLeaseUntil: null,
    },
  })
  if (failed.count === 1) {
    await prisma.journey.updateMany({
      where: { id: enrollment.journeyId, organizationId: orgId },
      data: { activeCount: { decrement: 1 } },
    })
  }
  return result
}

async function guardExternalSideEffect(
  enrollment: { id: string; journeyId: string; organizationId: string },
  orgId: string,
  claim: ProcessingClaim,
  stepId: string,
  stepType: string,
): Promise<StepResult | null> {
  const leaseUntil = new Date(Date.now() + PROCESSING_LEASE_MS)
  const renewed = await prisma.journeyEnrollment.updateMany({
    where: claimedWhere(enrollment.id, orgId, claim),
    data: { processingLeaseUntil: leaseUntil },
  })
  if (renewed.count !== 1) {
    return {
      stepId,
      stepType,
      status: "skipped",
      message: "Enrollment claim was released or superseded",
    }
  }
  claim.leaseUntil = leaseUntil

  const activeOrganization = await prisma.organization.findFirst({
    where: { id: orgId, isActive: true },
    select: { id: true },
  })
  if (activeOrganization) return null

  return failClaimedEnrollment(enrollment, orgId, claim, "inactive_organization", {
    stepId,
    stepType,
    status: "failed",
    message: "Organization is inactive",
  })
}

/**
 * Process the current step for a journey enrollment.
 * Executes the action (email, telegram, sms, etc.) and advances to next step.
 */
export async function processEnrollmentStep(enrollmentId: string, orgId: string): Promise<StepResult> {
  const now = new Date()
  const candidate = await prisma.journeyEnrollment.findFirst({
    where: {
      id: enrollmentId,
      organizationId: orgId,
      status: "active",
      currentStepId: { not: null },
      nextActionAt: { lte: now },
    },
  })

  if (!candidate?.currentStepId) {
    return { stepId: "", stepType: "", status: "skipped", message: "Enrollment is not active or due" }
  }

  const claim: ProcessingClaim = {
    token: randomUUID(),
    leaseUntil: new Date(now.getTime() + PROCESSING_LEASE_MS),
  }
  const claimed = await prisma.journeyEnrollment.updateMany({
    where: {
      id: enrollmentId,
      organizationId: orgId,
      status: "active",
      currentStepId: candidate.currentStepId,
      nextActionAt: { lte: now },
      OR: [
        { processingLeaseUntil: null },
        { processingLeaseUntil: { lte: now } },
      ],
    },
    data: {
      processingToken: claim.token,
      processingLeaseUntil: claim.leaseUntil,
    },
  })
  if (claimed.count !== 1) {
    return { stepId: candidate.currentStepId, stepType: "", status: "skipped", message: "Enrollment is already claimed" }
  }

  return processClaimedEnrollmentStep(enrollmentId, orgId, claim)
}

async function processClaimedEnrollmentStep(
  enrollmentId: string,
  orgId: string,
  claim: ProcessingClaim,
): Promise<StepResult> {
  const enrollment = await prisma.journeyEnrollment.findFirst({
    where: claimedWhere(enrollmentId, orgId, claim),
  })

  if (!enrollment || !enrollment.currentStepId) {
    return { stepId: "", stepType: "", status: "skipped", message: "Enrollment claim is no longer active" }
  }

  const activeOrganization = await prisma.organization.findFirst({
    where: { id: orgId, isActive: true },
    select: { id: true },
  })
  if (!activeOrganization) {
    return failClaimedEnrollment(enrollment, orgId, claim, "inactive_organization", {
      stepId: enrollment.currentStepId,
      stepType: "",
      status: "failed",
      message: "Organization is inactive",
    })
  }

  const journey = await prisma.journey.findFirst({
    where: { id: enrollment.journeyId, organizationId: orgId },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  })

  if (!journey) {
    return failClaimedEnrollment(enrollment, orgId, claim, "invalid_journey", {
      stepId: enrollment.currentStepId,
      stepType: "",
      status: "failed",
      message: "Journey not found",
    })
  }

  const currentStep = journey.steps.find((s: any) => s.id === enrollment.currentStepId)
  if (!currentStep) {
    return failClaimedEnrollment(enrollment, orgId, claim, "invalid_step", {
      stepId: enrollment.currentStepId,
      stepType: "",
      status: "failed",
      message: "Current step not found",
    })
  }

  // Goal/max-age checks live behind the same claim as delivery, so a cron run
  // cannot complete an enrollment while a direct request sends its step.
  if (journey.goalType && journey.exitOnGoal) {
    const goalReached = await checkGoal(enrollment, journey, orgId)
    if (goalReached) {
      const completed = await prisma.journeyEnrollment.updateMany({
        where: claimedWhere(enrollmentId, orgId, claim),
        data: {
          status: "completed",
          exitReason: "goal_reached",
          goalReachedAt: new Date(),
          completedAt: new Date(),
          currentStepId: null,
          nextActionAt: null,
          processingToken: null,
          processingLeaseUntil: null,
        },
      })
      if (completed.count === 1) {
        await prisma.journey.updateMany({
          where: { id: journey.id, organizationId: orgId },
          data: { conversionCount: { increment: 1 }, activeCount: { decrement: 1 } },
        })
      }
      return { stepId: currentStep.id, stepType: currentStep.stepType, status: "completed", message: "Journey goal reached" }
    }
  }

  if (journey.maxEnrollmentDays) {
    const enrolledDays = (Date.now() - enrollment.enrolledAt.getTime()) / 86400000
    if (enrolledDays > journey.maxEnrollmentDays) {
      const completed = await prisma.journeyEnrollment.updateMany({
        where: claimedWhere(enrollmentId, orgId, claim),
        data: {
          status: "completed",
          exitReason: "max_days",
          completedAt: new Date(),
          currentStepId: null,
          nextActionAt: null,
          processingToken: null,
          processingLeaseUntil: null,
        },
      })
      if (completed.count === 1) {
        await prisma.journey.updateMany({
          where: { id: journey.id, organizationId: orgId },
          data: { activeCount: { decrement: 1 }, completedCount: { increment: 1 } },
        })
      }
      return { stepId: currentStep.id, stepType: currentStep.stepType, status: "completed", message: "Maximum enrollment age exceeded" }
    }
  }

  const config = (currentStep.config || {}) as any
  const leadId = enrollment.leadId
  const contactId = enrollment.contactId
  const invoiceId = (enrollment as any).invoiceId as string | null

  if (!leadId && !contactId && !invoiceId) {
    return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
      stepId: currentStep.id,
      stepType: currentStep.stepType,
      status: "failed",
      message: "Enrollment target not found",
    })
  }

  // Get lead/contact info for template variables
  let recipientName = ""
  let recipientEmail = ""
  let recipientPhone = ""
  let companyName = ""
  let lead: any = null
  let contact: any = null

  if (leadId) {
    lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } })
    if (!lead) {
      return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
        stepId: currentStep.id,
        stepType: currentStep.stepType,
        status: "failed",
        message: "Enrollment target not found",
      })
    }
    recipientName = lead.contactName || ""
    recipientEmail = lead.email || ""
    recipientPhone = lead.phone || ""
    companyName = lead.companyName || ""
  }
  if (contactId) {
    contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId: orgId } })
    if (!contact) {
      return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
        stepId: currentStep.id,
        stepType: currentStep.stepType,
        status: "failed",
        message: "Enrollment target not found",
      })
    }
    if (!lead) {
      recipientName = contact.fullName || ""
      recipientEmail = contact.email || ""
      recipientPhone = contact.phone || ""
    }
  }

  // Invoice context (for invoice communication chains)
  let invoiceNumber = ""
  let invoiceAmount = ""
  let invoiceDueDate = ""
  let invoiceBalanceDue = ""
  let invoicePdfUrl = ""

  let invoice: any = null
  if (invoiceId) {
    invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      select: {
        invoiceNumber: true,
        totalAmount: true,
        balanceDue: true,
        dueDate: true,
        currency: true,
        viewToken: true,
        recipientName: true,
        recipientEmail: true,
        status: true,
        companyId: true,
        contactId: true,
      },
    })
    if (!invoice) {
      return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
        stepId: currentStep.id,
        stepType: currentStep.stepType,
        status: "failed",
        message: "Enrollment target not found",
      })
    }

    // An invoice relation can be structurally valid while still pointing at a
    // different tenant. Resolve relation fallbacks with explicit org filters.
    let invoiceContact = contact
    if (invoice.contactId) {
      if (contactId && invoice.contactId !== contactId) {
        return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
          stepId: currentStep.id,
          stepType: currentStep.stepType,
          status: "failed",
          message: "Enrollment target mismatch",
        })
      }
      if (!invoiceContact) {
        invoiceContact = await prisma.contact.findFirst({
          where: { id: invoice.contactId, organizationId: orgId },
        })
      }
      if (!invoiceContact) {
        return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
          stepId: currentStep.id,
          stepType: currentStep.stepType,
          status: "failed",
          message: "Enrollment target not found",
        })
      }
    }

    let invoiceCompany: any = null
    if (invoice.companyId) {
      invoiceCompany = await prisma.company.findFirst({
        where: { id: invoice.companyId, organizationId: orgId },
        select: { name: true },
      })
      if (!invoiceCompany) {
        return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
          stepId: currentStep.id,
          stepType: currentStep.stepType,
          status: "failed",
          message: "Enrollment target not found",
        })
      }
    }

    invoiceNumber     = invoice.invoiceNumber
    invoiceAmount     = `${invoice.totalAmount.toLocaleString()} ${invoice.currency}`
    invoiceBalanceDue = `${invoice.balanceDue.toLocaleString()} ${invoice.currency}`
    invoiceDueDate    = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : ""
    invoicePdfUrl     = invoice.viewToken
      ? `${process.env.NEXTAUTH_URL}/portal/invoice/${invoice.viewToken}` : ""
    if (!recipientName) recipientName = invoice.recipientName || invoiceContact?.fullName || ""
    if (!recipientEmail) recipientEmail = invoice.recipientEmail || invoiceContact?.email || ""
    if (!recipientPhone) recipientPhone = invoiceContact?.phone || ""
    if (!companyName) companyName = invoiceCompany?.name || ""
  }

  // Escape HTML special characters to prevent injection
  function escHtml(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  // Replace template variables (values are HTML-escaped to prevent injection)
  function replaceVars(text: string): string {
    return text
      .replace(/\{\{contact_name\}\}/g, escHtml(recipientName))
      .replace(/\{\{recipient_name\}\}/g, escHtml(recipientName))
      .replace(/\{\{company_name\}\}/g, escHtml(companyName))
      .replace(/\{\{email\}\}/g, escHtml(recipientEmail))
      .replace(/\{\{phone\}\}/g, escHtml(recipientPhone))
      .replace(/\{\{invoice_number\}\}/g, escHtml(invoiceNumber))
      .replace(/\{\{amount\}\}/g, escHtml(invoiceAmount))
      .replace(/\{\{due_date\}\}/g, escHtml(invoiceDueDate))
      .replace(/\{\{balance_due\}\}/g, escHtml(invoiceBalanceDue))
      .replace(/\{\{invoice_url\}\}/g, escHtml(invoicePdfUrl))
  }

  let result: StepResult

  try {
    switch (currentStep.stepType) {
      case "send_email": {
        if (!recipientEmail) {
          result = { stepId: currentStep.id, stepType: "send_email", status: "skipped", message: `No email for ${recipientName || "lead"}` }
          break
        }
        const subject = replaceVars(config.subject || "Без темы")
        const body = replaceVars(config.body || "")
        const guard = await guardExternalSideEffect(enrollment, orgId, claim, currentStep.id, "send_email")
        if (guard) return guard
        await sendEmail({
          to: recipientEmail,
          subject,
          html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">${body.replace(/\n/g, "<br>")}</div>`,
          organizationId: orgId,
        })
        result = { stepId: currentStep.id, stepType: "send_email", status: "completed", message: `Email sent to ${recipientEmail}: "${subject}"` }
        break
      }

      case "sms": {
        const message = replaceVars(config.message || "")
        if (!recipientPhone) {
          result = { stepId: currentStep.id, stepType: "sms", status: "completed", message: `SMS skipped (no phone): "${message.slice(0, 50)}..."` }
          break
        }
        const guard = await guardExternalSideEffect(enrollment, orgId, claim, currentStep.id, "sms")
        if (guard) return guard
        const smsResult = await sendSms({ to: recipientPhone, message, organizationId: orgId })
        result = smsResult.success
          ? { stepId: currentStep.id, stepType: "sms", status: "completed", message: `SMS sent to ${recipientPhone}${smsResult.messageId ? ` (id ${smsResult.messageId})` : ""}` }
          : { stepId: currentStep.id, stepType: "sms", status: "completed", message: `SMS error: ${smsResult.error || "unknown"}` }
        break
      }

      case "send_telegram": {
        const message = replaceVars(config.message || "")
        const tgChannel = await prisma.channelConfig.findFirst({
          where: { organizationId: orgId, channelType: "telegram", isActive: true },
        })
        if (tgChannel?.botToken) {
          const tgSettings = (tgChannel.settings as any) || {}
          const chatId = config.chatId || config.chat_id || tgSettings.chatId
          if (chatId) {
            const guard = await guardExternalSideEffect(enrollment, orgId, claim, currentStep.id, "send_telegram")
            if (guard) return guard
          }
          try {
            if (chatId) {
              // Previously this wrapped the message in a hardcoded Azerbaijani
              // "Ödəniş xatırlatması" header and the Güvən Technology finance
              // address (accreceivable@gtc.az, +994 10 236 99 09). That leaked
              // the old brand into every tenant's Telegram messages regardless
              // of language. The message itself is already localized by
              // invoice-chain-template.ts based on invoice.documentLanguage,
              // so we just send it as-is.
              const tgBody: any = {
                chat_id: chatId,
                text: message,
                parse_mode: "HTML",
              }
              const tgRes = await fetch(`https://api.telegram.org/bot${tgChannel.botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(tgBody),
              })
              const tgData = await tgRes.json()
              if (tgData.ok) {
                result = { stepId: currentStep.id, stepType: "send_telegram", status: "completed", message: `Telegram sent to chat ${chatId}` }
              } else {
                result = { stepId: currentStep.id, stepType: "send_telegram", status: "completed", message: `Telegram API: ${tgData.description}` }
              }
            } else {
              console.log(`[Journey Telegram] No chatId. Message: ${message}`)
              result = { stepId: currentStep.id, stepType: "send_telegram", status: "completed", message: `Telegram logged (no chatId): "${message.slice(0, 50)}..."` }
            }
          } catch (tgErr: any) {
            result = { stepId: currentStep.id, stepType: "send_telegram", status: "completed", message: `Telegram error: ${tgErr.message}` }
          }
        } else {
          console.log(`[Journey Telegram] No bot configured. Message: ${message}`)
          result = { stepId: currentStep.id, stepType: "send_telegram", status: "completed", message: `Telegram logged (no bot): "${message.slice(0, 50)}..."` }
        }
        break
      }

      case "send_whatsapp": {
        // Journey "send_whatsapp" step. The step's config.templateName wins;
        // otherwise we fall back to the org's default
        // ChannelConfig.settings.whatsappJourneyDefaultTemplate. If neither is
        // set → skip with a log entry instead of sending the old hardcoded
        // Azerbaijani invoice_payment_reminder to whomever happens to be the
        // enrollment target.
        if (!recipientPhone) {
          result = { stepId: currentStep.id, stepType: "send_whatsapp", status: "completed", message: `WhatsApp skipped (no phone)` }
          break
        }
        const waChannel = await prisma.channelConfig.findFirst({
          where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
        })
        const configTemplate = (config as any).templateName as string | undefined
        const settingsTemplate = (waChannel?.settings as any)?.whatsappJourneyDefaultTemplate as string | undefined
        const templateName = configTemplate || settingsTemplate
        if (!templateName) {
          result = { stepId: currentStep.id, stepType: "send_whatsapp", status: "completed", message: `WhatsApp skipped (no template configured; set step.config.templateName or ChannelConfig.settings.whatsappJourneyDefaultTemplate)` }
          break
        }
        const guard = await guardExternalSideEffect(enrollment, orgId, claim, currentStep.id, "send_whatsapp")
        if (guard) return guard
        try {
          const { sendWhatsAppTemplate } = await import("@/lib/whatsapp")
          const waRes = await sendWhatsAppTemplate({
            to: recipientPhone,
            templateName,
            languageCode: (config as any).languageCode,
            variables: {
              "1": recipientName || recipientPhone,
              "2": invoiceNumber || "-",
              "3": invoiceAmount || "-",
              "4": invoiceBalanceDue || "-",
              "5": invoiceDueDate || "-",
              customer_name: recipientName || recipientPhone,
              invoice_number: invoiceNumber || "-",
              amount: invoiceAmount || "-",
              balance_due: invoiceBalanceDue || "-",
              due_date: invoiceDueDate || "-",
            },
            organizationId: orgId,
          })
          if (waRes.success) {
            result = { stepId: currentStep.id, stepType: "send_whatsapp", status: "completed", message: `WhatsApp sent to ${recipientPhone}: ${waRes.messageId}` }
          } else {
            result = { stepId: currentStep.id, stepType: "send_whatsapp", status: "completed", message: `WhatsApp error: ${waRes.error}` }
          }
        } catch (waErr: any) {
          result = { stepId: currentStep.id, stepType: "send_whatsapp", status: "completed", message: `WhatsApp error: ${waErr.message}` }
        }
        break
      }

      case "wait": {
        const days = config.days || 1
        const unit = config.unit || "days"
        let ms: number
        switch (unit) {
          case "minutes": ms = days * 60 * 1000; break
          case "hours": ms = days * 60 * 60 * 1000; break
          case "weeks": ms = days * 7 * 24 * 60 * 60 * 1000; break
          default: ms = days * 24 * 60 * 60 * 1000; break
        }
        const nextActionAt = new Date(Date.now() + ms)
        const nextStep = journey.steps.find((s: any) => s.stepOrder === currentStep.stepOrder + 1)
        const released = await prisma.journeyEnrollment.updateMany({
          where: claimedWhere(enrollmentId, orgId, claim),
          data: {
            currentStepId: nextStep?.id ?? currentStep.id,
            nextActionAt,
            processingToken: null,
            processingLeaseUntil: null,
          },
        })
        if (released.count !== 1) {
          return {
            stepId: currentStep.id,
            stepType: "wait",
            status: "skipped",
            message: "Enrollment claim was released or superseded",
          }
        }

        // Mark step completed only after the claimed state transition wins.
        await prisma.journeyStep.update({
          where: { id: currentStep.id },
          data: { statsCompleted: { increment: 1 } },
        })

        // Move to next step (but don't execute yet — it becomes due at nextActionAt).
        if (nextStep) {
          await prisma.journeyStep.update({
            where: { id: nextStep.id },
            data: { statsEntered: { increment: 1 } },
          })
        }

        return {
          stepId: currentStep.id,
          stepType: "wait",
          status: "waiting",
          message: `Waiting ${days} ${unit} until ${nextActionAt.toISOString()}`,
          nextActionAt,
        }
      }

      case "condition": {
        const field = config.field || ""
        const operator = config.operator || "equals"
        const value = config.value || ""
        const onFalse = config.onFalse || "continue" // continue | skip_next | skip_2 | stop | restart
        const onTrue = config.onTrue || "continue"
        let fieldValue = ""

        // Get field value — check invoice first, then lead/contact
        if (field.startsWith("invoice_") || field === "balance_due") {
          if (invoice) {
            if (field === "invoice_status") fieldValue = invoice.status || ""
            else if (field === "balance_due") fieldValue = String(invoice.balanceDue || 0)
          }
        } else if (leadId) {
          if (lead) fieldValue = String((lead as any)[field] || "")
        } else if (contactId) {
          if (contact) fieldValue = String((contact as any)[field] || "")
        }

        let match = false
        switch (operator) {
          case "equals": match = fieldValue.toLowerCase() === value.toLowerCase(); break
          case "not_equals": match = fieldValue.toLowerCase() !== value.toLowerCase(); break
          case "contains": match = fieldValue.toLowerCase().includes(value.toLowerCase()); break
          case "not_empty": match = fieldValue.length > 0; break
        }

        if (match) {
          // Condition TRUE — apply onTrue action
          if (onTrue === "stop") {
            await prisma.journeyEnrollment.updateMany({
              where: claimedWhere(enrollmentId, orgId, claim),
              data: {
                status: "completed",
                exitReason: "condition_exit",
                completedAt: new Date(),
                currentStepId: null,
                nextActionAt: null,
                processingToken: null,
                processingLeaseUntil: null,
              },
            })
            return {
              stepId: currentStep.id, stepType: "condition", status: "completed",
              message: `Condition TRUE → Journey stopped. ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
            }
          }
          if (onTrue === "restart") {
            const firstStep = journey.steps.find((s: any) => s.stepOrder === 1)
            if (firstStep) {
              await prisma.journeyStep.update({ where: { id: currentStep.id }, data: { statsCompleted: { increment: 1 } } })
              await prisma.journeyEnrollment.updateMany({
                where: claimedWhere(enrollmentId, orgId, claim),
                data: {
                  currentStepId: firstStep.id,
                  nextActionAt: new Date(),
                  processingToken: null,
                  processingLeaseUntil: null,
                },
              })
              await prisma.journeyStep.update({ where: { id: firstStep.id }, data: { statsEntered: { increment: 1 } } })
              return {
                stepId: currentStep.id, stepType: "condition", status: "completed",
                message: `Condition TRUE → Restarting from step 1. ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
              }
            }
          }
          // Default: continue to next step
          result = {
            stepId: currentStep.id,
            stepType: "condition",
            status: "completed",
            message: `Condition TRUE: ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
          }
        } else {
          // Condition FALSE — apply onFalse action
          if (onFalse === "stop") {
            // Stop the entire journey
            await prisma.journeyEnrollment.updateMany({
              where: claimedWhere(enrollmentId, orgId, claim),
              data: {
                status: "completed",
                exitReason: "condition_exit",
                completedAt: new Date(),
                currentStepId: null,
                nextActionAt: null,
                processingToken: null,
                processingLeaseUntil: null,
              },
            })
            return {
              stepId: currentStep.id,
              stepType: "condition",
              status: "completed",
              message: `Condition FALSE → Journey stopped. ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
            }
          }

          if (onFalse === "restart") {
            // Restart from step 1 (loop)
            const firstStep = journey.steps.find((s: any) => s.stepOrder === 1)
            if (firstStep) {
              await prisma.journeyStep.update({ where: { id: currentStep.id }, data: { statsCompleted: { increment: 1 } } })
              await prisma.journeyEnrollment.updateMany({
                where: claimedWhere(enrollmentId, orgId, claim),
                data: {
                  currentStepId: firstStep.id,
                  nextActionAt: new Date(),
                  processingToken: null,
                  processingLeaseUntil: null,
                },
              })
              await prisma.journeyStep.update({ where: { id: firstStep.id }, data: { statsEntered: { increment: 1 } } })
              return {
                stepId: currentStep.id,
                stepType: "condition",
                status: "completed",
                message: `Condition FALSE → Restarting from step 1. ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
              }
            }
          }

          const skipCount = onFalse === "skip_2" ? 2 : onFalse === "skip_next" ? 1 : 0
          if (skipCount > 0) {
            // Skip N steps by advancing stepOrder
            const targetOrder = currentStep.stepOrder + 1 + skipCount
            const targetStep = journey.steps.find((s: any) => s.stepOrder >= targetOrder)
            if (targetStep) {
              await prisma.journeyStep.update({ where: { id: currentStep.id }, data: { statsCompleted: { increment: 1 } } })
              await prisma.journeyEnrollment.updateMany({
                where: claimedWhere(enrollmentId, orgId, claim),
                data: {
                  currentStepId: targetStep.id,
                  nextActionAt: new Date(),
                  processingToken: null,
                  processingLeaseUntil: null,
                },
              })
              await prisma.journeyStep.update({ where: { id: targetStep.id }, data: { statsEntered: { increment: 1 } } })
              return {
                stepId: currentStep.id,
                stepType: "condition",
                status: "completed",
                message: `Condition FALSE → Skipped ${skipCount} step(s). ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
              }
            }
            // No more steps after skip — complete journey
            await prisma.journeyEnrollment.updateMany({
              where: claimedWhere(enrollmentId, orgId, claim),
              data: {
                status: "completed",
                exitReason: "completed",
                completedAt: new Date(),
                currentStepId: null,
                nextActionAt: null,
                processingToken: null,
                processingLeaseUntil: null,
              },
            })
            return {
              stepId: currentStep.id,
              stepType: "condition",
              status: "completed",
              message: `Condition FALSE → Skipped past end → Journey completed. ${field} ${operator} ${value || ""}`,
            }
          }

          // Default: continue (same as TRUE)
          result = {
            stepId: currentStep.id,
            stepType: "condition",
            status: "completed",
            message: `Condition FALSE (continue): ${field} ${operator} ${value || ""} (value: "${fieldValue}")`,
          }
        }
        break
      }

      case "create_task": {
        await prisma.task.create({
          data: {
            organizationId: orgId,
            title: replaceVars(config.title || "Journey Task"),
            description: replaceVars(config.description || ""),
            status: "todo",
            priority: config.priority || "medium",
          },
        })
        result = { stepId: currentStep.id, stepType: "create_task", status: "completed", message: `Task created: "${config.title}"` }
        break
      }

      case "update_field": {
        const field = config.field || ""
        const newValue = config.value || ""
        const entityType = leadId ? "lead" : contactId ? "contact" : ""
        const allowedFields = entityType ? SAFE_UPDATE_FIELDS[entityType] : undefined
        if (!allowedFields || !allowedFields.has(field)) {
          console.error(`[Journey] Blocked update of restricted field: ${entityType || "unknown"}.${field}`)
          result = { stepId: currentStep.id, stepType: "update_field", status: "skipped", message: `Blocked restricted field: ${field}` }
          break
        }
        if (leadId && field) {
          const updated = await prisma.lead.updateMany({
            where: { id: leadId, organizationId: orgId },
            data: { [field]: newValue },
          })
          if (updated.count !== 1) throw new Error("Enrollment target changed during processing")
        } else if (contactId && field) {
          const updated = await prisma.contact.updateMany({
            where: { id: contactId, organizationId: orgId },
            data: { [field]: newValue },
          })
          if (updated.count !== 1) throw new Error("Enrollment target changed during processing")
        }
        result = { stepId: currentStep.id, stepType: "update_field", status: "completed", message: `Field "${field}" updated to "${newValue}"` }
        break
      }

      case "ab_split": {
        // A/B split: random routing by percentages
        const paths = (currentStep as any).splitPaths as { percentage: number; nextStepId: string }[] | null
        if (!paths || paths.length === 0) {
          result = { stepId: currentStep.id, stepType: "ab_split", status: "skipped", message: "No split paths configured" }
          break
        }
        const rand = Math.random() * 100
        let cumulative = 0
        let selectedPath = paths[paths.length - 1]
        for (const path of paths) {
          cumulative += path.percentage
          if (rand <= cumulative) { selectedPath = path; break }
        }
        // Navigate directly to the selected path step
        if (selectedPath.nextStepId) {
          const targetStep = journey.steps.find((s: any) => s.id === selectedPath.nextStepId)
          if (targetStep) {
            await prisma.journeyStep.update({ where: { id: currentStep.id }, data: { statsCompleted: { increment: 1 } } })
            const advanced = await prisma.journeyEnrollment.updateMany({
              where: claimedWhere(enrollmentId, orgId, claim),
              data: { currentStepId: targetStep.id, nextActionAt: new Date() },
            })
            if (advanced.count !== 1) {
              return {
                stepId: currentStep.id,
                stepType: "ab_split",
                status: "skipped",
                message: "Enrollment claim was released or superseded",
              }
            }
            await prisma.journeyStep.update({ where: { id: targetStep.id }, data: { statsEntered: { increment: 1 } } })
            return await processClaimedEnrollmentStep(enrollmentId, orgId, claim)
          }
        }
        result = { stepId: currentStep.id, stepType: "ab_split", status: "completed", message: `A/B split: routed to path` }
        break
      }

      case "goal_check": {
        // Check goal condition — if met, complete enrollment
        const goalField = config.field || ""
        const goalValue = config.value || ""
        let goalMet = false

        if (leadId) {
          if (lead) goalMet = String((lead as any)[goalField] || "") === goalValue
        } else if (contactId) {
          if (contact) goalMet = String((contact as any)[goalField] || "") === goalValue
        }

        if (goalMet) {
          const completed = await prisma.journeyEnrollment.updateMany({
            where: claimedWhere(enrollmentId, orgId, claim),
            data: {
              status: "completed",
              exitReason: "goal_reached",
              goalReachedAt: new Date(),
              completedAt: new Date(),
              currentStepId: null,
              nextActionAt: null,
              processingToken: null,
              processingLeaseUntil: null,
            },
          })
          if (completed.count === 1) {
            await prisma.journey.updateMany({
              where: { id: enrollment.journeyId, organizationId: orgId },
              data: { conversionCount: { increment: 1 }, activeCount: { decrement: 1 } },
            })
          }
          return { stepId: currentStep.id, stepType: "goal_check", status: "completed", message: `Goal reached: ${goalField} = ${goalValue}` }
        }
        result = { stepId: currentStep.id, stepType: "goal_check", status: "completed", message: `Goal not met: ${goalField} ≠ ${goalValue}` }
        break
      }

      case "webhook": {
        // Outbound POST with DNS/IP validation, pinned lookup, bounded redirects,
        // and a second validation at every redirect hop.
        const url = config.url || ""
        if (!url) {
          result = { stepId: currentStep.id, stepType: "webhook", status: "skipped", message: "No webhook URL configured" }
          break
        }
        const guard = await guardExternalSideEffect(enrollment, orgId, claim, currentStep.id, "webhook")
        if (guard) return guard
        try {
          await requestOutboundWebhook(String(url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enrollmentId, journeyId: enrollment.journeyId,
              contactId, leadId, stepId: currentStep.id,
              recipientName, recipientEmail,
            }),
            timeoutMs: 10_000,
            maxRedirects: 3,
          })
          result = { stepId: currentStep.id, stepType: "webhook", status: "completed", message: `Webhook sent to ${url}` }
        } catch (webhookErr: any) {
          result = { stepId: currentStep.id, stepType: "webhook", status: "completed", message: `Webhook error: ${webhookErr.message}` }
        }
        break
      }

      default:
        result = { stepId: currentStep.id, stepType: currentStep.stepType, status: "skipped", message: `Unknown step type: ${currentStep.stepType}` }
    }

    // Mark step completed
    await prisma.journeyStep.update({
      where: { id: currentStep.id },
      data: { statsCompleted: { increment: 1 } },
    })

    // Get next step using branching (Phase 4) or fallback to stepOrder
    let nextStep: any = null

    // For condition steps: use yes/no branching based on the result
    if (currentStep.stepType === "condition" || currentStep.stepType === "goal_check") {
      const conditionPassed = result.message.includes("TRUE") || result.message.includes("Goal reached") || result.message.includes("Met")
      const nextStepId = conditionPassed
        ? (currentStep as any).yesNextStepId
        : (currentStep as any).noNextStepId
      if (nextStepId) {
        nextStep = journey.steps.find((s: any) => s.id === nextStepId)
      }
    }

    // For regular steps: follow yesNextStepId (default path)
    if (!nextStep && (currentStep as any).yesNextStepId) {
      nextStep = journey.steps.find((s: any) => s.id === (currentStep as any).yesNextStepId)
    }

    // Fallback: stepOrder + 1 (backward compatibility)
    if (!nextStep) {
      nextStep = journey.steps.find((s: any) => s.stepOrder === currentStep.stepOrder + 1)
    }

    if (nextStep) {
      const advanced = await prisma.journeyEnrollment.updateMany({
        where: claimedWhere(enrollmentId, orgId, claim),
        data: { currentStepId: nextStep.id, nextActionAt: new Date() },
      })
      if (advanced.count !== 1) {
        return {
          stepId: currentStep.id,
          stepType: currentStep.stepType,
          status: "skipped",
          message: "Enrollment claim was released or superseded",
        }
      }
      await prisma.journeyStep.update({
        where: { id: nextStep.id },
        data: { statsEntered: { increment: 1 } },
      })

      // Process next step immediately (unless it's a wait)
      const nextResult = await processClaimedEnrollmentStep(enrollmentId, orgId, claim)
      return nextResult
    } else {
      // Journey completed — no more steps
      const completed = await prisma.journeyEnrollment.updateMany({
        where: claimedWhere(enrollmentId, orgId, claim),
        data: {
          status: "completed",
          completedAt: new Date(),
          currentStepId: null,
          nextActionAt: null,
          exitReason: "completed",
          processingToken: null,
          processingLeaseUntil: null,
        },
      })
      if (completed.count === 1) {
        await prisma.journey.updateMany({
          where: { id: enrollment.journeyId, organizationId: orgId },
          data: {
            activeCount: { decrement: 1 },
            completedCount: { increment: 1 },
          },
        })
      }
      result.message += " → Journey completed!"
      return result
    }
  } catch (err: any) {
    console.error(`[Journey Step Error] Step ${currentStep.id}: ${err.message}`)
    if (err?.message === "Enrollment target changed during processing") {
      return failClaimedEnrollment(enrollment, orgId, claim, "invalid_target", {
        stepId: currentStep.id,
        stepType: currentStep.stepType,
        status: "failed",
        message: err.message,
      })
    }
    return { stepId: currentStep.id, stepType: currentStep.stepType, status: "failed", message: err.message }
  }
}
