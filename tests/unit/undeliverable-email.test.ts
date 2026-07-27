import { describe, it, expect } from 'vitest'
import { isUndeliverableAddress } from '../../server/utils/email'
import { SAMPLE_APPLICANTS } from '../../shared/sample-job'

/**
 * The sample applicants are fictional, so a recruiter walking the test-job
 * flow will eventually try to email one. Every such attempt would hard bounce,
 * and bounce rate is scored against the sending domain — so these addresses
 * have to be unsendable by construction, not by remembering to check.
 */
describe('isUndeliverableAddress', () => {
  it('blocks every sample applicant', () => {
    for (const applicant of SAMPLE_APPLICANTS) {
      expect(isUndeliverableAddress(applicant.email)).toBe(true)
    }
  })

  it('blocks the reserved domains and TLDs', () => {
    for (const address of [
      'someone@example.com',
      'someone@example.org',
      'someone@EXAMPLE.NET',
      'someone@anything.test',
      'someone@host.invalid',
      'someone@localhost',
    ]) {
      expect(isUndeliverableAddress(address)).toBe(true)
    }
  })

  it('leaves real addresses alone, including lookalikes', () => {
    for (const address of [
      'joachim@reqcore.com',
      'someone@gmail.com',
      // Not a reserved domain — only the exact registrable domains are.
      'someone@example.com.co',
      'someone@myexample.com',
      'someone@testing.io',
    ]) {
      expect(isUndeliverableAddress(address)).toBe(false)
    }
  })
})
