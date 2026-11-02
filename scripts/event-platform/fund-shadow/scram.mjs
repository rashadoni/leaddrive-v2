// SCRAM-SHA-256 verifier of a password (RFC 7677, the format PostgreSQL stores
// in pg_authid). provision-role.sql receives this instead of the password, so
// the plaintext never travels to or is logged by the database server.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'

export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  // SASLprep is the identity for the printable ASCII passwords generated here.
  if (!/^[\x21-\x7e]{24,}$/.test(password)) throw new Error('scramVerifier: printable ASCII password of 24+ characters only')
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const hmac = (key, text) => createHmac('sha256', key).update(text).digest()
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest()
  const serverKey = hmac(salted, 'Server Key')
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // scram.mjs < password-file  ->  verifier on stdout
  let input = ''
  process.stdin.on('data', (d) => { input += d }).on('end', () => process.stdout.write(`${scramVerifier(input.trim())}\n`))
}
