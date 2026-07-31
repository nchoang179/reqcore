import { describe, it, expect } from 'vitest'
import { generateJobSlug, resolveJobSlugUpdate } from '../../server/utils/slugify'
import { jobSlugBase, slugifyJobBase } from '../../shared/job-slug'

const JOB_ID = 'a1b2c3d4-0000-4000-8000-000000000000'

describe('generateJobSlug', () => {
  it('slugifies the title and appends a short id', () => {
    expect(generateJobSlug('Senior Software Engineer', JOB_ID)).toBe('senior-software-engineer-a1b2c3d4')
  })

  it('prefers an explicit custom slug over the title', () => {
    expect(generateJobSlug('Senior Software Engineer', JOB_ID, 'Backend Role!')).toBe('backend-role-a1b2c3d4')
  })

  it('is idempotent when its own output is fed back as a custom slug', () => {
    // The regression this guards: the settings form loaded the stored slug into
    // the editable field and sent it back on every save, so each save appended
    // another suffix — `…-a1b2c3d4-a1b2c3d4-a1b2c3d4` — and moved the public URL
    // five times before the 60-char cap absorbed the growth. Every move was a
    // hard 404 for the indexed link, the aggregators and every share already out.
    let slug = generateJobSlug('Senior Software Engineer', JOB_ID)

    for (let save = 0; save < 6; save++) {
      slug = generateJobSlug('Senior Software Engineer', JOB_ID, slug)
      expect(slug).toBe('senior-software-engineer-a1b2c3d4')
    }
  })

  it('keeps a suffix that is part of the recruiter\'s own base', () => {
    // Only a trailing suffix is stripped — one in the middle is just text.
    expect(generateJobSlug('Role', JOB_ID, 'a1b2c3d4-backend')).toBe('a1b2c3d4-backend-a1b2c3d4')
  })

  it('keeps non-Latin titles readable instead of collapsing them to a bare id', () => {
    // `[^\w]` is ASCII-only, so these all used to publish at `/jobs/-a1b2c3d4`:
    // no keyword, leading hyphen, reads as broken in a link preview.
    expect(generateJobSlug('软件工程师', JOB_ID)).toBe('软件工程师-a1b2c3d4')
    expect(generateJobSlug('Софтуерен инженер', JOB_ID)).toBe('софтуерен-инженер-a1b2c3d4')
    expect(generateJobSlug('मुख्य कार्यकारी अधिकारी', JOB_ID)).toBe('मुख्य-कार्यकारी-अधिकारी-a1b2c3d4')
    expect(generateJobSlug('한국어 개발자', JOB_ID)).toBe('한국어-개발자-a1b2c3d4')
  })

  it('drops Latin accents without gutting scripts whose marks are vowels', () => {
    // Stripping `\p{M}` wholesale folds French correctly but turns Devanagari
    // into nonsense, because a matra is a letter's vowel rather than an accent.
    expect(generateJobSlug('Ingénieur', JOB_ID)).toBe('ingenieur-a1b2c3d4')
    expect(generateJobSlug('कार्यकारी', JOB_ID)).toBe('कार्यकारी-a1b2c3d4')
  })

  it('folds diacritics onto their base letter', () => {
    expect(generateJobSlug('Ingénieur', JOB_ID)).toBe('ingenieur-a1b2c3d4')
    expect(generateJobSlug('Kỹ sư phần mềm', JOB_ID)).toBe('ky-su-phan-mem-a1b2c3d4')
    expect(generateJobSlug('Softwareentwickler (München)', JOB_ID)).toBe('softwareentwickler-munchen-a1b2c3d4')
  })

  it('falls back to a literal when the title has nothing to slug', () => {
    for (const title of ['   ', '...', '!!!', '— —']) {
      expect(generateJobSlug(title, JOB_ID)).toBe(`job-a1b2c3d4`)
    }
  })

  it('never leaves a dangling hyphen when the base is cut at the cap', () => {
    // The cut lands exactly on a hyphen — trimming after the slice, not before,
    // is what used to yield `…qux--a1b2c3d4`.
    const title = `${'a'.repeat(60)} tail`
    expect(generateJobSlug(title, JOB_ID)).toBe(`${'a'.repeat(60)}-a1b2c3d4`)
  })

  it('folds underscores into hyphens rather than deleting them', () => {
    expect(generateJobSlug('senior_software_engineer', JOB_ID)).toBe('senior-software-engineer-a1b2c3d4')
  })
})

