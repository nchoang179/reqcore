import { describe, it, expect } from 'vitest'
import {
  SAMPLE_APPLICANTS,
  SAMPLE_JOB_FORM,
  SAMPLE_JOB_QUESTIONS,
  SAMPLE_JOB_RULE,
  SAMPLE_SCORING_CRITERIA,
} from '../../shared/sample-job'
import { isPublishReady } from '../../shared/job-publish'
import { evaluateApplicationRules } from '../../shared/application-rules'
import type { EvaluatedRule, QuestionType } from '../../shared/application-rules'

/**
 * The sample content is the first thing a prospective customer sees the product
 * do, and it is hand-written rather than generated — so these guard the ways it
 * could quietly rot: a renamed criterion leaving scores orphaned, a question
 * removed without its answers, or an edit to the description dropping it below
 * the length the publish gate demands.
 */
describe('sample job fixture', () => {
  it('is publishable on its own, so the walkthrough never hits the publish gate', () => {
    expect(isPublishReady({
      description: SAMPLE_JOB_FORM.description,
      locationCountry: SAMPLE_JOB_FORM.locationCountry,
      remoteStatus: SAMPLE_JOB_FORM.remoteStatus,
      validThrough: null,
    })).toBe(true)
  })

  it('scores every applicant against exactly the criteria the wizard creates', () => {
    const criterionKeys = SAMPLE_SCORING_CRITERIA.map(c => c.key).sort()
    expect(new Set(criterionKeys).size).toBe(criterionKeys.length)

    for (const applicant of SAMPLE_APPLICANTS) {
      expect(applicant.criterionScores.map(s => s.criterionKey).sort()).toEqual(criterionKeys)
    }
  })

  it('answers every question, positionally', () => {
    for (const applicant of SAMPLE_APPLICANTS) {
      expect(applicant.answers).toHaveLength(SAMPLE_JOB_QUESTIONS.length)
    }
  })

  it('only offers answers the select questions actually accept', () => {
    SAMPLE_JOB_QUESTIONS.forEach((question, index) => {
      if (question.type !== 'single_select' || !question.options) return
      for (const applicant of SAMPLE_APPLICANTS) {
        expect(question.options).toContain(applicant.answers[index])
      }
    })
  })

  it('keeps per-criterion scores inside their own maximum', () => {
    const maxByKey = new Map(SAMPLE_SCORING_CRITERIA.map(c => [c.key, c.maxScore]))
    for (const applicant of SAMPLE_APPLICANTS) {
      for (const score of applicant.criterionScores) {
        expect(score.applicantScore).toBeLessThanOrEqual(maxByKey.get(score.criterionKey)!)
        expect(score.applicantScore).toBeGreaterThanOrEqual(0)
        expect(score.maxScore).toBe(maxByKey.get(score.criterionKey))
        expect(score.confidence).toBeGreaterThanOrEqual(0)
        expect(score.confidence).toBeLessThanOrEqual(100)
        expect(score.evidence.trim()).not.toBe('')
      }
    }
  })

  it('ranks with a real spread — a shortlist is only convincing if the bottom is visibly worse', () => {
    const scores = SAMPLE_APPLICANTS.map(a => a.score)
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThanOrEqual(40)
    // Ordered best-first, so the fixture reads the way the shortlist will.
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('uses only addresses that can never deliver', () => {
    const emails = SAMPLE_APPLICANTS.map(a => a.email)
    for (const email of emails) expect(email.endsWith('@example.com')).toBe(true)
    // The candidate table is unique on (org, email) — duplicates would collide.
    expect(new Set(emails).size).toBe(emails.length)
  })
})

/**
 * The shipped knockout rule only demonstrates anything if it actually fires, and
 * it is written against questions it can only reach by position. These pin both
 * halves: that the conditions still line up with the questions the wizard
 * creates, and that running them leaves a pipeline worth looking at — some
 * rejected, more surviving, and the survivors still visibly ranked.
 */
describe('sample knockout rule', () => {
  const questionTypesById: Record<string, QuestionType> = {}
  SAMPLE_JOB_QUESTIONS.forEach((q, index) => { questionTypesById[String(index)] = q.type })

  /** Conditions resolved onto question ids, exactly as the server does it. */
  const conditions = SAMPLE_JOB_RULE.conditions.map(c => ({
    questionId: String(c.questionIndex),
    operator: c.operator,
    value: c.value,
  }))

  const rule: EvaluatedRule = {
    id: 'sample-rule',
    name: SAMPLE_JOB_RULE.name,
    matchType: SAMPLE_JOB_RULE.matchType,
    action: SAMPLE_JOB_RULE.action,
    enabled: SAMPLE_JOB_RULE.enabled,
    conditions,
  }

  function matchFor(applicant: typeof SAMPLE_APPLICANTS[number]) {
    const responses: Record<string, string> = {}
    applicant.answers.forEach((value, index) => { responses[String(index)] = value })
    return evaluateApplicationRules([rule], responses, questionTypesById)
  }

  it('points at questions that exist and are still the type it was written for', () => {
    for (const condition of SAMPLE_JOB_RULE.conditions) {
      const question = SAMPLE_JOB_QUESTIONS[condition.questionIndex]
      expect(question).toBeDefined()
      // The server drops the rule when this drifts, silently removing the demo.
      expect(question!.type).toBe(condition.questionType)
      // Comparing against an option nobody can pick would never fire.
      for (const option of condition.value) expect(question!.options).toContain(option)
    }
  })

  it('rejects exactly the applicants who answer below the stated minimum', () => {
    const rejected = SAMPLE_APPLICANTS.filter(a => matchFor(a)?.action === 'rejected')
    expect(rejected.map(a => a.answers[0])).toEqual(rejected.map(() => 'Less than 1 year'))
    expect(rejected.length).toBe(SAMPLE_APPLICANTS.filter(a => a.answers[0] === 'Less than 1 year').length)
  })

  it('knocks some out but leaves most of the pipeline standing', () => {
    const rejected = SAMPLE_APPLICANTS.filter(a => matchFor(a))
    expect(rejected.length).toBeGreaterThan(0)
    expect(rejected.length).toBeLessThan(SAMPLE_APPLICANTS.length / 2)
  })

  it('leaves the survivors with a visible spread — the shortlist still has to rank', () => {
    const surviving = SAMPLE_APPLICANTS.filter(a => !matchFor(a)).map(a => a.score)
    expect(surviving.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...surviving) - Math.min(...surviving)).toBeGreaterThanOrEqual(20)
  })

  it('names the questions that triggered it, so the UI can attribute the rejection', () => {
    const match = matchFor(SAMPLE_APPLICANTS.find(a => a.answers[0] === 'Less than 1 year')!)
    expect(match?.matchedQuestionIds).toEqual(['0'])
  })
})
