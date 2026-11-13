// Loopback fence shared by personal DSH web plugins: RFC 5735 IPv4 127/8,
// ::1, IPv4-mapped ::ffff:127/8, localhost hostnames, plus browser same-origin
// markers. The socket address is authoritative; X-Forwarded-For is ignored.

/** IPv4 127/8 predicate (four decimal octets, first == 127). */
export function isIPv4Loopback(v4) {
  const parts = v4.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
export function isLoopbackAddress(address) {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice('::ffff:'.length))
  return isIPv4Loopback(normalized)
}

/** Whether a normalized URL hostname names the loopback authority. */
export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

/**
 * Request-level trust fence: loopback socket AND loopback Host header, plus
 * browser same-origin markers.
 * @param {import('node:http').IncomingMessage} request - the incoming request.
 * @returns {boolean} whether the request is a first-party loopback request.
 */
export function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
