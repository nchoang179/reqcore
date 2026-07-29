import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  numeric,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { organization, user } from './auth'

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export const jobStatusEnum = pgEnum('job_status', ['draft', 'open', 'closed', 'archived'])
export const jobTypeEnum = pgEnum('job_type', ['full_time', 'part_time', 'contract', 'internship'])
export const applicationStatusEnum = pgEnum('application_status', [
  'new', 'screening', 'interview', 'offer', 'hired', 'rejected',
])
export const documentTypeEnum = pgEnum('document_type', ['resume', 'cover_letter', 'other'])
export const questionTypeEnum = pgEnum('question_type', [
  'short_text', 'long_text', 'single_select', 'multi_select',
  'number', 'date', 'url', 'checkbox', 'file_upload',
])
export const propertyEntityTypeEnum = pgEnum('property_entity_type', ['candidate', 'application'])
export const propertyTypeEnum = pgEnum('property_type', [
  'text', 'long_text', 'number', 'select', 'multi_select',
  'date', 'checkbox', 'url', 'email', 'person', 'file',
])
export const genderEnum = pgEnum('gender', ['male', 'female', 'other', 'prefer_not_to_say'])
export const experienceLevelEnum = pgEnum('experience_level', ['junior', 'mid', 'senior', 'lead'])
export const nameDisplayFormatEnum = pgEnum('name_display_format', ['first_last', 'last_first'])
export const dateFormatEnum = pgEnum('date_format', ['mdy', 'dmy', 'ymd'])
export const candidateMessageDirectionEnum = pgEnum('candidate_message_direction', ['inbound', 'outbound'])
export const candidateMessageStatusEnum = pgEnum('candidate_message_status', [
  'queued', 'sent', 'delivered', 'delayed', 'bounced', 'failed', 'complained',
])

// ─────────────────────────────────────────────
// ATS Domain Tables — ALL scoped by organizationId
// ─────────────────────────────────────────────

/**
 * Post-signup onboarding survey answers for an account.
 *
 * One row per user. Answers are nullable because each question is skippable.
 * `organizationId` captures the active organization created during onboarding,
 * while `userId` is the durable account link for user-level analysis.
 */
export const onboardingSurveyResponse = pgTable('onboarding_survey_response', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  signupPlan: text('signup_plan'),
  signupBilling: text('signup_billing'),
  companySize: text('company_size'),
  userRole: text('user_role'),
  discoverySource: text('discovery_source'),
  currentHiringProcess: text('current_hiring_process'),
  expectedRoles12m: text('expected_roles_12m'),
  answeredCount: integer('answered_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  // Null while the survey is still in progress (partial rows are saved per
  // answer). Set once, when the user reaches the final step — this is the
  // source of truth for "did they finish the survey?".
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('onboarding_survey_response_user_id_idx').on(t.userId),
  index('onboarding_survey_response_organization_id_idx').on(t.organizationId),
]))

/**
 * Jobs / Positions within an organization.
 */
export const job = pgTable('job', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  location: text('location'),
  type: jobTypeEnum('type').notNull().default('full_time'),
  status: jobStatusEnum('status').notNull().default('draft'),
  // ── SEO / Rich Results fields ──
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency'),
  salaryUnit: text('salary_unit'),
  salaryNegotiable: boolean('salary_negotiable').notNull().default(false),
  remoteStatus: text('remote_status'),
  validThrough: timestamp('valid_through'),
  /** Experience level required for this role */
  experienceLevel: experienceLevelEnum('experience_level'),
  // ── Structured location ──
  // `location` above stays the free-text display string. These supplement it:
  // job board feeds reject or heavily downrank postings without a country, and
  // schema.org PostalAddress wants the parts separated.
  locationCity: text('location_city'),
  locationRegion: text('location_region'),
  /** ISO 3166-1 alpha-2, uppercased. Required to appear in the job board feed. */
  locationCountry: text('location_country'),
  /**
   * Optional postal code, uppercased and whitespace-collapsed.
   *
   * Aggregators geocode a city name to its centroid, which places every role in
   * a large metro at the same pin — wrong by enough to fall out of the radius
   * searches ("within 10 miles") candidates actually filter by. A postal code
   * narrows that. It stays out of the derived `location` display string on
   * purpose: putting it there would split the career page's location filter
   * into one group per postal code.
   */
  locationPostalCode: text('location_postal_code'),
  /** Maps to <category> in the feed. */
  department: text('department'),
  // ── Distribution ──
  /**
   * Whether this job is syndicated to external job boards via /jobs.xml.
   * Defaults on — publishing is the distribution action. Recruiters opt a
   * confidential search out per job.
   */
  distributeToBoards: boolean('distribute_to_boards').notNull().default(true),
  /**
   * A role created to try the product out rather than to hire for.
   *
   * It behaves like any other job inside the workspace — it opens, collects
   * applications and gets scored — but it is excluded from every surface a real
   * candidate or an aggregator can reach: the public board, career pages, the
   * sitemap and /jobs.xml. That is the whole point: someone evaluating Reqcore
   * can walk the real create-a-job flow without their practice run turning into
   * a listing the world sees, which is what fills the board with "test" and
   * "asdf" roles today.
   *
   * Never inferred. Only the sample-job entry point sets it, so a real role can
   * never be quietly demoted out of distribution.
   */
  isTest: boolean('is_test').notNull().default(false),
  /**
   * First time this job went `open`. Feeds and Google for Jobs rank on posting
   * age, so `createdAt` misreports a draft that sat unpublished for weeks. Set
   * once and never reset — reopening a closed role keeps its original age.
   */
  publishedAt: timestamp('published_at'),
  /**
   * AI-written social copy for the Promote tab, cached so reopening the tab
   * doesn't re-bill a generation. Regenerating overwrites it.
   */
  shareCopy: jsonb('share_copy').$type<{
    channels: Record<string, string>
    generatedAt: string
    /** `SHARE_LANGUAGES` code it was written in; absent on copy cached before the picker existed. */
    language?: string
  }>(),
  // ── Application form settings ──
  phoneRequirement: text('phone_requirement').$type<'hidden' | 'optional' | 'required'>().notNull().default('optional'),
  requireResume: boolean('require_resume').notNull().default(false),
  requireCoverLetter: boolean('require_cover_letter').notNull().default(false),
  // ── AI scoring settings ──
  /**
   * Ranking every applicant as they arrive is the default: a job created
   * without an opinion on it should still produce a shortlist. It is inert on a
   * job with no scoring criteria — `autoScoreApplication` returns before
   * spending anything — so the default costs nothing on its own.
   */
  autoScoreOnApply: boolean('auto_score_on_apply').notNull().default(true),
  /**
   * Which optional candidate data sources the AI analysis reads. A resume is
   * always included when present, but another enabled source is sufficient.
   */
  analysisContext: jsonb('analysis_context').$type<{
    coverLetter: boolean
    screeningAnswers: boolean
    recruiterNotes: boolean
  }>().notNull().default({ coverLetter: true, screeningAnswers: true, recruiterNotes: false }),
  // ── Timestamps ──
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_organization_id_idx').on(t.organizationId),
  // One test role per org. A test role skips the plan's active-role cap, so
  // without this the walkthrough is a way to hold unlimited free open roles.
  // Enforced here rather than only in the API because the check-then-insert in
  // the create endpoint is racy — concurrent requests both pass it.
  uniqueIndex('job_one_test_per_org_idx').on(t.organizationId).where(sql`${t.isTest}`),
]))

/**
 * Candidates (applicants) belonging to a specific tenant.
 */
