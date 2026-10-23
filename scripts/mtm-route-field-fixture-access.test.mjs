import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { MARKER, RECIPIENT_SHA256, PUBLIC_RECIPIENT_PEM, context, oaepLabel,
  credential, fingerprint, seal, revision, safeFileMetadata, validateEnvelope, failure } from './mtm-route-field-fixture-access.mjs'

const pair = generateKeyPairSync('rsa', { modulusLength: 4096 })
const pub = pair.publicKey.export({ format: 'pem', type: 'spki' })
const input = { marker: MARKER, password: 'fixture-not-a-production-secret-'.padEnd(64, 'x') }
const main = 'a'.repeat(40), artifact = 'b'.repeat(40)
const decrypt = (envelope, bound = context(main, artifact, fingerprint(pub))) => privateDecrypt({ key: pair.privateKey,
  padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: oaepLabel(bound) }, Buffer.from(envelope.ciphertext, 'base64'))

test('only the recipient decrypts the credential and the public envelope contains no plaintext fields', () => {
  const envelope = seal(input, main, artifact, pub)
  assert.deepEqual(JSON.parse(decrypt(envelope)), input)
  assert.equal(JSON.stringify(envelope).includes(input.password), false)
  assert.equal(Object.hasOwn(envelope, 'password'), false)
  assert.equal(Object.hasOwn(envelope, 'marker'), false)
  assert.equal(Buffer.from(envelope.ciphertext, 'base64').length, 512)
  assert.notEqual(seal(input, main, artifact, pub).ciphertext, envelope.ciphertext)
  const wrong = generateKeyPairSync('rsa', { modulusLength: 4096 })
  assert.throws(() => privateDecrypt({ key: wrong.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256', oaepLabel: oaepLabel(context(main, artifact, fingerprint(pub))) }, Buffer.from(envelope.ciphertext, 'base64')))
})
test('the OAEP context binds controller, deployed artifact, tenant and recipient', () => {
  const envelope = seal(input, main, artifact, pub)
  for (const patch of [{ controllerSha: 'c'.repeat(40) }, { artifactSha: 'd'.repeat(40) },
    { tenant: 'another-company' }, { recipientSha256: 'e'.repeat(64) }]) {
    assert.throws(() => decrypt(envelope, { ...context(main, artifact, fingerprint(pub)), ...patch }))
  }
  const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[0] ^= 1
  assert.throws(() => decrypt({ ...envelope, ciphertext: bytes.toString('base64') }))
})
test('only the fixed fictional marker and generated credential shape can be sealed', () => {
  for (const value of [null, { ...input, marker: 'real-company' }, { ...input, password: 'short' },
    { ...input, password: 'x'.repeat(63) + '\n' }, { ...input, password: 'x'.repeat(64) + '\n' },
    { ...input, token: 'extra-private-data' }]) {
    assert.throws(() => credential(value), /RF_ACCESS_CREDENTIAL_REFUSED/)
  }
})
test('revision inputs cannot inject a shell argument or accept a shortened/stale label', () => {
  assert.equal(revision(main), main)
  for (const value of ['', 'main', 'a'.repeat(39), main + '\n', main.toUpperCase(), "'; echo secret"]) {
    assert.throws(() => revision(value), /RF_ACCESS_REVISION_REFUSED/)
  }
})
test('unsafe ownership, permissions, links, file sizes and file types are refused', () => {
  const stat = { uid: 0, mode: 0o100600, nlink: 1, size: 200, isFile: () => true, isSymbolicLink: () => false }
  assert.equal(safeFileMetadata(stat, 1024, true), true)
  for (const patch of [{ uid: 1000 }, { mode: 0o100644 }, { nlink: 2 }, { size: 1025 }, { size: -1 },
    { isFile: () => false }, { isSymbolicLink: () => true }]) assert.equal(safeFileMetadata({ ...stat, ...patch }, 1024, true), false)
})
test('the production recipient is pinned and envelope validation rejects extra/plaintext or mismatched data', () => {
  assert.equal(fingerprint(PUBLIC_RECIPIENT_PEM), RECIPIENT_SHA256)
  const valid = seal(input, main, artifact)
  assert.deepEqual(validateEnvelope(valid, main, artifact), valid)
  for (const patch of [{ password: input.password }, { tenant: 'real-company' }, { artifactSha: 'c'.repeat(40) },
    { controllerSha: 'd'.repeat(40) }, { recipientSha256: 'e'.repeat(64) }, { ciphertext: 'plain' }]) {
    assert.throws(() => validateEnvelope({ ...valid, ...patch }, main, artifact), /RF_ACCESS_ENVELOPE_REFUSED/)
  }
  assert.deepEqual(validateEnvelope(failure(new Error('secret payload')), main, artifact), { version: 1, status: 'FAIL', code: 'RF_ACCESS_FAILED' })
})
test('importing from a stdin driver has no CLI side effects or production access', () => {
  const url = new URL('./mtm-route-field-fixture-access.mjs', import.meta.url).href
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: 'await import(' + JSON.stringify(url) + '); console.log("import-ok")', encoding: 'utf8', timeout: 5000,
  })
  assert.equal(run.status, 0)
  assert.equal(run.stdout.trim(), 'import-ok')
})
test('the remote stdin CLI rejects malformed revisions before any private file or network read', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-', '--seal-fixture-access', main, 'bad'], {
    input: 'import ioGuard from "node:fs"; ioGuard.lstatSync = () => { throw new Error("UNEXPECTED_FILE_READ") };'
      + 'globalThis.fetch = () => { throw new Error("UNEXPECTED_NETWORK_READ") };\n'
      + readFileSync(new URL('./mtm-route-field-fixture-access.mjs', import.meta.url), 'utf8'), encoding: 'utf8', timeout: 5000,
  })
  assert.equal(run.status, 1)
  assert.deepEqual(JSON.parse(run.stdout), { version: 1, status: 'FAIL', code: 'RF_ACCESS_REVISION_REFUSED' })
})
test('the remote stdin protocol accepts its two revision arguments but refuses a non-root reader before I/O', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-', '--seal-fixture-access', main, artifact], {
    input: 'process.getuid = () => 1001; import ioGuard from "node:fs";'
      + 'ioGuard.lstatSync = () => { throw new Error("UNEXPECTED_FILE_READ") };'
      + 'globalThis.fetch = () => { throw new Error("UNEXPECTED_NETWORK_READ") };\n'
      + readFileSync(new URL('./mtm-route-field-fixture-access.mjs', import.meta.url), 'utf8'), encoding: 'utf8', timeout: 5000,
  })
  assert.equal(run.status, 1)
  assert.deepEqual(JSON.parse(run.stdout), { version: 1, status: 'FAIL', code: 'RF_ACCESS_ROOT_REQUIRED' })
})
test('the complete root stdin protocol reads the deployed standalone marker and emits only ciphertext', () => {
  // Model the actual standalone artifact layout rather than accepting any
  // revision pathname requested by the controller. No real root files are read.
  const prelude = `
import mockIo from 'node:fs';
import protocolAssert from 'node:assert/strict';
process.getuid = () => 0;
const mockFiles = new Map([
  ['/opt/leaddrive-v2/.next/standalone/.deploy-sha', { data: ${JSON.stringify(artifact + '\n')}, mode: 0o100644, ino: 1 }],
  ['/var/lib/leaddrive-route-field-acceptance/credential.json', { data: ${JSON.stringify(JSON.stringify(input))}, mode: 0o100600, ino: 2 }],
]);
const metadata = file => ({ uid: 0, nlink: 1, dev: 1, ino: file.ino, mode: file.mode,
  size: Buffer.byteLength(file.data), isFile: () => true, isSymbolicLink: () => false });
const descriptors = new Map(); let nextDescriptor = 20; let revisionReads = 0; let publicChecks = 0;
mockIo.lstatSync = pathname => {
  if (pathname === '/var/lib/leaddrive-route-field-acceptance') return { uid: 0, mode: 0o40700,
    isDirectory: () => true, isSymbolicLink: () => false };
  protocolAssert.ok(mockFiles.has(pathname), 'controller attempted an unregistered root path');
  return metadata(mockFiles.get(pathname));
};
mockIo.openSync = pathname => { const fd = ++nextDescriptor; descriptors.set(fd, mockFiles.get(pathname)); return fd };
mockIo.fstatSync = fd => metadata(descriptors.get(fd));
mockIo.readSync = (fd, buffer) => { const file = descriptors.get(fd); const data = Buffer.from(file.data);
  if (file.ino === 1) revisionReads++; data.copy(buffer); return data.length };
mockIo.closeSync = fd => descriptors.delete(fd);
globalThis.fetch = async (url, options) => {
  protocolAssert.equal(url, 'https://app.leaddrivecrm.org/api/v1/public/build-info');
  protocolAssert.equal(options.redirect, 'error'); publicChecks++;
  return { ok: true, json: async () => ({ artifactSha: ${JSON.stringify(artifact)} }) };
};
`;
  const source = readFileSync(new URL('./mtm-route-field-fixture-access.mjs', import.meta.url), 'utf8')
  const run = spawnSync(process.execPath, ['--input-type=module', '-', '--seal-fixture-access', main, artifact], {
    input: prelude + source + '\nprotocolAssert.equal(revisionReads, 2); protocolAssert.equal(publicChecks, 2); protocolAssert.equal(descriptors.size, 0);',
    encoding: 'utf8', timeout: 5000,
  })
  assert.equal(run.status, 0, run.stderr)
  const envelope = validateEnvelope(JSON.parse(run.stdout), main, artifact)
  assert.equal(envelope.status, 'PASS')
  assert.equal(run.stdout.includes(input.password), false)
})
test('the public validator CLI never echoes a plaintext credential supplied as raw output', () => {
  const run = spawnSync(process.execPath, [new URL('./mtm-route-field-fixture-access.mjs', import.meta.url).pathname,
    '--validate-envelope', main, artifact], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 })
  assert.equal(run.status, 1)
  assert.equal(run.stdout.includes(input.password), false)
  assert.deepEqual(JSON.parse(run.stdout), { version: 1, status: 'FAIL', code: 'RF_ACCESS_ENVELOPE_REFUSED' })
})
