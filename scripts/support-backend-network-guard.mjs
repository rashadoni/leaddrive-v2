// Transport guard only. No application route, auth, Prisma or response interception.
// Loaded into the hosted Next process before its imports; never into production.
import net from "node:net"
import { syncBuiltinESMExports } from "node:module"
import dns from "node:dns"
import dgram from "node:dgram"
import { appendFileSync } from "node:fs"
const allowed = new Set(["127.0.0.1", "::1", "localhost"])
function deny() {
  appendFileSync(process.env.SUPPORT_BACKEND_NETWORK_LOG, "OUTBOUND_BLOCKED\n")
  throw new Error("SUPPORT_BACKEND_OUTBOUND_BLOCKED")
}
const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  let first = args[0]
  if (Array.isArray(first)) first = first[0] // Node's normalized connect arguments.
  if (first && typeof first === "object" && first.path) return originalConnect.apply(this, args)
  if (typeof first === "string" && !/^\d+$/.test(first)) return originalConnect.apply(this, args) // local IPC only
  const host = first && typeof first === "object" ? first.host : (typeof args[1] === "string" ? args[1] : undefined)
  if (host !== undefined && !allowed.has(host)) deny()
  return originalConnect.apply(this, args)
}
const originalLookup = dns.lookup
dns.lookup = function (hostname, ...args) {
  if (!allowed.has(hostname)) deny()
  return originalLookup.call(this, hostname, ...args)
}
const originalPromiseLookup = dns.promises.lookup
dns.promises.lookup = async function (hostname, ...args) {
  if (!allowed.has(hostname)) deny()
  return originalPromiseLookup.call(this, hostname, ...args)
}
// c-ares DNS resolution bypasses net.Socket and the public dgram API.
// No fixture requires DNS records or reverse lookups; deny every such entry.
const resolutionMethods = ["lookupService", "reverse", "resolve", "resolveAny", "resolve4", "resolve6", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "resolveTlsa"]
for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const method of resolutionMethods) if (typeof target[method] === "function") target[method] = deny
}
dgram.createSocket = deny
syncBuiltinESMExports()
