export const INBOX_FOLDER_NAME_MAX_LENGTH = 60

const UNSAFE_FOLDER_NAME_CHARS = /[<>{}\u0000-\u001f\u007f]/

export function normalizeInboxFolderName(value: unknown): string | null {
  if (typeof value !== "string") return null

  const name = value.trim()
  if (!name || name.length > INBOX_FOLDER_NAME_MAX_LENGTH) return null
  if (UNSAFE_FOLDER_NAME_CHARS.test(name)) return null

  return name
}
