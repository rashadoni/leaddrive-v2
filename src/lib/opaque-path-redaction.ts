/**
 * Takes somebody's link out of an address before the address is written to
 * a log.
 *
 * Several pages are opened by a secret in the path and by nothing else:
 * /share/location/<token>, /demo-access/<token>, /sign/<token>. Whoever reads
 * such an address in a log holds a working link. So every path segment that
 * is long and opaque — 32 or more URL-safe characters, which every token of
 * ours is — is replaced by `[redacted]`. Ordinary segments (words, record
 * ids of 25 characters, the hashed file names of a build) stay, so the line
 * still says which page it was about.
 *
 * By shape, not by a list of pages: the next page of this kind is covered
 * without anybody remembering this file.
 *
 * Only what follows the host is touched — a long host name is not a secret
 * and has to stay readable. A value that is not an address at all («eval»,
 * «inline») comes back as it was.
 */
const OPAQUE_SEGMENT = /\/[A-Za-z0-9._~%-]{32,}(?=[/?#]|$)/g
const SCHEME_AND_HOST = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i

export function redactOpaquePathSegments(address: string): string {
  const origin = SCHEME_AND_HOST.exec(address)?.[0] ?? ""
  return origin + address.slice(origin.length).replace(OPAQUE_SEGMENT, "/[redacted]")
}
