/**
 * Onboarding survey - single source of truth for the post-signup questions.
 *
 * The flow runs once after a brand-new org is created. Question ids are stable
 * storage keys used by PostHog, database columns, and analytics segments.
 */

export interface SurveyOption {
  /** Stable value stored for this answer. Never change once shipped. */
  value: string
  label: string
}

export interface SurveyQuestion {
  /** Stable id. Never change once shipped. */
  id: string
  title: string
  subtitle?: string
  options: SurveyOption[]
}

export const SURVEY_PERSON_PROPS = {
  /** Plan the visitor clicked on the pricing page (free | solo | team | scale). */
  plan: 'signup_plan',
  /** Billing cadence carried from pricing (monthly | annual), when a paid plan. */
  billing: 'signup_billing',
  /** Set true once the survey is finished (answered or skipped). */
  completed: 'onboarding_survey_completed',
} as const

export const SURVEY_QUESTIONS = [
  {
    id: 'company_size',
    title: 'How big is your team?',
    subtitle: 'So we can size your workspace right.',
    options: [
      { value: 'solo', label: 'Just me' },
      { value: '2-10', label: '2-10' },
      { value: '11-50', label: '11-50' },
      { value: '51-200', label: '51-200' },
      { value: '201-1000', label: '201-1,000' },
      { value: '1000+', label: '1,000+' },
    ],
  },
  {
    id: 'user_role',
    title: "What's your role?",
    subtitle: 'We tailor the experience to how you hire.',
    options: [
      { value: 'founder', label: 'Founder / owner / CEO' },
      { value: 'people_hr', label: 'HR / People / Talent' },
      { value: 'recruiter', label: 'Recruiter / Talent Acquisition' },
      { value: 'hiring_manager', label: 'Hiring manager / team lead' },
      { value: 'operations', label: 'Operations' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'current_hiring_process',
    title: 'How do you manage hiring today?',
    subtitle: 'This helps us understand what you are moving from.',
    options: [
      { value: 'spreadsheets_email', label: 'Spreadsheets or email' },
      { value: 'notion_airtable_project_tool', label: 'Notion/Airtable/project tool' },
      { value: 'existing_ats', label: 'Existing ATS' },
      { value: 'external_recruiter_agency', label: 'External recruiter/agency' },
      { value: 'no_process_yet', label: 'We do not have a process yet' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'expected_roles_12m',
    title: 'How many roles do you expect to hire for in the next 12 months?',
    subtitle: 'This helps us understand the scale of your hiring workflow.',
    options: [
      { value: '1', label: '1 role' },
      { value: '2-5', label: '2-5 roles' },
      { value: '6-15', label: '6-15 roles' },
      { value: '16-50', label: '16-50 roles' },
      { value: '50+', label: '50+ roles' },
      { value: 'not_sure', label: 'Not sure yet' },
    ],
  },
] as const satisfies readonly SurveyQuestion[]

export type SurveyQuestionId = typeof SURVEY_QUESTIONS[number]['id']
export type SurveyAnswers = Partial<Record<SurveyQuestionId, string>>
