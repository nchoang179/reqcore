import { describe, it, expect } from 'vitest'
import { generateJobSlug, resolveJobSlugUpdate } from '../../server/utils/slugify'

const JOB_ID = 'a1b2c3d4-0000-4000-8000-000000000000'

describe('generateJobSlug', () => {
  it('slugifies the title and appends a short id', () => {
    expect(generateJobSlug('Senior Software Engineer', JOB_ID)).toBe('senior-software-engineer-a1b2c3d4')
  })

  it('prefers an explicit custom slug over the title', () => {
    expect(generateJobSlug('Senior Software Engineer', JOB_ID, 'Backend Role!')).toBe('backend-role-a1b2c3d4')
  })
})

describe('resolveJobSlugUpdate', () => {
  it('keeps the slug when a published job is retitled', () => {
    // The regression this guards: fixing a typo in the title used to re-derive
    // the slug, hard-404ing every indexed, reposted and emailed link to the job.
    for (const currentStatus of ['open', 'closed', 'archived']) {
      expect(resolveJobSlugUpdate({
        id: JOB_ID,
        currentStatus,
        currentTitle: 'Senior Sofware Engineer',
        newTitle: 'Senior Software Engineer',
      })).toBeUndefined()
    }
  })

  it('refreshes the slug when a draft is retitled', () => {
    // Drafts have no public URL yet — the public endpoints only serve open jobs.
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      currentStatus: 'draft',
      currentTitle: 'Untitled Role',
      newTitle: 'Senior Software Engineer',
    })).toBe('senior-software-engineer-a1b2c3d4')
  })

  it('renames on an explicit custom slug, whatever the status', () => {
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      currentStatus: 'open',
      currentTitle: 'Senior Software Engineer',
      customSlug: 'staff-engineer',
    })).toBe('staff-engineer-a1b2c3d4')
  })

  it('ignores a blank custom slug', () => {
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      currentStatus: 'open',
      currentTitle: 'Senior Software Engineer',
      customSlug: '   ',
    })).toBeUndefined()
  })

  it('leaves the slug alone when the title is not part of the update', () => {
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      currentStatus: 'draft',
      currentTitle: 'Senior Software Engineer',
    })).toBeUndefined()
  })
})
