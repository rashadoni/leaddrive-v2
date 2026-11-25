import path from "path"
import { unlink } from "fs/promises"
import type { Prisma } from "@prisma/client"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"

/**
 * Remove files of a task: the rows, the bytes on disk (a file already missing
 * there is not an error), and a «removed» line in the task's history — which is
 * also what lets a message say «Fayl silinib» about a file it named.
 * Used by the card's «Fayllar» and by a message removed with its files.
 */
export async function removeTaskFiles(
  db: Pick<Prisma.TransactionClient, "taskAttachment" | "taskActivity">,
  args: { organizationId: string; taskId: string; userId: string | null; files: readonly { id: string; fileName: string; originalName: string }[] },
): Promise<number> {
  const { organizationId, taskId, userId, files } = args
  if (files.length === 0) return 0
  await db.taskAttachment.deleteMany({ where: { id: { in: files.map((file) => file.id) }, taskId, organizationId } })
  for (const file of files) {
    // The stored name is ours (32 hex + a whitelisted extension), never a path.
    if (/^[0-9a-f]{32}\.[a-z0-9]{1,5}$/u.test(file.fileName)) {
      await unlink(path.join(runtimePublicUploadDirectory("tasks"), file.fileName)).catch(() => {})
    }
  }
  await db.taskActivity.createMany({
    data: files.map((file) => ({ organizationId, taskId, userId, action: "file_removed", oldValue: file.originalName })),
  }).catch(() => {})
  return files.length
}
