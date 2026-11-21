import { prisma } from "@/lib/prisma"
import { decryptToken, encryptToken } from "@/lib/secure-token"
import { isSocialProviderTimeoutError, withSocialProviderTimeout } from "@/lib/social/provider-request-timeout"

const TIKTOK_BUSINESS_BASE = "https://business-api.tiktok.com/open_api/v1.3"

/**
 * One access token for the organisation's TikTok Accounts API grant, refreshed when it has expired.
 *
 * Shared on purpose. The comments collector and the messaging-readiness screen both need the same
 * token, and a second copy of this would mean two places that rotate the stored refresh token —
 * the one thing here that is destructive to get wrong: a refresh response rotates the refresh token,
 * so a copy that forgets to persist it silently ends the grant a day later.
 */
export async function businessAccessToken(
  account: { id: string; accessToken: string | null; tokenExpiresAt?: Date | null } | null,
  parentSignal?: AbortSignal,
): Promise<{
  token: string | null
  error: string | null
}> {
  const env = process.env.TIKTOK_BUSINESS_ACCESS_TOKEN?.trim()
  if (env) return { token: env, error: null }
  if (!account?.accessToken) return { token: null, error: null }
  let access = ""
  let refresh = ""
  try { [access, refresh] = decryptToken(account.accessToken, "oauth:tiktok-business").split("::") } catch { return { token: null, error: null } }
  const expired = account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000
  if (!expired) return { token: access || null, error: null }
  const clientId = process.env.TIKTOK_BUSINESS_CLIENT_ID?.trim()
  const clientSecret = process.env.TIKTOK_BUSINESS_CLIENT_SECRET?.trim()
  if (!refresh || !clientId || !clientSecret) return { token: null, error: null }
  let refreshed: {
    response: Response
    payload: {
      code?: number
      data?: { access_token?: string; refresh_token?: string; expires_in?: number }
    } | null
  }
  try {
    refreshed = await withSocialProviderTimeout("tiktok_business_token_refresh", async (signal) => {
      const response = await fetch(`${TIKTOK_BUSINESS_BASE}/tt_user/oauth2/refresh_token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refresh }),
        signal,
      })
      const body = await response.text()
      let payload: {
        code?: number
        data?: { access_token?: string; refresh_token?: string; expires_in?: number }
      } | null = null
      try { payload = JSON.parse(body) as typeof payload } catch { /* handled below */ }
      return { response, payload }
    }, { signal: parentSignal })
  } catch (error) {
    return {
      token: null,
      error: isSocialProviderTimeoutError(error)
        ? "tiktok_business_token_refresh_timeout"
        : "tiktok_business_token_refresh_network",
    }
  }
  const { response, payload } = refreshed
  if (!response.ok || payload?.code !== 0 || !payload.data?.access_token) return { token: null, error: null }
  const nextRefresh = payload.data.refresh_token || refresh
  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptToken(`${payload.data.access_token}::${nextRefresh}`, "oauth:tiktok-business"),
      tokenExpiresAt: payload.data.expires_in ? new Date(Date.now() + payload.data.expires_in * 1000) : null,
    },
  })
  return { token: payload.data.access_token, error: null }
}
