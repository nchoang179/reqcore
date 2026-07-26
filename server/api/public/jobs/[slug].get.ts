import { eq, and, asc } from 'drizzle-orm'
import { job, organization, orgSettings, careerPage } from '../../../database/schema'
import { publicJobSlugSchema } from '../../../utils/schemas/publicApplication'
import { tierHasFeature } from '../../../../shared/billing'
import { resolveOrgPlanId } from '../../../utils/billing/plan'

/**
 * GET /api/public/jobs/:slug
 * Returns job details + custom questions for an open job, resolved by slug.
 * Includes organization name for SEO structured data (Google Jobs).
 * No auth required — this is the public-facing endpoint for applicants.
 */
export default defineEventHandler(async (event) => {
  const { slug } = await getValidatedRouterParams(event, publicJobSlugSchema.parse)

  const result = await db.query.job.findFirst({
    where: and(eq(job.slug, slug), eq(job.status, 'open')),
    columns: {
      id: true,
      organizationId: true,
      title: true,
      slug: true,
      description: true,
      location: true,
      type: true,
      status: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryUnit: true,
      salaryNegotiable: true,
      remoteStatus: true,
      validThrough: true,
      phoneRequirement: true,
      requireResume: true,
      requireCoverLetter: true,
      createdAt: true,
      // Structured location + posting date feed the JobPosting JSON-LD that
      // Google for Jobs reads.
      locationCity: true,
      locationRegion: true,
      locationCountry: true,
      department: true,
      publishedAt: true,
    },
    with: {
      organization: {
        columns: {
          name: true,
          logo: true,
          slug: true,
        },
      },
      questions: {
        orderBy: (q, { asc }) => [asc(q.displayOrder), asc(q.createdAt)],
        columns: {
          id: true,
          type: true,
          label: true,
          description: true,
          required: true,
          options: true,
          displayOrder: true,
        },
      },
    },
  })

  if (!result) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  // Org-configured privacy notice shown on the application form.
  const settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.organizationId, result.organizationId),
    columns: { privacyPolicyUrl: true, privacyPolicyText: true, privacyContactEmail: true },
  })

  // Resolve the org's branded career page (if any) so the job page can link back
  // to the full list of open roles. Only surfaces when the org's plan includes
  // the careerPage feature and the page isn't disabled.
  let careerPageSlug: string | null = null
  let organizationLogo = result.organization?.logo ?? null
  const tier = await resolveOrgPlanId(result.organizationId)
  if (tierHasFeature(tier, 'careerPage')) {
    const cp = await db.query.careerPage.findFirst({
      where: eq(careerPage.organizationId, result.organizationId),
      columns: { slug: true, enabled: true, logoStorageKey: true, updatedAt: true },
    })
    if (cp?.enabled ?? true) {
      careerPageSlug = cp?.slug ?? result.organization?.slug ?? null
      if (cp?.logoStorageKey && careerPageSlug) {
        const version = new Date(cp.updatedAt).getTime()
        organizationLogo = `/api/public/career-page/${careerPageSlug}/asset?kind=logo&v=${version}`
      }
    }
  }

  // Flatten organization name into the response for SEO consumers
  const { organization: org, organizationId: _orgId, ...jobData } = result
  return {
    ...jobData,
    organizationName: org?.name ?? null,
    organizationLogo,
    careerPageSlug,
    privacyPolicyUrl: settings?.privacyPolicyUrl ?? null,
    privacyPolicyText: settings?.privacyPolicyText ?? null,
    privacyContactEmail: settings?.privacyContactEmail ?? null,
  }
})