export const candidate = pgTable('candidate', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  /** Optional display name override (e.g. for localized name ordering) */
  displayName: text('display_name'),
  email: text('email').notNull(),
  phone: text('phone'),
  /** Gender — stored as enum for structured filtering */
  gender: genderEnum('gender'),
  /** Date of birth — stored as text in ISO 8601 format (YYYY-MM-DD) to avoid timezone issues */
  dateOfBirth: text('date_of_birth'),
  /** Quick notes visible inline on the candidates list */
  quickNotes: text('quick_notes'),
  // ── GDPR retention / erasure lifecycle ──
  /** When set and in the future, this candidate is exempt from automated retention deletion */
  retentionExemptUntil: timestamp('retention_exempt_until'),
  /** Documented justification for the exemption (legal hold, active dispute, etc.) */
  retentionExemptReason: text('retention_exempt_reason'),
  /**
   * When an admin last manually reviewed/restored this candidate. Acts as a
   * fresh retention anchor: restoring from quarantine sets this to now so the
   * candidate gets a full retention window again instead of being re-quarantined
   * on the next sweep. NULL = never manually reviewed.
   */
  retentionReviewedAt: timestamp('retention_reviewed_at'),
  /** When the candidate entered the recoverable quarantine window. NULL = not quarantined. */
  quarantinedAt: timestamp('quarantined_at'),
  /** When a quarantined candidate becomes eligible for permanent erasure */
  scheduledPurgeAt: timestamp('scheduled_purge_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_organization_id_idx').on(t.organizationId),
  index('candidate_gender_idx').on(t.organizationId, t.gender),
  uniqueIndex('candidate_org_email_idx').on(t.organizationId, t.email),
  // Drives the retention cron's quarantine → purge sweep efficiently.
  index('candidate_quarantine_idx').on(t.organizationId, t.scheduledPurgeAt),
]))

/**
 * An application links a candidate to a job within the same organization.
 */
export const application = pgTable('application', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  status: applicationStatusEnum('status').notNull().default('new'),
  score: integer('score'),
  notes: text('notes'),
  coverLetterText: text('cover_letter_text'),
  /**
   * Snapshot of the automation rule that auto-set this application's status on
   * submit (see server/utils/rules/applyRules.ts) — rule id/name, the action,
   * and the ids of the responses that triggered it. Null when the status was
   * never touched by a rule. Purely informational: surfaced as a small badge on
   * the status and on each triggering response so recruiters can tell an
   * automated categorization from a manual one and see why it fired.
   */
  autoRule: jsonb('auto_rule').$type<import('../../../shared/application-rules').RuleMatch>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('application_organization_id_idx').on(t.organizationId),
  index('application_candidate_id_idx').on(t.candidateId),
  index('application_job_id_idx').on(t.jobId),
  uniqueIndex('application_org_candidate_job_idx').on(t.organizationId, t.candidateId, t.jobId),
]))

/**
 * Documents stored in MinIO (resumes, cover letters, etc.).
 * `storageKey` is the S3 object key in the bucket.
 * `parsedContent` holds the structured JSON output from PDF parsing.
 */
export const document = pgTable('document', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  type: documentTypeEnum('type').notNull().default('resume'),
  storageKey: text('storage_key').notNull().unique(),
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes'),
  parsedContent: jsonb('parsed_content'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('document_organization_id_idx').on(t.organizationId),
  index('document_candidate_id_idx').on(t.candidateId),
]))

// ─────────────────────────────────────────────
// Custom Application Form Questions
// ─────────────────────────────────────────────

/**
 * Custom questions configured by the recruiter for a specific job.
 * These appear on the public application form alongside the standard fields.
 * `options` is only used for `single_select` and `multi_select` types.
 */
export const jobQuestion = pgTable('job_question', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull().default('short_text'),
  label: text('label').notNull(),
  description: text('description'),
  required: boolean('required').notNull().default(false),
  options: jsonb('options').$type<string[]>(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_question_organization_id_idx').on(t.organizationId),
  index('job_question_job_id_idx').on(t.jobId),
]))

/**
 * Applicant responses to custom questions, stored per application.
 * `value` is stored as JSONB to support different response types
 * (string, string[], number, boolean).
 */
export const questionResponse = pgTable('question_response', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull().references(() => jobQuestion.id, { onDelete: 'cascade' }),
  value: jsonb('value').$type<string | string[] | number | boolean>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('question_response_organization_id_idx').on(t.organizationId),
  index('question_response_application_id_idx').on(t.applicationId),
  index('question_response_question_id_idx').on(t.questionId),
]))

// ─────────────────────────────────────────────
// Custom Properties (Notion-style "database properties")
// ─────────────────────────────────────────────
//
// Two-table design:
//   - propertyDefinition: schema. Org-global when jobId IS NULL; per-job otherwise.
//                         entityType=candidate is always org-global (jobId must be NULL).
//                         entityType=application can be org-global OR per-job.
//   - propertyValue:      values, polymorphic to candidate.id or application.id.
//
// `value` is jsonb shaped by the property type:
//   text/long_text/url/email/person → string
//   number                          → number
//   select                          → string (one option id)
//   multi_select                    → string[] (option ids)
//   date                            → string (ISO YYYY-MM-DD)
//   checkbox                        → boolean
//   file                            → { documentId: string }
//
// `config` jsonb:
//   select / multi_select → { options: [{ id, label, color }] }
//   number                → { format?: 'plain' | 'percent' | 'currency', currency?: string }
//   others                → null
//
// Per-job overrides are NOT supported (additive only): per-job props are merged
// after org-global ones, ordered by displayOrder.

export const propertyDefinition = pgTable('property_definition', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** NULL = org-global. Non-null = per-job (only valid when entityType='application'). */
  jobId: text('job_id').references(() => job.id, { onDelete: 'cascade' }),
  entityType: propertyEntityTypeEnum('entity_type').notNull(),
  type: propertyTypeEnum('type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  displayOrder: integer('display_order').notNull().default(0),
  config: jsonb('config').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('property_definition_org_idx').on(t.organizationId),
  index('property_definition_org_entity_idx').on(t.organizationId, t.entityType),
  index('property_definition_job_idx').on(t.jobId),
]))

export const propertyValue = pgTable('property_value', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  propertyDefinitionId: text('property_definition_id').notNull().references(() => propertyDefinition.id, { onDelete: 'cascade' }),
  entityType: propertyEntityTypeEnum('entity_type').notNull(),
  /** candidate.id when entityType='candidate', application.id when 'application' */
  entityId: text('entity_id').notNull(),
  value: jsonb('value'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('property_value_org_idx').on(t.organizationId),
  index('property_value_entity_idx').on(t.entityType, t.entityId),
  index('property_value_definition_idx').on(t.propertyDefinitionId),
  uniqueIndex('property_value_def_entity_idx').on(t.propertyDefinitionId, t.entityId),
]))

// ─────────────────────────────────────────────
// Organization Localization Settings
// ─────────────────────────────────────────────

/**
 * Per-organization localization preferences.
 * Controls how candidate names and dates are displayed across the app.
 * One row per organization — upserted on change.
 */
export const orgSettings = pgTable('org_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Controls whether names display as "First Last" or "Last First" */
  nameDisplayFormat: nameDisplayFormatEnum('name_display_format').notNull().default('first_last'),
  /** Controls the date display format across the app */
  dateFormat: dateFormatEnum('date_format').notNull().default('mdy'),
  // ── GDPR retention policy ──
  /** Master switch — when false, no automated retention deletion runs for this org */
  retentionEnabled: boolean('retention_enabled').notNull().default(false),
  /** Months of inactivity (since latest recruitment process ends) before erasure */
  retentionMonths: integer('retention_months').notNull().default(24),
  /** Days a candidate stays recoverable in quarantine before permanent erasure */
  quarantineDays: integer('quarantine_days').notNull().default(30),
  /** First time retention was enabled — anchors the review window so existing data
   *  is never deleted immediately. NULL until the org first enables retention. */
  retentionActivatedAt: timestamp('retention_activated_at'),
  // ── Application-form privacy notice (org-configurable) ──
  privacyPolicyUrl: text('privacy_policy_url'),
  privacyPolicyText: text('privacy_policy_text'),
  privacyContactEmail: text('privacy_contact_email'),
  // ── Company profile (used by the job board feed's <company> block) ──
  /** Public company website. Aggregators rank feeds with a resolvable company URL higher. */
  websiteUrl: text('website_url'),
  companyDescription: text('company_description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('org_settings_organization_id_idx').on(t.organizationId),
]))

