import { describe, expect, it } from 'vitest'
import { interviewQuerySchema } from '../../server/utils/schemas/interview'

describe('interviewQuerySchema', () => {
  it('preserves descending order as the default', () => {
    expect(interviewQuerySchema.parse({}).order).toBe('desc')
  })

  it('accepts ascending order for nearest upcoming interviews first', () => {
    expect(interviewQuerySchema.parse({ order: 'asc' }).order).toBe('asc')
  })

  it('accepts scheduled-first order for the interviews page', () => {
    expect(interviewQuerySchema.parse({ order: 'scheduled_first' }).order).toBe('scheduled_first')
  })

  it('rejects unsupported order values', () => {
    expect(interviewQuerySchema.safeParse({ order: 'nearest' }).success).toBe(false)
  })
})
