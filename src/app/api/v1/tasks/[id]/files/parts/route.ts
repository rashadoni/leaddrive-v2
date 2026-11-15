import { NextResponse } from "next/server"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises"
import path from "path"
import { prisma } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { withRlsAuth } from "@/lib/with-rls"
import { resolveRuntimePaths } from "@/lib/runtime-paths"
import { openTenantFileBytes, sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { validateUploadBytes } from "@/lib/upload-security"
import { storeTaskFile } from "@/lib/tasks/task-file-store"
import {
  MAX_TASK_FILE_PARTS,
  MAX_TASK_FILE_SIZE,
  TASK_FILE_EXTENSIONS,
  TASK_FILE_PART_SIZE,
  taskFileExtension,
  taskFileStoredType,
} from "@/lib/tasks/task-file-rules"

/**
 * POST /api/v1/tasks/[id]/files/parts — a card's file, sent in parts of 8 MB.
 *
 * Nazrin, 2026-11-15: a promo video for a task answered «server error». One
 * request may carry 10 MB past the Next proxy (and 20 MB past nginx); beyond
 * that the route got a cut body and failed to read it. Files of up to 100 MB
 * are task files since 2026-11-12, so the browser sends them in order, one part
 * per request (raw bytes, `?upload=<32 hex>&index=&count=&size=&name=&type=`),
 * and the last part puts the file together and stores it the one way a task
 * file is stored (task-file-store.ts).
 *
 * The parts wait on disk sealed with the organization's key, like the files
 * themselves, under the uploader's own folder: one person cannot add to, or
 * finish, another's upload. A part sent again replaces itself; part 0 starts
 * the upload afresh; an upload left unfinished is swept after six hours.
 */

const UPLOAD_ID = /^[0-9a-f]{32}$/u
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/u
const STALE_MS = 6 * 60 * 60 * 1000

function partsRoot(): string {
  return path.join(resolveRuntimePaths().runtimeRoot, "upload-parts", "tasks")
}

/** Removes uploads nobody finished: org/user/upload folders untouched for six hours. */
async function sweepStaleParts(now: number): Promise<void> {
  const root = partsRoot()
  const orgs = await readdir(root).catch(() => [] as string[])
  for (const org of orgs) {
    const users = await readdir(path.join(root, org)).catch(() => [] as string[])
    for (const user of users) {
      const uploads = await readdir(path.join(root, org, user)).catch(() => [] as string[])
      for (const upload of uploads) {
        const dir = path.join(root, org, user, upload)
        const info = await stat(dir).catch(() => null)
        if (info && now - info.mtimeMs > STALE_MS) await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}

function refuse(status: number, refusal: string, error: string) {
  return NextResponse.json({ error, refusal }, { status })
}

export const POST = withRlsAuth("tasks", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  // A 100 MB file is 13 parts and a folder may hold hundreds of small files.
  if (!checkRateLimit(`task-file-part:${auth.userId}`, { maxRequests: 600, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 })
  }

  const q = new URL(req.url).searchParams
  const upload = q.get("upload") ?? ""
  const index = Number(q.get("index"))
  const count = Number(q.get("count"))
  const size = Number(q.get("size"))
  const name = (q.get("name") ?? "").normalize("NFC").trim()

  if (!UPLOAD_ID.test(upload)) return refuse(400, "request", "upload must be 32 hex characters")
  if (!SAFE_SEGMENT.test(auth.orgId) || !SAFE_SEGMENT.test(auth.userId)) return refuse(400, "request", "Unexpected account id")
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/u.test(name)) return refuse(400, "request", "A file name is required")
  if (!Number.isSafeInteger(size) || size < 1) return refuse(400, "request", "File is empty")
  if (size > MAX_TASK_FILE_SIZE) return refuse(413, "too_big", "File too large (max 100MB)")
  const expectedCount = Math.ceil(size / TASK_FILE_PART_SIZE)
  if (!Number.isSafeInteger(count) || count !== expectedCount || count > MAX_TASK_FILE_PARTS) {
    return refuse(400, "request", `A file of ${size} bytes goes in ${expectedCount} parts`)
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) return refuse(400, "request", "Part index out of range")

  const mimeType = taskFileStoredType(name, q.get("type"))
  const ext = taskFileExtension(name)
  if (!mimeType || !ext || !TASK_FILE_EXTENSIONS.has(ext)) return refuse(415, "type", "File type not allowed")

  try {
    const task = await prisma.task.findFirst({ where: { id, organizationId: auth.orgId, deletedAt: null }, select: { id: true } })
    if (!task) return refuse(404, "notask", "Task not found")

    const expectedLength = index < count - 1 ? TASK_FILE_PART_SIZE : size - TASK_FILE_PART_SIZE * (count - 1)
    const body = Buffer.from(await req.arrayBuffer())
    if (body.length !== expectedLength) {
      return refuse(400, "request", `Part ${index} must be ${expectedLength} bytes, got ${body.length}`)
    }

    const store = async (bytes: Buffer) => {
      const stored = await storeTaskFile({ organizationId: auth.orgId, taskId: id, userId: auth.userId, name, mimeType, bytes })
      if (!stored.ok) return refuse(stored.refusal === "too_big" ? 413 : 400, stored.refusal, stored.message)
      return NextResponse.json({ success: true, data: { id: stored.id } }, { status: 201 })
    }
    if (count === 1) return await store(body)

    const dir = path.join(partsRoot(), auth.orgId, auth.userId, upload)
    if (index === 0) {
      // The head of the file says what it is: a «.mp4» that is not a video is
      // refused here, not after 100 MB have crossed the network.
      const contentError = validateUploadBytes(mimeType, body)
      if (contentError) return refuse(400, "content", contentError)
      await sweepStaleParts(Date.now())
      await rm(dir, { recursive: true, force: true })
    }
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${index}.part`), sealTenantFile(auth.orgId, body))
    if (index < count - 1) return NextResponse.json({ success: true, data: { received: index } }, { status: 202 })

    const pieces: Buffer[] = []
    for (let part = 0; part < count; part += 1) {
      const sealed = await readFile(path.join(dir, `${part}.part`)).catch(() => null)
      if (!sealed) {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
        return refuse(409, "incomplete", `Part ${part} never arrived; send the file again`)
      }
      pieces.push(await openTenantFileBytes(auth.orgId, sealed))
    }
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    const bytes = Buffer.concat(pieces)
    if (bytes.length !== size) return refuse(409, "incomplete", "The parts do not add up to the file; send it again")
    return await store(bytes)
  } catch (e) {
    console.error("[task-files parts POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