// ─────────────────────────────────────────────
// GDPR Retention Audit
// ─────────────────────────────────────────────

export const retentionAuditActionEnum = pgEnum('retention_audit_action', [
  'quarantined', 'restored', 'erased', 'exempted', 'unexempted', 'exported',
])

/**
 * Privacy-safe audit trail for retention & erasure actions.
 *
 * Deliberately stores NO personal data — no names, emails, filenames, resume
 * content, or storage keys. `candidateId` is an opaque UUID kept as proof that a
 * specific record was handled; it is not personal data once the candidate is gone.
 * Lives in its own table (not `activity_log`) so it survives candidate erasure,
 * which deletes the candidate's `activity_log` rows.
 */
export const retentionAudit = pgTable('retention_audit', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Opaque candidate UUID — intentionally NOT a foreign key so it outlives erasure. */
  candidateId: text('candidate_id').notNull(),
  action: retentionAuditActionEnum('action').notNull(),
  /** Outcome marker: 'success' | 'partial' | 'failed' | 'dry_run'. */
  result: text('result').notNull().default('success'),
  /** Triggering user id, or null for scheduled cron runs. Opaque id, not PII. */
  actorId: text('actor_id'),
  /** Non-PII counts only (e.g. { documents: 2, comments: 1, s3Failures: 0 }). */
  metadata: jsonb('metadata').$type<Record<string, number | string>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('retention_audit_organization_id_idx').on(t.organizationId),
  index('retention_audit_candidate_id_idx').on(t.candidateId),
  index('retention_audit_created_at_idx').on(t.createdAt),
]))

// ─────────────────────────────────────────────
// Invite Links & Join Requests
// ─────────────────────────────────────────────

export const joinRequestStatusEnum = pgEnum('join_request_status', ['pending', 'approved', 'rejected'])

/**
 * Shareable invite links generated by org owners/admins.
 * Anyone with the link (and authenticated) can join at the specified role.
 * `token` is a cryptographic random hex string — NOT the primary key —
 * to prevent ID enumeration.
 */
export const inviteLink = pgTable('invite_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  role: text('role').notNull().default('member'),
  maxUses: integer('max_uses'),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('invite_link_organization_id_idx').on(t.organizationId),
  index('invite_link_token_idx').on(t.token),
]))

/**
 * Join requests submitted by authenticated users wanting to join an org.
 * Only one pending request per user per org at a time (enforced in API).
 */
export const joinRequest = pgTable('join_request', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: joinRequestStatusEnum('status').notNull().default('pending'),
  reviewedById: text('reviewed_by_id').references(() => user.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('join_request_organization_id_idx').on(t.organizationId),
  index('join_request_user_id_idx').on(t.userId),
  index('join_request_status_idx').on(t.status),
]))

// ─────────────────────────────────────────────
// Collaboration: Comments
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Calendar Integrations
// ─────────────────────────────────────────────

export const calendarProviderEnum = pgEnum('calendar_provider', ['google'])

/**
 * Per-user calendar integration credentials.
 * Tokens are encrypted at rest with AES-256-GCM derived from BETTER_AUTH_SECRET.
 * Each user can connect one calendar provider. The `calendarId` is the target
 * calendar for interview events (defaults to 'primary').
 */
export const calendarIntegration = pgTable('calendar_integration', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: calendarProviderEnum('provider').notNull().default('google'),
  /** AES-256-GCM encrypted Google OAuth2 access token */
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  /** AES-256-GCM encrypted Google OAuth2 refresh token */
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  /** Google Calendar ID to create events in (defaults to 'primary') */
  calendarId: text('calendar_id').notNull().default('primary'),
  /** Email address of the connected Google account */
  accountEmail: text('account_email'),
  /** Google push notification channel ID for two-way sync */
  webhookChannelId: text('webhook_channel_id'),
  /** Google push notification resource ID (needed for stop) */
  webhookResourceId: text('webhook_resource_id'),
  /** When the webhook channel expires (Google max = 7 days) */
  webhookExpiration: timestamp('webhook_expiration'),
  /** Incremental sync token from Google Calendar API */
  syncToken: text('sync_token'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('calendar_integration_user_provider_idx').on(t.userId, t.provider),
  index('calendar_integration_webhook_channel_idx').on(t.webhookChannelId),
]))

// ─────────────────────────────────────────────
// Interviews
// ─────────────────────────────────────────────

export const interviewTypeEnum = pgEnum('interview_type', [
  'phone', 'video', 'in_person', 'panel', 'technical', 'take_home',
])

export const interviewStatusEnum = pgEnum('interview_status', [
  'scheduled', 'completed', 'cancelled', 'no_show',
])

export const candidateResponseEnum = pgEnum('candidate_response', [
  'pending', 'accepted', 'declined', 'tentative',
])

/**
 * Interviews scheduled for applications in the pipeline.
 * Each interview is linked to an application (which contains candidate + job).
 * Multiple interviews can exist per application (e.g., phone screen → technical → panel).
 */
export const interview = pgTable('interview', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  type: interviewTypeEnum('type').notNull().default('video'),
  status: interviewStatusEnum('status').notNull().default('scheduled'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  duration: integer('duration').notNull().default(60),
  location: text('location'),
  notes: text('notes'),
  /** Optional recruiter-written note included in candidate-facing proposals. */
  personalNote: text('personal_note'),
  interviewers: jsonb('interviewers').$type<string[]>(),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  invitationSentAt: timestamp('invitation_sent_at'),
  candidateResponse: candidateResponseEnum('candidate_response').notNull().default('pending'),
  candidateRespondedAt: timestamp('candidate_responded_at'),
  /** Google Calendar event ID for two-way sync (null = not synced) */
  googleCalendarEventId: text('google_calendar_event_id'),
  /** Direct link to the Google Calendar event (htmlLink from Google API) */
  googleCalendarEventLink: text('google_calendar_event_link'),
  /** IANA timezone for the scheduled time (e.g. 'America/New_York') */
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('interview_organization_id_idx').on(t.organizationId),
  index('interview_application_id_idx').on(t.applicationId),
  index('interview_scheduled_at_idx').on(t.scheduledAt),
  index('interview_status_idx').on(t.status),
  index('interview_created_by_id_idx').on(t.createdById),
]))

// ─────────────────────────────────────────────
// Email Templates
// ─────────────────────────────────────────────

/**
 * Reusable email templates for interview invitations.
 * Each org can create custom templates or use the system defaults.
 * Template body supports placeholder variables like {{candidateName}}, {{jobTitle}}, etc.
 */
export const emailTemplate = pgTable('email_template', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('email_template_organization_id_idx').on(t.organizationId),
  index('email_template_created_by_id_idx').on(t.createdById),
]))

// ─────────────────────────────────────────────
// Candidate Messaging
// ─────────────────────────────────────────────

/** One email thread per application, routed through an unguessable reply token. */
export const candidateConversation = pgTable('candidate_conversation', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  replyToken: text('reply_token').notNull().$defaultFn(() => crypto.randomUUID().replaceAll('-', '')),
  unreadCount: integer('unread_count').notNull().default(0),
  lastMessageAt: timestamp('last_message_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_conversation_organization_id_idx').on(t.organizationId),
  uniqueIndex('candidate_conversation_application_id_idx').on(t.applicationId),
  uniqueIndex('candidate_conversation_reply_token_idx').on(t.replyToken),
  index('candidate_conversation_last_message_at_idx').on(t.organizationId, t.lastMessageAt),
]))

