import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.google.internal.',
])

function parseIpv4(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) return null
  const octets = address.split('.').map(Number)
  return octets.length === 4 ? octets as [number, number, number, number] : null
}

/**
 * Only globally routable unicast addresses may back a custom AI endpoint.
 * This intentionally denies documentation, benchmarking, carrier-grade NAT,
 * multicast, and reserved ranges in addition to the usual RFC1918 ranges.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4) {
    const [a, b, c] = v4
    return a === 0
      || a === 10
      || (a === 100 && b >= 64 && b <= 127)
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 0 && c === 2)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224
  }

  if (isIP(address) !== 6) return true

  const value = ipv6ToBigInt(address)
  if (value === null) return true
  const inCidr = (prefix: bigint, bits: number) => {
    const shift = BigInt(128 - bits)
    return (value >> shift) === (prefix >> shift)
  }

  return value === BigInt(0) // unspecified
    || value === BigInt(1) // loopback
    || inCidr(ipv6ToBigInt('::ffff:0:0')!, 96) // IPv4-mapped (avoid bypasses)
    || inCidr(ipv6ToBigInt('64:ff9b::')!, 96) // NAT64
    || inCidr(ipv6ToBigInt('64:ff9b:1::')!, 48)
    || inCidr(ipv6ToBigInt('100::')!, 64) // discard-only
    || inCidr(ipv6ToBigInt('2001::')!, 32) // Teredo
    || inCidr(ipv6ToBigInt('2001:2::')!, 48) // benchmarking
    || inCidr(ipv6ToBigInt('2001:10::')!, 28) // ORCHID
    || inCidr(ipv6ToBigInt('2001:db8::')!, 32) // documentation
    || inCidr(ipv6ToBigInt('2002::')!, 16) // 6to4 can tunnel to private IPv4
    || inCidr(ipv6ToBigInt('fc00::')!, 7) // unique-local
    || inCidr(ipv6ToBigInt('fe80::')!, 10) // link-local
    || inCidr(ipv6ToBigInt('fec0::')!, 10) // deprecated site-local
    || inCidr(ipv6ToBigInt('ff00::')!, 8) // multicast
}

function ipv6ToBigInt(input: string): bigint | null {
  const address = input.toLowerCase().split('%')[0]!
  const halves = address.split('::')
  if (halves.length > 2) return null

  const expand = (part: string): string[] => {
    if (!part) return []
    const pieces = part.split(':')
    const last = pieces.at(-1)
    if (last && isIP(last) === 4) {
      const octets = parseIpv4(last)!
      pieces.splice(
        pieces.length - 1,
        1,
        ((octets[0]! << 8) | octets[1]!).toString(16),
        ((octets[2]! << 8) | octets[3]!).toString(16),
      )
    }
    return pieces
  }

  const left = expand(halves[0] ?? '')
  const right = expand(halves[1] ?? '')
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0
  if (omitted < 0 || (halves.length === 1 && left.length !== 8)) return null
  const groups = [...left, ...Array.from({ length: omitted }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null

  return groups.reduce((value, group) => (value << BigInt(16)) | BigInt(`0x${group}`), BigInt(0))
}

export function parseSafeAiBaseUrl(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:') throw new Error('Custom AI endpoints must use HTTPS.')
  if (url.username || url.password) throw new Error('Custom AI endpoint URLs must not contain credentials.')
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) throw new Error('Custom AI endpoint is not allowed.')
  if (isIP(hostname) && isPrivateOrReservedIp(hostname)) {
    throw new Error('Custom AI endpoint must use a public IP address.')
  }
  return url
}

export async function assertSafeAiEndpoint(value: string): Promise<void> {
  const url = parseSafeAiBaseUrl(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) return

  let addresses: Array<{ address: string, family: number }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  }
  catch {
    throw new Error('Custom AI endpoint hostname could not be resolved.')
  }
  if (addresses.length === 0 || addresses.some(result => isPrivateOrReservedIp(result.address))) {
    throw new Error('Custom AI endpoint must resolve only to public IP addresses.')
  }
}

/** Revalidates DNS for every request and never follows redirects. */
export const safeAiEndpointFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' || input instanceof URL ? new URL(input) : new URL(input.url)
  await assertSafeAiEndpoint(url.toString())
  const response = await fetch(input, { ...init, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    response.body?.cancel().catch(() => {})
    throw new Error('Custom AI endpoint redirects are disabled.')
  }
  return response
}
