import { describe, expect, it } from 'vitest'
import {
  MAX_EXTRACTION_CHARS,
  normalizeCvExtraction,
  truncateForExtraction,
} from '../../server/utils/ai/cvExtraction'

describe('normalizeCvExtraction', () => {
  it('trims values the model returns with surrounding whitespace', () => {
    expect(normalizeCvExtraction({
      firstName: '  Abdelrahman ',
      lastName: 'Said\n',
      email: ' a.said@example.com ',
      phone: '+20 10 4044 4569 ',
    })).toEqual({
      firstName: 'Abdelrahman',
      lastName: 'Said',
      email: 'a.said@example.com',
      phone: '+20 10 4044 4569',
    })
  })

  it('nulls out empty and whitespace-only values', () => {
    expect(normalizeCvExtraction({
      firstName: '',
      lastName: '   ',
      email: '\n\t',
      phone: null,
    })).toEqual({ firstName: null, lastName: null, email: null, phone: null })
  })

  it('nulls out placeholder answers so the field reads as unanswered', () => {
    // A LinkedIn PDF export has no email — the model must not fill the form
    // with something that looks like an answer.
    expect(normalizeCvExtraction({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'N/A',
      phone: 'Not provided',
    })).toEqual({ firstName: 'Jane', lastName: 'Doe', email: null, phone: null })
  })

  it('keeps real values that merely resemble placeholders', () => {
    expect(normalizeCvExtraction({
      firstName: 'Nan',
      lastName: 'Nunes',
      email: 'none@example.com',
      phone: null,
    })).toEqual({
      firstName: 'Nan',
      lastName: 'Nunes',
      email: 'none@example.com',
      phone: null,
    })
  })
})

describe('truncateForExtraction', () => {
  it('caps long documents so a huge CV cannot inflate the run', () => {
    const long = 'x'.repeat(MAX_EXTRACTION_CHARS + 5_000)
    expect(truncateForExtraction(long)).toHaveLength(MAX_EXTRACTION_CHARS)
  })

  it('leaves ordinary documents untouched', () => {
    const cv = 'Abdelrahman Said\nSoftware Engineer\na.said@example.com'
    expect(truncateForExtraction(cv)).toBe(cv)
  })
})
