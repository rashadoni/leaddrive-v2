import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { resolveTicketCategoryForWrite } from "@/lib/ticketing/category-service"

/**
 * Fire an in-app + push notification for a freshly-registered complaint, MIRRORING the new-ticket
 * notification (src/app/api/v1/tickets/route.ts): title "Новая жалоба <number>", message = subject,
 * pushed to the ticket's assignee (or org-wide in-app when unassigned). entityType "complaint" →
 * the bell click-through lands on /complaints. Best-effort; never throws.
 */
export async function notifyComplaintRegistered(orgId: string, ticketId: string): Promise<void> {
  try {
    const tk = await prisma.ticket.findFirst({
      where: { id: ticketId, organizationId: orgId },
      select: { ticketNumber: true, subject: true, assignedTo: true, priority: true },
    })
    await createNotification({
      organizationId: orgId,
      userId: tk?.assignedTo || "",
      // Mirror the new-ticket severity mapping, but a complaint is never the lowest tier: a critical
      // complaint shows as an error (red), anything else as a warning (amber) — always noticeable.
      type: tk?.priority === "critical" ? "error" : "warning",
      title: `Новая жалоба${tk?.ticketNumber ? " " + tk.ticketNumber : ""}`,
      message: tk?.subject || "Жалоба от клиента",
      entityType: "complaint",
      entityId: ticketId,
      push: true,
      kind: "complaint.created",
    })
  } catch (err) {
    console.error(`[complaint-register] notify failed for ${ticketId}:`, err)
  }
}

/**
 * Ensure a ticket is registered as a COMPLAINT so it surfaces in the Complaints Register
 * (/complaints / Şikayət reyestri): attach a ComplaintMeta row + upgrade the ticket to the
 * "complaint" category and tag — idempotently (no-op if a ComplaintMeta already exists).
 *
 * WHY: WhatsApp Da Vinci only created the ComplaintMeta INSIDE its new-ticket block, which is
 * skipped when a recent open ticket already exists (the 1h duplicate guard). So a customer who
 * complained AFTER an earlier general ticket never reached the registry. This re-attaches the
 * complaint to that existing ticket instead of silently dropping it.
 */
export async function ensureComplaintRegistered(opts: {
  orgId: string
  ticketId: string
}): Promise<{ created: boolean }> {
  const existing = await prisma.complaintMeta.findFirst({
    where: { ticketId: opts.ticketId },
    select: { id: true },
  })
  if (existing) return { created: false }

  await prisma.complaintMeta.create({
    data: { ticketId: opts.ticketId, organizationId: opts.orgId, complaintType: "complaint" },
  })
  const complaintCategory = await resolveTicketCategoryForWrite(opts.orgId, {
    category: "complaint",
    scope: "complaint",
  })
  // Re-classify the ticket so the operator + the /complaints filter see it as a complaint.
  // Log (don't silently swallow) a failed re-classify — else the ComplaintMeta exists but the
  // ticket stays category:"general" and the /complaints category filter may miss it.
  await prisma.ticket
    .update({
      where: { id: opts.ticketId },
      data: { category: "complaint", categoryId: complaintCategory.categoryId, tags: { push: "complaint" } },
    })
    .catch((err: unknown) => console.error(`[complaint-register] re-classify ticket ${opts.ticketId} failed:`, err))
  // Notify the team a complaint just landed — same treatment as a new ticket (bell + push).
  notifyComplaintRegistered(opts.orgId, opts.ticketId).catch(() => {})
  return { created: true }
}