/** Durable email content plus provider and RFC threading identities. */
export const candidateMessage = pgTable('candidate_message', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => candidateConversation.id, { onDelete: 'cascade' }),
  direction: candidateMessageDirectionEnum('direction').notNull(),
  status: candidateMessageStatusEnum('status').notNull(),
  fromEmail: text('from_email').notNull(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  bodyText: text('body_text').notNull(),
  /** Distinguishes ordinary replies from interview lifecycle messages. */
  kind: text('kind').$type<'message' | 'interview_proposal' | 'interview_update' | 'interview_cancellation' | 'interview_response'>().notNull().default('message'),
  interviewId: text('interview_id').references(() => interview.id, { onDelete: 'set null' }),
  /** ICS generation/delivery is tracked independently from provider delivery. */
  calendarAttachmentStatus: text('calendar_attachment_status').$type<'not_applicable' | 'attached' | 'failed'>().notNull().default('not_applicable'),
  calendarAttachmentError: text('calendar_attachment_error'),
  calendarSequence: integer('calendar_sequence'),
  providerMessageId: text('provider_message_id'),
  internetMessageId: text('internet_message_id'),
  inReplyTo: text('in_reply_to'),
  references: jsonb('references').$type<string[]>(),
  sentById: text('sent_by_id').references(() => user.id, { onDelete: 'set null' }),
  providerStatusAt: timestamp('provider_status_at'),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  failedAt: timestamp('failed_at'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_message_organization_id_idx').on(t.organizationId),
  index('candidate_message_conversation_id_idx').on(t.conversationId, t.createdAt),
  index('candidate_message_interview_id_idx').on(t.interviewId, t.createdAt),
  uniqueIndex('candidate_message_provider_id_idx').on(t.providerMessageId),
  uniqueIndex('candidate_message_internet_id_idx').on(t.internetMessageId),
]))

/** File metadata for message attachments. Raw bytes live in S3/MinIO. */
export const candidateMessageAttachment = pgTable('candidate_message_attachment', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => candidateMessage.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull().unique(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  /** Resend attachment identity for replay-safe inbound webhook processing. */
  providerAttachmentId: text('provider_attachment_id').unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_message_attachment_organization_id_idx').on(t.organizationId),
  index('candidate_message_attachment_message_id_idx').on(t.messageId),
]))

/** Resend delivers webhooks at least once; this table makes processing replay-safe. */
export const candidateMessageWebhookEvent = pgTable('candidate_message_webhook_event', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  providerMessageId: text('provider_message_id'),
  occurredAt: timestamp('occurred_at').notNull(),
  processedAt: timestamp('processed_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_message_webhook_provider_id_idx').on(t.providerMessageId),
  index('candidate_message_webhook_unprocessed_idx').on(t.processedAt),
]))

export const commentTargetEnum = pgEnum('comment_target', ['candidate', 'application', 'job'])

/**
 * Internal comments left by team members on candidates, applications, or jobs.
 * Scoped by organizationId for tenant isolation.
 */
export const comment = pgTable('comment', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  targetType: commentTargetEnum('target_type').notNull(),
  targetId: text('target_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('comment_organization_id_idx').on(t.organizationId),
  index('comment_target_idx').on(t.targetType, t.targetId),
  index('comment_author_id_idx').on(t.authorId),
]))

// ─────────────────────────────────────────────
// Collaboration: Activity Log
// ─────────────────────────────────────────────

export const activityActionEnum = pgEnum('activity_action', [
  'created', 'updated', 'deleted', 'status_changed',
  'comment_added', 'member_invited', 'member_removed', 'member_role_changed',
  'scored',
])

// ─────────────────────────────────────────────
// AI Scoring Enums
// ─────────────────────────────────────────────

export const criterionCategoryEnum = pgEnum('criterion_category', [
  'technical', 'experience', 'soft_skills', 'education', 'culture', 'custom',
])

export const analysisRunStatusEnum = pgEnum('analysis_run_status', [
  'completed', 'failed', 'partial',
])

/** Who pays for an analysis run — see analysisRun.billingMode. */
export const analysisBillingModeEnum = pgEnum('analysis_billing_mode', [
  'platform', 'byok',
])

/**
 * Immutable audit trail for all significant actions within an organization.
 * Append-only — no UPDATE or DELETE allowed via the API.
 */
export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  // Null actor = system-generated activity (e.g. an application-rule auto status
  // change). Timeline endpoints left-join `user` and the UI renders these as
  // "System", so automated actions still appear in the audit trail.
  actorId: text('actor_id').references(() => user.id, { onDelete: 'cascade' }),
  action: activityActionEnum('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('activity_log_organization_id_idx').on(t.organizationId),
  index('activity_log_actor_id_idx').on(t.actorId),
  index('activity_log_resource_idx').on(t.resourceType, t.resourceId),
  index('activity_log_created_at_idx').on(t.createdAt),
]))

// ─────────────────────────────────────────────
// Source Tracking
// ─────────────────────────────────────────────

/**
 * Well-known source identifiers for major job boards and channels.
 * `custom` allows organizations to create their own named sources.
 */
export const sourceChannelEnum = pgEnum('source_channel', [
  'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'monster',
  'handshake', 'angellist', 'wellfound', 'dice', 'stackoverflow',
  'weworkremotely', 'remoteok', 'builtin', 'hired', 'lever',
  'greenhouse_board', 'google_jobs', 'facebook', 'twitter', 'instagram',
  'tiktok', 'reddit', 'referral', 'career_site', 'email',
  'event', 'agency', 'direct', 'other', 'custom',
  // Aggregators that ingest the platform-wide /jobs.xml feed. Applications
  // arriving from them are attributed via the utm_source stamped into the feed.
  'jooble', 'adzuna', 'careerjet', 'talent_com', 'jobsora',
  'jora', 'whatjobs', 'whatsapp',
])

/**
 * Tracking links generated by recruiters to attribute candidate sources.
 * Each link produces a unique campaign code appended as `?ref=CODE` to the
 * public job page or global careers page. When a candidate applies through
 * a tracked link, the application records the source.
 */
export const trackingLink = pgTable('tracking_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Optional — links may be org-wide (null) or scoped to a single job */
  jobId: text('job_id').references(() => job.id, { onDelete: 'cascade' }),
  /** Canonical source channel */
  channel: sourceChannelEnum('channel').notNull().default('custom'),
  /** Human-readable label, e.g. "LinkedIn Spring Campaign" */
  name: text('name').notNull(),
  /** Unique short code used in ?ref=CODE — generated from crypto */
  code: text('code').notNull().unique(),
  /** Standard UTM parameters captured for external analytics */
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmTerm: text('utm_term'),
  utmContent: text('utm_content'),
  /** Aggregate counters (incremented on each click/application) */
  clickCount: integer('click_count').notNull().default(0),
  applicationCount: integer('application_count').notNull().default(0),
  /** Soft-disabled — deactivated links stop incrementing counts */
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('tracking_link_organization_id_idx').on(t.organizationId),
  index('tracking_link_job_id_idx').on(t.jobId),
  index('tracking_link_code_idx').on(t.code),
  index('tracking_link_channel_idx').on(t.channel),
]))

/**
 * Per-application source attribution — records HOW a candidate discovered
 * and applied to a job. One row per application. Populated at apply time
 * from ?ref=, ?utm_*, or Referer header.
 */
export const applicationSource = pgTable('application_source', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  /** Resolved channel — normalized from tracking link, UTM, or Referer */
  channel: sourceChannelEnum('channel').notNull().default('direct'),
  /** FK to tracking_link if the application came via a tracked link */
  trackingLinkId: text('tracking_link_id').references(() => trackingLink.id, { onDelete: 'set null' }),
  /** Raw UTM query params captured from the application URL */
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmTerm: text('utm_term'),
  utmContent: text('utm_content'),
  /** Cleaned Referer header (domain only — no path/query for privacy) */
  referrerDomain: text('referrer_domain'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('application_source_organization_id_idx').on(t.organizationId),
  index('application_source_application_id_idx').on(t.applicationId),
  index('application_source_channel_idx').on(t.channel),
  index('application_source_tracking_link_id_idx').on(t.trackingLinkId),
  uniqueIndex('application_source_application_idx').on(t.applicationId),
]))

// ─────────────────────────────────────────────
// AI Configuration & Scoring Tables
// ─────────────────────────────────────────────

