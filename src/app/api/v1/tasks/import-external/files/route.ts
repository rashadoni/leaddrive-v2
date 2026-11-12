import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdminRole } from "@/lib/tasks/board-permission"
import { withRlsAuth } from "@/lib/with-rls"
import { MAX_TASK_FILE_SIZE, storeTaskFile, taskFileTypeOf } from "@/lib/tasks/task-file-store"

/**
 * POST /api/v1/tasks/import-external/files — the files of tasks already
 * brought over from Bordio, fetched by the server itself (Zeytun, 2026-11-12:
 * «əvvəlki tasklardaki koment hissədə ki fayllar foto şəkillər açmır»). The
 * browser relay moved ~25 files a minute and stalled whenever the owner's
 * window lost focus; Bordio serves each file at a public link, so the CRM takes
 * a list of {task, name, link} and reads the bytes itself.
 *
 * Only Bordio's own file host, only https, no redirects followed: the server
 * never fetches an address a caller chose. Admins only, like the rest of the
 * import. A file of that name already on that task is skipped, so a list can be
 * sent again safely.
 */
const BORDIO_FILE = /^https:\/\/files\.prod\.bordio\.com\/f\/[0-9a-f-]{36}$/u

const schema = z.object({
  source: z.literal("bordio"),
  items: z.array(z.object({
    externalId: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(255),
    url: z.string().regex(BORDIO_FILE, "only Bordio file links"),
  })).min(1).max(30),
})

type Outcome = "ok" | "skip" | "notask" | "too_big" | "type" | "extension" | "content" | "fetch"
const PARALLEL = 4

async function fetchBytes(url: string): Promise<Buffer | "too_big" | null> {
  const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(180_000) }).catch(() => null)
  if (!res || !res.ok || !res.body) return null
  if (Number(res.headers.get("content-length") ?? 0) > MAX_TASK_FILE_SIZE) {
    await res.body.cancel().catch(() => {})
    return "too_big"
  }
  const chunks: Buffer[] = []
  let size = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined, failed: true }) as const)
    if (done) break
    size += value.byteLength
    if (size > MAX_TASK_FILE_SIZE) {
      await reader.cancel().catch(() => {})
      return "too_big"
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

export const POST = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isAdminRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only admins can import tasks from another tool" }, { status: 403 })
  }
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: `${issue.path.join(".")}: ${issue.message}` }, { status: 400 })
  }
  const { source, items } = parsed.data

  type TaskRow = { id: string; externalId: string | null; attachments: { originalName: string }[] }
  const tasks: TaskRow[] = await prisma.task.findMany({
    where: { organizationId: auth.orgId, externalSource: source, externalId: { in: [...new Set(items.map((i) => i.externalId))] }, deletedAt: null },
    select: { id: true, externalId: true, attachments: { select: { originalName: true } } },
  })
  const byExternal = new Map<string | null, { id: string; names: Set<string> }>(
    tasks.map((t) => [t.externalId, { id: t.id, names: new Set(t.attachments.map((a) => a.originalName)) }]),
  )

  const results: { externalId: string; name: string; outcome: Outcome; message?: string }[] = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const at = next++
      if (at >= items.length) return
      const item = items[at]
      const task = byExternal.get(item.externalId)
      if (!task) { results[at] = { externalId: item.externalId, name: item.name, outcome: "notask" }; continue }
      // Claimed before the fetch: the same name twice in one list is one file.
      if (task.names.has(item.name)) { results[at] = { externalId: item.externalId, name: item.name, outcome: "skip" }; continue }
      task.names.add(item.name)
      const mimeType = taskFileTypeOf(item.name)
      if (!mimeType) { results[at] = { externalId: item.externalId, name: item.name, outcome: "type" }; continue }
      const bytes = await fetchBytes(item.url)
      if (bytes === "too_big") { results[at] = { externalId: item.externalId, name: item.name, outcome: "too_big" }; continue }
      if (!bytes) { task.names.delete(item.name); results[at] = { externalId: item.externalId, name: item.name, outcome: "fetch" }; continue }
      const stored = await storeTaskFile({ organizationId: auth.orgId, taskId: task.id, userId: auth.userId || null, name: item.name, mimeType, bytes })
      results[at] = stored.ok
        ? { externalId: item.externalId, name: item.name, outcome: "ok" }
        : { externalId: item.externalId, name: item.name, outcome: stored.refusal, message: stored.message }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))

  const counts = results.reduce<Record<string, number>>((acc, r) => { acc[r.outcome] = (acc[r.outcome] ?? 0) + 1; return acc }, {})
  if (counts.ok) logAudit(auth.orgId, "import", "task", "files", source, { newValue: counts })
  return NextResponse.json({ success: true, data: { counts, results } })
})
