/** Runner-only TCP adapter; never a host-published Docker port or DB fallback. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { assertFullCdcEnvironment, assertPrivatePostgresTarget } from './cdc-fund-contract.mjs'

assertFullCdcEnvironment(process.env)
assert.deepEqual(process.argv.slice(2), ['--disposable-loopback-proxy'])
const project = process.env.LD_EVENT_STACK_PROJECT
const compose = ['compose', '-p', project, '-f', 'ops/event-platform/test/compose.yml',
  '-f', 'ops/event-platform/test/cdc.compose.yml']
function docker(args, json = true) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 })
  assert.equal(result.status, 0, 'exact disposable Compose PostgreSQL inspection required')
  return json ? JSON.parse(result.stdout) : result.stdout.trim()
}
const config = docker([...compose, 'config', '--format', 'json'])
const id = docker([...compose, 'ps', '-q', 'postgres'], false)
assert.match(id, /^[0-9a-f]{64}$/)
const [container] = docker(['inspect', id])
const [network] = docker(['network', 'inspect', `${project}_default`])
const target = assertPrivatePostgresTarget({ project, config, container, network })
// The caller cannot inject a host, port, DB URL, bind address or shared target.
// A separate tiny process is necessary: Prisma's fixture migration CLI blocks
// its parent's event loop, so an in-process proxy would deadlock setup.
const sockets = new Set()
const server = createServer(inbound => {
  if (sockets.size >= 24) { inbound.destroy(); return }
  const outbound = createConnection({ host: target, port: 5432, timeout: 5_000 })
  for (const socket of [inbound, outbound]) {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => { inbound.destroy(); outbound.destroy() })
    socket.on('timeout', () => { inbound.destroy(); outbound.destroy() })
  }
  outbound.once('connect', () => { outbound.setTimeout(60_000); inbound.pipe(outbound); outbound.pipe(inbound) })
})
let closing = false
function close() {
  if (closing) return
  closing = true
  for (const socket of sockets) socket.destroy()
  server.close()
}
server.on('error', () => { process.exitCode = 1; close() })
process.stdin.resume()
process.stdin.on('end', close)
process.stdin.on('error', close)
process.on('SIGTERM', close)
const deadline = setTimeout(() => { process.exitCode = 1; close() }, 15 * 60_000)
deadline.unref()
server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
  const address = server.address()
  assert.ok(address && typeof address === 'object' && address.address === '127.0.0.1')
  process.stdout.write(`${address.port}\n`)
})