/**
 * Per-organization AI provider configuration.
 * API keys are encrypted at rest using AES-256-GCM (same as calendar tokens).
 * Each org can configure their own provider, model, and API key.
 */
export const aiConfig = pgTable('ai_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Friendly display name shown in the picker (e.g. "GPT-4o (production)"). */
  name: text('name').notNull().default('Default'),
  provider: text('provider').notNull().default('openai'),
  model: text('model').notNull().default('gpt-4o-mini'),
  /** AES-256-GCM encrypted API key — NEVER returned to client */
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  /** Optional base URL override (e.g. for Ollama or custom endpoints) */
  baseUrl: text('base_url'),
  maxTokens: integer('max_tokens').notNull().default(4096),
  /** Price per 1M input tokens in USD (e.g. "2.50") */
  inputPricePer1m: numeric('input_price_per_1m', { precision: 10, scale: 4 }),
  /** Price per 1M output tokens in USD (e.g. "10.00") */
  outputPricePer1m: numeric('output_price_per_1m', { precision: 10, scale: 4 }),
  /** When true, this configuration is used by the chatbot when no per-conversation override is set. At most one row per org. */
  isDefaultChatbot: boolean('is_default_chatbot').notNull().default(false),
  /** When true, this configuration is used for applicant analysis (manual + auto). At most one row per org. */
  isDefaultAnalysis: boolean('is_default_analysis').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('ai_config_organization_id_idx').on(t.organizationId),
  // Partial unique indexes enforce at most one default per purpose per org.
  uniqueIndex('ai_config_default_chatbot_idx').on(t.organizationId).where(sql`${t.isDefaultChatbot} = true`),
  uniqueIndex('ai_config_default_analysis_idx').on(t.organizationId).where(sql`${t.isDefaultAnalysis} = true`),
]))

/**
 * Per-organization overrides for the platform-paid OpenRouter fallback.
 * This deliberately does not store an API key: the key remains server-owned,
 * so analysis runs through this config stay `billingMode = platform`.
 */
export const platformAiConfig = pgTable('platform_ai_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Platform (OpenRouter)'),
  provider: text('provider').notNull().default('openrouter'),
  model: text('model').notNull().default('openai/gpt-5.4-mini'),
  maxTokens: integer('max_tokens').notNull().default(4096),
  inputPricePer1m: numeric('input_price_per_1m', { precision: 10, scale: 4 }),
  outputPricePer1m: numeric('output_price_per_1m', { precision: 10, scale: 4 }),
  isDefaultAnalysis: boolean('is_default_analysis').notNull().default(true),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('platform_ai_config_organization_id_idx').on(t.organizationId),
]))

/**
 * Per-job scoring criteria. Each criterion defines one dimension of evaluation.
 * Weights are user-adjustable via sliders and used to compute weighted composite scores.
 */
export const scoringCriterion = pgTable('scoring_criterion', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: criterionCategoryEnum('category').notNull().default('custom'),
  maxScore: integer('max_score').notNull().default(10),
  /** Weight from 0–100, used by sliders. Default 50 = neutral. */
  weight: integer('weight').notNull().default(50),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('scoring_criterion_organization_id_idx').on(t.organizationId),
  index('scoring_criterion_job_id_idx').on(t.jobId),
  uniqueIndex('scoring_criterion_job_key_idx').on(t.jobId, t.key),
]))

/**
 * Per-job automation rules that read a candidate's application-form answers and
 * automatically set the application status on submit ("knockout questions").
 *
 * `conditions` is a JSONB array of { questionId, operator, value }. The rule
 * fires when its conditions satisfy `matchType` (all = AND, any = OR); the first
 * enabled matching rule (by displayOrder) applies its `action`. See
 * shared/application-rules.ts for the operator catalogue and the evaluator.
 *
 * Condition `questionId`s are NOT enforced by a foreign key (they live inside
 * JSONB). Deleting a question leaves a dangling reference; the evaluator treats
 * an unknown question as non-matching and the builder UI surfaces it for cleanup.
 */
export const ruleMatchTypeEnum = pgEnum('rule_match_type', ['all', 'any'])
export const ruleActionEnum = pgEnum('rule_action', ['rejected', 'screening', 'interview'])

export const applicationRule = pgTable('application_rule', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  matchType: ruleMatchTypeEnum('match_type').notNull().default('all'),
  action: ruleActionEnum('action').notNull().default('rejected'),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions').$type<import('../../../shared/application-rules').RuleCondition[]>().notNull().default([]),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('application_rule_organization_id_idx').on(t.organizationId),
  index('application_rule_job_id_idx').on(t.jobId),
]))

/**
 * Individual criterion scores computed by AI for each application.
 * Stores the raw AI output including evidence and confidence.
 */
export const criterionScore = pgTable('criterion_score', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  criterionKey: text('criterion_key').notNull(),
  maxScore: integer('max_score').notNull(),
  applicantScore: integer('applicant_score').notNull(),
  /** Confidence from 0 to 100 (%). */
  confidence: integer('confidence').notNull(),
  evidence: text('evidence').notNull(),
  strengths: jsonb('strengths').$type<string[]>(),
  gaps: jsonb('gaps').$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('criterion_score_organization_id_idx').on(t.organizationId),
  index('criterion_score_application_id_idx').on(t.applicationId),
  uniqueIndex('criterion_score_app_criterion_idx').on(t.applicationId, t.criterionKey),
]))

/**
 * Audit trail for each AI scoring run. Captures the rubric snapshot,
 * model used, token usage, and the raw LLM response for debugging.
 */
export const analysisRun = pgTable('analysis_run', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  status: analysisRunStatusEnum('status').notNull().default('completed'),
  /** Provider + model used for this run */
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  /** Snapshot of criteria at score time for audit trail */
  criteriaSnapshot: jsonb('criteria_snapshot').$type<Record<string, unknown>[]>(),
  /** Composite weighted score (0–100) */
  compositeScore: integer('composite_score'),
  /** Token usage for cost tracking */
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  /**
   * Frozen cost of this run in micro-dollars (1e-6 USD), computed at write time
   * from the central price table (utils/ai/pricing.ts). Null when the model is
   * unpriced. Summed by the budget gate; never recomputed from mutable config.
   */
  costUsdMicros: integer('cost_usd_micros'),
  /**
   * Who pays for this run: `platform` = our OpenRouter key (counts against the
   * org's monthly budget + the global daily kill-switch); `byok` = the org's own
   * API key (never budget-capped — it's their bill, we only track it).
   */
  billingMode: analysisBillingModeEnum('billing_mode').notNull().default('byok'),
  /** Raw LLM response for debugging (sanitized — no PII stored) */
  rawResponse: jsonb('raw_response'),
  errorMessage: text('error_message'),
  scoredById: text('scored_by_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('analysis_run_organization_id_idx').on(t.organizationId),
  index('analysis_run_application_id_idx').on(t.applicationId),
  index('analysis_run_created_at_idx').on(t.createdAt),
]))

// ─────────────────────────────────────────────
// Recruiter Notifications (outbox + preferences + suppression)
// ─────────────────────────────────────────────
//
// Reliable, long-term recruiter notification engine. Domain events are written
// to `notificationOutbox` (ideally in the same tx as the triggering write so an
// event is never lost), and a scheduled worker drains it, sends via Resend, and
// retries with backoff. See server/utils/notifications/.

/** Recruiter-facing events. New producers plug into the same engine. */
export const notificationTypeEnum = pgEnum('notification_type', [
  'candidate_replied', 'application_created', 'interview_response',
])
/** How a single outbox row is delivered — immediately, or rolled into a daily digest. */
export const notificationCadenceEnum = pgEnum('notification_cadence', ['instant', 'digest'])
/** Per-recipient, per-type choice. `off` suppresses the event entirely for that user. */
export const notificationChannelModeEnum = pgEnum('notification_channel_mode', ['instant', 'digest', 'off'])
/** Outbox lifecycle: pending → sent | skipped | dead (past max retries). */
export const notificationOutboxStatusEnum = pgEnum('notification_outbox_status', [
  'pending', 'sent', 'skipped', 'dead',
])
/** Why an address was suppressed — a hard bounce or a spam complaint. */
export const emailSuppressionReasonEnum = pgEnum('email_suppression_reason', ['bounce', 'complaint'])

