import { redactOAuthProviderText } from "@/lib/oauth-redaction"

/**
 * Enumerate the Pages a token was actually granted, for the Facebook Login for Business flow.
 *
 * Why this exists. `GET /me/accounts` lists Pages the *user* administers, and it is the right call
 * for classic Facebook Login. Facebook Login for Business does not work that way: the person picks
 * assets — a business portfolio and specific Pages — in Meta's own selector, and the grant is
 * recorded against those assets rather than against the user's Page roles. A person who reaches a
 * Page only through a business portfolio therefore comes back from a successful, fully-consented
 * login with an EMPTY `/me/accounts`, which reads exactly like "this user administers nothing".
 *
 * Observed on 2026-09-20 with app 2414060595720618: Page "Lead Drive CRM" (373662722735767) and
 * business "Lead Drive" (1170592885027596) were both selected and confirmed by Meta, and the
 * callback still failed with `no_admined_pages`.
 *
 * The documented way to read what a token was granted is `GET /debug_token`, whose `granular_scopes`
 * array carries, per permission, the `target_ids` of every entity that granted it. That is the
 * authoritative list of Pages for this token, so we read it and fetch each Page's token by id.
 *
 * SECURITY: `debug_token` requires an app access token, which is `{app-id}|{app-secret}`. It is sent
 * as a query parameter because Graph requires it there, and it is never logged — every provider
 * response in this module goes through the OAuth redactor before it reaches a log line.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/reference/debug_token/
 *       https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
 */

export type GrantedPage = {
  id: string
  name: string
  access_token: string
  instagram_business_account?: { id: string; username?: string }
}

/**
 * Page-level permissions whose `target_ids` are Page IDs.
 *
 * Deliberately NOT including `business_management`: its target_ids are BUSINESS ids, and treating a
 * business id as a Page id would send us fetching an object that is not a Page and reporting a
 * confusing failure. Scopes are listed most-specific first only for readability; the result is a set.
 */
const PAGE_LEVEL_SCOPES = new Set([
  "pages_messaging",
  "pages_manage_metadata",
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
])

type DebugTokenResponse = {
  data?: {
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>
    scopes?: string[]
    is_valid?: boolean
  }
}

/**
 * The Page ids this user token was granted, read from `debug_token.granular_scopes`.
 *
 * Returns an empty array when the token carries no page-level grant — which is a real answer, not an
 * error: it means the person completed the dialog without selecting a Page.
 */
export async function grantedPageIds(
  graphBase: string,
  appId: string,
  appSecret: string,
  userAccessToken: string,
): Promise<{ pageIds: string[]; grantedScopes: string[]; error?: string }> {
  if (!appId || !appSecret || !userAccessToken) {
    return { pageIds: [], grantedScopes: [], error: "missing app credentials or token" }
  }
  const appAccessToken = `${appId}|${appSecret}`
  const url =
    `${graphBase}/debug_token` +
    `?input_token=${encodeURIComponent(userAccessToken)}` +
    `&access_token=${encodeURIComponent(appAccessToken)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const text = await res.text()
    if (!res.ok) {
      return { pageIds: [], grantedScopes: [], error: redactOAuthProviderText(text).slice(0, 300) }
    }
    const json = JSON.parse(text) as DebugTokenResponse
    const granular = json.data?.granular_scopes || []
    const ids = new Set<string>()
    for (const entry of granular) {
      if (!entry?.scope || !PAGE_LEVEL_SCOPES.has(entry.scope)) continue
      for (const id of entry.target_ids || []) {
        if (typeof id === "string" && id.trim()) ids.add(id.trim())
      }
    }
    // `scopes` is the flat permission list; returned so a caller can explain WHICH permission is
    // missing rather than only that the page list was empty.
    return { pageIds: [...ids], grantedScopes: json.data?.scopes || [] }
  } catch (e) {
    return {
      pageIds: [],
      grantedScopes: [],
      error: redactOAuthProviderText(e instanceof Error ? e.message : String(e)).slice(0, 300),
    }
  }
}

/**
 * Fetch one Page by id, with its Page access token and any linked Instagram business account —
 * the same shape `/me/accounts` returns, so callers can treat both paths identically.
 */
export async function fetchGrantedPage(
  graphBase: string,
  pageId: string,
  userAccessToken: string,
): Promise<GrantedPage | null> {
  try {
    const res = await fetch(
      `${graphBase}/${encodeURIComponent(pageId)}?fields=id,name,access_token,instagram_business_account{id,username}`,
      {
        headers: { Authorization: `Bearer ${userAccessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return null
    const page = (await res.json()) as Partial<GrantedPage>
    if (!page?.id || !page?.access_token) return null
    return {
      id: page.id,
      name: page.name || page.id,
      access_token: page.access_token,
      ...(page.instagram_business_account ? { instagram_business_account: page.instagram_business_account } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Full fallback: which Pages did this token actually get, when `/me/accounts` said none?
 *
 * Fail-soft by design — a Page that cannot be fetched is skipped rather than failing the whole
 * connect, so selecting three Pages and losing one still connects the other two.
 */
export async function enumerateGrantedPages(
  graphBase: string,
  appId: string,
  appSecret: string,
  userAccessToken: string,
): Promise<{ pages: GrantedPage[]; grantedScopes: string[]; error?: string }> {
  const { pageIds, grantedScopes, error } = await grantedPageIds(graphBase, appId, appSecret, userAccessToken)
  if (error) return { pages: [], grantedScopes, error }
  const pages: GrantedPage[] = []
  for (const id of pageIds) {
    const page = await fetchGrantedPage(graphBase, id, userAccessToken)
    if (page) pages.push(page)
  }
  return { pages, grantedScopes }
}
