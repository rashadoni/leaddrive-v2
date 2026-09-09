import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isAdminRole } from "@/lib/tasks/board-permission"
import type { Role } from "@/lib/permissions"

// Board admin = the roles allowed to edit a board's structure.
function isBoardAdmin(role: Role) {
  return isAdminRole(role) || role === "manager"
}

// Thrown inside the transaction to surface a 400 (vs a 500) with a message.
class ColumnError extends Error {}

const columnInput = z.object({
  // Present for an existing column (must already belong to this board); omitted
  // for a NEW column — the server generates a stable, immutable key.
  key: z.string().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(40),
  // mapsToStatus is ALWAYS one of the 6 canonical stages — the canonical state a
  // task takes when moved into this column. (Keys may be arbitrary; status stays
  // load-bearing.)
  mapsToStatus: z.enum(["backlog", "todo", "in_progress", "testing", "review", "done"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/u, "color must be a #RRGGBB hex").nullable().optional(),
})

const putColumnsSchema = z.object({
  // The FULL ordered column list. Array order = sortOrder. 1..12 columns.
  columns: z.array(columnInput).min(1).max(12),
})

function newColumnKey(): string {
  return "col_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16)
}

/**
 * PUT /api/v1/divisions/[id]/columns — declaratively set a board's columns.
 *
 * The editor sends the FULL ordered list; the route reconciles in ONE
 * transaction: create new columns (generate key), update kept ones (label /
 * mapsToStatus / color / sortOrder), delete removed ones AND null out their
 * tasks' boardColumnKey so those tasks fold by `status` (never lost). status
 * stays canonical; changing a populated column's mapsToStatus only affects FUTURE
 * moves into it — existing tasks keep their canonical status (no surprise bulk
 * re-stamp). This is the Phase 2 write path; the legacy Division.columns toggle
 * (synced in divisions/[id] PATCH) is superseded and removed in Phase 3.
 *
 * IMPORTANT: this route writes board_columns ONLY and INTENTIONALLY leaves
 * Division.columns stale. Do NOT "fix" this by syncing both paths — the boards
 * page reads board_columns first (Division.columns is only a fallback for boards
 * that have none), and the legacy toggle's sync (divisions/[id] PATCH) only
 * removes CANONICAL keys, so custom `col_*` columns survive a legacy edit. Phase 3
 * drops Division.columns entirely.
 */
export const PUT = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!isBoardAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins/managers can edit board columns" }, { status: 403 })
  }
  const { id } = await params
  const parsed = putColumnsSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // Org-scope guard: the board must belong to this org before we touch it.
  const division = await prisma.division.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true } })
  if (!division) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Duplicate-key guard within the payload (two rows claiming the same key).
  const providedKeys = parsed.data.columns.map((c) => c.key).filter((k): k is string => !!k)
  if (new Set(providedKeys).size !== providedKeys.length) {
    return NextResponse.json({ error: "Duplicate column key in payload" }, { status: 400 })
  }

  try {
    const { before, after } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.boardColumn.findMany({
        where: { divisionId: id },
        select: { key: true, label: true, mapsToStatus: true },
      })
      const existingKeys = new Set(existing.map((c) => c.key))

      // Any provided key must already exist on THIS board (no smuggling keys in).
      for (const k of providedKeys) {
        if (!existingKeys.has(k)) throw new ColumnError(`Unknown column key "${k}" for this board`)
      }

      // Resolve keys (new columns get a generated key); sortOrder = array index.
      const resolved = parsed.data.columns.map((c, i) => ({
        key: c.key ?? newColumnKey(),
        label: c.label,
        mapsToStatus: c.mapsToStatus,
        color: c.color ?? null,
        sortOrder: i,
      }))
      const keepKeys = new Set(resolved.map((c) => c.key))

      // Delete removed columns + detach their tasks (boardColumnKey -> null so they
      // fold by status). Org+division scoped.
      const toDelete = [...existingKeys].filter((k) => !keepKeys.has(k))
      if (toDelete.length) {
        await tx.task.updateMany({
          where: { organizationId: auth.orgId, divisionId: id, boardColumnKey: { in: toDelete } },
          data: { boardColumnKey: null },
        })
        await tx.boardColumn.deleteMany({ where: { divisionId: id, key: { in: toDelete } } })
      }

      // Upsert kept + new, in order.
      for (const c of resolved) {
        await tx.boardColumn.upsert({
          where: { divisionId_key: { divisionId: id, key: c.key } },
          update: { label: c.label, mapsToStatus: c.mapsToStatus, color: c.color, sortOrder: c.sortOrder },
          create: {
            organizationId: auth.orgId,
            divisionId: id,
            key: c.key,
            label: c.label,
            mapsToStatus: c.mapsToStatus,
            color: c.color,
            sortOrder: c.sortOrder,
          },
        })
      }

      const final = await tx.boardColumn.findMany({
        where: { divisionId: id },
        orderBy: { sortOrder: "asc" },
        select: { key: true, label: true, mapsToStatus: true, color: true, sortOrder: true },
      })
      return { before: existing, after: final }
    })
    // Audit the structural change with BOTH the prior and new column sets — a
    // board's column layout is security-relevant config (parity with the
    // board-permission revoke audit).
    const summarize = (cs: { key: string; label: string; mapsToStatus: string }[]) =>
      cs.map((c) => `${c.key}:${c.label}=>${c.mapsToStatus}`)
    logAudit(auth.orgId, "update", "division", id, undefined, {
      oldValue: { columns: summarize(before) },
      newValue: { columns: summarize(after) },
    })
    return NextResponse.json({ success: true, data: after })
  } catch (e) {
    if (e instanceof ColumnError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error("[divisions columns PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
