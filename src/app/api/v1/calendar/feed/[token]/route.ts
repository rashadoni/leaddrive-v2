import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

const categoryLabels: Record<string, string> = {
  call: "[Call]",
  email: "[Email]",
  meeting: "[Meeting]",
  deal: "[Deal]",
  contact: "[Contact]",
  company: "[Company]",
  lead: "[Lead]",
  ticket: "[Ticket]",
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return runWithRlsBypass(async () => {
  const { token } = await params

  // A calendar URL is a long-lived bearer credential. Re-resolve its owner on
  // every request so disabling either the user or the tenant revokes the feed
  // immediately without waiting for the token itself to be rotated.
  const user = await prisma.user.findFirst({
    where: {
      calendarToken: token,
      isActive: true,
      organization: { isActive: true },
    },
    select: { id: true, organizationId: true },
  })

  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const tasks = await prisma.task.findMany({
    where: {
      organizationId: user.organizationId,
      dueDate: { not: null },
      deletedAt: null,
      // Personal feed semantics match the product's existing “My Tasks” view:
      // primary assignee and co-assignee tasks are included; merely creating a
      // task does not publish it, and another user's task can never enter the
      // bearer feed just because it belongs to the same organization.
      OR: [
        { assignedTo: user.id },
        { collaborators: { some: { userId: user.id } } },
      ],
    },
    orderBy: { dueDate: "asc" },
  })

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeadDrive CRM//Tasks//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:LeadDrive Tasks",
    "X-WR-TIMEZONE:Asia/Baku",
  ]

  for (const task of tasks) {
    if (!task.dueDate) continue
    const d = task.dueDate
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
    const prefix = categoryLabels[task.relatedType || ""] || ""
    const summary = prefix ? `${prefix} ${task.title}` : task.title

    lines.push("BEGIN:VEVENT")
    lines.push(`UID:task-${task.id}@leaddrive-crm`)
    lines.push(`DTSTART;VALUE=DATE:${dateStr}`)
    lines.push(`DTEND;VALUE=DATE:${dateStr}`)
    lines.push(`SUMMARY:${icsEscape(summary)}`)
    if (task.description) {
      lines.push(`DESCRIPTION:${icsEscape(task.description)}`)
    }
    lines.push(`STATUS:${task.status === "completed" ? "COMPLETED" : "NEEDS-ACTION"}`)
    if (task.priority === "high" || task.priority === "urgent") {
      lines.push("PRIORITY:1")
    } else if (task.priority === "medium") {
      lines.push("PRIORITY:5")
    } else {
      lines.push("PRIORITY:9")
    }
    lines.push("END:VEVENT")
  }

  lines.push("END:VCALENDAR")

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "attachment; filename=leaddrive-tasks.ics",
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
  })
}
