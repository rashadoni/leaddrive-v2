#!/usr/bin/env node
// Owner-operated technical evidence. Never emits independent custody claims.
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync,
  statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const namespace = 'leaddrive-owner-backup-evidence'
const self = fileURLToPath(import.meta.url)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fields = ['FORMAT_VERSION', 'EVIDENCE_TYPE', 'STATUS', 'OPERATOR_MODEL',
  'INDEPENDENT_HUMAN_REVIEW', 'TWO_OFFLINE_MEDIA', 'KEY_READABILITY_STATUS',
  'RECIPIENT_SHA256', 'OWNER_KEY_VERIFIER_SHA256', 'REVIEWED_MAIN_SHA',
  'OWNER_OPERATOR', 'VERIFIED_AT_UTC']
const fixed = { FORMAT_VERSION: '1', EVIDENCE_TYPE: 'owner-key-readability',
  STATUS: 'verified', OPERATOR_MODEL: 'owner_operated',
  INDEPENDENT_HUMAN_REVIEW: 'not_performed', TWO_OFFLINE_MEDIA: 'not_met',
  KEY_READABILITY_STATUS: 'passed' }
const digestRE = /^[0-9a-f]{64}$/u
const mainRE = /^[0-9a-f]{40}$/u
const ownerRE = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/u
function requireValue(condition, message) { if (!condition) throw new Error(message) }
function publicFile(path, maximum = 16384) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const st = fstatSync(fd)
    requireValue(st.isFile() && st.size > 0 && st.size <= maximum, 'invalid bounded evidence file')
    const data = readFileSync(fd)
    requireValue(data.length === st.size && data.length <= maximum, 'evidence changed during read')
    return data
  } finally { closeSync(fd) }
}
function privateIdentity(path) {
  const st = lstatSync(path)
  requireValue(st.isFile() && st.uid === process.getuid()
    && [0o400, 0o600].includes(st.mode & 0o7777) && st.size > 0 && st.size <= 16384,
  'private file must be owned, regular, non-symlink and mode0400/0600')
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`
}
function run(command, args, input) {
  const result = spawnSync(command, args, { input, timeout: 15000, maxBuffer: 65536,
    env: { PATH: process.env.PATH || '/usr/bin:/bin', LC_ALL: 'C',
      HOME: process.env.HOME || '/nonexistent', SSH_AUTH_SOCK: '' } })
  requireValue(!result.error && result.status === 0 && !result.signal,
    'required cryptographic command failed; private diagnostics suppressed')
  return result.stdout
}
export function parseKeyEvidence(bytes, { recipientSha, mainSha, owner, verifierSha,
  now = Date.now() }) {
  requireValue(digestRE.test(recipientSha) && mainRE.test(mainSha)
    && ownerRE.test(owner) && digestRE.test(verifierSha), 'invalid expected evidence binding')
  requireValue(Buffer.byteLength(bytes) <= 4096, 'key evidence too large')
  const lines = bytes.toString().split('\n')
  requireValue(lines.pop() === '' && lines.length === fields.length, 'invalid key evidence schema')
  const data = {}
  lines.forEach((line, index) => {
    const key = fields[index]
    requireValue(line.startsWith(`${key}=`), 'invalid key evidence field order')
    const value = line.slice(key.length + 1)
    requireValue(/^[A-Za-z0-9_.:@-]+$/u.test(value), 'invalid key evidence value')
    data[key] = value
  })
  for (const [key, value] of Object.entries(fixed)) requireValue(data[key] === value, 'invalid owner evidence claim')
  requireValue(data.RECIPIENT_SHA256 === recipientSha
    && data.REVIEWED_MAIN_SHA === mainSha && data.OWNER_OPERATOR === owner
    && data.OWNER_KEY_VERIFIER_SHA256 === verifierSha, 'owner evidence binding mismatch')
  requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(data.VERIFIED_AT_UTC), 'invalid evidence timestamp')
  const timestamp = Date.parse(data.VERIFIED_AT_UTC)
  requireValue(Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().replace('.000Z', 'Z') === data.VERIFIED_AT_UTC
    && timestamp <= now + 300000 && timestamp >= now - 86400000,
  'key evidence must be fresh within24h and at most5min in future')
  return data
}
export function verifyKeyProof({ evidence, signature, signers, recipientSha, mainSha, owner }) {
  const bytes = publicFile(evidence, 4096)
  publicFile(signature, 8192)
  const allowed = publicFile(signers).toString().trim().split('\n')
  requireValue(allowed.length === 1 && new RegExp(`^${owner.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} ssh-ed25519 AAAA[A-Za-z0-9+/=]+$`, 'u').test(allowed[0]),
    'owner must have exactly one separately trusted Ed25519 signer')
  parseKeyEvidence(bytes, { recipientSha, mainSha, owner, verifierSha: sha(readFileSync(self)) })
  run('ssh-keygen', ['-Y', 'verify', '-f', signers, '-I', owner, '-n', namespace, '-s', signature], bytes)
  // Verify the exact immutable bytes read above, never source/eval evidence.
  return sha(bytes)
}
function createKeyProof([identity, signingKey, recipientSha, mainSha, owner, output]) {
  requireValue([identity, signingKey, recipientSha, mainSha, owner, output].every(Boolean)
    && digestRE.test(recipientSha) && mainRE.test(mainSha) && ownerRE.test(owner), 'invalid key-proof arguments')
  const identityBefore = privateIdentity(identity)
  const signingBefore = privateIdentity(signingKey)
  requireValue(resolve(identity) !== resolve(signingKey), 'identity cannot be the evidence signing key')
  const outputParent = statSync(resolve(output, '..'))
  requireValue(outputParent.isDirectory() && outputParent.uid === process.getuid()
    && (outputParent.mode & 0o022) === 0, 'unsafe output parent')
  for (const binary of ['age', 'age-keygen']) {
    requireValue(/^(?:age(?:-keygen)?\s+)?v?1\.3\.2$/u.test(run(binary, ['--version']).toString().trim()), 'exact age1.3.2 required')
  }
  const recipient = run('age-keygen', ['-y', identity]).toString().trim()
  requireValue(/^age1[0-9a-z]{58}$/u.test(recipient) && sha(recipient) === recipientSha, 'recipient mismatch')
  const challenge = randomBytes(64)
  const encrypted = run('age', ['-r', recipient], challenge)
  const decrypted = run('age', ['-d', '-i', identity], encrypted)
  requireValue(decrypted.equals(challenge), 'owner key did not decrypt fresh canary')
  requireValue(privateIdentity(identity) === identityBefore
    && privateIdentity(signingKey) === signingBefore, 'private file changed during verification')
  const data = { ...fixed, RECIPIENT_SHA256: recipientSha, OWNER_KEY_VERIFIER_SHA256: sha(readFileSync(self)),
    REVIEWED_MAIN_SHA: mainSha, OWNER_OPERATOR: owner,
    VERIFIED_AT_UTC: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z') }
  const bytes = fields.map((key) => `${key}=${data[key]}\n`).join('')
  // No-clobber publication: never overwrite another receipt or signature.
  requireValue(![output, `${output}.sig`].some((p) => { try { lstatSync(p); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }), 'evidence output already exists')
  let created = false
  let signatureCreated = false
  try {
    writeFileSync(output, bytes, { mode: 0o600, flag: 'wx' }); created = true
    // Sign via stdin, then atomically create the detached signature ourselves.
    const signature = run('ssh-keygen', ['-Y', 'sign', '-f', signingKey, '-n', namespace], bytes)
    requireValue(signature.toString().startsWith('-----BEGIN SSH SIGNATURE-----'), 'signature missing')
    writeFileSync(`${output}.sig`, signature, { mode: 0o600, flag: 'wx' }); signatureCreated = true
    console.log('Owner key-readability proof created; independent_review=not_performed two_offline_media=not_met')
  } catch (error) {
    if (signatureCreated) unlinkSync(`${output}.sig`)
    if (created) unlinkSync(output)
    throw error
  }
}
if (process.argv[1] && resolve(process.argv[1]) === self) {
  try {
    const [operation, ...args] = process.argv.slice(2)
    if (operation === 'create' && args.length === 6) createKeyProof(args)
    else if (operation === 'verify' && args.length === 6) {
      const [evidence, signature, signers, recipientSha, mainSha, owner] = args
      console.log(`owner_key_evidence_sha256=${verifyKeyProof({ evidence, signature, signers, recipientSha, mainSha, owner })}`)
    } else throw new Error('usage: owner-key-proof.mjs create IDENTITY SIGNING_KEY RECIPIENT_SHA MAIN_SHA OWNER OUTPUT | verify EVIDENCE SIGNATURE SIGNERS RECIPIENT_SHA MAIN_SHA OWNER')
  } catch (error) {
    // Never expose subprocess output, private file values or filesystem paths.
    console.error(`owner-key-proof: ${error.message && !error.code ? error.message : 'operation failed; private details suppressed'}`)
    process.exitCode = 1
  }
}