/**
 * Durable, at-least-once notification queue. One row per recipient per event.
 *
 * `dedupeKey` is `<event-scoped key>:<recipientUserId>` so re-enqueuing the same
 * event is a no-op (unique index + onConflictDoNothing), while distinct recipients
 * each get their own row. The worker pulls `status='pending'` rows whose
 * `nextAttemptAt` has elapsed; `providerMessageId` links Resend delivery webhooks
 * back to the row.
 */
export const notificationOutbox = pgTable('notification_outbox', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  recipientUserId: text('recipient_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  recipientEmail: text('recipient_email').notNull(),
  type: notificationTypeEnum('type').notNull(),
  cadence: notificationCadenceEnum('cadence').notNull(),
  /** Idempotency key: `<event key>:<recipientUserId>`. Globally unique. */
  dedupeKey: text('dedupe_key').notNull(),
  /** Rendering context for the template (candidate name, job title, deep-link ids, …). */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: notificationOutboxStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
  /** Digest grouping key (YYYY-MM-DD, recipient timezone-agnostic v1). NULL for instant rows. */
  digestBucket: text('digest_bucket'),
  /** Resend message id — set on send, used by the delivery webhook to update status. */
  providerMessageId: text('provider_message_id'),
  sentAt: timestamp('sent_at'),
  failedAt: timestamp('failed_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('notification_outbox_dedupe_key_idx').on(t.dedupeKey),
  // Drives cadence-specific pending-row pulls without indexing terminal rows.
  index('notification_outbox_pull_idx').on(t.cadence, t.nextAttemptAt)
    .where(sql`${t.status} = 'pending'`),
  // Webhook lookup by provider message id (partial: only rows that have been sent).
  uniqueIndex('notification_outbox_provider_id_idx').on(t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
  index('notification_outbox_organization_id_idx').on(t.organizationId),
  index('notification_outbox_digest_idx').on(t.organizationId, t.recipientUserId, t.digestBucket),
]))

/**
 * Per-recipient, per-type delivery preference. Absent row = the sensible default
 * resolved in code (candidate_replied/interview_response -> instant,
 * application_created -> digest). See server/utils/notifications/recipients.ts.
 */
export const notificationPreference = pgTable('notification_preference', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  channelMode: notificationChannelModeEnum('channel_mode').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('notification_preference_user_org_type_idx').on(t.userId, t.organizationId, t.type),
  index('notification_preference_organization_id_idx').on(t.organizationId),
]))

/**
 * Addresses we must never send to again. Fed by hard-bounce / complaint webhooks
 * and checked at recipient resolution — protects long-term sender reputation.
 */
export const emailSuppression = pgTable('email_suppression', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull(),
  reason: emailSuppressionReasonEnum('reason').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('email_suppression_email_idx').on(sql`lower(${t.email})`),
]))

// ─────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────

export const onboardingSurveyResponseRelations = relations(onboardingSurveyResponse, ({ one }) => ({
  user: one(user, { fields: [onboardingSurveyResponse.userId], references: [user.id] }),
  organization: one(organization, { fields: [onboardingSurveyResponse.organizationId], references: [organization.id] }),
}))

export const jobRelations = relations(job, ({ one, many }) => ({
  organization: one(organization, { fields: [job.organizationId], references: [organization.id] }),
  applications: many(application),
  questions: many(jobQuestion),
  scoringCriteria: many(scoringCriterion),
  trackingLinks: many(trackingLink),
}))

export const candidateRelations = relations(candidate, ({ one, many }) => ({
  organization: one(organization, { fields: [candidate.organizationId], references: [organization.id] }),
  applications: many(application),
  documents: many(document),
}))

export const applicationRelations = relations(application, ({ one, many }) => ({
  organization: one(organization, { fields: [application.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [application.candidateId], references: [candidate.id] }),
  job: one(job, { fields: [application.jobId], references: [job.id] }),
  responses: many(questionResponse),
  interviews: many(interview),
  criterionScores: many(criterionScore),
  analysisRuns: many(analysisRun),
  source: one(applicationSource),
  conversation: one(candidateConversation),
}))

export const documentRelations = relations(document, ({ one }) => ({
  organization: one(organization, { fields: [document.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [document.candidateId], references: [candidate.id] }),
}))

export const jobQuestionRelations = relations(jobQuestion, ({ one }) => ({
  organization: one(organization, { fields: [jobQuestion.organizationId], references: [organization.id] }),
  job: one(job, { fields: [jobQuestion.jobId], references: [job.id] }),
}))

export const questionResponseRelations = relations(questionResponse, ({ one }) => ({
  organization: one(organization, { fields: [questionResponse.organizationId], references: [organization.id] }),
  application: one(application, { fields: [questionResponse.applicationId], references: [application.id] }),
  question: one(jobQuestion, { fields: [questionResponse.questionId], references: [jobQuestion.id] }),
}))

export const propertyDefinitionRelations = relations(propertyDefinition, ({ one, many }) => ({
  organization: one(organization, { fields: [propertyDefinition.organizationId], references: [organization.id] }),
  job: one(job, { fields: [propertyDefinition.jobId], references: [job.id] }),
  values: many(propertyValue),
}))

export const propertyValueRelations = relations(propertyValue, ({ one }) => ({
  organization: one(organization, { fields: [propertyValue.organizationId], references: [organization.id] }),
  definition: one(propertyDefinition, { fields: [propertyValue.propertyDefinitionId], references: [propertyDefinition.id] }),
}))

export const commentRelations = relations(comment, ({ one }) => ({
  organization: one(organization, { fields: [comment.organizationId], references: [organization.id] }),
  author: one(user, { fields: [comment.authorId], references: [user.id] }),
}))

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  organization: one(organization, { fields: [activityLog.organizationId], references: [organization.id] }),
  actor: one(user, { fields: [activityLog.actorId], references: [user.id] }),
}))

