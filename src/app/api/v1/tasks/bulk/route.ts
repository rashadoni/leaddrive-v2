import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { recalcProjectCompletion } from "@/lib/project-rollup"

// §5.7 flow-history fix: bulk status moves must emit status_changed activity —
// without it, cycle time / CFD / aging go blind on every bulk-moved task. Only
// rows whose status actually changes get a row, and it's written inside the same
// transaction as the updateMany so the move + its history are atomic.
async function emitBulkStatusActivity(
  tx: Prisma.TransactionClient,
  rows: { id: string; status: string }[],
  newStatus: string,
  orgId: string,
  userId: string | null,
) {
  const acts = rows
    .filter((r) => r.status !== newStatus)
    .map((r) => ({
      organizationId: orgId,
      taskId: r.id,
      userId: userId || null,
      action: "status_changed",
      oldValue: r.status,
      newValue: newStatus,
    }))
  if (acts.length) await tx.taskActivity.createMany({ data: acts })
}

const bulkUpdateSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["complete", "delete", "update_status", "update_priority", "reassign", "update_custom_field"]),
  value: z.string().optional(), // new status, priority, or assignedTo
  // For action=update_custom_field:
  //   fieldName  — the slug from CustomField.fieldName
  //   fieldValue — null deletes the key; non-null merges via JSONB concat
  fieldName: z.string().optional(),
  fieldValue: z.unknown().optional(),
})