describe('resolveJobSlugUpdate', () => {
  it('keeps the slug when a published job is retitled', () => {
    // The regression this guards: fixing a typo in the title used to re-derive
    // the slug, hard-404ing every indexed, reposted and emailed link to the job.
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: new Date('2026-01-01'),
      currentTitle: 'Senior Sofware Engineer',
      newTitle: 'Senior Software Engineer',
    })).toBeUndefined()
  })

  it('keeps the slug of a published job sent back to draft', () => {
    // `open → archived → draft` is an allowed transition, so guarding on status
    // let anyone park a live role, reopen it as a draft, retitle it, and take
    // every published link down with it. `publishedAt` does not travel back.
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: new Date('2026-01-01'),
      currentTitle: 'Senior Sofware Engineer',
      newTitle: 'Senior Software Engineer',
    })).toBeUndefined()
  })

  it('refreshes the slug when a never-published job is retitled', () => {
    // Nothing points at it yet — the public endpoints only serve open jobs.
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: null,
      currentTitle: 'Untitled Role',
      newTitle: 'Senior Software Engineer',
    })).toBe('senior-software-engineer-a1b2c3d4')
  })

  it('renames on an explicit custom slug, published or not', () => {
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: new Date('2026-01-01'),
      currentTitle: 'Senior Software Engineer',
      customSlug: 'staff-engineer',
    })).toBe('staff-engineer-a1b2c3d4')
  })

  it('does not move a published slug that is round-tripped back unchanged', () => {
    // Belt and braces behind the settings form's own "only send a real change"
    // rule: even if a caller echoes the stored slug back, the result is the slug
    // it already has, so the public URL stays put.
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: new Date('2026-01-01'),
      currentTitle: 'Senior Software Engineer',
      customSlug: 'senior-software-engineer-a1b2c3d4',
    })).toBe('senior-software-engineer-a1b2c3d4')
  })

  it('ignores a blank custom slug', () => {
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: new Date('2026-01-01'),
      currentTitle: 'Senior Software Engineer',
      customSlug: '   ',
    })).toBeUndefined()
  })

  it('leaves the slug alone when the title is not part of the update', () => {
    expect(resolveJobSlugUpdate({
      id: JOB_ID,
      publishedAt: null,
      currentTitle: 'Senior Software Engineer',
    })).toBeUndefined()
  })
})

describe('jobSlugBase', () => {
  it('strips the generated suffix so the settings field shows only what is editable', () => {
    expect(jobSlugBase('senior-software-engineer-a1b2c3d4')).toBe('senior-software-engineer')
  })

  it('leaves a slug without a suffix alone', () => {
    expect(jobSlugBase('senior-software-engineer')).toBe('senior-software-engineer')
    expect(jobSlugBase('')).toBe('')
  })

  it('round-trips: the field is seeded with the base, and re-minting matches', () => {
    // The exact settings-form path — seed the field from storage, save without
    // touching it, and the slug the server would mint is the one already stored.
    const stored = generateJobSlug('Senior Software Engineer', JOB_ID)
    const seeded = jobSlugBase(stored)

    expect(generateJobSlug('Senior Software Engineer', JOB_ID, seeded)).toBe(stored)
  })

  it('only strips a full 8-hex suffix', () => {
    expect(jobSlugBase('role-a1b2c3d')).toBe('role-a1b2c3d')
    expect(jobSlugBase('role-g1b2c3d4')).toBe('role-g1b2c3d4')
  })
})

describe('slugifyJobBase', () => {
  it('caps the base without counting the suffix', () => {
    expect(slugifyJobBase('a'.repeat(80))).toBe('a'.repeat(60))
  })
})
