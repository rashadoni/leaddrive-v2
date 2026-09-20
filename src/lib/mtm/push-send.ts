import { createSign } from "node:crypto"

/**
 * Sending a push to a field agent's phone.
 *
 * Firebase Cloud Messaging is the delivery service, not a place our data
 * lives: the payload says which phone to knock on and what one line to show;
 * everything the agent then reads comes from this server under their own
 * session. The notification therefore carries a title and a body and nothing
 * about the customer — it can appear on a locked screen in front of the
 * doctor the agent is visiting.
 *
 * Without a service account in the environment this module does nothing and
 * says so. A production that quietly tries to deliver into a service it
 * cannot authenticate with is worse than one that plainly has push switched
 * off: the first looks like a delivery problem for weeks.
 */

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
/** Google issues one-hour tokens; refresh a minute early to avoid a race. */
const ACCESS_TOKEN_TTL_MS = 59 * 60 * 1000

export interface PushServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

export interface PushMessage {
  token: string
  title: string
  body: string
  /** Small, non-personal routing hints the app reads when the push is tapped. */
  data?: Record<string, string>
}

export type PushDelivery =
  | { token: string; ok: true }
  | { token: string; ok: false; retire: boolean; error: string }

/**
 * Reads the service account from the environment. The key arrives as one JSON
 * blob so a deployment carries a single secret; `\n` inside the private key is
 * unescaped because most secret stores hand it back that way.
 */
export function pushServiceAccount(env: NodeJS.ProcessEnv = process.env): PushServiceAccount | null {
  const raw = env.MTM_PUSH_SERVICE_ACCOUNT?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string }
    const projectId = parsed.project_id?.trim()
    const clientEmail = parsed.client_email?.trim()
    const privateKey = parsed.private_key?.replace(/\\n/g, "\n").trim()
    if (!projectId || !clientEmail || !privateKey) return null
    return { projectId, clientEmail, privateKey }
  } catch {
    return null
  }
}

export function pushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return pushServiceAccount(env) !== null
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** A signed assertion Google exchanges for an access token. */
export function serviceAccountAssertion(account: PushServiceAccount, now: number = Date.now()): string {
  const issuedAt = Math.floor(now / 1000)
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = base64url(JSON.stringify({
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }))
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${claims}`)
  return `${header}.${claims}.${base64url(signer.sign(account.privateKey))}`
}

interface CachedToken {
  value: string
  expiresAt: number
}

let cachedAccessToken: CachedToken | null = null

/** Exported for tests: a cached token must not leak between them. */
export function resetPushAccessToken(): void {
  cachedAccessToken = null
}

export async function pushAccessToken(
  account: PushServiceAccount,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string | null> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > now) return cachedAccessToken.value
  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: serviceAccountAssertion(account, now),
      }).toString(),
    })
    if (!response.ok) return null
    const payload = await response.json() as { access_token?: string }
    if (!payload.access_token) return null
    cachedAccessToken = { value: payload.access_token, expiresAt: now + ACCESS_TOKEN_TTL_MS }
    return payload.access_token
  } catch {
    return null
  }
}

/**
 * FCM answers a dead address with UNREGISTERED or a malformed one with
 * INVALID_ARGUMENT. Those two mean "stop using this token"; everything else
 * (network, 5xx, quota) is this minute's problem, not the token's.
 */
export function shouldRetireToken(status: number, body: string): boolean {
  if (status === 404) return true
  if (status !== 400 && status !== 403) return false
  return /UNREGISTERED|INVALID_ARGUMENT|SENDER_ID_MISMATCH/.test(body)
}

export async function sendPushMessages(input: {
  messages: readonly PushMessage[]
  account?: PushServiceAccount | null
  fetchImpl?: typeof fetch
  now?: number
}): Promise<PushDelivery[]> {
  const account = input.account ?? pushServiceAccount()
  if (!account || input.messages.length === 0) return []
  const fetchImpl = input.fetchImpl ?? fetch
  const accessToken = await pushAccessToken(account, fetchImpl, input.now ?? Date.now())
  if (!accessToken) {
    return input.messages.map((message) => ({ token: message.token, ok: false, retire: false, error: "NO_ACCESS_TOKEN" }))
  }

  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`
  const deliveries: PushDelivery[] = []
  for (const message of input.messages) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: { priority: "HIGH" },
          },
        }),
      })
      if (response.ok) {
        deliveries.push({ token: message.token, ok: true })
        continue
      }
      const text = await response.text().catch(() => "")
      deliveries.push({
        token: message.token,
        ok: false,
        retire: shouldRetireToken(response.status, text),
        error: `HTTP_${response.status}`,
      })
    } catch {
      deliveries.push({ token: message.token, ok: false, retire: false, error: "NETWORK" })
    }
  }
  return deliveries
}