export const POST = withRlsAuth("tasks", "write", async (req: NextRequest, authResult) => {
  const orgId = authResult.orgId

  const body = await req.json()
  const parsed = bulkUpdateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const { ids, action, value, fieldName, fieldValue } = parsed.data

  try {
    const where = { id: { in: ids }, organizationId: orgId }

    // Snapshot the projectIds of affected tasks BEFORE the bulk write so
    // we know which Project rollups to recalc afterwards. Status changes,
    // deletes, and completes all shift the project's completionPercentage.
    // We capture this for every action so the helper is centralized.
    const affectedProjectIds = new Set<string>()
    // Snapshot id+status+projectId before the write so we can (a) recalc the
    // right project rollups and (b) emit status_changed activity for the moves.
    let affectedRows: { id: string; status: string; projectId: string | null }[] = []
    const projectActions: ReadonlyArray<typeof action> = [
      "complete",
      "delete",
      "update_status",
    ]
    if (projectActions.includes(action)) {
      affectedRows = await prisma.task.findMany({
        where,
        select: { id: true, status: true, projectId: true },
      })
      for (const r of affectedRows) {
        if (r.projectId) affectedProjectIds.add(r.projectId)
      }
    }

    switch (action) {
      case "complete":
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.task.updateMany({
            where,
            data: { status: "completed", completedAt: new Date() },
          })
          await emitBulkStatusActivity(tx, affectedRows, "completed", orgId, authResult.userId || null)
        })
        logAudit(orgId, "bulk_update", "task", ids.join(","), `Completed ${ids.length} tasks`)
        break

      case "delete": {
        // Check delete permission separately — RBAC-equivalent to the prior inner
        // requireAuth(…,"tasks","delete"); the outer withRlsAuth already enforced
        // authenticate/org-status/module/2FA/tenant-binding, so the only NEW gate
        // here is the delete-action permission. 403 shape matches requireAuth verbatim.
        if (!checkPermission(authResult.role, "tasks", "delete")) {
          return NextResponse.json(
            { error: "Forbidden", message: `Role "${authResult.role}" cannot "delete" on "tasks"` },
            { status: 403 },
          )
        }
        await prisma.task.deleteMany({ where })
        logAudit(orgId, "bulk_delete", "task", ids.join(","), `Deleted ${ids.length} tasks`)
        break
      }

      case "update_status": {
        if (!value || !["pending", "in_progress", "completed", "cancelled"].includes(value)) {
          return NextResponse.json({ error: "Invalid status value" }, { status: 400 })
        }
        const newStatus = value
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.task.updateMany({
            where,
            data: {
              status: newStatus,
              ...(newStatus === "completed" ? { completedAt: new Date() } : {}),
            },
          })
          await emitBulkStatusActivity(tx, affectedRows, newStatus, orgId, authResult.userId || null)
        })
        logAudit(orgId, "bulk_update", "task", ids.join(","), `Updated ${ids.length} tasks to ${value}`)
        break
      }

      case "update_priority":
        if (!value || !["low", "medium", "high", "urgent"].includes(value)) {
          return NextResponse.json({ error: "Invalid priority value" }, { status: 400 })
        }
        await prisma.task.updateMany({ where, data: { priority: value } })
        logAudit(orgId, "bulk_update", "task", ids.join(","), `Updated ${ids.length} tasks priority to ${value}`)
        break

      case "reassign":
        await prisma.task.updateMany({ where, data: { assignedTo: value || null } })
        logAudit(orgId, "bulk_update", "task", ids.join(","), `Reassigned ${ids.length} tasks`)
        break

      case "update_custom_field": {
        if (!fieldName) {
          return NextResponse.json({ error: "fieldName is required for update_custom_field" }, { status: 400 })
        }
        // Verify the field exists for this org (prevents writing arbitrary keys)
        const def = await prisma.customField.findFirst({
          where: { organizationId: orgId, entityType: "task", fieldName, isActive: true },
        })
        if (!def) {
          return NextResponse.json({ error: `Custom field "${fieldName}" not found` }, { status: 404 })
        }
        // Roadmap #9: bulk "Clear value" on a required field would leave all
        // selected tasks in an invalid state. Reject the operation.
        // Message format matches validateRequiredCustomFields() for i18n consistency.
        if (def.isRequired && (fieldValue === null || fieldValue === undefined || fieldValue === "")) {
          return NextResponse.json({ error: `Field "${def.fieldLabel}" is required` }, { status: 400 })
        }
        // Server-side value validation by fieldType — the UI restricts what
        // users can pick, but the API is independently callable. Without
        // this guard, a hand-crafted POST could store any JSONB under any key.
        if (fieldValue !== null && fieldValue !== undefined) {
          if (def.fieldType === "select") {
            if (!def.options.includes(String(fieldValue))) {
              return NextResponse.json({ error: `Value "${fieldValue}" is not in the allowed options for "${fieldName}"` }, { status: 400 })
            }
          } else if (def.fieldType === "boolean") {
            if (typeof fieldValue !== "boolean") {
              return NextResponse.json({ error: `Field "${fieldName}" requires a boolean value` }, { status: 400 })
            }
          } else if (def.fieldType === "number") {
            if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
              return NextResponse.json({ error: `Field "${fieldName}" requires a numeric value` }, { status: 400 })
            }
          } else if (def.fieldType === "text" || def.fieldType === "textarea" || def.fieldType === "date") {
            if (typeof fieldValue !== "string") {
              return NextResponse.json({ error: `Field "${fieldName}" requires a string value` }, { status: 400 })
            }
          }
        }
        // For null/undefined: delete the key from each task's customFields JSONB.
        // For non-null: merge via JSONB concat (preserves all other keys on each row).
        // Using raw SQL because prisma.updateMany doesn't support JSONB operators.
        if (fieldValue === null || fieldValue === undefined) {
          await prisma.$executeRaw`
            UPDATE tasks
            SET "customFields" = COALESCE("customFields", '{}'::jsonb) - ${fieldName}
            WHERE id = ANY(${ids}::text[]) AND "organizationId" = ${orgId}
          `
        } else {
          // Wrap the new value as a single-key JSONB object, then concat
          const patch = JSON.stringify({ [fieldName]: fieldValue })
          await prisma.$executeRaw`
            UPDATE tasks
            SET "customFields" = COALESCE("customFields", '{}'::jsonb) || ${patch}::jsonb
            WHERE id = ANY(${ids}::text[]) AND "organizationId" = ${orgId}
          `
        }
        logAudit(orgId, "bulk_update", "task", ids.join(","), `Set custom field "${fieldName}" on ${ids.length} tasks`)
        break
      }
    }

    // Recalc rollup on every project whose tasks were touched. Fire-and-
    // forget (caller doesn't await this); errors are logged but don't
    // fail the bulk response since the data write already succeeded.
    for (const pid of affectedProjectIds) {
      recalcProjectCompletion(pid, orgId).catch((err) =>
        console.error("[tasks bulk] rollup failed for project", pid, err),
      )
    }

    return NextResponse.json({ success: true, affected: ids.length })
  } catch (e) {
    console.error("[Tasks Bulk]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