export const inviteLinkRelations = relations(inviteLink, ({ one }) => ({
  organization: one(organization, { fields: [inviteLink.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [inviteLink.createdById], references: [user.id] }),
}))

export const joinRequestRelations = relations(joinRequest, ({ one }) => ({
  user: one(user, { fields: [joinRequest.userId], references: [user.id] }),
  organization: one(organization, { fields: [joinRequest.organizationId], references: [organization.id] }),
  reviewedBy: one(user, { fields: [joinRequest.reviewedById], references: [user.id] }),
}))

export const interviewRelations = relations(interview, ({ one, many }) => ({
  organization: one(organization, { fields: [interview.organizationId], references: [organization.id] }),
  application: one(application, { fields: [interview.applicationId], references: [application.id] }),
  createdBy: one(user, { fields: [interview.createdById], references: [user.id] }),
  messages: many(candidateMessage),
}))

export const emailTemplateRelations = relations(emailTemplate, ({ one }) => ({
  organization: one(organization, { fields: [emailTemplate.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [emailTemplate.createdById], references: [user.id] }),
}))

export const candidateConversationRelations = relations(candidateConversation, ({ one, many }) => ({
  organization: one(organization, { fields: [candidateConversation.organizationId], references: [organization.id] }),
  application: one(application, { fields: [candidateConversation.applicationId], references: [application.id] }),
  messages: many(candidateMessage),
}))

export const candidateMessageRelations = relations(candidateMessage, ({ one, many }) => ({
  organization: one(organization, { fields: [candidateMessage.organizationId], references: [organization.id] }),
  conversation: one(candidateConversation, { fields: [candidateMessage.conversationId], references: [candidateConversation.id] }),
  sentBy: one(user, { fields: [candidateMessage.sentById], references: [user.id] }),
  interview: one(interview, { fields: [candidateMessage.interviewId], references: [interview.id] }),
  attachments: many(candidateMessageAttachment),
}))

export const candidateMessageAttachmentRelations = relations(candidateMessageAttachment, ({ one }) => ({
  organization: one(organization, { fields: [candidateMessageAttachment.organizationId], references: [organization.id] }),
  message: one(candidateMessage, { fields: [candidateMessageAttachment.messageId], references: [candidateMessage.id] }),
}))

export const calendarIntegrationRelations = relations(calendarIntegration, ({ one }) => ({
  user: one(user, { fields: [calendarIntegration.userId], references: [user.id] }),
}))

// ─── AI Scoring Relations ──────────────────────────────────────────

export const aiConfigRelations = relations(aiConfig, ({ one }) => ({
  organization: one(organization, { fields: [aiConfig.organizationId], references: [organization.id] }),
}))

export const scoringCriterionRelations = relations(scoringCriterion, ({ one }) => ({
  organization: one(organization, { fields: [scoringCriterion.organizationId], references: [organization.id] }),
  job: one(job, { fields: [scoringCriterion.jobId], references: [job.id] }),
}))

export const applicationRuleRelations = relations(applicationRule, ({ one }) => ({
  organization: one(organization, { fields: [applicationRule.organizationId], references: [organization.id] }),
  job: one(job, { fields: [applicationRule.jobId], references: [job.id] }),
}))

export const criterionScoreRelations = relations(criterionScore, ({ one }) => ({
  organization: one(organization, { fields: [criterionScore.organizationId], references: [organization.id] }),
  application: one(application, { fields: [criterionScore.applicationId], references: [application.id] }),
}))

export const analysisRunRelations = relations(analysisRun, ({ one }) => ({
  organization: one(organization, { fields: [analysisRun.organizationId], references: [organization.id] }),
  application: one(application, { fields: [analysisRun.applicationId], references: [application.id] }),
  scoredBy: one(user, { fields: [analysisRun.scoredById], references: [user.id] }),
}))

// ─── Source Tracking Relations ─────────────────────────────────────

export const trackingLinkRelations = relations(trackingLink, ({ one, many }) => ({
  organization: one(organization, { fields: [trackingLink.organizationId], references: [organization.id] }),
  job: one(job, { fields: [trackingLink.jobId], references: [job.id] }),
  createdBy: one(user, { fields: [trackingLink.createdById], references: [user.id] }),
  applicationSources: many(applicationSource),
}))

export const applicationSourceRelations = relations(applicationSource, ({ one }) => ({
  organization: one(organization, { fields: [applicationSource.organizationId], references: [organization.id] }),
  application: one(application, { fields: [applicationSource.applicationId], references: [application.id] }),
  trackingLink: one(trackingLink, { fields: [applicationSource.trackingLinkId], references: [trackingLink.id] }),
}))

export const orgSettingsRelations = relations(orgSettings, ({ one }) => ({
  organization: one(organization, { fields: [orgSettings.organizationId], references: [organization.id] }),
}))

export const retentionAuditRelations = relations(retentionAudit, ({ one }) => ({
  organization: one(organization, { fields: [retentionAudit.organizationId], references: [organization.id] }),
}))

// ─────────────────────────────────────────────
// Chatbot — per-user persisted state
// ─────────────────────────────────────────────
// Conversations, folders and custom AI agents are PRIVATE to the creating user
// (scoped by both organizationId AND userId). The chatbot itself runs against
// org-wide data via tool calls, but the chat history and user preferences
// (custom system prompts, folder organisation) never leak between users.

export const chatbotMessageRoleEnum = pgEnum('chatbot_message_role', ['user', 'assistant'])

/**
 * Custom AI agents — user-defined personas with their own system prompt.
 * Each user manages their own private list. isDefault marks the one that
 * gets pre-selected when starting a new conversation.
 */
export const chatbotAgent = pgTable('chatbot_agent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Short description shown next to the name in the picker. */
  description: text('description'),
  /** Lucide icon name (e.g. 'Sparkles'). Optional; UI falls back to a default. */
  icon: text('icon'),
  /** The custom system prompt appended/replacing the base assistant prompt. */
  systemPrompt: text('system_prompt').notNull(),
  /** Default temperature override (0..2). Null → use server default. */
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_agent_org_user_idx').on(t.organizationId, t.userId),
  // Enforce single default agent per (org, user) at the DB layer to backstop
  // the application-level clear-then-set logic against concurrent requests.
  uniqueIndex('chatbot_agent_default_per_user_idx')
    .on(t.organizationId, t.userId)
    .where(sql`${t.isDefault} = true`),
]))

/**
 * Folders for organising conversations in the sidebar. Per-user.
 */
export const chatbotFolder = pgTable('chatbot_folder', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Lucide icon name. Optional. */
  icon: text('icon'),
  /** Manual sort order, ascending. */
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_folder_org_user_idx').on(t.organizationId, t.userId),
]))

/**
 * A persisted chatbot conversation. Belongs to a user, optionally filed under
 * a folder, optionally bound to a specific custom agent.
 */
export const chatbotConversation = pgTable('chatbot_conversation', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').references(() => chatbotFolder.id, { onDelete: 'set null' }),
  agentId: text('agent_id').references(() => chatbotAgent.id, { onDelete: 'set null' }),
  /** AI configuration last used for this conversation. Falls back to org chatbot default. */
  aiConfigId: text('ai_config_id').references(() => aiConfig.id, { onDelete: 'set null' }),
  /** Human-friendly title. Auto-generated from the first user message if absent. */
  title: text('title').notNull().default('New chat'),
  /** Scope at the time of last message: { kind: 'organization' } or { kind: 'job', jobId } */
  scope: jsonb('scope').notNull().$type<{ kind: 'organization' | 'job'; jobId?: string }>(),
  /** Whether extended thinking was enabled for the most recent turn. */
  thinking: boolean('thinking').notNull().default(false),
  /** Pinned to the top of the sidebar list. */
  pinned: boolean('pinned').notNull().default(false),
  /** Cached preview of last message — avoids loading messages just for the list. */
  lastMessagePreview: text('last_message_preview'),
  lastMessageAt: timestamp('last_message_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_conversation_org_user_idx').on(t.organizationId, t.userId),
  index('chatbot_conversation_folder_idx').on(t.folderId),
  index('chatbot_conversation_last_message_at_idx').on(t.userId, t.lastMessageAt),
]))

/**
 * Persisted message belonging to a conversation. We mirror the wire shape of
 * ChatbotMessage but normalize a few server-side fields (toolCalls, sources).
 */
export const chatbotMessage = pgTable('chatbot_message', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id').notNull().references(() => chatbotConversation.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: chatbotMessageRoleEnum('role').notNull(),
  content: text('content').notNull().default(''),
  reasoning: text('reasoning'),
  /** Persisted ChatbotToolCall[]. */
  toolCalls: jsonb('tool_calls').$type<unknown[]>(),
  /** Persisted ChatbotSource[] (jobs / candidates / applications referenced). */
  sources: jsonb('sources').$type<unknown[]>(),
  /** Attachment metadata snapshots (no raw file content). */
  attachments: jsonb('attachments').$type<unknown[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_message_conversation_idx').on(t.conversationId, t.createdAt),
]))

export const chatbotAgentRelations = relations(chatbotAgent, ({ many }) => ({
  conversations: many(chatbotConversation),
}))

export const chatbotFolderRelations = relations(chatbotFolder, ({ many }) => ({
  conversations: many(chatbotConversation),
}))

export const chatbotConversationRelations = relations(chatbotConversation, ({ one, many }) => ({
  organization: one(organization, { fields: [chatbotConversation.organizationId], references: [organization.id] }),
  user: one(user, { fields: [chatbotConversation.userId], references: [user.id] }),
  folder: one(chatbotFolder, { fields: [chatbotConversation.folderId], references: [chatbotFolder.id] }),
  agent: one(chatbotAgent, { fields: [chatbotConversation.agentId], references: [chatbotAgent.id] }),
  aiConfig: one(aiConfig, { fields: [chatbotConversation.aiConfigId], references: [aiConfig.id] }),
  messages: many(chatbotMessage),
}))

