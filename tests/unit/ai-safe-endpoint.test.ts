import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isPrivateOrReservedIp,
  parseSafeAiBaseUrl,
  safeAiEndpointFetch,
} from '../../server/utils/ai/safeEndpoint'

afterEach(() => vi.unstubAllGlobals())

describe('custom AI endpoint SSRF controls', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ])('classifies %s as non-public', (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public address %s', (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(false)
  })

  it('requires HTTPS and disallows URL credentials', () => {
    expect(() => parseSafeAiBaseUrl('http://api.example.com/v1')).toThrow(/HTTPS/)
    expect(() => parseSafeAiBaseUrl('https://user:pass@api.example.com/v1')).toThrow(/credentials/)
  })

  it('disables redirects on outbound requests', async () => {
    const outbound = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://127.0.0.1/internal' },
    }))
    vi.stubGlobal('fetch', outbound)

    await expect(safeAiEndpointFetch('https://8.8.8.8/v1/chat/completions'))
      .rejects.toThrow(/redirects are disabled/i)
    expect(outbound).toHaveBeenCalledWith(
      'https://8.8.8.8/v1/chat/completions',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })
})
