import { describe, expect, it } from 'vitest'
import { resolveChatbotJobId } from '../../server/utils/ai/chatTools'

const activeJob = {
  scope: { kind: 'job' as const, jobId: 'job-technical-writer' },
  scopeJob: { id: 'job-technical-writer', title: 'Technical Writer (Part-Time)' },
}

describe('chatbot job scope resolution', () => {
  it('uses the active job when a job-scoped tool omits jobId', () => {
    expect(resolveChatbotJobId(activeJob)).toBe('job-technical-writer')
  })

  it('accepts the exact active job ID', () => {
    expect(resolveChatbotJobId(activeJob, 'job-technical-writer')).toBe('job-technical-writer')
  })

  it('maps the scoped job title back to its verified ID', () => {
    expect(resolveChatbotJobId(activeJob, '  TECHNICAL   WRITER (Part-Time)  '))
      .toBe('job-technical-writer')
  })

  it('still rejects a different job from a job-scoped conversation', () => {
    expect(() => resolveChatbotJobId(activeJob, 'DevOps Engineer'))
      .toThrow('Job DevOps Engineer is outside the active scope.')
  })

  it('requires an ID when the conversation has organization scope', () => {
    const organizationScope = { scope: { kind: 'organization' as const } }
    expect(() => resolveChatbotJobId(organizationScope))
      .toThrow('A job ID is required in organization scope.')
    expect(resolveChatbotJobId(organizationScope, 'job-123')).toBe('job-123')
  })
})
