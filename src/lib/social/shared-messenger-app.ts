/** Approved shared Messenger app. Legacy monitoring keeps its own FACEBOOK_* credentials. */
export function getSharedMessengerApp() {
  const appId = process.env.FACEBOOK_MESSENGER_APP_ID?.trim() || ""
  const appSecret = process.env.FACEBOOK_MESSENGER_APP_SECRET || ""
  const loginConfigId = process.env.FACEBOOK_MESSENGER_LOGIN_CONFIG_ID?.trim() || ""
  const verifyToken = process.env.FACEBOOK_MESSENGER_VERIFY_TOKEN || ""
  if (!appId && !appSecret && !loginConfigId && !verifyToken) return null
  return { appId, appSecret, loginConfigId, verifyToken, ready: Boolean(appId && appSecret && loginConfigId && verifyToken) }
}

export const SHARED_MESSENGER_WEBHOOK_PATH = "/api/v1/webhooks/facebook?provider=messenger"
