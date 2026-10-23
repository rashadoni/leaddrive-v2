/** Read-only delivery of the owned fictional credential to one task key.
 * The private recipient key is never committed or sent to GitHub/production.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto'

export const TENANT = 'route-field-acceptance'
export const MARKER = 'route-field-native-acceptance:fictional:v1'
export const PUBLIC_RECIPIENT_PEM = "-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAi3CBn3SXvKzfa+hUoMRG\nzMffp1f1fnQPdt5vbJjw/rUsr3z11AwphB15gbGaHzi9V2X5l+VMoawzaHDuL5u3\nlMs8MFoWIIgBxC3GocRppZCtoL0XAmaUC7nPSSy46RdURaoxhnJ7avmyzZrXwB8O\nTItUpKyF9Ld1AOnwY0g/5sMJAhe+cquW10ER8Z4zZSjAbZXhNIhsl6tDm9gX0Br4\nAlFDg0FPqgJCUlh3BX+wUJt0QlQqK+Xne40vKGLsJ4TF9brLrNfTyJj7OWgpVn8+\nb8uBlmUYteXKh8zHDWZfTDS3t8A57RzpXn/Ln83B10vgu/U1VAmugqWUBLf4AQwE\ncGDIy7NG/ut5Ljj83VQXdvaU846fgjIyHh1LQoFrR7581ttrFiRvs7OsVcLuT5CG\nz5zrNJCKTNvh7cq+/jSOjjgkQaEFrBdMWrczkD3c4Tx+0drDfwshCcHGButyb4M7\n6FnvyEdjFK7jnKewa8grJoNfXcapIXG3fzWh3kVwD7Poyg7ZKAeMhPqxvmryWRwm\nx5G9chPPFvvvU4SeT3tV6OnYIh8iElf5JKApPbYU2JMzC6Dj8JozCCHLC32c7rCf\n5lB0ojMhpqPmQf3gsFJr1zUm7JUNzSmpVuCZJp5IlZnR9nHIvhs7CovFw254eCzG\naZH0w5M9htDo9MzkggcALT8CAwEAAQ==\n-----END PUBLIC KEY-----\n"
export const RECIPIENT_SHA256 = '0868f7cd28ea50a26b22e1cfcf2c60aaf883a6ff7e8b1c6e80032064fe372d4d'
const STATE = '/var/lib/leaddrive-route-field-acceptance'
const REVISION = '/opt/leaddrive-v2/.deploy-sha'
const PUBLIC_BUILD = 'https://app.leaddrivecrm.org/api/v1/public/build-info'
const CODES = new Set(['RF_ACCESS_FAILED', 'RF_ACCESS_REVISION_REFUSED', 'RF_ACCESS_FILE_UNSAFE',
  'RF_ACCESS_CREDENTIAL_REFUSED', 'RF_ACCESS_RECIPIENT_REFUSED', 'RF_ACCESS_ENVELOPE_REFUSED', 'RF_ACCESS_ROOT_REQUIRED'])
function requireThat(ok, code) { if (!ok) throw new Error(code) }

export function revision(value) {
  requireThat(typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/.test(value), 'RF_ACCESS_REVISION_REFUSED')
  return value
}
export function fingerprint(key) {
  return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex')
}
export function context(controllerSha, artifactSha, recipient = RECIPIENT_SHA256) {
  revision(controllerSha); revision(artifactSha)
  requireThat(typeof recipient === 'string' && recipient.length === 64 && /^[a-f0-9]{64}$/.test(recipient), 'RF_ACCESS_RECIPIENT_REFUSED')
  return { version: 1, tenant: TENANT, controllerSha, artifactSha, recipientSha256: recipient }
}
export function oaepLabel(value) { return Buffer.from(JSON.stringify(value), 'utf8') }
export function credential(value) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === 'marker,password' && value.marker === MARKER
    && typeof value.password === 'string' && value.password.length === 64 && /^[A-Za-z0-9_-]{64}$/.test(value.password), 'RF_ACCESS_CREDENTIAL_REFUSED')
  return value
}
export function seal(value, controllerSha, artifactSha, publicKey = PUBLIC_RECIPIENT_PEM) {
  credential(value)
  const recipient = fingerprint(publicKey)
  const bound = context(controllerSha, artifactSha, recipient)
  const key = createPublicKey(publicKey)
  requireThat(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength === 4096, 'RF_ACCESS_RECIPIENT_REFUSED')
  const ciphertext = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256', oaepLabel: oaepLabel(bound) }, Buffer.from(JSON.stringify(value))).toString('base64')
  return { ...bound, status: 'PASS', ciphertext }
}
export function safeFileMetadata(stat, limit, privateFile) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && stat.nlink === 1
    && Number.isSafeInteger(stat.size) && stat.size > 0 && stat.size <= limit
    && (privateFile ? (stat.mode & 0o777) === 0o600 : (stat.mode & 0o022) === 0)
}
function rootText(file, limit, privateFile = false) {
  const before = fs.lstatSync(file)
  requireThat(safeFileMetadata(before, limit, privateFile), 'RF_ACCESS_FILE_UNSAFE')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const opened = fs.fstatSync(fd)
    requireThat(safeFileMetadata(opened, limit, privateFile) && opened.ino === before.ino && opened.dev === before.dev,
      'RF_ACCESS_FILE_UNSAFE')
    const buffer = Buffer.alloc(limit + 1)
    const size = fs.readSync(fd, buffer, 0, buffer.length, 0)
    requireThat(size === opened.size && size <= limit, 'RF_ACCESS_FILE_UNSAFE')
    return buffer.subarray(0, size).toString('utf8')
  } finally { fs.closeSync(fd) }
}
async function deployed(artifactSha) {
  requireThat(rootText(REVISION, 128).trim() === artifactSha, 'RF_ACCESS_REVISION_REFUSED')
  const response = await fetch(PUBLIC_BUILD, { redirect: 'error', signal: AbortSignal.timeout(10000) })
  requireThat(response.ok && (await response.json()).artifactSha === artifactSha, 'RF_ACCESS_REVISION_REFUSED')
}
export async function readAndSeal(controllerSha, artifactSha) {
  revision(controllerSha); revision(artifactSha)
  requireThat(process.getuid?.() === 0, 'RF_ACCESS_ROOT_REQUIRED')
  requireThat(fingerprint(PUBLIC_RECIPIENT_PEM) === RECIPIENT_SHA256, 'RF_ACCESS_RECIPIENT_REFUSED')
  await deployed(artifactSha)
  const directory = fs.lstatSync(STATE)
  requireThat(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === 0
    && (directory.mode & 0o777) === 0o700, 'RF_ACCESS_FILE_UNSAFE')
  const result = seal(JSON.parse(rootText(STATE + '/credential.json', 1024, true)), controllerSha, artifactSha)
  await deployed(artifactSha)
  return result
}
export function failure(error) {
  return { version: 1, status: 'FAIL', code: CODES.has(error?.message) ? error.message : 'RF_ACCESS_FAILED' }
}
export function validateEnvelope(value, controllerSha, artifactSha) {
  revision(controllerSha); revision(artifactSha)
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'RF_ACCESS_ENVELOPE_REFUSED')
  if (value.status === 'FAIL') {
    requireThat(Object.keys(value).sort().join() === 'code,status,version' && value.version === 1 && CODES.has(value.code),
      'RF_ACCESS_ENVELOPE_REFUSED')
    return value
  }
  requireThat(Object.keys(value).sort().join() === 'artifactSha,ciphertext,controllerSha,recipientSha256,status,tenant,version'
    && value.version === 1 && value.status === 'PASS' && value.tenant === TENANT && value.controllerSha === controllerSha
    && value.artifactSha === artifactSha && value.recipientSha256 === RECIPIENT_SHA256
    && typeof value.ciphertext === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)
    && Buffer.from(value.ciphertext, 'base64').length === 512
    && Buffer.from(value.ciphertext, 'base64').toString('base64') === value.ciphertext, 'RF_ACCESS_ENVELOPE_REFUSED')
  return value
}
const cli = (process.argv[1] === '-' && import.meta.url.endsWith('/[eval1]'))
  || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (cli) {
  try {
    requireThat(process.argv.length === 5, 'RF_ACCESS_REVISION_REFUSED')
    const [, , mode, controllerSha, artifactSha] = process.argv
    let value
    if (mode === '--seal-fixture-access') value = await readAndSeal(controllerSha, artifactSha)
    else if (mode === '--validate-envelope') value = validateEnvelope(JSON.parse(fs.readFileSync(0, 'utf8')), controllerSha, artifactSha)
    else throw new Error('RF_ACCESS_FAILED')
    process.stdout.write(JSON.stringify(value) + '\n')
    if (value.status !== 'PASS') process.exitCode = 1
  } catch (error) {
    process.stdout.write(JSON.stringify(failure(error)) + '\n')
    process.exitCode = 1
  }
}
