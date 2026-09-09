const COMPUTE_URL = process.env.COMPUTE_SERVICE_URL || "http://localhost:8000"
const MAX_RETRIES = 3

export async function callCompute<T>(path: string, body: unknown): Promise<T> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(`${COMPUTE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText)
      }
      return res.json() as Promise<T>
    } catch (e) {
      if (i === MAX_RETRIES - 1) throw e
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw new Error("Compute service unreachable")
}
