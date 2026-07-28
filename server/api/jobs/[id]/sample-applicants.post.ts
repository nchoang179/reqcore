import { eq, and, inArray, asc } from 'drizzle-orm'
import {
  job,
  jobQuestion,
  candidate,
  application,
  applicationRule,
  criterionScore,
  questionResponse,
} from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { SAMPLE_APPLICANTS, SAMPLE_JOB_RULE } from '../../../../shared/sample-job'
import {
  evaluateApplicationRules,
  type EvaluatedRule,
  type QuestionType,
  type RuleCondition,
  type RuleMatch,
  type ResponseValue,
} from '../../../../shared/application-rules'

/**
 * POST /api/jobs/:id/sample-applicants
 *
 * Drops the pre-scored sample applicants into a freshly published test job,
 * along with the knockout rule that sorts three of them out.
 *
 * This is the payoff of the test-job walkthrough: a wizard that ends on an
 * empty pipeline has demonstrated a form, not a product. The ranked shortlist
 * is the thing worth seeing, so the job arrives already holding one — with the
 * under-a-year applicants already rejected by an automation rule, which is how
 * that feature gets discovered at all.
 *
 * The scores come from `shared/sample-job.ts` verbatim. Nothing here calls a
 * model — running real inference for every visitor trying the product out would
 * bill unbounded work triggered by anyone who can create an account. The
 * rejections, by contrast, are not canned: they come out of the same evaluator
 * the live apply endpoint runs, so what the walkthrough shows is what the rule
 * would actually do.
 *
 * Restricted to `isTest` jobs so this can never be aimed at a real pipeline,
 * and idempotent, so a double-submit or a refresh cannot double the list.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const target = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true, isTest: true },
  })

  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // The guard that keeps fictional people out of real pipelines.
  if (!target.isTest) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Sample applicants can only be added to a test job.',
    })
  }

  const existing = await db.query.application.findFirst({
    where: and(eq(application.jobId, target.id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (existing) {
    return { created: 0, autoRejected: 0, alreadyPopulated: true }
  }

  // Answers are positional in the fixture, so the questions have to come back
  // in the order the wizard created them.
  const questions = await db.query.jobQuestion.findMany({
    where: and(eq(jobQuestion.jobId, target.id), eq(jobQuestion.organizationId, orgId)),
    columns: { id: true, type: true, displayOrder: true },
    orderBy: [asc(jobQuestion.displayOrder)],
  })

  const questionTypesById: Record<string, QuestionType> = {}
  for (const q of questions) questionTypesById[q.id] = q.type as QuestionType

  // Resolve the shipped rule onto the questions the wizard actually created.
  // The recruiter can edit or delete any of them in step 2, and a condition
  // re-pointed at whatever ended up in that position would reject the wrong
  // people — so a position holding a different question type drops the rule
  // entirely rather than guessing.
  const ruleConditions: RuleCondition[] = SAMPLE_JOB_RULE.conditions.flatMap((c) => {
    const question = questions[c.questionIndex]
    if (!question || question.type !== c.questionType) return []
    return [{ questionId: question.id, operator: c.operator, value: c.value }]
  })
  const ruleFits = ruleConditions.length === SAMPLE_JOB_RULE.conditions.length

  const emails = SAMPLE_APPLICANTS.map(a => a.email)

  // Filled inside the transaction, logged after it commits.
  const autoRejected: Array<{ applicationId: string, match: RuleMatch }> = []

  await db.transaction(async (tx) => {
    // A workspace that ran the walkthrough twice already has these people. The
    // unique index on (org, email) makes a blind insert fail, so reuse whoever
    // is already there and only create the rest.
    const present = emails.length
      ? await tx.query.candidate.findMany({
          where: and(eq(candidate.organizationId, orgId), inArray(candidate.email, emails)),
          columns: { id: true, email: true },
        })
      : []
    const candidateIdByEmail = new Map(present.map(c => [c.email, c.id]))

    const missing = SAMPLE_APPLICANTS.filter(a => !candidateIdByEmail.has(a.email))
    if (missing.length) {
      const inserted = await tx.insert(candidate).values(
        missing.map(a => ({
          organizationId: orgId,
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
          phone: a.phone,
        })),
      ).returning({ id: candidate.id, email: candidate.email })

      for (const row of inserted) candidateIdByEmail.set(row.email, row.id)
    }

    // The knockout rule, saved as a real rule row — it shows up in the builder
    // on the Automation Rules tab, editable like any other, and keeps working on
    // anything the recruiter submits through the live form afterwards.
    let rule: EvaluatedRule | null = null
    if (ruleFits) {
      const [inserted] = await tx.insert(applicationRule).values({
        organizationId: orgId,
        jobId: target.id,
        name: SAMPLE_JOB_RULE.name,
        matchType: SAMPLE_JOB_RULE.matchType,
        action: SAMPLE_JOB_RULE.action,
        enabled: SAMPLE_JOB_RULE.enabled,
        conditions: ruleConditions,
        displayOrder: 0,
      }).returning({ id: applicationRule.id })

      rule = {
        id: inserted!.id,
        name: SAMPLE_JOB_RULE.name,
        matchType: SAMPLE_JOB_RULE.matchType,
        action: SAMPLE_JOB_RULE.action,
        enabled: SAMPLE_JOB_RULE.enabled,
        conditions: ruleConditions,
      }
    }

    // Run the rule the same way the live apply endpoint would, against the same
    // answers these applicants are about to be given.
    const matchByEmail = new Map<string, RuleMatch>()
    if (rule) {
      for (const a of SAMPLE_APPLICANTS) {
        const responses: Record<string, ResponseValue> = {}
        a.answers.forEach((value, index) => {
          const question = questions[index]
          if (question) responses[question.id] = value
        })

        const match = evaluateApplicationRules([rule], responses, questionTypesById)
        if (match) matchByEmail.set(a.email, match)
      }
    }

    const applications = await tx.insert(application).values(
      SAMPLE_APPLICANTS.map((a) => {
        const match = matchByEmail.get(a.email)
        return {
          organizationId: orgId,
          candidateId: candidateIdByEmail.get(a.email)!,
          jobId: target.id,
          // Whoever the rule caught is already out. Everyone else lands in
          // `new`: the recruiter has not triaged them yet, so the ranking is the
          // only thing separating them. That is the point.
          status: match?.action ?? ('new' as const),
          // An auto-rejected application is never scored in the real flow —
          // rejecting before inference is most of why the rule is worth having —
          // so the knocked-out ones arrive without a number.
          score: match ? null : a.score,
          autoRule: match ?? null,
          coverLetterText: a.coverLetterText,
        }
      }),
    ).returning({ id: application.id, candidateId: application.candidateId })

    const applicationIdByCandidate = new Map(applications.map(a => [a.candidateId, a.id]))

    for (const a of SAMPLE_APPLICANTS) {
      const match = matchByEmail.get(a.email)
      if (!match) continue
      autoRejected.push({
        applicationId: applicationIdByCandidate.get(candidateIdByEmail.get(a.email)!)!,
        match,
      })
    }

    // No criterion scores for the knocked-out applicants, for the same reason
    // they carry no overall score: the rule stopped them before scoring.
    const scoreRows = SAMPLE_APPLICANTS.flatMap((a) => {
      if (matchByEmail.has(a.email)) return []
      const applicationId = applicationIdByCandidate.get(candidateIdByEmail.get(a.email)!)!
      return a.criterionScores.map(s => ({
        organizationId: orgId,
        applicationId,
        criterionKey: s.criterionKey,
        maxScore: s.maxScore,
        applicantScore: s.applicantScore,
        confidence: s.confidence,
        evidence: s.evidence,
        strengths: s.strengths,
        gaps: s.gaps,
      }))
    })
    if (scoreRows.length) await tx.insert(criterionScore).values(scoreRows)

    // Only fills answers the recruiter actually kept — they are free to delete a
    // sample question in step 2, and a missing question just means no answer.
    const responseRows = SAMPLE_APPLICANTS.flatMap((a) => {
      const applicationId = applicationIdByCandidate.get(candidateIdByEmail.get(a.email)!)!
      return a.answers.flatMap((value, index) => {
        const question = questions[index]
        if (!question) return []
        return [{ organizationId: orgId, applicationId, questionId: question.id, value }]
      })
    })
    if (responseRows.length) await tx.insert(questionResponse).values(responseRows)
  })

  // Same system-actor audit trail a live auto-rejection writes (see
  // server/utils/rules/applyRules.ts), so the rejected applicants' timelines
  // read "status changed by a rule" rather than showing nothing at all.
  for (const { applicationId, match } of autoRejected) {
    recordActivity({
      organizationId: orgId,
      actorId: null,
      action: 'status_changed',
      resourceType: 'application',
      resourceId: applicationId,
      metadata: { from: 'new', to: match.action, ruleId: match.ruleId, ruleName: match.ruleName },
    })
  }

  return {
    created: SAMPLE_APPLICANTS.length,
    autoRejected: autoRejected.length,
    alreadyPopulated: false,
  }
})
