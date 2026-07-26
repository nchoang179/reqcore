import { describe, it, expect } from 'vitest'
import { parsePublicApplication } from '../../server/utils/schemas/publicApplication'

const VALID = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  responses: [],
}

describe('parsePublicApplication — attribution', () => {
  it('clamps over-length UTM values instead of rejecting the application', () => {
    // Ad platforms routinely mint utm_content/utm_term strings longer than the
    // column budget. Losing the application over a tracking param is never right.
    const parsed = parsePublicApplication({
      ...VALID,
      utmContent: 'x'.repeat(500),
      utmTerm: 'y'.repeat(240),
      ref: 'r'.repeat(300),
    })

    expect(parsed.utmContent).toHaveLength(200)
    expect(parsed.utmTerm).toHaveLength(200)
    expect(parsed.ref).toHaveLength(100)
  })

  it('takes the first usable value when a param is repeated', () => {
    // `?ref=a&ref=b` — common when job boards re-append tracking params.
    const parsed = parsePublicApplication({ ...VALID, ref: ['abc', 'def'], utmSource: ['', 'linkedin'] })

    expect(parsed.ref).toBe('abc')
    expect(parsed.utmSource).toBe('linkedin')
  })

  it('drops unusable attribution values', () => {
    const parsed = parsePublicApplication({
      ...VALID,
      ref: '   ',
      utmSource: { nested: true },
      utmMedium: [],
    })

    expect(parsed.ref).toBeUndefined()
    expect(parsed.utmSource).toBeUndefined()
    expect(parsed.utmMedium).toBeUndefined()
  })
})

describe('parsePublicApplication — errors', () => {
  it('throws a 400 naming the offending field, not a 500', () => {
    // The multipart path used to call .parse() directly, so a ZodError escaped as
    // an unhandled error and the candidate saw "Internal Server Error".
    expect.assertions(4)
    try {
      parsePublicApplication({ ...VALID, phone: '+47 '.repeat(30) })
    } catch (err: any) {
      expect(err.statusCode).toBe(400)
      expect(err.statusMessage).toContain('Phone number')
      expect(err.statusMessage).toContain('50 characters')
      expect(err.data.field).toBe('phone')
    }
  })

  it('reports a missing required field with its label', () => {
    expect.assertions(2)
    try {
      parsePublicApplication({ ...VALID, firstName: '' })
    } catch (err: any) {
      expect(err.statusCode).toBe(400)
      expect(err.statusMessage).toBe('First name: First name is required')
    }
  })

  it('accepts a valid submission unchanged', () => {
    const parsed = parsePublicApplication({ ...VALID, phone: '+47 900 00 000' })

    expect(parsed.email).toBe('ada@example.com')
    expect(parsed.phone).toBe('+47 900 00 000')
    expect(parsed.responses).toEqual([])
  })
})
