import { makeScriptPrisma } from './_rls.mjs'
import crypto from 'crypto'

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const nextAuthSecret = requireEnv('NEXTAUTH_SECRET')
const facebookAppId = requireEnv('FACEBOOK_APP_ID')
const facebookAppSecret = requireEnv('FACEBOOK_APP_SECRET')

const prisma = await makeScriptPrisma()

function deriveKey(purpose) {
  const base = crypto.createHash('sha256').update(nextAuthSecret).digest()
  return crypto.createHmac('sha256', base).update(Buffer.from(`leaddrive:${purpose}`, 'utf8')).digest().slice(0, 32)
}
function base64urlDecode(s) {
  const pad = s.length % 4
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad ? 4 - pad : 0), 'base64')
}
function decryptToken(stored, purpose) {
  if (!stored.startsWith('v1:')) return stored
  const raw = base64urlDecode(stored.slice(3))
  const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(purpose), raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8')
}

const acc = await prisma.socialAccount.findFirst({ where: { platform: 'facebook', displayName: 'Nokaut.az' } })
if (!acc?.accessToken || !acc.handle) throw new Error('Facebook account or encrypted access token not found')
const token = decryptToken(acc.accessToken, `oauth:facebook:${acc.handle}`)

// What type of token is this?
const debugUrl = new URL('https://graph.facebook.com/v21.0/debug_token')
debugUrl.searchParams.set('input_token', token)
debugUrl.searchParams.set('access_token', `${facebookAppId}|${facebookAppSecret}`)
const debugRes = await fetch(debugUrl)
const debugJson = await debugRes.json()
const debugData = debugJson?.data ?? {}
console.log('Debug:', JSON.stringify({
  appId: debugData.app_id,
  application: debugData.application,
  dataAccessExpiresAt: debugData.data_access_expires_at,
  expiresAt: debugData.expires_at,
  isValid: debugData.is_valid,
  scopes: debugData.scopes,
  type: debugData.type,
  userId: debugData.user_id,
}, null, 2))

// /me — should return page identity if it's a page token
const meUrl = new URL('https://graph.facebook.com/v21.0/me')
meUrl.searchParams.set('access_token', token)
const meRes = await fetch(meUrl)
const meJson = await meRes.json()
console.log('\n/me:', JSON.stringify({ id: meJson?.id, name: meJson?.name }, null, 2))

await prisma.$disconnect()