export const chatbotMessageRelations = relations(chatbotMessage, ({ one }) => ({
  conversation: one(chatbotConversation, { fields: [chatbotMessage.conversationId], references: [chatbotConversation.id] }),
}))

// ─────────────────────────────────────────────
// Career Page
// ─────────────────────────────────────────────

/**
 * Per-organization branded career page configuration.
 *
 * Customization is deliberately guardrailed: the org supplies identity only —
 * its logo and name (already on `organization`), one accent color, an optional
 * headline and short description, and an on/off switch. Reqcore owns the
 * layout. No fonts, CSS, or layout controls are exposed. Custom domain is a
 * later paid upgrade, not this table.
 *
 * One row per organization — upserted on first edit. Absence of a row means the
 * org has never customized its page and defaults apply (accent = brand, headline
 * derived from the org name). Every plan includes the `careerPage` feature, so
 * the page is live unless the org has explicitly disabled it.
 */
export const careerPage = pgTable('career_page', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /**
   * Optional custom public slug for the /career/:slug URL. NULL falls back to the
   * organization slug. Shares the /career namespace with organization slugs, so
   * uniqueness is enforced across both on save.
   */
  slug: text('slug'),
  /** Master switch — when false the public career page shows an "unavailable" state. */
  enabled: boolean('enabled').notNull().default(true),
  /** Single accent color as a hex string (e.g. "#4f46e5"). NULL falls back to the brand color. */
  accentColor: text('accent_color'),
  /** Optional hero headline. NULL -> "Open roles at {org name}". */
  headline: text('headline'),
  /** Optional short company intro shown under the headline. */
  description: text('description'),
  /**
   * S3 storage key for a career-page-specific logo. NULL falls back to the
   * organization logo. Served publicly via /api/public/career-page/:slug/asset.
   */
  logoStorageKey: text('logo_storage_key'),
  /**
   * S3 storage key for the hero banner image. NULL renders the plain accent
   * hero. Served publicly via /api/public/career-page/:slug/asset.
   */
  bannerStorageKey: text('banner_storage_key'),
  /**
   * Vertical focal point for the hero banner, 0–100 (percent). Controls the CSS
   * object-position so admins can reposition which slice of a wide image shows.
   * 50 = centered (default).
   */
  bannerPosition: integer('banner_position').notNull().default(50),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('career_page_organization_id_idx').on(t.organizationId),
  // Nullable unique: Postgres allows many NULLs, so orgs without a custom slug coexist.
  uniqueIndex('career_page_slug_idx').on(t.slug),
]))

export const careerPageRelations = relations(careerPage, ({ one }) => ({
  organization: one(organization, { fields: [careerPage.organizationId], references: [organization.id] }),
}))

// ─────────────────────────────────────────────
// Bulk Candidate Import
// ─────────────────────────────────────────────
//
// The import pipeline is deliberately staged: an upload becomes an `importJob`
// whose rows land in `importRow` as raw + normalized JSON. Nothing touches the
// `candidate` table until the user reviews the preview and commits. Raw data is
// never discarded, so re-mapping columns re-normalizes from source without a
// re-upload, and a crashed commit is safely resumable (each row is idempotent
// via `dedupeHash`). See PRODUCT.md → "Bulk import" for the wider design.

export const importSourceEnum = pgEnum('import_source', [
  // Tabular exports (columns exist, just mislabeled) share one normalizer.
  'csv', 'xlsx',
  // Unstructured resume dumps run through the resume-parser + AI-extract path.
  'resume_zip',
])

export const importJobStatusEnum = pgEnum('import_job_status', [
  // Rows are being parsed/normalized into staging.
  'processing',
  // Staged and classified; awaiting the user's mapping confirmation + commit.
  'previewing',
  // Commit in progress (ready rows being written to `candidate`).
  'committing',
  // All ready rows committed.
  'completed',
  // Unrecoverable job-level failure (bad file, parse crash).
  'failed',
])

export const importRowStatusEnum = pgEnum('import_row_status', [
  // Normalized and valid — will be created on commit.
  'ready',
  // Matches an existing candidate (by dedupeHash); commit policy decides fate.
  'duplicate',
  // A duplicate of an earlier row within this same file.
  'duplicate_in_file',
  // Failed validation (missing/invalid required fields); surfaced in preview.
  'error',
  // Written to `candidate` (or intentionally skipped) during commit.
  'committed',
  'skipped',
])

/**
 * One bulk-import upload. Tracks progress and the confirmed column mapping so
 * the job can be polled, resumed, and audited. `mapping` is a source-column →
 * candidate-field map (null until the user confirms in the preview step).
 */
export const importJob = pgTable('import_job', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => user.id, { onDelete: 'cascade' }),
  source: importSourceEnum('source').notNull(),
  status: importJobStatusEnum('status').notNull().default('processing'),
  /** Original uploaded filename, for display in the import history. */
  filename: text('filename').notNull(),
  /** Detected header columns from the source file (tabular sources). */
  columns: jsonb('columns').$type<string[]>(),
  /** Confirmed source-column → candidate-field mapping. NULL until confirmed. */
  mapping: jsonb('mapping').$type<Record<string, string>>(),
  /**
   * When set, committed rows are also linked to this job as applications — i.e.
   * "import these people as applicants to role X". NULL = add to the pool only.
   */
  targetJobId: text('target_job_id').references(() => job.id, { onDelete: 'set null' }),
  totalRows: integer('total_rows').notNull().default(0),
  /** Rows written during commit — drives the progress bar and resumability. */
  committedRows: integer('committed_rows').notNull().default(0),
  /** Populated when status = 'failed'. */
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('import_job_organization_id_idx').on(t.organizationId),
  index('import_job_status_idx').on(t.organizationId, t.status),
]))

/**
 * One candidate-to-be. `rawData` is the untouched source record (keyed by the
 * file's own column names); `normalizedData` is the mapped candidate shape.
 * `dedupeHash` (org + normalized email) makes commit idempotent and powers
 * duplicate detection against both existing candidates and earlier rows.
 */
export const importRow = pgTable('import_row', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => importJob.id, { onDelete: 'cascade' }),
  /** 0-based position in the source file, for stable ordering + error display. */
  rowIndex: integer('row_index').notNull(),
  rawData: jsonb('raw_data').$type<Record<string, string>>().notNull(),
  normalizedData: jsonb('normalized_data').$type<Record<string, unknown>>(),
  status: importRowStatusEnum('status').notNull().default('ready'),
  /** Deterministic idempotency key: null when no email could be normalized. */
  dedupeHash: text('dedupe_hash'),
  /** Existing candidate this row matched, when status = 'duplicate'. */
  matchedCandidateId: text('matched_candidate_id').references(() => candidate.id, { onDelete: 'set null' }),
  /** Candidate created from this row, when status = 'committed'. */
  createdCandidateId: text('created_candidate_id').references(() => candidate.id, { onDelete: 'set null' }),
  /** Human-readable validation failure, when status = 'error'. */
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('import_row_job_id_idx').on(t.jobId),
  index('import_row_job_status_idx').on(t.jobId, t.status),
  index('import_row_dedupe_idx').on(t.organizationId, t.dedupeHash),
]))

export const importJobRelations = relations(importJob, ({ one, many }) => ({
  organization: one(organization, { fields: [importJob.organizationId], references: [organization.id] }),
  createdByUser: one(user, { fields: [importJob.createdBy], references: [user.id] }),
  targetJob: one(job, { fields: [importJob.targetJobId], references: [job.id] }),
  rows: many(importRow),
}))

export const importRowRelations = relations(importRow, ({ one }) => ({
  organization: one(organization, { fields: [importRow.organizationId], references: [organization.id] }),
  job: one(importJob, { fields: [importRow.jobId], references: [importJob.id] }),
  matchedCandidate: one(candidate, { fields: [importRow.matchedCandidateId], references: [candidate.id] }),
  createdCandidate: one(candidate, { fields: [importRow.createdCandidateId], references: [candidate.id] }),
}))
