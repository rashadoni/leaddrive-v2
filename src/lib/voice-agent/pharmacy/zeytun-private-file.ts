import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"

/** Tiny operator grant/claim reads; the catalog is parsed once, with no 1C I/O. */
export async function readPrivate(path: string, limit = 8192): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error("invalid_private_path")
  const dir = await lstat(dirname(path))
  if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) || dir.uid !== process.getuid?.()) throw new Error("private_directory_required")
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.uid !== process.getuid?.() || stat.size > limit) throw new Error("private_file_required")
    const buffer = Buffer.alloc(limit + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > limit) throw new Error("private_file_too_large")
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))
  } finally { await handle.close() }
}
