export async function readJsonSafely<T = unknown>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (!contentType.includes("json")) return null

  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}
